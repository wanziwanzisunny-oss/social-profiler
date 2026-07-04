import fs from 'fs/promises';
import path from 'path';
import { config } from '../config.js';

function safeJoin(val, sep = '、') {
  if (Array.isArray(val)) {
    return val.map(item => {
      if (typeof item === 'string') return item;
      if (typeof item === 'object' && item !== null) {
        return item.title || item.name || item.text || item.label || JSON.stringify(item);
      }
      return String(item ?? '');
    }).join(sep);
  }
  if (typeof val === 'string') return val;
  return '';
}

function safeNum(val) {
  if (val === null || val === undefined) return '-';
  if (typeof val === 'number') return val.toLocaleString();
  return String(val);
}

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 生成独立中文 HTML 客户画像报告
 */
export function generateHtml(data, analysis) {
  const { query, fetchedAt, platforms } = data;
  const unified = data.unified || {};
  const sources = Object.keys(platforms).filter((k) => platforms[k]?.found !== false && !platforms[k]?.excludedFromAnalysis);
  const timeStr = new Date(fetchedAt).toLocaleString('zh-CN');

  const overviewHtml = buildOverview(unified);
  const companyHtml = buildCompany(analysis.company);
  const personHtml = buildPerson(analysis.person);
  const salesHtml = buildSales(analysis.salesInsights);
  const anglesHtml = data.query?.depth === 'deep' ? buildAngles(analysis.analysisAngles) : '';
  const sourcesHtml = buildSources(platforms, data.companyResearch);

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>客户画像 — ${esc(query.name)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,"Noto Sans SC",sans-serif;background:#f8fafc;color:#111827;line-height:1.6;min-height:100vh}
.container{max-width:960px;margin:0 auto;padding:24px 20px 60px}
.header{background:#fff;color:#111827;padding:24px 26px;border-radius:12px;margin-bottom:16px;border:1px solid #e5e7eb;box-shadow:0 1px 2px rgba(15,23,42,.04)}
.header h1{font-size:24px;font-weight:750;margin-bottom:6px;letter-spacing:0}
.header .meta{font-size:13px;color:#64748b}
.section{background:#fff;border-radius:10px;padding:22px 24px;margin-bottom:16px;border:1px solid #e5e7eb;box-shadow:0 1px 2px rgba(15,23,42,.04)}
.section-title{font-size:17px;font-weight:750;margin-bottom:14px;display:flex;align-items:center;gap:8px;color:#111827}
.section-title .icon{font-size:19px}
.info-grid{font-size:14.5px;line-height:2.2}
.info-grid .label{color:#64748b;font-weight:650;display:inline;margin-right:8px}
.info-grid .value{color:#1f2937;display:inline;margin-right:24px}
.about-box{background:#f8fafc;border:1px solid #e2e8f0;border-left:3px solid #2563eb;padding:12px 16px;border-radius:8px;margin:12px 0;font-size:14px;color:#475569}
.stats-row{display:flex;gap:20px;flex-wrap:wrap;margin:10px 0}
.stat-chip{background:#f8fafc;border:1px solid #e2e8f0;padding:5px 12px;border-radius:999px;font-size:13px;color:#475569}
.stat-chip strong{color:#111827}
.link-row{display:flex;gap:12px;flex-wrap:wrap;margin:8px 0}
.link-row a{display:inline-flex;align-items:center;gap:5px;padding:5px 12px;border-radius:8px;font-size:13px;text-decoration:none;color:#1d4ed8;background:#eff6ff;border:1px solid #bfdbfe;transition:background-color .2s,border-color .2s}
.link-row a:hover{background:#dbeafe;border-color:#93c5fd}
.link-row .li,.link-row .ig,.link-row .fb,.link-row .x{background:#eff6ff;color:#1d4ed8}
.skills-row{display:flex;gap:8px;flex-wrap:wrap;margin:6px 0}
.skill-tag{background:#f8fafc;color:#475569;border:1px solid #e2e8f0;padding:4px 10px;border-radius:7px;font-size:13px}
table{width:100%;border-collapse:collapse;font-size:14.5px}
table th{background:#f8fafc;text-align:left;padding:10px 14px;font-weight:650;color:#475569;width:110px;border-bottom:1px solid #e5e7eb;vertical-align:top}
table td{padding:10px 14px;border-bottom:1px solid #eef2f7;color:#1f2937}
table tr:last-child th,table tr:last-child td{border-bottom:none}
.entry-list{list-style:none;counter-reset:entry}
.entry-list li{counter-increment:entry;padding:10px 0 10px 36px;position:relative;font-size:14.5px;border-bottom:1px solid #eef2f7}
.entry-list li:last-child{border-bottom:none}
.entry-list li::before{content:counter(entry);position:absolute;left:0;top:10px;width:24px;height:24px;background:#2563eb;color:#fff;border-radius:50%;font-size:12px;display:flex;align-items:center;justify-content:center;font-weight:700}
.approach-box{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px 18px;margin:10px 0;font-size:14px}
.approach-box .label{font-weight:700;color:#475569;margin-bottom:4px}
.angle-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.angle-card{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px}
.angle-card h3{font-size:14px;font-weight:750;color:#334155;margin-bottom:8px}
.angle-card ul{list-style:disc;padding-left:18px}
.angle-card li{font-size:14px;color:#334155;margin:6px 0}
.source-block{margin-bottom:16px}
.source-heading{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px}
.source-heading h4{font-size:15px;font-weight:700;color:#111827;padding-bottom:6px;border-bottom:2px solid #2563eb;display:inline-block}
.source-badge{display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:600;background:#ecfdf5;color:#047857;border:1px solid #bbf7d0}
.source-badge-warn{background:#fffbeb;color:#92400e;border-color:#fde68a}
.source-list{list-style:none;font-size:14px}
.source-list li{padding:4px 0;color:#334155}
.source-list a{color:#2563eb;text-decoration:none}
.source-list a:hover{text-decoration:underline}
.warn-badge{display:inline-block;background:#fffbeb;color:#92400e;border:1px solid #fde68a;padding:2px 10px;border-radius:999px;font-size:13px;margin:4px 0}
.footer{text-align:center;color:#94a3b8;font-size:12px;margin-top:28px;padding-top:16px;border-top:1px solid #e5e7eb}
@media(max-width:640px){.container{padding:16px 12px 40px}.header{padding:20px 18px}.header h1{font-size:20px}.info-grid{grid-template-columns:1fr}.info-grid .label{text-align:left;margin-top:8px}.section{padding:18px 16px}.angle-grid{grid-template-columns:1fr}}
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>客户画像报告</h1>
    <div class="meta">${esc(query.name)}${query.company ? ` @ ${esc(query.company)}` : ''} · ${timeStr} · ${sources.join(', ')}</div>
  </div>

  ${overviewHtml}
  ${companyHtml}
  ${personHtml}
  ${salesHtml}
  ${anglesHtml}
  ${sourcesHtml}

  <div class="footer">Social Profiler · 由 Claude 生成</div>
</div>
</body>
</html>`;
}

function buildOverview(u) {
  if (!u || !u.name) return '';

  let inner = '';

  inner += `<div class="info-grid">`;
  inner += `<div class="label">姓名</div><div class="value">${esc(u.name)}</div><br>`;
  if (u.headline) inner += `<div class="label">职位</div><div class="value">${esc(u.headline)}</div><br>`;
  if (u.location) inner += `<div class="label">所在地</div><div class="value">📍 ${esc(u.location)}</div>`;
  inner += `</div>`;

  if (u.about) {
    const truncated = u.about.length > 300 ? u.about.slice(0, 300) + '...' : u.about;
    inner += `<div class="about-box">${esc(truncated)}</div>`;
  }

  if (u.socialStats) {
    const s = u.socialStats;
    inner += `<div class="stats-row">`;
    if (s.instagramFollowers) inner += `<span class="stat-chip">Instagram <strong>${safeNum(s.instagramFollowers)}</strong> 粉丝</span>`;
    if (s.instagramPosts) inner += `<span class="stat-chip">Instagram <strong>${safeNum(s.instagramPosts)}</strong> 帖子</span>`;
    if (s.facebookLikes) inner += `<span class="stat-chip">Facebook <strong>${s.facebookLikes}</strong> 赞</span>`;
    if (s.facebookFollowers) inner += `<span class="stat-chip">Facebook <strong>${s.facebookFollowers}</strong> 粉丝</span>`;
    if (s.xFollowers) inner += `<span class="stat-chip">X <strong>${safeNum(s.xFollowers)}</strong> 粉丝</span>`;
    if (s.xFollowing) inner += `<span class="stat-chip">X <strong>${safeNum(s.xFollowing)}</strong> 关注</span>`;
    inner += `</div>`;
  }

  if (u.socialActivity?.instagram) {
    const act = u.socialActivity.instagram;
    let text = `近 ${act.recentPostsCount} 条帖子，平均 ❤️ ${safeNum(act.avgLikes)} / 💬 ${safeNum(act.avgComments)}`;
    if (act.latestPostDate) text += `，最新发布 ${new Date(act.latestPostDate).toLocaleDateString('zh-CN')}`;
    inner += `<div class="stat-chip" style="margin:6px 0">Instagram: ${esc(text)}</div>`;
  }

  if (u.socialActivity?.x) {
    const act = u.socialActivity.x;
    let text = `近 ${act.recentPostsCount} 条公开帖子`;
    if (act.latestPostDate) text += `，最新发布 ${new Date(act.latestPostDate).toLocaleDateString('zh-CN')}`;
    inner += `<div class="stat-chip" style="margin:6px 0">X: ${esc(text)}</div>`;
  }

  if (u.profileLinks) {
    inner += `<div class="link-row">`;
    if (u.profileLinks.linkedin) inner += `<a href="${esc(u.profileLinks.linkedin)}" target="_blank" class="li">LinkedIn</a>`;
    if (u.profileLinks.instagram) inner += `<a href="${esc(u.profileLinks.instagram)}" target="_blank" class="ig">Instagram</a>`;
    if (u.profileLinks.facebook) inner += `<a href="${esc(u.profileLinks.facebook)}" target="_blank" class="fb">Facebook</a>`;
    if (u.profileLinks.x) inner += `<a href="${esc(u.profileLinks.x)}" target="_blank" class="x">X</a>`;
    inner += `</div>`;
  }

  if (u.skills?.length) {
    inner += `<div class="skills-row">`;
    u.skills.forEach(s => { inner += `<span class="skill-tag">${esc(s)}</span>`; });
    inner += `</div>`;
  }

  if (u.contacts) {
    if (u.contacts.sources?.length) {
      inner += `<div class="about-box"><strong>公开联系方式</strong><ul class="source-list" style="margin-top:8px">`;
      u.contacts.sources.slice(0, 5).forEach(c => {
        const type = c.type === 'email' ? '邮箱' : '电话';
        const label = `${type}: ${c.value}（${c.scope === 'person' ? '个人' : '公司'}）`;
        inner += c.sourceUrl
          ? `<li>${esc(label)}，来源：<a href="${esc(c.sourceUrl)}" target="_blank">${esc(c.sourceTitle || c.sourceUrl)}</a></li>`
          : `<li>${esc(label)}，来源：${esc(c.sourceTitle || c.scope || '公开资料')}</li>`;
      });
      inner += `</ul></div>`;
    } else {
      const contacts = [];
      if (u.contacts.verifiedEmails?.length) contacts.push(`邮箱: ${u.contacts.verifiedEmails.join('、')}`);
      if (u.contacts.verifiedPhones?.length) contacts.push(`电话: ${u.contacts.verifiedPhones.join('、')}`);
      if (contacts.length) inner += `<div class="about-box"><strong>公开联系方式</strong>：${esc(contacts.join(' · '))}</div>`;
    }
  }

  return `<div class="section">
    <div class="section-title"><span class="icon">📋</span>人物概览</div>
    ${inner}
  </div>`;
}

function buildCompany(c) {
  if (!c) return '';

  const rows = [
    { label: '公司名', val: c.name },
    { label: '主营产品', val: safeJoin(c.mainProducts) },
    { label: '公司规模', val: c.scale },
    { label: '销售渠道', val: safeJoin(c.salesChannels) },
    { label: '目标市场', val: c.targetMarket },
    { label: '竞品', val: safeJoin(c.competitors) },
    { label: '近期动态', val: safeJoin(c.recentNews) },
  ].filter(r => r.val && r.val !== '-');

  if (!rows.length) return '';

  let tbody = '';
  rows.forEach(r => {
    tbody += `<tr><th>${r.label}</th><td>${esc(r.val)}</td></tr>`;
  });

  return `<div class="section">
    <div class="section-title"><span class="icon">🏢</span>公司信息</div>
    <table>${tbody}</table>
  </div>`;
}

function buildPerson(p) {
  if (!p) return '';

  const rows = [
    { label: '职位', val: p.role },
    { label: '决策层级', val: p.decisionLevel },
    { label: '专业领域', val: safeJoin(p.expertise) },
    { label: '性格特征', val: p.personality },
    { label: '兴趣爱好', val: safeJoin(p.hobbies) },
    { label: '沟通风格', val: p.communicationStyle },
    { label: '近期关注', val: safeJoin(p.recentConcerns) },
  ].filter(r => r.val && r.val !== '-');

  if (!rows.length) return '';

  let tbody = '';
  rows.forEach(r => {
    tbody += `<tr><th>${r.label}</th><td>${esc(r.val)}</td></tr>`;
  });

  return `<div class="section">
    <div class="section-title"><span class="icon">👤</span>个人画像</div>
    <table>${tbody}</table>
  </div>`;
}

function buildSales(s) {
  if (!s) return '';

  let inner = '';

  if (s.entryPoints?.length) {
    inner += `<ol class="entry-list">`;
    s.entryPoints.forEach(ep => { inner += `<li>${esc(ep)}</li>`; });
    inner += `</ol>`;
  }

  const approaches = [
    { label: '推荐沟通方式', val: s.suggestedApproach },
    { label: '最佳渠道', val: s.bestChannel },
    { label: '时机判断', val: s.timing },
  ].filter(a => a.val && a.val !== '-');

  approaches.forEach(a => {
    inner += `<div class="approach-box"><div class="label">${a.label}</div><div>${esc(a.val)}</div></div>`;
  });

  return `<div class="section">
    <div class="section-title"><span class="icon">💡</span>商务切入点</div>
    ${inner}
  </div>`;
}

function safeList(val) {
  if (Array.isArray(val)) {
    return val
      .map(item => {
        if (typeof item === 'string') return item.trim();
        if (typeof item === 'object' && item !== null) {
          return item.title || item.name || item.text || item.label || JSON.stringify(item);
        }
        return String(item ?? '').trim();
      })
      .filter(Boolean);
  }
  if (typeof val === 'string' && val.trim()) return [val.trim()];
  return [];
}

function angleCard(title, values) {
  const items = safeList(values);
  if (!items.length) return '';

  return `<div class="angle-card">
    <h3>${esc(title)}</h3>
    <ul>${items.map(item => `<li>${esc(item)}</li>`).join('')}</ul>
  </div>`;
}

function buildAngles(angles = {}) {
  if (!angles) return '';

  const cards = [
    angleCard('证据依据', angles.evidenceBasis),
    angleCard('业务机会', angles.businessOpportunities),
    angleCard('风险提醒', angles.riskNotes),
    angleCard('下一步行动', angles.nextActions),
  ].filter(Boolean);

  if (!cards.length) return '';

  return `<div class="section">
    <div class="section-title"><span class="icon">🔎</span>多角度分析</div>
    <div class="angle-grid">${cards.join('')}</div>
  </div>`;
}

function sourceBlockStart(title, info = {}) {
  const excluded = !!info.excludedFromAnalysis;
  const badge = excluded
    ? '<span class="source-badge source-badge-warn">仅展示，未纳入分析</span>'
    : '<span class="source-badge">已纳入画像</span>';
  return `<div class="source-block"><div class="source-heading"><h4>${esc(title)}</h4>${badge}</div><ul class="source-list">`;
}

function buildSources(platforms, companyResearch) {
  let inner = '';

  // LinkedIn
  if (platforms.linkedin?.found) {
    const li = platforms.linkedin.profile || {};
    inner += sourceBlockStart('LinkedIn', platforms.linkedin);
    inner += `<li><strong>主页</strong>：<a href="${esc(platforms.linkedin.url)}" target="_blank">${esc(platforms.linkedin.url)}</a></li>`;
    if (li.headline) inner += `<li><strong>简介</strong>：${esc(li.headline)}</li>`;
    if (li.location) inner += `<li><strong>所在地</strong>：${esc(li.location)}</li>`;
    if (li.experience?.length) {
      inner += `<li><strong>工作经历</strong>：<ul>`;
      li.experience.forEach(e => {
        inner += `<li>${esc(e.title || '-')}${e.company ? ` @ ${esc(e.company)}` : ''}${e.duration ? ` (${esc(e.duration)})` : ''}</li>`;
      });
      inner += `</ul></li>`;
    }
    if (li.education?.length) {
      inner += `<li><strong>教育背景</strong>：<ul>`;
      li.education.forEach(e => {
        inner += `<li>${esc(e.school || '-')}${e.degree ? ` · ${esc(e.degree)}` : ''}${e.duration ? ` (${esc(e.duration)})` : ''}</li>`;
      });
      inner += `</ul></li>`;
    }
    if (li.skills?.length) inner += `<li><strong>技能</strong>：${li.skills.map(esc).join('、')}</li>`;
    inner += `</ul></div>`;
  }

  // Instagram
  if (platforms.instagram?.found) {
    const ig = platforms.instagram.profile || {};
    inner += sourceBlockStart('Instagram', platforms.instagram);
    if (platforms.instagram.isCompanyAccount) inner += `<li><span class="warn-badge">⚠️ ${esc(platforms.instagram.note)}</span></li>`;
    if (platforms.instagram.excludedFromAnalysis) inner += `<li><span class="warn-badge">⚠️ ${esc(platforms.instagram.note || '该 Instagram 与目标人物匹配度不足，未用于兴趣爱好分析')}</span></li>`;
    inner += `<li><strong>主页</strong>：<a href="${esc(platforms.instagram.url)}" target="_blank">${esc(platforms.instagram.url)}</a></li>`;
    if (ig.username) inner += `<li><strong>用户名</strong>：@${esc(ig.username)}</li>`;
    if (ig.fullName) inner += `<li><strong>全名</strong>：${esc(ig.fullName)}</li>`;
    if (ig.bio) inner += `<li><strong>简介</strong>：${esc(ig.bio)}</li>`;
    if (ig.followersCount !== null && ig.followersCount !== undefined) inner += `<li><strong>粉丝数</strong>：${safeNum(ig.followersCount)}</li>`;
    if (ig.followingCount !== null && ig.followingCount !== undefined) inner += `<li><strong>关注数</strong>：${safeNum(ig.followingCount)}</li>`;
    if (ig.postsCount !== null && ig.postsCount !== undefined) inner += `<li><strong>帖子数</strong>：${safeNum(ig.postsCount)}</li>`;
    if (ig.isVerified) inner += `<li><strong>认证</strong>：✅</li>`;
    if (ig.externalUrl) inner += `<li><strong>外部链接</strong>：<a href="${esc(ig.externalUrl)}" target="_blank">${esc(ig.externalUrl)}</a></li>`;
    if (ig.recentPosts?.length) {
      inner += `<li><strong>最近帖子</strong>：<ul>`;
      ig.recentPosts.slice(0, 5).forEach(p => {
        const caption = p.caption ? p.caption.slice(0, 80) + (p.caption.length > 80 ? '...' : '') : '(无文字)';
        const stats = [];
        if (p.likes !== null) stats.push(`❤️ ${safeNum(p.likes)}`);
        if (p.comments !== null) stats.push(`💬 ${safeNum(p.comments)}`);
        const type = p.type === 'reel' ? '🎬' : p.type === 'carousel' ? '🖼️' : '📷';
        inner += `<li>${type} ${esc(caption)}${stats.length ? ` (${stats.join(' ')})` : ''}</li>`;
      });
      inner += `</ul></li>`;
    }
    inner += `</ul></div>`;
  }

  // 公司 Instagram
  if (platforms.companyInstagram?.found) {
    const ig = platforms.companyInstagram.profile || {};
    inner += sourceBlockStart('公司 Instagram', platforms.companyInstagram);
    inner += `<li><strong>主页</strong>：<a href="${esc(platforms.companyInstagram.url)}" target="_blank">${esc(platforms.companyInstagram.url)}</a></li>`;
    if (platforms.companyInstagram.excludedFromAnalysis) inner += `<li><span class="warn-badge">⚠️ ${esc(platforms.companyInstagram.note || '该 Instagram 与目标公司匹配度不足，未用于公司/产品分析')}</span></li>`;
    if (ig.username) inner += `<li><strong>用户名</strong>：@${esc(ig.username)}</li>`;
    if (ig.fullName) inner += `<li><strong>名称</strong>：${esc(ig.fullName)}</li>`;
    if (ig.bio) inner += `<li><strong>简介</strong>：${esc(ig.bio)}</li>`;
    if (ig.followersCount !== null && ig.followersCount !== undefined) inner += `<li><strong>粉丝数</strong>：${safeNum(ig.followersCount)}</li>`;
    if (ig.postsCount !== null && ig.postsCount !== undefined) inner += `<li><strong>帖子数</strong>：${safeNum(ig.postsCount)}</li>`;
    if (ig.externalUrl) inner += `<li><strong>外部链接</strong>：<a href="${esc(ig.externalUrl)}" target="_blank">${esc(ig.externalUrl)}</a></li>`;
    if (ig.recentPosts?.length) {
      inner += `<li><strong>最近帖子/产品线索</strong>：<ul>`;
      ig.recentPosts.slice(0, 5).forEach(p => {
        const caption = p.caption ? p.caption.slice(0, 100) + (p.caption.length > 100 ? '...' : '') : '(无文字)';
        inner += `<li>${esc(caption)}</li>`;
      });
      inner += `</ul></li>`;
    }
    inner += `</ul></div>`;
  }

  // Facebook
  if (platforms.facebook?.found) {
    const fb = platforms.facebook.profile || {};
    inner += sourceBlockStart('Facebook', platforms.facebook);
    inner += `<li><strong>主页</strong>：<a href="${esc(platforms.facebook.url)}" target="_blank">${esc(platforms.facebook.url)}</a></li>`;
    if (platforms.facebook.excludedFromAnalysis) inner += `<li><span class="warn-badge">⚠️ ${esc(platforms.facebook.note || '该 Facebook 与目标人物匹配度不足，未用于人物画像分析')}</span></li>`;
    if (fb.fullName) inner += `<li><strong>页面名</strong>：${esc(fb.fullName)}</li>`;
    if (fb.bio) inner += `<li><strong>简介</strong>：${esc(fb.bio)}</li>`;
    if (fb.likesCount) inner += `<li><strong>赞数</strong>：${fb.likesCount}</li>`;
    if (fb.talkingCount) inner += `<li><strong>讨论数</strong>：${fb.talkingCount}</li>`;
    if (fb.followersCount) inner += `<li><strong>粉丝数</strong>：${fb.followersCount}</li>`;
    if (fb.recentPosts?.length) {
      inner += `<li><strong>最近帖子</strong>：<ul>`;
      fb.recentPosts.slice(0, 3).forEach(p => {
        const text = p.text ? p.text.slice(0, 80) + (p.text.length > 80 ? '...' : '') : '(无文字)';
        inner += `<li>${esc(text)}${p.time ? ` (${esc(p.time)})` : ''}</li>`;
      });
      inner += `</ul></li>`;
    }
    inner += `</ul></div>`;
  }

  // X
  if (platforms.x?.found) {
    const x = platforms.x.profile || {};
    inner += sourceBlockStart('X', platforms.x);
    inner += `<li><strong>主页</strong>：<a href="${esc(platforms.x.url)}" target="_blank">${esc(platforms.x.url)}</a></li>`;
    if (platforms.x.excludedFromAnalysis) inner += `<li><span class="warn-badge">⚠️ ${esc(platforms.x.note || '该 X 账号与目标人物匹配度不足，未用于画像分析')}</span></li>`;
    if (x.username) inner += `<li><strong>用户名</strong>：@${esc(x.username)}</li>`;
    if (x.displayName) inner += `<li><strong>显示名</strong>：${esc(x.displayName)}</li>`;
    if (x.bio) inner += `<li><strong>简介</strong>：${esc(x.bio)}</li>`;
    if (x.followersCount !== null && x.followersCount !== undefined) inner += `<li><strong>粉丝数</strong>：${safeNum(x.followersCount)}</li>`;
    if (x.followingCount !== null && x.followingCount !== undefined) inner += `<li><strong>关注数</strong>：${safeNum(x.followingCount)}</li>`;
    if (x.website) inner += `<li><strong>外部链接</strong>：<a href="${esc(x.website)}" target="_blank">${esc(x.website)}</a></li>`;
    if (x.recentPosts?.length) {
      inner += `<li><strong>近期公开帖子</strong>：<ul>`;
      x.recentPosts.slice(0, 3).forEach(p => {
        const text = p.text ? p.text.slice(0, 100) + (p.text.length > 100 ? '...' : '') : '(无文字)';
        inner += `<li>${esc(text)}${p.timestamp ? ` (${new Date(p.timestamp).toLocaleDateString('zh-CN')})` : ''}</li>`;
      });
      inner += `</ul></li>`;
    }
    inner += `</ul></div>`;
  }

  // 公司 X
  if (platforms.companyX?.found) {
    const x = platforms.companyX.profile || {};
    inner += sourceBlockStart('公司 X', platforms.companyX);
    inner += `<li><strong>主页</strong>：<a href="${esc(platforms.companyX.url)}" target="_blank">${esc(platforms.companyX.url)}</a></li>`;
    if (platforms.companyX.excludedFromAnalysis) inner += `<li><span class="warn-badge">⚠️ ${esc(platforms.companyX.note || '该 X 账号与目标公司匹配度不足，未用于公司/产品分析')}</span></li>`;
    if (x.username) inner += `<li><strong>用户名</strong>：@${esc(x.username)}</li>`;
    if (x.displayName) inner += `<li><strong>显示名</strong>：${esc(x.displayName)}</li>`;
    if (x.bio) inner += `<li><strong>简介</strong>：${esc(x.bio)}</li>`;
    if (x.followersCount !== null && x.followersCount !== undefined) inner += `<li><strong>粉丝数</strong>：${safeNum(x.followersCount)}</li>`;
    if (x.followingCount !== null && x.followingCount !== undefined) inner += `<li><strong>关注数</strong>：${safeNum(x.followingCount)}</li>`;
    if (x.website) inner += `<li><strong>外部链接</strong>：<a href="${esc(x.website)}" target="_blank">${esc(x.website)}</a></li>`;
    if (x.recentPosts?.length) {
      inner += `<li><strong>近期公开帖子/产品线索</strong>：<ul>`;
      x.recentPosts.slice(0, 5).forEach(p => {
        const text = p.text ? p.text.slice(0, 100) + (p.text.length > 100 ? '...' : '') : '(无文字)';
        inner += `<li>${esc(text)}${p.timestamp ? ` (${new Date(p.timestamp).toLocaleDateString('zh-CN')})` : ''}</li>`;
      });
      inner += `</ul></li>`;
    }
    inner += `</ul></div>`;
  }

  // 公司 Facebook
  if (platforms.companyFacebook?.found) {
    const fb = platforms.companyFacebook.profile || {};
    inner += sourceBlockStart('公司 Facebook', platforms.companyFacebook);
    inner += `<li><strong>主页</strong>：<a href="${esc(platforms.companyFacebook.url)}" target="_blank">${esc(platforms.companyFacebook.url)}</a></li>`;
    if (platforms.companyFacebook.excludedFromAnalysis) inner += `<li><span class="warn-badge">⚠️ ${esc(platforms.companyFacebook.note || '该 Facebook 与目标公司匹配度不足，未用于公司/产品分析')}</span></li>`;
    if (fb.fullName) inner += `<li><strong>页面名</strong>：${esc(fb.fullName)}</li>`;
    if (fb.username) inner += `<li><strong>用户名</strong>：${esc(fb.username)}</li>`;
    if (fb.bio) inner += `<li><strong>简介</strong>：${esc(fb.bio)}</li>`;
    if (fb.likesCount) inner += `<li><strong>赞数</strong>：${fb.likesCount}</li>`;
    if (fb.talkingCount) inner += `<li><strong>讨论数</strong>：${fb.talkingCount}</li>`;
    if (fb.followersCount) inner += `<li><strong>粉丝数</strong>：${fb.followersCount}</li>`;
    if (fb.recentPosts?.length) {
      inner += `<li><strong>最近帖子/产品线索</strong>：<ul>`;
      fb.recentPosts.slice(0, 5).forEach(p => {
        const text = p.text ? p.text.slice(0, 100) + (p.text.length > 100 ? '...' : '') : '(无文字)';
        inner += `<li>${esc(text)}${p.time ? ` (${esc(p.time)})` : ''}</li>`;
      });
      inner += `</ul></li>`;
    }
    inner += `</ul></div>`;
  }

  // 公司维度补充
  if (companyResearch) {
    const cr = companyResearch;
    inner += `<div class="source-block"><h4>公司维度补充</h4><ul class="source-list">`;
    if (cr.linkedinUrl) inner += `<li><strong>LinkedIn</strong>：<a href="${esc(cr.linkedinUrl)}" target="_blank">${esc(cr.linkedinUrl)}</a></li>`;
    if (cr.instagramUrl) inner += `<li><strong>Instagram</strong>：<a href="${esc(cr.instagramUrl)}" target="_blank">${esc(cr.instagramUrl)}</a></li>`;
    if (cr.facebookUrl) inner += `<li><strong>Facebook</strong>：<a href="${esc(cr.facebookUrl)}" target="_blank">${esc(cr.facebookUrl)}</a></li>`;
    if (cr.xUrl) inner += `<li><strong>X</strong>：<a href="${esc(cr.xUrl)}" target="_blank">${esc(cr.xUrl)}</a></li>`;
    if (cr.website) inner += `<li><strong>公司官网</strong>：<a href="${esc(cr.website)}" target="_blank">${esc(cr.website)}</a></li>`;
    if (cr.news?.length) {
      inner += `<li><strong>相关新闻</strong>：<ul>`;
      cr.news.forEach(n => { inner += `<li><a href="${esc(n.url)}" target="_blank">${esc(n.title)}</a></li>`; });
      inner += `</ul></li>`;
    }
    if (cr.jobs?.length) {
      inner += `<li><strong>招聘/岗位信号</strong>：<ul>`;
      cr.jobs.forEach(j => { inner += `<li><a href="${esc(j.url)}" target="_blank">${esc(j.title)}</a></li>`; });
      inner += `</ul></li>`;
    }
    if (cr.businessResults?.length) {
      inner += `<li><strong>业务/产品线索</strong>：<ul>`;
      cr.businessResults.forEach(b => { inner += `<li><a href="${esc(b.url)}" target="_blank">${esc(b.title)}</a></li>`; });
      inner += `</ul></li>`;
    }
    inner += `</ul></div>`;
  }

  // Google
  if (platforms.google) {
    inner += `<div class="source-block"><h4>Google</h4><ul class="source-list">`;
    if (platforms.google.companyWebsite) {
      inner += `<li><strong>公司官网</strong>：<a href="${esc(platforms.google.companyWebsite)}" target="_blank">${esc(platforms.google.companyWebsite)}</a></li>`;
    }
    if (platforms.google.companyLinkedinUrl) inner += `<li><strong>公司 LinkedIn</strong>：<a href="${esc(platforms.google.companyLinkedinUrl)}" target="_blank">${esc(platforms.google.companyLinkedinUrl)}</a></li>`;
    if (platforms.google.companyInstagramUrl) inner += `<li><strong>公司 Instagram</strong>：<a href="${esc(platforms.google.companyInstagramUrl)}" target="_blank">${esc(platforms.google.companyInstagramUrl)}</a></li>`;
    if (platforms.google.companyFacebookUrl) inner += `<li><strong>公司 Facebook</strong>：<a href="${esc(platforms.google.companyFacebookUrl)}" target="_blank">${esc(platforms.google.companyFacebookUrl)}</a></li>`;
    if (platforms.google.companyXUrl) inner += `<li><strong>公司 X</strong>：<a href="${esc(platforms.google.companyXUrl)}" target="_blank">${esc(platforms.google.companyXUrl)}</a></li>`;
    if (platforms.google.newsArticles?.length) {
      inner += `<li><strong>新闻报道</strong>：<ul>`;
      platforms.google.newsArticles.forEach(r => {
        inner += `<li><a href="${esc(r.url)}" target="_blank">${esc(r.title)}</a></li>`;
      });
      inner += `</ul></li>`;
    }
    if (platforms.google.jobs?.length) {
      inner += `<li><strong>招聘信息</strong>：<ul>`;
      platforms.google.jobs.forEach(r => {
        inner += `<li><a href="${esc(r.url)}" target="_blank">${esc(r.title)}</a></li>`;
      });
      inner += `</ul></li>`;
    }
    if (platforms.google.businessResults?.length) {
      inner += `<li><strong>业务/产品线索</strong>：<ul>`;
      platforms.google.businessResults.forEach(r => {
        inner += `<li><a href="${esc(r.url)}" target="_blank">${esc(r.title)}</a></li>`;
      });
      inner += `</ul></li>`;
    }
    if (platforms.google.results?.length) {
      inner += `<li><strong>搜索结果</strong>：<ul>`;
      platforms.google.results.slice(0, 5).forEach(r => {
        inner += `<li><a href="${esc(r.url)}" target="_blank">${esc(r.title)}</a></li>`;
      });
      inner += `</ul></li>`;
    }
    inner += `</ul></div>`;
  }

  if (!inner) return '';

  return `<div class="section">
    <div class="section-title"><span class="icon">📊</span>数据来源明细</div>
    ${inner}
  </div>`;
}

/**
 * 写入 HTML 报告文件
 */
export async function writeHtml(html, filename = null) {
  await fs.mkdir(config.outputDir, { recursive: true });
  const name = filename || `report-${Date.now()}.html`;
  const filePath = path.join(config.outputDir, name);
  await fs.writeFile(filePath, html, 'utf-8');
  return filePath;
}
