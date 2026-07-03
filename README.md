# Social Profiler

[中文说明](README.zh-CN.md)

Social Profiler is a locally runnable customer profile research tool. It helps gather public web and social-profile evidence, merge it into a customer profile, analyze it with an LLM, and export or send the resulting report.

It is designed for sales and BD research where the user controls the local environment, credentials, and browser sessions.

## What It Does

- Searches Google for a target person and company.
- Finds likely LinkedIn, Instagram, Facebook, and X profiles.
- Uses browser automation to read public profile data and user-authorized sessions.
- Validates account matches and keeps low-confidence sources out of analysis.
- Adds company website, social, news, jobs, and public contact signals.
- Generates JSON, Markdown, HTML, and PDF-style report outputs.
- Supports a local Web UI, CLI workflow, batch lookup, and optional Feishu delivery.

## End-To-End Flow

1. Configure local secrets in `.env`.
2. Install dependencies with `npm install`.
3. Optionally connect Chrome CDP or save platform login sessions.
4. Start the Web UI or use the CLI.
5. Enter target name, company, and optional LinkedIn URL.
6. Social Profiler searches, scrapes, validates, merges, and analyzes evidence.
7. Review source warnings and excluded matches.
8. Export HTML/PDF, inspect history, tag reports, or send to Feishu.
9. Keep generated reports, browser sessions, screenshots, and API keys local.

## Repository Layout

```text
.
├── SKILL.md                 # Skill instructions, English entrypoint
├── SKILL.zh-CN.md           # Skill instructions, Chinese reference
├── agents/openai.yaml       # Skill UI metadata
├── src/                     # CLI, Web UI, scraping, analysis, output code
├── tests/                   # Node test suite
├── prompts/analyze.md       # LLM analysis prompt
├── scripts/                 # Helper scripts
├── .env.example             # Safe example configuration
└── README.md                # Human-facing project guide
```

Generated local data is intentionally not part of the public repo:

```text
.env
sessions/
output/
*.log
*.txt
debug screenshots
```

## Install As A Skill

After publishing this clean repository to GitHub, install or clone it as the `social-profiler` skill in your skills directory. The exact path depends on your runtime environment; the important part is that the installed folder contains `SKILL.md`, `agents/openai.yaml`, and the project files. Chinese instructions are available in `SKILL.zh-CN.md`.

Manual install:

```bash
git clone https://github.com/<owner>/<repo>.git <your-skills-dir>/social-profiler
```

Restart your app after installing so the new skill can be discovered.

## Local Setup

Install dependencies:

```bash
npm install
```

Create local config:

```bash
cp .env.example .env
```

Fill in your own LLM service settings:

```env
ANTHROPIC_API_KEY=your_llm_api_key
ANTHROPIC_BASE_URL=https://your-llm-endpoint.example.com
ANTHROPIC_MODEL=your_model_name
```

Optional browser and Feishu settings:

```env
CDP_ENDPOINT=http://localhost:9222
FEISHU_CHAT_ID=oc_xxx
PUBLIC_BASE_URL=http://localhost:3000
```

## Browser Sessions

The tool can use public pages without sessions, but some platforms work better with user-authorized browser state.

Check session status:

```bash
npm run session:check
```

Save a login session:

```bash
node src/cli.js session login linkedin
node src/cli.js session login instagram
node src/cli.js session login x
```

Session files are stored under `sessions/` and must stay private.

## Web UI

Start the local Web UI:

```bash
npm run web
```

Open:

```text
http://localhost:3000
```

Use the Web UI to:

- Run a new lookup.
- Watch progress across search, scraping, merge, analysis, and report generation.
- View report history.
- Manage tags.
- Check login state.
- Export HTML/PDF.
- Send reports to Feishu.

Do not open `src/web/public/index.html` directly. The UI needs the local server APIs.

## CLI Usage

Single lookup:

```bash
node src/cli.js lookup --name "Jane Doe" --company "Acme" --output all
```

With a known LinkedIn URL:

```bash
node src/cli.js lookup --name "Jane Doe" --company "Acme" --linkedin "https://linkedin.com/in/..." --output html
```

Send to Feishu:

```bash
node src/cli.js lookup --name "Jane Doe" --company "Acme" --feishu --output all
```

Batch lookup:

```bash
node src/cli.js batch --input targets.csv --output html --delay 8000
```

CSV format:

```csv
name,company
Jane Doe,Acme
John Smith,Example Inc
```

## Feishu Delivery

Feishu sending depends on local `lark-cli`.

If `FEISHU_CHAT_ID` is set, reports are sent to that chat. If it is not set, the tool can create or reuse a default private chat named `客户画像`, depending on the local Feishu app permissions.

If `PUBLIC_BASE_URL` is not set, report links default to `http://localhost:3000`, which usually only works on the same machine.

## Privacy And Security

`.env`, `sessions/`, `output/`, debug screenshots, run logs, and exported reports may contain API keys, login state, contacts, or customer profile data. Do not commit them to Git. These paths are covered by `.gitignore`; if a real key was ever committed, rotate it before publishing.

Social Profiler may process personal information. Use it only with public information or browser sessions you are authorized to access. Do not bypass access controls, collect non-public content, or retain information that is not relevant to the business purpose. Publicly visible information is not automatically unrestricted for collection, storage, or sharing.

Avoid collecting or inferring sensitive personal information, including health, religion, political views, minors' information, identity documents, financial accounts, or similar categories. Do not use this tool for harassment, discrimination, surveillance, or automated decisions that significantly affect people, such as hiring, credit, insurance, or housing decisions.

Privacy requirements vary by jurisdiction, platform, and use case. Before commercial, cross-border, or large-scale use, assess applicable laws, platform terms, and notice or consent obligations.

AI-generated reports and analysis are for reference only. Before using or sharing a report externally, manually verify source reliability, contact details, account matches, and inferred conclusions, and respect deletion, correction, or opt-out requests.

## Validation

Run tests:

```bash
node --test tests/*.test.js
```

Expected result:

```text
60 pass
0 fail
```
