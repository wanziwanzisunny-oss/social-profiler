import fs from 'fs/promises';
import path from 'path';
import { config } from '../config.js';

/** 安全地 join 数组，非数组则原样返回 */
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

/** 安全地显示数字，null 则返回 '-' */
function safeNum(val) {
  if (val === null || val === undefined) return '-';
  if (typeof val === 'number') return val.toLocaleString();
  return String(val);
}

function sourceStatusLine(info = {}) {
  return info.excludedFromAnalysis
    ? `- **来源状态**：仅展示，未纳入画像分析\n`
    : `- **来源状态**：已纳入画像分析\n`;
}

/**
 * 生成 Markdown 格式的客户画像报告
 */
export function generateMarkdown(data, analysis) {
  const { query, fetchedAt, platforms } = data;
  const sources = Object.keys(platforms).filter((k) => platforms[k]?.found !== false && !platforms[k]?.excludedFromAnalysis);

  let md = `# 客户画像报告：${query.name}${query.company ? ` @ ${query.company}` : ''}

> 生成时间：${new Date(fetchedAt).toLocaleString('zh-CN')} | 数据来源：${sources.join(', ')}

---

`;

  // 统一画像概览
  const unified = data.unified;
  if (unified) {
    md += `## 📋 人物概览

`;
    if (unified.name) md += `**姓名**：${unified.name}`;
    if (unified.headline) md += `  ·  ${unified.headline}`;
    if (unified.location) md += `  ·  📍 ${unified.location}`;
    md += '\n\n';

    if (unified.about) {
      md += `> ${unified.about.slice(0, 300)}${unified.about.length > 300 ? '...' : ''}\n\n`;
    }

    // 社交统计
    if (unified.socialStats) {
      const s = unified.socialStats;
      const statsLine = [];
      if (s.instagramFollowers) statsLine.push(`Instagram 粉丝: ${safeNum(s.instagramFollowers)}`);
      if (s.instagramPosts) statsLine.push(`帖子: ${safeNum(s.instagramPosts)}`);
      if (s.facebookLikes) statsLine.push(`Facebook 赞: ${s.facebookLikes}`);
      if (s.facebookFollowers) statsLine.push(`粉丝: ${s.facebookFollowers}`);
      if (s.xFollowers) statsLine.push(`X 粉丝: ${safeNum(s.xFollowers)}`);
      if (s.xFollowing) statsLine.push(`X 关注: ${safeNum(s.xFollowing)}`);
      if (statsLine.length) {
        md += `**社交数据**：${statsLine.join(' · ')}\n\n`;
      }
    }

    // 社交活跃度
    if (unified.socialActivity?.instagram) {
      const act = unified.socialActivity.instagram;
      md += `**Instagram 活跃度**：近 ${act.recentPostsCount} 条帖子，平均 ❤️ ${safeNum(act.avgLikes)} / 💬 ${safeNum(act.avgComments)}`;
      if (act.latestPostDate) {
        const d = new Date(act.latestPostDate);
        md += `，最新发布 ${d.toLocaleDateString('zh-CN')}`;
      }
      md += '\n\n';
    }

    if (unified.socialActivity?.x) {
      const act = unified.socialActivity.x;
      md += `**X 活跃度**：近 ${act.recentPostsCount} 条公开帖子`;
      if (act.latestPostDate) {
        const d = new Date(act.latestPostDate);
        md += `，最新发布 ${d.toLocaleDateString('zh-CN')}`;
      }
      md += '\n\n';
    }

    // 主页链接
    if (unified.profileLinks) {
      md += `**主页链接**：`;
      const links = [];
      if (unified.profileLinks.linkedin) links.push(`[LinkedIn](${unified.profileLinks.linkedin})`);
      if (unified.profileLinks.instagram) links.push(`[Instagram](${unified.profileLinks.instagram})`);
      if (unified.profileLinks.facebook) links.push(`[Facebook](${unified.profileLinks.facebook})`);
      if (unified.profileLinks.x) links.push(`[X](${unified.profileLinks.x})`);
      md += links.join(' · ') + '\n\n';
    }

    // 技能标签
    if (unified.skills?.length) {
      md += `**技能**：${unified.skills.join(' · ')}\n\n`;
    }

    if (unified.contacts) {
      if (unified.contacts.sources?.length) {
        md += `**公开联系方式**：\n`;
        unified.contacts.sources.slice(0, 5).forEach(c => {
          const source = c.sourceUrl ? `[${c.sourceTitle || c.sourceUrl}](${c.sourceUrl})` : (c.sourceTitle || c.scope || '公开资料');
          const type = c.type === 'email' ? '邮箱' : '电话';
          md += `- ${type}: ${c.value}（${c.scope === 'person' ? '个人' : '公司'}，来源：${source}）\n`;
        });
        md += '\n';
      } else {
        const contacts = [];
        if (unified.contacts.verifiedEmails?.length) contacts.push(`邮箱: ${unified.contacts.verifiedEmails.join('、')}`);
        if (unified.contacts.verifiedPhones?.length) contacts.push(`电话: ${unified.contacts.verifiedPhones.join('、')}`);
        if (contacts.length) md += `**公开联系方式**：${contacts.join(' · ')}\n\n`;
      }
    }
  }

  // 公司信息
  if (analysis.company) {
    const c = analysis.company;
    md += `## 🏢 公司信息

| 项目 | 内容 |
|------|------|
| 公司名 | ${c.name || '-'} |
| 主营产品 | ${safeJoin(c.mainProducts) || '-'} |
| 公司规模 | ${c.scale || '-'} |
| 销售渠道 | ${safeJoin(c.salesChannels) || '-'} |
| 目标市场 | ${c.targetMarket || '-'} |
| 竞品 | ${safeJoin(c.competitors) || '-'} |
| 近期动态 | ${safeJoin(c.recentNews) || '-'}

`;
  }

  // 个人画像
  if (analysis.person) {
    const p = analysis.person;
    md += `## 👤 个人画像

| 项目 | 内容 |
|------|------|
| 职位 | ${p.role || '-'} |
| 决策层级 | ${p.decisionLevel || '-'} |
| 专业领域 | ${safeJoin(p.expertise) || '-'} |
| 性格特征 | ${p.personality || '-'} |
| 兴趣爱好 | ${safeJoin(p.hobbies) || '-'} |
| 沟通风格 | ${p.communicationStyle || '-'} |
| 近期关注 | ${safeJoin(p.recentConcerns) || '-'}

`;
  }

  // 商务建议
  if (analysis.salesInsights) {
    const s = analysis.salesInsights;
    md += `## 💡 商务切入点

`;
    if (s.entryPoints?.length) {
      s.entryPoints.forEach((ep, i) => {
        md += `${i + 1}. ${ep}\n`;
      });
      md += '\n';
    }
    md += `**推荐沟通方式**：${s.suggestedApproach || '-'}
**最佳渠道**：${s.bestChannel || '-'}
**时机判断**：${s.timing || '-'}

`;
  }

  // 数据来源明细
  md += `---

## 📊 数据来源明细

`;

  // LinkedIn
  if (platforms.linkedin?.found) {
    const li = platforms.linkedin.profile || {};
    md += `### LinkedIn
- **来源状态**：已纳入画像分析
- **主页**：${platforms.linkedin.url}
`;
    if (li.headline) md += `- **简介**：${li.headline}\n`;
    if (li.location) md += `- **所在地**：${li.location}\n`;
    if (li.connections) md += `- **人脉**：${li.connections}\n`;
    if (li.experience?.length) {
      md += `- **工作经历**：\n`;
      li.experience.forEach((e) => {
        md += `  - ${e.title || '-'}${e.company ? ` @ ${e.company}` : ''}${e.duration ? ` (${e.duration})` : ''}\n`;
      });
    }
    if (li.education?.length) {
      md += `- **教育背景**：\n`;
      li.education.forEach((e) => {
        md += `  - ${e.school || '-'}${e.degree ? ` · ${e.degree}` : ''}${e.duration ? ` (${e.duration})` : ''}\n`;
      });
    }
    if (li.skills?.length) {
      md += `- **技能**：${li.skills.join('、')}\n`;
    }
    md += '\n';
  }

  // Instagram
  if (platforms.instagram?.found) {
    const ig = platforms.instagram.profile || {};
    md += `### Instagram\n`;
    md += sourceStatusLine(platforms.instagram);
    if (platforms.instagram.isCompanyAccount) {
      md += `- **⚠️ 注意**：${platforms.instagram.note}\n`;
    }
    if (platforms.instagram.excludedFromAnalysis) {
      md += `- **⚠️ 匹配提示**：${platforms.instagram.note || '该 Instagram 与目标人物匹配度不足，未用于兴趣爱好分析'}\n`;
    }
    md += `- **主页**：${platforms.instagram.url}\n`;
    if (ig.username) md += `- **用户名**：@${ig.username}\n`;
    if (ig.fullName) md += `- **全名**：${ig.fullName}\n`;
    if (ig.bio) md += `- **简介**：${ig.bio}\n`;
    if (ig.followersCount !== null && ig.followersCount !== undefined) {
      md += `- **粉丝数**：${safeNum(ig.followersCount)}\n`;
    }
    if (ig.followingCount !== null && ig.followingCount !== undefined) {
      md += `- **关注数**：${safeNum(ig.followingCount)}\n`;
    }
    if (ig.postsCount !== null && ig.postsCount !== undefined) {
      md += `- **帖子数**：${safeNum(ig.postsCount)}\n`;
    }
    if (ig.isVerified) md += `- **认证**：✅ 已认证\n`;
    if (ig.externalUrl) md += `- **外部链接**：${ig.externalUrl}\n`;

    if (ig.recentPosts?.length) {
      md += `- **最近帖子**：\n`;
      ig.recentPosts.slice(0, 5).forEach((p) => {
        const caption = p.caption ? p.caption.slice(0, 80) + (p.caption.length > 80 ? '...' : '') : '(无文字)';
        const stats = [];
        if (p.likes !== null) stats.push(`❤️ ${safeNum(p.likes)}`);
        if (p.comments !== null) stats.push(`💬 ${safeNum(p.comments)}`);
        const type = p.type === 'reel' ? '🎬' : p.type === 'carousel' ? '🖼️' : '📷';
        md += `  - ${type} ${caption}${stats.length ? ` (${stats.join(' ')})` : ''}\n`;
      });
    }
    md += '\n';
  }

  // 公司 Instagram
  if (platforms.companyInstagram?.found) {
    const ig = platforms.companyInstagram.profile || {};
    md += `### 公司 Instagram
${sourceStatusLine(platforms.companyInstagram)}
- **主页**：${platforms.companyInstagram.url}
`;
    if (platforms.companyInstagram.excludedFromAnalysis) {
      md += `- **⚠️ 匹配提示**：${platforms.companyInstagram.note || '该 Instagram 与目标公司匹配度不足，未用于公司/产品分析'}\n`;
    }
    if (ig.username) md += `- **用户名**：@${ig.username}\n`;
    if (ig.fullName) md += `- **名称**：${ig.fullName}\n`;
    if (ig.bio) md += `- **简介**：${ig.bio}\n`;
    if (ig.followersCount !== null && ig.followersCount !== undefined) {
      md += `- **粉丝数**：${safeNum(ig.followersCount)}\n`;
    }
    if (ig.postsCount !== null && ig.postsCount !== undefined) {
      md += `- **帖子数**：${safeNum(ig.postsCount)}\n`;
    }
    if (ig.externalUrl) md += `- **外部链接**：${ig.externalUrl}\n`;
    if (ig.recentPosts?.length) {
      md += `- **最近帖子/产品线索**：\n`;
      ig.recentPosts.slice(0, 5).forEach((p) => {
        const caption = p.caption ? p.caption.slice(0, 100) + (p.caption.length > 100 ? '...' : '') : '(无文字)';
        md += `  - ${caption}\n`;
      });
    }
    md += '\n';
  }

  // Facebook
  if (platforms.facebook?.found) {
    const fb = platforms.facebook.profile || {};
    md += `### Facebook
${sourceStatusLine(platforms.facebook)}
- **主页**：${platforms.facebook.url}
`;
    if (platforms.facebook.excludedFromAnalysis) {
      md += `- **⚠️ 匹配提示**：${platforms.facebook.note || '该 Facebook 与目标人物匹配度不足，未用于人物画像分析'}\n`;
    }
    if (fb.fullName) md += `- **页面名**：${fb.fullName}\n`;
    if (fb.bio) md += `- **简介**：${fb.bio}\n`;
    if (fb.likesCount) md += `- **赞数**：${fb.likesCount}\n`;
    if (fb.talkingCount) md += `- **讨论数**：${fb.talkingCount}\n`;
    if (fb.followersCount) md += `- **粉丝数**：${fb.followersCount}\n`;

    if (fb.recentPosts?.length) {
      md += `- **最近帖子**：\n`;
      fb.recentPosts.slice(0, 3).forEach((p) => {
        const text = p.text ? p.text.slice(0, 80) + (p.text.length > 80 ? '...' : '') : '(无文字)';
        md += `  - ${text}${p.time ? ` (${p.time})` : ''}\n`;
      });
    }
    md += '\n';
  }

  // 公司 Facebook
  if (platforms.companyFacebook?.found) {
    const fb = platforms.companyFacebook.profile || {};
    md += `### 公司 Facebook
${sourceStatusLine(platforms.companyFacebook)}
- **主页**：${platforms.companyFacebook.url}
`;
    if (platforms.companyFacebook.excludedFromAnalysis) {
      md += `- **⚠️ 匹配提示**：${platforms.companyFacebook.note || '该 Facebook 与目标公司匹配度不足，未用于公司/产品分析'}\n`;
    }
    if (fb.fullName) md += `- **页面名**：${fb.fullName}\n`;
    if (fb.username) md += `- **用户名**：${fb.username}\n`;
    if (fb.bio) md += `- **简介**：${fb.bio}\n`;
    if (fb.likesCount) md += `- **赞数**：${fb.likesCount}\n`;
    if (fb.talkingCount) md += `- **讨论数**：${fb.talkingCount}\n`;
    if (fb.followersCount) md += `- **粉丝数**：${fb.followersCount}\n`;

    if (fb.recentPosts?.length) {
      md += `- **最近帖子/产品线索**：\n`;
      fb.recentPosts.slice(0, 5).forEach((p) => {
        const text = p.text ? p.text.slice(0, 100) + (p.text.length > 100 ? '...' : '') : '(无文字)';
        md += `  - ${text}${p.time ? ` (${p.time})` : ''}\n`;
      });
    }
    md += '\n';
  }

  // X
  if (platforms.x?.found) {
    const x = platforms.x.profile || {};
    md += `### X
${sourceStatusLine(platforms.x)}
- **主页**：${platforms.x.url}
`;
    if (platforms.x.excludedFromAnalysis) {
      md += `- **⚠️ 匹配提示**：${platforms.x.note || '该 X 账号与目标人物匹配度不足，未用于画像分析'}\n`;
    }
    if (x.username) md += `- **用户名**：@${x.username}\n`;
    if (x.displayName) md += `- **显示名**：${x.displayName}\n`;
    if (x.bio) md += `- **简介**：${x.bio}\n`;
    if (x.followersCount !== null && x.followersCount !== undefined) {
      md += `- **粉丝数**：${safeNum(x.followersCount)}\n`;
    }
    if (x.followingCount !== null && x.followingCount !== undefined) {
      md += `- **关注数**：${safeNum(x.followingCount)}\n`;
    }
    if (x.website) md += `- **外部链接**：${x.website}\n`;
    if (x.recentPosts?.length) {
      md += `- **近期公开帖子**：\n`;
      x.recentPosts.slice(0, 3).forEach((post) => {
        md += `  - ${post.text || '-'}${post.url ? ` (${post.url})` : ''}\n`;
      });
    }
    md += '\n';
  }

  // 公司 X
  if (platforms.companyX?.found) {
    const x = platforms.companyX.profile || {};
    md += `### 公司 X
${sourceStatusLine(platforms.companyX)}
- **主页**：${platforms.companyX.url}
`;
    if (platforms.companyX.excludedFromAnalysis) {
      md += `- **⚠️ 匹配提示**：${platforms.companyX.note || '该 X 账号与目标公司匹配度不足，未用于公司/产品分析'}\n`;
    }
    if (x.username) md += `- **用户名**：@${x.username}\n`;
    if (x.displayName) md += `- **显示名**：${x.displayName}\n`;
    if (x.bio) md += `- **简介**：${x.bio}\n`;
    if (x.followersCount !== null && x.followersCount !== undefined) {
      md += `- **粉丝数**：${safeNum(x.followersCount)}\n`;
    }
    if (x.followingCount !== null && x.followingCount !== undefined) {
      md += `- **关注数**：${safeNum(x.followingCount)}\n`;
    }
    if (x.website) md += `- **外部链接**：${x.website}\n`;
    if (x.recentPosts?.length) {
      md += `- **近期公开帖子/产品线索**：\n`;
      x.recentPosts.slice(0, 5).forEach((post) => {
        md += `  - ${post.text || '-'}${post.url ? ` (${post.url})` : ''}\n`;
      });
    }
    md += '\n';
  }

  // 公司维度研究数据（人名搜不到时的补充）
  if (data.companyResearch) {
    const cr = data.companyResearch;
    md += `### 公司维度补充
`;
    if (cr.linkedinUrl) md += `- **公司 LinkedIn**：${cr.linkedinUrl}\n`;
    if (cr.instagramUrl) md += `- **公司 Instagram**：${cr.instagramUrl}\n`;
    if (cr.facebookUrl) md += `- **公司 Facebook**：${cr.facebookUrl}\n`;
    if (cr.xUrl) md += `- **公司 X**：${cr.xUrl}\n`;
    if (cr.website) md += `- **公司官网**：${cr.website}\n`;
    if (cr.news?.length) {
      md += `- **相关新闻**：\n`;
      cr.news.forEach(n => {
        md += `  - [${n.title}](${n.url})\n`;
      });
    }
    if (cr.jobs?.length) {
      md += `- **招聘/岗位信号**：\n`;
      cr.jobs.forEach(j => {
        md += `  - [${j.title}](${j.url})\n`;
      });
    }
    if (cr.businessResults?.length) {
      md += `- **业务/产品线索**：\n`;
      cr.businessResults.forEach(b => {
        md += `  - [${b.title}](${b.url})\n`;
      });
    }
    md += '\n';
  }

  // Google
  if (platforms.google) {
    md += `### Google
`;
    if (platforms.google.companyWebsite) md += `- **公司官网**：${platforms.google.companyWebsite}\n`;
    if (platforms.google.companyLinkedinUrl) md += `- **公司 LinkedIn**：${platforms.google.companyLinkedinUrl}\n`;
    if (platforms.google.companyInstagramUrl) md += `- **公司 Instagram**：${platforms.google.companyInstagramUrl}\n`;
    if (platforms.google.companyFacebookUrl) md += `- **公司 Facebook**：${platforms.google.companyFacebookUrl}\n`;
    if (platforms.google.newsArticles?.length) {
      md += `- **新闻报道**：\n`;
      platforms.google.newsArticles.forEach((r) => {
        md += `  - [${r.title}](${r.url})\n`;
      });
    }
    if (platforms.google.jobs?.length) {
      md += `- **招聘信息**：\n`;
      platforms.google.jobs.forEach((r) => {
        md += `  - [${r.title}](${r.url})\n`;
      });
    }
    if (platforms.google.businessResults?.length) {
      md += `- **业务/产品线索**：\n`;
      platforms.google.businessResults.forEach((r) => {
        md += `  - [${r.title}](${r.url})\n`;
      });
    }
    if (platforms.google.results?.length) {
      md += `- **搜索结果**：\n`;
      platforms.google.results.slice(0, 5).forEach((r) => {
        md += `  - [${r.title}](${r.url})\n`;
      });
    }
    md += '\n';
  }

  return md;
}

/**
 * 写入 Markdown 报告文件
 */
export async function writeMarkdown(markdown, filename = null) {
  await fs.mkdir(config.outputDir, { recursive: true });

  const name = filename || `report-${Date.now()}.md`;
  const filePath = path.join(config.outputDir, name);

  await fs.writeFile(filePath, markdown, 'utf-8');
  return filePath;
}
