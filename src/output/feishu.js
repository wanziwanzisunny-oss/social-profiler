import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { generateHtml } from './html.js';

const execFileAsync = promisify(execFile);
const DEFAULT_FEISHU_CHAT_NAME = '客户画像';

export function parseFeishuChatId(output) {
  let data;
  try {
    data = typeof output === 'string' ? JSON.parse(output || '{}') : output || {};
  } catch {
    return null;
  }

  return data.chat_id
    || data.chatId
    || data.data?.chat_id
    || data.data?.chatId
    || null;
}

export function parseFeishuSearchChat(output, chatName = DEFAULT_FEISHU_CHAT_NAME) {
  let data;
  try {
    data = typeof output === 'string' ? JSON.parse(output || '{}') : output || {};
  } catch {
    return null;
  }

  const chats = data.data?.chats || data.data?.items || data.chats || [];
  const matches = chats
    .filter((chat) => chat?.name === chatName)
    .filter((chat) => !chat.chat_status || chat.chat_status === 'normal')
    .filter((chat) => chat.chat_id || chat.chatId)
    .sort((a, b) => new Date(a.create_time || 0) - new Date(b.create_time || 0));

  const first = matches[0];
  if (!first) return null;
  return {
    chatId: first.chat_id || first.chatId,
    chatName: first.name,
  };
}

export async function findExistingFeishuChat(options = {}) {
  const {
    execFileFn = execFileAsync,
    chatName = DEFAULT_FEISHU_CHAT_NAME,
    ownerOpenId,
    fetchOwnerOpenIdFn = () => fetchFeishuAppOwnerOpenId({ execFileFn }),
  } = options;

  const memberOpenId = ownerOpenId || await fetchOwnerOpenIdFn();
  if (!isSafeFeishuOpenId(memberOpenId)) {
    return null;
  }

  try {
    const { stdout } = await execFileFn('lark-cli', [
      'im', '+chat-search',
      '--query', chatName,
      '--member-ids', memberOpenId,
      '--disable-search-by-user',
      '--format', 'json',
      '--page-size', '20',
    ], { timeout: 15000 });
    return parseFeishuSearchChat(stdout, chatName);
  } catch {
    return null;
  }
}

export function parseFeishuOwnerOpenId(output) {
  let data;
  try {
    data = typeof output === 'string' ? JSON.parse(output || '{}') : output || {};
  } catch {
    return null;
  }

  return data.data?.app?.owner?.owner_id || null;
}

export async function fetchFeishuAppOwnerOpenId(options = {}) {
  const { execFileFn = execFileAsync } = options;

  let appId;
  try {
    const { stdout } = await execFileFn('lark-cli', ['auth', 'status'], { timeout: 10000 });
    const status = JSON.parse(stdout || '{}');
    appId = status.appId;
  } catch {
    return null;
  }

  if (!/^cli_[a-zA-Z0-9_]+$/.test(appId || '')) {
    return null;
  }

  try {
    const { stdout } = await execFileFn('lark-cli', [
      'api', 'GET',
      `/open-apis/application/v6/applications/${encodeURIComponent(appId)}`,
      '--params', '{"lang":"zh_cn"}',
    ], { timeout: 15000 });
    return parseFeishuOwnerOpenId(stdout);
  } catch {
    return null;
  }
}

export async function createDefaultFeishuChat(options = {}) {
  const {
    execFileFn = execFileAsync,
    chatName = DEFAULT_FEISHU_CHAT_NAME,
    ownerOpenId,
    fetchOwnerOpenIdFn = () => fetchFeishuAppOwnerOpenId({ execFileFn }),
  } = options;

  const inviteOpenId = ownerOpenId || await fetchOwnerOpenIdFn();
  if (!isSafeFeishuOpenId(inviteOpenId)) {
    throw new Error('无法确定飞书应用 owner，未创建默认群；请确认 lark-cli 已绑定可读取应用信息的飞书应用');
  }

  const { stdout } = await execFileFn('lark-cli', [
    'im', '+chat-create',
    '--name', chatName,
    '--chat-mode', 'group',
    '--type', 'private',
    '--users', inviteOpenId,
    '--format', 'json',
  ], { timeout: 15000 });

  const chatId = parseFeishuChatId(stdout);
  if (!chatId) {
    throw new Error('飞书群创建成功但未返回 chat_id');
  }

  return { chatId, chatName };
}

