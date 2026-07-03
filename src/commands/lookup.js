import path from 'path';
import { config } from '../config.js';

/**
 * 单条查询核心逻辑 — 供 lookup 和 batch 命令复用
 *
 * 流程：
 *   Phase 1: Google 搜索（一次搜索，无补搜）
 *   Phase 2: LinkedIn + Instagram + Facebook 并行抓取（共享浏览器）
 *   Phase 3: 数据合并
 *   Phase 4: LLM 分析
 *   Phase 5: 输出文件
 */

function createAbortError() {
  const err = new Error('查询已取消');
  err.name = 'AbortError';
  return err;
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

function closeBrowserOnAbort(signal, close) {
  if (!signal) return () => {};

  const onAbort = () => {
    close().catch(() => {});
  };

  signal.addEventListener('abort', onAbort, { once: true });
  if (signal.aborted) onAbort();

  return () => signal.removeEventListener('abort', onAbort);
}

export async function executeLookup(query, options = {}, deps = {}, onProgress = null) {
  const { name, company, linkedin: linkedinUrlInput } = query;
  const { lang = 'zh', depth = 'quick', output = 'both', signal = null } = options;

  const warnings = [];
  const startTime = Date.now();

  const progress = (phase, message) => {
    logger.info(`Phase ${phase}/5: ${message}`);
    if (onProgress) onProgress(phase, message);
  };

  // 动态导入
  const { checkSession } = deps.session || await import('../browser/session.js');
  const browserDeps = deps.launchBrowser || await import('../browser/launcher.js');
  const {
    launchBrowser,
    createContext,
    closeBrowser = async (browser) => { await browser?.close?.().catch(() => {}); },
    closeContext = async (context) => { await context?.close?.().catch(() => {}); },
  } = browserDeps;
  const { GoogleScraper } = deps.GoogleScraper || await import('../scrapers/google.js');
  const { LinkedInScraper } = deps.LinkedInScraper || await import('../scrapers/linkedin.js');
  const { InstagramScraper } = deps.InstagramScraper || await import('../scrapers/instagram.js');
  const { FacebookScraper } = deps.FacebookScraper || await import('../scrapers/facebook.js');
  const { XScraper } = deps.XScraper || await import('../scrapers/x.js');
  const { logger } = deps.logger || await import('../utils/logger.js');
  const { mergeData } = deps.mergeData || await import('../analyzer/merge.js');
  const { Analyzer } = deps.Analyzer || await import('../analyzer/llm.js');
  const { writeJson } = deps.writeJson || await import('../output/json.js');
  const { generateMarkdown, writeMarkdown } = deps.writeMarkdown || await import('../output/markdown.js');
  const { generateHtml, writeHtml } = deps.writeHtml || await import('../output/html.js');

  throwIfAborted(signal);

  // ==================== Phase 1: Google 搜索 ====================
  progress(1, 'Google 搜索...');
  let googleData = null;
  let linkedinUrl = linkedinUrlInput;
  let linkedinSource = linkedinUrlInput ? 'input' : null;
  let instagramUrl = null;
  let instagramSource = null;
  let companyInstagramUrl = null;
  let facebookUrl = null;
  let companyFacebookUrl = null;
  let xUrl = null;
  let xSource = null;
  let companyXUrl = null;

  let companyData = null;
  throwIfAborted(signal);
  const { browser: searchBrowser, mode: browserMode } = await launchBrowser();
  const stopSearchAbortCleanup = closeBrowserOnAbort(signal, () => closeBrowser(searchBrowser, browserMode));

  try {
    throwIfAborted(signal);
    if (!linkedinUrl) {
      const context = await createContext(searchBrowser, { platform: 'google', mode: browserMode });
      const googleScraper = new GoogleScraper(context);

      throwIfAborted(signal);
      googleData = await googleScraper.scrape(name, company);
      throwIfAborted(signal);
      linkedinUrl = googleData.socialLinks?.linkedin;
      if (linkedinUrl) linkedinSource = 'google';
      instagramUrl = googleData.socialLinks?.instagram;
      if (instagramUrl) instagramSource = 'google';
      facebookUrl = googleData.socialLinks?.facebook;
      xUrl = googleData.socialLinks?.x;
      if (xUrl) xSource = 'google';

      if (instagramUrl && !_urlMatchesName(instagramUrl, name)) {
        logger.info(`  Instagram 结果不匹配人物（${instagramUrl}），跳过`);
        instagramUrl = null;
      }
      if (facebookUrl && !_urlMatchesName(facebookUrl, name)) {
        logger.info(`  Facebook 结果不匹配人物（${facebookUrl}），跳过`);
        facebookUrl = null;
      }

      // LinkedIn 内部搜索已禁用 — 会触发 hCaptcha，返回空结果
      // if (!linkedinUrl) { ... }

      await closeContext(context, browserMode);

      // 补充搜索：Google 一次搜索常常漏掉社交平台，逐个补搜
      const needSearch = [];
      if (!linkedinUrl) needSearch.push('linkedin');
      if (!instagramUrl) needSearch.push('instagram');
      if (!facebookUrl) needSearch.push('facebook');
      if (!xUrl) needSearch.push('x');

      for (const platform of needSearch) {
        throwIfAborted(signal);
        try {
          const ctx = await createContext(searchBrowser, { platform: 'google', mode: browserMode });
          const gs = new GoogleScraper(ctx);
          const url = await gs.searchPlatform(name, company, platform);
          throwIfAborted(signal);
          if (url) {
            if (platform === 'linkedin') {
              linkedinUrl = url;
              linkedinSource = 'supplemental-google';
            }
            if (platform === 'instagram') {
              instagramUrl = url;
              instagramSource = 'supplemental-google';
            }
            if (platform === 'facebook') facebookUrl = url;
            if (platform === 'x') {
              xUrl = url;
              xSource = 'supplemental-google';
            }
            logger.info(`  ${platform} 补搜找到: ${url}`);
          }
          await closeContext(ctx, browserMode);
        } catch (err) {
          throwIfAborted(signal);
          logger.warn(`  ${platform} 补搜失败: ${err.message}`);
        }
      }
    }

    const found = [];
    if (linkedinUrl) found.push('LinkedIn');
    if (instagramUrl) found.push('Instagram');
    if (facebookUrl) found.push('Facebook');
    if (xUrl) found.push('X');
    logger.info(`  找到: ${found.length ? found.join(', ') : '无'}`);

    // 公司维度补充：PRD 要求公司官网、新闻、招聘信息用于销售画像
    if (company) {
      throwIfAborted(signal);
      progress(1, found.length < 2 ? '个人信息不足，从公司维度补充...' : '补充公司官网和新闻...');
      try {
        const context = await createContext(searchBrowser, { platform: 'google', mode: browserMode });
        const googleScraper = new GoogleScraper(context);
        companyData = await googleScraper.searchCompany(company);
        throwIfAborted(signal);
        await closeContext(context, browserMode);

        const companyLinks = [];
        if (companyData.companyLinkedinUrl) companyLinks.push('LinkedIn');
        if (companyData.companyInstagramUrl) companyLinks.push('Instagram');
        if (companyData.companyFacebookUrl) companyLinks.push('Facebook');
        if (companyData.companyXUrl) companyLinks.push('X');
        logger.info(`  公司社交: ${companyLinks.length ? companyLinks.join(', ') : '无'}`);
        if (companyData.companyWebsite) logger.info(`  公司官网: ${companyData.companyWebsite}`);
        companyInstagramUrl = companyData.companyInstagramUrl || null;
        companyFacebookUrl = companyData.companyFacebookUrl || null;
        companyXUrl = companyData.companyXUrl || null;

        // 公司账号只作为公司研究依据，不再顶替个人账号抓取，避免把公司主页写进人物画像。
      } catch (err) {
        throwIfAborted(signal);
        logger.warn(`公司搜索失败: ${err.message}`);
      }
    }
  } catch (err) {
    throwIfAborted(signal);
    throw err;
  } finally {
    stopSearchAbortCleanup();
    await closeBrowser(searchBrowser, browserMode);
  }

  throwIfAborted(signal);

  // ==================== Phase 2: 并行抓取（共享浏览器） ====================
  progress(2, '并行抓取各平台...');

  // 所有平台共享一个浏览器，每个平台一个独立 context
  const { browser: scrapeBrowser, mode: scrapeMode } = await launchBrowser();
  const stopScrapeAbortCleanup = closeBrowserOnAbort(signal, () => closeBrowser(scrapeBrowser, scrapeMode));

  let linkedinData = null, instagramData = null, companyInstagramData = null, facebookData = null, companyFacebookData = null, xData = null, companyXData = null;
  let earlyAnalysisPromise = null;
  let earlyAnalysis = null;
  let scrapeResults = [];

  try {
    throwIfAborted(signal);
    const scrapeTasks = [];
    const addScrapeTask = (platform, label, run) => {
      progress(2, `开始抓取${label}...`);
      scrapeTasks.push(
        run()
          .then(result => {
            progress(2, `${label}抓取完成`);
            return { platform, ...result };
          })
          .catch(err => {
            progress(2, `${label}抓取失败: ${err.message}`);
            throw err;
          })
      );
    };

    // LinkedIn（需要登录态，加载 session 到共享浏览器）
    if (linkedinUrl) {
      addScrapeTask(
        'linkedin',
        'LinkedIn',
        () => _scrapeLinkedIn(linkedinUrl, depth, scrapeBrowser, createContext, closeContext, LinkedInScraper, logger, scrapeMode)
      );
    }

    // Instagram
    if (instagramUrl) {
      addScrapeTask(
        'instagram',
        '个人 Instagram',
        () => _scrapeInstagram(instagramUrl, depth, scrapeBrowser, checkSession, createContext, closeContext, InstagramScraper, logger, scrapeMode)
      );
    }

    if (companyInstagramUrl && !_sameUrl(companyInstagramUrl, instagramUrl)) {
      addScrapeTask(
        'companyInstagram',
        '公司 Instagram',
        () => _scrapeInstagram(companyInstagramUrl, depth, scrapeBrowser, checkSession, createContext, closeContext, InstagramScraper, logger, scrapeMode)
      );
    }

    // Facebook
    if (facebookUrl) {
      addScrapeTask(
        'facebook',
        '个人 Facebook',
        () => _scrapeFacebook(facebookUrl, depth, scrapeBrowser, createContext, closeContext, FacebookScraper, logger, scrapeMode)
      );
    }

    if (companyFacebookUrl && !_sameUrl(companyFacebookUrl, facebookUrl)) {
      addScrapeTask(
        'companyFacebook',
        '公司 Facebook',
        () => _scrapeFacebook(companyFacebookUrl, depth, scrapeBrowser, createContext, closeContext, FacebookScraper, logger, scrapeMode)
      );
    }

    // X
    if (xUrl) {
      addScrapeTask(
        'x',
        '个人 X',
        () => _scrapeX(xUrl, depth, scrapeBrowser, checkSession, createContext, closeContext, XScraper, logger, scrapeMode)
      );
    }

    if (companyXUrl && !_sameUrl(companyXUrl, xUrl)) {
      addScrapeTask(
        'companyX',
        '公司 X',
        () => _scrapeX(companyXUrl, depth, scrapeBrowser, checkSession, createContext, closeContext, XScraper, logger, scrapeMode)
      );
    }

    // 并行执行，LinkedIn 先行：LI 完成后立即开始 LLM 预分析
    // 用 Promise.allSettled 配合单个 Promise 的 then 来实现「LinkedIn 先行」
    const wrappedTasks = scrapeTasks.map(task =>
      task.then(result => {
        throwIfAborted(signal);
        if (result.platform === 'linkedin') {
          const validation = validateLinkedInCandidate(result.data, name, company, linkedinSource);
          if (!validation.ok) {
            logger.info(`  LinkedIn: ${validation.reason}`);
            return { ...result, data: null, warning: validation.warning };
          }
        }
        if (result.platform === 'instagram') {
          const validation = validateInstagramCandidate(result.data, name, company, instagramSource);
          if (!validation.ok) {
            logger.info(`  Instagram: ${validation.reason}`);
            return { ...result, data: validation.data, warning: validation.warning };
          }
          return { ...result, data: validation.data };
        }
        if (result.platform === 'companyInstagram') {
          const validation = validateCompanyInstagramCandidate(result.data, company);
          if (!validation.ok) {
            logger.info(`  公司 Instagram: ${validation.reason}`);
            return { ...result, data: validation.data, warning: validation.warning };
          }
          return { ...result, data: validation.data };
        }
        if (result.platform === 'companyFacebook') {
          const validation = validateCompanyFacebookCandidate(result.data, company);
          if (!validation.ok) {
            logger.info(`  公司 Facebook: ${validation.reason}`);
            return { ...result, data: validation.data, warning: validation.warning };
          }
          return { ...result, data: validation.data };
        }
        if (result.platform === 'facebook') {
          const validation = validateFacebookCandidate(result.data, name, company);
          if (!validation.ok) {
            logger.info(`  Facebook: ${validation.reason}`);
            return { ...result, data: validation.data, warning: validation.warning };
          }
          return { ...result, data: validation.data };
        }
        if (result.platform === 'x') {
          const validation = validateXCandidate(result.data, name, company, xSource);
          if (!validation.ok) {
            logger.info(`  X: ${validation.reason}`);
            return { ...result, data: validation.data, warning: validation.warning };
          }
          return { ...result, data: validation.data };
        }
        if (result.platform === 'companyX') {
          const validation = validateCompanyXCandidate(result.data, company);
          if (!validation.ok) {
            logger.info(`  公司 X: ${validation.reason}`);
            return { ...result, data: validation.data, warning: validation.warning };
          }
          return { ...result, data: validation.data };
        }

        // LinkedIn 完成 → 立即启动 LLM 预分析（不等 IG/FB）
        if (result.platform === 'linkedin' && result.data?.found) {
          throwIfAborted(signal);
          linkedinData = result.data;
          const partialPlatformResults = { google: googleData, linkedin: linkedinData, instagram: null, facebook: null };
          const partialMerged = mergeData({ name, company }, partialPlatformResults, companyData);

          earlyAnalysisPromise = (async () => {
            try {
              throwIfAborted(signal);
              logger.info('  LinkedIn 已就绪，提前启动 LLM 分析...');
              const analyzer = new Analyzer();
              return await analyzer.analyze(partialMerged, { lang });
            } catch {
              return null;
            }
          })();
        }

        return result;
      })
    );

    // 等待所有抓取完成
    scrapeResults = await Promise.allSettled(wrappedTasks);
    throwIfAborted(signal);
  } finally {
    // 关闭共享浏览器
    stopScrapeAbortCleanup();
    await closeBrowser(scrapeBrowser, scrapeMode);
  }

  throwIfAborted(signal);

  // 收集结果
  for (const result of scrapeResults) {
    if (result.status === 'rejected') continue;
    const { platform, data, warning } = result.value;

    if (warning) warnings.push(warning);

    switch (platform) {
      case 'linkedin': linkedinData = data; break;
      case 'instagram': instagramData = data; break;
      case 'companyInstagram': companyInstagramData = data; break;
      case 'facebook': facebookData = data; break;
      case 'companyFacebook': companyFacebookData = data; break;
      case 'x': xData = data; break;
      case 'companyX': companyXData = data; break;
    }
  }

  const scrapeTime = ((Date.now() - startTime) / 1000).toFixed(1);
  const successPlatforms = [linkedinData, instagramData, companyInstagramData, facebookData, companyFacebookData, xData, companyXData]
    .filter(d => d?.found && !d?.excludedFromAnalysis).length;
  logger.info(`  抓取完成 (${scrapeTime}s): ${successPlatforms} 个平台成功`);

  // ==================== Phase 3: 数据合并 ====================
  throwIfAborted(signal);
  progress(3, '数据合并...');
  const platformResults = {
    google: googleData,
    linkedin: linkedinData,
    instagram: instagramData,
    companyInstagram: companyInstagramData,
    facebook: facebookData,
    companyFacebook: companyFacebookData,
    x: xData,
    companyX: companyXData,
  };
  const merged = mergeData({ name, company }, platformResults, companyData);

  // ==================== Phase 4: LLM 分析 ====================
  throwIfAborted(signal);
  progress(4, 'LLM 分析...');

  // 如果有 IG/FB 数据，用完整数据重新分析（比预分析更准确）
  // 如果只有 LinkedIn，直接用预分析结果（省 10-15s）
  const hasExtraData = (instagramData?.found && !instagramData?.excludedFromAnalysis)
    || (companyInstagramData?.found && !companyInstagramData?.excludedFromAnalysis)
    || facebookData?.found
    || (companyFacebookData?.found && !companyFacebookData?.excludedFromAnalysis)
    || (xData?.found && !xData?.excludedFromAnalysis)
    || (companyXData?.found && !companyXData?.excludedFromAnalysis);

  if (hasExtraData && earlyAnalysisPromise) {
    // 等预分析完成（可能已经结束了），然后用完整数据重新分析
    earlyAnalysis = await earlyAnalysisPromise;
    throwIfAborted(signal);
    logger.info('  有 IG/FB 补充数据，重新分析...');
  }

  let analysis;
  try {
    const analyzer = new Analyzer();
    analysis = await analyzer.analyze(merged, { lang });
    throwIfAborted(signal);
  } catch (err) {
    throwIfAborted(signal);
    logger.warn(`LLM 分析失败: ${err.message}`);
    // 降级：用预分析结果
    analysis = earlyAnalysis || {
      company: { name: company || '未知' },
      person: { role: '未知' },
      salesInsights: { entryPoints: ['数据不足'] },
    };
  }

  // ==================== Phase 5: 输出文件 ====================
  throwIfAborted(signal);
  progress(5, '生成报告...');
  const files = {};
  const timestamp = new Date().toISOString().slice(0, 10);
  const safeName = name.replace(/[^a-zA-Z0-9一-鿿]/g, '_');
  const baseFilename = `${safeName}-${timestamp}`;
  const fullResult = { ...merged, analysis };

  if (output === 'json' || output === 'both' || output === 'all') {
    files.json = await writeJson(fullResult, `${baseFilename}.json`);
  }
  if (output === 'md' || output === 'both' || output === 'all') {
    const md = generateMarkdown(merged, analysis);
    files.md = await writeMarkdown(md, `${baseFilename}.md`);
  }
  if (output === 'html' || output === 'both' || output === 'all') {
    const html = generateHtml(merged, analysis);
    files.html = await writeHtml(html, `${baseFilename}.html`);
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  progress(5, `全部完成 (${totalTime}s)`);

  return { merged, analysis, files, warnings };
}

// ==================== 并行抓取子函数（共享浏览器版本） ====================

/**
 * 抓取 LinkedIn — 从共享浏览器创建 context，加载 session
 */
async function _scrapeLinkedIn(url, depth, browser, createContext, closeContext, LinkedInScraper, logger, mode = 'playwright') {
  try {
    // CDP 模式：直接用 Chrome 的 context（已有 cookie）
    // Playwright 模式：加载 session 文件
    const contextOpts = { platform: 'linkedin', mode };
    if (mode !== 'cdp') {
      contextOpts.storageState = path.join(config.sessionsDir, 'linkedin.json');
    }
    const context = await createContext(browser, contextOpts);

    const scraper = new LinkedInScraper(context);
    const data = await scraper.scrape(url, { depth, cdpMode: mode === 'cdp' });
    await closeContext(context, mode);

    if (data?.error === 'SESSION_EXPIRED') {
      return { data: null, warning: 'LinkedIn session 已过期，请运行: social-profiler session login linkedin' };
    }
    return { data };
  } catch (err) {
    logger.warn(`LinkedIn 抓取失败: ${err.message}`);
    return { data: null, warning: `LinkedIn: ${err.message}` };
  }
}

/**
 * 抓取 Instagram — 从共享浏览器创建 context
 */
async function _scrapeInstagram(url, depth, browser, checkSession, createContext, closeContext, InstagramScraper, logger, mode = 'playwright') {
  try {
    let context;

    if (mode === 'cdp') {
      // CDP 模式：直接用 Chrome 的 context
      context = await createContext(browser, { platform: 'instagram', mode });
    } else {
      const session = await checkSession('instagram');
      if (session.exists) {
        const sessionPath = path.join(config.sessionsDir, 'instagram.json');
        context = await createContext(browser, { storageState: sessionPath, platform: 'instagram' });
      } else {
        logger.info('  Instagram: 无痕模式');
        context = await createContext(browser, { platform: 'instagram-guest' });
      }
    }

    const scraper = new InstagramScraper(context);
    const data = await scraper.scrape(url, { depth });
    await closeContext(context, mode);
    return { data };
  } catch (err) {
    logger.warn(`Instagram 抓取失败: ${err.message}`);
    return { data: null };
  }
}

/**
 * 抓取 Facebook — 从共享浏览器创建 context（无需登录）
 */
async function _scrapeFacebook(url, depth, browser, createContext, closeContext, FacebookScraper, logger, mode = 'playwright') {
  try {
    const context = await createContext(browser, { platform: 'facebook-guest', mode });
    const scraper = new FacebookScraper(context);
    const data = await scraper.scrape(url, { depth });
    await closeContext(context, mode);
    return { data };
  } catch (err) {
    logger.warn(`Facebook 抓取失败: ${err.message}`);
    return { data: null };
  }
}

/**
 * 抓取 X — 有登录态时加载 session，否则使用公开可见页面。
 */
async function _scrapeX(url, depth, browser, checkSession, createContext, closeContext, XScraper, logger, mode = 'playwright') {
  let context = null;
  try {
    const session = await checkSession('x');
    if (session.exists) {
      const sessionPath = path.join(config.sessionsDir, 'x.json');
      context = await createContext(browser, { storageState: sessionPath, platform: 'x', mode });
    } else {
      logger.info('  X: 无痕模式');
      context = await createContext(browser, { platform: 'x-guest', mode });
    }

    const scraper = new XScraper(context);
    const data = await scraper.scrape(url, { depth });
    return { data };
  } catch (err) {
    logger.warn(`X 抓取失败: ${err.message}`);
    return { data: null };
  } finally {
    if (context) await closeContext(context, mode);
  }
}

/**
 * 对低可信 LinkedIn 候选做本地二次校验。
 * 主搜索或用户手填的链接不强制要求公司证据，避免 quick 抓取缺少经历时误杀。
 */
export function validateLinkedInCandidate(data, name, company, source = 'google') {
  if (!data?.found || !company) return { ok: true };
  if (source !== 'supplemental-google') return { ok: true };

  if (_linkedinHasCompanyEvidence(data, company)) return { ok: true };

  return {
    ok: false,
    reason: `补搜 LinkedIn 仅匹配到同名，但未发现与 ${company} 相关的证据，已跳过`,
    warning: `LinkedIn: 找到同名页面，但与 ${company} 不匹配，已跳过`,
  };
}

/**
 * Instagram 主要用于兴趣爱好推断；低可信结果必须排除，避免误导画像。
 */
export function validateInstagramCandidate(data, name, company, source = 'google') {
  if (!data?.found) return { ok: true, data };

  const profile = data.profile || {};
  const unreliableReason = _instagramProfileReliabilityIssue(data, name);
  if (unreliableReason) {
    const reason = `${unreliableReason}，已排除出兴趣爱好分析`;
    return {
      ok: false,
      reason,
      warning: `Instagram: ${reason}`,
      data: _excludedInstagramData(data, profile, reason, 0),
    };
  }

  const score = _scoreInstagramCandidate(data, name, company);

  if (score >= 6) {
    return {
      ok: true,
      data: {
        ...data,
        matchConfidence: score >= 10 ? 'high' : 'medium',
        matchScore: score,
      },
    };
  }

  const username = profile.username ? `@${profile.username}` : data.url;
  const reason = `${username} 与 ${name} 的匹配度不足，已排除出兴趣爱好分析`;
  return {
    ok: false,
    reason,
    warning: `Instagram: ${reason}`,
    data: _excludedInstagramData(data, profile, reason, score),
  };
}

/**
 * 公司 Instagram 可用于公司/产品分析，但必须能证明属于目标公司。
 */
export function validateCompanyInstagramCandidate(data, company) {
  if (!data?.found || !company) return { ok: true, data: data ? { ...data, scope: 'company' } : data };

  const profile = data.profile || {};
  const score = _scoreCompanyInstagramCandidate(data, company);

  if (score >= 6) {
    return {
      ok: true,
      data: {
        ...data,
        scope: 'company',
        matchConfidence: score >= 10 ? 'high' : 'medium',
        matchScore: score,
      },
    };
  }

  const username = profile.username ? `@${profile.username}` : data.url;
  const reason = `${username} 与 ${company} 的匹配度不足，已排除出公司/产品分析`;
  return {
    ok: false,
    reason,
    warning: `公司 Instagram: ${reason}`,
    data: {
      ..._excludedInstagramData(data, profile, reason, score),
      scope: 'company',
    },
  };
}

/**
 * 公司 Facebook 可用于公司/产品分析，但必须能证明属于目标公司。
 */
export function validateCompanyFacebookCandidate(data, company) {
  if (!data?.found || !company) return { ok: true, data: data ? { ...data, scope: 'company' } : data };

  const profile = data.profile || {};
  const score = _scoreCompanySocialCandidate(data, company);

  if (score >= 6) {
    return {
      ok: true,
      data: {
        ...data,
        scope: 'company',
        matchConfidence: score >= 10 ? 'high' : 'medium',
        matchScore: score,
      },
    };
  }

  const pageName = profile.fullName || profile.username || data.url;
  const reason = `${pageName} 与 ${company} 的匹配度不足，已排除出公司/产品分析`;
  return {
    ok: false,
    reason,
    warning: `公司 Facebook: ${reason}`,
    data: {
      ..._excludedFacebookData(data, profile, reason, score),
      scope: 'company',
    },
  };
}

/**
 * 个人 Facebook 只能用于人物画像；公司/品牌页必须排除。
 */
export function validateFacebookCandidate(data, name, company = '') {
  if (!data?.found) return { ok: true, data };

  const profile = data.profile || {};
  const score = _scorePersonalFacebookCandidate(data, name);
  const companyScore = company ? _scoreCompanySocialCandidate(data, company) : 0;

  if (score >= 6 && score >= companyScore) {
    return {
      ok: true,
      data: {
        ...data,
        scope: 'person',
        matchConfidence: score >= 10 ? 'high' : 'medium',
        matchScore: score,
      },
    };
  }

  const pageName = profile.fullName || profile.username || data.url;
  const reason = `${pageName} 与 ${name} 的匹配度不足，已排除出人物画像分析`;
  return {
    ok: false,
    reason,
    warning: `Facebook: ${reason}`,
    data: _excludedFacebookData(data, profile, reason, score),
  };
}

/**
 * X 个人账号必须有足够姓名证据，避免把品牌号或同名弱匹配写入画像。
 */
export function validateXCandidate(data, name, company, source = 'google') {
  if (!data?.found) return { ok: true, data };

  const profile = data.profile || {};
  const score = _scorePersonalXCandidate(data, name, company);

  if (score >= 7) {
    return {
      ok: true,
      data: {
        ...data,
        scope: 'person',
        matchConfidence: score >= 12 ? 'high' : 'medium',
        matchScore: score,
      },
    };
  }

  const username = profile.username ? `@${profile.username}` : data.url;
  const reason = `${username} 与 ${name} 的匹配度不足，已排除出人物画像分析`;
  return {
    ok: false,
    reason,
    warning: `X: ${reason}`,
    data: _excludedXData(data, profile, reason, score, 'person'),
  };
}

/**
 * 公司 X 账号只在公司证据足够时进入公司研究。
 */
export function validateCompanyXCandidate(data, company) {
  if (!data?.found || !company) return { ok: true, data: data ? { ...data, scope: 'company' } : data };

  const profile = data.profile || {};
  const score = _scoreCompanyXCandidate(data, company);

  if (score >= 7) {
    return {
      ok: true,
      data: {
        ...data,
        scope: 'company',
        matchConfidence: score >= 12 ? 'high' : 'medium',
        matchScore: score,
      },
    };
  }

  const username = profile.username ? `@${profile.username}` : data.url;
  const reason = `${username} 与 ${company} 的匹配度不足，已排除出公司/产品分析`;
  return {
    ok: false,
    reason,
    warning: `公司 X: ${reason}`,
    data: _excludedXData(data, profile, reason, score, 'company'),
  };
}

function _excludedFacebookData(data, profile, reason, score) {
  return {
    ...data,
    excludedFromAnalysis: true,
    matchConfidence: 'low',
    matchScore: score,
    note: reason,
    profile: {
      username: profile.username || null,
      fullName: profile.fullName || null,
      bio: profile.bio || profile.about || null,
      followersCount: profile.followersCount || null,
      likesCount: profile.likesCount || null,
      recentPosts: [],
    },
  };
}

function _excludedXData(data, profile, reason, score, scope) {
  return {
    ...data,
    scope,
    excludedFromAnalysis: true,
    matchConfidence: 'low',
    matchScore: score,
    note: reason,
    profile: {
      username: profile.username || null,
      displayName: profile.displayName || profile.fullName || null,
      bio: profile.bio || null,
      location: profile.location || null,
      website: profile.website || profile.externalUrl || null,
      followersCount: profile.followersCount || null,
      followingCount: profile.followingCount || null,
      recentPosts: [],
    },
  };
}

function _excludedInstagramData(data, profile, reason, score) {
  return {
    ...data,
    excludedFromAnalysis: true,
    matchConfidence: 'low',
    matchScore: score,
    note: reason,
    profile: {
      username: profile.username || null,
      fullName: profile.fullName || null,
      bio: profile.bio || null,
      externalUrl: profile.externalUrl || null,
      recentPosts: [],
    },
  };
}

function _scoreInstagramCandidate(data, name, company = '') {
  const profile = data.profile || {};
  const nameParts = _matchTokens(name);
  const companyParts = _matchTokens(company);
  const username = String(profile.username || '').toLowerCase();
  const fullName = String(profile.fullName || '').toLowerCase();
  const bio = String(profile.bio || '').toLowerCase();
  const externalUrl = String(profile.externalUrl || '').toLowerCase();
  const haystack = `${username} ${fullName} ${bio} ${externalUrl}`;
  const compactHaystack = haystack.replace(/[^a-z0-9]/g, '');
  const compactName = nameParts.join('');

  let score = 0;
  const usernameMatches = nameParts.filter(part => username.includes(part));
  const fullNameMatches = nameParts.filter(part => fullName.includes(part));

  score += usernameMatches.length * 3;
  score += fullNameMatches.length * 4;

  if (nameParts.length > 1 && usernameMatches.length >= 2) score += 4;
  if (nameParts.length > 1 && fullNameMatches.length >= 2) score += 5;
  if (compactName && compactHaystack.includes(compactName)) score += 5;

  const companyMatches = companyParts.filter(part => bio.includes(part) || externalUrl.includes(part));
  score += Math.min(companyMatches.length * 2, 4);

  if (/(official|company|global|corp|inc|ltd|store|shop|brand|team|club|news|media)/i.test(`${username} ${fullName}`)) {
    score -= 4;
  }

  return score;
}

function _scoreCompanyInstagramCandidate(data, company = '') {
  return _scoreCompanySocialCandidate(data, company, {
    externalUrl: data.profile?.externalUrl,
    platformBoost: /(official|company|agency|studio|team|brand|shop|store|inc|corp|ltd|global)/i,
  });
}

function _scoreCompanySocialCandidate(data, company = '', options = {}) {
  const profile = data.profile || {};
  const companyParts = _matchTokens(company);
  const username = String(profile.username || '').toLowerCase();
  const fullName = String(profile.fullName || '').toLowerCase();
  const bio = String(profile.bio || profile.about || '').toLowerCase();
  const externalUrl = String(options.externalUrl || profile.externalUrl || '').toLowerCase();
  const url = String(data.url || '').toLowerCase();
  const haystack = `${username} ${fullName} ${bio} ${externalUrl} ${url}`;
  const compactHaystack = haystack.replace(/[^a-z0-9]/g, '');
  const compactCompany = companyParts.join('');

  let score = 0;
  const usernameMatches = companyParts.filter(part => username.includes(part));
  const fullNameMatches = companyParts.filter(part => fullName.includes(part));
  const bioMatches = companyParts.filter(part => bio.includes(part) || externalUrl.includes(part));

  score += usernameMatches.length * 3;
  score += fullNameMatches.length * 3;
  score += Math.min(bioMatches.length * 2, 4);

  if (companyParts.length > 1 && usernameMatches.length >= Math.min(2, companyParts.length)) score += 4;
  if (companyParts.length > 1 && fullNameMatches.length >= Math.min(2, companyParts.length)) score += 4;
  if (compactCompany && compactHaystack.includes(compactCompany)) score += 5;

  const platformBoost = options.platformBoost || /(official|company|agency|studio|team|brand|shop|store|inc|corp|ltd|global|page)/i;
  if (platformBoost.test(`${username} ${fullName}`)) {
    score += 2;
  }

  return score;
}

function _scorePersonalFacebookCandidate(data, name = '') {
  const profile = data.profile || {};
  const nameParts = _matchTokens(name);
  const username = String(profile.username || '').toLowerCase();
  const fullName = String(profile.fullName || '').toLowerCase();
  const bio = String(profile.bio || profile.about || '').toLowerCase();
  const url = String(data.url || '').toLowerCase();
  const haystack = `${username} ${fullName} ${bio} ${url}`;
  const compactHaystack = haystack.replace(/[^a-z0-9]/g, '');
  const compactName = nameParts.join('');

  let score = 0;
  const usernameMatches = nameParts.filter(part => username.includes(part));
  const fullNameMatches = nameParts.filter(part => fullName.includes(part));

  score += usernameMatches.length * 3;
  score += fullNameMatches.length * 4;
  if (nameParts.length > 1 && usernameMatches.length >= 2) score += 4;
  if (nameParts.length > 1 && fullNameMatches.length >= 2) score += 5;
  if (compactName && compactHaystack.includes(compactName)) score += 5;

  if (/(official|company|agency|brand|shop|store|inc|corp|ltd|global|page)/i.test(`${username} ${fullName}`)) {
    score -= 4;
  }

  return score;
}

function _scorePersonalXCandidate(data, name = '', company = '') {
  const profile = data.profile || {};
  const nameParts = _matchTokens(name);
  const companyParts = _matchTokens(company);
  const username = String(profile.username || '').toLowerCase();
  const displayName = String(profile.displayName || profile.fullName || '').toLowerCase();
  const bio = String(profile.bio || '').toLowerCase();
  const posts = (profile.recentPosts || []).map(p => p.text || '').join(' ').toLowerCase();
  const url = String(data.url || '').toLowerCase();
  const haystack = `${username} ${displayName} ${bio} ${posts} ${url}`;
  const compactHaystack = haystack.replace(/[^a-z0-9]/g, '');
  const compactName = nameParts.join('');

  let score = 0;
  const usernameMatches = nameParts.filter(part => username.includes(part));
  const displayNameMatches = nameParts.filter(part => displayName.includes(part));
  const bioMatches = nameParts.filter(part => bio.includes(part));

  score += usernameMatches.length * 3;
  score += displayNameMatches.length * 4;
  score += Math.min(bioMatches.length * 2, 4);
  if (nameParts.length > 1 && usernameMatches.length >= 2) score += 4;
  if (nameParts.length > 1 && displayNameMatches.length >= 2) score += 5;
  if (compactName && compactHaystack.includes(compactName)) score += 5;

  const companyMatches = companyParts.filter(part => bio.includes(part) || posts.includes(part));
  score += Math.min(companyMatches.length * 2, 4);

  if (/(official|company|global|corp|inc|ltd|store|shop|brand|team|news|media)/i.test(`${username} ${displayName}`)) {
    score -= 4;
  }

  return score;
}

function _scoreCompanyXCandidate(data, company = '') {
  const profile = data.profile || {};
  const companyParts = _matchTokens(company);
  const username = String(profile.username || '').toLowerCase();
  const displayName = String(profile.displayName || profile.fullName || '').toLowerCase();
  const bio = String(profile.bio || '').toLowerCase();
  const website = String(profile.website || profile.externalUrl || '').toLowerCase();
  const posts = (profile.recentPosts || []).map(p => p.text || '').join(' ').toLowerCase();
  const url = String(data.url || '').toLowerCase();
  const haystack = `${username} ${displayName} ${bio} ${website} ${posts} ${url}`;
  const compactHaystack = haystack.replace(/[^a-z0-9]/g, '');
  const compactCompany = companyParts.join('');

  let score = 0;
  const usernameMatches = companyParts.filter(part => username.includes(part));
  const displayNameMatches = companyParts.filter(part => displayName.includes(part));
  const evidenceMatches = companyParts.filter(part => bio.includes(part) || website.includes(part) || posts.includes(part));

  score += usernameMatches.length * 3;
  score += displayNameMatches.length * 3;
  score += Math.min(evidenceMatches.length * 2, 4);
  if (companyParts.length > 1 && usernameMatches.length >= Math.min(2, companyParts.length)) score += 4;
  if (companyParts.length > 1 && displayNameMatches.length >= Math.min(2, companyParts.length)) score += 4;
  if (compactCompany && compactHaystack.includes(compactCompany)) score += 5;

  if (/(official|company|agency|studio|team|brand|shop|store|inc|corp|ltd|global|hq)/i.test(`${username} ${displayName} ${bio}`)) {
    score += 2;
  }

  return score;
}

function _instagramProfileReliabilityIssue(data, name) {
  const profile = data.profile || {};
  const username = String(profile.username || '').trim().toLowerCase();
  const urlUsername = _instagramUsernameFromUrl(data.url);
  if (!username || !urlUsername) return null;

  const genericUsernames = new Set([
    'highlights',
    'posts',
    'reels',
    'tagged',
    'followers',
    'following',
  ]);
  if (genericUsernames.has(username)) {
    return `Instagram 抓取到的账号名 ${profile.username} 不是有效用户名`;
  }

  const compactUsername = username.replace(/[^a-z0-9]/g, '');
  const compactUrlUsername = urlUsername.replace(/[^a-z0-9]/g, '');
  if (compactUsername && compactUrlUsername && compactUsername !== compactUrlUsername) {
    const nameParts = _matchTokens(name);
    const usernameNameMatches = nameParts.filter(part => compactUsername.includes(part)).length;
    if (usernameNameMatches === 0) {
      return `Instagram 抓取到的账号名 @${profile.username} 与链接账号 @${urlUsername} 不一致`;
    }
  }

  if (_isMetaOnlyInstagramProfile(profile)) {
    return `Instagram @${profile.username || urlUsername} 只有通用页面摘要，缺少可核验的个人简介或帖子内容`;
  }

  return null;
}

function _isMetaOnlyInstagramProfile(profile = {}) {
  if (profile.source !== 'meta') return false;
  if (profile.externalUrl) return false;
  if (profile.recentPosts?.length) return false;

  const bio = String(profile.bio || '').trim();
  if (!bio) return true;

  return /(?:查看|See).*(?:Instagram|照片|photos|videos|视频)/i.test(bio)
    && /(?:粉丝|followers|following|帖子|posts)/i.test(bio);
}

function _instagramUsernameFromUrl(url) {
  try {
    const path = new URL(url).pathname;
    return path.split('/').filter(Boolean)[0]?.toLowerCase() || null;
  } catch {
    return null;
  }
}

function _sameUrl(a, b) {
  if (!a || !b) return false;
  try {
    const normalize = (url) => {
      const parsed = new URL(url);
      parsed.hash = '';
      parsed.search = '';
      parsed.pathname = parsed.pathname.replace(/\/+$/, '').toLowerCase();
      return `${parsed.hostname.replace(/^www\./, '').toLowerCase()}${parsed.pathname}`;
    };
    return normalize(a) === normalize(b);
  } catch {
    return String(a).replace(/\/+$/, '') === String(b).replace(/\/+$/, '');
  }
}

function _linkedinHasCompanyEvidence(data, company) {
  const companyParts = _matchTokens(company);
  if (!companyParts.length) return true;

  const profile = data.profile || {};
  const chunks = [
    data.url,
    profile.name,
    profile.headline,
    profile.location,
    profile.about,
    ...(profile.experience || []).flatMap(item => Object.values(item || {})),
    ...(profile.education || []).flatMap(item => Object.values(item || {})),
    ...(profile.skills || []),
  ];
  const text = chunks
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  const compactText = text.replace(/[^a-z0-9]/g, '');
  const compactCompany = companyParts.join('');
  const matchedParts = companyParts.filter(part => text.includes(part));

  return matchedParts.length >= Math.min(2, companyParts.length)
    || (compactCompany.length > 2 && compactText.includes(compactCompany.slice(0, Math.min(compactCompany.length, 12))));
}

function _matchTokens(text = '') {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s._-]/gu, ' ')
    .split(/[\s._-]+/)
    .map(t => t.trim())
    .filter(t => t.length > 1);
}

/**
 * 验证 URL 中的用户名是否匹配目标人物姓名
 */
function _urlMatchesName(url, name) {
  try {
    const urlPath = new URL(url).pathname.toLowerCase();
    const nameLower = name.toLowerCase();
    const nameParts = nameLower.split(/\s+/).filter(w => w.length > 1);

    const usernameMatch = urlPath.match(/^\/([\w.]+)\/?/);
    if (!usernameMatch) return true;
    const username = usernameMatch[1];

    if (nameParts.some(part => username.includes(part))) return true;

    const companySuffixes = ['official', 'hq', 'global', 'inc', 'corp', 'ltd'];
    if (companySuffixes.some(s => username.includes(s))) return false;

    return true;
  } catch {
    return true;
  }
}
