# PLAN-G：后台任务 Jobs SSE 迁移

状态：已实施（2026-07-27）；真实浏览器验收待用户。稳定合同见 [Agent Jobs](../../../reference/agent/jobs.md)。

## 目标与边界

将 Header 徽标、任务中心和所有 `useAgentJob()` 观察器统一到每个页面一条 Jobs SSE 连接，删除前端对 `/api/agent/jobs` 与 `/api/agent/jobs/:id` 的周期轮询。

保留的 HTTP 面：

- `GET /api/agent/jobs`：首次加载、断线后的快照恢复、手动刷新；
- `GET /api/agent/jobs/:id`：任务中心展开 completed Job 时按需读取完整 `result`；
- cancel 与 clear-finished 动作端点。

不在本轮迁移：`/api/agent/workflow/runs/:runId`。Workflow RunView 的状态图、日志、参与者和待应答信息继续独立轮询；写作 smoke 的有界单 Job 轮询也保留。

## 已实施设计

### 共享 DTO 与 HTTP

- `shared/dto/agent-job.dto.ts` 成为 Job kind/status/snapshot/detail、列表恢复响应、事件游标与 envelope 的公开类型真相源；前端不再从服务端 Manager 导入类型。
- `GET /api/agent/jobs` 返回 `{jobs, eventCursor}`。Manager 的 `recovery()` 在同一同步方法内读取列表和事件游标，覆盖“快照返回后、SSE 建连前”的竞态。
- `GET /api/agent/jobs/events` 要求同时提供 `eventEpoch` 与 `after`，并通过通用 Node SSE writer 写出无过滤全局事件流。

### Job 事件中心

- 进程级随机 `eventEpoch`，全局递增 `seq`；最近 500 帧、4 MiB replay，即使无订阅者也保留。
- 每订阅者 live queue 最多 128 帧或 1 MiB；单公开帧最多 128 KiB。超限 Job 帧降级为同 seq 的 `snapshot_required`，不制造缺口。
- 缺 epoch、跨 epoch、游标超前或 replay 过期只向对应订阅者返回 `snapshot_required`。
- Manager 在 spawn 入表后、执行器开始前发布 running；waiting/running/terminal 立即发布完整快照；`clearFinished()` 发布删除 ID。
- `setPreview()` 每 Job 250ms 尾沿合并；离散状态变化取消待发 timer 并发布最新 preview。
- shutdown 先关闭订阅和 replay、清理 preview timer，再取消任务与完成既有持久化收口；关闭后的状态变化不再发布。

### 前端状态机

- `createAgentJobsFeed(transport)` 提供可测试的深模块；页面使用模块级单例。首个消费者启动，最后一个消费者销毁时 abort SSE 与重连。
- Header 是工作面内徽标 feed 的 owner；只随 Project/User Assets 数据面挂载。任务中心只在打开时增加 consumer，Project 选择页没有 Jobs consumer。离开工作面不取消服务端 Job，重新进入时以一次原子快照恢复。
- 初始快照只请求一次；事件按 `jobId` upsert/remove，整体替换 `shallowRef` 并按 `createdAt` 倒序。
- 重复 seq 丢弃；gap、epoch 变化或 `snapshot_required` 触发单飞快照恢复。旧代次 HTTP/SSE 响应不可覆盖新状态。
- SSE 断线按 `300/800/1500/3000/5000ms` 退避，随后保持 5 秒；保留最后可信列表，恢复后清错。
- `refresh()` 和 `clearFinished()` 各触发一次快照恢复，不产生周期 GET。
- `useAgentJob()` 只选择共享列表中的 Job；取消仍走 POST 并保留 revision guard，不再发单 Job状态 GET或取消后强刷。
- 任务中心用一个本地秒表刷新运行时长，只在面板打开且存在活跃 Job 时运行。

初始快照失败时尚无可用 SSE 游标，按 `300/800/1500/3000/5000ms` 退避重试快照；成功后只维持 SSE，不再周期 GET。Source dev 固定使用 `nuxt dev --no-fork`，避免 Nuxt fork worker 在同一 State Root 上竞争唯一 `runtime.lease`；锁合同本身保持 fail closed。

## 2026-07-27 审查加固：因果观察与重连治理