export async function resolveFeishuChat(options = {}) {
  const {
    chatId,
    env = process.env,
    settingsPath = getSettingsPath(),
    createChatFn,
    findChatFn,
    execFileFn = execFileAsync,
  } = options;

  if (chatId) {
    return { chatId, source: 'explicit' };
  }

  if (env.FEISHU_CHAT_ID) {
    return { chatId: env.FEISHU_CHAT_ID, source: 'env' };
  }

  const settings = await readSettings(settingsPath);
  if (settings.feishu?.chatId) {
    return {
      chatId: settings.feishu.chatId,
      chatName: settings.feishu.chatName,
      source: 'settings',
    };
  }

  const found = await (findChatFn || (() => findExistingFeishuChat({ execFileFn })))();
  if (found?.chatId) {
    const warning = await saveResolvedFeishuChat(settingsPath, found, 'found');
    return {
      chatId: found.chatId,
      chatName: found.chatName || DEFAULT_FEISHU_CHAT_NAME,
      source: 'found',
      warning,
    };
  }

  const created = await (createChatFn || (() => createDefaultFeishuChat({ execFileFn })))();
  const warning = await saveResolvedFeishuChat(settingsPath, created, 'auto-created');

  return {
    chatId: created.chatId,
    chatName: created.chatName || DEFAULT_FEISHU_CHAT_NAME,
    source: 'created',
    warning,
  };
}

/**
 * 发送客户画像摘要到飞书
 *
 * 通过 lark-cli 发送 markdown 消息到指定群聊
 */
export async function sendToFeishu(merged, analysis, options = {}) {
  const {
    chatId,
    htmlPath,
    htmlUrl = htmlPath ? buildReportPublicUrl(path.basename(htmlPath)) : null,
    env = process.env,
    settingsPath = getSettingsPath(),
    execFileFn = execFileAsync,
  } = options;

  const destination = await resolveFeishuChat({ chatId, env, settingsPath, execFileFn });

  const markdown = buildFeishuMarkdownCard(merged, analysis, { htmlUrl });
  const card = buildFeishuProfileCard(merged, analysis, { htmlUrl });
  let messageType = 'interactive';

  try {
    try {
      await execFileFn('lark-cli', [
        'im', '+messages-send',
        '--chat-id', destination.chatId,
        '--msg-type', 'interactive',
        '--content', JSON.stringify(card),
      ], { timeout: 15000 });
    } catch (err) {
      messageType = 'markdown';
      logger.warn(`飞书卡片发送失败，降级为 Markdown: ${err.message}`);
      await execFileFn('lark-cli', [
        'im', '+messages-send',
        '--chat-id', destination.chatId,
        '--markdown', markdown,
      ], { timeout: 15000 });
    }

    logger.info('飞书消息发送成功 ✓');

    // 如果有 HTML 文件，也发一份
    if (htmlPath) {
      try {
        await execFileFn('lark-cli', [
          'im', '+messages-send',
          '--chat-id', destination.chatId,
          '--file', htmlPath,
        ], { timeout: 30000 });
        logger.info('HTML 报告已发送到飞书 ✓');
      } catch (err) {
        logger.warn(`HTML 文件发送失败: ${err.message}`);
      }
    }

    return {
      ok: true,
      chatId: destination.chatId,
      chatName: destination.chatName,
      source: destination.source,
      messageType,
    };
  } catch (err) {
    logger.error(`飞书发送失败: ${err.message}`);
    throw err;
  }
}

/**
 * 发送已有报告到飞书，用于网页版“生成后补发”和未来飞书命令复用。
 */
