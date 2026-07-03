import { BaseScraper } from './base.js';
import { humanScroll, randomDelay, casualBrowse } from '../browser/humanize.js';
import { logger } from '../utils/logger.js';
import { extractContactsFromText, mergeContacts } from '../utils/contacts.js';

/**
 * Google 搜索爬虫
 *
 * 防验证码策略：
 * 1. 搜索间隔递增节流
 * 2. 触发验证码 → 等 15 秒自动重试一次
 * 3. 公司搜索顺序执行（不并行）
 */
export class GoogleScraper extends BaseScraper {
  constructor(context) {
    super('google', context);
    this._searchCount = 0;
  }

  /**
   * 搜索目标人物，返回各平台 URL
   */
  async scrape(name, company = '') {
    await this.init();

    const query = company ? `${name} ${company}` : name;

    try {
      const results = await this._searchGoogle(query, true);

      if (!results) {
        throw new Error('Google 搜索受限，请等待几分钟后再试');
      }

      const socialLinks = this._extractSocialLinks(results, name, company);
      logger.info(`Google 搜索完成，找到 ${results.length} 条结果`);

      return { query, results, socialLinks };
    } finally {
      await this.close();
    }
  }

  /**
   * Google 搜索（带验证码检测 + 重试）
   * @param {string} query - 搜索词
   * @param {boolean} canRetry - 是否允许重试
   */
  async _searchGoogle(query, canRetry = true) {
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=zh-CN`;

    try {
      // 确保页面可用
      if (!this.page || this.page.isClosed()) {
        await this.init();
      }

      await this._throttle();
      await this.goto(searchUrl);

      // 再次检查页面（goto 可能失败后页面被关闭）
      if (!this.page || this.page.isClosed()) {
        throw new Error('页面已关闭');
      }

      // 验证码检测
      const hasCaptcha = await this.page.$(
        '#captcha-form, [id*="recaptcha"], [src*="recaptcha"], iframe[src*="recaptcha"]'
      );

      if (hasCaptcha) {
        if (canRetry) {
          logger.warn('Google 触发验证码，等待 15 秒后重试...');
          await new Promise(r => setTimeout(r, 15000));
          return this._searchGoogle(query, false); // 重试一次
        }
        logger.warn('Google 验证码重试仍失败');
        return null;
      }

      // 模拟人类浏览：随机滚动 + 鼠标移动
      await casualBrowse(this.page, 1500);
      await humanScroll(this.page);
      await randomDelay(800, 2000);

      const results = await this._extractResults();

      if (results.length === 0 && canRetry) {
        logger.warn('Google 无结果，等待重试...');
        await new Promise(r => setTimeout(r, 10000));
        return this._searchGoogle(query, false);
      }

      return results.length > 0 ? results : null;
    } catch (err) {
      if (canRetry) {
        logger.warn(`Google 搜索失败，重试: ${err.message}`);
        // 重试前重新初始化页面
        await this.close().catch(() => {});
        await new Promise(r => setTimeout(r, 10000));
        return this._searchGoogle(query, false);
      }
      logger.warn(`Google 搜索最终失败: ${err.message}`);
      return null;
    }
  }

  /**
   * 搜索节流 — 防止触发验证码
   * 基础间隔 + 随机抖动 + 递增退避
   */
  async _throttle() {
    this._searchCount++;
    // 第1次无延迟，之后递增：5s, 7s, 9s, 11s... + 随机抖动 0~5s
    if (this._searchCount > 1) {
      const base = Math.min(5000 + (this._searchCount - 2) * 2000, 15000);
      const jitter = Math.random() * 5000;
      const delay = Math.round(base + jitter);
      logger.info(`  等待 ${(delay / 1000).toFixed(1)}s...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  /**
   * 提取搜索结果
   */
  async _extractResults() {
    return await this.page.evaluate(() => {
      const items = document.querySelectorAll('div.tF2Cxc, div.g');
      return Array.from(items).slice(0, 10).map((item) => {
        const linkEl = item.querySelector('.yuRUbf a[href], a[href]');
        const titleEl = item.querySelector('h3');
        const snippetEl = item.querySelector('.VwiC3b, .IsZvec, [data-sncf], [data-snf]');

        return {
          title: titleEl?.textContent?.trim() || '',
          url: linkEl?.href || '',
          snippet: snippetEl?.textContent?.trim() || '',
        };
      }).filter((r) => r.url);
    });
  }

  /**
   * 从搜索结果中提取社交媒体链接
   */
  _extractSocialLinks(results, name, company = '') {
    const socialLinks = {
      linkedin: null,
      facebook: null,
      instagram: null,
      x: null,
    };

    const best = { linkedin: null, facebook: null, instagram: null, x: null };

    for (const result of results) {
      const url = result.url.toLowerCase();
      const candidate = _scoreSocialResult(result, name, company);

      if (url.includes('linkedin.com/in/') && candidate.isNameMatch && candidate.score >= 6) {
        if (!best.linkedin || candidate.score > best.linkedin.score) best.linkedin = { ...candidate, url: result.url };
      }
      if (url.includes('facebook.com/') && _isProfileUrl(result.url, 'facebook') && candidate.isNameMatch && candidate.score >= 6) {
        if (!best.facebook || candidate.score > best.facebook.score) best.facebook = { ...candidate, url: result.url };
      }
      if (url.includes('instagram.com/') && _isProfileUrl(result.url, 'instagram') && candidate.isNameMatch && candidate.score >= 6) {
        if (!best.instagram || candidate.score > best.instagram.score) best.instagram = { ...candidate, url: result.url };
      }
      if (_isXProfileUrl(result.url) && candidate.isNameMatch && candidate.score >= 6) {
        if (!best.x || candidate.score > best.x.score) best.x = { ...candidate, url: _normalizeXUrl(result.url) };
      }
    }

    if (best.linkedin) socialLinks.linkedin = best.linkedin.url;
    if (best.facebook) socialLinks.facebook = best.facebook.url;
    if (best.instagram) socialLinks.instagram = best.instagram.url;
    if (best.x) socialLinks.x = best.x.url;

    return socialLinks;
  }

  /**
   * 专门搜索某个平台的主页
   */
  async searchPlatform(name, company, platform) {
    await this.init();

    const siteQueries = {
      linkedin: `site:linkedin.com/in/ "${name}"${company ? ` "${company}"` : ''}`,
      facebook: `site:facebook.com "${name}"${company ? ` "${company}"` : ''}`,
      instagram: `site:instagram.com "${name}"`,
      x: `site:x.com OR site:twitter.com "${name}"${company ? ` "${company}"` : ''}`,
    };

    const query = siteQueries[platform];
    if (!query) throw new Error(`不支持的平台: ${platform}`);

    const results = await this._searchGoogle(query, true);
    if (!results) return null;

    try {
      const candidates = results
        .filter((r) => platform === 'x'
          ? _isXProfileUrl(r.url)
          : r.url.toLowerCase().includes(`${platform}.com`))
        .filter((r) => {
          if (platform === 'x') return true;
          return platform === 'linkedin' ? r.url.toLowerCase().includes('/in/') : _isProfileUrl(r.url, platform);
        })
        .filter((r) => platform !== 'linkedin' || !company || _isCompanyMatch(r, company))
        .map((r) => ({ ...r, match: _scoreSocialResult(r, name, company) }))
        .filter((r) => r.match.isNameMatch && r.match.score >= 6)
        .map((r) => ({ ...r, matchScore: r.match.score }))
        .sort((a, b) => b.matchScore - a.matchScore);

      return candidates[0] ? (platform === 'x' ? _normalizeXUrl(candidates[0].url) : candidates[0].url) : null;
    } finally {
      await this.close();
    }
  }

  /**
   * 公司维度搜索（直接搜公司名，从结果中提取各平台链接）
   */
  async searchCompany(company) {
    await this.init();

    const result = {
      companyLinkedinUrl: null,
      companyInstagramUrl: null,
      companyFacebookUrl: null,
      companyXUrl: null,
      companyWebsite: null,
      news: [],
      newsArticles: [],
      jobs: [],
      businessResults: [],
      publicContacts: [],
      results: [],
      searches: [],
    };

    try {
      // 公司研究和个人社交匹配分开：这里多轮搜公司材料，不要求匹配人名。
      const searches = _buildCompanySearches(company);
      const collected = [];
      for (const search of searches) {
        const results = await this._searchGoogle(search.query, true);
        const tagged = (results || []).map(r => ({
          ...r,
          query: search.query,
          queryType: search.type,
        }));
        result.searches.push({
          type: search.type,
          query: search.query,
          count: tagged.length,
        });
        collected.push(...tagged);
      }
      result.results = _dedupeResults(collected);

      for (const r of result.results) {
        const url = r.url.toLowerCase();

        // LinkedIn 公司页
        if (!result.companyLinkedinUrl && url.includes('linkedin.com/company/') && _isCompanyMatch(r, company)) {
          result.companyLinkedinUrl = r.url;
        }
        // Instagram
        if (!result.companyInstagramUrl && url.includes('instagram.com')
          && !url.includes('/p/') && !url.includes('/reel/') && !url.includes('/stories/')) {
          if (_isCompanyMatch(r, company)) result.companyInstagramUrl = r.url;
        }
        // Facebook
        if (!result.companyFacebookUrl && url.includes('facebook.com')
          && !url.includes('/privacy/') && !url.includes('/login')
          && !url.includes('/policies/') && !url.includes('/events/')
          && !url.includes('/groups/') && !url.includes('/marketplace/')) {
          if (_isCompanyMatch(r, company)) result.companyFacebookUrl = r.url;
        }
        // X / Twitter
        if (!result.companyXUrl && _isXProfileUrl(r.url) && _isCompanyMatch(r, company)) {
          result.companyXUrl = _normalizeXUrl(r.url);
        }
        // 官网（第一个非社交媒体链接）
        if (!result.companyWebsite && _isLikelyCompanyWebsite(r, company)) {
          result.companyWebsite = r.url;
        }
      }

      // 新闻
      result.newsArticles = result.results
        .filter(r => r.queryType === 'news' || _isNewsResult(r, company))
        .filter(r => !_isSocialOrDirectoryUrl(r.url))
        .slice(0, 6)
        .map(r => ({ title: r.title, url: r.url, snippet: r.snippet }));
      result.news = result.newsArticles;

      // 招聘/岗位信息：用于推断业务方向
      result.jobs = result.results
        .filter(r => r.queryType === 'jobs' || _isJobResult(r))
        .slice(0, 6)
        .map(r => ({ title: r.title, url: r.url, snippet: r.snippet }));

      // 业务介绍/产品方向：给 LLM 推断主营业务和目标市场
      result.businessResults = result.results
        .filter(r => r.queryType === 'business' || r.queryType === 'official')
        .filter(r => !_isSocialOrDirectoryUrl(r.url))
        .filter(r => _isCompanyMatch(r, company) || (result.companyWebsite && _normalizeResultUrl(r.url) === _normalizeResultUrl(result.companyWebsite)))
        .slice(0, 8)
        .map(r => ({ title: r.title, url: r.url, snippet: r.snippet }));

      result.publicContacts = mergeContacts(
        result.results.flatMap(r => extractContactsFromText(`${r.title || ''}\n${r.snippet || ''}\n${r.url || ''}`, {
          url: r.url,
          title: r.title,
          scope: 'company',
          allowPhones: false,
        })),
        result.companyWebsite ? await this._scrapeCompanyContactPages(result.companyWebsite) : []
      );

      return result;
    } finally {
      await this.close();
    }
  }

  async _scrapeCompanyContactPages(companyWebsite) {
    const urls = _buildContactPageUrls(companyWebsite);
    const contacts = [];

    for (const url of urls) {
      try {
        if (!this.page || this.page.isClosed()) await this.init();
        await this.goto(url, { waitUntil: 'domcontentloaded', timeout: 12000 });
        await this.page.waitForLoadState?.('domcontentloaded', { timeout: 8000 }).catch(() => {});

        const pageData = await this.page.evaluate(() => {
          const text = document.body?.innerText || '';
          const title = document.title || '';
          const links = Array.from(document.querySelectorAll('a[href]')).slice(0, 80).map(a => ({
            href: a.href,
            text: a.textContent?.trim() || '',
          }));
          return { title, text, links };
        });

        contacts.push(...extractContactsFromText(pageData.text, {
          url,
          title: pageData.title,
          scope: 'company',
        }));
        contacts.push(...pageData.links.flatMap(link => extractContactsFromText(`${link.text}\n${link.href}`, {
          url: link.href,
          title: pageData.title,
          scope: 'company',
        })));
      } catch (err) {
        logger.info(`  联系方式页面跳过: ${url} (${err.message})`);
      }
    }

    return mergeContacts(contacts);
  }
}

function _buildContactPageUrls(companyWebsite) {
  try {
    const base = new URL(companyWebsite);
    const origin = base.origin;
    const paths = ['/', '/contact', '/contact-us', '/about', '/about-us', '/team', '/leadership'];
    return [...new Set(paths.map(p => new URL(p, origin).toString()))];
  } catch {
    return [];
  }
}

function _buildCompanySearches(company) {
  return [
    { type: 'official', query: `"${company}" official website` },
    { type: 'company', query: `"${company}" company` },
    { type: 'linkedin', query: `site:linkedin.com/company "${company}"` },
    { type: 'x', query: `site:x.com OR site:twitter.com "${company}"` },
    { type: 'news', query: `"${company}" news OR press OR announcement` },
    { type: 'jobs', query: `"${company}" careers OR jobs OR hiring` },
    { type: 'business', query: `"${company}" products OR services OR about` },
  ];
}

function _dedupeResults(results) {
  const seen = new Set();
  const deduped = [];
  for (const result of results) {
    const key = _normalizeResultUrl(result.url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(result);
  }
  return deduped;
}

function _normalizeResultUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    u.search = '';
    return u.toString().replace(/\/$/, '').toLowerCase();
  } catch {
    return url?.toLowerCase() || '';
  }
}

