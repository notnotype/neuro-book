# t16 计划：内核四个窄窗口缺陷（草稿 2）

## Context

t06 设计与实现审查查出的四个内核原有缺陷，所有会话都受影响，t06 只把它们写成了 Spec 的已知限制（[t06 设计审查处理](../t06-main-conversation/evidences/design-review-disposition.md)第 2、6、7 条，[实现审查](../t06-main-conversation/evidences/impl-review-omp.txt)第 2 条）。开发者 2026-11-19 同意建跟进、不阻塞第一版；2026-11-22 让开工，草稿 1 的三处待确认都按推荐（决定 1）。

依据：[`harness/runtime.md`](../../../../../docs/specs/harness/runtime.md)“目标与非目标”的已知限制、输出 34、36、41、43、104；[`harness/session.md`](../../../../../docs/specs/harness/session.md) 的已知限制、输出 1、5、6、11、12、15、17、25。审查者的探针在 [t06 的证据](../t06-main-conversation/evidences/design-review-probes/)。

设计审查：[第一轮（omp）](evidences/design-review-omp.txt)，17 条（阻断 4），处理见 [evidences/design-review-disposition.md](evidences/design-review-disposition.md)。草稿 2 的主要变化：

- 第 4 处不再改存储层（草稿 1 的“第一次写入时才发布”牵出发布点不确定、未发布目录可写附件、跨进程 busy、关闭与发布的竞态、会话头可变等问题），改成内核识别“只有会话头”的日志并补完初始化；
- 第 1 处把受理之后的收尾分成“受理批写下就必须做的”与“会话健康才做的”，损坏后后一类一律不做；
- 第 2 处在唯一的状态发布入口挡住，`abort` 也挡；
- 补上几处同类缺口（只读会话的应答重放、损坏会话上撤回扩展、建会话早期失败漏放锁、旧 fork 的补写判断）。

已核对的事实（代码在 `packages/nb-harness/src/kernel/`）：

- 受理：`run/commands.ts` 的 `accept` 用 `writeAndReact`（`dispatch/reactions.ts`），先写受理批、再派发反应；任何一次写失败都抛 `LogBrokenError`，`accept` 交回 `log-broken`、不跑 `outcome.written` 与 `after`。应答把叫醒等待者放在 `written` 里，没跑时 `releaseClaims` 以 `aborted` 叫醒。`changeProfile` 的 `written` 卸载旧扩展、换装配、清只读，`after` 装新扩展。
- `resolve` 在进 `accept` 之前就按只读拒绝（`session/session.ts` 的 API 表），已提交的键重开后重发得 `read-only`；`abortCommand` 不走 `accept`，句柄坏了也能登记停止、推 `aborting`。
- 状态：`run/control.ts` 在 `onBroken` 推 `broken`，之后 `interactions` 的 `#reportFrom`、运行循环的阶段回调、收口都会再推别的状态。
- 只读打开：`openSession` 只在能装配时写 `profileChanged` 与恢复批（`run/recover.ts` 的 `recoveryDrafts`，纯内核事件，不派发反应）。
- 建会话：存储层 `create` 原子写会话头、写索引；`createSession` 之后写第一批。两步之间被杀留下只有会话头的日志；再建同一 id 得 `session-exists`，打开时补写 `profileChanged{code-updated}`、没有 `sessionCreated` 与唤起门。`createSession` 在拿到存储句柄之后、`try` 之前就调宿主资源（`buildApi`），那里抛错时不放锁。fork 的补写分支把“目标打开着”与“目标有事件”都当成复制已完成。

## 技术选型

无。

## 关键设计

### 1. 受理之后的收尾分两类（`run/commands.ts`、`dispatch/reactions.ts`、`session/session.ts`）

- `Outcome` 加 `committed?: () => void`：受理批写下就同步执行，不论之后的反应批成败；只放“日志已经这样说了，内存必须跟上”的事，现在只有应答叫醒认领到的等待者（`resolve`、`send{settlePending}` 从 `written` 挪过来）。
- `accept` 先写受理批，再派发反应；反应阶段的 `LogBrokenError` 不抛出。受理批写失败照旧交回 `log-broken`（结果不确定，等待者照旧以 `aborted` 叫醒）。
- 受理批写下、反应批失败：跑 `committed`；不跑 `written`、不开运行（`launch`）、不跑 `after`；回执成功（决定 1）。句柄已坏，内存不再推进（例如 `changeProfile` 不卸载、不换装配、不清只读），重开以文件为准。
- 反应都写下了：照旧跑 `written`、`launch`、`after`。运行循环里的 `writeAndReact` 不改。
- 只读的门挪进 `resolve` 的判定（`decide`）里：已提交的键先按重放规则交回原结果，新的应答才得 `read-only`。

