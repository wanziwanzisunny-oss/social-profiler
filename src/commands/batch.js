/**
 * 批量查询 — 从文件读取多个目标，顺序执行
 */
import fs from 'fs/promises';
import path from 'path';
import { executeLookup } from './lookup.js';
import { printer } from '../output/printer.js';
import { config } from '../config.js';

/**
 * 解析输入文件（自动识别 CSV / JSON）
 */
async function parseInputFile(filePath) {
  const content = await fs.readFile(filePath, 'utf-8');
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.json') {
    return JSON.parse(content);
  }

  // CSV 解析（简单实现，不依赖第三方库）
  if (ext === '.csv') {
    const lines = content.trim().split('\n');
    if (lines.length < 2) throw new Error('CSV 文件至少需要表头+一行数据');

    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    const nameIdx = headers.indexOf('name');
    const companyIdx = headers.indexOf('company');

    if (nameIdx === -1) throw new Error('CSV 缺少 "name" 列');

    return lines.slice(1).map(line => {
      const cols = line.split(',').map(c => c.trim());
      return {
        name: cols[nameIdx] || '',
        company: companyIdx >= 0 ? (cols[companyIdx] || '') : '',
      };
    }).filter(t => t.name);
  }

  throw new Error(`不支持的文件格式: ${ext}（支持 .csv / .json）`);
}

/**
 * 执行批量查询
 */
export async function executeBatch(inputFile, options = {}) {
  const { lang = 'zh', depth = 'quick', output = 'both', delay = 5000 } = options;

  // 读取输入
  printer.title('批量查询');
  const targets = await parseInputFile(inputFile);
  printer.info(`读取到 ${targets.length} 个目标`);

  const results = [];
  const startTime = Date.now();

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    const label = `[${i + 1}/${targets.length}] ${target.name}${target.company ? ` @ ${target.company}` : ''}`;
    const itemStart = Date.now();

    printer.title(label);

    try {
      const { merged, analysis, files, warnings } = await executeLookup(
        target,
        { lang, depth, output }
      );

      const duration = ((Date.now() - itemStart) / 1000).toFixed(1);
      printer.success(`完成 (${duration}s)`);

      if (warnings?.length) {
        warnings.forEach(w => printer.warn(`  ${w}`));
      }

      if (files.json) printer.info(`  JSON: ${files.json}`);
      if (files.md) printer.info(`  报告: ${files.md}`);

      results.push({
        index: i + 1,
        name: target.name,
        company: target.company || '',
        status: 'success',
        duration: parseFloat(duration),
        files,
      });
    } catch (err) {
      const duration = ((Date.now() - itemStart) / 1000).toFixed(1);
      printer.error(`失败: ${err.message} (${duration}s)`);

      results.push({
        index: i + 1,
        name: target.name,
        company: target.company || '',
        status: 'error',
        error: err.message,
        duration: parseFloat(duration),
      });
    }

    // 条目间延迟（最后一条不需要）
    if (i < targets.length - 1) {
      printer.info(`等待 ${delay / 1000}s...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  // 汇总报告
  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
  const successCount = results.filter(r => r.status === 'success').length;
  const errorCount = results.filter(r => r.status === 'error').length;

  const summary = {
    inputFile,
    totalTargets: targets.length,
    successCount,
    errorCount,
    totalDuration: parseFloat(totalDuration),
    timestamp: new Date().toISOString(),
    results,
  };

  // 写入汇总文件
  const summaryFilename = `batch-summary-${new Date().toISOString().slice(0, 10)}.json`;
  await fs.mkdir(config.outputDir, { recursive: true });
  const summaryPath = path.join(config.outputDir, summaryFilename);
  await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2), 'utf-8');

  // 打印汇总
  console.log();
  printer.title('批量查询汇总');
  printer.kv('总数', `${targets.length}`);
  printer.success(`成功: ${successCount}`);
  if (errorCount > 0) printer.error(`失败: ${errorCount}`);
  printer.kv('总耗时', `${totalDuration}s`);
  printer.kv('汇总报告', summaryPath);

  return summary;
}
