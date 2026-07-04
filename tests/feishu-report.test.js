import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildFeishuProfileCard,
  buildFeishuMarkdownCard,
  createDefaultFeishuChat,
  fetchFeishuAppOwnerOpenId,
  findExistingFeishuChat,
  parseFeishuChatId,
  parseFeishuOwnerOpenId,
  parseFeishuSearchChat,
  resolveFeishuChat,
  sendReportFileToFeishu,
  sendToFeishu,
} from '../src/output/feishu.js';

test('sendReportFileToFeishu reads an existing JSON report and sends regenerated HTML', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'social-profiler-feishu-'));
  const filename = 'Jane_Doe-2026-06-21.json';
  const jsonPath = path.join(dir, filename);
  await fs.writeFile(jsonPath, JSON.stringify({
    query: { name: 'Jane Doe', company: 'Acme' },
    fetchedAt: new Date().toISOString(),
    platforms: {},
    unified: { name: 'Jane Doe' },
    analysis: {
      company: { name: 'Acme', mainProducts: ['Widgets'] },
      person: { role: 'Buyer' },
      salesInsights: { entryPoints: ['Lead with cost savings'] },
    },
  }), 'utf8');

  let sent = null;
  const result = await sendReportFileToFeishu(filename, {
    chatId: 'oc_test',
    outputDir: dir,
    sendFn: async (...args) => { sent = args; },
  });

  assert.equal(result.filename, filename);
  assert.equal(result.htmlFilename, 'Jane_Doe-2026-06-21.html');
  assert.equal(result.chatId, 'oc_test');
  assert.equal(result.htmlUrl, 'http://localhost:3000/output/Jane_Doe-2026-06-21.html');
  assert.ok(result.htmlPath.endsWith('Jane_Doe-2026-06-21.html'));
  assert.equal(sent[2].htmlPath, result.htmlPath);
  assert.equal(sent[2].htmlUrl, result.htmlUrl);
});

test('sendReportFileToFeishu rejects path traversal filenames', async () => {
  await assert.rejects(
    () => sendReportFileToFeishu('../secret.json', {
      chatId: 'oc_test',
      outputDir: os.tmpdir(),
      sendFn: async () => {},
    }),
    /非法报告文件名/
  );
});

test('buildFeishuMarkdownCard includes HTML report link when provided', () => {
  const markdown = buildFeishuMarkdownCard({
    query: { name: 'Jane Doe', company: 'Acme' },
    platforms: {},
    unified: { name: 'Jane Doe' },
  }, {
    company: { name: 'Acme' },
    salesInsights: { entryPoints: [] },
  }, {
    htmlUrl: 'http://localhost:3000/output/Jane_Doe-2026-06-21.html',
  });

  assert.match(markdown, /HTML 报告/);
  assert.match(markdown, /http:\/\/localhost:3000\/output\/Jane_Doe-2026-06-21.html/);
});

test('buildFeishuMarkdownCard includes X, company socials, and excluded source hints', () => {
  const markdown = buildFeishuMarkdownCard({
    query: { name: 'Jane Doe', company: 'Acme' },
    platforms: {
      linkedin: { found: true, url: 'https://linkedin.com/in/jane' },
      instagram: {
        found: true,
        url: 'https://instagram.com/notjane',
        excludedFromAnalysis: true,
        note: '@notjane 与 Jane Doe 的匹配度不足，已排除出兴趣爱好分析',
      },
      x: { found: true, url: 'https://x.com/janedoe' },
      companyInstagram: { found: true, url: 'https://instagram.com/acme', scope: 'company' },
      companyFacebook: {
        found: true,
        url: 'https://facebook.com/acme',
        excludedFromAnalysis: true,
        note: 'Acme Facebook 匹配度不足，已排除出公司/产品分析',
      },
      companyX: { found: true, url: 'https://x.com/acme', scope: 'company' },
    },
    unified: { name: 'Jane Doe' },
  }, {
    company: { name: 'Acme' },
    salesInsights: { entryPoints: [] },
  });

  assert.match(markdown, /LinkedIn ✅/);
  assert.match(markdown, /X ✅/);
  assert.match(markdown, /公司 Instagram ✅/);
  assert.match(markdown, /公司 X ✅/);
  assert.doesNotMatch(markdown, /\[Instagram\]\(https:\/\/instagram.com\/notjane\)/);
  assert.match(markdown, /\*\*数据可信度提示\*\*/);
  assert.match(markdown, /Instagram：仅展示/);
  assert.match(markdown, /公司 Facebook：仅展示/);
  assert.match(markdown, /匹配度不足/);
  assert.match(markdown, /\[X\]\(https:\/\/x.com\/janedoe\)/);
  assert.match(markdown, /\[公司 Instagram\]\(https:\/\/instagram.com\/acme\)/);
  assert.match(markdown, /\[公司 X\]\(https:\/\/x.com\/acme\)/);
});

