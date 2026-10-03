# Task 72 - Error Report Logs

## 背景

用户需要一个日志文件功能，便于普通用户在报告错误时提供可诊断材料。当前服务端错误主要进入控制台，Windows portable 用户如果关闭启动窗口或不熟悉控制台，很难稳定提供错误上下文。

## 目标

- 后端写入持久化日志文件，Windows portable 落到 `data/logs/`。
- 提供后端下载接口：`GET /api/app/logs/download`。
- 提供状态接口：`GET /api/app/logs/status`。
- 默认记录诊断详细摘要：请求路径、状态、耗时、服务端异常、未处理异常、Agent session/profile/model/invocation/phase 摘要。
- 不记录小说正文、prompt、模型响应正文、工具输出正文、请求 body、Cookie、Authorization、API key、password、token、secret。

## 实现记录

- 新增 `server/app-logs/logger.ts`：
  - `NEURO_BOOK_LOG_DIR` 优先；production fallback 到 `logs/`；开发 fallback 到 `workspace/.nbook/logs/`。
  - `server-current.jsonl` 写入 JSONL。
  - 单文件超过 10MB 自动轮转，保留最近 8 个 server 日志文件。
  - 对常见敏感字段做 redaction，并截断超长字符串。
- 新增 `server/app-logs/archive.ts`：
  - 日志包只包含 `logs/*` 和 `manifest.json`。
  - 不读取 config、数据库或 workspace 内容。
  - **隐私红线（Task 95 登记）**：`workspace/<slug>/.nbook/history.sqlite`（文件历史库）含项目文件全文快照，严禁纳入日志包或任何可分享诊断导出。
- 新增运行时接入：
  - Nitro plugin 桥接 `consola`、`console.warn/error`、`unhandledRejection`、`uncaughtException`。
  - 请求 middleware 记录 method/path/query 摘要/status/duration。
  - 原 `error-logger` 改为写同一套结构化日志。
  - Agent harness 在 session 创建、invoke start/finish/error、sidecar error、summarizer schedule error 写摘要日志。
- Windows portable：
  - Launcher 创建 `data/logs`。
  - 新生成的 `data/.env` 写入 `NEURO_BOOK_LOG_DIR=../data/logs`。
  - Server stdout/stderr 同步 tee 到 `launcher-YYYY-MM-DD.log`。
  - Launcher 日志单文件超过 10MB 后轮转，保留最近 8 个 launcher 日志文件。
  - Launcher 日志写入失败只报告到 stderr，不打断产品启动。

## 验证

- `bun vitest run server/app-logs server/api/app/logs`
  - 4 个测试文件、10 个用例通过。
  - 覆盖 redaction、JSONL 写入、同步 fatal 写入、轮转保留、状态统计、日志包内容和 API header。
- 静态确认：
  - Windows launcher 创建 `DATA_LOG_DIR`。
  - `productEnv()` 注入 `NEURO_BOOK_LOG_DIR`。
  - `renderEnv()` 新写入 `NEURO_BOOK_LOG_DIR=../data/logs`。
  - Agent harness 已包含 `agent.session.create`、`agent.invoke.start/finish/error/queued`、`agent.sidecar.error`、`agent.summarizer.schedule.error`。
- `bun run typecheck`
  - 通过。
- 审查修复：
  - `uncaughtException` 改为 `uncaughtExceptionMonitor`，避免吞掉致命异常。
  - `unhandledRejection` 记录后重新抛出，保留 fatal 语义。
  - 新增 `fatalSync()`，在进程崩溃路径同步写入 fatal 日志。
  - server 与 launcher 日志补字符串级敏感信息脱敏。
  - 请求日志 query 改为只记录参数名、值数量和敏感标记，不记录 query value。
  - request error hook 改为只记录 pathname，并清理当前请求 query 带入的错误 message / stack。
  - launcher 在 server `exit/error` 路径等待日志流关闭，减少崩溃尾部日志丢失。
  - launcher 日志流增加常驻 error listener，并补 10MB/8 文件轮转。
  - launcher 单条日志写入失败改为只报告 stderr，不阻止产品启动。
  - launcher stdout/stderr tee 初始化失败时回退 no-op sink，不阻止 server 启动。
  - launcher 启动阶段创建 `data/logs` 改为 best-effort，失败不阻止产品启动。
  - launcher stdout/stderr tee 改为按完整行缓冲后脱敏，避免敏感片段跨 chunk 泄露。

## 后续

- 第一版暂不做前端入口。后续如果普通用户仍找不到日志，可以在设置弹窗加“诊断/支持”页，提供下载日志包、复制日志路径和清理日志。