原实现的 45 项验证没有覆盖 Session 工具结果与 Jobs SSE 跨连接乱序、SSE 200 后立即 EOF、Job 清除早于 Run 终态等竞态。审查确认并修复：

- `AgentJobManager.spawn()` 返回 `{job, jobEventCursor}`，游标取自首次 running 的实际发布帧；执行器同步发布 waiting/running 不会污染创建点，shutdown 后拒绝 spawn。
- `run_workflow`、后台 `invoke_agent`、后台 `bash` 和正式 Workflow HTTP 启动响应都携带 `jobEventCursor`。
- feed 保留响应式最后已应用游标，并通过 `observe(jobId, cursor)` 统一归约 pending/available/unavailable。跨 epoch 先恢复新快照；旧工具结果无游标时不猜测 unavailable。
- Workflow Run 成为 Workflow 终态唯一真相源。Job 清除、cancelled 或 interrupted 不停止 Run 轮询；Run 404 才归约 interrupted。
- 新增 `SseReconnectBackoff`，Jobs、Agent Session、Project Presence 共用 5 秒稳定窗口与真实失败序列；短暂 open 不再把退避永久重置到 300ms。
- Project Presence 的 timer 重连改为固定 `open -> subscribe`，不再绕过幂等 reopen；连续抖动只提示一次。
- Jobs 列表 query 使用严格 DTO，拒绝非法 status、非正整数/数组 ownerSessionId 和未知字段。
- 稳定决策见 [ADR 0003](../../adr/0003-agent-job-observation-causality.md)。

## 2026-07-27 审查补漏与合同收口

后续链路审查发现原加固仍有四处实现偏差，均属于 ADR 0003 与既有 SSE 合同的落地缺口，不新增架构决策：

- Workflow Run 已创建而 `jobs.spawn()` 因 Manager shutdown 拒绝时，编排层立即 `cancelRun(runId)` 并原样抛出登记错误，避免留下没有 Job 观察入口的孤儿 Run；正常创建与取消链不变。
- `observe()` 的 epoch 恢复证据改为绑定完整 `{jobId, eventEpoch, after}` 与恢复开始时的快照 revision。切换到复用同一旧游标的另一个 Job 时会重新恢复，只有目标匹配且 revision 前进后才归约 unavailable。
- Jobs list/events 路由在 H3 边界使用 `safeParse + createError(400)`；list 与 events 分别返回稳定错误码 `INVALID_AGENT_JOB_LIST_QUERY`、`INVALID_AGENT_JOB_EVENTS_QUERY`。SSE `after` 不再通过 coercion 接受空串或数组。
- Workflow error 由独立 resolver 归约：Run 一旦可见，状态、结果与错误只取 Run；Job error 只在“后台任务”区域展示。历史变量 `jobPollError` 同步更名为 `jobFeedError`。
- Project Presence 增加 fake-timer 集成测试，覆盖连续短连接只通知一次、稳定五秒后开启新通知周期、新目标和 dispose 不触发旧代次 reopen。

没有引入两阶段 Job 注册、通用事务框架、额外状态机或持久状态。Workflow Run SSE 仍不在本轮范围。

## 验证

