import { BaseScraper } from './base.js';
import { randomDelay, casualBrowse } from '../browser/humanize.js';
import { logger } from '../utils/logger.js';

/**
 * Facebook 公共主页爬虫 — 无需登录
 *
 * Facebook 对未登录用户限制较严，数据来源优先级：
 * 1. API 拦截（如果有公开 API 响应）
 * 2. DOM 可见内容（登录弹窗下方仍部分可见）
 * 3. meta 标签（保底：名称、简介、粉丝数、头像）
 */
export class FacebookScraper extends BaseScraper {
  constructor(context) {
    super('facebook', context);
    this._apiData = null;
  }

  /**
   * 抓取 Facebook 公共主页
   */
  async scrape(url, options = {}) {
    const { depth = 'quick' } = options;
    await this.init();

    try {
      const pageUrl = this._normalizeUrl(url);
      const pageName = this._extractPageName(pageUrl);

      // 拦截 API 响应
      this._apiData = null;
      this.page.on('response', (resp) => this._interceptAPI(resp));

      await this.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

      // 导航预热
      await casualBrowse(this.page, 1500);
      await randomDelay(500, 1500);

      // 关闭登录弹窗
      await this._dismissLoginWall();

      // 等待内容加载
      await this.page.waitForTimeout(2000);

      // 多策略提取（meta 保底，逐层补充非空字段）
      let profile = {};

      // 策略1：meta 标签（保底，字段最干净）
      const metaProfile = await this._extractFromMeta();
      profile = { ...metaProfile };

      // 策略2：DOM 可见内容（只补充 meta 没拿到的字段）
      const domProfile = await this._extractFromDOM();
      if (domProfile) {
        for (const [k, v] of Object.entries(domProfile)) {
          if (v && !profile[k]) profile[k] = v;
        }
      }

      // 策略3：API 拦截（最高优先级，覆盖所有）
      if (this._apiData) {
        logger.info('使用 API 拦截数据');
        for (const [k, v] of Object.entries(this._apiData)) {
          if (v) profile[k] = v;
        }
      }

      // 提取可见帖子
      if (depth !== 'quick' || !profile.postsCount) {
        profile.recentPosts = await this._extractVisiblePosts(
          depth === 'deep' ? 10 : 5
        );
      }

      // 清理空值
      Object.keys(profile).forEach((k) => {
        if (profile[k] === null || profile[k] === undefined) delete profile[k];
      });

      const found = !!(profile.username || profile.fullName);
      logger.info(`Facebook 抓取完成: ${profile.fullName || profile.username || pageName}`);

      return {
        found,
        url: pageUrl,
        profile: profile || { username: pageName, note: '仅获取到基础信息' },
      };
    } catch (err) {
      logger.error(`Facebook 抓取失败: ${err.message}`);
      return { found: false, url, error: err.message };
    } finally {
      await this.close();
    }
  }

  /**
   * 拦截公开 API 响应
   */
  async _interceptAPI(response) {
    try {
      const url = response.url();
      if (response.status() !== 200) return;

      const contentType = response.headers()['content-type'] || '';
      if (!contentType.includes('json')) return;

      // Facebook 页面信息 API
      if (url.includes('/page/header_data/') || url.includes('/api/graphql')) {
        const body = await response.json().catch(() => null);
        if (body) {
          this._apiData = this._parseAPIResponse(body);
          logger.info('Facebook API 数据拦截成功');
        }
      }
    } catch {
      // 静默忽略
    }
  }

  /**
   * 解析 API 响应（格式不固定，尽力提取）
   */
  _parseAPIResponse(body) {
    const data = {};
    if (typeof body !== 'object' || !body) return data;

    // 递归查找常见字段
    const findField = (obj, keys, maxDepth = 4) => {
      if (maxDepth <= 0 || !obj || typeof obj !== 'object') return undefined;
      for (const key of keys) {
        if (obj[key] !== undefined) return obj[key];
      }
      for (const val of Object.values(obj)) {
        const found = findField(val, keys, maxDepth - 1);
        if (found !== undefined) return found;
      }
      return undefined;
    };

    data.username = findField(body, ['username', 'vanity', 'page_id']);
    data.fullName = findField(body, ['name', 'page_name', 'title']);
    data.followersCount = findField(body, ['fan_count', 'followers_count', 'followers']);
    data.likesCount = findField(body, ['page_likes', 'likes_count', 'likes']);
    data.bio = findField(body, ['about', 'bio', 'description', 'category_title']);
    data.avatar = findField(body, ['profile_pic', 'profilePictureUri', 'page_profile_photo']);

    return data;
  }