### 2. 损坏之后状态与停止（`run/control.ts`、`run/commands.ts`）

- 状态只经 `#setStatus` 发布；`core.broken` 之后它只接受 `broken`，别的一律丢掉（事项报告、阶段回调、收口都经它）。快照读的是同一个值。
- `abortCommand`：先按键重放；没有记录、句柄已坏时交回 `log-broken`，不登记停止。损坏之前已在途的停止照旧收口。
- 损坏时已登记的 `waitRun`：日志里已经有这次运行的 `runEnded` 时交回它（与之后再来的 `waitRun` 一致），否则 `log-broken`。
- 损坏会话上撤回扩展（`reassembleNow` 遇到 `LogBrokenError`）：不写装配事件、不装新扩展，但撤回的扩展照样摘下、等它清理完再放行等待者。

### 3. 只读打开也收口（`session/session.ts`）

恢复批不论是否只读都在打开时写，次序不变：能装配时“比较哈希、写 `profileChanged{code-updated}` → 恢复 → 装扩展”，只读时只有“恢复”。恢复批的生成（`recoveryDrafts`）不改，只挪调用。恢复批写失败照旧以 `log-broken` 交回、放锁，下次打开再恢复。

### 4. 只有会话头的日志（`session/session.ts`，存储层不改）

日志里一个事件都没有（只有会话头）就是“建会话没写完”：

- **再建同一个 id**（`createSession`）：存储得 `session-exists` 时打开它；没有事件、会话头与这次请求一致（`profile`、`owner`、`caller`、`project`、`questions`、`result`、`background`）时，用这个句柄接着写第一批、装扩展，交回成功，与新建的一样；不一致或已有事件时关掉，照旧 `session-exists`；被别人开着照旧得 `session-exists`。
- **打开**（`openSession`）：没有事件时按“建会话”补第一批（`sessionCreated`、`profileChanged{reason: "created"}`、唤起门），初始输入用 `{}`；Profile 声明了初始输入、`{}` 不合它的 schema 时不补，打开失败、码 `session-incomplete`（新码：用同一个 id、同样的参数再建一次）。只读打开（Profile 解析不到）也不补，同样得 `session-incomplete`。
- 以前留下的只有会话头的日志走同一条路，不另做迁移。
- 建会话的失败收口从拿到存储句柄那一行开始（`SessionCore`、宿主资源、API 构建都在收口里），任何一步抛错都放锁。
- fork 的补写判断：目标被别人开着时不当成已完成，交回失败（可重试）；目标已有事件时，第一条事件的 id 等于来源路径第一条事件的 id 才算复制完成，否则交回失败，不覆盖。

承诺的范围：会话头与第一批。建会话时 `on.sessionCreated` 等反应、Agent 层建会话之后的设置（`initial-approval-<id>`）不在其中，写成已知限制。

## Spec 与文档改动

- `harness/runtime.md`：已知限制改成只留“受理批写入结果不确定时等待者以 `aborted` 叫醒”；新增输出：受理批写下、反应批写失败时回执成功、等待者按日志叫醒、不开运行、不做需要健康会话的收尾；损坏后 `abort` 得 `log-broken`；损坏时 `waitRun` 的结果规则。
- `harness/session.md`：删掉两条已知限制；输出 12 补“损坏之后状态与快照一直是 `broken`，撤回的扩展照样摘下”；输出 15 写明只读打开也恢复；输出 1 与失败表补“只有会话头的日志”的补完规则与 `session-incomplete`；新增已知限制：建会话时的反应不保证做完。
- `harness/runtime.md` 另记已知限制：Profile 找得到但缺依赖、以占位装配冷打开的会话，补上依赖后的重新装配不重新解析原 Profile（审查第 12 条，另建跟进）。
- 应用一侧：`bots/backend/main.ts` 不改（`create` 成功分支照旧，失败分支照旧读会话头）；`agent/sessions.md` 的失败码表补 `session-incomplete` 的转交。

## 切片