- EventHub：顺序、immutable 投影、replay、缺/跨 epoch、游标超前/过期、单帧超限、慢消费者 overflow、close。
- Manager：spawn/replay 原子竞态、250ms preview 合并、离散状态即时事件、terminal 清 timer、clear removal、shutdown。
- 前端：共享初始快照与连接、长时间无周期 GET、upsert/remove/排序、重复/gap、single-flight recovery、epoch、显式恢复、旧响应隔离、退避、refresh/clear、Job 切换取消竞态、多观察器删除。
- 初次迁移聚焦命令：`bun run test -- server/api/agent/jobs server/agent/jobs app/composables/useAgentJobsFeed.test.ts app/components/novel-ide/agent/useAgentJob.test.ts server/agent/events/agent-sse-writer.test.ts app/utils/http/read-sse.test.ts`，8 个文件、45 项通过；该结果不包含上节竞态。
- 第一次加固当时记录为 16 个文件、113 项通过，但没有覆盖孤儿 Run、同游标 Job 目标切换、真实 H3 400 响应和完整 Project 通知周期，不能作为本轮缺陷的验证证据。
- 审查补漏后复跑 Jobs/Workflow/三路 SSE 聚焦组合：17 个文件、129 项通过；另外先单跑 Project 短连接用例 1 项通过、6 文件补漏组合 48 项通过。
- 生命周期补漏复跑 feed、页面/dev 接线、`useAgentJob`、Workflow 气泡与 Header 账户接线：5 个文件、32 项通过；初始快照三次失败后按退避恢复，成功后推进五分钟无额外 GET。
- 最终所有权收口复跑 feed controller、迁移后的 composable-local observer、页面/dev/Workflow 接线、Workflow 状态 resolver 与服务端 waiting resume 发布链：6 个文件、49 项通过。覆盖 disabled 零请求、动态 enable/disable、多 consumer、最后释放、重新启用、迟到响应、`null -> A -> B -> null`、A → B 不重连、无目标隐藏 feed error、observer 无 `refresh`、Workflow 无 Jobs 强刷，以及 demo 零新增 Jobs 请求。
- `bun run typecheck` 已运行，但当前工作区正在并行迁移 Project/Session 身份合同，旧 `workspaceKey/workspaceRootRef/projectPath` 调用点与测试夹具产生大量无关错误，并仍包含 llmlint config 类型漂移；因此全仓 typecheck 不能作为本轮 clean pass，本轮未扩展修复这些并行改动。
  - 2026-07-28 最终收口复跑时，身份迁移错误已经消失；当前只剩既有 `server/agent/skills/llmlint.test.ts` 26 项（25 项缺 `ignoreTerms`、1 项 `module` 不可赋给 `builtin`），本轮文件零错误。

## 2026-07-28 最终收口：观察所有权与 Workflow 去强刷

- feed Interface 拆为只读 `AgentJobsFeedView` 与任务中心使用的完整 `AgentJobsFeed`；controller 不再公开 `retain()/release()`，统一由 `consume(enabled)` 在 Vue effect scope 内管理 lease。
- `useAgentJob()` 使用 nullable 目标驱动 consumer；无目标零网络所有权且不显示历史 feed error，A → B 不重建连接，回到 null 才释放自身 consumer。observer 只接收 View，类型上不存在 `refresh()`。
- Workflow 气泡与 preview RunPanel 删除应答、重放、Run 切换时的 Jobs 全量强刷；`shouldPollWorkflowRun()` 的 Interface 也删除 Job 状态输入。服务端既有 `onRunning -> ctx.setRunning()` 继续负责 resume 后的 Job running 事件。
- `/workflow.preview` 保留正式列表首次显式 Jobs GET；demo RunPanel 没有 Job 目标，操作不取得 Jobs consumer。
- 实施时补到一个竞态：观察器与首个 consumer 同时创建时，初始快照请求已经在途。修正为目标登记后完成的初始快照可推进 snapshot revision 并成为跨 epoch 恢复证据，避免无信息增益的第二次 GET；切换目标仍需新 revision 证据。

## 与计划的出入

- 公开 SSE query 比草案更严格：`eventEpoch` 与 `after` 均为必填。无快照游标的连接没有可靠增量基线，不提供隐式“从当前开始”模式。
- 为保证状态机可确定性测试，实际增加了 transport 注入工厂；页面单例行为不变。
- 未新增 heartbeat，沿用连接关闭与客户端退避重连。
- Workflow 创建补偿留在唯一需要先创建外部 Run 的编排层，没有把 `AgentJobManager` 扩展为 reserve/commit 两阶段接口。
- 聚焦组合首次运行暴露后台 bash 输出清理测试仍使用已退役的 ToolExecutionContext 字段；只更新该 fixture 到 `workspaceRoot/currentProject` 后，17 文件组合通过，生产 bash 行为未改。
- 最终收口计划原本只描述“跨 epoch 恢复继续沿用既有逻辑”；实际测试发现首个 consumer 与观察器同步建立的 single-flight 竞态，因此在同一 per-observer revision 模型内补了“初始快照可作为恢复证据”，没有新增 Map、timer、额外快照或公开协议。

## 待完成

- 用户浏览器验收：裸 `/` 无 Jobs GET/SSE；进入 Project 后一次快照与一条 pending Jobs SSE；返回选择页后连接中止且不再 GET；启动、等待、完成、取消、清除和完整重启 dev server 均正确更新。
- Workflow Run SSE、run-as-session 持久化与真实 Workflow/模型验收继续单独设计。
