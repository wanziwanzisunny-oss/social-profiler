import { BaseScraper } from './base.js';
import { humanScroll, randomDelay, casualBrowse } from '../browser/humanize.js';
import { logger } from '../utils/logger.js';

/**
 * LinkedIn 主页爬虫 — 自适应等待 + meta fallback
 */
export class LinkedInScraper extends BaseScraper {
  constructor(context) {
    super('linkedin', context);
  }

  /**
   * 抓取 LinkedIn 主页（自动识别个人/公司页面）
   */
  async scrape(url, options = {}) {
    const { depth = 'quick', isCompany = false, cdpMode = false } = options;
    await this.init();

    try {
      const profileUrl = url.includes('/detail/') ? url : this._normalizeUrl(url);

      if (!cdpMode) {
        // Playwright 模式：需要预热，模拟真人行为
        logger.info('  LinkedIn 预热: 访问 feed...');
        await this.page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 15000 });
        await randomDelay(2000, 4000);
        await casualBrowse(this.page, 2000);
      }

      // 导航到目标 profile
      logger.info('  LinkedIn 访问 profile...');
      await this.goto(profileUrl);

      // 模拟真人浏览
      await casualBrowse(this.page, cdpMode ? 1000 : 2000);

      // 检查是否需要登录
      const needLogin = await this.page.$('.authwall, #join-our-network, form[action*="login"]');
      if (needLogin) {
        throw new Error('SESSION_EXPIRED');
      }
      // 额外检测：页面标题包含"登录"说明 session 过期
      const pageTitle = await this.page.title();
      if (pageTitle.includes('登录') || pageTitle.includes('登录或注册') || pageTitle.includes('Sign in')) {
        throw new Error('SESSION_EXPIRED');
      }

      // 等待核心内容渲染（替代固定延时）
      const loaded = await this._waitForContent();
      if (!loaded) {
        logger.warn('LinkedIn 页面内容未完全加载，尝试继续提取');
      }

      // 滚动加载更多内容
      await humanScroll(this.page);
      await this.page.waitForTimeout(1500);

      // 判断是公司页还是个人页
      const isCompanyPage = isCompany || url.includes('/company/');

      let profile;
      if (isCompanyPage) {
        profile = await this._extractCompanyInfo();
        // meta fallback
        const meta = await this._extractCompanyMeta();
        for (const [k, v] of Object.entries(meta)) {
          if (v && !profile[k]) profile[k] = v;
        }
      } else {
        // 多策略提取基础信息
        profile = await this._extractBasicInfo();

        // meta fallback 补充
        const meta = await this._extractFromMeta();
        for (const [k, v] of Object.entries(meta)) {
          if (v && !profile[k]) profile[k] = v;
        }

        // quick 只抓主页可见内容；deep 再进入 details 和动态页
        profile.experience = await this._extractExperience({ includeDetails: depth === 'deep' });
        profile.education = await this._extractEducation({ includeDetails: depth === 'deep' });
        profile.skills = await this._extractSkills({ includeDetails: depth === 'deep' });

        if (depth === 'deep') {
          profile.recentPosts = await this._extractRecentPosts(profileUrl);
        }
      }

