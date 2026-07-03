import { BaseScraper } from './base.js';
import { humanScroll, randomDelay, casualBrowse } from '../browser/humanize.js';
import { logger } from '../utils/logger.js';

/**
 * X 公共主页爬虫 — 仅采集公开可见数据
 */
export class XScraper extends BaseScraper {
  constructor(context) {
    super('x', context);
  }

  async scrape(url, options = {}) {
    const { depth = 'quick' } = options;
    await this.init();

    try {
      const profileUrl = this._normalizeUrl(url);
      await this.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await casualBrowse(this.page, 1200);
      await randomDelay(800, 1800);

      if (await this._isBlockedOrLoginWall()) {
        return { found: false, url: profileUrl, error: 'X_LOGIN_OR_BLOCKED' };
      }

      await humanScroll(this.page);
      await this.page.waitForTimeout(1200);

      const meta = await this._extractFromMeta();
      const dom = await this._extractFromDOM();
      const posts = await this._extractPosts(depth === 'deep' ? 15 : 5);
      const profile = { ...meta, ...dom, recentPosts: posts };

      Object.keys(profile).forEach((key) => {
        if (profile[key] === null || profile[key] === undefined || profile[key] === '') {
          delete profile[key];
        }
      });

      const found = !!(profile.username || profile.displayName || profile.bio);
      logger.info(`X 抓取完成: ${profile.displayName || profile.username || profileUrl}`);

      return { found, url: profileUrl, profile };
    } catch (err) {
      logger.warn(`X 抓取失败: ${err.message}`);
      return { found: false, url, error: err.message };
    } finally {
      await this.close();
    }
  }

  _normalizeUrl(url) {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    if (!['x.com', 'twitter.com'].includes(host)) throw new Error('不是有效的 X 主页');

    const handle = parsed.pathname.split('/').filter(Boolean)[0];
    if (!handle || !/^[a-z0-9_]{1,15}$/i.test(handle)) throw new Error('不是有效的 X 主页');

    const blocked = new Set([
      'home',
      'login',
      'explore',
      'search',
      'notifications',
      'messages',
      'settings',
      'share',
      'intent',
      'hashtag',
      'i',
    ]);
    if (blocked.has(handle.toLowerCase())) throw new Error('不是有效的 X 主页');

    return `https://x.com/${handle}`;
  }

  async _isBlockedOrLoginWall() {
    const title = await this.page.title().catch(() => '');
    if (/login|sign in|log in|登录/i.test(title)) return true;
    return !!(await this.page.$('input[name="text"], a[href="/login"], [data-testid="loginButton"]').catch(() => null));
  }

  async _extractFromMeta() {
    return await this.page.evaluate(() => {
      const getMeta = (name) => document.querySelector(`meta[property="${name}"], meta[name="${name}"]`)?.content || null;
      const title = getMeta('og:title') || document.title || '';
      const desc = getMeta('og:description') || null;
      const image = getMeta('og:image') || null;
      const displayName = title
        .replace(/\s*\(@[^)]+\)\s*\/\s*X.*/i, '')
        .replace(/\s*on X.*/i, '')
        .trim() || null;
      const usernameMatch = title.match(/\(@([A-Za-z0-9_]{1,15})\)/);

      return {
        displayName,
        username: usernameMatch?.[1] || null,
        bio: desc,
        avatar: image,
      };
    });
  }

  async _extractFromDOM() {
    return await this.page.evaluate(() => {
      const text = document.body?.innerText || '';
      const getText = (sel) => document.querySelector(sel)?.textContent?.trim() || null;
      const displayName = getText('[data-testid="UserName"] span') || getText('h1') || null;
      const usernameText = text.match(/@([A-Za-z0-9_]{1,15})/)?.[1] || null;
      const bio = getText('[data-testid="UserDescription"]') || null;
      const location = getText('[data-testid="UserLocation"]') || null;
      const website = document.querySelector('[data-testid="UserUrl"] a')?.href || null;
      const followersText = Array.from(document.querySelectorAll('a[href$="/verified_followers"], a[href$="/followers"], a[href*="/followers"]'))
        .map(a => a.textContent || '')
        .find(t => /followers|粉丝/i.test(t)) || '';
      const followingText = Array.from(document.querySelectorAll('a[href$="/following"], a[href*="/following"]'))
        .map(a => a.textContent || '')
        .find(t => /following|正在关注|关注/i.test(t)) || '';

      return {
        displayName,
        username: usernameText,
        bio,
        location,
        website,
        followersText,
        followingText,
      };
    }).then(data => ({
      displayName: data.displayName,
      username: data.username,
      bio: data.bio,
      location: data.location,
      website: data.website,
      followersCount: this._parseCount(data.followersText),
      followingCount: this._parseCount(data.followingText),
    }));
  }

  async _extractPosts(limit) {
    return await this.page.evaluate((postLimit) => {
      return Array.from(document.querySelectorAll('article[data-testid="tweet"]'))
        .slice(0, postLimit)
        .map((article) => {
          const text = article.querySelector('[data-testid="tweetText"]')?.textContent?.trim() || '';
          const link = Array.from(article.querySelectorAll('a[href*="/status/"]')).map(a => a.href)[0] || null;
          const time = article.querySelector('time')?.getAttribute('datetime') || null;
          return text ? { text: text.slice(0, 500), url: link, timestamp: time, metrics: {} } : null;
        })
        .filter(Boolean);
    }, limit);
  }

  _parseCount(value) {
    if (!value) return null;
    const raw = String(value).replace(/,/g, '').trim();
    const match = raw.match(/([\d.]+)\s*([KMB万亿]?)/i);
    if (!match) return null;

    const num = Number(match[1]);
    if (Number.isNaN(num)) return null;

    const unit = match[2].toLowerCase();
    if (unit === 'k') return Math.round(num * 1000);
    if (unit === 'm') return Math.round(num * 1000000);
    if (unit === 'b') return Math.round(num * 1000000000);
    if (unit === '万') return Math.round(num * 10000);
    if (unit === '亿') return Math.round(num * 100000000);
    return Math.round(num);
  }
}
