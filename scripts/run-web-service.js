#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const logsDir = path.join(rootDir, 'output', 'logs');

process.chdir(rootDir);
process.env.HOST ||= '127.0.0.1';
process.env.PORT ||= '3000';

fs.mkdirSync(logsDir, { recursive: true });

const logStream = fs.createWriteStream(path.join(logsDir, 'web.log'), { flags: 'a' });
const errorStream = fs.createWriteStream(path.join(logsDir, 'web-error.log'), { flags: 'a' });

function writeLine(stream, values) {
  const line = values.map((value) => {
    if (value instanceof Error) return value.stack || value.message;
    if (typeof value === 'string') return value;
    return JSON.stringify(value);
  }).join(' ');
  stream.write(`[${new Date().toISOString()}] ${line}\n`);
}

console.log = (...values) => writeLine(logStream, values);
console.info = (...values) => writeLine(logStream, values);
console.warn = (...values) => writeLine(errorStream, values);
console.error = (...values) => writeLine(errorStream, values);

process.on('uncaughtException', (err) => {
  console.error(err);
  process.exit(1);
});

process.on('unhandledRejection', (err) => {
  console.error(err instanceof Error ? err : new Error(String(err)));
  process.exit(1);
});

await import('../src/web/server.js');
