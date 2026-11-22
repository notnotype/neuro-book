# t16 计划：内核窄窗口缺陷（草稿 4）

## Context

t06 设计与实现审查查出的四个内核原有缺陷，所有会话都受影响，t06 只把它们写成了 Spec 的已知限制（[t06 设计审查处理](../t06-main-conversation/evidences/design-review-disposition.md)第 2、6、7 条，[实现审查](../t06-main-conversation/evidences/impl-review-omp.txt)第 2 条）。开发者 2026-11-19 同意建跟进、不阻塞第一版；2026-11-22 让开工，草稿 1 的三处待确认都按推荐（决定 1）。

依据：[`harness/runtime.md`](../../../../../docs/specs/harness/runtime.md)“目标与非目标”的已知限制、输出 34、36、41、43、104；[`harness/session.md`](../../../../../docs/specs/harness/session.md) 的已知限制、输出 1、5、6、11、12、15、17、25。审查者的探针在 [t06 的证据](../t06-main-conversation/evidences/design-review-probes/)。

设计审查：[第一轮（omp）](evidences/design-review-omp.txt) 17 条、[第二轮（omp）](evidences/design-review-r2-omp.txt) 17 条、[第三轮（omp）](evidences/design-review-r3-omp.txt) 10 条，处理见 [evidences/design-review-disposition.md](evidences/design-review-disposition.md)。开发者 2026-11-22 定范围（决定 2、3）：

- 原第 4 处（只有会话头的日志）这次不修，留作已知限制，转 [t17](../t17-kernel-review-followups/README.md)；
- 审查顺带查出的原有缺陷（真暂停误判、压缩先于受理、损坏后继续装扩展、占位装配解除只读、建会话早期漏放锁）转 t17。

三轮之后开发者定（决定 4）：损坏会话上撤回扩展、损坏前已登记的停止（含同键重入）也转 t17，草稿 4 不再做设计审查，实现后照常做实现审查。

本计划只做：应答的反应批写失败（含损坏后的收尾与等待者）、损坏后状态被盖掉（含损坏后新的停止）、只读打开不收口（含只读会话的应答重放）。

已核对的事实（代码在 `packages/nb-harness/src/kernel/`）：

- 受理：`run/commands.ts` 的 `accept` 用 `writeAndReact`（`dispatch/reactions.ts`），先写受理批、再派发反应；任何一次写失败都抛 `LogBrokenError`，`accept` 交回 `log-broken`、不跑 `outcome.written` 与 `after`。应答把叫醒等待者放在 `written` 里，没跑时 `releaseClaims` 以 `aborted` 叫醒。`changeProfile` 的 `written` 卸载旧扩展、换装配、清只读，`after` 装新扩展。
- `resolve` 在进 `accept` 之前就按只读拒绝（`session/session.ts` 的 API 表），已提交的键重开后重发得 `read-only`；`abortCommand` 不走 `accept`，句柄坏了也能登记停止、推 `aborting`。
- 状态：`run/control.ts` 在 `onBroken` 推 `broken`，之后 `interactions` 的 `#reportFrom`、运行循环的阶段回调、收口都会再推别的状态。
- 只读打开：`openSession` 只在能装配时写 `profileChanged` 与恢复批（`run/recover.ts` 的 `recoveryDrafts`，纯内核事件，不派发反应）。

## 技术选型

无。

## 关键设计

### 1. 受理之后的收尾分两类（`run/commands.ts`、`dispatch/reactions.ts`、`session/session.ts`）

