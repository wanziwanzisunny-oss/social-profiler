import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { mergeData } from '../src/analyzer/merge.js';
import { generateMarkdown } from '../src/output/markdown.js';
import { generateHtml } from '../src/output/html.js';

const baseData = {
  query: { name: 'Jane Doe', company: 'Acme', depth: 'deep' },
  fetchedAt: '2026-07-04T00:00:00.000Z',
  platforms: {},
  unified: { name: 'Jane Doe' },
};

const analysisWithAngles = {
  company: {},
  person: {},
  salesInsights: {},
  analysisAngles: {
    evidenceBasis: [
      'LinkedIn 动态多次提到 pipeline automation，说明近期关注销售流程效率。',
    ],
    businessOpportunities: [
      '可以围绕 CRM 数据清洗和线索评分提出试点方案。',
    ],
    riskNotes: [
      'Instagram 信息不足，不能据此判断个人兴趣。',
    ],
    nextActions: [
      '先核对公司官网产品页，再准备一封 LinkedIn 破冰消息。',
    ],
  },
};

test('Markdown report renders multi-angle analysis fields', () => {
  const markdown = generateMarkdown(baseData, analysisWithAngles);

  assert.match(markdown, /多角度分析/);
  assert.match(markdown, /证据依据/);
  assert.match(markdown, /业务机会/);
  assert.match(markdown, /风险提醒/);
  assert.match(markdown, /下一步行动/);
  assert.match(markdown, /pipeline automation/);
  assert.match(markdown, /CRM 数据清洗/);
});

test('HTML report renders multi-angle analysis fields', () => {
  const html = generateHtml(baseData, analysisWithAngles);

  assert.match(html, /多角度分析/);
  assert.match(html, /证据依据/);
  assert.match(html, /业务机会/);
  assert.match(html, /风险提醒/);
  assert.match(html, /下一步行动/);
  assert.match(html, /LinkedIn 动态多次提到 pipeline automation/);
});

test('quick reports do not render multi-angle analysis fields', () => {
  const quickData = {
    ...baseData,
    query: { name: 'Jane Doe', company: 'Acme', depth: 'quick' },
  };

  const markdown = generateMarkdown(quickData, analysisWithAngles);
  const html = generateHtml(quickData, analysisWithAngles);

  assert.doesNotMatch(markdown, /多角度分析/);
  assert.doesNotMatch(html, /多角度分析/);
});

test('merged data preserves lookup depth for prompt decisions', () => {
  const merged = mergeData({ name: 'Jane Doe', company: 'Acme', depth: 'deep' }, {}, null);

  assert.equal(merged.query.depth, 'deep');
});

test('depth guidance enables multi-angle analysis only for deep mode', async () => {
  const mod = await import('../src/analyzer/llm.js');

  assert.equal(typeof mod.buildDepthGuidance, 'function');
  assert.match(mod.buildDepthGuidance({ query: { depth: 'deep' } }), /analysisAngles/);
  assert.match(mod.buildDepthGuidance({ query: { depth: 'quick' } }), /不要输出 `analysisAngles`/);
});

test('analysis prompt requests deep-only multi-angle analysis output', async () => {
  const prompt = await readFile(new URL('../prompts/analyze.md', import.meta.url), 'utf-8');

  assert.match(prompt, /analysisAngles/);
  assert.match(prompt, /evidenceBasis/);
  assert.match(prompt, /businessOpportunities/);
  assert.match(prompt, /riskNotes/);
  assert.match(prompt, /nextActions/);
  assert.match(prompt, /quick 模式不要输出 `analysisAngles`/);
});