export async function sendReportFileToFeishu(filename, options = {}) {
  const {
    chatId = process.env.FEISHU_CHAT_ID,
    outputDir = config.outputDir,
    sendFn = sendToFeishu,
  } = options;

  if (!/^[^/\\]+\.json$/.test(filename)) {
    throw new Error('非法报告文件名');
  }

  const jsonPath = path.join(outputDir, filename);
  const data = JSON.parse(await fs.readFile(jsonPath, 'utf-8'));
  const analysis = data.analysis || {};
  const htmlContent = generateHtml(data, analysis);
  await fs.mkdir(outputDir, { recursive: true });
  const htmlPath = path.join(outputDir, filename.replace('.json', '.html'));
  await fs.writeFile(htmlPath, htmlContent, 'utf-8');

  const htmlUrl = buildReportPublicUrl(path.basename(htmlPath));

  await sendFn(data, analysis, { chatId, htmlPath, htmlUrl });

  return {
    filename,
    htmlFilename: path.basename(htmlPath),
    htmlPath,
    htmlUrl,
    chatId,
  };
}

/**
 * 构建飞书 markdown 卡片内容
 */
export function buildFeishuMarkdownCard(merged, analysis, options = {}) {
  const { htmlUrl } = options;
  const { query, platforms = {} } = merged;
  const lines = [];

  // 标题
  lines.push(`**📋 客户画像：${query.name}**${query.company ? ` @ ${query.company}` : ''}`);
  lines.push('');

  const sourceSummary = buildFeishuSourceSummary(platforms);

  // 数据来源
  if (sourceSummary.included.length) {
    lines.push(`**数据来源**：${sourceSummary.included.join(' | ')}`);
    lines.push('');
  }

  if (sourceSummary.excluded.length) {
    lines.push('**数据可信度提示**');
    sourceSummary.excluded.slice(0, 4).forEach((item) => {
      lines.push(`- ${item}`);
    });
    lines.push('');
  }

  // 人物概览
  const u = merged.unified || {};
  if (u.name) {
    lines.push('**👤 人物**');
    if (u.headline) lines.push(`- 职位：${u.headline}`);
    if (u.location) lines.push(`- 地点：${u.location}`);
    if (u.about) {
      const about = u.about.length > 150 ? u.about.slice(0, 150) + '...' : u.about;
      lines.push(`- 简介：${about}`);
    }
    lines.push('');
  }

  // 公司信息
  const c = analysis.company;
  if (c?.name && c.name !== '未知') {
    lines.push('**🏢 公司**');
    if (c.mainProducts?.length) lines.push(`- 主营：${c.mainProducts.join('、')}`);
    if (c.scale) lines.push(`- 规模：${c.scale}`);
    if (c.targetMarket) lines.push(`- 市场：${c.targetMarket}`);
    if (c.competitors?.length) lines.push(`- 竞品：${c.competitors.join('、')}`);
    lines.push('');
  }

  // 商务切入点
  const s = analysis.salesInsights;
  if (s?.entryPoints?.length) {
    lines.push('**💡 切入点**');
    s.entryPoints.slice(0, 3).forEach((ep, i) => {
      lines.push(`${i + 1}. ${ep}`);
    });
    if (s.suggestedApproach) lines.push(`\n**建议**：${s.suggestedApproach}`);
    if (s.bestChannel) lines.push(`**渠道**：${s.bestChannel}`);
    lines.push('');
  }

  const angleLines = buildFeishuAnglesLines(query, analysis.analysisAngles, { limit: 2, textLimit: 180 });
  if (angleLines.length) {
    lines.push('**🔎 多角度分析**');
    lines.push(...angleLines);
    lines.push('');
  }

  // 链接
  const links = buildFeishuProfileLinks(platforms);
  if (links.length) {
    lines.push(`**🔗 链接**：${links.join(' | ')}`);
  }

  if (htmlUrl) {
    if (links.length) lines.push('');
    lines.push(`**📄 HTML 报告**：[点击打开](${htmlUrl})`);
  }

  return lines.join('\n');
}

export function buildFeishuProfileCard(merged, analysis, options = {}) {
  const { htmlUrl } = options;
  const { query, platforms = {}, unified = {} } = merged;
  const sourceSummary = buildFeishuSourceSummary(platforms);
  const links = buildFeishuProfileLinks(platforms);
  const cardTitle = `📋 客户画像：${query.name}${query.company ? ` @ ${query.company}` : ''}`;
  const elements = [];

  buildFeishuCardSections({
    query,
    unified,
    analysis,
    sourceSummary,
    links,
    htmlUrl,
  }).forEach((section, index) => {
    if (index > 0) elements.push({ tag: 'hr' });
    elements.push(markdownElement(section));
  });

  const actions = buildFeishuCardActions({ htmlUrl, links });
  if (actions.length) {
    elements.push({ tag: 'hr' });
    elements.push({
      tag: 'action',
      actions,
    });
  }

  return {
    config: {
      wide_screen_mode: true,
    },
    header: {
      title: {
        tag: 'plain_text',
        content: cardTitle,
      },
      template: sourceSummary.excluded.length ? 'orange' : 'blue',
    },
    elements,
  };
}

