import { chromium } from 'playwright';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

/**
 * 启动浏览器 — 优先连接真实 Chrome (CDP)，降级到 Playwright
 *
 * @returns {{ browser: Browser, mode: 'cdp' | 'playwright' }}
 */
export async function launchBrowser(options = {}) {
  // 1. 尝试连接真实 Chrome (CDP)
  try {
    const browser = await chromium.connectOverCDP(config.browser.cdpEndpoint);
    logger.info(`已连接真实 Chrome (CDP: ${config.browser.cdpEndpoint})`);
    return { browser, mode: 'cdp' };
  } catch {
    // Chrome 没开调试端口，降级
  }

  // 2. 降级到 Playwright
  const { headless = config.browser.headless } = options;
  logger.info('启动 Playwright 浏览器...');

  const browser = await chromium.launch({
    headless,
    args: [
      ...config.browser.args,
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-infobars',
      '--disable-background-timer-throttling',
      '--disable-popup-blocking',
      '--disable-translate',
      '--disable-extensions',
      '--enable-features=NetworkService,NetworkServiceInProcess',
    ],
  });

  return { browser, mode: 'playwright' };
}

/**
 * 创建浏览器上下文
 *
 * CDP 模式：复用 Chrome 已有的 context（自带 cookie/登录态），不需要反检测
 * Playwright 模式：创建新 context + 反检测脚本 + 加载 session 文件
 */