  /**
   * 关闭 Facebook 登录弹窗
   */
  async _dismissLoginWall() {
    try {
      // Facebook 登录弹窗通常是一个模态框
      const closeBtn = await this.page.$(
        '[aria-label="关闭"], [aria-label="Close"], ' +
        'div[role="dialog"] [aria-label="Close"], ' +
        'div[role="dialog"] button[data-testid="cookie-policy-manage-dialog-decline-button"]'
      );
      if (closeBtn) {
        await closeBtn.click();
        await this.page.waitForTimeout(1000);
        logger.info('已关闭 Facebook 弹窗');
        return;
      }

      // 按 Escape
      await this.page.keyboard.press('Escape');
      await this.page.waitForTimeout(800);

      // 移除遮罩层
      await this.page.evaluate(() => {
        // 移除登录弹窗
        document.querySelectorAll('[role="dialog"]').forEach(el => el.remove());
        // 移除固定定位的遮罩
        document.querySelectorAll('div[role="progressbar"], div[class*="overlay"]').forEach(el => {
          if (el.style.position === 'fixed') el.remove();
        });
        // 恢复滚动
        document.body.style.overflow = '';
        document.documentElement.style.overflow = '';
      });
    } catch (err) {
      logger.debug(`关闭弹窗: ${err.message}`);
    }
  }

  /**
   * 从 DOM 提取可见内容
   */
  async _extractFromDOM() {
    try {
      return await this.page.evaluate(() => {
        const body = document.body;
        if (!body) return null;

        const getText = (sel) => document.querySelector(sel)?.textContent?.trim() || null;
        const getAttr = (sel, attr) => document.querySelector(sel)?.getAttribute(attr) || null;

        // 页面标题区域通常有页面名称
        let pageName =
          getText('h1') ||
          getText('[data-testid="page_header_title"]') ||
          getText('strong > a');
        // 清理验证标记
        if (pageName) {
          pageName = pageName
            .replace(/[\s 　]*已认证账户[\s 　]*/g, '')
            .replace(/[\s 　]*[Vv]erified[\s 　]*/g, '')
            .trim();
        }

        // 粉丝数 — 从页面文本中匹配
        const bodyText = body.innerText || '';
        const followersMatch = bodyText.match(/([\d,.]+[万亿]?)\s*(位粉丝|people.*follow|followers|likes)/i) ||
          bodyText.match(/([\d,.]+[万亿]?)\s*次赞/);
        const followersCount = followersMatch ? followersMatch[1] : null;

        // 简介
        const about =
          getText('[data-testid="page_about_section"]') ||
          getText('div[class*="about"]') ||
          null;

        // 分类
        const category = getText('a[href*="/categories/"]');

        return {
          fullName: pageName,
          followersCount,
          about,
          category,
        };
      });
    } catch {
      return null;
    }
  }

