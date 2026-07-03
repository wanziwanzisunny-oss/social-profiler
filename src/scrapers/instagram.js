import { BaseScraper } from './base.js';
import { humanScroll, randomDelay, casualBrowse } from '../browser/humanize.js';
import { logger } from '../utils/logger.js';

/**
 * Instagram 主页爬虫 — 多策略抓取
 *
 * 数据来源优先级：
 * 1. GraphQL API 拦截（最完整、最可靠）
 * 2. React DOM 渲染内容（需要成功加载 SPA）
 * 3. meta 标签 / 页面源码（保底，基础信息）
 */
export class InstagramScraper extends BaseScraper {
  constructor(context) {
    super('instagram', context);
    this._graphqlData = null;
  }

  /**
   * 抓取 Instagram 个人主页
   */
  async scrape(url, options = {}) {
    const { depth = 'quick' } = options;
    await this.init();

    try {
      const profileUrl = this._normalizeUrl(url);
      const username = this._extractUsername(profileUrl);

      // 拦截 GraphQL API 响应（最可靠的数据源）
      this._graphqlData = null;
      this.page.on('response', (resp) => this._interceptGraphQL(resp, username));

      await this.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

      // 导航预热 + 等待页面稳定
      await casualBrowse(this.page, 1200);
      await randomDelay(800, 2000);

      // 关闭登录/注册弹窗
      await this._dismissLoginWall();

      // 尝试等待 React 内容渲染
      const reactLoaded = await this._waitForReactContent();

      if (reactLoaded) {
        // 模拟滚动加载更多内容
        await humanScroll(this.page);
        await this.page.waitForTimeout(1500);
      }

      // 多策略提取
      let profile;

      // 策略1：GraphQL 拦截到的数据（最完整）
      if (this._graphqlData?.user) {
        logger.info('使用 GraphQL API 数据');
        profile = this._parseGraphQLProfile(this._graphqlData.user);
      }
      // 策略2：React DOM 渲染内容
      else if (reactLoaded) {
        logger.info('使用 React DOM 渲染数据');
        profile = await this._extractFromDOM();
      }
      // 策略3：meta 标签 fallback
      else {
        logger.info('React 未渲染，使用 meta 标签 fallback');
        profile = await this._extractFromMeta();
      }

      // 提取帖子
      if (profile) {
        if (this._graphqlData?.user?.edge_owner_to_timeline_media?.edges?.length) {
          profile.recentPosts = this._parseGraphQLPosts(
            this._graphqlData.user.edge_owner_to_timeline_media.edges,
            depth === 'deep' ? 12 : 6
          );
        } else if (reactLoaded) {
          profile.recentPosts = await this._extractPostsFromDOM(depth === 'deep' ? 12 : 6);
        } else {
          profile.recentPosts = [];
        }
      }

      // 诊断：截图保存（调试用）
      if (!profile?.username) {
        const debugPath = `${process.cwd()}/output/debug-ig-${username}.png`;
        await this.page.screenshot({ path: debugPath, fullPage: false });
        logger.warn(`数据提取不完整，已截图到 ${debugPath}`);
      }

      logger.info(`Instagram 抓取完成: ${profile?.username || username}`);
      return {
        found: !!profile?.username,
        url: profileUrl,
        profile: profile || { username, note: '仅获取到基础信息' },
      };
    } catch (err) {
      logger.error(`Instagram 抓取失败: ${err.message}`);
      return { found: false, url, error: err.message };
    } finally {
      await this.close();
    }
  }