function _scoreSocialResult(result, name, company = '') {
  const nameParts = _tokens(name);
  const companyParts = _tokens(company);
  const haystack = `${result.title || ''} ${result.url || ''} ${result.snippet || ''}`.toLowerCase();
  let score = 0;

  const matchedNameParts = nameParts.filter(part => haystack.includes(part));
  score += matchedNameParts.length * 3;
  const hasAllNameParts = nameParts.length > 0 && matchedNameParts.length === nameParts.length;
  if (hasAllNameParts) score += 4;

  const compactName = nameParts.join('');
  const compactHaystack = haystack.replace(/[^a-z0-9]/g, '');
  const hasCompactName = compactName && compactHaystack.includes(compactName);
  if (hasCompactName) score += 4;

  const matchedCompanyParts = companyParts.filter(part => haystack.includes(part));
  score += Math.min(matchedCompanyParts.length * 2, 4);

  if (/(official|global|corp|company|sierra|leone|homepage|customer care|newspage)/i.test(result.title || '')) {
    score -= 3;
  }

  const isNameMatch = nameParts.length > 0 && (
    nameParts.length === 1
      ? matchedNameParts.length === 1
      : hasAllNameParts || hasCompactName || matchedNameParts.length >= 2
  );

  return { score, matchedNameParts, matchedCompanyParts, isNameMatch };
}

