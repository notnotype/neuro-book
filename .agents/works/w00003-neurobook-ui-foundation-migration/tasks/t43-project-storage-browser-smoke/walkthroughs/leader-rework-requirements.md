# t43 返工要求（第二稿）

2026-09-16 Leader 依据 [首稿复核](leader-first-review.md) 与 [交接裁定](leader-handoff-status.md) 固定返工范围。
作者首稿已有可运行骨架，本轮把它补到"合格证据"标准；不得缩减场景、不得用 includes 断言或 newContext 冒充 profile 隔离。
全部改动仍限于本 Task 范围：`packages/neuro-book/scripts/smoke/storage-project-adapter.ts`（可拆分同目录小 helper）、
`packages/neuro-book/package.json` 的 smoke 登记、本 Task 文档。不触碰 `app/**` 产品代码、两个用户 dirty descriptors、grid/Splitter、Spec 与 Work。

## R1 全阶段失败清理

- 从**第一个**资源开始纳入清理：隔离根建目录、`process.env` 注入、Project manifest 写入、`openProject`、`setStorageHostContextForTest`、esbuild bundle、HTTP `listen`、浏览器启动。
  现稿的 `try` 从 `startHost` 之后才开始，之前的任何失败都会漏清理。
- 释放顺序固定：页面 → 浏览器上下文/profile → 浏览器 → HTTP listener → Project session 关闭 → Storage host dispose。浏览器必须先退出，避免关 host 后页面还在请求。
- 单项清理失败不得跳过其余项（`Promise.allSettled` 或等价），清理失败必须作为独立结果上报并使退出码非零。
- run 函数自身完成全部释放，不把释放责任留给 CLI 的 `rm`。

## R2 根内独立 profile 与 cache

- 必须使用 `chromium.launchPersistentContext(<root>/profiles/<name>, …)`（或等价能证明真实 profile 的方案），让 Chromium profile 与 cache 实际位于本次 `input.root` 内。
- `browser.newContext()` 只证明存储上下文隔离，不能作为 profile 隔离证据；报告里两者分别表述，不得写"profile 已隔离"却只做了 newContext。
- 两个 profile 目录（主客户端与独立客户端）都在清理范围内；报告给出绝对路径。
- 保留 `--host-resolver-rules` 与 `--no-proxy-server` 行为。

## R3 隔离维度分别取证

- 新增同客户端跨 Project 场景：同一 profile/上下文内，A 与 B 使用相同 owner/key，A 保存后 B 读 `missing`，B 保存后再回读 A 仍是自己的值。
- 保留独立 profile（不同客户端）的 local 隔离场景，与 R3 第一条分别成立。
- 释放第二个标签后，第一标签必须完成一次真实 `save` + `read` 往返（不只是"没有轮询请求"），证明访问生命周期互相独立。

## R4 shared Project 定义与场景

- 新增一个 `project/shared` 定义（与 local 定义不同 key，或显式 shared owner），用两个客户端验证：一个客户端写入后另一个客户端读到该 shared 值；同一 owner 的 local 记录仍按客户端隔离。
- 只证明同 data、同主体、跨客户端的 shared 语义，不宣称跨 data 在线同步。

## R5 精确磁盘断言

- 删除 `includes("700")`。定位记录文件后解析 JSON，核对封装版本/`schemaVersion`/最终值字段（例如 `value.width === 700`）；字段名必须从生产读写实现（`server/storage` 的记录编解码）核对后在报告中写明。
- 记录路径必须由生产地址入口推导（例如 `storage-address` 的路径函数），不手写猜测目录；A/B 两条记录分别断言且互不污染。
- 如需断言 user 身份域位置（`WorkspaceRoot/.nbook/storage`），使用生产身份入口推导；不得从 Project storage 读取 `identity.json`，不得猜 subject 或 clientId 字面量。

## R6 PageApi 生命周期

- `open` 再次调用前先释放旧 handle 与旧 session，或显式检测并报告覆盖；不得静默泄漏。
- `release` 必须同时关闭订阅、handle 与 session（`closeStorageContext` 或等价生产入口），且被断言验证（例如释放后重新 open 得到新上下文，或宿主/apiCalls 不再增长）。
- `open`/`read`/`subscribe` 抛错后不得留下半初始化状态。

## R7 CLI 清理与根归属

- 删除前校验：解析后的绝对路径必须位于 test-support scratch 根之下，且等于本次选项推导的路径；不匹配则拒绝删除并报告。
- 绝不触碰任何已有临时根，尤其此前审批拒绝的 `storage-browser-MxfyHy`；不做宽泛递归删除，不写仓库 `.tmp`。
- `rm` 失败不得掩盖正文结果：捕获并作为独立字段/发现输出，退出码非零。
- 打印实际隔离根、HTTP 端口、浏览器与 profile 关闭结果。

## R8 可读性

- 展开现稿压成一行的 `call`、`observe`、`parseOptions`、CLI 块与 `ENTRY`；`ENTRY` 保持字符串（esbuild 打包的浏览器入口）但按逻辑分段、抽命名 helper，风格向 `storage-value-adapter.ts` 对齐。
- 不引入新框架或额外抽象层。

## R9 验证与报告

- 真实运行：cwd 为 worktree 内 `packages/neuro-book` 绝对路径，`--browser-executable "C:/Program Files/Google/Chrome/Application/chrome.exe"`；记录退出码与最终 JSON，只有 findings 为空才可写 passed。
- scripts 类型检查用 `bunx tsc --noEmit --pretty false -p scripts/tsconfig.json`；唯一允许的既有错误是 `scripts/deploy/product-agent-state-root-smoke.ts:318`，本文件必须零错误。
- 证据写入 `walkthroughs/rework-evidence.md`（命令、cwd、退出码、场景清单、隔离根/端口/关闭结果、未运行项），并更新 Task README 状态行。
- 不提交、不 push、不联网、不访问/占用 3001、不动真实用户数据、不修改两个用户 dirty descriptors。

## 完成判据

R1–R9 全部落地并有可复现命令与真实输出；报告中"已证明/未证明"与场景一一对应，不出现高于实际覆盖的结论。