- `Outcome` 加 `committed?: () => void`：只放“日志已经这样说了，内存必须跟上”的事，现在只有应答叫醒认领到的等待者（`resolve`、`send{settlePending}` 从 `written` 挪过来）。
- `accept` 的顺序：写受理批（失败照旧交回 `log-broken`，结果不确定，等待者照旧以 `aborted` 叫醒）→ 派发反应（这一步的 `LogBrokenError` 不抛出，记下“反应失败”）→ 反应阶段结束之后、不论成败，在保证执行的收尾里跑 `committed`。叫醒不早于反应：反应还在跑时等着的工具不能先往下走（健康路径的先后与现在相同）。反应阶段抛出别的异常时，`committed` 照样跑，异常照旧交给调用方。
- 反应都写下了：照旧跑 `written`、`launch`、`after`。反应批失败：不跑 `written`、不开运行、不跑 `after`；句柄已坏，内存不再推进（例如 `changeProfile` 不卸载、不换装配、不清只读），重开以文件为准。回执只对应答（带 `committed` 的 `resolve`、`send{settlePending}`）报成功（决定 1）；别的指令照旧交回 `log-broken`（同键重发会得到成功，这个说法不一致是原有的，记已知限制）。
- 运行循环里的 `writeAndReact` 不改。
- 只读的门挪进 `resolve` 的判定（`decide`）里：已提交的键先按重放规则交回原结果，新的应答才得 `read-only`。

### 2. 损坏之后状态、等待者与新的停止（`run/control.ts`、`run/commands.ts`、`api/codes.ts`）

- 状态只经 `#setStatus` 发布；`core.broken` 之后它只接受 `broken`，别的一律丢掉（事项报告、阶段回调、收口都经它）。快照读的是同一个值。
- 等待者：损坏时把整张已登记的 `waitRun` 表结算掉，不只当前运行的：每个 id 日志里已有这次的 `runEnded` 就交回它，否则 `log-broken`（包括受理批写下了、因反应批失败没开起来的运行）。之后再来的 `waitRun` 按同一规则。
- 新的停止：`abortCommand` 先按键重放；没有记录、句柄已坏时交回 `log-broken`，不登记。`commandErrors.abort` 声明 `log-broken`（远程 `agent.sessions.abort` 的码表随它派生）。损坏前已登记的停止照旧（转 t17）。

### 3. 只读打开也收口（`session/session.ts`）

恢复批不论是否只读都在打开时写，次序不变：能装配时“比较哈希、写 `profileChanged{code-updated}` → 恢复 → 装扩展”，只读时只有“恢复”。恢复批的生成（`recoveryDrafts`）不改，只挪调用。恢复批写失败照旧以 `log-broken` 交回、放锁；下次打开以文件为准：恢复批已经完整写进文件（只是同步报错）就按它归约、不再写，没写全才补。是否需要恢复沿用现有判据（`recoveryDrafts` 与叶子的移动方式）；回退后扩展在 `on.leafChanged` 里发路径事件、真暂停被当成中断的原有缺陷，只读打开同样继承，转 t17。

## Spec 与文档改动

- `harness/runtime.md`：已知限制改成只留“受理批写入结果不确定时等待者以 `aborted` 叫醒”与“非应答指令在反应批写失败时回执 `log-broken`、重发得到成功”；新增输出：应答的受理批写下、反应批写失败时回执成功、等待者在反应阶段结束后按日志叫醒；任何指令在这种情况下都不开运行、不做需要健康会话的收尾；损坏后新的 `abort` 得 `log-broken`；输出 13 写损坏时 `waitRun` 的结果规则（有这次已提交的 `runEnded` 交回它，否则 `log-broken`）。
- `harness/session.md`：删掉“只读打开不恢复”的已知限制；输出 12 补“损坏之后状态与快照一直是 `broken`”；“时序与寿命”的损坏条目与 SDK 的 `waitRun` 注释改成引用 runtime 输出 13 的规则；输出 15 写明只读打开也恢复、恢复批以文件为准；“只有会话头的日志”的已知限制保留，补一句转 t17。
- `harness/runtime.md` 另记已知限制：缺依赖的占位装配补上依赖后解除只读；回退后的真暂停可能被当成中断（都转 t17）。

## 切片

