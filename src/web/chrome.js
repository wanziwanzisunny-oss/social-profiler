import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { config } from '../config.js';

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function joinWindowsPath(root, ...parts) {
  return root ? [root, ...parts].join('\\') : null;
}

export function chromeExecutableCandidates({ platform = process.platform, env = process.env } = {}) {
  const override = env.CHROME_PATH;

  if (platform === 'darwin') {
    return unique([
      override,
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      path.join(os.homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
    ]);
  }

  if (platform === 'win32') {
    const programFiles = env.PROGRAMFILES || env.ProgramFiles;
    const programFilesX86 = env['PROGRAMFILES(X86)'] || env['ProgramFiles(x86)'];
    const localAppData = env.LOCALAPPDATA || env.LocalAppData;

    return unique([
      override,
      joinWindowsPath(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      joinWindowsPath(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      joinWindowsPath(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ]);
  }

  return unique([
    override,
    'google-chrome',
    'google-chrome-stable',
    'chromium',
    'chromium-browser',
  ]);
}

function isPathLike(candidate) {
  return candidate.includes('/') ||
    candidate.includes('\\') ||
    /^[A-Za-z]:[\\/]/.test(candidate);
}

function pathEntries(env, platform) {
  const pathValue = env.PATH || env.Path || env.path || '';
  const delimiter = platform === 'win32' ? ';' : ':';
  return pathValue.split(delimiter).filter(Boolean);
}

async function resolveCommand(command, { platform, env, accessFn }) {
  const extensions = platform === 'win32' && !path.extname(command)
    ? ['.exe', '.cmd', '.bat', '']
    : [''];

  for (const dir of pathEntries(env, platform)) {
    for (const ext of extensions) {
      const fullPath = path.join(dir, `${command}${ext}`);
      try {
        await accessFn(fullPath);
        return fullPath;
      } catch {
        // Keep searching.
      }
    }
  }

  return null;
}

export async function findChromeExecutable({
  platform = process.platform,
  env = process.env,
  accessFn = fs.access,
} = {}) {
  for (const candidate of chromeExecutableCandidates({ platform, env })) {
    if (!isPathLike(candidate)) {
      const resolved = await resolveCommand(candidate, { platform, env, accessFn });
      if (resolved) return resolved;
      continue;
    }

    try {
      await accessFn(candidate);
      return candidate;
    } catch {
      // Keep searching.
    }
  }

  return null;
}

function cdpVersionUrl(endpoint) {
  const base = endpoint.endsWith('/') ? endpoint : `${endpoint}/`;
  return new URL('json/version', base).toString();
}

export async function waitForCdp(endpoint, {
  fetchFn = fetch,
  timeoutMs = 10000,
  intervalMs = 250,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  const url = cdpVersionUrl(endpoint);

  while (Date.now() <= deadline) {
    try {
      const res = await fetchFn(url);
      if (res.ok) return true;
    } catch {
      // Chrome may still be starting.
    }

    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  return false;
}

function spawnChrome(chromePath, args, options, spawnFn) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnFn(chromePath, args, options);
    } catch (err) {
      reject(err);
      return;
    }

    const onError = (err) => {
      cleanup();
      reject(err);
    };
    const onSpawn = () => {
      cleanup();
      resolve(child);
    };
    const cleanup = () => {
      child.off?.('error', onError);
      child.off?.('spawn', onSpawn);
    };

    child.once?.('error', onError);
    child.once?.('spawn', onSpawn);
  });
}

export async function startChromeForCdp({
  endpoint = config.browser.cdpEndpoint,
  userDataDir = path.join(os.homedir(), '.social-profiler-chrome'),
  platform = process.platform,
  env = process.env,
  accessFn = fs.access,
  mkdirFn = fs.mkdir,
  spawnFn = spawn,
  fetchFn = fetch,
  waitTimeoutMs = 10000,
  waitIntervalMs = 250,
} = {}) {
  const endpointUrl = new URL(endpoint);
  const port = endpointUrl.port || (endpointUrl.protocol === 'https:' ? '443' : '80');
  const chromePath = await findChromeExecutable({ platform, env, accessFn });

  if (!chromePath) {
    throw new Error(
      '找不到 Chrome 可执行文件。请确认已安装 Google Chrome，或在 .env 中设置 CHROME_PATH 指向 chrome.exe。'
    );
  }

  await mkdirFn(userDataDir, { recursive: true });

  try {
    const child = await spawnChrome(
      chromePath,
      [
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${userDataDir}`,
        '--no-first-run',
        '--no-default-browser-check',
      ],
      { detached: true, stdio: 'ignore' },
      spawnFn
    );
    child.unref?.();
  } catch (err) {
    throw new Error(`启动 Chrome 失败: ${err.message}`);
  }

  const connected = await waitForCdp(endpoint, {
    fetchFn,
    timeoutMs: waitTimeoutMs,
    intervalMs: waitIntervalMs,
  });

  if (!connected) {
    throw new Error(
      `Chrome 已启动，但 ${endpoint} 没有在 ${Math.ceil(waitTimeoutMs / 1000)} 秒内响应。请确认端口未被占用，或在 .env 中调整 CDP_ENDPOINT。`
    );
  }

  return {
    ok: true,
    message: '已启动专用 Chrome',
    endpoint,
    chromePath,
    connected,
  };
}