function _tokens(text = '') {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s._-]/gu, ' ')
    .split(/[\s._-]+/)
    .map(t => t.trim())
    .filter(t => t.length > 1);
}

function _isProfileUrl(url, platform) {
  try {
    const u = new URL(url);
    const path = u.pathname.toLowerCase();
    if (platform === 'instagram') {
      return /^\/[^/]+\/?$/.test(path)
        && !/^\/(p|reel|stories|explore|accounts|about|developer)\//.test(path);
    }
    if (platform === 'facebook') {
      return ![
        '/pages/', '/privacy/', '/login', '/help/', '/policies/', '/events/',
        '/groups/', '/marketplace/', '/watch/', '/gaming/', '/videos/',
        '/posts/', '/photo', '/permalink/', '/story_fbid'
      ].some(blocked => path.includes(blocked));
    }
    return true;
  } catch {
    return false;
  }
}

function _isXProfileUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    if (!['x.com', 'twitter.com'].includes(host)) return false;

    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length !== 1) return false;

    const handle = parts[0].toLowerCase();
    if (!/^[a-z0-9_]{1,15}$/i.test(handle)) return false;

    return !new Set([
      'home', 'login', 'explore', 'search', 'notifications', 'messages',
      'settings', 'share', 'intent', 'hashtag', 'i',
    ]).has(handle);
  } catch {
    return false;
  }
}

