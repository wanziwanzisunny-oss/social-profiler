import { extractContactsFromText, mergeContacts } from '../utils/contacts.js';

/**
 * 合并多平台采集数据为统一格式
 *
 * 合并策略：
 * - 职业信息优先 LinkedIn
 * - 个人兴趣/社交信息优先 Instagram/Facebook
 * - 同名字段取非空值，多个非空取优先级最高的
 */
export function mergeData(query, platformResults, companyData = null) {
  const { name, company, depth } = query;

  const merged = {
    query: { name, company, ...(depth ? { depth } : {}) },
    fetchedAt: new Date().toISOString(),
    platforms: {},
    // 跨平台合并后的统一画像
    unified: {},
  };
  const companyPublicContacts = mergeContacts(companyData?.publicContacts || []);

  // 透传各平台原始数据
  if (platformResults.google || companyData) {
    merged.platforms.google = {
      results: platformResults.google?.results || companyData?.results || [],
      socialLinks: platformResults.google?.socialLinks || {},
      companyWebsite: companyData?.companyWebsite || null,
      companyLinkedinUrl: companyData?.companyLinkedinUrl || null,
      companyInstagramUrl: companyData?.companyInstagramUrl || null,
      companyFacebookUrl: companyData?.companyFacebookUrl || null,
      companyXUrl: companyData?.companyXUrl || null,
      newsArticles: companyData?.newsArticles || companyData?.news || [],
      jobs: companyData?.jobs || [],
      businessResults: companyData?.businessResults || [],
      publicContacts: companyPublicContacts,
      companySearches: companyData?.searches || [],
    };
  }
  if (platformResults.linkedin) merged.platforms.linkedin = platformResults.linkedin;
  if (platformResults.instagram) {
    merged.platforms.instagram = platformResults.instagram;
  }
  if (platformResults.companyInstagram) {
    merged.platforms.companyInstagram = platformResults.companyInstagram;
  }
  if (platformResults.facebook) merged.platforms.facebook = platformResults.facebook;
  if (platformResults.companyFacebook) merged.platforms.companyFacebook = platformResults.companyFacebook;
  if (platformResults.x) merged.platforms.x = platformResults.x;
  if (platformResults.companyX) merged.platforms.companyX = platformResults.companyX;

  // 跨平台统一画像
  const li = platformResults.linkedin?.profile || {};
  const trustedInstagram = platformResults.instagram?.excludedFromAnalysis ? null : platformResults.instagram;
  const ig = trustedInstagram?.profile || {};
  const trustedFacebook = platformResults.facebook?.excludedFromAnalysis ? null : platformResults.facebook;
  const fb = trustedFacebook?.profile || {};
  const trustedX = platformResults.x?.excludedFromAnalysis ? null : platformResults.x;
  const x = trustedX?.profile || {};

  merged.unified = {
    // 姓名：LinkedIn > Google 查询名 > Facebook（FB 标题经常是页面名不可靠）
    name: li.name || name || fb.fullName,

    // 职位：LinkedIn > Instagram bio 推断
    headline: li.headline || null,

    // 所在地：LinkedIn > Facebook
    location: li.location || null,

    // 简介：合并 LinkedIn about + Instagram bio + Facebook bio + X bio
    about: _mergeAbout(li.about, ig.bio, fb.bio, x.bio),

    // 社交统计
    socialStats: _buildSocialStats(ig, fb, x),

    // 职业经历（LinkedIn 为主）
    experience: li.experience || [],
    education: li.education || [],
    skills: li.skills || [],

    // 社交活跃度
    socialActivity: _buildSocialActivity(ig, fb, x),

    // 所有平台的主页链接
    profileLinks: _buildProfileLinks(platformResults),

    // 公开联系方式（仅来自可信来源；推测联系方式不放这里）
    contacts: _buildContacts(li, ig, fb, x, { ...companyData, publicContacts: companyPublicContacts }),
  };

  // 公司维度数据（当个人信息不足时补充）
  if (companyData) {
    merged.companyResearch = {
      linkedinUrl: companyData.companyLinkedinUrl || null,
      instagramUrl: companyData.companyInstagramUrl || null,
      instagramProfile: platformResults.companyInstagram || null,
      facebookUrl: companyData.companyFacebookUrl || null,
      facebookProfile: platformResults.companyFacebook || null,
      xUrl: companyData.companyXUrl || null,
      xProfile: platformResults.companyX || null,
      website: companyData.companyWebsite || null,
      news: companyData.newsArticles || companyData.news || [],
      jobs: companyData.jobs || [],
      businessResults: companyData.businessResults || [],
      publicContacts: companyPublicContacts,
      searches: companyData.searches || [],
      searchResults: companyData.results?.slice(0, 12) || [],
    };
  }

  return merged;
}

/**
 * 合并多平台简介（去重、拼接）
 */
