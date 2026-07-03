import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeData } from '../src/analyzer/merge.js';
import { GoogleScraper } from '../src/scrapers/google.js';
import {
  validateCompanyFacebookCandidate,
  validateCompanyInstagramCandidate,
  validateCompanyXCandidate,
  validateFacebookCandidate,
  validateInstagramCandidate,
  validateLinkedInCandidate,
  validateXCandidate,
} from '../src/commands/lookup.js';

test('supplemental LinkedIn search rejects same-name result without company evidence', async () => {
  const scraper = Object.create(GoogleScraper.prototype);
  scraper.init = async () => {};
  scraper.close = async () => {};
  scraper._searchGoogle = async () => [
    {
      title: 'Tim Cook - IT EVP | Customer Advocate',
      url: 'https://www.linkedin.com/in/tim-cook-47522b6',
      snippet: 'Tim Cook, Senior Principal Consultant in Columbus, Ohio',
    },
  ];

  const url = await scraper.searchPlatform('Tim Cook', 'APPLE', 'linkedin');

  assert.equal(url, null);
});

test('low confidence LinkedIn scrape is rejected when company is absent from profile text', () => {
  const result = validateLinkedInCandidate({
    found: true,
    url: 'https://www.linkedin.com/in/tim-cook-47522b6',
    profile: {
      name: 'Tim Cook',
      headline: 'IT EVP | Customer Advocate | Senior Principal Consultant',
      location: 'Columbus, Ohio',
      experience: [],
      education: [],
      skills: [],
    },
  }, 'Tim Cook', 'APPLE', 'supplemental-google');

  assert.equal(result.ok, false);
});

test('normal Google LinkedIn candidate is not rejected just because quick scrape lacks company details', () => {
  const result = validateLinkedInCandidate({
    found: true,
    url: 'https://www.linkedin.com/in/adam-gibboney-99aa85319',
    profile: {
      name: 'Adam Gibboney',
      headline: 'Senior Vice President of Procurement | Value Creation Operations Executive',
      experience: [],
    },
  }, 'Adam Gibboney', 'Camco Manufacturing', 'google');

  assert.equal(result.ok, true);
});

test('Instagram candidate with unrelated username and profile is excluded from analysis', () => {
  const validation = validateInstagramCandidate({
    found: true,
    url: 'https://www.instagram.com/orange_sierraleone/',
    profile: {
      username: 'orange_sierraleone',
      fullName: 'Orange Sierra Leone',
      bio: 'Official account',
      followersCount: 10000,
      recentPosts: [{ caption: 'Brand campaign', likes: 20, comments: 1 }],
    },
  }, 'Yuko Omura', 'Image Orange SL');

  assert.equal(validation.ok, false);
  assert.equal(validation.data.excludedFromAnalysis, true);

  const merged = mergeData(
    { name: 'Yuko Omura', company: 'Image Orange SL' },
    { instagram: validation.data },
    null
  );

  assert.equal(merged.unified.about, null);
  assert.equal(merged.unified.socialStats, null);
  assert.equal(merged.unified.socialActivity, null);
  assert.equal(merged.unified.profileLinks, null);
});

test('Instagram candidate is excluded when only the URL matches the target name', () => {
  const validation = validateInstagramCandidate({
    found: true,
    url: 'https://www.instagram.com/thetimsteckel/',
    profile: {
      username: 'Highlights',
      fullName: 'thetimsteckel',
      bio: 'Pilot sailor diver. No company or target-name evidence here.',
      followersCount: 1202,
      recentPosts: [{ caption: 'Weekend sailing', likes: 4, comments: 0 }],
    },
  }, 'Tim Steckel', 'Compost Marketing Agency');

  assert.equal(validation.ok, false);
  assert.equal(validation.data.excludedFromAnalysis, true);
});


test('trusted Instagram candidate can contribute public contact details', () => {
  const validation = validateInstagramCandidate({
    found: true,
    url: 'https://www.instagram.com/yukoomura/',
    profile: {
      username: 'yukoomura',
      fullName: 'Yuko Omura',
      bio: 'Partnerships: yuko@example.com +1 415-555-0199',
      recentPosts: [],
    },
  }, 'Yuko Omura', 'Image Orange SL');

  assert.equal(validation.ok, true);

  const merged = mergeData(
    { name: 'Yuko Omura', company: 'Image Orange SL' },
    { instagram: validation.data },
    null
  );

  assert.deepEqual(merged.unified.contacts.verifiedEmails, ['yuko@example.com']);
  assert.deepEqual(merged.unified.contacts.verifiedPhones, ['+1 415 555 0199']);
});

