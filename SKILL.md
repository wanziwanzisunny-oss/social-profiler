---
name: social-profiler
description: Run and maintain the Social Profiler prospect-research workflow. Use when a user wants Codex to research a person or company from public social/web sources, generate a customer profile report, manage Social Profiler browser sessions, send reports to Feishu, operate the local Web UI or CLI, or prepare this repository as a GitHub-hosted Codex skill.
---

# Social Profiler

Use this skill to operate the Social Profiler tool safely and reproducibly.

## Safety Boundaries

- Treat `.env`, `sessions/`, root `output/`, debug screenshots, logs, exported reports, and generated PDFs as private local data.
- Never commit API keys, browser storage state, cookies, customer reports, or screenshots.
- Use only public information or browser sessions the user explicitly owns and authorizes.
- Keep source trust warnings visible in final reports; do not present low-confidence account matches as facts.
- If preparing a public GitHub repo, scan staged files and history for secrets before any push.

## Setup

From the repository root:

```bash
npm install
cp .env.example .env
```

Configure `.env`:

```env
ANTHROPIC_API_KEY=your_key_here
ANTHROPIC_BASE_URL=https://api.anthropic.com
ANTHROPIC_MODEL=claude-sonnet-4-20250514
CDP_ENDPOINT=http://localhost:9222
```

Optional Feishu settings:

```env
FEISHU_CHAT_ID=oc_xxx
PUBLIC_BASE_URL=http://localhost:3000
```

## Workflow

1. Confirm the target query: name, company, and optional LinkedIn URL.
2. Check login state with `npm run session:check`.
3. If needed, save a platform session with `node src/cli.js session login <platform>`.
4. Run a lookup from either the Web UI or CLI.
5. Review generated warnings, matched accounts, and excluded sources.
6. Export or send the report only after the user confirms the content is appropriate.

## Web UI

Start the local app:

```bash
npm run web
```

Open `http://localhost:3000`. Use the UI for new lookup, history review, session management, PDF export, and Feishu sending.

## CLI

Single lookup:

```bash
node src/cli.js lookup --name "Jane Doe" --company "Acme" --output all
```

Batch lookup:

```bash
node src/cli.js batch --input targets.csv --output html --delay 8000
```

Session commands:

```bash
npm run session:check
node src/cli.js session login linkedin
node src/cli.js session login instagram
node src/cli.js session login x
```

## Validation

Before claiming the repository or workflow is ready:

```bash
node --test tests/*.test.js
git status --short --ignored
git ls-files | rg -n '(^\.env$|^\.env\.(?!example$)|^sessions/|^output/|^node_modules/|^.*social-profiler\.txt$|^\.DS_Store$)'
```

Also run a secret scanner or targeted repository scan for API keys, private keys, browser tokens, access tokens, refresh tokens, and authorization headers.

Expected result: tests pass; ignored local artifacts stay untracked; secret scans return no real secrets except safe placeholders in `.env.example`.
