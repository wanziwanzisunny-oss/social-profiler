import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMacLaunchAgentPlist,
  buildWindowsTaskCreateArgs,
  resolveServiceConfig,
} from '../scripts/service.js';

test('resolveServiceConfig points service at the web service runner', () => {
  const config = resolveServiceConfig({
    rootDir: '/Users/ada/social-profiler',
    nodePath: '/usr/local/bin/node',
    homeDir: '/Users/ada',
    platform: 'darwin',
  });

  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, '3000');
  assert.equal(config.runnerPath, '/Users/ada/social-profiler/scripts/run-web-service.js');
  assert.equal(config.logPath, '/Users/ada/social-profiler/output/logs/web.log');
  assert.equal(config.errorLogPath, '/Users/ada/social-profiler/output/logs/web-error.log');
});

test('buildMacLaunchAgentPlist starts Social Profiler at login', () => {
  const plist = buildMacLaunchAgentPlist({
    label: 'com.social-profiler.web',
    nodePath: '/usr/local/bin/node',
    runnerPath: '/Users/ada/social-profiler/scripts/run-web-service.js',
    rootDir: '/Users/ada/social-profiler',
    logPath: '/Users/ada/social-profiler/output/logs/web.log',
    errorLogPath: '/Users/ada/social-profiler/output/logs/web-error.log',
    host: '127.0.0.1',
    port: '3000',
  });

  assert.match(plist, /<key>Label<\/key>\s*<string>com\.social-profiler\.web<\/string>/);
  assert.match(plist, /<string>\/usr\/local\/bin\/node<\/string>/);
  assert.match(plist, /<string>\/Users\/ada\/social-profiler\/scripts\/run-web-service\.js<\/string>/);
  assert.match(plist, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.match(plist, /<key>KeepAlive<\/key>\s*<true\/>/);
  assert.match(plist, /<key>HOST<\/key>\s*<string>127\.0\.0\.1<\/string>/);
  assert.match(plist, /<key>PORT<\/key>\s*<string>3000<\/string>/);
});

test('buildWindowsTaskCreateArgs creates a logon task for the web service', () => {
  const args = buildWindowsTaskCreateArgs({
    taskName: 'SocialProfilerWeb',
    nodePath: 'C:\\Program Files\\nodejs\\node.exe',
    runnerPath: 'C:\\Users\\Ada\\social-profiler\\scripts\\run-web-service.js',
  });

  assert.deepEqual(args, [
    '/Create',
    '/TN',
    'SocialProfilerWeb',
    '/SC',
    'ONLOGON',
    '/TR',
    '"C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\Ada\\social-profiler\\scripts\\run-web-service.js"',
    '/RL',
    'LIMITED',
    '/F',
  ]);
});