test('buildFeishuProfileCard builds an interactive customer profile card', () => {
  const card = buildFeishuProfileCard({
    query: { name: 'Jane Doe', company: 'Acme' },
    platforms: {
      linkedin: { found: true, url: 'https://linkedin.com/in/jane' },
      x: { found: true, url: 'https://x.com/janedoe' },
      instagram: {
        found: true,
        url: 'https://instagram.com/notjane',
        excludedFromAnalysis: true,
        note: '@notjane 匹配度不足',
        profile: {
          username: 'notjane',
          bio: 'Outdoor photos',
          followersCount: 1200,
          recentPosts: [{ caption: 'Trail day', likes: 18, comments: 2 }],
        },
      },
      companyInstagram: {
        found: true,
        url: 'https://instagram.com/acme',
        profile: {
          username: 'acme',
          followersCount: 9000,
          recentPosts: [{ caption: 'Launching a new product line for enterprise buyers' }],
        },
      },
      companyX: {
        found: true,
        url: 'https://x.com/acme',
        profile: {
          username: 'acme',
          bio: 'Industrial widgets',
          recentPosts: [{ text: 'Expansion update' }],
        },
      },
    },
    unified: {
      name: 'Jane Doe',
      headline: 'VP Sales',
      location: 'Shanghai',
      about: 'Experienced commercial leader focused on channel growth and enterprise accounts.',
      skills: ['Procurement', 'Operations'],
      socialStats: { xFollowers: 2400, instagramFollowers: 1200 },
      contacts: {
        sources: [
          { type: 'email', value: 'jane@example.com', scope: 'person', sourceTitle: 'Company site' },
        ],
      },
    },
  }, {
    company: {
      name: 'Acme',
      mainProducts: ['Widgets'],
      scale: '中型企业',
      targetMarket: '北美制造业',
      competitors: ['Globex'],
      recentNews: ['发布新产品'],
    },
    person: {
      role: 'VP Sales',
      decisionLevel: '高',
      expertise: ['采购', '供应链'],
      personality: '务实',
      hobbies: ['高尔夫'],
      communicationStyle: '数据驱动',
      recentConcerns: ['降本增效'],
    },
    salesInsights: {
      entryPoints: ['1. Lead with ROI', '2. Mention expansion'],
      suggestedApproach: '先从业务增长切入',
      bestChannel: 'LinkedIn',
      timing: '新产品发布后 2 周内',
    },
  }, {
    htmlUrl: 'http://localhost:3000/output/Jane_Doe.html',
  });

  assert.equal(card.config.wide_screen_mode, true);
  assert.equal(card.header.title.content, '📋 客户画像：Jane Doe @ Acme');
  const cardText = card.elements
    .filter(el => el.tag === 'markdown')
    .map(el => el.content)
    .join('\n');
  assert.doesNotMatch(cardText, /客户画像：Jane Doe @ Acme/);
  assert.match(cardText, /数据来源/);
  assert.match(cardText, /👤 人物/);
  assert.match(cardText, /职位/);
  assert.match(cardText, /VP Sales/);
  assert.match(cardText, /☎️ 公开联系方式/);
  assert.match(cardText, /jane@example.com/);
  assert.match(cardText, /🏢 公司/);
  assert.match(cardText, /中型企业/);
  assert.match(cardText, /北美制造业/);
  assert.match(cardText, /💡 切入点/);
  assert.match(cardText, /- Lead with ROI/);
  assert.match(cardText, /- Mention expansion/);
  assert.match(cardText, /Lead with ROI/);
  assert.match(cardText, /建议/);
  assert.match(cardText, /渠道/);
  assert.doesNotMatch(cardText, /1\. Lead with ROI/);
  assert.doesNotMatch(cardText, /a\. 1\. Lead with ROI/);
  assert.doesNotMatch(cardText, /🔗 链接/);
  assert.doesNotMatch(cardText, /📄 HTML 报告/);
  assert.doesNotMatch(cardText, /数据可信度提示/);
  assert.doesNotMatch(cardText, /数据来源明细/);
  assert.doesNotMatch(cardText, /Launching a new product line/);
  assert.ok(card.elements.some(el => el.tag === 'hr'));

  const actions = card.elements.find(el => el.tag === 'action');
  assert.ok(actions);
  assert.ok(actions.actions.some(action => action.text.content === '打开 HTML 报告'));
  assert.ok(actions.actions.some(action => action.text.content === 'LinkedIn'));
  assert.ok(actions.actions.some(action => action.text.content === 'X'));
  assert.equal(actions.actions.find(action => action.text.content === '打开 HTML 报告').type, 'primary');
  assert.equal(actions.actions.find(action => action.text.content === 'LinkedIn').type, 'default');
});