  /**
   * 从 meta 标签提取（保底方案）
   */
  async _extractFromMeta() {
    return await this.page.evaluate(() => {
      const getMeta = (name) => {
        const el = document.querySelector(
          `meta[property="${name}"], meta[name="${name}"]`
        );
        return el?.content || null;
      };

      const ogTitle = getMeta('og:title') || '';
      const ogDesc = getMeta('og:description') || '';
      const ogImage = getMeta('og:image') || '';
      const ogUrl = getMeta('og:url') || '';

      // og:description 格式: "Name. 123,456 次赞 · 789 人在谈论. Description"
      const likesMatch = ogDesc.match(/([\d,.]+)\s*(次赞|likes)/i);
      const talkingMatch = ogDesc.match(/([\d,.]+)\s*(人在谈论|people.*talking)/i);
      const followersMatch = ogDesc.match(/([\d,.]+)\s*(位粉丝|followers)/i);

      // 从 og:description 提取简介（去掉统计数据，只保留真正的描述）
      let bio = null;
      // 找到第二个句号后的内容（第一个句号前是页面名，第二个前是统计数据）
      const parts = ogDesc.split('. ');
      if (parts.length >= 3) {
        // 跳过 "Name" 和统计数据，取后面的部分
        bio = parts.slice(2).join('. ').trim();
      } else if (parts.length === 2) {
        // 第二部分可能就是简介
        const second = parts[1].trim();
        if (!/^\d/.test(second)) bio = second;
      }

      // og:title 清理：去掉 "已认证账户" / "Verified" 等后缀
      let fullName = ogTitle
        .replace(/[\s 　]+已认证账户[\s 　]*$/, '')
        .replace(/[\s 　]+[Vv]erified[\s 　]*$/, '')
        .trim() || null;

      // 从 og:url 提取页面名
      const urlMatch = ogUrl.match(/facebook\.com\/([\w.]+)\/?/);
      const username = urlMatch ? urlMatch[1] : null;

      return {
        username,
        fullName,
        bio: bio || null,
        avatar: ogImage || null,
        likesCount: likesMatch ? likesMatch[1] : null,
        followersCount: followersMatch ? followersMatch[1] : null,
        talkingCount: talkingMatch ? talkingMatch[1] : null,
        source: 'meta',
      };
    });
  }

  /**
   * 提取页面上可见的帖子
   */
  async _extractVisiblePosts(limit = 5) {
    try {
      // 先滚动一下加载更多内容
      await this.page.evaluate(() => window.scrollBy(0, 800));
      await this.page.waitForTimeout(2000);

      return await this.page.evaluate((maxPosts) => {
        const posts = [];

        // 策略1: role="article" 容器
        const articles = document.querySelectorAll('[role="article"]');
        for (const el of articles) {
          if (posts.length >= maxPosts) break;

          // 查找帖子文本
          const textEl = el.querySelector(
            '[data-ad-preview="message"], [data-testid="post_message"], ' +
            'div[dir="auto"]:not([class*="comment"]), span[dir="auto"]'
          );
          const text = textEl?.innerText?.trim() || null;

          // 查找时间
          const timeEl = el.querySelector('a[href*="/posts/"], a[href*="permalink"], abbr, span[id*="jsc"]');
          const time = timeEl?.getAttribute('title') || timeEl?.textContent?.trim() || null;

          // 查找链接
          const link = el.querySelector(
            'a[href*="/posts/"], a[href*="/permalink/"], a[href*="story_fbid"]'
          )?.href || null;

          if (text && text.length > 20) {
            posts.push({ text: text.slice(0, 500), time, url: link });
          }
        }

        // 策略2: 如果 article 没结果，从页面正文找帖子片段
        if (posts.length === 0) {
          const bodyText = document.body?.innerText || '';
          // 匹配日期格式后的文字（Facebook 帖子通常前面有日期）
          const datePattern = /(\d{4}年\d{1,2}月\d{1,2}日[·\s]?\d{1,2}:\d{2}|\d+ hours? ago|\d+ 小时前)\s*([\s\S]{20,300}?)(?=\d{4}年|hours? ago|小时|$)/g;
          let match;
          while ((match = datePattern.exec(bodyText)) !== null && posts.length < maxPosts) {
            posts.push({
              time: match[1].trim(),
              text: match[2].trim().slice(0, 500),
              url: null,
            });
          }
        }

        return posts;
      }, limit);
    } catch {
      return [];
    }
  }

  _normalizeUrl(url) {
    if (!url.startsWith('https://')) url = 'https://' + url;
    if (!url.includes('facebook.com')) url = 'https://www.facebook.com/' + url;
    return url;
  }

  _extractPageName(url) {
    const match = url.match(/facebook\.com\/([\w.]+)\/?/);
    return match ? match[1] : 'unknown';
  }
}
