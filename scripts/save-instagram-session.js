#!/usr/bin/env node
/**
 * Instagram session 保存脚本
 * 打开浏览器 → 等待用户登录 → 60秒后自动保存 session
 */
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSION_PATH = path.join(__dirname, '..', 'sessions', 'instagram.json');
const WAIT_SECONDS = 60;

async function main() {
  console.log('🚀 启动浏览器...');
  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  });

  // 注入反检测脚本
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  await page.goto('https://www.instagram.com/', { timeout: 45000, waitUntil: 'domcontentloaded' });

  console.log(`\n⏰ 请在 ${WAIT_SECONDS} 秒内完成 Instagram 登录`);
  console.log('   登录成功后脚本会自动保存 session\n');

  // 倒计时
  for (let i = WAIT_SECONDS; i > 0; i--) {
    process.stdout.write(`\r⏳ 剩余 ${i} 秒...`);
    await new Promise(r => setTimeout(r, 1000));
  }
  console.log('\n');

  // 保存 session
  await context.storageState({ path: SESSION_PATH });
  console.log(`✅ Instagram session 已保存到: ${SESSION_PATH}`);

  await browser.close();
  console.log('🎉 完成！');
}

main().catch(err => {
  console.error('❌ 失败:', err.message);
  process.exit(1);
});