  /**
   * 拦截 GraphQL API 响应
   */
  async _interceptGraphQL(response, username) {
    try {
      const url = response.url();
      if (!url.includes('/graphql/query') && !url.includes('/api/v1/users/')) return;

      const status = response.status();
      if (status !== 200) return;

      const contentType = response.headers()['content-type'] || '';
      if (!contentType.includes('json')) return;

      const body = await response.json().catch(() => null);
      if (!body) return;

      // Instagram GraphQL 用户信息响应（只接受有完整 user 数据的响应）
      if (body?.data?.user?.username) {
        // 不覆盖已有的完整数据（防止后续 stories/highlights 响应覆盖）
        if (!this._graphqlData?.user?.username) {
          this._graphqlData = body.data;
          logger.info(`GraphQL 拦截成功: ${username}`);
        }
      }
      // API v1 格式
      else if (body?.user?.username) {
        if (!this._graphqlData?.user?.username) {
          this._graphqlData = { user: body.user };
          logger.info(`API v1 拦截成功: ${username}`);
        }
      }
    } catch {
      // 静默忽略解析错误
    }
  }

  /**
   * 解析 GraphQL 用户数据
   */
  _parseGraphQLProfile(user) {
    const counts = user.edge_owner_to_timeline_media?.count ??
      user.edge_felix_video_timeline?.count ?? 0;

    return {
      username: user.username || null,
      fullName: user.full_name || null,
      bio: user.biography || null,
      avatar: user.profile_pic_url_hd || user.profile_pic_url || null,
      postsCount: counts,
      followersCount: user.edge_followed_by?.count ?? null,
      followingCount: user.edge_follow?.count ?? null,
      isPrivate: user.is_private ?? false,
      isVerified: user.is_verified ?? false,
      externalUrl: user.external_url || null,
      userId: user.id || null,
    };
  }

  /**
   * 解析 GraphQL 帖子数据
   */
  _parseGraphQLPosts(edges, limit) {
    return edges.slice(0, limit).map((edge) => {
      const node = edge.node;
      return {
        url: `https://www.instagram.com/p/${node.shortcode}/`,
        type: node.is_video ? 'video' : (node.__typename === 'GraphSidecar' ? 'carousel' : 'photo'),
        caption: node.edge_media_to_caption?.edges?.[0]?.node?.text?.slice(0, 200) || null,
        likes: node.edge_media_preview_like?.count ?? null,
        comments: node.edge_media_to_comment?.count ?? null,
        timestamp: node.taken_at_timestamp
          ? new Date(node.taken_at_timestamp * 1000).toISOString()
          : null,
        thumbnail: node.thumbnail_src || null,
      };
    });
  }

  /**
   * 等待 React 内容渲染（自适应等待，不是硬延时）
   */
  async _waitForReactContent() {
    // Instagram React 渲染完成后会出现以下元素之一
    const selectors = [
      'header section',                        // 个人资料区域
      'main article',                          // 帖子区域
      'header span[class*="x193iq5w"]',        // 用户名
      'div[role="presentation"] a[href*="/"]', // 头像链接
    ];

    try {
      // 并行等待任意一个选择器出现
      const result = await Promise.any(
        selectors.map((sel) =>
          this.page.waitForSelector(sel, { timeout: 8000 }).then(() => sel)
        )
      );
      logger.info(`React 内容已渲染: ${result}`);
      return true;
    } catch {
      logger.warn('React 内容未在 8s 内渲染');
      return false;
    }
  }