test('meta-only personal Instagram is retained as warning and excluded from profile links', () => {
  const validation = validateInstagramCandidate({
    found: true,
    url: 'https://www.instagram.com/thetimsteckel/',
    profile: {
      username: 'thetimsteckel',
      fullName: 'Tim Steckel',
      bio: '1,203 位粉丝、已关注 314 人、 453 篇帖子 - 查看 Tim Steckel (@thetimsteckel) 的 Instagram 照片和视频。',
      source: 'meta',
      recentPosts: [],
    },
  }, 'Tim Steckel', 'The Compost Marketing Agency', 'supplemental-google');

  assert.equal(validation.ok, false);
  assert.equal(validation.data.excludedFromAnalysis, true);

  const merged = mergeData(
    { name: 'Tim Steckel', company: 'The Compost Marketing Agency' },
    { instagram: validation.data },
    null
  );

  assert.equal(merged.unified.profileLinks?.instagram, undefined);
});

test('trusted company Instagram contributes company data without becoming personal profile data', () => {
  const validation = validateCompanyInstagramCandidate({
    found: true,
    url: 'https://www.instagram.com/compost.marketing.agency/',
    profile: {
      username: 'compost.marketing.agency',
      fullName: 'Compost Marketing Agency',
      bio: 'Marketing services for compost businesses. Website audits, lead generation, case studies.',
      followersCount: 2400,
      postsCount: 180,
      recentPosts: [
        { caption: 'New case study for Ohio Organics Council', likes: 15, comments: 1 },
      ],
    },
  }, 'Compost Marketing Agency');

  assert.equal(validation.ok, true);
  assert.equal(validation.data.scope, 'company');

  const merged = mergeData(
    { name: 'Tim Steckel', company: 'Compost Marketing Agency' },
    { companyInstagram: validation.data },
    { companyInstagramUrl: 'https://www.instagram.com/compost.marketing.agency/' }
  );

  assert.equal(merged.platforms.companyInstagram.scope, 'company');
  assert.equal(merged.companyResearch.instagramProfile.profile.bio.includes('Marketing services'), true);
  assert.equal(merged.unified.about, null);
  assert.equal(merged.unified.socialStats, null);
  assert.equal(merged.unified.socialActivity, null);
  assert.equal(merged.unified.profileLinks, null);
});

test('low confidence company Instagram is retained only as a warning source', () => {
  const validation = validateCompanyInstagramCandidate({
    found: true,
    url: 'https://www.instagram.com/random.shop/',
    profile: {
      username: 'random.shop',
      fullName: 'Random Shop',
      bio: 'Lifestyle products',
      recentPosts: [{ caption: 'Sale now', likes: 2, comments: 0 }],
    },
  }, 'Compost Marketing Agency');

  assert.equal(validation.ok, false);
  assert.equal(validation.data.excludedFromAnalysis, true);
  assert.equal(validation.data.scope, 'company');
  assert.deepEqual(validation.data.profile.recentPosts, []);
});

test('trusted company Facebook contributes company data without becoming personal profile data', () => {
  const validation = validateCompanyFacebookCandidate({
    found: true,
    url: 'https://www.facebook.com/compost.marketing.agency/',
    profile: {
      username: 'compost.marketing.agency',
      fullName: 'Compost Marketing Agency',
      bio: 'Marketing agency for compost businesses and organics recycling brands.',
      followersCount: 1800,
      likesCount: 1200,
      recentPosts: [
        { text: 'Our latest compost marketing case study is live.', time: '2026-06-01' },
      ],
    },
  }, 'Compost Marketing Agency');

  assert.equal(validation.ok, true);
  assert.equal(validation.data.scope, 'company');

  const merged = mergeData(
    { name: 'Tim Steckel', company: 'Compost Marketing Agency' },
    { companyFacebook: validation.data },
    { companyFacebookUrl: 'https://www.facebook.com/compost.marketing.agency/' }
  );

  assert.equal(merged.platforms.companyFacebook.scope, 'company');
  assert.equal(merged.companyResearch.facebookProfile.profile.bio.includes('Marketing agency'), true);
  assert.equal(merged.unified.about, null);
  assert.equal(merged.unified.socialStats, null);
  assert.equal(merged.unified.socialActivity, null);
  assert.equal(merged.unified.profileLinks, null);
});