test('Feishu messages include multi-angle analysis only for deep reports', () => {
  const merged = {
    query: { name: 'Jane Doe', company: 'Acme', depth: 'deep' },
    platforms: {},
    unified: { name: 'Jane Doe' },
  };
  const analysis = {
    company: { name: 'Acme' },
    salesInsights: { entryPoints: [] },
    analysisAngles: {
      evidenceBasis: ['LinkedIn 动态多次提到 pipeline automation。'],
      businessOpportunities: ['围绕 CRM 数据清洗提出试点。'],
      riskNotes: ['Instagram 信息不足。'],
      nextActions: ['先核对公司官网产品页。'],
    },
  };

  const card = buildFeishuProfileCard(merged, analysis);
  const cardText = card.elements
    .filter(el => el.tag === 'markdown')
    .map(el => el.content)
    .join('\n');
  const markdown = buildFeishuMarkdownCard(merged, analysis);

  assert.match(cardText, /多角度分析/);
  assert.match(cardText, /pipeline automation/);
  assert.match(markdown, /多角度分析/);
  assert.match(markdown, /CRM 数据清洗/);

  const quickMerged = {
    ...merged,
    query: { name: 'Jane Doe', company: 'Acme', depth: 'quick' },
  };
  const quickCard = buildFeishuProfileCard(quickMerged, analysis);
  const quickCardText = quickCard.elements
    .filter(el => el.tag === 'markdown')
    .map(el => el.content)
    .join('\n');
  const quickMarkdown = buildFeishuMarkdownCard(quickMerged, analysis);

  assert.doesNotMatch(quickCardText, /多角度分析/);
  assert.doesNotMatch(quickMarkdown, /多角度分析/);
});

test('buildFeishuProfileCard tolerates null optional profile sections', () => {
  const card = buildFeishuProfileCard({
    query: { name: 'Null Fields', company: 'Acme' },
    platforms: null,
    unified: {
      name: 'Null Fields',
      socialStats: null,
      socialActivity: null,
      contacts: null,
    },
    companyResearch: null,
    warnings: null,
  }, {
    company: null,
    person: null,
    salesInsights: null,
  });

  assert.equal(card.header.title.content, '📋 客户画像：Null Fields @ Acme');
  assert.ok(card.elements.some(el => el.tag === 'markdown' && el.content.includes('暂无可用来源')));
});

test('resolveFeishuChat prefers explicit chat id without creating a default chat', async () => {
  let createCalled = false;
  const result = await resolveFeishuChat({
    chatId: 'oc_explicit',
    env: { FEISHU_CHAT_ID: 'oc_env' },
    createChatFn: async () => {
      createCalled = true;
      return { chatId: 'oc_created' };
    },
  });

  assert.equal(result.chatId, 'oc_explicit');
  assert.equal(result.source, 'explicit');
  assert.equal(createCalled, false);
});

