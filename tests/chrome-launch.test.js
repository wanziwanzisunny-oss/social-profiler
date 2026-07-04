import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  chromeExecutableCandidates,
  startChromeForCdp,
} from '../src/web/chrome.js';

test('chromeExecutableCandidates includes Windows Chrome install locations', () => {
  const candidates = chromeExecutableCandidates({
    platform: 'win32',
    env: {
      PROGRAMFILES: 'C:\\Program Files',
      'PROGRAMFILES(X86)': 'C:\\Program Files (x86)',
      LOCALAPPDATA: 'C:\\Users\\Ada\\AppData\\Local',
    },
  });

  assert.deepEqual(candidates, [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Users\\Ada\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe',
  ]);
});

test('chromeExecutableCandidates accepts common Windows environment variable casing', () => {
  const candidates = chromeExecutableCandidates({
    platform: 'win32',
    env: {
      ProgramFiles: 'C:\\Program Files',
      'ProgramFiles(x86)': 'C:\\Program Files (x86)',
      LocalAppData: 'C:\\Users\\Ada\\AppData\\Local',
    },
  });

  assert.deepEqual(candidates, [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Users\\Ada\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe',
  ]);
});

test('startChromeForCdp rejects missing Chrome without spawning', async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'social-profiler-chrome-test-'));
  let spawnCalled = false;

  try {
    await assert.rejects(
      startChromeForCdp({
        endpoint: 'http://localhost:9222',
        userDataDir,
        platform: 'win32',
        env: {
          PROGRAMFILES: 'C:\\Program Files',
          'PROGRAMFILES(X86)': 'C:\\Program Files (x86)',
          LOCALAPPDATA: 'C:\\Users\\Ada\\AppData\\Local',
        },
        accessFn: async () => {
          const err = new Error('not found');
          err.code = 'ENOENT';
          throw err;
        },
        spawnFn: () => {
          spawnCalled = true;
          throw new Error('spawn should not be called');
        },
      }),
      /找不到 Chrome/
    );

    assert.equal(spawnCalled, false);
  } finally {
    await rm(userDataDir, { recursive: true, force: true });
  }
});

test('startChromeForCdp turns spawn ENOENT into a request error', async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'social-profiler-chrome-test-'));

  try {
    await assert.rejects(
      startChromeForCdp({
        endpoint: 'http://localhost:9222',
        userDataDir,
        platform: 'win32',
        env: { CHROME_PATH: 'C:\\Missing\\chrome.exe' },
        accessFn: async () => {},
        spawnFn: () => {
          const child = new EventEmitter();
          child.unref = () => {};
          queueMicrotask(() => {
            const err = new Error('spawn C:\\Missing\\chrome.exe ENOENT');
            err.code = 'ENOENT';
            child.emit('error', err);
          });
          return child;
        },
      }),
      /启动 Chrome 失败/
    );
  } finally {
    await rm(userDataDir, { recursive: true, force: true });
  }
});

test('startChromeForCdp waits until the CDP endpoint responds', async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'social-profiler-chrome-test-'));
  let fetchCalls = 0;

  try {
    const result = await startChromeForCdp({
      endpoint: 'http://localhost:9222',
      userDataDir,
      platform: 'darwin',
      env: { CHROME_PATH: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' },
      accessFn: async () => {},
      spawnFn: () => {
        const child = new EventEmitter();
        child.unref = () => {};
        queueMicrotask(() => child.emit('spawn'));
        return child;
      },
      fetchFn: async () => ({ ok: ++fetchCalls >= 2 }),
      waitTimeoutMs: 100,
      waitIntervalMs: 1,
    });

    assert.equal(result.connected, true);
    assert.equal(fetchCalls, 2);
  } finally {
    await rm(userDataDir, { recursive: true, force: true });
  }
});
