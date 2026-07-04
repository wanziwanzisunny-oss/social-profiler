#!/usr/bin/env node

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(__dirname, '..');

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function quoteWindows(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function run(command, args, options = {}) {
  execFileSync(command, args, { stdio: 'inherit', ...options });
}

function runQuiet(command, args, options = {}) {
  try {
    execFileSync(command, args, { stdio: 'ignore', ...options });
    return true;
  } catch {
    return false;
  }
}

export function resolveServiceConfig({
  rootDir = DEFAULT_ROOT,
  nodePath = process.execPath,
  homeDir = os.homedir(),
  platform = process.platform,
  env = process.env,
} = {}) {
  const label = 'com.social-profiler.web';
  const taskName = 'SocialProfilerWeb';
  const host = env.HOST || '127.0.0.1';
  const port = String(env.PORT || '3000');
  const logsDir = path.join(rootDir, 'output', 'logs');

  return {
    label,
    taskName,
    platform,
    host,
    port,
    rootDir,
    nodePath,
    runnerPath: path.join(rootDir, 'scripts', 'run-web-service.js'),
    logsDir,
    logPath: path.join(logsDir, 'web.log'),
    errorLogPath: path.join(logsDir, 'web-error.log'),
    plistPath: path.join(homeDir, 'Library', 'LaunchAgents', `${label}.plist`),
  };
}

export function buildMacLaunchAgentPlist(config) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(config.label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(config.nodePath)}</string>
    <string>${xmlEscape(config.runnerPath)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(config.rootDir)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${xmlEscape(config.logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(config.errorLogPath)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOST</key>
    <string>${xmlEscape(config.host)}</string>
    <key>PORT</key>
    <string>${xmlEscape(config.port)}</string>
  </dict>
</dict>
</plist>
`;
}

export function buildWindowsTaskCreateArgs(config) {
  return [
    '/Create',
    '/TN',
    config.taskName,
    '/SC',
    'ONLOGON',
    '/TR',
    `${quoteWindows(config.nodePath)} ${quoteWindows(config.runnerPath)}`,
    '/RL',
    'LIMITED',
    '/F',
  ];
}

function macServiceTarget(config) {
  const uid = process.getuid?.();
  return uid === undefined ? null : `gui/${uid}`;
}

async function installMac(config) {
  await fs.mkdir(path.dirname(config.plistPath), { recursive: true });
  await fs.mkdir(config.logsDir, { recursive: true });
  await fs.writeFile(config.plistPath, buildMacLaunchAgentPlist(config), 'utf-8');

  const target = macServiceTarget(config);
  if (target) {
    runQuiet('launchctl', ['bootout', target, config.plistPath]);
    run('launchctl', ['bootstrap', target, config.plistPath]);
    runQuiet('launchctl', ['enable', `${target}/${config.label}`]);
    runQuiet('launchctl', ['kickstart', '-k', `${target}/${config.label}`]);
  } else {
    runQuiet('launchctl', ['unload', config.plistPath]);
    run('launchctl', ['load', config.plistPath]);
  }
}

async function uninstallMac(config) {
  const target = macServiceTarget(config);
  if (target) {
    runQuiet('launchctl', ['bootout', target, config.plistPath]);
  } else {
    runQuiet('launchctl', ['unload', config.plistPath]);
  }
  await fs.rm(config.plistPath, { force: true });
}

function startMac(config) {
  const target = macServiceTarget(config);
  if (target) {
    const kicked = runQuiet('launchctl', ['kickstart', '-k', `${target}/${config.label}`]);
    if (!kicked) {
      run('launchctl', ['bootstrap', target, config.plistPath]);
      runQuiet('launchctl', ['kickstart', '-k', `${target}/${config.label}`]);
    }
  } else {
    run('launchctl', ['load', config.plistPath]);
  }
}

function stopMac(config) {
  const target = macServiceTarget(config);
  if (target) {
    run('launchctl', ['bootout', target, config.plistPath]);
  } else {
    run('launchctl', ['unload', config.plistPath]);
  }
}

function statusMac(config) {
  const target = macServiceTarget(config);
  const ok = target
    ? runQuiet('launchctl', ['print', `${target}/${config.label}`])
    : runQuiet('launchctl', ['list', config.label]);
  console.log(ok ? 'Social Profiler service is installed/running.' : 'Social Profiler service is not running.');
}

async function installWindows(config) {
  await fs.mkdir(config.logsDir, { recursive: true });
  run('schtasks.exe', buildWindowsTaskCreateArgs(config));
  runQuiet('schtasks.exe', ['/Run', '/TN', config.taskName]);
}

function uninstallWindows(config) {
  runQuiet('schtasks.exe', ['/End', '/TN', config.taskName]);
  runQuiet('schtasks.exe', ['/Delete', '/TN', config.taskName, '/F']);
}

function startWindows(config) {
  run('schtasks.exe', ['/Run', '/TN', config.taskName]);
}

function stopWindows(config) {
  run('schtasks.exe', ['/End', '/TN', config.taskName]);
}

function statusWindows(config) {
  run('schtasks.exe', ['/Query', '/TN', config.taskName]);
}

async function install(config) {
  if (config.platform === 'darwin') return installMac(config);
  if (config.platform === 'win32') return installWindows(config);
  throw new Error('后台服务安装目前支持 macOS 和 Windows。Linux 用户可继续使用 npm run web。');
}

async function uninstall(config) {
  if (config.platform === 'darwin') return uninstallMac(config);
  if (config.platform === 'win32') return uninstallWindows(config);
  throw new Error('后台服务卸载目前支持 macOS 和 Windows。');
}

function start(config) {
  if (config.platform === 'darwin') return startMac(config);
  if (config.platform === 'win32') return startWindows(config);
  throw new Error('后台服务启动目前支持 macOS 和 Windows。');
}

function stop(config) {
  if (config.platform === 'darwin') return stopMac(config);
  if (config.platform === 'win32') return stopWindows(config);
  throw new Error('后台服务停止目前支持 macOS 和 Windows。');
}

function status(config) {
  if (config.platform === 'darwin') return statusMac(config);
  if (config.platform === 'win32') return statusWindows(config);
  throw new Error('后台服务状态检查目前支持 macOS 和 Windows。');
}

async function main() {
  const command = process.argv[2] || 'status';
  const config = resolveServiceConfig();

  if (command === 'install') {
    await install(config);
    console.log(`Social Profiler service installed. Open http://localhost:${config.port}`);
    return;
  }
  if (command === 'uninstall') {
    await uninstall(config);
    console.log('Social Profiler service uninstalled.');
    return;
  }
  if (command === 'start') {
    start(config);
    console.log(`Social Profiler service started. Open http://localhost:${config.port}`);
    return;
  }
  if (command === 'stop') {
    stop(config);
    console.log('Social Profiler service stopped.');
    return;
  }
  if (command === 'status') {
    status(config);
    return;
  }

  throw new Error(`未知命令: ${command}. 可用命令: install, uninstall, start, stop, status`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
