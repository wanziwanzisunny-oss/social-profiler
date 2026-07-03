import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeData } from '../src/analyzer/merge.js';
import { GoogleScraper } from '../src/scrapers/google.js';
import { extractContactsFromText, mergeContacts } from '../src/utils/contacts.js';

test('extractContactsFromText keeps source metadata for public contacts', () => {
  const contacts = extractContactsFromText('Email sales@example.com or call +1 415-555-0199', {
    url: 'https://example.com/contact',
    title: 'Contact',
    scope: 'company',
  });

  assert.deepEqual(contacts.map(c => c.value), ['sales@example.com', '+1 415-555-0199']);
  assert.equal(contacts[0].sourceUrl, 'https://example.com/contact');
  assert.equal(contacts[0].scope, 'company');
});

test('extractContactsFromText ignores long URL ids as phone numbers', () => {
  const contacts = extractContactsFromText(
    'https://podcasts.apple.com/us/podcast/example/id1523307967?i=1000702507848',
    {
      url: 'https://podcasts.apple.com/us/podcast/example/id1523307967?i=1000702507848',
      title: 'Podcast',
      scope: 'company',
      allowPhones: false,
    }
  );

  assert.deepEqual(contacts, []);
});

test('mergeContacts filters phone-like IDs from social and media URLs', () => {
  const contacts = mergeContacts([
    {
      type: 'phone',
      value: '1523307967',
      sourceUrl: 'https://podcasts.apple.com/us/podcast/example/id1523307967',
    },
    {
      type: 'phone',
      value: '7275865769047994368',
      sourceUrl: 'https://www.linkedin.com/posts/example-7275865769047994368',
    },
    {
      type: 'phone',
      value: '216.290.2588',
      sourceUrl: 'https://compost-marketing.com/contact',
    },
    {
      type: 'phone',
      value: '+12162902588',
      sourceUrl: 'tel:+12162902588',
    },
  ]);

  assert.deepEqual(contacts.map(c => c.value), ['+1 216 290 2588']);
});

test('mergeContacts normalizes and deduplicates US phone formats', () => {
  const contacts = mergeContacts([
    {
      type: 'phone',
      value: '216.290.2588',
      sourceUrl: 'https://compost-marketing.com/contact',
    },
    {
      type: 'phone',
      value: '+12162902588',
      sourceUrl: 'tel:+12162902588',
    },
  ]);

  assert.equal(contacts.length, 1);
  assert.equal(contacts[0].value, '+1 216 290 2588');
  assert.equal(contacts[0].sourceUrl, 'tel:+12162902588');
});


test('Google company search extracts contacts from website contact pages', async () => {
  const scraper = Object.create(GoogleScraper.prototype);
  scraper.init = async () => {};
  scraper.close = async () => {};
  scraper.goto = async (url) => { scraper.currentUrl = url; };
  scraper._searchGoogle = async (query) => {
    if (query.includes('official website')) {
      return [{ title: 'Acme - Official Website', url: 'https://acme.example/', snippet: 'Acme products' }];
    }
    return [];
  };
  scraper.page = {
    isClosed: () => false,
    waitForLoadState: async () => {},
    evaluate: async () => ({
      title: 'Contact Acme',
      text: 'Contact sales@acme.example or +1 212-555-0100',
      links: [],
    }),
  };

  const companyData = await scraper.searchCompany('Acme');

  assert.equal(companyData.publicContacts.length, 2);
  assert.equal(companyData.publicContacts[0].value, 'sales@acme.example');
  assert.ok(companyData.publicContacts[0].sourceUrl.startsWith('https://acme.example/'));

  const merged = mergeData({ name: 'Jane Doe', company: 'Acme' }, {}, companyData);
  assert.deepEqual(merged.unified.contacts.verifiedEmails, ['sales@acme.example']);
  assert.deepEqual(merged.unified.contacts.verifiedPhones, ['+1 212 555 0100']);
  assert.equal(merged.unified.contacts.sources[0].scope, 'company');
});

test('Google company search does not treat generic industry articles as official website', async () => {
  const scraper = Object.create(GoogleScraper.prototype);
  scraper.init = async () => {};
  scraper.close = async () => {};
  scraper._scrapeCompanyContactPages = async () => {
    throw new Error('should not scrape contacts without a trusted company website');
  };
  scraper._searchGoogle = async (query) => {
    if (query.includes('official website')) {
      return [
        { title: 'What is Global Sourcing? | CIPS', url: 'https://www.cips.org/intelligence-hub/sourcing/global-sourcing', snippet: '' },
      ];
    }
    if (query.includes('company')) {
      return [
        { title: '82-4475535 - INNOVA GLOBAL SOURCING LLC', url: 'https://www.city-data.com/business-entities/FL/INNOVA-GLOBAL-SOURCING-LLC-82-4475535-FL.html', snippet: '' },
      ];
    }
    return [];
  };

  const companyData = await scraper.searchCompany('Innova Global Sourcing LLC');

  assert.equal(companyData.companyWebsite, null);
  assert.deepEqual(companyData.publicContacts, []);
  assert.equal(companyData.businessResults.some(r => r.url.includes('cips.org')), false);
});
