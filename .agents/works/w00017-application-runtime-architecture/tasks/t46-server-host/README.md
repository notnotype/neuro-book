---
schema: nbook.task/v2
taskId: t46-server-host
---

# NeuroBook v2 第 3 步（上）：后端宿主、`nbook.http` 与 `nbook.diagnostics`

## 目标与范围

按 [NeuroBook v2：并排重建应用](../../../../../docs/proposals/neuro-book-v2-rebuild.md) 方案第 3、4 节，在新应用 `packages/neuro-book` 上建立后端宿主。第 3 步拆为两个 Task：本 Task 做后端；开发监督进程、Vite 前端与浏览器宿主在下一个 Task。开发者 2026-10-03 决定：主 Agent 编码，omp（默认模型）审查。

行为合同：[`runtime.server-host`](../../../../../docs/specs/runtime/server-host.md)、[`runtime.application`](../../../../../docs/specs/runtime/application.md)、[`runtime.diagnostics`](../../../../../docs/specs/runtime/diagnostics.md)。旧实现（`packages/neuro-book-legacy/server/runtime/`、`server/host/`、`server/features/http/`、`server/features/runtime-diagnostics/`、`server/app-logs/`）只作参照，去掉 Nitro、h3 与 Nuxt 后在新应用重写。

**做什么**

- **进程入口与宿主**（`src/server/`）：读取启动参数，建立唯一的运行实例，汇合停止来源（SIGINT、SIGTERM、标准输入的 `stop` 行、启动失败、未捕获异常），先排空 HTTP 再按依赖逆序关闭，以退出码结束（正常 0；启动失败或停止中有步骤失败、超时为 1）。启动失败先同步写出致命诊断。
- **`nbook.http`**（`src/plugins/http/`）：Bun 监听；就绪前请求等待，启动失败与排空期间返回 503；排空上限 20 秒，事件流在排空开始时关闭且不计入等待。定义贡献点 `http.routes`：插件入口提交一个 fetch 处理器（通常是 Hono 应用），按插件 id 挂到 `/api/<插件 id>/`，入口停止时摘下。宿主自有接口 `GET /api/runtime/health` 在就绪后返回 200。
- **`nbook.diagnostics`**（`src/plugins/diagnostics/`）：用 `nb-runtime` 的诊断存储；后端文件出口在获授日志位置追加逐行 JSONL、轮转、保留，位置冲突时降级；进程级错误（`console.error`、`console.warn`、未处理的 Promise 拒绝、未捕获异常）记入诊断。
- **产品清单**（`src/manifest.ts`）：列出本应用加载的插件；后端按清单装配。
- **生产构建与启动**：`build:server` 用 Bun 打包后端，`start` 运行打包结果。
- **Spec**：`runtime.server-host` 按 v2 改写宿主入口、停止通道与监听部分；开发模式一节随下一个 Task 改写。

**实现决定**（设计稿没有写到的细节）

1. **停止通道**：Manager 与桌面版已删除，`PRODUCT_SHUTDOWN_PATH` 控制请求不再保留；改为可选的标准输入通道（`--stop-stdin`），读到一行 `stop` 即请求停止，Windows 上外部进程也能合作停止，开发监督进程与 smoke 用它。
2. **监听地址**：默认 `127.0.0.1:3000`（`NBOOK_HOST`、`NBOOK_PORT`）。鉴权插件尚未加载，宿主拒绝在非回环地址上监听，启动失败并说明原因。
3. **数据位置**：`NBOOK_STATE_ROOT` 指定状态根，日志写在 `<状态根>/logs/`；生产启动缺少它即启动失败，不猜测默认目录。开发默认目录在下一个 Task 定。
4. **退出码**：本 Task 只产生 0 与 1。75（Session Store 租约失效）与 76（看门狗）保留在 Spec 中，随对应插件实现。
5. **测试**：后端用 `bun test`；宿主的排空、停止与退出码用真实子进程验证，测试插件经清单注入，不在产品代码里加测试分支。

**不在本 Task**：开发监督进程、Vite、浏览器宿主、引导接口、静态资源服务、鉴权、看门狗、`runtime.plugin-channel`。

## 验收

对应 `runtime.server-host` 验收场景，用真实子进程判定：

1. 启动成功：监听后 `GET /api/runtime/health` 返回 200；插件按依赖激活（diagnostics 先于 http）。
2. 启动失败：必需插件激活失败时写出致命诊断并以 1 退出，不存活为只返回 503 的服务。
3. 有序停止：有一个进行中的长请求时发送 SIGTERM，新请求得到 503，长请求完成，插件按依赖逆序关闭，以 0 退出。
4. 标准输入 `stop` 与场景 3 行为相同。
5. 关闭步骤隔离：一个插件关闭时抛错，其余插件仍关闭，以 1 退出。
6. 排空超时：长请求超过 20 秒时继续关闭并以 1 退出（合同测试用可注入时钟）。
7. 诊断：日志写入 `<状态根>/logs/`，第二个进程指向同一位置时降级、不写对方文件；脱敏生效。
8. `typecheck`、`test` 通过；`docs:check`、`governance:check` 失败为 0。

## 当前状态

2026-10-03 完成：主 Agent 编码（`05466b52`），omp 审查后按意见修正。

**实际改动（`packages/neuro-book`）：**