test('low confidence company Facebook is retained only as a warning source', () => {
  const validation = validateCompanyFacebookCandidate({
    found: true,
    url: 'https://www.facebook.com/random.shop/',
    profile: {
      username: 'random.shop',
      fullName: 'Random Shop',
      bio: 'Lifestyle products',
      recentPosts: [{ text: 'Sale now', time: '2026-06-01' }],
    },
  }, 'Compost Marketing Agency');

  assert.equal(validation.ok, false);
  assert.equal(validation.data.excludedFromAnalysis, true);
  assert.equal(validation.data.scope, 'company');
  assert.deepEqual(validation.data.profile.recentPosts, []);
});

test('Facebook company page is excluded from personal profile analysis', () => {
  const validation = validateFacebookCandidate({
    found: true,
    url: 'https://www.facebook.com/compost.marketing.agency/',
    profile: {
      username: 'compost.marketing.agency',
      fullName: 'Compost Marketing Agency',
      bio: 'Marketing agency for compost businesses',
      recentPosts: [{ text: 'Case study launch', time: '2026-06-01' }],
    },
  }, 'Tim Steckel', 'Compost Marketing Agency');

  assert.equal(validation.ok, false);
  assert.equal(validation.data.excludedFromAnalysis, true);

  const merged = mergeData(
    { name: 'Tim Steckel', company: 'Compost Marketing Agency' },
    { facebook: validation.data },
    null
  );

  assert.equal(merged.unified.about, null);
  assert.equal(merged.unified.socialStats, null);
  assert.equal(merged.unified.socialActivity, null);
  assert.equal(merged.unified.profileLinks, null);
});

test('Google social extraction accepts X and Twitter profile URLs', () => {
  const scraper = Object.create(GoogleScraper.prototype);
  const links = scraper._extractSocialLinks([
    {
      title: 'Ada Lovelace (@ada) / X',
      url: 'https://x.com/ada',
      snippet: 'Founder at Analytical Engines',
    },
    {
      title: 'Ada Lovelace (@ada_old) / Twitter',
      url: 'https://twitter.com/ada_old',
      snippet: 'Founder at Analytical Engines',
    },
  ], 'Ada Lovelace', 'Analytical Engines');

  assert.equal(links.x, 'https://x.com/ada');
});

test('Google social extraction rejects non-profile X URLs', () => {
  const scraper = Object.create(GoogleScraper.prototype);
  const links = scraper._extractSocialLinks([
    {
      title: 'Ada Lovelace on X',
      url: 'https://x.com/ada/status/1234567890',
      snippet: 'A post result, not a profile page',
    },
    {
      title: 'Search / X',
      url: 'https://x.com/search?q=Ada%20Lovelace',
      snippet: 'Search page',
    },
  ], 'Ada Lovelace', 'Analytical Engines');

  assert.equal(links.x, null);
});

test('company search extracts a matching company X URL', async () => {
  const scraper = Object.create(GoogleScraper.prototype);
  scraper.init = async () => {};
  scraper.close = async () => {};
  scraper._scrapeCompanyContactPages = async () => [];
  scraper._searchGoogle = async (query) => {
    if (query.includes('site:x.com') || query.includes('site:twitter.com')) {
      return [{
        title: 'Analytical Engines (@analyticaleng) / X',
        url: 'https://x.com/analyticaleng',
        snippet: 'Official X account for Analytical Engines.',
      }];
    }
    return [];
  };

  const result = await scraper.searchCompany('Analytical Engines');

  assert.equal(result.companyXUrl, 'https://x.com/analyticaleng');
});

test('trusted personal X candidate is marked as usable evidence', () => {
  const validation = validateXCandidate({
    found: true,
    url: 'https://x.com/adalovelace',
    profile: {
      username: 'adalovelace',
      displayName: 'Ada Lovelace',
      bio: 'Founder at Analytical Engines',
      recentPosts: [{ text: 'Thinking about computation engines.' }],
    },
  }, 'Ada Lovelace', 'Analytical Engines', 'google');

  assert.equal(validation.ok, true);
  assert.equal(validation.data.matchConfidence, 'high');
  assert.equal(validation.data.excludedFromAnalysis, undefined);
});