function buildFeishuCardSections({ query, unified, analysis, sourceSummary }) {
  unified = unified || {};
  analysis = analysis || {};
  const company = analysis.company || {};
  const person = analysis.person || {};
  const sales = analysis.salesInsights || {};
  const sections = [];

  if (sourceSummary.included.length) {
    sections.push(`**数据来源**：${sourceSummary.included.join(' ｜ ')}`);
  }

  const personLines = [
    ['职位', unified.headline || person.role],
    ['地点', unified.location],
  ].map(([label, value]) => compactBullet(label, value)).filter(Boolean);
  if (personLines.length) {
    sections.push(['**👤 人物**', ...personLines].join('\n'));
  }

  const contactLines = buildFeishuCompactContactLines(unified.contacts);
  if (contactLines.length) {
    sections.push(['**☎️ 公开联系方式**', ...contactLines].join('\n'));
  }

  const companyLines = [
    ['主营', company.mainProducts],
    ['规模', company.scale],
    ['市场', company.targetMarket],
    ['竞品', company.competitors],
  ].map(([label, value]) => compactBullet(label, value)).filter(Boolean);
  if (companyLines.length) {
    sections.push(['**🏢 公司**', ...companyLines].join('\n'));
  }

  if (sales.entryPoints?.length) {
    const lines = ['**💡 切入点**'];
    sales.entryPoints.slice(0, 3).forEach((item) => {
      lines.push(`- ${formatFeishuValue(stripLeadingListMarker(item), 240)}`);
    });
    sections.push(lines.join('\n'));
  }

  const adviceLines = [];
  if (sales.suggestedApproach) {
    adviceLines.push(`**建议**：${formatFeishuValue(sales.suggestedApproach, 360)}`);
  }
  if (sales.bestChannel) {
    adviceLines.push(`**渠道**：${formatFeishuValue(sales.bestChannel, 180)}`);
  }
  if (adviceLines.length) sections.push(adviceLines.join('\n'));

  const angleLines = buildFeishuAnglesLines(query, analysis.analysisAngles, { limit: 2, textLimit: 200 });
  if (angleLines.length) {
    sections.push(['**🔎 多角度分析**', ...angleLines].join('\n'));
  }

  if (!sections.length) {
    sections.push('**数据来源**：暂无可用来源');
  }

  return sections;
}

function buildFeishuCompactContactLines(contacts = {}) {
  contacts = contacts || {};
  if (contacts.sources?.length) {
    return contacts.sources.slice(0, 4).map((contact) => {
      const type = contact.type === 'email' ? '邮箱' : '电话';
      const scope = contact.scope === 'person' ? '个人' : '公司';
      const source = contact.sourceTitle || contact.sourceUrl || '公开资料';
      return `- **${type}**：${contact.value}（${scope}，${formatFeishuValue(source, 70)}）`;
    });
  }

  return [
    compactBullet('邮箱', contacts.verifiedEmails),
    compactBullet('电话', contacts.verifiedPhones),
  ].filter(Boolean);
}

function buildFeishuCompactWarnings(excluded = [], warnings = []) {
  const notes = [
    ...excluded,
    ...(warnings || []),
  ].filter(Boolean).slice(0, 3);
  if (!notes.length) return '';
  return [
    '**数据可信度提示**',
    ...notes.map((item) => `- ${formatFeishuValue(item, 180)}`),
  ].join('\n');
}

function buildFeishuAnglesLines(query = {}, angles = {}, options = {}) {
  if (query?.depth !== 'deep' || !angles) return [];

  const { limit = 2, textLimit = 180 } = options;
  const groups = [
    ['证据依据', angles.evidenceBasis],
    ['业务机会', angles.businessOpportunities],
    ['风险提醒', angles.riskNotes],
    ['下一步行动', angles.nextActions],
  ];

  return groups.flatMap(([label, values]) => {
    const items = normalizeFeishuList(values).slice(0, limit);
    if (!items.length) return [];
    return [
      `**${label}**`,
      ...items.map(item => `- ${formatFeishuValue(stripLeadingListMarker(item), textLimit)}`),
    ];
  });
}

