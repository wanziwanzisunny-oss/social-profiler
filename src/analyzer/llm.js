import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs/promises';
import path from 'path';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

/**
 * LLM 分析模块 — 调用 Claude API 生成客户画像
 */
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