      const found = isCompanyPage ? !!profile.companyName : !!profile.name;
      logger.info(`LinkedIn 抓取完成: ${profile.name || profile.companyName || profile.headline || '未知'}`);
      return { found, url: profileUrl, profile };
    } catch (err) {
      if (err.message === 'SESSION_EXPIRED') {
        logger.error('LinkedIn session 已过期，请重新登录: social-profiler session login linkedin');
        return { found: false, url, error: 'SESSION_EXPIRED' };
      }
      logger.error(`LinkedIn 抓取失败: ${err.message}`);
      return { found: false, url, error: err.message };
    } finally {
      await this.close();
    }
  }

  /**
   * 等待页面核心内容渲染
   */
  async _waitForContent() {
    const selectors = [
      'h1.text-heading-xlarge',           // 用户名
      'h1.break-words',                    // 用户名（旧版）
      '.pv-text-details__left-panel h1',   // 用户名（备选）
      '.pv-top-card',                      // 顶部卡片
      'section.pv-profile-section',        // 任何 profile section
      '.scaffold-finite-scroll',           // 主内容区
      '.pv-top-card-v2-ctas',              // 顶部操作区
      'div.pvs-header__title-container',   // section 标题
      'main h2',                           // 新版页面姓名标题
    ];

    try {
      await Promise.any(
        selectors.map(sel => this.page.waitForSelector(sel, { timeout: 15000 }))
      );
      return true;
    } catch {
      // 最后尝试：检查页面是否有任何 h1 元素（LinkedIn 可能改了 class）
      const hasH1 = await this.page.$('h1');
      if (hasH1) {
        logger.info('  LinkedIn: 找到 h1 元素（class 可能已变）');
        return true;
      }
      return false;
    }
  }

  /**
   * 从 meta 标签提取（保底）
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

      // og:title 格式: "Name - Title | LinkedIn"
      // 或 "Name | LinkedIn"
      const titleParts = ogTitle.split(' | ')[0].split(' - ');
      const name = titleParts[0]?.trim() || null;
      const headline = titleParts.length > 1 ? titleParts.slice(1).join(' - ').trim() : null;

      return {
        name: name && name !== 'LinkedIn' ? name : null,
        headline: headline && headline !== 'LinkedIn' ? headline : null,
        profilePhoto: ogImage || null,
        about: ogDesc && !ogDesc.includes('LinkedIn 上的') ? ogDesc : null,
      };
    });
  }

  _normalizeUrl(url) {
    if (url.includes('/in/')) {
      const match = url.match(/linkedin\.com\/in\/[^/?#]+/);
      if (match) return `https://www.${match[0]}`;
    }
    if (url.includes('/company/')) {
      const match = url.match(/linkedin\.com\/company\/[^/?#]+/);
      if (match) return `https://www.${match[0]}`;
    }
    return url;
  }

  /**
   * 在 LinkedIn 内部搜索人物，返回最匹配的 profile URL
   * ⚠️ 已禁用：LinkedIn 搜索页面会触发 hCaptcha，返回空结果
   *    保留代码供后续反检测改进后重新启用
   */
  static async searchPerson(context, name, company = '') {
    const page = await context.newPage();
    try {
      const searchQuery = company ? `${name} ${company}` : name;
      const searchUrl = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(searchQuery)}&origin=GLOBAL_SEARCH_HEADER`;

      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(3000);

      // 检查是否需要登录
      const needLogin = await page.$('.authwall, form[action*="login"]');
      if (needLogin) {
        logger.warn('LinkedIn 搜索需要登录');
        return null;
      }

      // 等待搜索结果加载
      try {
        await page.waitForSelector('.reusable-search__result-container, .search-results-container, .entity-result', { timeout: 8000 });
      } catch {
        logger.warn('LinkedIn 搜索结果未加载');
        return null;
      }

      // 提取搜索结果中的 profile 链接
      const nameLower = name.toLowerCase();
      const nameParts = nameLower.split(/\s+/).filter(w => w.length > 1);

      const results = await page.evaluate((nameParts) => {
        const items = document.querySelectorAll('.reusable-search__result-container .entity-result, .search-results-container li');
        const links = [];

        for (const item of items) {
          const linkEl = item.querySelector('a[href*="/in/"]');
          if (!linkEl) continue;

          const url = linkEl.href;
          const titleEl = item.querySelector('.entity-result__title-text a span[aria-hidden="true"], .actor-name');
          const title = titleEl?.textContent?.trim() || '';

          links.push({ url, title });
        }

        return links;
      }, nameParts);

      // 匹配名字
      for (const r of results) {
        const titleLower = r.title.toLowerCase();
        const urlLower = r.url.toLowerCase();
        if (nameParts.some(p => titleLower.includes(p) || urlLower.includes(p))) {
          logger.info(`LinkedIn 搜索找到: ${r.title} → ${r.url}`);
          return r.url;
        }
      }

      // 没有精确匹配，返回第一个结果
      if (results.length > 0) {
        logger.info(`LinkedIn 搜索无精确匹配，使用第一个: ${results[0].title} → ${results[0].url}`);
        return results[0].url;
      }

      return null;
    } catch (err) {
      logger.warn(`LinkedIn 搜索失败: ${err.message}`);
      return null;
    } finally {
      await page.close().catch(() => {});
    }
  }

  async _extractBasicInfo() {
    return await this.page.evaluate(() => {
      const getText = (sel) => {
        const el = document.querySelector(sel);
        return el?.textContent?.trim() || null;
      };

      const cleanText = (text) => text?.replace(/\s+/g, ' ').trim() || null;
      const titleName = cleanText(document.title?.split('|')[0]);
      const lines = (document.body?.innerText || '')
        .split('\n')
        .map(line => cleanText(line))
        .filter(Boolean);
      const ignoredLines = new Set([
        '更多', 'More',
        '关注', 'Follow',
        '加为好友', 'Connect',
        '发消息', 'Message',
        '联系方式', 'Contact info',
        '查看我的专栏', 'View my newsletter',
        '首页', 'Home',
        '人脉', 'My Network',
        '职位', 'Jobs',
        '消息', 'Messaging',
        '通知', 'Notifications',
      ]);

      const nextUsefulLine = (fromIndex) => {
        for (let i = fromIndex + 1; i < Math.min(lines.length, fromIndex + 12); i++) {
          const line = lines[i];
          if (!line || ignoredLines.has(line)) continue;
          if (line === titleName) continue;
          if (/^https?:\/\//i.test(line)) continue;
          if (/^\d+[,\d]*\s*(位)?(关注者|followers|connections)/i.test(line)) continue;
          return line;
        }
        return null;
      };

      const fallbackName = titleName && titleName !== 'LinkedIn' ? titleName : getText('main h2');
      const name = getText('h1.text-heading-xlarge, h1.break-words, .pv-text-details__left-panel h1')
        || fallbackName;

      let fallbackHeadline = null;
      if (name) {
        const nameIndex = lines.findIndex(line => line === name);
        if (nameIndex >= 0) fallbackHeadline = nextUsefulLine(nameIndex);
      }

      const headline = getText('.text-body-medium.break-words, .pv-text-details__left-panel .text-body-medium')
        || fallbackHeadline;

      let fallbackLocation = null;
      if (headline) {
        const headlineIndexes = lines
          .map((line, index) => (line === headline ? index : -1))
          .filter(index => index >= 0);
        for (const index of headlineIndexes) {
          const candidate = nextUsefulLine(index);
          if (candidate && candidate !== name && candidate !== headline && !candidate.includes('·')) {
            fallbackLocation = candidate;
            break;
          }
        }
      }

      return {
        name,
        headline,
        location: getText('.text-body-small.inline.t-black--light.break-words, .pv-text-details__left-panel .pb2.pv-text-details__left-panel .text-body-small') || fallbackLocation,
        about: getText('.pv-about-section .pv-about__summary-text, .display-flex.ph5.pv3 .inline-show-more-text'),
        connections: getText('.pv-top-card--list-bullet .t-black--light, .pv-top-card-v2-ctas .t-black--light'),
        profilePhoto: document.querySelector('.pv-top-card-profile-picture__image, .profile-photo-edit__preview')?.src || null,
      };
    });
  }

  async _extractExperience(options = {}) {
    try {
      const { includeDetails = false } = options;
      if (includeDetails) {
        const details = await this._extractExperienceFromDetails();
        if (details.length) return details;
      }

      const expandBtn = await this.page.$('#experience ~ div a[href*="full"], #experience ~ .pvs-list__footer-container a');
      if (expandBtn) {
        await expandBtn.click();
        await this.page.waitForTimeout(2000);
      }

      return await this.page.evaluate(() => {
        const expAnchor = document.querySelector('#experience');
        if (!expAnchor) return [];

        const section = expAnchor.closest('section') || expAnchor.parentElement?.parentElement;
        if (!section) return [];

        const items = section.querySelectorAll('li.artdeco-list__item, li');
        return Array.from(items).slice(0, 10).map((item) => {
          const getText = (sel) => {
            const el = item.querySelector(sel);
            return el?.textContent?.trim() || null;
          };

          const entity = item.querySelector('[data-view-name="profile-component-entity"]') || item;
          const links = entity.querySelectorAll('a');
          const mainLink = links.length > 0 ? links[links.length > 1 ? 1 : 0] : null;

          if (!mainLink) {
            return {
              title: getText('.t-bold span, .display-flex .t-bold span'),
              company: null,
              duration: getText('.pvs-entity__caption-wrapper'),
              location: null,
            };
          }

          const title = mainLink.querySelector('.display-flex .t-bold span, .t-bold span')?.textContent?.trim() || null;
          const company = mainLink.querySelector('.t-14.t-normal:not(.t-black--light) span')?.textContent?.trim() || null;
          const duration = mainLink.querySelector('.pvs-entity__caption-wrapper')?.textContent?.trim() || null;
          const locationEl = mainLink.querySelector('.t-14.t-normal.t-black--light:not(:has(.pvs-entity__caption-wrapper)) span');
          const location = locationEl?.textContent?.trim() || null;

          return { title, company, duration, location };
        }).filter((e) => e.title || e.company);
      });
    } catch {
      return [];
    }
  }

  async _extractEducation(options = {}) {
    try {
      const { includeDetails = false } = options;
      if (includeDetails) {
        const details = await this._extractEducationFromDetails();
        if (details.length) return details;
      }

      return await this.page.evaluate(() => {
        const eduAnchor = document.querySelector('#education');
        if (!eduAnchor) return [];

        const section = eduAnchor.closest('section') || eduAnchor.parentElement?.parentElement;
        if (!section) return [];

        const items = section.querySelectorAll('li.artdeco-list__item, li');
        return Array.from(items).slice(0, 5).map((item) => {
          const entity = item.querySelector('[data-view-name="profile-component-entity"]') || item;
          const links = entity.querySelectorAll('a');
          const mainLink = links.length > 0 ? links[links.length > 1 ? 1 : 0] : null;

          if (!mainLink) {
            const school = item.querySelector('.t-bold span')?.textContent?.trim() || null;
            return { school, degree: null, duration: null };
          }

          const school = mainLink.querySelector('.display-flex .t-bold span, .t-bold span')?.textContent?.trim() || null;
          const degree = mainLink.querySelector('.t-14.t-normal:not(.t-black--light) span')?.textContent?.trim() || null;
          const duration = mainLink.querySelector('.pvs-entity__caption-wrapper')?.textContent?.trim() || null;

          return { school, degree, duration };
        }).filter((e) => e.school);
      });
    } catch {
      return [];
    }
  }

  async _extractSkills(options = {}) {
    try {
      const { includeDetails = false } = options;
      if (includeDetails) {
        const details = await this._extractSkillsFromDetails();
        if (details.length) return details;
      }

      return await this.page.evaluate(() => {
        const skillsAnchor = document.querySelector('#skills');
        if (!skillsAnchor) return [];

        const section = skillsAnchor.closest('section') || skillsAnchor.parentElement?.parentElement;
        if (!section) return [];

        const items = section.querySelectorAll('li.artdeco-list__item, li');
        return Array.from(items).slice(0, 15).map((item) => {
          const el = item.querySelector('.t-bold span, .display-flex .t-bold span, .pvs-entity__summary-title');
          return el?.textContent?.trim();
        }).filter(Boolean);
      });
    } catch {
      return [];
    }
  }

  async _extractExperienceFromDetails() {
    try {
      await this.goto(this._detailsUrl('experience'));
      await this.page.waitForTimeout(2000);

      return await this.page.evaluate(() => {
        const lines = extractSectionLines(['工作经历', 'Experience']);
        const entries = [];
        let activeCompany = null;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const next = lines[i + 1];
          const afterNext = lines[i + 2];

          if (!line || isNoise(line) || isSkillLine(line)) continue;

          if (next && isCompanySummary(next)) {
            activeCompany = line;
            i += 1;
            continue;
          }

          if (next && isDurationLine(next)) {
            entries.push({
              title: line,
              company: activeCompany,
              duration: next,
              location: null,
            });
            i += 1;
            continue;
          }

          if (next && afterNext && isCompanyLine(next) && isDurationLine(afterNext)) {
            entries.push({
              title: line,
              company: next.split('·')[0].trim(),
              duration: afterNext,
              location: null,
            });
            i += 2;
          }
        }

        return entries.slice(0, 10);

        function extractSectionLines(headers) {
          const all = getCleanLines();
          const start = all.findIndex(line => headers.includes(line));
          if (start < 0) return [];
          const stopWords = ['关于', 'About', '无障碍模式', 'Accessibility'];
          const out = [];
          for (let i = start + 1; i < all.length; i++) {
            if (stopWords.includes(all[i])) break;
            out.push(all[i]);
          }
          return out;
        }

        function getCleanLines() {
          return (document.body?.innerText || '')
            .split('\n')
            .map(line => line.replace(/\s+/g, ' ').trim())
            .filter(Boolean);
        }

        function isNoise(line) {
          return ['更多', 'More', '关注', 'Follow', '发消息', 'Message', '全部', 'All'].includes(line)
            || line === '·';
        }

        function isSkillLine(line) {
          return /^(技能|Skills):/i.test(line);
        }

        function isDurationLine(line) {
          return /(\d{4}|现在|至今|Present)/i.test(line)
            && /(-|–|—|现在|至今|Present|\d{4})/i.test(line);
        }

        function isCompanyLine(line) {
          return line.includes('·') && !isDurationLine(line);
        }

        function isCompanySummary(line) {
          return !isDurationLine(line)
            && line.includes('·')
            && /(\d+|年|个月|yr|year|mo|month)/i.test(line);
        }
      });
    } catch {
      return [];
    }
  }

  async _extractEducationFromDetails() {
    try {
      await this.goto(this._detailsUrl('education'));
      await this.page.waitForTimeout(2000);

      return await this.page.evaluate(() => {
        const lines = extractSectionLines(['教育经历', '教育背景', 'Education']);
        const entries = [];

        for (let i = 0; i < lines.length; i++) {
          const school = lines[i];
          if (!school || isNoise(school)) continue;

          const next = lines[i + 1];
          const duration = lines[i + 2];
          const hasDegree = next && !isDurationLine(next) && !isLikelySchool(next);

          entries.push({
            school,
            degree: hasDegree ? next : null,
            duration: hasDegree && isDurationLine(duration) ? duration : (!hasDegree && isDurationLine(next) ? next : null),
          });

          if (hasDegree) i += 1;
          if (isDurationLine(lines[i + 1])) i += 1;
        }

        return entries.slice(0, 5);

        function extractSectionLines(headers) {
          const all = (document.body?.innerText || '')
            .split('\n')
            .map(line => line.replace(/\s+/g, ' ').trim())
            .filter(Boolean);
          const start = all.findIndex(line => headers.includes(line));
          if (start < 0) return [];
          const stopWords = ['关于', 'About', '无障碍模式', 'Accessibility'];
          const out = [];
          for (let i = start + 1; i < all.length; i++) {
            if (stopWords.includes(all[i])) break;
            out.push(all[i]);
          }
          return out;
        }

        function isNoise(line) {
          return ['更多', 'More', '关注', 'Follow', '发消息', 'Message'].includes(line);
        }

        function isDurationLine(line) {
          return /(\d{4}|现在|至今|Present)/i.test(line)
            && /(-|–|—|现在|至今|Present|\d{4})/i.test(line);
        }

        function isLikelySchool(line) {
          return /(University|College|School|学院|大学|中学|Institute)/i.test(line);
        }
      });
    } catch {
      return [];
    }
  }

  async _extractSkillsFromDetails() {
    try {
      await this.goto(this._detailsUrl('skills'));
      await this.page.waitForTimeout(2000);

      return await this.page.evaluate(() => {
        const lines = extractSectionLines(['技能', 'Skills']);
        const skills = [];
        const ignored = new Set(['全部', 'All', '行业知识', 'Industry Knowledge']);

        for (const line of lines) {
          if (!line || ignored.has(line)) continue;
          if (isNoise(line)) continue;
          if (/认可|endorsement|工作经历|experience|近 \d+|获得 \d+/i.test(line)) continue;
          skills.push(line);
        }

        return Array.from(new Set(skills)).slice(0, 15);

        function extractSectionLines(headers) {
          const all = (document.body?.innerText || '')
            .split('\n')
            .map(line => line.replace(/\s+/g, ' ').trim())
            .filter(Boolean);
          const start = all.findIndex(line => headers.includes(line));
          if (start < 0) return [];
          const stopWords = ['关于', 'About', '无障碍模式', 'Accessibility'];
          const out = [];
          for (let i = start + 1; i < all.length; i++) {
            if (stopWords.includes(all[i])) break;
            out.push(all[i]);
          }
          return out;
        }

        function isNoise(line) {
          return ['更多', 'More', '关注', 'Follow', '发消息', 'Message'].includes(line)
            || /^\d+\s*(次)?认可/.test(line);
        }
      });
    } catch {
      return [];
    }
  }

  _detailsUrl(section) {
    const base = this.page.url()
      .replace(/\/details\/[^/]+\/?$/, '')
      .replace(/\/recent-activity\/.*$/, '')
      .replace(/\/$/, '');
    return `${base}/details/${section}/`;
  }

  async _extractRecentPosts(profileUrl = this.page.url()) {
    try {
      const activityUrl = profileUrl.replace(/\/$/, '') + '/recent-activity/all/';
      await this.goto(activityUrl);

      // 等待动态内容加载
      try {
        await this.page.waitForSelector('.feed-shared-update-v2, .occludable-update', { timeout: 8000 });
      } catch {
        logger.warn('LinkedIn 动态内容未加载');
        return [];
      }

      await humanScroll(this.page);
      await this.page.waitForTimeout(1500);

      return await this.page.evaluate(() => {
        const posts = document.querySelectorAll('.feed-shared-update-v2, .occludable-update');
        return Array.from(posts).slice(0, 5).map((post) => {
          const getText = (sel) => {
            const el = post.querySelector(sel);
            return el?.textContent?.trim() || null;
          };

          return {
            text: getText('.feed-shared-update-v2__description, .feed-shared-text'),
            date: getText('.feed-shared-actor__sub-description span, .update-components-actor__sub-description'),
            likes: getText('.social-details-social-counts__reactions-count, .social-counts-social-counts__count-value'),
          };
        }).filter((p) => p.text);
      });
    } catch {
      return [];
    }
  }

  // ==================== 公司主页提取 ====================

  /**
   * 从 LinkedIn 公司主页提取信息
   */
  async _extractCompanyInfo() {
    return await this.page.evaluate(() => {
      const getText = (sel) => {
        const el = document.querySelector(sel);
        return el?.textContent?.trim() || null;
      };

      // 从 dt/dd 列表中按关键词查找值
      const findByLabel = (keyword) => {
        const dts = document.querySelectorAll('dt, .dt-text, [class*="definition"]');
        for (const dt of dts) {
          if (dt.textContent?.includes(keyword)) {
            // 找相邻的 dd
            const dd = dt.nextElementSibling;
            if (dd && dd.tagName === 'DD') return dd.textContent?.trim() || null;
            // 或者找同级的下一个元素
            const next = dt.parentElement?.querySelector('dd');
            if (next) return next.textContent?.trim() || null;
          }
        }
        return null;
      };

      return {
        companyName: getText('h1, .org-top-card-summary__title, .top-card-layout__title'),
        tagline: getText('.org-top-card-summary__tagline, .top-card-layout__second-subline'),
        industry: getText('.org-top-card-summary__industry, .top-card-layout__industry'),
        about: getText('.org-about-us-organization-description__text, .about-us-section p'),
        website: document.querySelector('.org-about-us-organization-description a[href*="http"]')?.href || null,
        companySize: findByLabel('员工'),
        headquarters: findByLabel('总部'),
        specialties: getText('.org-about-us-organization-specialties p'),
      };
    });
  }

  /**
   * 从 meta 标签提取公司信息
   */
  async _extractCompanyMeta() {
    return await this.page.evaluate(() => {
      const getMeta = (name) => {
        const el = document.querySelector(`meta[property="${name}"], meta[name="${name}"]`);
        return el?.content || null;
      };

      const ogTitle = getMeta('og:title') || '';
      const ogDesc = getMeta('og:description') || '';
      const ogImage = getMeta('og:image') || '';

      return {
        companyName: ogTitle.replace(' | LinkedIn', '').trim() || null,
        about: ogDesc || null,
        logo: ogImage || null,
      };
    });
  }
}