test('resolveFeishuChat uses FEISHU_CHAT_ID before saved settings', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'social-profiler-feishu-settings-'));
  await fs.writeFile(path.join(dir, 'settings.json'), JSON.stringify({
    feishu: { chatId: 'oc_saved', chatName: '客户画像' },
  }), 'utf8');

  const result = await resolveFeishuChat({
    env: { FEISHU_CHAT_ID: 'oc_env' },
    settingsPath: path.join(dir, 'settings.json'),
    createChatFn: async () => {
      throw new Error('should not create');
    },
  });

  assert.equal(result.chatId, 'oc_env');
  assert.equal(result.source, 'env');
});

test('resolveFeishuChat reuses saved default chat', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'social-profiler-feishu-settings-'));
  await fs.writeFile(path.join(dir, 'settings.json'), JSON.stringify({
    feishu: { chatId: 'oc_saved', chatName: '客户画像', source: 'auto-created' },
  }), 'utf8');

  const result = await resolveFeishuChat({
    env: {},
    settingsPath: path.join(dir, 'settings.json'),
    createChatFn: async () => {
      throw new Error('should not create');
    },
  });

  assert.equal(result.chatId, 'oc_saved');
  assert.equal(result.chatName, '客户画像');
  assert.equal(result.source, 'settings');
});

test('resolveFeishuChat creates and saves default chat when no destination exists', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'social-profiler-feishu-settings-'));
  const settingsPath = path.join(dir, 'settings.json');
  const result = await resolveFeishuChat({
    env: {},
    settingsPath,
    findChatFn: async () => null,
    createChatFn: async () => ({ chatId: 'oc_created', chatName: '客户画像' }),
  });

  const saved = JSON.parse(await fs.readFile(settingsPath, 'utf8'));

  assert.equal(result.chatId, 'oc_created');
  assert.equal(result.chatName, '客户画像');
  assert.equal(result.source, 'created');
  assert.equal(saved.feishu.chatId, 'oc_created');
  assert.equal(saved.feishu.chatName, '客户画像');
  assert.equal(saved.feishu.source, 'auto-created');
});

test('resolveFeishuChat reuses existing default-name chat before creating a new one', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'social-profiler-feishu-settings-'));
  const settingsPath = path.join(dir, 'settings.json');
  let createCalled = false;
  const result = await resolveFeishuChat({
    env: {},
    settingsPath,
    findChatFn: async () => ({ chatId: 'oc_existing', chatName: '客户画像' }),
    createChatFn: async () => {
      createCalled = true;
      return { chatId: 'oc_created', chatName: '客户画像' };
    },
  });
  const saved = JSON.parse(await fs.readFile(settingsPath, 'utf8'));

  assert.equal(result.chatId, 'oc_existing');
  assert.equal(result.source, 'found');
  assert.equal(createCalled, false);
  assert.equal(saved.feishu.chatId, 'oc_existing');
  assert.equal(saved.feishu.source, 'found');
});

test('resolveFeishuChat still returns created chat when saving settings fails', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'social-profiler-feishu-settings-'));
  const badSettingsPath = path.join(dir, 'settings.json');
  await fs.mkdir(badSettingsPath);

  const result = await resolveFeishuChat({
    env: {},
    settingsPath: badSettingsPath,
    findChatFn: async () => null,
    createChatFn: async () => ({ chatId: 'oc_created', chatName: '客户画像' }),
  });

  assert.equal(result.chatId, 'oc_created');
  assert.equal(result.source, 'created');
  assert.match(result.warning, /默认群保存失败/);
});

test('parseFeishuChatId returns null for invalid JSON output', () => {
  assert.equal(parseFeishuChatId('not json'), null);
});

test('parseFeishuChatId accepts common lark-cli JSON shapes', () => {
  assert.equal(parseFeishuChatId(JSON.stringify({ chat_id: 'oc_a' })), 'oc_a');
  assert.equal(parseFeishuChatId(JSON.stringify({ chatId: 'oc_b' })), 'oc_b');
  assert.equal(parseFeishuChatId(JSON.stringify({ data: { chat_id: 'oc_c' } })), 'oc_c');
  assert.equal(parseFeishuChatId(JSON.stringify({ data: { chatId: 'oc_d' } })), 'oc_d');
});