function _mergeAbout(linkedinAbout, instagramBio, facebookBio, xBio) {
  const parts = [];

  // LinkedIn about 最正式，放最前
  if (linkedinAbout) parts.push(linkedinAbout.trim());

  // 社交平台 bio 只在可信时传入，避免重复拼接。
  for (const bio of [instagramBio, facebookBio, xBio]) {
    if (!bio) continue;
    const clean = bio.trim();
    if (!parts.some(p => p.includes(clean) || clean.includes(p.slice(0, 50)))) {
      parts.push(clean);
    }
  }

  return parts.length ? parts.join('\n\n') : null;
}

/**
 * 构建社交统计数据
 */
function _buildSocialStats(ig, fb, x) {
  const stats = {};

  if (ig.followersCount !== null && ig.followersCount !== undefined) {
    stats.instagramFollowers = ig.followersCount;
  }
  if (ig.postsCount !== null && ig.postsCount !== undefined) {
    stats.instagramPosts = ig.postsCount;
  }
  if (fb.likesCount) {
    stats.facebookLikes = fb.likesCount;
  }
  if (fb.followersCount) {
    stats.facebookFollowers = fb.followersCount;
  }
  if (fb.talkingCount) {
    stats.facebookTalking = fb.talkingCount;
  }
  if (x.followersCount !== null && x.followersCount !== undefined) {
    stats.xFollowers = x.followersCount;
  }
  if (x.followingCount !== null && x.followingCount !== undefined) {
    stats.xFollowing = x.followingCount;
  }

  return Object.keys(stats).length ? stats : null;
}

/**
 * 构建社交活跃度信息
 */
function _buildSocialActivity(ig, fb, x) {
  const activity = {};

  // Instagram 最近帖子分析
  if (ig.recentPosts?.length) {
    const posts = ig.recentPosts;
    const totalLikes = posts.reduce((sum, p) => sum + (p.likes || 0), 0);
    const totalComments = posts.reduce((sum, p) => sum + (p.comments || 0), 0);

    activity.instagram = {
      recentPostsCount: posts.length,
      avgLikes: Math.round(totalLikes / posts.length),
      avgComments: Math.round(totalComments / posts.length),
      contentTypes: _countContentTypes(posts),
      latestPostDate: posts[0]?.timestamp || null,
    };
  }

  // Facebook 最近帖子
  if (fb.recentPosts?.length) {
    activity.facebook = {
      recentPostsCount: fb.recentPosts.length,
      latestPostDate: fb.recentPosts[0]?.time || null,
    };
  }

  // X 最近公开帖子
  if (x.recentPosts?.length) {
    activity.x = {
      recentPostsCount: x.recentPosts.length,
      latestPostDate: x.recentPosts[0]?.timestamp || null,
    };
  }

  return Object.keys(activity).length ? activity : null;
}

/**
 * 统计帖子类型分布
 */
function _countContentTypes(posts) {
  const types = {};
  for (const p of posts) {
    const t = p.type || 'unknown';
    types[t] = (types[t] || 0) + 1;
  }
  return types;
}

/**
 * 构建所有平台的主页链接
 */
function _buildProfileLinks(platformResults) {
  const links = {};

  if (platformResults.linkedin?.url) links.linkedin = platformResults.linkedin.url;
  if (platformResults.instagram?.url && !platformResults.instagram?.excludedFromAnalysis) links.instagram = platformResults.instagram.url;
  if (platformResults.facebook?.url && !platformResults.facebook?.excludedFromAnalysis) links.facebook = platformResults.facebook.url;
  if (platformResults.x?.url && !platformResults.x?.excludedFromAnalysis) links.x = platformResults.x.url;

  return Object.keys(links).length ? links : null;
}

function _buildContacts(li, ig, fb, x, companyData) {
  const contacts = mergeContacts(
    extractContactsFromText([li.about, li.headline].filter(Boolean).join('\n'), {
      title: 'LinkedIn profile',
      scope: 'person',
    }),
    extractContactsFromText([ig.bio, ig.externalUrl].filter(Boolean).join('\n'), {
      title: 'Instagram profile',
      scope: 'person',
    }),
    extractContactsFromText(fb.bio || '', {
      title: 'Facebook profile',
      scope: 'person',
    }),
    extractContactsFromText([x.bio, x.website].filter(Boolean).join('\n'), {
      title: 'X profile',
      scope: 'person',
    }),
    companyData?.publicContacts || [],
    (companyData?.results || []).flatMap(r => extractContactsFromText(`${r.title || ''}\n${r.snippet || ''}\n${r.url || ''}`, {
      url: r.url,
      title: r.title,
      scope: 'company',
      allowPhones: false,
    }))
  );

  const verifiedEmails = contacts.filter(c => c.type === 'email').map(c => c.value);
  const verifiedPhones = contacts.filter(c => c.type === 'phone').map(c => c.value);

  if (!verifiedEmails.length && !verifiedPhones.length) return null;

  return {
    verifiedEmails,
    verifiedPhones,
    inferredEmails: [],
    sources: contacts,
    note: '仅包含公开页面明确出现的联系方式；推测邮箱不会作为已验证联系方式展示。',
  };
}
