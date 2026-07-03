# Social Profiler

[English README](README.md)

Social Profiler 是一个 Codex skill，也是一套可本地运行的 Node.js 客户画像工具。它用于销售和 BD 背调场景：从公开网页和社交平台线索中收集证据，合并成客户画像，再通过 LLM 生成报告，并支持导出或发送到飞书。

这个项目默认面向本地使用：API key、浏览器登录态、客户报告和调试截图都只应该留在本机，不应进入公开 GitHub 仓库。

## 它能做什么

- 通过 Google 搜索目标人物和公司。
- 发现可能匹配的 LinkedIn、Instagram、Facebook、X 主页。
- 使用浏览器自动化读取公开资料，以及用户明确授权的浏览器登录态。
- 校验账号匹配度，把低可信账号排除出画像分析。
- 补充公司官网、社交账号、新闻、招聘和公开联系方式线索。
- 生成 JSON、Markdown、HTML 和 PDF 风格报告。
- 支持本地 Web UI、CLI、批量查询和可选飞书发送。

## 全流程

1. 在本机 `.env` 配置 LLM API key 和可选设置。
2. 运行 `npm install` 安装依赖。
3. 可选：连接 Chrome CDP，或保存 LinkedIn、Instagram、X 等平台登录态。
4. 启动 Web UI，或直接使用 CLI。
5. 输入目标姓名、公司名称和可选 LinkedIn URL。
6. Social Profiler 会自动搜索、抓取、校验、合并和分析资料。
7. 查看来源可信度提示和被排除的低可信匹配。
8. 导出 HTML/PDF，查看历史记录，添加标签，或发送到飞书。
9. 保持 `.env`、`sessions/`、`output/`、日志和截图只在本地保存。

## 仓库结构

```text
.
├── SKILL.md                 # Codex skill 执行说明
├── agents/openai.yaml       # skill 展示元数据
├── src/                     # CLI、Web UI、抓取、分析和输出代码
├── tests/                   # Node 测试
├── prompts/analyze.md       # LLM 分析 prompt
├── scripts/                 # 辅助脚本
├── .env.example             # 可公开的示例配置
├── README.md                # 英文说明
└── README.zh-CN.md          # 中文说明
```

这些本地数据不属于公开仓库：

```text
.env
sessions/
output/
*.log
*.txt
调试截图
导出的报告
```

## 作为 Codex Skill 安装

把这个干净仓库发布到 GitHub 后，可以把它安装或克隆到 Codex 的 skills 目录。具体安装方式取决于你的 Codex 环境；关键是安装后的目录里要包含 `SKILL.md`、`agents/openai.yaml` 和项目文件。

手动安装示例：

```bash
mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills"
git clone https://github.com/<owner>/<repo>.git "${CODEX_HOME:-$HOME/.codex}/skills/social-profiler"
```

安装后重启 Codex，让新 skill 被发现。

## 本地安装

安装依赖：

```bash
npm install
```

创建本地配置文件：

```bash
cp .env.example .env
```

配置必要的 LLM 参数：

```env
ANTHROPIC_API_KEY=your_key_here
ANTHROPIC_BASE_URL=https://api.anthropic.com
ANTHROPIC_MODEL=claude-sonnet-4-20250514
```

可选浏览器和飞书设置：

```env
CDP_ENDPOINT=http://localhost:9222
FEISHU_CHAT_ID=oc_xxx
PUBLIC_BASE_URL=http://localhost:3000
```

## 浏览器登录态

没有登录态时，工具也可以读取部分公开页面；但某些平台使用用户授权的浏览器状态会更稳定。

检查登录态：

```bash
npm run session:check
```

保存登录态：

```bash
node src/cli.js session login linkedin
node src/cli.js session login instagram
node src/cli.js session login x
```

登录态文件会保存到 `sessions/`，必须保持私有。

## Web UI

启动本地 Web UI：

```bash
npm run web
```

打开：

```text
http://localhost:3000
```

Web UI 支持：

- 新建查询。
- 查看搜索、抓取、合并、分析、报告生成进度。
- 查看历史报告。
- 管理标签。
- 检查登录状态。
- 导出 HTML/PDF。
- 发送报告到飞书。

不要直接打开 `src/web/public/index.html`。这个页面需要本地服务端 API 才能正常工作。

## CLI 用法

单条查询：

```bash
node src/cli.js lookup --name "Jane Doe" --company "Acme" --output all
```

指定 LinkedIn URL：

```bash
node src/cli.js lookup --name "Jane Doe" --company "Acme" --linkedin "https://linkedin.com/in/..." --output html
```

发送到飞书：

```bash
node src/cli.js lookup --name "Jane Doe" --company "Acme" --feishu --output all
```

批量查询：

```bash
node src/cli.js batch --input targets.csv --output html --delay 8000
```

CSV 格式：

```csv
name,company
Jane Doe,Acme
John Smith,Example Inc
```

## 飞书发送

飞书发送依赖本机 `lark-cli`。

如果设置了 `FEISHU_CHAT_ID`，报告会发送到指定群。如果没有设置，工具会根据本机飞书应用权限创建或复用默认私有群 `客户画像`。

如果没有设置 `PUBLIC_BASE_URL`，飞书消息里的报告链接默认指向 `http://localhost:3000`，通常只有本机能打开。

## 隐私和安全

发布或推送前先检查：

```bash
git status --short --ignored
git ls-files | rg -n '(^\.env$|^\.env\.(?!example$)|^sessions/|^output/|^node_modules/|^.*social-profiler\.txt$|^\.DS_Store$)'
```

然后使用你偏好的 secret scanner 扫描当前文件和 Git 历史。重点检查 API key、private key、浏览器 token、access token、refresh token、authorization header、cookie 和已保存浏览器状态。

不要发布：

- `.env` 或任何本地环境配置。
- `sessions/` 浏览器登录态文件。
- `output/` 下的报告、截图、调试图片、PDF、Markdown 或 JSON 结果。
- 终端记录、旧对话日志或开发日志。
- 真实客户、潜客、联系人、cookie、token 或 API key 数据。

如果真实 key 曾经被提交过，公开前先轮换或废弃。

## 验证

运行测试：

```bash
node --test tests/*.test.js
```

期望结果：

```text
60 pass
0 fail
```

## 公开发布 Checklist

1. 使用干净仓库，不带旧的私有 Git 历史。
2. 确认只跟踪源码、测试、prompts、scripts、README、`SKILL.md`、`agents/openai.yaml`、`.gitignore` 和 `.env.example`。
3. 运行测试。
4. 运行隐私和密钥扫描。
5. 把这个干净仓库推送到 GitHub。
6. 将 GitHub 仓库安装或克隆到 Codex skills 目录。
