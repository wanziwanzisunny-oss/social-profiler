# Social Profiler

社交媒体客户画像工具，支持从 Web UI 发起查询、查看历史报告、管理登录状态，并导出 HTML/PDF 报告。

## 本地预览

启动 Web UI：

```bash
npm run web
```

打开浏览器访问：

```text
http://localhost:3000
```

不要直接打开 `src/web/public/index.html`。`file://` 方式只能看到静态页面，无法正常调用查询、历史记录、登录状态和报告接口。

## 常用入口

- 新建查询：填写姓名、公司和可选 LinkedIn URL 后开始查询。
- 历史记录：查看已生成的 JSON/Markdown/HTML 报告。
- 登录状态：检查 Chrome 连接和 LinkedIn、Instagram、Facebook、X 的登录态。
- 发送到飞书：新建查询时勾选「发送到飞书」，或在报告页点击「发送到飞书」补发。

## 飞书发送

发送到飞书依赖本机 `lark-cli`。如果 `.env` 中配置了 `FEISHU_CHAT_ID`，报告会继续发送到该群；如果没有配置，首次发送时会自动创建飞书群 `客户画像`，并把后续报告默认发送到这个群。自动建群时会把当前飞书应用 owner 加入群，避免创建只有机器人可见的群；owner open_id 仅用于建群请求，不写入项目设置。

可选配置：

```env
FEISHU_CHAT_ID=oc_xxx
PUBLIC_BASE_URL=https://your-accessible-host.example.com
```

如果不设置 `PUBLIC_BASE_URL`，飞书消息里的 HTML 报告链接会默认指向 `http://localhost:3000`，通常只有本机能打开。

## 输出文件

报告和调试产物默认写入 `output/`。报告文件、截图、调试图片和临时测试脚本默认不纳入 Git。

如需保留某个输出作为文档或测试 fixture，请先移出 `output/`，再按用途单独命名和提交。

## 发布安全说明

公开仓库只应提交源码、测试、README 和 `.env.example`。本地 `.env`、`sessions/`、`output/`、调试截图、运行日志和导出的报告都可能包含 API key、登录 cookie、联系人或客户画像数据，默认不应进入 Git。

## 预览异常排查

如果刷新后看不到最新 UI：

1. 确认地址是 `http://localhost:3000`。
2. 停止旧服务后重新运行 `npm run web`。
3. 浏览器强制刷新页面。
