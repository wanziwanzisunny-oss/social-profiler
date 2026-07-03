import fs from 'fs/promises';
import path from 'path';
import { config } from '../config.js';

/**
 * 输出 JSON 格式的报告
 */
export async function writeJson(data, filename = null) {
  await fs.mkdir(config.outputDir, { recursive: true });

  const name = filename || `report-${Date.now()}.json`;
  const filePath = path.join(config.outputDir, name);

  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  return filePath;
}
