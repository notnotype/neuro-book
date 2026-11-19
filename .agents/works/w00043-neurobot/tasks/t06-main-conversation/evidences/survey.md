# t06 开工调研（2026-11-19，master 91101e6d3 前后）

三位 Claude Haiku 子代理只读盘点，主 Agent 读了 `kernel/run/interaction.ts` 核对。行号是当时的，只作定位。

## 内核里等用户的事项（nb-harness `src/kernel/`）

- 事件：`interactionRequested{id, callId, kind: "approval" | "question", request, async, within?}`、`interactionResolved{id, decision, by, code?, data?, note?}`（`api/events.ts:222-223`）。`InteractionDecision` 是 `allow | allow-session | deny | answer | interrupted | aborted | unavailable`（`api/events.ts:55`），用户的 `resolve` 只能给前四个。
- 种类：审批（`run/tools.ts:402-421`，钩子判 `ask` 时）、同步提问与异步提问（`ctx.ask`，`run/tools.ts:197-215`；异步写下就交回 `unavailable{async}`、不进 `waiting`）。模式切换请求在内核里不是单独的种类，是宿主的提问（`kit/sessions/table.ts` 的 `userOnly`）。嵌套调用的事项带 `within`。
- 待处理按路径归约（`state/kernel-state.ts:50-60、110-112`）；同步事项的等待登记在 `Interactions` 里（`run/interaction.ts`），状态 `waiting{pending}` 由它报出（`run/control.ts:58-63`）。
- 结算路径：
  - `resolve` 在受理批里认领等待者再写 `interactionResolved`（`run/interaction.ts:102-185`）；
  - 中止时 `request` 里的 `onAbort` 同步摘掉等待者、单独写一批 `aborted`（进程收尾时写 `interrupted`）；
  - 重开会话时恢复批结算为 `interrupted`（`run/recover.ts:70-91`）。
  - 认领与摘除都是同步的，所以同一事项只会有一条结算；中止之后到的 `resolve` 得 `already-answered{kernel, aborted}`（码写死在 `interaction.ts` 里）。
- 运行在等事项时 `send`、`enqueue` 照常进缓冲区（`takesInput` 为真），插话要等这批调用都结算、循环走到边界才被取走（`run/loop.ts:73-78`）。
- 内核里没有“到点结算”的先例：等事项只靠 `resolve` 或中止信号结束。可用的是注入的 `Clock{now, wait}`。
- `CoreSettings` 是 `{model, effort, approvalMode, readOnly}`（`api/model.ts:145-150`），`changeSettings` 改；内核建会话时不抄父会话的设置（子会话的设置由 `nbook.agent` 在建时写，`agent/subagents.md` 输出 3）。
- `ToolSessionContext` 是 `{sessionId, profile, project?, background?}`，由 `session/session.ts:123` 从会话头与当前装配拼出。

## 会话头与会话服务

- 会话头 `SessionHeader`（`api/events.ts:290-307`）有 `caller`、`background`，没有 `owner`。建会话的选项 `CreateSessionOptions`（`api/host.ts:531-542`）经 `kit/sessions/table.ts:120` 传到 `session/session.ts:476`。索引条目照抄 `project`、`background`、`caller`、`origin`（`log/index-file.ts:8-27`）。fork 复制 `project`、`origin`、`caller`、`questions`、`result`，不复制 `background`（`session/session.ts:579-600`）。
- `agentKey` 门面（`neuro-book/src/plugins/agent/backend/agent.ts:478-503`）：`restamp` 只管身份，`create` 只拦会话身份的 `caller`，别的选项原样透传；`list` 缺省 `{archived: false, background: false}`。没有 `hold`。
- 句柄表的引用：`Entry.refs` 计数，`subscribeOpened` 交回 `release()`，`view()` 不持引用；没有引用、没有运行、30 秒没有调用才关（`IDLE_CLOSE_MS`）。
- `rewind`、`switchBranch`、`archive` 在 NeuroBook 一侧没有按会话拦截的关卡；远程经 `backend/remote.ts` 的 `commandMethods` 走 `service.session(id, {kind: "user"})`。`owned-session` 在仓库里没搜到。
- 会话关系表（`backend/subagents/relations.ts`）只按 `caller.kind === "session"` 与 `origin` 登记父子，有 `rootOf`、`descendantsOf`。
- 服务端没有“打开会话”的指令；打开发生在任何调用的 `#acquire` 或帧订阅（`subscribeOpened`）里。打开失败的码：`session-busy`、`session-not-found`、`log-broken`、`log-corrupt`、`needs-migration`、`storage-failed`、`open-failed`（`kit/sessions/table.ts:309-310`）、`unavailable`（表在停止）。Profile 解析不到或依赖缺失时以只读打开（`session/session.ts:106-113、541-558`）。

## 插件平台

- 内置插件全部算启动必需（`neuro-book/src/server/start.ts:242-243` 放进 `requiredPlugins`），激活会挡住启动；平台没有给插件的“全部就绪”回调。
- 插件不能在自己的激活里建会话：`nbook.agent` 打开会话前 `beforeOpen` 等扩展提供方的激活（`agent/backend/agent.ts:267-286`），等自己就成环（`agent/contributions.md` 输出 3）。`void` 一个在激活交回之后才跑的异步任务不会等自己。
- 停止：`addStopStage` 的阶段先跑，再按依赖关闭，消费方先于提供方（`nb-runtime/src/lifecycle/close-plan.ts`）；`nbook.agent` 停止时先关门、再关全部会话（`agent.ts:442-456`）。
- 贡献点的做法：`agent/shared/points.ts:141-147`、`stickers.packs`（`stickers/shared/contracts.ts`）；插件包目录只对已安装的第三方插件给出（`plugin-platform/backend/packages.ts:36-50`），内置素材用 `packageRootOf` 找（`stickers/backend/builtin-root.ts`）。
- 新内置插件要改的封闭名单：`src/manifest.ts`、`src/server/plugins.ts`、`src/web/plugins.ts`、`plugins/plugins/shared/builtin-names.ts` 与两份目录、`builtin-names.test.ts` 的旧表；有命令时才改 `COMMAND_DOMAINS`。`nbook.stickers` 不在显示名表里，这是 `builtin-names.test.ts` 在 master 上失败的原因（t14 的 `test:affected` 里见过）。
- 应用级数据：`stateRootKey`（`shared/host.ts:23`）；插件存储 `storageKey` 与 `defineRecord`（例 `projects/backend/shelf.ts:121`）。远程合同例：`stickersCatalogContract`。
- 资源方案只有内置插件能登记（`files/backend/registry.ts:20、51`），`authorize(caller, mount, operation, path)` 在 `files/shared/schemes.ts:81`。