1. **受理、状态、等待者、新的停止**（关键设计 1、2）：先把审查者的探针改成正式测试（`run/interaction.test.ts`、`run/control.test.ts`、`session/session.test.ts`，真实内核与 JSONL 存储；按事件类型或 `cause` 定位让那一次写失败，不靠“第 N 次写”），看它们失败，再改。
2. **只读打开也收口**（关键设计 3）：`session/session.test.ts`，用 `tests/kernel/fixtures/crash-session.ts` 的子进程夹具：`waiting-approval`（就绪的话由子进程排入、等受理回执之后再通知父进程杀），另用 `in-tool`、`compacting` 两个检查点做只读对照。

每片单独提交；两片做完后交 omp 做一次实现审查。

## 验收映射

| 编号 | 覆盖 |
|---|---|
| runtime.md 新增的反应批失败一条 | `interaction.test.ts`：`resolve` 与 `send{settlePending}` 各一，回执成功、`ctx.ask` 的返回与日志里的结算一致、状态帧末尾与快照是 `broken`、下一条指令 `log-broken`、同键重发成功；健康路径的先后：`on.interactionResolved` 挂着时工具还没往下走；`changeProfile` 一例：反应批失败后回执 `log-broken`、不卸载、不装新扩展；空闲时回答异步提问、反应批失败：回执成功、模型没收到新请求、下一轮边界该退役的工具没有退役（启动保护单独变异） |
| 损坏后的状态、等待者、新的停止 | `control.test.ts`：订阅到第一个 `broken` 后发新的 `abort` 得 `log-broken`，之后没有非 `broken` 的状态帧；`runEnded` 写下、它的反应批失败时损坏前后两次 `waitRun` 交回同一个结果；受理批写下、没开起来的运行，订阅到 `runStarted` 时登记的 `waitRun` 交回 `log-broken`；远程 `agent.sessions.abort` 在坏句柄上交回 `log-broken`（不是提供方异常） |
| 只读会话的应答重放 | `session.test.ts`：受理批写下、反应批失败，关掉、缺 Profile 重开，同键 `resolve` 交回原结果，新键得 `read-only` |
| session.md 输出 15（只读也恢复） | `session.test.ts`：真实审批、异步提问、排了一句后 `kill -9`；缺 Profile 重开后同步审批结算为 `interrupted`、`toolResult{denied}`、`runEnded{interrupted}`、就绪的话转成留着、门关上、异步提问还在；再开一次不重复写；换回 Profile 后 `send` 开新运行、没有 `runResumed`；反例：`rewind` 造的真暂停（不发路径事件）只读打开时不写恢复批；恢复批在写入前失败与写完整后同步报错两种：都 `log-broken`、放锁；两次打开之间读文件，前者没有新批、后者已有完整的恢复批；第二次打开时前者补写、后者不写，保留原批的 id 与 seq；`in-tool`、`compacting` 两个检查点只读打开：已开始的工具 `unknown`、没开始的 `denied`，在途的模型请求 `modelFailed{interrupted}` |

## 验证

- `bun run --cwd packages/nb-harness test`、`typecheck`；应用里 `packages/neuro-book/src/plugins/agent` 与 `bots` 的 bun 测试。
- e2e 不跑：改动在内核，应用一侧的行为由上面的测试与 agent、bots 的集成测试覆盖。
- 变异检查：去掉“反应阶段不抛出”“`committed` 与 `written` 分开”“叫醒在反应之后”“反应批失败不开运行”“状态门”“`abort` 的损坏门”“等待表整张结算”“只读也写恢复批”“只读门挪到重放之后”，对应测试要失败。

## 不做与风险

- 不做：只有会话头的日志、建会话早期漏放锁、fork 补写判断、真暂停误判、压缩先于受理、损坏后继续装扩展、占位装配解除只读、损坏会话上撤回扩展、损坏前已登记的停止与同键重入（都转 t17）；回退后复用 run id 的 `waitRun` 取到旧分支结果（记已知限制）。
- 风险：`committed` 里只能放同步、不写日志的事。放进会写日志或依赖反应的步骤会让损坏会话继续推进，由“反应批失败后不卸载、不开运行”两条测试兜底。

## 待确认

无（开发者 2026-11-22 定了行为与范围：决定 1–4）。
