import assert from 'node:assert/strict';
import test from 'node:test';
import { executeLookup } from '../src/commands/lookup.js';

test('executeLookup stops before launching a browser when signal is already aborted', async () => {
  const controller = new AbortController();
  controller.abort();
  let browserLaunched = false;

  await assert.rejects(
    executeLookup(
      { name: 'Cancel Test', company: 'Acme' },
      { signal: controller.signal },
      {
        session: { checkSession: async () => ({ exists: false }) },
        launchBrowser: {
          launchBrowser: async () => {
            browserLaunched = true;
            throw new Error('browser should not launch after cancellation');
          },
          createContext: async () => {
            throw new Error('context should not be created after cancellation');
          },
          closeBrowser: async () => {},
          closeContext: async () => {},
        },
        GoogleScraper: { GoogleScraper: class {} },
        LinkedInScraper: { LinkedInScraper: class {} },
        InstagramScraper: { InstagramScraper: class {} },
        FacebookScraper: { FacebookScraper: class {} },
        XScraper: { XScraper: class {} },
        logger: { logger: { info: () => {}, warn: () => {} } },
        mergeData: { mergeData: () => ({}) },
        Analyzer: { Analyzer: class {} },
        writeJson: { writeJson: async () => null },
        writeMarkdown: { generateMarkdown: () => '', writeMarkdown: async () => null },
        writeHtml: { generateHtml: () => '', writeHtml: async () => null },
      }
    ),
    err => err.name === 'AbortError'
  );

  assert.equal(browserLaunched, false);
});

test('executeLookup closes the active browser when signal aborts during search', async () => {
  const controller = new AbortController();
  let closeBrowserCalled = false;
  let releaseScrape;
  const scrapeInterrupted = new Promise(resolve => {
    releaseScrape = resolve;
  });

  class WaitingGoogleScraper {
    async scrape() {
      await scrapeInterrupted;
      throw new Error('browser was closed');
    }
  }

  const lookupPromise = executeLookup(
    { name: 'Cancel Test', company: 'Acme' },
    { signal: controller.signal },
    {
      session: { checkSession: async () => ({ exists: false }) },
      launchBrowser: {
        launchBrowser: async () => ({ browser: {}, mode: 'playwright' }),
        createContext: async () => ({}),
        closeBrowser: async () => {
          closeBrowserCalled = true;
          releaseScrape();
        },
        closeContext: async () => {},
      },
      GoogleScraper: { GoogleScraper: WaitingGoogleScraper },
      LinkedInScraper: { LinkedInScraper: class {} },
      InstagramScraper: { InstagramScraper: class {} },
      FacebookScraper: { FacebookScraper: class {} },
      XScraper: { XScraper: class {} },
      logger: { logger: { info: () => {}, warn: () => {} } },
      mergeData: { mergeData: () => ({}) },
      Analyzer: { Analyzer: class {} },
      writeJson: { writeJson: async () => null },
      writeMarkdown: { generateMarkdown: () => '', writeMarkdown: async () => null },
      writeHtml: { generateHtml: () => '', writeHtml: async () => null },
    }
  );

  controller.abort();

  await assert.rejects(lookupPromise, err => err.name === 'AbortError');
  assert.equal(closeBrowserCalled, true);
});
