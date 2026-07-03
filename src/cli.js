#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { config } from './config.js';
import { printer } from './output/printer.js';

const program = new Command();

program
  .name('social-profiler')
  .description('社交媒体客户画像工具 — 浏览器自动化采集 + LLM 分析')
  .version('0.1.0');

// ==================== lookup 命令 ====================
program
  .command('lookup')
  .description('查询目标人物画像')
  .requiredOption('--name <name>', '目标人物姓名')
  .option('--company <company>', '公司名称')
  .option('--linkedin <url>', '直接指定 LinkedIn URL')
  .option('--output <format>', '输出格式: html / json / md / all', 'html')
  .option('--feishu', '发送报告到飞书')
  .option('--lang <lang>', '报告语言: zh / en', 'zh')
  .option('--depth <depth>', '抓取深度: quick / deep', 'quick')
  .action(async (options) => {
    const { name, company, linkedin, output, lang, depth, feishu } = options;

    try {
      const { executeLookup } = await import('./commands/lookup.js');

      printer.title(`开始查询: ${name}${company ? ` @ ${company}` : ''}`);

      const { merged, analysis, files, warnings } = await executeLookup(
        { name, company, linkedin },
        { lang, depth, output }
      );

      // 显示警告（session 过期等）
      if (warnings?.length) {
        warnings.forEach(w => printer.warn(w));
      }

      if (files.json) printer.success(`JSON 报告: ${files.json}`);
      if (files.md) printer.success(`Markdown 报告: ${files.md}`);
      if (files.html) printer.success(`HTML 报告: ${files.html}`);

      // 发送到飞书
      if (feishu) {
        const { sendToFeishu } = await import('./output/feishu.js');
        const chatId = process.env.FEISHU_CHAT_ID;
        await sendToFeishu(merged, analysis, { chatId, htmlPath: files.html });
        printer.success('已发送到飞书');
      }

      printer.summary(merged, analysis);
    } catch (err) {
      printer.error(`查询失败: ${err.message}`);
      if (process.env.DEBUG) console.error(err);
      process.exit(1);
    }
  });

// ==================== batch 命令 ====================
program
  .command('batch')
  .description('批量查询 — 从文件读取多个目标')
  .requiredOption('--input <file>', '输入文件路径 (CSV / JSON)')
  .option('--output <format>', '输出格式: html / json / md / all', 'html')
  .option('--lang <lang>', '报告语言: zh / en', 'zh')
  .option('--depth <depth>', '抓取深度: quick / deep', 'quick')
  .option('--delay <ms>', '条目间延迟 (毫秒)', '5000')
  .action(async (options) => {
    try {
      const { executeBatch } = await import('./commands/batch.js');

      await executeBatch(options.input, {
        lang: options.lang,
        depth: options.depth,
        output: options.output,
        delay: parseInt(options.delay, 10),
      });
    } catch (err) {
      printer.error(`批量查询失败: ${err.message}`);
      if (process.env.DEBUG) console.error(err);
      process.exit(1);
    }
  });

// ==================== session 命令 ====================
const sessionCmd = program
  .command('session')
  .description('登录态管理');

sessionCmd
  .command('login <platform>')
  .description('登录指定平台 (linkedin / facebook / instagram / x)')
  .action(async (platform) => {
    try {
      const { saveSession } = await import('./browser/session.js');
      const ok = await saveSession(platform);
      if (!ok) {
        printer.warn('登录超时或未完成');
        process.exit(1);
      }
    } catch (err) {
      printer.error(`登录失败: ${err.message}`);
      process.exit(1);
    }
  });

sessionCmd
  .command('status')
  .description('查看所有平台 session 状态')
  .action(async () => {
    try {
      const { checkAllSessions } = await import('./browser/session.js');
      const sessions = await checkAllSessions();

      printer.title('Session 状态');

      // CDP 状态
      const { isCdpAvailable } = await import('./browser/session.js');
      const cdpOk = await isCdpAvailable();
      if (cdpOk) {
        printer.success(`Chrome CDP: 已连接（真实浏览器模式）`);
      } else {
        printer.warn(`Chrome CDP: 未连接（Playwright 模式）`);
        printer.info(`  提示: 启动 Chrome 调试模式可获得更好的反检测效果`);
        printer.info(`  命令: /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222`);
      }

      for (const [platform, info] of Object.entries(sessions)) {
        if (info.exists) {
          printer.success(`${platform}: 已登录 (${info.modifiedAt.toLocaleDateString('zh-CN')})`);
        } else {
          printer.warn(`${platform}: 未登录`);
        }
      }
      console.log();
    } catch (err) {
      printer.error(`检查失败: ${err.message}`);
      process.exit(1);
    }
  });

program.parse();
