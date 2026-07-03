import { config } from '../config.js';

const { minDelay, maxDelay } = config.humanize;

/**
 * 随机延迟，模拟人类操作节奏
 * 使用对数分布，短延迟更常见，长延迟偶尔出现（更像真人）
 */
export function randomDelay(min = minDelay, max = maxDelay) {
  // 对数正态分布：大多数在短区间，偶尔有长停顿
  const logMin = Math.log(min);
  const logMax = Math.log(max);
  const logVal = logMin + Math.random() * (logMax - logMin);
  const ms = Math.round(Math.exp(logVal));
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 模拟人类滚动
 */
export async function humanScroll(page, distance = null) {
  const scrollDist = distance || Math.floor(Math.random() * 500) + 200;
  const steps = Math.floor(Math.random() * 4) + 2;

  for (let i = 0; i < steps; i++) {
    const stepDist = scrollDist / steps + (Math.random() - 0.5) * 50;
    await page.mouse.wheel(0, stepDist);
    await randomDelay(80, 400);
  }

  // 滚动后「看一下」的停顿
  await randomDelay(500, 1500);
}

/**
 * 模拟鼠标移动到元素（贝塞尔曲线路径）
 */
export async function humanMoveTo(page, selector) {
  const element = await page.$(selector);
  if (!element) return;

  const box = await element.boundingBox();
  if (!box) return;

  // 目标点加随机偏移
  const targetX = box.x + box.width * (0.3 + Math.random() * 0.4);
  const targetY = box.y + box.height * (0.3 + Math.random() * 0.4);

  // 用多步移动模拟真人鼠标轨迹
  const steps = Math.floor(Math.random() * 8) + 5;
  await page.mouse.move(targetX, targetY, { steps });
  await randomDelay(100, 400);
}

/**
 * 模拟人类打字（带随机停顿和偶尔打错字）
 */
export async function humanType(page, selector, text) {
  await humanMoveTo(page, selector);
  await page.click(selector);
  await randomDelay(300, 800);

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    await page.keyboard.type(char, {
      delay: Math.floor(Math.random() * 180) + 40,
    });

    // 偶尔停顿一下「思考」（约 10% 概率）
    if (Math.random() < 0.1) {
      await randomDelay(300, 1200);
    }
  }
}

/**
 * 安全地等待并点击元素
 */
export async function safeClick(page, selector, options = {}) {
  const { timeout = 10000 } = options;

  await page.waitForSelector(selector, { timeout });
  await humanMoveTo(page, selector);
  await randomDelay(150, 500);
  await page.click(selector);
}

/**
 * 模拟「随便看看」— 在页面上随机移动鼠标、滚动
 * 用于导航到新页面后的预热行为
 */
export async function casualBrowse(page, durationMs = 2000) {
  const start = Date.now();

  while (Date.now() - start < durationMs) {
    const action = Math.random();

    if (action < 0.4) {
      // 随机滚动一小段
      const dist = Math.floor(Math.random() * 300) + 100;
      await page.mouse.wheel(0, Math.random() > 0.5 ? dist : -dist);
      await randomDelay(200, 600);
    } else if (action < 0.7) {
      // 随机移动鼠标
      const x = Math.floor(Math.random() * 1000) + 200;
      const y = Math.floor(Math.random() * 600) + 100;
      await page.mouse.move(x, y, { steps: Math.floor(Math.random() * 5) + 3 });
      await randomDelay(200, 500);
    } else {
      // 停顿「阅读」
      await randomDelay(500, 1500);
    }
  }
}
