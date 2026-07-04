# Social Profiler

[English README](README.md)

Social Profiler 是一套可本地运行的客户画像工具。它用于销售和 BD 背调场景：从公开网页和社交平台线索中收集证据，合并成客户画像，再通过 LLM 生成报告，并支持导出或发送到飞书。

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
├── SKILL.md                 # skill 执行说明（英文入口）
├── SKILL.zh-CN.md           # skill 执行说明（中文参考）
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

## 作为 Skill 安装

把这个干净仓库发布到 GitHub 后，可以把它安装或克隆到你的 skills 目录。具体路径取决于你的运行环境；关键是安装后的目录里要包含 `SKILL.md`、`agents/openai.yaml` 和项目文件。中文说明可参考 `SKILL.zh-CN.md`。

手动安装示例：

```bash
git clone https://github.com/<owner>/<repo>.git <your-skills-dir>/social-profiler
```

安装后重启你的应用，让新 skill 被发现。

## 本地安装

安装依赖：

```bash
npm install
```

创建本地配置文件：

```bash
cp .env.example .env
```

填写你自己的 LLM 服务参数：

```env
ANTHROPIC_API_KEY=your_llm_api_key
ANTHROPIC_BASE_URL=https://your-llm-endpoint.example.com
ANTHROPIC_MODEL=your_model_name
```

可选浏览器和飞书设置：

```env
CHROME_PATH=
CDP_ENDPOINT=http://localhost:9222
FEISHU_CHAT_ID=oc_xxx
PUBLIC_BASE_URL=http://localhost:3000
```

Windows 如果点击 Web UI 里的 Chrome 连接失败，可把 `CHROME_PATH` 设置为本机 Chrome 路径，例如 `C:\Program Files\Google\Chrome\Application\chrome.exe`。

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

临时启动本地 Web UI：

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

`.env`、`sessions/`、`output/`、调试截图、运行日志和导出的报告都可能包含 API key、登录态、联系人或客户画像数据，默认不要提交到 Git。`.gitignore` 已经覆盖这些路径；如果真实 key 曾经被提交过，公开前先轮换或废弃。

Social Profiler 可能会处理个人信息。请只处理公开信息，或你明确授权访问的浏览器登录态；不要绕过访问权限、抓取非公开内容，或采集与业务目的无关的信息。公开可见的信息也不代表可以不受限制地收集、保存或传播。

请避免采集或推断敏感个人信息，例如健康、宗教、政治倾向、未成年人信息、身份证件、财务账号等。不要将本工具用于骚扰、歧视、监控，或招聘、信贷、保险、住房等会对个人产生重大影响的自动化决策。

不同地区、平台和使用场景的隐私要求可能不同；商业化、跨境或大规模使用前，请先评估适用法律、平台条款和告知/同意义务。

AI 生成的报告和分析内容仅供参考。对外使用或分享前，请人工核验来源可信度、联系方式、账号匹配关系和推断结论，并尊重对方提出的删除、更正或停止使用请求。

## 验证

运行测试：

```bash
node --test tests/*.test.js
```

期望结果：

```text
79 pass
0 fail
```