function _normalizeXUrl(url) {
  const u = new URL(url);
  const handle = u.pathname.split('/').filter(Boolean)[0];
  return `https://x.com/${handle}`;
}

function _isLikelyCompanyWebsite(result, company) {
  const url = (result.url || '').toLowerCase();
  if (_isSocialOrDirectoryUrl(url)) return false;
  if (/\.(pdf|doc|docx|ppt|pptx)$/i.test(url)) return false;

  const text = `${result.title || ''} ${result.url || ''} ${result.snippet || ''}`.toLowerCase();
  const companyParts = _tokens(company);
  const coreParts = _coreCompanyTokens(companyParts);
  const matchedCoreParts = coreParts.filter(part => text.includes(part));
  if (matchedCoreParts.length === 0) return false;

  try {
    const host = new URL(result.url).hostname.replace(/^www\./, '').toLowerCase();
    const compactCompany = companyParts.join('');
    const compactCore = coreParts.join('');
    const compactHost = host.replace(/[^a-z0-9]/g, '');
    const compactText = text.replace(/[^a-z0-9]/g, '');

    if (compactCore.length > 2 && compactHost.includes(compactCore.slice(0, Math.min(compactCore.length, 10)))) {
      return true;
    }
    if (compactCompany.length > 6 && compactText.includes(compactCompany.slice(0, Math.min(compactCompany.length, 16)))) {
      return true;
    }

    return result.queryType === 'official' && matchedCoreParts.length >= Math.min(2, coreParts.length);
  } catch {
    return false;
  }
}