export async function createContext(browser, options = {}) {
  const { storageState, platform, mode = 'playwright' } = options;

  // CDP 模式 — 直接用 Chrome 的默认 context
  if (mode === 'cdp') {
    const contexts = browser.contexts();
    const context = contexts[0] || await browser.newContext();
    logger.info(`CDP 模式: 复用 Chrome context${platform ? ` (${platform})` : ''}`);
    return context;
  }

  // Playwright 模式 — 创建带反检测的 context
  const userAgent = config.browser.getRandomUA();

  const contextOptions = {
    viewport: config.browser.viewport,
    locale: config.browser.locale,
    timezoneId: config.browser.timezoneId,
    userAgent,
    ...options,
  };

  if (storageState) {
    contextOptions.storageState = storageState;
  }

  const context = await browser.newContext(contextOptions);

  // 注入反检测脚本
  await context.addInitScript(() => {
    // ========== 基础标记隐藏 ==========

    // 隐藏 webdriver 标记
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

    // 伪造 plugins（真实的 PluginArray 接口）
    const fakePlugins = {
      0: { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      1: { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
      2: { name: 'Native Client', filename: 'internal-nacl', description: '' },
      length: 3,
      item(i) { return this[i] || null; },
      namedItem(name) { return Object.values(this).find(p => p.name === name) || null; },
      refresh() {},
      [Symbol.iterator]: function* () { for (let i = 0; i < this.length; i++) yield this[i]; },
    };
    Object.defineProperty(navigator, 'plugins', { get: () => fakePlugins });

    // 伪造 MimeTypeArray
    const fakeMimeTypes = {
      0: { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
      1: { type: 'text/pdf', suffixes: 'pdf', description: '' },
      length: 2,
      item(i) { return this[i] || null; },
      namedItem(name) { return Object.values(this).find(m => m.type === name) || null; },
      [Symbol.iterator]: function* () { for (let i = 0; i < this.length; i++) yield this[i]; },
    };
    Object.defineProperty(navigator, 'mimeTypes', { get: () => fakeMimeTypes });

    // 伪造 languages
    Object.defineProperty(navigator, 'languages', {
      get: () => ['zh-CN', 'zh', 'en-US', 'en'],
    });
    Object.defineProperty(navigator, 'language', {
      get: () => 'zh-CN',
    });

    // 伪造 hardwareConcurrency（真机通常 4-16）
    Object.defineProperty(navigator, 'hardwareConcurrency', {
      get: () => 8,
    });

    // 伪造 deviceMemory
    Object.defineProperty(navigator, 'deviceMemory', {
      get: () => 8,
    });

    // 伪造 connection
    if (navigator.connection) {
      Object.defineProperty(navigator.connection, 'rtt', { get: () => 50 });
    }

    // ========== 清理自动化标记 ==========

    // 隐藏 automation 相关属性（Playwright/CDP 标记）
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;
    // Puppeteer/Playwright 的其他常见标记
    const cdcKeys = Object.getOwnPropertyNames(window).filter(k => k.startsWith('cdc_'));
    cdcKeys.forEach(k => delete window[k]);

    // Chrome runtime mock
    if (!window.chrome) window.chrome = {};
    if (!window.chrome.runtime) {
      window.chrome.runtime = {
        connect: () => {},
        sendMessage: () => {},
        onMessage: { addListener: () => {}, removeListener: () => {} },
      };
    }
    if (!window.chrome.loadTimes) {
      window.chrome.loadTimes = () => ({
        commitLoadTime: Date.now() / 1000,
        connectionInfo: 'h2',
        finishDocumentLoadTime: Date.now() / 1000 + 0.5,
        finishLoadTime: Date.now() / 1000 + 1,
        firstPaintAfterLoadTime: 0,
        firstPaintTime: Date.now() / 1000 + 0.1,
        navigationType: 'Other',
        npnNegotiatedProtocol: 'h2',
        requestTime: Date.now() / 1000 - 0.3,
        startLoadTime: Date.now() / 1000 - 0.2,
        wasAlternateProtocolAvailable: false,
        wasFetchedViaSpdy: true,
        wasNpnNegotiated: true,
      });
    }
    if (!window.chrome.csi) {
      window.chrome.csi = () => ({
        onloadT: Date.now(),
        pageT: Date.now() - performance.timing.navigationStart,
        startE: performance.timing.navigationStart,
        tran: 15,
      });
    }

    // 隐藏 Playwright 的 __playwright 属性
    delete window.__playwright;
    delete window.__pw_manual;

    // Permissions API mock
    if (navigator.permissions) {
      const originalQuery = navigator.permissions.query.bind(navigator.permissions);
      navigator.permissions.query = (params) => {
        if (params.name === 'notifications') {
          return Promise.resolve({ state: Notification.permission || 'default', onchange: null });
        }
        return originalQuery(params);
      };
    }

    // ========== 高级指纹伪造 ==========

    // WebGL 指纹伪造 — 随机化 renderer/vendor
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (param) {
      // UNMASKED_VENDOR_WEBGL
      if (param === 0x9245) return 'Intel Inc.';
      // UNMASKED_RENDERER_WEBGL
      if (param === 0x9246) {
        const renderers = [
          'Intel Iris OpenGL Engine',
          'Intel(R) UHD Graphics 630',
          'Intel(R) Iris(R) Plus Graphics',
          'ANGLE (Intel, Intel(R) UHD Graphics 630, OpenGL 4.1)',
        ];
        return renderers[Math.floor(Math.random() * renderers.length)];
      }
      return getParameter.call(this, param);
    };

    // WebGL2 同样处理
    if (typeof WebGL2RenderingContext !== 'undefined') {
      const getParameter2 = WebGL2RenderingContext.prototype.getParameter;
      WebGL2RenderingContext.prototype.getParameter = function (param) {
        if (param === 0x9245) return 'Intel Inc.';
        if (param === 0x9246) {
          const renderers = [
            'Intel Iris OpenGL Engine',
            'Intel(R) UHD Graphics 630',
            'Intel(R) Iris(R) Plus Graphics',
            'ANGLE (Intel, Intel(R) UHD Graphics 630, OpenGL 4.1)',
          ];
          return renderers[Math.floor(Math.random() * renderers.length)];
        }
        return getParameter2.call(this, param);
      };
    }

    // Canvas 指纹伪造 — 在 toDataURL 时注入微小噪声
    const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function (type, quality) {
      // 只对小尺寸 canvas（指纹采集用）加噪
      if (this.width <= 16 && this.height <= 16) {
        try {
          const ctx = this.getContext('2d');
          if (ctx) {
            const imageData = ctx.getImageData(0, 0, this.width, this.height);
            for (let i = 0; i < imageData.data.length; i += 4) {
              // 对 RGB 通道加 ±1 的噪声
              imageData.data[i] += (Math.random() > 0.5 ? 1 : -1);
              imageData.data[i + 1] += (Math.random() > 0.5 ? 1 : -1);
            }
            ctx.putImageData(imageData, 0, 0);
          }
        } catch {
          // 跨域 canvas 会失败，忽略
        }
      }
      return originalToDataURL.call(this, type, quality);
    };

    // AudioContext 指纹伪造
    if (typeof AudioContext !== 'undefined') {
      const originalCreateOscillator = AudioContext.prototype.createOscillator;
      AudioContext.prototype.createOscillator = function () {
        const oscillator = originalCreateOscillator.call(this);
        const originalStart = oscillator.start;
        oscillator.start = function (when) {
          // 微调 frequency，打破音频指纹
          this.frequency.value += Math.random() * 0.001;
          return originalStart.call(this, when);
        };
        return oscillator;
      };
    }
  });

  logger.info(`浏览器上下文已创建${platform ? ` (${platform})` : ''} UA: ${userAgent.slice(50, 80)}...`);
  return context;
}

/**
 * 关闭浏览器连接
 *
 * CDP 模式连接的是用户手动启动的真实 Chrome，不主动关闭；
 * Playwright 模式则关闭本次启动的浏览器进程。
 */
export async function closeBrowser(browser, mode = 'playwright') {
  if (!browser) return;
  if (mode === 'cdp') return;
  await browser.close().catch(() => {});
}

/**
 * 关闭上下文
 *
 * CDP 模式复用真实 Chrome 的默认 context，不能关闭；
 * Playwright 模式下 context 是本次创建的，可以安全关闭。
 */
export async function closeContext(context, mode = 'playwright') {
  if (!context || mode === 'cdp') return;
  await context.close().catch(() => {});
}
