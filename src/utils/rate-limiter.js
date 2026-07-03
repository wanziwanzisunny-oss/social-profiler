import { config } from '../config.js';
import { logger } from './logger.js';

/**
 * 速率限制器（每平台独立，带随机抖动）
 *
 * 抖动策略：在 minIntervalMs 基础上加 0~jitterMs 的随机值
 * 避免固定间隔被识别为机器人节奏
 */
export class RateLimiter {
  constructor() {
    this.counts = {};
    this.lastCall = {};
  }

  /**
   * 检查是否超出限制，等待到可以操作
   */
  async wait(platform) {
    const limits = config.rateLimits[platform];
    if (!limits) return;

    const now = Date.now();
    const last = this.lastCall[platform] || 0;
    const elapsed = now - last;

    // 基础间隔 + 随机抖动
    const jitter = limits.jitterMs ? Math.random() * limits.jitterMs : 0;
    const interval = limits.minIntervalMs + jitter;

    if (elapsed < interval) {
      const waitMs = Math.round(interval - elapsed);
      logger.debug(`速率限制: 等待 ${waitMs}ms (${platform})`);
      await new Promise((r) => setTimeout(r, waitMs));
    }

    this.lastCall[platform] = Date.now();
    this.counts[platform] = (this.counts[platform] || 0) + 1;
  }

  /**
   * 获取今日已调用次数
   */
  getCount(platform) {
    return this.counts[platform] || 0;
  }
}

export const rateLimiter = new RateLimiter();