function _isCompanyMatch(result, company) {
  const companyParts = _tokens(company);
  if (!companyParts.length) return false;
  const coreParts = _coreCompanyTokens(companyParts);
  const text = `${result.title || ''} ${result.url || ''} ${result.snippet || ''}`.toLowerCase();
  const compactText = text.replace(/[^a-z0-9]/g, '');
  const compactCompany = companyParts.join('');
  const compactCore = coreParts.join('');
  const matchedParts = coreParts.filter(part => text.includes(part));

  return matchedParts.length >= Math.min(2, coreParts.length)
    || (compactCore.length > 2 && compactText.includes(compactCore.slice(0, Math.min(compactCore.length, 12))))
    || (compactCompany.length > 6 && compactText.includes(compactCompany.slice(0, Math.min(compactCompany.length, 16))));
}

function _coreCompanyTokens(tokens) {
  const generic = new Set([
    'llc',
    'inc',
    'ltd',
    'limited',
    'company',
    'co',
    'corp',
    'corporation',
    'global',
    'international',
    'sourcing',
    'services',
    'solutions',
    'group',
    'holdings',
    'the',
  ]);
  const core = tokens.filter(token => !generic.has(token));
  return core.length ? core : tokens.filter(token => !['llc', 'inc', 'ltd', 'limited', 'company', 'co'].includes(token));
}

function _isSocialOrDirectoryUrl(url = '') {
  return [
    'linkedin.com',
    'facebook.com',
    'instagram.com',
    'twitter.com',
    'x.com',
    'youtube.com',
    'wikipedia.org',
    'tiktok.com',
    'crunchbase.com',
    'glassdoor.com',
    'indeed.com',
    'zoominfo.com',
    'rocketreach.co',
    'apollo.io',
    'city-data.com',
    'sunbiz.org',
    'myflorida.com',
    'importgenius.com',
    'seair.co.in',
    'marketinsidedata.com',
  ].some(domain => url.toLowerCase().includes(domain));
}

function _isNewsResult(result, company) {
  const text = `${result.title} ${result.snippet}`.toLowerCase();
  const companyToken = company.toLowerCase().split(/\s+/)[0];
  const newsWords = ['news', 'press', 'funding', '融资', '新闻', '发布', '宣布', '收购', '合作'];
  return text.includes(companyToken) && newsWords.some(word => text.includes(word));
}

function _isJobResult(result) {
  const text = `${result.title} ${result.url} ${result.snippet}`.toLowerCase();
  const jobWords = ['jobs', 'careers', '招聘', '职位', 'hiring', 'join us', '岗位'];
  return jobWords.some(word => text.includes(word));
}