1. **受理与状态**（关键设计 1、2）：先把审查者的探针改成正式测试（`run/interaction.test.ts`、`run/control.test.ts`、`session/session.test.ts`，真实内核与 JSONL 存储；按事件类型或 `cause` 定位让反应批那次写失败，不靠“第 N 次写”），看它们失败，再改。
2. **只读打开也收口**（关键设计 3）：`session/session.test.ts`，用 `tests/kernel/fixtures/crash-session.ts` 的 `waiting-approval` 子进程夹具。
3. **只有会话头的日志**（关键设计 4）：`session/session.test.ts`、`run/tree.test.ts`（fork），夹具直接造只有会话头的日志（存储层 `create` 不写事件）。

每片单独提交；三片做完后交 omp 做一次实现审查。

## 验收映射

| 编号 | 覆盖 |
|---|---|
| runtime.md 新增的反应批失败一条 | `interaction.test.ts`：`resolve` 与 `send{settlePending}` 各一，回执成功、`ctx.ask` 的返回与日志里的结算一致、状态帧末尾与快照是 `broken`、下一条指令 `log-broken`、同键重发成功；`changeProfile` 一例：反应批失败后不卸载、不装新扩展、回执成功；空闲时回答异步提问、反应批失败：回执成功、模型没收到新请求（不开运行） |
| 损坏后的状态、`abort`、`waitRun` | `control.test.ts`：订阅到第一个 `broken` 后发新的 `abort` 得 `log-broken`，之后没有非 `broken` 的状态帧；`runEnded` 写下、它的反应批失败时，损坏前后两次 `waitRun` 交回同一个结果 |
| 损坏会话上撤回扩展 | `session.test.ts`：撤回返回时扩展的清理已经跑过，日志没有新事件 |
| 只读会话的应答重放 | `session.test.ts`：受理批写下、反应批失败，关掉、缺 Profile 重开，同键 `resolve` 交回原结果，新键得 `read-only` |
| session.md 输出 15（只读也恢复） | `session.test.ts`：真实审批、异步提问、排了一句后 `kill -9`；缺 Profile 重开后同步审批结算为 `interrupted`、`toolResult{denied}`、`runEnded{interrupted}`、就绪的话转成留着、门关上、异步提问还在；再开一次不重复写；换回 Profile 后 `send` 开新运行、没有 `runResumed`；反例：用 `rewind` 造的真暂停只读打开时不写恢复批；恢复批写失败时 `log-broken`、放锁、下次再恢复 |
| session.md 只有会话头的补完与 `session-incomplete` | `session.test.ts`：同参数再建恰好补一次第一批、交回成功；参数不同得 `session-exists`、日志不动；打开时补完（不要求初始输入的 Profile）；要求初始输入的得 `session-incomplete`；只读打开得 `session-incomplete`；宿主资源在建会话时抛错之后同 id 能再建 |
| fork 的补写判断 | `tree.test.ts`：只有会话头的旧目标被打开过（补成普通会话）之后重发 fork，交回失败、不覆盖；目标被开着时交回失败 |

## 验证

- `bun run --cwd packages/nb-harness test`、`typecheck`；应用里 `packages/neuro-book/src/plugins/agent` 与 `bots` 的 bun 测试。
- e2e 不跑：改动在内核，应用一侧的行为由上面的测试与 agent、bots 的集成测试覆盖。
- 变异检查：去掉“反应阶段不抛出”“`committed` 与 `written` 分开”“状态门”“`abort` 的损坏门”“只读也写恢复批”“只读门挪到重放之后”“只有会话头的补完”，对应测试要失败。

## 不做与风险

- 不做：存储层的发布语义（草稿 1 的方案）；建会话时的反应与 Agent 层设置的完成保证；占位装配解除只读（审查第 12 条，另建跟进）；回退后复用 run id 的 `waitRun` 取到旧分支结果（审查第 5 条后半，记已知限制）；损坏前已在途、损坏后才收到的停止以外的并发组合。
- 风险：`committed` 里只能放同步、不写日志的事。放进会写日志或依赖反应的步骤会让损坏会话继续推进，由“反应批失败后不卸载、不开运行”两条测试兜底。

## 待确认

无（草稿 1 的三处已定；草稿 2 改的是实现方式，开发者定的三条行为不变：回执成功、只读也收口；“不迁移”现在不需要了，旧日志走同一条补完路径）。