function normalizeFeishuList(value) {
  if (Array.isArray(value)) {
    return value
      .map(item => {
        if (typeof item === 'string') return item.trim();
        if (typeof item === 'object' && item !== null) {
          return item.title || item.name || item.text || item.label || JSON.stringify(item);
        }
        return String(item ?? '').trim();
      })
      .filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}

function compactBullet(label, value) {
  const text = formatFeishuValue(value, 240);
  if (!text || text === '-') return '';
  return `- **${label}**：${text}`;
}

function stripLeadingListMarker(value) {
  return String(value || '').replace(/^\s*(?:[-*•·]|\d+\.|[a-zA-Z]\.)\s*/, '');
}

function buildFeishuHeroSection({ query, unified, analysis, sourceSummary }) {
  const name = unified.name || query.name || '目标人物';
  const companyName = analysis.company?.name || query.company;
  const headline = unified.headline || analysis.person?.role;
  const quickFacts = [
    headline && `**职位**：${formatFeishuValue(headline, 180)}`,
    unified.location && `**地点**：${formatFeishuValue(unified.location, 120)}`,
    analysis.person?.decisionLevel && `**决策层级**：${formatFeishuValue(analysis.person.decisionLevel, 80)}`,
    analysis.salesInsights?.bestChannel && `**最佳渠道**：${formatFeishuValue(analysis.salesInsights.bestChannel, 80)}`,
  ].filter(Boolean);

  return [
    `**${name}${companyName ? ` @ ${companyName}` : ''}**`,
    quickFacts.length ? quickFacts.join('\n') : '暂无足够人物概览信息',
    sourceSummary.included.length
      ? `**可用来源**：${sourceSummary.included.join(' ｜ ')}`
      : '',
  ].filter(Boolean).join('\n');
}

function buildFeishuOverviewSection(unified = {}) {
  unified = unified || {};
  const lines = ['**人物概览**'];
  const facts = [
    ['姓名', unified.name],
    ['职位', unified.headline],
    ['所在地', unified.location],
  ];
  appendFeishuRows(lines, facts);

  if (unified.about) {
    lines.push(`**简介**：${formatFeishuValue(unified.about, 260)}`);
  }

  const stats = buildFeishuSocialStats(unified.socialStats);
  if (stats.length) lines.push(`**社媒数据**：${stats.join(' ｜ ')}`);

  const activity = buildFeishuActivitySummary(unified.socialActivity);
  if (activity.length) {
    lines.push('**近期活跃**');
    activity.forEach((item) => lines.push(`- ${item}`));
  }

  if (unified.skills?.length) {
    lines.push(`**技能标签**：${formatFeishuValue(unified.skills, 220)}`);
  }

  return lines.length > 1 ? lines.join('\n') : '';
}

function buildFeishuCompanySection(company = {}) {
  company = company || {};
  const lines = ['**公司信息**'];
  appendFeishuRows(lines, [
    ['公司名', company.name],
    ['主营产品', company.mainProducts],
    ['公司规模', company.scale],
    ['销售渠道', company.salesChannels],
    ['目标市场', company.targetMarket],
    ['竞品', company.competitors],
    ['近期动态', company.recentNews],
  ]);

  return lines.length > 1 ? lines.join('\n') : '';
}

function buildFeishuPersonSection(person = {}) {
  person = person || {};
  const lines = ['**个人画像**'];
  appendFeishuRows(lines, [
    ['职位', person.role],
    ['决策层级', person.decisionLevel],
    ['专业领域', person.expertise],
    ['性格特征', person.personality],
    ['兴趣爱好', person.hobbies],
    ['沟通风格', person.communicationStyle],
    ['近期关注', person.recentConcerns],
  ]);

  return lines.length > 1 ? lines.join('\n') : '';
}

function buildFeishuSalesSection(sales = {}) {
  sales = sales || {};
  const lines = ['**商务切入点**'];
  if (sales.entryPoints?.length) {
    sales.entryPoints.slice(0, 6).forEach((item, index) => {
      lines.push(`${index + 1}. ${formatFeishuValue(item, 220)}`);
    });
  }

  appendFeishuRows(lines, [
    ['推荐沟通方式', sales.suggestedApproach],
    ['最佳渠道', sales.bestChannel],
    ['时机判断', sales.timing],
  ]);

  return lines.length > 1 ? lines.join('\n') : '';
}

function buildFeishuContactsSection(contacts = {}) {
  contacts = contacts || {};
  const lines = ['**公开联系方式**'];
  if (contacts.sources?.length) {
    contacts.sources.slice(0, 6).forEach((contact) => {
      const type = contact.type === 'email' ? '邮箱' : '电话';
      const scope = contact.scope === 'person' ? '个人' : '公司';
      const source = contact.sourceTitle || contact.sourceUrl || '公开资料';
      lines.push(`- ${type}：${contact.value}（${scope}，来源：${formatFeishuValue(source, 80)}）`);
    });
  } else {
    appendFeishuRows(lines, [
      ['邮箱', contacts.verifiedEmails],
      ['电话', contacts.verifiedPhones],
    ]);
  }

  return lines.length > 1 ? lines.join('\n') : '';
}

function buildFeishuSourcesSection(platforms = {}, companyResearch, warnings = []) {
  platforms = platforms || {};
  warnings = warnings || [];
  const lines = ['**数据来源明细**'];
  FEISHU_PLATFORM_ORDER.forEach((key) => {
    const section = buildFeishuPlatformDetail(key, platforms[key]);
    if (section) lines.push(section);
  });

  if (companyResearch) {
    const details = [
      companyResearch.linkedinUrl && `LinkedIn：${companyResearch.linkedinUrl}`,
      companyResearch.instagramUrl && `Instagram：${companyResearch.instagramUrl}`,
      companyResearch.facebookUrl && `Facebook：${companyResearch.facebookUrl}`,
      companyResearch.xUrl && `X：${companyResearch.xUrl}`,
      companyResearch.website && `官网：${companyResearch.website}`,
      companyResearch.news?.length && `新闻：${formatFeishuValue(companyResearch.news.map((item) => item.title || item.url), 220)}`,
    ].filter(Boolean);
    if (details.length) lines.push(`**公司维度补充**\n${details.map((item) => `- ${item}`).join('\n')}`);
  }

  if (warnings.length) {
    lines.push(`**系统提示**\n${warnings.slice(0, 5).map((item) => `- ${formatFeishuValue(item, 180)}`).join('\n')}`);
  }

  return lines.length > 1 ? lines.join('\n\n') : '';
}

const FEISHU_PLATFORM_LABELS = {
  linkedin: 'LinkedIn',
  instagram: 'Instagram',
  facebook: 'Facebook',
  x: 'X',
  companyInstagram: '公司 Instagram',
  companyFacebook: '公司 Facebook',
  companyX: '公司 X',
};

const FEISHU_PLATFORM_ORDER = [
  'linkedin',
  'instagram',
  'facebook',
  'x',
  'companyInstagram',
  'companyFacebook',
  'companyX',
];

function buildFeishuSourceSummary(platforms = {}) {
  platforms = platforms || {};
  const included = [];
  const excluded = [];

  FEISHU_PLATFORM_ORDER.forEach((key) => {
    const info = platforms[key];
    if (!info || info.found === false) return;

    const label = FEISHU_PLATFORM_LABELS[key] || key;
    if (info.excludedFromAnalysis) {
      const note = info.note || '匹配度不足，未纳入画像分析';
      excluded.push(`${label}：仅展示，${note}`);
      return;
    }

    included.push(`${label} ✅`);
  });

  return { included, excluded };
}

function buildFeishuProfileLinks(platforms = {}) {
  platforms = platforms || {};
  return FEISHU_PLATFORM_ORDER
    .map((key) => {
      const info = platforms[key];
      if (!info?.found || info.excludedFromAnalysis || !info.url) return null;
      const label = FEISHU_PLATFORM_LABELS[key] || key;
      return `[${label}](${info.url})`;
    })
    .filter(Boolean);
}

function appendFeishuRows(lines, rows) {
  rows.forEach(([label, value]) => {
    const text = formatFeishuValue(value, 260);
    if (text && text !== '-') lines.push(`**${label}**：${text}`);
  });
}

function buildFeishuSocialStats(stats = {}) {
  stats = stats || {};
  return [
    stats.instagramFollowers && `Instagram ${formatFeishuNumber(stats.instagramFollowers)} 粉丝`,
    stats.instagramPosts && `Instagram ${formatFeishuNumber(stats.instagramPosts)} 帖子`,
    stats.facebookLikes && `Facebook ${formatFeishuNumber(stats.facebookLikes)} 赞`,
    stats.facebookFollowers && `Facebook ${formatFeishuNumber(stats.facebookFollowers)} 粉丝`,
    stats.xFollowers && `X ${formatFeishuNumber(stats.xFollowers)} 粉丝`,
    stats.xFollowing && `X ${formatFeishuNumber(stats.xFollowing)} 关注`,
  ].filter(Boolean);
}

function buildFeishuActivitySummary(activity = {}) {
  activity = activity || {};
  const lines = [];
  if (activity.instagram) {
    const act = activity.instagram;
    const bits = [
      act.recentPostsCount && `近 ${act.recentPostsCount} 条帖子`,
      act.avgLikes !== undefined && `平均点赞 ${formatFeishuNumber(act.avgLikes)}`,
      act.avgComments !== undefined && `平均评论 ${formatFeishuNumber(act.avgComments)}`,
      act.latestPostDate && `最新 ${formatFeishuDate(act.latestPostDate)}`,
    ].filter(Boolean);
    if (bits.length) lines.push(`Instagram：${bits.join('，')}`);
  }

  if (activity.x) {
    const act = activity.x;
    const bits = [
      act.recentPostsCount && `近 ${act.recentPostsCount} 条公开帖子`,
      act.latestPostDate && `最新 ${formatFeishuDate(act.latestPostDate)}`,
    ].filter(Boolean);
    if (bits.length) lines.push(`X：${bits.join('，')}`);
  }

  return lines;
}

function buildFeishuPlatformDetail(key, info = {}) {
  info = info || {};
  if (!info?.found) return '';

  const label = FEISHU_PLATFORM_LABELS[key] || key;
  const profile = info.profile || {};
  const status = info.excludedFromAnalysis
    ? `仅展示，${info.note || '匹配度不足，未纳入画像分析'}`
    : '已纳入画像分析';
  const lines = [`**${label}**（${status}）`];

  if (info.url) lines.push(`- 主页：${info.url}`);
  appendPlatformProfileRows(lines, key, profile);

  if (info.isCompanyAccount && info.note) {
    lines.push(`- 提示：${formatFeishuValue(info.note, 180)}`);
  }
  if (info.excludedFromAnalysis && info.note) {
    lines.push(`- 匹配提示：${formatFeishuValue(info.note, 180)}`);
  }

  const posts = buildFeishuPostLines(key, profile);
  lines.push(...posts);

  return lines.join('\n');
}

function appendPlatformProfileRows(lines, key, profile) {
  profile = profile || {};
  const commonRows = [
    ['用户名', profile.username ? `@${profile.username}` : ''],
    ['显示名', profile.displayName || profile.fullName],
    ['简介', profile.bio || profile.headline],
    ['所在地', profile.location],
    ['粉丝数', presentNumber(profile.followersCount)],
    ['关注数', presentNumber(profile.followingCount)],
    ['帖子数', presentNumber(profile.postsCount)],
    ['赞数', presentNumber(profile.likesCount)],
    ['讨论数', presentNumber(profile.talkingCount)],
    ['外部链接', profile.externalUrl || profile.website],
  ];
  appendFeishuRows(lines, commonRows);

  if (profile.connections) lines.push(`- 人脉：${formatFeishuValue(profile.connections, 80)}`);
  if (profile.experience?.length) {
    lines.push('- 工作经历：');
    profile.experience.slice(0, 4).forEach((item) => {
      const role = item.title || '-';
      const company = item.company ? ` @ ${item.company}` : '';
      const duration = item.duration ? `（${item.duration}）` : '';
      lines.push(`  - ${formatFeishuValue(`${role}${company}${duration}`, 160)}`);
    });
  }
  if (profile.education?.length) {
    lines.push('- 教育背景：');
    profile.education.slice(0, 3).forEach((item) => {
      const school = item.school || '-';
      const degree = item.degree ? ` · ${item.degree}` : '';
      const duration = item.duration ? `（${item.duration}）` : '';
      lines.push(`  - ${formatFeishuValue(`${school}${degree}${duration}`, 160)}`);
    });
  }
  if (profile.skills?.length) {
    lines.push(`- 技能：${formatFeishuValue(profile.skills, 180)}`);
  }
  if (profile.isVerified) lines.push('- 认证：已认证');

  if (key === 'linkedin' && profile.about) {
    lines.push(`- 个人简介：${formatFeishuValue(profile.about, 220)}`);
  }
}

function buildFeishuPostLines(key, profile) {
  profile = profile || {};
  const recentPosts = profile.recentPosts || [];
  if (!recentPosts.length) return [];

  const isCompany = key.startsWith('company');
  const title = key === 'x' || key === 'companyX'
    ? isCompany ? '近期公开帖子/产品线索' : '近期公开帖子'
    : isCompany ? '最近帖子/产品线索' : '最近帖子';
  const limit = isCompany ? 5 : 3;
  const lines = [`- ${title}：`];

  recentPosts.slice(0, limit).forEach((post) => {
    const text = post.caption || post.text || '(无文字)';
    const stats = [
      post.likes !== null && post.likes !== undefined ? `赞 ${formatFeishuNumber(post.likes)}` : '',
      post.comments !== null && post.comments !== undefined ? `评 ${formatFeishuNumber(post.comments)}` : '',
      post.time || post.date || '',
    ].filter(Boolean);
    lines.push(`  - ${formatFeishuValue(text, 120)}${stats.length ? `（${stats.join('，')}）` : ''}`);
  });

  return lines;
}

function markdownElement(content) {
  return {
    tag: 'markdown',
    content,
  };
}

function buildFeishuCardActions({ htmlUrl, links }) {
  const actions = [];
  if (htmlUrl) actions.push(cardLinkButton('打开 HTML 报告', htmlUrl, 'primary'));

  links.slice(0, htmlUrl ? 5 : 6).forEach((link) => {
    const match = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(link);
    if (!match) return;
    actions.push(cardLinkButton(match[1], match[2]));
  });

  return actions;
}

function cardLinkButton(text, url, type = 'default') {
  return {
    tag: 'button',
    text: {
      tag: 'plain_text',
      content: text,
    },
    type,
    url,
  };
}

function formatFeishuValue(value, maxLength = 160) {
  const text = Array.isArray(value)
    ? value.map((item) => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object') return item.title || item.name || item.text || JSON.stringify(item);
      return String(item ?? '');
    }).filter(Boolean).join('、')
    : String(value || '');
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function presentNumber(value) {
  return value === null || value === undefined || value === '' ? '' : formatFeishuNumber(value);
}

function formatFeishuNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value.toLocaleString('zh-CN');
  }
  return String(value);
}

function formatFeishuDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('zh-CN');
}

function buildReportPublicUrl(filename) {
  const baseUrl = (process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
  return `${baseUrl}/output/${encodeURIComponent(filename)}`;
}

function getSettingsPath() {
  return path.join(config.outputDir, 'settings.json');
}

async function readSettings(settingsPath) {
  try {
    return JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
  } catch {
    return {};
  }
}

async function writeSettings(settingsPath, settings) {
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
}

async function saveResolvedFeishuChat(settingsPath, chat, source) {
  const settings = await readSettings(settingsPath);
  const nextSettings = {
    ...settings,
    feishu: {
      chatId: chat.chatId,
      chatName: chat.chatName || DEFAULT_FEISHU_CHAT_NAME,
      source,
      updatedAt: new Date().toISOString(),
    },
  };

  try {
    await writeSettings(settingsPath, nextSettings);
    return undefined;
  } catch (err) {
    const warning = `默认群保存失败: ${err.message}`;
    logger.warn(warning);
    return warning;
  }
}

function isSafeFeishuOpenId(value) {
  return typeof value === 'string' && /^ou_[a-zA-Z0-9_-]+$/.test(value);
}
