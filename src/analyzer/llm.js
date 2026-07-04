import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs/promises';
import path from 'path';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

/**
 * LLM 分析模块 — 调用 Claude API 生成客户画像
 */
const PERSONAL_DYNAMIC_PLATFORMS = [
  ['LinkedIn', 'linkedin'],
  ['Instagram', 'instagram'],
  ['Facebook', 'facebook'],
  ['X', 'x'],
];

const COMPANY_DYNAMIC_PLATFORMS = [
  ['公司 Instagram', 'companyInstagram'],
  ['公司 Facebook', 'companyFacebook'],
  ['公司 X', 'companyX'],
];

const MAX_POSTS_PER_GROUP = 8;
const MAX_POST_TEXT_LENGTH = 220;

export function buildAnalysisEvidence(mergedData = {}) {
  const sections = [];
  const activity = buildActivitySummary(mergedData.unified?.socialActivity);
  const personalPosts = collectPostEvidence(mergedData.platforms, PERSONAL_DYNAMIC_PLATFORMS);
  const companyPosts = collectPostEvidence(mergedData.platforms, COMPANY_DYNAMIC_PLATFORMS);
  const companySignals = collectCompanySignals(mergedData);

  if (activity.length) {
    sections.push(`### 社交活跃度摘要\n${activity.map(item => `- ${item}`).join('\n')}`);
  }

  if (personalPosts.length) {
    sections.push(`### 可信个人动态\n${personalPosts.map(formatPostEvidence).join('\n')}`);
  }

  if (companyPosts.length) {
    sections.push(`### 可信公司动态\n${companyPosts.map(formatPostEvidence).join('\n')}`);
  }

  if (companySignals.length) {
    sections.push(`### 公司业务/新闻/招聘信号\n${companySignals.map(item => `- ${item}`).join('\n')}`);
  }

  return sections.length
    ? sections.join('\n\n')
    : '没有额外动态证据。请主要依据基础资料、公司研究和可信来源规则分析。';
}

export function buildDepthGuidance(mergedData = {}) {
  const depth = mergedData.query?.depth || 'quick';

  if (depth === 'deep') {
    return [
      '当前是 deep 模式。请在原有 company、person、salesInsights 之外，额外输出 `analysisAngles` 字段。',
      '`analysisAngles` 必须只基于可信证据，重点补充更多分析角度，而不是重复已有字段。',
      '每条建议尽量写成“证据/观察 → 推断 → 商务用途”。如果某个角度没有数据，写“数据不足，无法判断”。',
    ].join('\n');
  }

  return '当前是 quick 模式。quick 模式不要输出 `analysisAngles`，保持原有 company、person、salesInsights 结构和轻量分析。';
}

function buildActivitySummary(activity = {}) {
  if (!activity) return [];
  const out = [];

  if (activity.instagram) {
    const act = activity.instagram;
    out.push(`Instagram: 近 ${act.recentPostsCount || 0} 条帖子，平均互动 ${act.avgLikes ?? '-'} 赞 / ${act.avgComments ?? '-'} 评论。`);
  }

  if (activity.facebook) {
    const act = activity.facebook;
    out.push(`Facebook: 近 ${act.recentPostsCount || 0} 条帖子${act.latestPostDate ? `，最新 ${act.latestPostDate}` : ''}。`);
  }

  if (activity.x) {
    const act = activity.x;
    out.push(`X: 近 ${act.recentPostsCount || 0} 条公开帖子${act.latestPostDate ? `，最新 ${act.latestPostDate}` : ''}。`);
  }

  return out;
}

function collectPostEvidence(platforms = {}, platformList = []) {
  const out = [];

  for (const [label, key] of platformList) {
    const info = platforms?.[key];
    if (!info?.found || info.excludedFromAnalysis) continue;

    const posts = info.profile?.recentPosts || [];
    for (const post of posts) {
      const text = postText(post);
      if (!text) continue;
      out.push({
        platform: label,
        text,
        date: post.timestamp || post.time || post.date || null,
        engagement: postEngagement(post),
      });
      if (out.length >= MAX_POSTS_PER_GROUP) return out;
    }
  }

  return out;
}

function collectCompanySignals(mergedData = {}) {
  const google = mergedData.platforms?.google || {};
  const research = mergedData.companyResearch || {};
  const signals = [];

  for (const item of [
    ...(google.newsArticles || []),
    ...(research.news || []),
    ...(google.jobs || []),
    ...(research.jobs || []),
    ...(google.businessResults || []),
    ...(research.businessResults || []),
  ]) {
    const title = cleanText(item?.title || item?.name || item?.text || '');
    const snippet = truncateText(item?.snippet || item?.summary || item?.description || '', 140);
    if (!title && !snippet) continue;
    signals.push(`${title}${snippet ? `：${snippet}` : ''}`);
    if (signals.length >= 8) break;
  }

  return [...new Set(signals)];
}

function formatPostEvidence(item) {
  const meta = [item.date, item.engagement].filter(Boolean).join('，');
  return `- ${item.platform}${meta ? `（${meta}）` : ''}: ${item.text}`;
}

function postText(post = {}) {
  return truncateText(post.text || post.caption || post.title || post.summary || '', MAX_POST_TEXT_LENGTH);
}

function postEngagement(post = {}) {
  const parts = [];
  if (post.likes !== null && post.likes !== undefined) parts.push(`${post.likes} 赞`);
  if (post.comments !== null && post.comments !== undefined) parts.push(`${post.comments} 评论`);
  return parts.join(' / ');
}

function truncateText(value, max) {
  const text = cleanText(value);
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export class Analyzer {
  constructor() {
    this.client = new Anthropic({
      apiKey: config.anthropicApiKey,
      baseURL: config.anthropicBaseUrl,
    });
  }

  /**
   * 分析采集数据，生成画像报告
   * @param {object} mergedData - mergeData() 输出的合并数据
   * @param {object} options - { lang: 'zh' | 'en' }
   * @returns {object} 分析结果
   */
  async analyze(mergedData, options = {}) {
    const { lang = 'zh' } = options;

    // 加载 prompt 模板
    const promptPath = path.join(config.promptsDir, 'analyze.md');
    let promptTemplate = await fs.readFile(promptPath, 'utf-8');

    // 替换变量
    const prompt = promptTemplate
      .replace('{{RAW_DATA}}', JSON.stringify(mergedData, null, 2))
      .replace('{{EVIDENCE_SUMMARY}}', buildAnalysisEvidence(mergedData))
      .replace('{{DEPTH_GUIDANCE}}', buildDepthGuidance(mergedData))
      .replace('{{LANG}}', lang === 'zh' ? '中文' : 'English');

    logger.info('正在调用 Claude API 进行分析...');

    try {
      const response = await this.client.messages.create({
        model: config.anthropicModel,
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      });

      const content = response.content.find((block) => block.type === 'text')?.text || '';
      if (!content) throw new Error('LLM 返回为空');

      // 尝试从回复中提取 JSON
      const analysis = this._parseResponse(content);

      logger.info('分析完成');
      return analysis;
    } catch (err) {
      logger.error(`Claude API 调用失败: ${err.message}`);
      throw err;
    }
  }

  /**
   * 解析 LLM 回复，提取 JSON
   */
  _parseResponse(content) {
    // 尝试直接解析
    try {
      return JSON.parse(content);
    } catch {
      // 尝试从 markdown 代码块中提取
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[1].trim());
        } catch {
          // fall through
        }
      }

      // 返回原始文本作为 fallback
      logger.warn('无法解析 LLM 输出为 JSON，返回原始文本');
      return { rawText: content };
    }
  }
}
