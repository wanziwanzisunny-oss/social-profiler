import { randomDelay } from '../browser/humanize.js';
import { rateLimiter } from '../utils/rate-limiter.js';
import { logger } from '../utils/logger.js';
import { ScraperError } from '../utils/errors.js';

/**
 * 爬虫基类 — 统一接口和错误处理
 */
export class BaseScraper {
  constructor(platform, context) {
    this.platform = platform;
    this.context = context;
    this.page = null;
  }

  /**
   * 初始化页面
   */
  async init() {
    this.page = await this.context.newPage();
    return this;
  }

  /**
   * 导航到指定 URL（带速率限制和人类行为模拟）
   */
  async goto(url, options = {}) {
    await rateLimiter.wait(this.platform);
    logger.info(`正在访问: ${url}`);

    try {
      await this.page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
        ...options,
      });
      await randomDelay();
    } catch (err) {
      throw new ScraperError(this.platform, `页面加载失败: ${url}`, {
        cause: err,
        retryable: true,
      });
    }
  }

  /**
   * 带重试的操作
   */
  async withRetry(fn, maxRetries = 2) {
    let lastError;
    for (let i = 0; i <= maxRetries; i++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        if (i < maxRetries && (err.retryable || err.name === 'ScraperError')) {
          logger.warn(`重试 ${i + 1}/${maxRetries}: ${err.message}`);
          await randomDelay(3000, 8000);
        }
      }
    }
    throw lastError;
  }

  /**
   * 安全地提取文本
   */
  async textContent(selector) {
    try {
      const el = await this.page.$(selector);
      if (!el) return null;
      return (await el.textContent())?.trim() || null;
    } catch {
      return null;
    }
  }

  /**
   * 安全地提取多个元素的文本
   */
  async textContents(selector) {
    try {
      const elements = await this.page.$$(selector);
      const texts = await Promise.all(
        elements.map((el) => el.textContent().then((t) => t?.trim()))
      );
      return texts.filter(Boolean);
    } catch {
      return [];
    }
  }

  /**
   * 安全地获取属性
   */
  async getAttribute(selector, attr) {
    try {
      const el = await this.page.$(selector);
      if (!el) return null;
      return await el.getAttribute(attr);
    } catch {
      return null;
    }
  }

  /**
   * 关闭页面
   */
  async close() {
    if (this.page) {
      await this.page.close();
      this.page = null;
    }
  }

  /**
   * 子类需要实现的抓取方法
   */
  async scrape(/* url, options */) {
    throw new Error('子类需要实现 scrape 方法');
  }
}
