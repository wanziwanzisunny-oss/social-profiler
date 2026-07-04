import assert from 'node:assert/strict';
import test from 'node:test';

test('analysis evidence summarizes trusted personal and company posts for deep mode', async () => {
  const mod = await import('../src/analyzer/llm.js');

  assert.equal(typeof mod.buildAnalysisEvidence, 'function');

  const evidence = mod.buildAnalysisEvidence({
    unified: {
      socialActivity: {
        instagram: { recentPostsCount: 2, avgLikes: 12, avgComments: 2 },
        x: { recentPostsCount: 1 },
      },
    },
    platforms: {
      linkedin: {
        found: true,
        profile: {
          recentPosts: [
            { text: 'Launching a CRM workflow for enterprise sales teams', date: '2026-07-01' },
          ],
        },
      },
      instagram: {
        found: true,
        profile: {
          recentPosts: [
            { caption: 'Weekend sailing with founders after a product workshop', likes: 18, comments: 3 },
          ],
        },
      },
      x: {
        found: true,
        profile: {
          recentPosts: [
            { text: 'Thinking about pipeline automation and buyer intent data.' },
          ],
        },
      },
      facebook: {
        found: true,
        excludedFromAnalysis: true,
        profile: {
          recentPosts: [
            { text: 'This low confidence post must not influence the profile.' },
          ],
        },
      },
      companyX: {
        found: true,
        profile: {
          recentPosts: [
            { text: 'Acme announces a new enterprise analytics integration.' },
          ],
        },
      },
    },
  });

  assert.match(evidence, /可信个人动态/);
  assert.match(evidence, /LinkedIn.*CRM workflow/);
  assert.match(evidence, /Instagram.*Weekend sailing/);
  assert.match(evidence, /X.*pipeline automation/);
  assert.match(evidence, /可信公司动态/);
  assert.match(evidence, /公司 X.*enterprise analytics integration/);
  assert.match(evidence, /社交活跃度摘要/);
  assert.doesNotMatch(evidence, /low confidence/i);
});