test('low confidence personal X candidate is excluded and posts are removed', () => {
  const validation = validateXCandidate({
    found: true,
    url: 'https://x.com/randombrand',
    profile: {
      username: 'randombrand',
      displayName: 'Random Brand',
      bio: 'Official shopping updates',
      recentPosts: [{ text: 'New sale today.' }],
    },
  }, 'Ada Lovelace', 'Analytical Engines', 'supplemental-google');

  assert.equal(validation.ok, false);
  assert.equal(validation.data.excludedFromAnalysis, true);
  assert.deepEqual(validation.data.profile.recentPosts, []);
});

test('trusted company X candidate is marked as company scope', () => {
  const validation = validateCompanyXCandidate({
    found: true,
    url: 'https://x.com/analyticaleng',
    profile: {
      username: 'analyticaleng',
      displayName: 'Analytical Engines',
      bio: 'Official account for Analytical Engines.',
      website: 'https://analyticalengines.example',
      recentPosts: [{ text: 'Analytical Engines product launch.' }],
    },
  }, 'Analytical Engines');

  assert.equal(validation.ok, true);
  assert.equal(validation.data.scope, 'company');
  assert.equal(validation.data.matchConfidence, 'high');
});

test('low confidence company X candidate is excluded and posts are removed', () => {
  const validation = validateCompanyXCandidate({
    found: true,
    url: 'https://x.com/randombrand',
    profile: {
      username: 'randombrand',
      displayName: 'Random Brand',
      bio: 'Shopping updates',
      recentPosts: [{ text: 'Sale.' }],
    },
  }, 'Analytical Engines');

  assert.equal(validation.ok, false);
  assert.equal(validation.data.scope, 'company');
  assert.equal(validation.data.excludedFromAnalysis, true);
  assert.deepEqual(validation.data.profile.recentPosts, []);
});

test('trusted personal X contributes only personal unified data', () => {
  const validation = validateXCandidate({
    found: true,
    url: 'https://x.com/adalovelace',
    profile: {
      username: 'adalovelace',
      displayName: 'Ada Lovelace',
      bio: 'Founder at Analytical Engines. Reach ada@example.com',
      followersCount: 1200,
      followingCount: 100,
      recentPosts: [{ text: 'Computing engines.', timestamp: '2026-06-01T00:00:00.000Z' }],
    },
  }, 'Ada Lovelace', 'Analytical Engines');

  const merged = mergeData(
    { name: 'Ada Lovelace', company: 'Analytical Engines' },
    { x: validation.data },
    null
  );

  assert.equal(merged.platforms.x.url, 'https://x.com/adalovelace');
  assert.equal(merged.unified.profileLinks.x, 'https://x.com/adalovelace');
  assert.equal(merged.unified.socialStats.xFollowers, 1200);
  assert.equal(merged.unified.socialActivity.x.recentPostsCount, 1);
  assert.equal(merged.unified.contacts.verifiedEmails.includes('ada@example.com'), true);
});

test('excluded personal X does not contribute to unified data', () => {
  const validation = validateXCandidate({
    found: true,
    url: 'https://x.com/randombrand',
    profile: {
      username: 'randombrand',
      displayName: 'Random Brand',
      bio: 'Sale updates',
      followersCount: 9999,
      recentPosts: [{ text: 'Sale.' }],
    },
  }, 'Ada Lovelace', 'Analytical Engines');

  const merged = mergeData(
    { name: 'Ada Lovelace', company: 'Analytical Engines' },
    { x: validation.data },
    null
  );

  assert.equal(merged.platforms.x.excludedFromAnalysis, true);
  assert.equal(merged.unified.profileLinks, null);
  assert.equal(merged.unified.socialStats, null);
  assert.equal(merged.unified.socialActivity, null);
});

test('trusted company X contributes only company research', () => {
  const validation = validateCompanyXCandidate({
    found: true,
    url: 'https://x.com/analyticaleng',
    profile: {
      username: 'analyticaleng',
      displayName: 'Analytical Engines',
      bio: 'Official product updates for Analytical Engines.',
      followersCount: 5000,
      recentPosts: [{ text: 'Company launch.', timestamp: '2026-06-02T00:00:00.000Z' }],
    },
  }, 'Analytical Engines');

  const merged = mergeData(
    { name: 'Ada Lovelace', company: 'Analytical Engines' },
    { companyX: validation.data },
    { companyXUrl: 'https://x.com/analyticaleng' }
  );

  assert.equal(merged.companyResearch.xUrl, 'https://x.com/analyticaleng');
  assert.equal(merged.companyResearch.xProfile.scope, 'company');
  assert.equal(merged.unified.about, null);
  assert.equal(merged.unified.profileLinks, null);
});

