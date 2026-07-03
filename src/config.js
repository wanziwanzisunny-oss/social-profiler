import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config({ override: true });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// UA 池 — 定期更新，覆盖主流 Chrome 版本
const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
];

export const config = {
  // API
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN,
  anthropicBaseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',

  // 路径
  root: ROOT,
  sessionsDir: path.join(ROOT, 'sessions'),
  outputDir: path.join(ROOT, 'output'),
  promptsDir: path.join(ROOT, 'prompts'),

  // 浏览器
  browser: {
    headless: false,
    cdpEndpoint: process.env.CDP_ENDPOINT || 'http://localhost:9222',
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-dev-shm-usage',
    ],
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    userAgents: USER_AGENTS,
    // 随机选一个 UA（每次启动浏览器时可换）
    getRandomUA: () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
  },

  // 速率限制（带随机抖动）
  rateLimits: {
    linkedin:  { maxPerDay: 80, minIntervalMs: 4000,  jitterMs: 3000 },
    facebook:  { maxPerDay: 50, minIntervalMs: 6000,  jitterMs: 4000 },
    instagram: { maxPerDay: 30, minIntervalMs: 10000, jitterMs: 5000 },
    x:         { maxPerDay: 50, minIntervalMs: 8000,  jitterMs: 4000 },
    google:    { maxPerDay: 100, minIntervalMs: 5000,  jitterMs: 5000 },
  },

  // 人类行为模拟
  humanize: {
    minDelay: 800,
    maxDelay: 4000,
  },
};