test('parseFeishuSearchChat picks the earliest normal exact-name chat', () => {
  const chat = parseFeishuSearchChat(JSON.stringify({
    data: {
      chats: [
        { chat_id: 'oc_new', name: '客户画像', chat_status: 'normal', create_time: '2026-06-27T08:00:00Z' },
        { chat_id: 'oc_old', name: '客户画像', chat_status: 'normal', create_time: '2026-06-27T03:00:00Z' },
        { chat_id: 'oc_other', name: '客户画像备份', chat_status: 'normal', create_time: '2026-06-27T01:00:00Z' },
        { chat_id: 'oc_bad', name: '客户画像', chat_status: 'dissolved', create_time: '2026-06-27T00:00:00Z' },
      ],
    },
  }), '客户画像');

  assert.equal(chat.chatId, 'oc_old');
  assert.equal(chat.chatName, '客户画像');
});

test('findExistingFeishuChat searches by exact default chat name and app owner member', async () => {
  let command = null;
  const chat = await findExistingFeishuChat({
    execFileFn: async (bin, args) => {
      command = { bin, args };
      return {
        stdout: JSON.stringify({
          data: {
            chats: [
              { chat_id: 'oc_existing', name: '客户画像', chat_status: 'normal', create_time: '2026-06-27T03:00:00Z' },
            ],
          },
        }),
      };
    },
    ownerOpenId: 'ou_owner',
  });

  assert.equal(chat.chatId, 'oc_existing');
  assert.deepEqual(command.args, [
    'im', '+chat-search',
    '--query', '客户画像',
    '--member-ids', 'ou_owner',
    '--disable-search-by-user',
    '--format', 'json',
    '--page-size', '20',
  ]);
});

test('findExistingFeishuChat refuses broad name-only reuse without app owner', async () => {
  const chat = await findExistingFeishuChat({
    fetchOwnerOpenIdFn: async () => null,
    execFileFn: async () => {
      throw new Error('should not search');
    },
  });

  assert.equal(chat, null);
});

test('parseFeishuOwnerOpenId accepts application owner response', () => {
  assert.equal(parseFeishuOwnerOpenId(JSON.stringify({
    data: { app: { owner: { owner_id: 'ou_owner' } } },
  })), 'ou_owner');
  assert.equal(parseFeishuOwnerOpenId('not json'), null);
});

test('fetchFeishuAppOwnerOpenId reads active lark-cli app owner without leaking secrets', async () => {
  const calls = [];
  const ownerId = await fetchFeishuAppOwnerOpenId({
    execFileFn: async (bin, args) => {
      calls.push({ bin, args });
      if (args[0] === 'auth') {
        return { stdout: JSON.stringify({ appId: 'cli_test' }) };
      }
      return {
        stdout: JSON.stringify({
          data: { app: { owner: { owner_id: 'ou_owner' } } },
        }),
      };
    },
  });

  assert.equal(ownerId, 'ou_owner');
  assert.deepEqual(calls[0].args, ['auth', 'status']);
  assert.deepEqual(calls[1].args, [
    'api', 'GET',
    '/open-apis/application/v6/applications/cli_test',
    '--params', '{"lang":"zh_cn"}',
  ]);
});

test('createDefaultFeishuChat creates private group named 客户画像 and invites app owner', async () => {
  let command = null;
  const result = await createDefaultFeishuChat({
    execFileFn: async (bin, args) => {
      command = { bin, args };
      return { stdout: JSON.stringify({ data: { chat_id: 'oc_created' } }) };
    },
    ownerOpenId: 'ou_owner',
  });

  assert.equal(result.chatId, 'oc_created');
  assert.equal(result.chatName, '客户画像');
  assert.equal(command.bin, 'lark-cli');
  assert.deepEqual(command.args, [
    'im', '+chat-create',
    '--name', '客户画像',
    '--chat-mode', 'group',
    '--type', 'private',
    '--users', 'ou_owner',
    '--format', 'json',
  ]);
});

