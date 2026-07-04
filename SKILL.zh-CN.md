---
name: social-profiler
description: 运行和维护 Social Profiler 客户画像调研流程。适用于需要 agent 基于公开网页和社交资料调研人物或公司、生成客户画像报告、管理 Social Profiler 浏览器登录态、发送飞书报告、操作本地 Web UI 或 CLI，或将本仓库作为 GitHub 托管 skill 发布的场景。
---

# Social Profiler

这是 `SKILL.md` 的中文参考版本。通用 skill 入口仍是 `SKILL.md`；本文件用于帮助中文使用者理解同一套工作流和安全边界。

使用这个 skill 时，以安全、可复现的方式操作 Social Profiler 工具。

## 安全边界

- 将 `.env`、`sessions/`、根目录 `output/`、调试截图、日志、导出报告和生成的 PDF 视为本地私有数据。
- 不要提交 API key、浏览器存储状态、cookies、客户报告或截图。
- 只使用公开信息，或用户明确拥有并授权使用的浏览器登录态。
- 不要绕过访问权限、抓取非公开内容，或保留与用户明确业务目的无关的信息。
- 避免采集敏感个人信息和受保护类别信息；不要将报告用于骚扰、歧视、监控，或会产生重大影响的自动化决策。
- 商业化、跨境或大规模使用前，先考虑适用的隐私法律、平台条款，以及告知或同意义务。
- 在最终报告中保留来源可信度提示；不要把低可信账号匹配当成事实。
- AI 生成的分析内容仅供参考，对外使用前需要人工核验。
- 如果准备发布公开 GitHub 仓库，推送前先扫描暂存文件和历史记录，确认没有泄露密钥。

## 安装配置

在仓库根目录运行：

```bash
npm install
cp .env.example .env
```

配置 `.env`：

```env
ANTHROPIC_API_KEY=your_llm_api_key
ANTHROPIC_BASE_URL=https://your-llm-endpoint.example.com
ANTHROPIC_MODEL=your_model_name
CHROME_PATH=
CDP_ENDPOINT=http://localhost:9222
```

可选飞书配置：

```env
FEISHU_CHAT_ID=oc_xxx
PUBLIC_BASE_URL=http://localhost:3000
```

## 工作流

1. 确认目标查询：姓名、公司，以及可选 LinkedIn URL。
2. 用 `npm run session:check` 检查登录状态。
3. 如有需要，用 `node src/cli.js session login <platform>` 保存平台登录态。
4. 通过 Web UI 或 CLI 运行查询。
5. 查看生成的警告、匹配账号和被排除来源。
6. 只有在用户确认内容适合使用后，才导出或发送报告。

## Web UI

启动本地应用：

```bash
npm run web
```

打开 `http://localhost:3000`。可以用 Web UI 新建查询、查看历史、管理登录态、导出 PDF，以及发送到飞书。

## CLI

单条查询：

```bash
node src/cli.js lookup --name "Jane Doe" --company "Acme" --output all
```

批量查询：

```bash
node src/cli.js batch --input targets.csv --output html --delay 8000
```

登录态命令：

```bash
npm run session:check
node src/cli.js session login linkedin
node src/cli.js session login instagram
node src/cli.js session login x
```

## 验证

在声明仓库或流程可发布前运行：

```bash
node --test tests/*.test.js
git status --short --ignored
git ls-files | rg -n '(^\.env$|^\.env\.(?!example$)|^sessions/|^output/|^node_modules/|^.*social-profiler\.txt$|^\.DS_Store$)'
```

同时运行密钥扫描或有针对性的仓库扫描，检查 API key、私钥、浏览器 token、access token、refresh token 和 authorization header。

期望结果：测试通过；被忽略的本地文件保持未跟踪；密钥扫描没有真实密钥，`.env.example` 中的安全占位符除外。