- `src/server/`：`config.ts`（启动参数）、`host.ts`（停止来源汇合：信号、标准输入、未处理异常）、`start.ts`（装配、就绪、退出码；关闭未完成时退出前补写诊断；插件装配失败抛 `ServerAssemblyError`）、`plugins.ts`（按清单装配后端插件）、`main.ts`（进程入口）；`testing/` 下是只供测试的插件与子进程入口。
- `src/plugins/http/`：准入与排空（`admission.ts`，按 Fetch 的响应正文跟踪在途）、分发与 `http.routes` 接收（`dispatch.ts`）、贡献点合同（`contracts.ts`）、插件定义（`plugin.ts`，Bun 监听，关闭空闲超时）。
- `src/plugins/diagnostics/`：JSONL 出口与日志位置授予（`jsonl-exporter.ts`）、写入器（`log-writer.ts`，只保留异步路径，同步写日志的崩溃路径改由宿主同步写标准错误）、插件定义（`plugin.ts`，激活期间桥接 `console.warn`、`console.error`）。
- `src/manifest.ts` 与各插件 `plugin.ts` 描述；`scripts/smoke-server.ts`；`package.json`（依赖 `@notnotype/nb-runtime`、`hono`、`proper-lockfile`）、`tsconfig.json`。
- Spec：`runtime.server-host` 按 v2 改写（停止通道、监听地址、状态根、请求分发、未处理异常、开发监督进程），实现合同与证据改指新应用；`runtime.diagnostics`、`runtime.application` 的后端部分改指新应用；登记表该项改为“开发模式实现迁移中”。
- 登记：包 `AGENTS.md`（目录约定、后端约定、命令）与 README、编码规范路由、模块边界、CI 自治包矩阵加入 `neuro-book`（typecheck、test、smoke:server）。

**与旧实现的差别：** 旧的 `AppFileLogger` 不再保留，诊断存储是唯一的日志入口；旧的启动包装进程与 `PRODUCT_SHUTDOWN_PATH` 随交付链删除；未捕获异常由“只记录”改为“记录后有序停止并以 1 退出”（写入 Spec）。

**验收（主 Agent 自跑）：**

1. `bun run typecheck` 0 错误；`bun run test` 6 个文件 40 个用例通过（[`app-checks.txt`](evidences/app-checks.txt)），连跑 3 次无波动。真实子进程覆盖验收 1–5（启动、诊断先于 http 激活、SIGTERM 与标准输入停止时在途请求完成而新请求 503、启动失败、关闭失败）、未捕获异常、未处理的 Promise 拒绝、标准输入结束、非回环地址；同进程覆盖验收 6（排空超时以 1 退出）、启动失败时等待的请求得到 503、未处理异常汇合为一次停止且监听全部移除、插件装配失败。
2. 验收 7：JSONL 出口测试 8 个用例（读回、位置冲突降级、脱敏、父路径被占据、关闭不复活、授予被接管、轮转与保留、冲突不回收）；`console` 桥接经内核真实激活与关闭验证（照常输出、记入诊断、关闭后恢复）。
3. `bun run smoke:server`：打包产物上 S1–S4 通过（[`smoke-server.txt`](evidences/smoke-server.txt)）。
4. `docs:check`、`governance:check` 失败为 0；根脚本测试 83 个用例通过。

**omp 审查（默认模型，只读）：** 第一次运行到 1 小时上限被截停，核对与实验已做完但没来得及输出报告；用原会话续跑只输出报告（[`omp-review.txt`](evidences/omp-review.txt)）。报告列 2 条阻断、4 条建议、1 条疑问，主 Agent 逐条核实后处理如下：

1. 阻断“客户端取消泄漏在途计数”：部分成立，改为建议。处理器还没返回时客户端断开，票据保留到处理器返回，这是有意的：处理器仍在用插件资源，提前归还会让排空结算、插件在它之下关闭；处理器一直不返回由 20 秒排空上限收口。用真实 Bun 实测，处理器返回时客户端已断开，Bun 会取消响应正文并归还计数，不泄漏；报告里“已取消后不归还”的实验直接调用分发函数、没有经过 Bun。仍补上进入归还逻辑前已取消就立即归还，不依赖服务器随后取消正文，并加回归测试；Spec 与准入注释写明在途的界定。
2. 阻断“启动失败绕过宿主的排空”：Spec 与实现不一致成立，改 Spec 而不改实现。启动失败由内核自行关闭已取得的资源；就绪前的请求都在等待、没有被接纳，排空无事可做；等待的请求在致命诊断写出时（先于内核关闭）得到 503 `startup-failed`，新增同进程测试固定这一点。`start.ts` 里启动失败后多余的 `requestStop` 删除，`runtime.server-host` 的停止来源与关键不变量写明启动失败的路径。
3. `requestStop` 先占位后赋值：采纳。未处理异常改由宿主在 `onFatal` 记录后自己请求停止，装配方只记录并定退出码，占位写法删除。
4. 插件装配失败没有结构化致命诊断：采纳。装配失败时同步写出 `runtime.startup.failed`，抛 `ServerAssemblyError`，进程入口以 1 退出。
5. 测试靠固定睡眠同步：采纳。测试插件的长请求先发出响应头，客户端拿到响应头即确认请求已在途；停止是否生效改为轮询到 503；排空超时测试的计时器改为等它被安排；补断言长请求在排空开始时尚未完成、超时后正文被截断。分发测试里排空前的 5 毫秒等待只用于“尚未结算”的否定断言，慢机器上不会误报，保留。
6. 测试缺口：采纳。补真实子进程的未处理 Promise 拒绝、用 `EventEmitter` 断言停止后进程监听全部移除、诊断插件 `console` 桥接测试。
7. 疑问“诊断 Spec 仍要求 `NEURO_BOOK_LOG_DIR`”：成立。`runtime.diagnostics` 改为新应用的日志位置是 `<状态根>/logs/`，不读旧键、不搬迁旧历史；同时修正一处仍指旧应用路径的段落。

证据见 [evidences/](evidences/)。

## 下一步

本 Task 完成后：开发监督进程、Vite 前端与浏览器宿主（第 3 步下）。
