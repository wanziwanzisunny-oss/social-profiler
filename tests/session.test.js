import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { config } from '../src/config.js';
import { checkAllSessions } from '../src/browser/session.js';

test('session status includes X alongside existing social platforms', async () => {
  const originalSessionsDir = config.sessionsDir;
  const tempSessionsDir = await mkdtemp(path.join(tmpdir(), 'social-profiler-sessions-'));
  config.sessionsDir = tempSessionsDir;

  try {
    const sessions = await checkAllSessions();

    assert.deepEqual(Object.keys(sessions), ['linkedin', 'facebook', 'instagram', 'x']);
    assert.deepEqual(sessions.x, {
      exists: false,
      path: path.join(tempSessionsDir, 'x.json'),
      valid: false,
      reason: 'no_file',
    });
  } finally {
    config.sessionsDir = originalSessionsDir;
    await rm(tempSessionsDir, { recursive: true, force: true });
  }
});