  /**
   * 关闭 Instagram 登录/注册弹窗（增强版）
   */
  async _dismissLoginWall() {
    try {
      // 等一下让弹窗出现
      await this.page.waitForTimeout(1500);

      // 策略1：点击弹窗的 × 关闭按钮
      const closeBtn = await this.page.$(
        '[role="dialog"] button[aria-label="Close"], ' +
        '[role="dialog"] svg[aria-label="Close"], ' +
        '[role="dialog"] button[aria-label="关闭"]'
      );
      if (closeBtn) {
        await closeBtn.click();
        await this.page.waitForTimeout(1000);
        logger.info('已关闭登录弹窗 (Close button)');
        return;
      }

      // 策略2：Not now / 稍后再说
      const notNowBtn = await this.page.$(
        '[role="dialog"] a:has-text("Not now"), ' +
        '[role="dialog"] button:has-text("Not now"), ' +
        '[role="dialog"] a:has-text("不登录"), ' +
        '[role="dialog"] button:has-text("不登录"), ' +
        '[role="dialog"] button:has-text("稍后"), ' +
        '[role="dialog"] a:has-text("稍后")'
      );
      if (notNowBtn) {
        await notNowBtn.click();
        await this.page.waitForTimeout(1000);
        logger.info('已关闭登录弹窗 (Not now)');
        return;
      }

      // 策略3：按 Escape 关闭
      await this.page.keyboard.press('Escape');
      await this.page.waitForTimeout(1000);

      // 策略4：如果弹窗还在，点击外部区域
      const stillHasDialog = await this.page.$('[role="dialog"]');
      if (stillHasDialog) {
        // 点击页面空白区域
        await this.page.mouse.click(10, 10);
        await this.page.waitForTimeout(800);

        // 最后手段：直接移除弹窗 DOM
        const dialogGone = await this.page.$('[role="dialog"]');
        if (dialogGone) {
          await this.page.evaluate(() => {
            document.querySelectorAll('[role="dialog"]').forEach(el => el.remove());
            // 同时移除可能的遮罩层
            document.querySelectorAll('[role="presentation"]').forEach(el => {
              if (el.style.position === 'fixed') el.remove();
            });
            // 恢复 body 滚动
            document.body.style.overflow = '';
          });
          logger.info('已移除登录弹窗 (DOM removal)');
        }
      }
    } catch (err) {
      logger.debug(`关闭弹窗: ${err.message}`);
    }
  }

  /**
   * 从 React DOM 提取个人资料
   */
  async _extractFromDOM() {
    return await this.page.evaluate(() => {
      const header = document.querySelector('header');
      if (!header) return null;

      const getText = (sel) => {
        const el = header.querySelector(sel);
        return el?.textContent?.trim() || null;
      };

      const spans = Array.from(header.querySelectorAll('span'));
      const spanTexts = spans.map(s => s.textContent?.trim()).filter(Boolean);

      let username = null, fullName = null, bio = null;
      let postsCount = null, followersCount = null, followingCount = null;

      // 解析统计数据
      for (const span of spans) {
        const text = span.textContent?.trim();
        if (!text) continue;

        // 匹配 "123帖子" / "123 posts"
        const postsMatch = text.match(/^([\d,.]+[万亿]?)\s*(帖子|posts)$/i);
        if (postsMatch) { postsCount = postsMatch[1]; continue; }

        const followersMatch = text.match(/^([\d,.]+[万亿]?)\s*(粉丝|followers)$/i);
        if (followersMatch) { followersCount = followersMatch[1]; continue; }

        const followingMatch = text.match(/^([\d,.]+[万亿]?)\s*(关注|following)$/i);
        if (followingMatch) { followingCount = followingMatch[1]; continue; }
      }

      // 用户名：通常在 header 的链接中
      const usernameEl = header.querySelector('a[href*="/"] span') ||
        header.querySelector('header > section span');
      if (usernameEl) {
        const text = usernameEl.textContent?.trim();
        // 排除统计数据
        if (text && !/^\d/.test(text)) username = text;
      }

      // 全名：通常在用户名下方
      const allSpans = Array.from(header.querySelectorAll('section span'));
      for (const span of allSpans) {
        const text = span.textContent?.trim();
        if (!text) continue;
        if (text === username) continue;
        if (/^\d/.test(text)) continue; // 跳过统计
        if (['帖子', 'posts', '粉丝', 'followers', '关注', 'following'].includes(text)) continue;
        // 如果不包含数字开头且不是已知标签，可能是全名
        if (!fullName && text.length < 100) {
          fullName = text;
        }
      }

      // Bio
      const bioEl = header.querySelector('span[class*="_ap3a"]') ||
        header.querySelector('div[class*="_ap3a"]');
      if (bioEl) bio = bioEl.textContent?.trim();

      // 头像
      const avatar = header.querySelector('img')?.src || null;

      // 外部链接
      const linkEl = header.querySelector('a[href*="l.instagram.com"], a[href^="http"]:not([href*="instagram.com"])');
      const externalUrl = linkEl?.href || null;

      return {
        username,
        fullName,
        bio,
        avatar,
        postsCount,
        followersCount,
        followingCount,
        externalUrl,
      };
    });
  }

