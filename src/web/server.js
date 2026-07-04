import express from 'express';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { config } from '../config.js';
import { startChromeForCdp } from './chrome.js';
import { basenameFromAnyPath } from '../utils/path.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/output', express.static(config.outputDir));

// 标签存储文件
const TAGS_FILE = path.join(config.outputDir, 'tags.json');

// 预设标签
const PRESET_TAGS = ['重点客户', '待跟进', '已成交', '暂不适合', '需回访'];

// ==================== 工具函数 ====================

async function loadTags() {
  try {
    const data = await fs.readFile(TAGS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

async function saveTags(tags) {
  await fs.mkdir(config.outputDir, { recursive: true });
  await fs.writeFile(TAGS_FILE, JSON.stringify(tags, null, 2), 'utf-8');
}

function isReportFilename(filename) {
  return path.basename(filename) === filename
    && filename.endsWith('.json')
    && filename !== 'tags.json'
    && filename !== 'settings.json'
    && !filename.startsWith('batch-summary');
}

function reportPath(filename) {
  if (!isReportFilename(filename)) {
    throw new Error('无效的报告文件名');
  }
  return path.join(config.outputDir, filename);
}

// ==================== API: Session 状态 ====================
app.get('/api/session/status', async (req, res) => {
  try {
    const { checkAllSessions, isCdpAvailable } = await import('../browser/session.js');
    const sessions = await checkAllSessions();
    sessions.cdp = {
      connected: await isCdpAvailable(),
      endpoint: config.browser.cdpEndpoint,
    };
    res.json(sessions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== API: 启动专用 Chrome ====================
app.post('/api/session/chrome/start', async (req, res) => {
  try {
    const result = await startChromeForCdp();
    res.json(result);
  } catch (err) {
    const message = err.message.startsWith('启动 Chrome 失败')
      ? err.message
      : `启动 Chrome 失败: ${err.message}`;
    res.status(500).json({ error: message });
  }
});

// ==================== API: 平台登录（SSE 流） ====================
app.post('/api/session/login/:platform', async (req, res) => {
  const { platform } = req.params;
  const validPlatforms = ['linkedin', 'instagram', 'facebook', 'x'];

  if (!validPlatforms.includes(platform)) {
    return res.status(400).json({ error: `不支持的平台: ${platform}` });
  }

  // SSE 头
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  res.socket?.setNoDelay?.(true);

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    res.flush?.();
  };

  try {
    const { saveSession } = await import('../browser/session.js');

    send('progress', { message: `正在打开 ${platform} 登录页面...` });

    const success = await saveSession(platform);

    if (success) {
      send('success', { message: `${platform} 登录成功！` });
    } else {
      send('error', { message: `${platform} 登录超时，请重试` });
    }
  } catch (err) {
    send('error', { message: err.message });
  }

  res.end();
});

// ==================== API: 生成 HTML 报告 ====================
app.get('/api/report/:filename/html', async (req, res) => {
  try {
    const filename = req.params.filename;
    const jsonPath = reportPath(filename);
    const data = JSON.parse(await fs.readFile(jsonPath, 'utf-8'));

    const { generateHtml, writeHtml } = await import('../output/html.js');
    const htmlContent = generateHtml(data, data.analysis || {});
    const htmlPath = await writeHtml(htmlContent, filename.replace('.json', '.html'));

    const htmlName = basenameFromAnyPath(htmlPath);
    res.json({ filename: htmlName, url: '/output/' + htmlName });
  } catch (err) {
    res.status(500).json({ error: 'HTML 生成失败: ' + err.message });
  }
});

// ==================== API: 发送报告到飞书 ====================
app.post('/api/report/:filename/feishu', async (req, res) => {
  try {
    const filename = req.params.filename;
    const { sendReportFileToFeishu } = await import('../output/feishu.js');
    const result = await sendReportFileToFeishu(filename, {
      chatId: process.env.FEISHU_CHAT_ID,
    });

    res.json({
      ok: true,
      filename: result.filename,
      htmlFilename: result.htmlFilename,
      message: '已发送到飞书',
    });
  } catch (err) {
    res.status(500).json({ error: '飞书发送失败: ' + err.message });
  }
});

// ==================== API: 生成 PDF ====================
app.get('/api/report/:filename/pdf', async (req, res) => {
  try {
    const filename = req.params.filename;
    const jsonPath = reportPath(filename);
    const data = JSON.parse(await fs.readFile(jsonPath, 'utf-8'));

    // 用 Playwright 将 HTML 报告渲染为 PDF
    const { generateHtml } = await import('../output/html.js');
    const htmlContent = generateHtml(data, data.analysis || {});

    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: 'networkidle' });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
      printBackground: true,
    });

    await browser.close();

    const pdfName = filename.replace('.json', '.pdf');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(pdfName)}"`);
    res.send(pdfBuffer);
  } catch (err) {
    res.status(500).json({ error: 'PDF 生成失败: ' + err.message });
  }
});

// ==================== API: 历史查询（支持搜索+筛选） ====================
app.get('/api/history', async (req, res) => {
  try {
    const { q, from, to, tag } = req.query;

    const files = await fs.readdir(config.outputDir);
    const jsonFiles = files.filter(isReportFilename);

    const tags = await loadTags();

    const history = await Promise.all(
      jsonFiles.map(async (f) => {
        const stat = await fs.stat(path.join(config.outputDir, f));
        const fileTags = tags[f] || [];

        // 读取报告内容以支持关键字搜索，同时避免系统配置文件混入历史记录
        let name = '', company = '';
        let isReport = false;
        try {
          const content = JSON.parse(await fs.readFile(path.join(config.outputDir, f), 'utf-8'));
          name = content?.query?.name || content?.unified?.name || '';
          company = content?.query?.company || '';
          isReport = !!(content?.query || content?.unified || content?.analysis || content?.platforms);
        } catch {
          isReport = false;
        }

        if (!isReport) return null;

        return {
          filename: f,
          createdAt: stat.mtime,
          name,
          company,
          tags: fileTags,
        };
      })
    );

    // 筛选
    let filtered = history.filter(Boolean);

    // 关键字搜索
    if (q) {
      const query = q.toLowerCase();
      filtered = filtered.filter(h =>
        h.name.toLowerCase().includes(query) ||
        h.company.toLowerCase().includes(query) ||
        h.filename.toLowerCase().includes(query)
      );
    }

    // 日期筛选
    if (from) {
      const fromDate = new Date(from);
      filtered = filtered.filter(h => new Date(h.createdAt) >= fromDate);
    }
    if (to) {
      const toDate = new Date(to);
      toDate.setHours(23, 59, 59, 999);
      filtered = filtered.filter(h => new Date(h.createdAt) <= toDate);
    }

    // 标签筛选
    if (tag) {
      filtered = filtered.filter(h => h.tags.includes(tag));
    }

    filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(filtered);
  } catch (err) {
    res.json([]);
  }
});

// ==================== API: 读取报告 ====================
app.delete('/api/report/:filename', async (req, res) => {
  try {
    const filename = req.params.filename;
    const jsonPath = reportPath(filename);
    await fs.access(jsonPath);

    const baseName = filename.replace(/\.json$/, '');
    const relatedFiles = ['.json', '.md', '.html', '.pdf'].map(ext => `${baseName}${ext}`);
    const deleted = [];

    for (const file of relatedFiles) {
      try {
        await fs.unlink(path.join(config.outputDir, file));
        deleted.push(file);
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }
    }

    const tags = await loadTags();
    if (tags[filename]) {
      delete tags[filename];
      await saveTags(tags);
    }

    res.json({ ok: true, filename, deleted });
  } catch (err) {
    const status = err.code === 'ENOENT' ? 404 : 400;
    res.status(status).json({ error: status === 404 ? '报告不存在' : err.message });
  }
});

app.get('/api/report/:filename', async (req, res) => {
  try {
    const filePath = reportPath(req.params.filename);
    const content = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(content);

    // 附加标签
    const tags = await loadTags();
    data._tags = tags[req.params.filename] || [];

    res.json(data);
  } catch (err) {
    res.status(404).json({ error: '报告不存在' });
  }
});

// ==================== API: 标签管理 ====================

// 获取预设标签
app.get('/api/tags/presets', (req, res) => {
  res.json(PRESET_TAGS);
});

// 获取所有已使用的标签
app.get('/api/tags', async (req, res) => {
  const tags = await loadTags();
  const allTags = new Set(PRESET_TAGS);
  Object.values(tags).forEach(t => t.forEach(tag => allTags.add(tag)));
  res.json(Array.from(allTags));
});

// 设置报告标签（覆盖）
app.put('/api/tags/:filename', async (req, res) => {
  const { filename } = req.params;
  const { tags } = req.body;

  if (!Array.isArray(tags)) {
    return res.status(400).json({ error: 'tags 必须是数组' });
  }

  const allTags = await loadTags();
  allTags[filename] = tags;
  await saveTags(allTags);

  res.json({ filename, tags });
});

// 批量设置标签
app.post('/api/tags/batch', async (req, res) => {
  const { filenames, tag, action = 'add' } = req.body;

  if (!Array.isArray(filenames) || !tag) {
    return res.status(400).json({ error: '需要 filenames 数组和 tag' });
  }

  const allTags = await loadTags();

  for (const f of filenames) {
    if (!allTags[f]) allTags[f] = [];
    if (action === 'add' && !allTags[f].includes(tag)) {
      allTags[f].push(tag);
    } else if (action === 'remove') {
      allTags[f] = allTags[f].filter(t => t !== tag);
    }
  }

  await saveTags(allTags);
  res.json({ updated: filenames.length, tag, action });
});

// ==================== API: 查询（SSE 流） ====================
app.post('/api/lookup', async (req, res) => {
  const { name, company, linkedin, lang = 'zh', depth = 'quick', feishu = false } = req.body;

  if (!name) {
    return res.status(400).json({ error: '请输入目标人物姓名' });
  }

  // SSE 头
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  res.socket?.setNoDelay?.(true);

  const send = (event, data) => {
    if (res.destroyed || res.writableEnded) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    res.flush?.();
  };

  const startedAt = Date.now();
  let lastProgress = { phase: 1, message: '准备查询...', at: startedAt };
  let heartbeatTimer = null;
  const lookupAbortController = new AbortController();
  const abortLookup = () => {
    if (!res.writableEnded && !lookupAbortController.signal.aborted) {
      lookupAbortController.abort();
    }
  };

  req.on('aborted', abortLookup);
  res.on('close', abortLookup);

  try {
    const { executeLookup } = await import('../commands/lookup.js');

    const onProgress = (phase, message) => {
      lastProgress = { phase, message, at: Date.now() };
      send('progress', { phase, message });
    };

    heartbeatTimer = setInterval(() => {
      send('heartbeat', {
        phase: lastProgress.phase,
        message: lastProgress.message,
        elapsedSeconds: Math.floor((Date.now() - startedAt) / 1000),
        secondsSinceProgress: Math.floor((Date.now() - lastProgress.at) / 1000),
      });
    }, 10000);

    onProgress(1, '开始查询...');

    const { merged, analysis, files, warnings } = await executeLookup(
      { name, company, linkedin },
      { lang, depth, output: 'all', signal: lookupAbortController.signal },
      {},
      onProgress
    );

    let markdown = null;
    if (files.md) {
      markdown = await fs.readFile(files.md, 'utf-8');
    }

    // 发送到飞书
    if (feishu) {
      try {
        const { sendToFeishu } = await import('../output/feishu.js');
        const chatId = process.env.FEISHU_CHAT_ID;
        await sendToFeishu(merged, analysis, { chatId, htmlPath: files.html });
        send('progress', { phase: 5, message: '已发送到飞书 ✓' });
      } catch (err) {
        send('progress', { phase: 5, message: `飞书发送失败: ${err.message}` });
      }
    }

    send('result', {
      merged,
      analysis,
      markdown,
      files,
      warnings,
      feishuSent: !!feishu,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      send('progress', { phase: lastProgress.phase, message: '查询已取消' });
      return;
    }
    send('error', { message: err.message });
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    req.off('aborted', abortLookup);
    res.off('close', abortLookup);
  }

  res.end();
});

// ==================== 启动 ====================
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';

app.listen(PORT, HOST, () => {
  console.log(`\n  Social Profiler Web UI`);
  console.log(`  http://localhost:${PORT}\n`);
});
