import fs from 'fs/promises';
import path from 'path';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { launchBrowser, createContext, closeBrowser } from './launcher.js';

/**
 * 检测 CDP (真实 Chrome) 是否可用
 */
export async function isCdpAvailable() {
  try {
    const res = await fetch(`${config.browser.cdpEndpoint}/json/version`);
    return res.ok;
  } catch {
    return false;
  }
}

const SESSION_FILES = {
  linkedin: 'linkedin.json',
  facebook: 'facebook.json',
  instagram: 'instagram.json',
  x: 'x.json',
};

// 各平台登录成功标志
const LOGIN_INDICATORS = {
  linkedin: {
    // URL 跳转到 feed/mynetwork/feed/ 都算登录成功
    urlPatterns: ['/feed', '/mynetwork', '/messaging', '/notifications'],
    // 或者页面中出现这些元素
    selectors: ['[data-test-id="home-feed"]', '.share-box-feed-outlet', '#global-nav'],
  },
  facebook: {
    urlPatterns: ['/home', '/?sk='],
    selectors: ['[role="feed"]', '[aria-label="Facebook"]', '#mount_0_0'],
  },
  instagram: {
    // Instagram 登录后会跳转到首页或 explore
    urlPatterns: ['/', '/explore', '/direct'],
    // 排除仍在登录页的情况
    excludePatterns: ['/accounts/login'],
    selectors: ['[role="feed"]', 'svg[aria-label="Home"]', 'canvas'],
  },
  x: {
    urlPatterns: ['/home', '/notifications', '/messages'],
    excludePatterns: ['/i/flow/login', '/login'],
    selectors: ['[data-testid="SideNav_AccountSwitcher_Button"]', 'a[data-testid="AppTabBar_Home_Link"]'],
  },
};

/**
 * 获取 session 文件路径
 */
function getSessionPath(platform) {
  const filename = SESSION_FILES[platform];
  if (!filename) throw new Error(`不支持的平台: ${platform}`);
  return path.join(config.sessionsDir, filename);
}

/**
 * 保存登录态（有头模式，自动检测登录成功）
 */
export async function saveSession(platform) {
  const sessionPath = getSessionPath(platform);
  await fs.mkdir(config.sessionsDir, { recursive: true });

  const { browser, mode } = await launchBrowser({ headless: false });

  try {
    const context = await createContext(browser, { platform, mode });

    const urls = {
      linkedin: 'https://www.linkedin.com/login',
      facebook: 'https://www.facebook.com/login',
      instagram: 'https://www.instagram.com/accounts/login/',
      x: 'https://x.com/i/flow/login',
    };

    const page = await context.newPage();
    await page.goto(urls[platform]);

    logger.info(`请在浏览器中登录 ${platform}...`);
    logger.info(`登录成功后将自动保存，无需按回车。`);

    // 自动检测登录状态
    const indicator = LOGIN_INDICATORS[platform];
    let loggedIn = false;
    let checkCount = 0;
    const maxChecks = 300; // 最多等 5 分钟

    while (!loggedIn && checkCount < maxChecks) {
      await new Promise(r => setTimeout(r, 1000));
      checkCount++;

      try {
        const currentUrl = page.url();

        // 排除模式（Instagram 登录页跳转）
        if (indicator.excludePatterns?.some(p => currentUrl.includes(p))) {
          continue;
        }

        // 检查 URL 是否跳转到了已登录页面
        if (indicator.urlPatterns.some(p => currentUrl.includes(p))) {
          loggedIn = true;
          break;
        }

        // 检查页面中是否有已登录标志元素
        for (const selector of indicator.selectors) {
          const el = await page.$(selector);
          if (el) {
            loggedIn = true;
            break;
          }
        }
      } catch {
        // 页面可能还在加载，继续等待
      }

      // 每 10 秒提示一次
      if (checkCount % 10 === 0) {
        logger.info(`  等待登录中... (${checkCount}s)`);
      }
    }

    if (!loggedIn) {
      logger.warn('等待超时，未检测到登录状态');
      return false;
    }

    // 等待页面稳定（登录后可能有跳转）
    await new Promise(r => setTimeout(r, 2000));

    // 保存 storage state
    await context.storageState({ path: sessionPath });
    logger.info(`${platform} 登录态已保存 ✓`);

    return true;
  } finally {
    await closeBrowser(browser, mode);
  }
}

/**
 * 检查 session 文件是否存在
 */
export async function checkSession(platform) {
  const sessionPath = getSessionPath(platform);
  try {
    const stat = await fs.stat(sessionPath);
    return {
      exists: true,
      path: sessionPath,
      modifiedAt: stat.mtime,
    };
  } catch {
    return { exists: false, path: sessionPath };
  }
}

// session 过期阈值（7 天）
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 检查 session 是否可能有效（不打开浏览器，避免触发平台检测）
 * 只检查文件是否存在 + 年龄是否超过阈值
 */
export async function validateSession(platform) {
  const sessionPath = getSessionPath(platform);

  try {
    const stat = await fs.stat(sessionPath);
    const age = Date.now() - stat.mtimeMs;

    if (age > SESSION_MAX_AGE_MS) {
      return { valid: false, reason: 'stale' };
    }

    // 文件存在且未过期，认为有效
    return { valid: true };
  } catch {
    return { valid: false, reason: 'no_file' };
  }
}

/**
 * 检查所有平台 session 状态（含真实验证）
 */
export async function checkAllSessions() {
  const results = {};
  for (const platform of Object.keys(SESSION_FILES)) {
    const base = await checkSession(platform);
    if (base.exists) {
      const validation = await validateSession(platform);
      results[platform] = {
        ...base,
        valid: validation.valid,
        reason: validation.reason || null,
      };
    } else {
      results[platform] = { ...base, valid: false, reason: 'no_file' };
    }
  }
  return results;
}

/**
 * 加载 session 到浏览器上下文
 */
export async function loadSession(platform) {
  const sessionPath = getSessionPath(platform);
  const session = await checkSession(platform);

  if (!session.exists) {
    throw new Error(
      `${platform} 未登录，请先运行: social-profiler session login ${platform}`
    );
  }

  const { browser, mode } = await launchBrowser();
  const context = await createContext(browser, {
    storageState: sessionPath,
    platform,
    mode,
  });

  return { browser, context, mode };
}