test('createDefaultFeishuChat refuses to create an invisible bot-only group without owner', async () => {
  await assert.rejects(
    () => createDefaultFeishuChat({
      fetchOwnerOpenIdFn: async () => null,
      execFileFn: async () => {
        throw new Error('should not create');
      },
    }),
    /无法确定飞书应用 owner/
  );
});

test('sendToFeishu auto-creates default chat when no chat id exists', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'social-profiler-feishu-settings-'));
  const calls = [];
  const result = await sendToFeishu({
    query: { name: 'Jane Doe' },
    platforms: {},
    unified: { name: 'Jane Doe' },
  }, {
    company: { name: '未知' },
    salesInsights: { entryPoints: [] },
  }, {
    env: {},
    settingsPath: path.join(dir, 'settings.json'),
    execFileFn: async (bin, args) => {
      calls.push({ bin, args });
      if (args.includes('+chat-search')) {
        return { stdout: JSON.stringify({ data: { chats: [] } }) };
      }
      if (args[0] === 'auth') {
        return { stdout: JSON.stringify({ appId: 'cli_test' }) };
      }
      if (args[0] === 'api') {
        return { stdout: JSON.stringify({ data: { app: { owner: { owner_id: 'ou_owner' } } } }) };
      }
      if (args.includes('+chat-create')) {
        return { stdout: JSON.stringify({ data: { chat_id: 'oc_created' } }) };
      }
      return { stdout: '' };
    },
  });

  assert.equal(result.chatId, 'oc_created');
  const searchCall = calls.find((call) => call.args[1] === '+chat-search');
  assert.ok(searchCall);
  assert.ok(searchCall.args.includes('--member-ids'));
  assert.ok(searchCall.args.includes('ou_owner'));

  const createCall = calls.find((call) => call.args[1] === '+chat-create');
  assert.ok(createCall);
  assert.ok(createCall.args.includes('ou_owner'));

  const sendCall = calls.find((call) => call.args[1] === '+messages-send');
  assert.ok(sendCall);
  assert.ok(sendCall.args.includes('--msg-type'));
  assert.ok(sendCall.args.includes('interactive'));
  assert.match(sendCall.args.join('\n'), /📋 客户画像：Jane Doe/);
  assert.ok(sendCall.args.includes('oc_created'));
});

test('sendToFeishu uses explicit chat id without creating default chat', async () => {
  const calls = [];
  const result = await sendToFeishu({
    query: { name: 'Jane Doe' },
    platforms: {},
    unified: { name: 'Jane Doe' },
  }, {
    company: { name: '未知' },
    salesInsights: { entryPoints: [] },
  }, {
    chatId: 'oc_explicit',
    execFileFn: async (bin, args) => {
      calls.push({ bin, args });
      return { stdout: '' };
    },
  });

  assert.equal(result.chatId, 'oc_explicit');
  assert.equal(result.messageType, 'interactive');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args[1], '+messages-send');
  assert.ok(calls[0].args.includes('--msg-type'));
  assert.ok(calls[0].args.includes('interactive'));
  assert.match(calls[0].args.join('\n'), /📋 客户画像：Jane Doe/);
  assert.ok(calls[0].args.includes('oc_explicit'));
});

test('sendToFeishu falls back to markdown when interactive card send fails', async () => {
  const calls = [];
  const result = await sendToFeishu({
    query: { name: 'Jane Doe' },
    platforms: {},
    unified: { name: 'Jane Doe' },
  }, {
    company: { name: '未知' },
    salesInsights: { entryPoints: [] },
  }, {
    chatId: 'oc_explicit',
    execFileFn: async (bin, args) => {
      calls.push({ bin, args });
      if (args.includes('interactive')) {
        throw new Error('interactive rejected');
      }
      return { stdout: '' };
    },
  });

  assert.equal(result.chatId, 'oc_explicit');
  assert.equal(result.messageType, 'markdown');
  assert.equal(calls.length, 2);
  assert.ok(calls[0].args.includes('interactive'));
  assert.ok(calls[1].args.includes('--markdown'));
});