  /**
   * 从 meta 标签提取（React 没渲染时的保底方案）
   */
  async _extractFromMeta() {
    const meta = await this.page.evaluate(() => {
      const getMeta = (name) => {
        const el = document.querySelector(
          `meta[property="${name}"], meta[name="${name}"]`
        );
        return el?.content || null;
      };

      // og:title 通常是 "用户名 (@username)" 或 "Full Name (@username) | Instagram"
      const ogTitle = getMeta('og:title') || '';
      const ogDescription = getMeta('og:description') || '';
      const ogImage = getMeta('og:image') || '';
      const ogUrl = getMeta('og:url') || '';

      // 从 og:title 解析用户名
      // 格式: "Name (@username)" 或 "Name (@username) • Instagram"
      const usernameMatch = ogTitle.match(/@(\w[\w.]*)/);
      const username = usernameMatch ? usernameMatch[1] : null;

      // 从 description 解析统计
      // 格式: "123 Followers, 456 Following, 789 Posts"
      const followersMatch = ogDescription.match(/([\d,.]+[万亿]?)\s*[Ff]ollowers?/);
      const followingMatch = ogDescription.match(/([\d,.]+[万亿]?)\s*[Ff]ollowing/);
      const postsMatch = ogDescription.match(/([\d,.]+[万亿]?)\s*[Pp]osts?/);

      // 中文格式
      const followersMatchCn = ogDescription.match(/([\d,.]+[万亿]?)\s*粉丝/);
      const followingMatchCn = ogDescription.match(/([\d,.]+[万亿]?)\s*关注/);
      const postsMatchCn = ogDescription.match(/([\d,.]+[万亿]?)\s*帖子/);

      // 提取全名（og:title 中 @username 之前的部分）
      let fullName = null;
      if (username) {
        const namePart = ogTitle.split('(')[0]?.trim();
        if (namePart && namePart !== username) fullName = namePart;
      }

      return {
        username,
        fullName,
        bio: ogDescription !== 'See Instagram photos and videos' ? ogDescription : null,
        avatar: ogImage,
        postsCount: postsMatch?.[1] || postsMatchCn?.[1] || null,
        followersCount: followersMatch?.[1] || followersMatchCn?.[1] || null,
        followingCount: followingMatch?.[1] || followingMatchCn?.[1] || null,
        source: 'meta',
      };
    });

    return meta;
  }

  /**
   * 从 DOM 提取帖子
   */
  async _extractPostsFromDOM(limit = 6) {
    try {
      return await this.page.evaluate((maxPosts) => {
        const links = document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]');
        const posts = [];
        const seen = new Set();

        for (const link of links) {
          if (posts.length >= maxPosts) break;
          const href = link.href;
          if (seen.has(href)) continue;
          seen.add(href);

          const img = link.querySelector('img');
          const isReel = href.includes('/reel/');

          posts.push({
            url: href,
            type: isReel ? 'reel' : 'photo',
            alt: img?.alt || null,
            thumbnail: img?.src || null,
          });
        }

        return posts;
      }, limit);
    } catch {
      return [];
    }
  }

  _normalizeUrl(url) {
    if (!url.endsWith('/')) url += '/';
    if (!url.startsWith('https://')) url = 'https://' + url;
    return url;
  }

  _extractUsername(url) {
    // 从 URL 提取用户名: https://www.instagram.com/username/
    const match = url.match(/instagram\.com\/([\w.]+)\/?/);
    return match ? match[1] : 'unknown';
  }
}
