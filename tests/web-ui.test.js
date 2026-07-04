import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../src/web/public/index.html', import.meta.url), 'utf-8');

test('history report requests encode filenames before using them in URLs', () => {
  assert.match(html, /function reportApiUrl\(filename, suffix = ''\)/);
  assert.match(html, /encodeURIComponent\(filename\)/);
  assert.doesNotMatch(html, /fetch\(`\/api\/report\/\$\{filename\}`\)/);
  assert.doesNotMatch(html, /fetch\(`\/output\/\$\{mdFilename\}`\)/);
});

test('history has a JSON fallback when Markdown output is missing', () => {
  assert.match(html, /function fallbackReportHTML\(data\)/);
  assert.match(html, /data-has-markdown/);
  assert.match(html, /JSON 报告自动整理/);
  assert.doesNotMatch(html, /无 Markdown 报告/);
});

test('history JSON fallback keeps multi-angle analysis deep-only', () => {
  assert.match(html, /analysis\.analysisAngles/);
  assert.match(html, /query\.depth === 'deep'/);
  assert.match(html, /多角度分析/);
});

test('history tag action does not depend on emoji rendering', () => {
  assert.doesNotMatch(html, /🏷/u);
  assert.match(html, />标签<\/button>/);
});