test('XScraper normalizes X and Twitter profile URLs', async () => {
  const { XScraper } = await import('../src/scrapers/x.js');
  const scraper = Object.create(XScraper.prototype);

  assert.equal(scraper._normalizeUrl('https://twitter.com/Ada_Lovelace?ref=home'), 'https://x.com/Ada_Lovelace');
  assert.equal(scraper._normalizeUrl('https://x.com/Ada_Lovelace/status/123'), 'https://x.com/Ada_Lovelace');
});

test('XScraper rejects invalid profile URLs', async () => {
  const { XScraper } = await import('../src/scrapers/x.js');
  const scraper = Object.create(XScraper.prototype);

  assert.throws(() => scraper._normalizeUrl('https://x.com/search?q=ada'), /不是有效的 X 主页/);
  assert.throws(() => scraper._normalizeUrl('https://example.com/ada'), /不是有效的 X 主页/);
});

test('XScraper parses compact metric text safely', async () => {
  const { XScraper } = await import('../src/scrapers/x.js');
  const scraper = Object.create(XScraper.prototype);

  assert.equal(scraper._parseCount('1.2K'), 1200);
  assert.equal(scraper._parseCount('3.4万'), 34000);
  assert.equal(scraper._parseCount(''), null);
});

test('Markdown report includes trusted X evidence', async () => {
  const { generateMarkdown } = await import('../src/output/markdown.js');
  const md = generateMarkdown({
    query: { name: 'Ada Lovelace', company: 'Analytical Engines' },
    fetchedAt: '2026-06-23T00:00:00.000Z',
    platforms: {
      x: {
        found: true,
        url: 'https://x.com/adalovelace',
        profile: {
          username: 'adalovelace',
          displayName: 'Ada Lovelace',
          bio: 'Founder at Analytical Engines',
          followersCount: 1200,
          recentPosts: [{ text: 'Computing engines.', timestamp: '2026-06-01T00:00:00.000Z' }],
        },
      },
    },
    unified: {
      name: 'Ada Lovelace',
      socialStats: { xFollowers: 1200 },
      socialActivity: { x: { recentPostsCount: 1, latestPostDate: '2026-06-01T00:00:00.000Z' } },
      profileLinks: { x: 'https://x.com/adalovelace' },
    },
  }, { company: {}, person: {}, salesInsights: {} });

  assert.equal(md.includes('X 粉丝: 1,200'), true);
  assert.equal(md.includes('[X](https://x.com/adalovelace)'), true);
  assert.equal(md.includes('### X'), true);
});

test('reports keep excluded Instagram detail link but omit it from profile links', async () => {
  const { generateMarkdown } = await import('../src/output/markdown.js');
  const { generateHtml } = await import('../src/output/html.js');
  const data = {
    query: { name: 'Tim Steckel', company: 'Compost Marketing Agency' },
    fetchedAt: '2026-06-24T00:00:00.000Z',
    platforms: {
      instagram: {
        found: true,
        url: 'https://www.instagram.com/thetimsteckel/',
        excludedFromAnalysis: true,
        note: 'Instagram @thetimsteckel 只有通用页面摘要，已排除出兴趣爱好分析',
        profile: {
          username: 'thetimsteckel',
          fullName: 'Tim Steckel',
          bio: '通用页面摘要',
          recentPosts: [],
        },
      },
    },
    unified: {
      name: 'Tim Steckel',
      profileLinks: null,
    },
  };
  const analysis = { company: {}, person: {}, salesInsights: {} };

  const md = generateMarkdown(data, analysis);
  const html = generateHtml(data, analysis);

  assert.equal(md.includes('**主页链接**'), false);
  assert.equal(md.includes('- **主页**：https://www.instagram.com/thetimsteckel/'), true);
  assert.equal(html.includes('class="ig">Instagram</a>'), false);
  assert.equal(html.includes('<strong>主页</strong>：<a href="https://www.instagram.com/thetimsteckel/"'), true);
});
