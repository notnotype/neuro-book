# t16 计划：内核四个窄窗口缺陷（草稿 1）

## Context

t06 设计与实现审查查出的四个内核原有缺陷，所有会话都受影响，t06 只把它们写成了 Spec 的已知限制（[t06 设计审查处理](../t06-main-conversation/evidences/design-review-disposition.md)第 2、6、7 条，[实现审查](../t06-main-conversation/evidences/impl-review-omp.txt)第 2 条）。开发者 2026-11-19 同意建跟进、不阻塞第一版；2026-11-22 让开工。

依据：[`harness/runtime.md`](../../../../../docs/specs/harness/runtime.md)“目标与非目标”第 24 行的已知限制、输出 34、43、104；[`harness/session.md`](../../../../../docs/specs/harness/session.md) 第 25、26 行的已知限制、输出 1、12、15、17。审查者的探针在 [t06 的证据](../t06-main-conversation/evidences/design-review-probes/)（`kernel-probes.test.ts.txt`、`kernel-crash-fixture.ts.txt`）与实现审查报告里的 `kernel-faults.ts`、`reaction` 一支。

已核对的事实（代码在 `packages/nb-harness/src/kernel/`）：

- 受理：`run/commands.ts` 的 `accept` 调 `writeAndReact`（`dispatch/reactions.ts`），它先 `core.write` 受理批、再逐条派发反应，反应的输出各自 `core.write`。任何一次写失败都抛 `LogBrokenError`，`accept` 一律交回 `log-broken`、不跑 `outcome.written`。应答（`resolve`、`send` 的 `settlePending`）把“叫醒等待者”放在 `written` 里，没跑时由 `releaseClaims`（`run/interaction.ts`）收尾：事项已不在待处理里就以 `aborted` 叫醒。
- 状态：句柄坏了时 `run/control.ts` 推 `broken`；之后等待者被叫醒，`interactions` 的 `#reportFrom` 推 `running`，运行收口时看“上一次推的不是 `broken`”再推 `idle`，把 `broken` 盖掉。
- 只读打开：`session/session.ts` 的 `openSession` 只在 `readOnly === null` 时写 `profileChanged` 与恢复批（`run/recover.ts` 的 `recoveryDrafts`，纯内核事件，不跑反应）。
- 建会话：`log/jsonl-store.ts` 的 `create` 在锁下原子写会话头、写空索引、打开追加句柄；第一批（`sessionCreated`、`profileChanged`、`wakeGate`）由 `createSession` 之后经 `append` 写。两步之间被杀留下只有会话头的日志与索引。“目录在、日志不在”已经按“建到一半、接着建”处理。fork（`forkSession`）走同一条路，靠“只有会话头就补写复制批”兜底。

## 技术选型

无。

## 关键设计

### 1. 应答的反应批写失败（`run/commands.ts`、`dispatch/reactions.ts`）

- `writeAndReact` 拆成两步可分开回报：`writeAndReact` 照旧（运行里用）；`accept` 改用一个先写受理批、再派发反应的版本，反应阶段的 `LogBrokenError` 不抛出，交回 `{events, reactionsBroken: true}`。受理批本身写失败照旧交回 `log-broken`（结果不确定，等待者照旧以 `aborted` 叫醒，这句已知限制保留）。
- 受理批写下、反应批失败时：
  - 回执是成功（`{ok: true, seq, replayed: false}`），与同一 `commandId` 重发、重开后得到的一致（待确认 1）；
  - 照常跑 `outcome.written`，等待者按日志里的结算叫醒（`deny` 就是 `deny`）；
  - 不开运行（`launch` 跳过），`after` 照跑；
  - 句柄已经坏了，之后的指令得 `log-broken`。

### 2. 句柄坏了以后状态不被盖掉（`run/control.ts`、`run/interaction.ts`）

`#reportFrom` 与运行收口按 `core.broken` 判：句柄坏了就不推运行态、收口不推 `idle`，状态停在 `broken`；快照同样读到 `broken`（`harness/session.md` 输出 12）。不看“上一次推了什么”。

### 3. 只读打开也做恢复（`session/session.ts`）

恢复批（`recoveryDrafts`）不论是否只读都在打开时写；`profileChanged{code-updated}` 仍只在能装配时写。恢复批只有内核事件、不派发反应，不依赖解析不到的 Profile。这样换回能用的 Profile 之后，上次的运行已经按 `interrupted` 收口，旧事项已结算，就绪的话按恢复规则转成留着；`send` 开一次新运行，不写 `runResumed`。

### 4. 只有会话头的日志（`log/jsonl-store.ts`）

`create` 只在锁下建目录、写属主文件与 `blobs/`，不写日志与索引，交回一个“未发布”的句柄；它上的第一次 `append` 把会话头连同这一批一次原子写成 `session.jsonl`（`writeAtomic`，带同步），再写索引、打开追加句柄。之后的 `append` 照旧追加。

- 发布之前被杀：目录在、日志不在，下次 `create` 按现有规则接着建；`open`、`header`、`list` 都看不到它（`session-not-found`）。
- 未发布的句柄被关掉（建会话在写第一批之前失败）：同上。
- fork 的复制批成了第一次 `append`，一起原子发布；“只有会话头就补写”的分支留着，只为以前留下的日志。
- 以前留下的只有会话头的普通会话照旧能打开（极少，不做迁移，待确认 3）。
- `memory-store.ts` 的语义对齐（测试用的内存存储也要“未发布前看不到”）。

## Spec 与文档改动

- `harness/runtime.md`：删掉第 24 行已知限制里“受理批写下了、反应批写失败”与“之后的状态帧与快照报 running、idle”两句，留“受理批的写入结果不确定时以 aborted 叫醒”；输出里补一条“受理批写下、反应批写失败：回执成功、等待者按日志叫醒、不开运行、句柄损坏”。
- `harness/session.md`：删掉第 25、26 行两条已知限制；输出 1 写明会话头与第一批一起发布、发布之前看不到；输出 12 补“损坏之后状态与快照一直是 broken”；输出 15 写明只读打开也恢复。
- 按 `harness/session.md`、`runtime.md` 的“边界与兼容”补一句：这次之前留下的只有会话头的日志照旧。

## 切片

1. 第 2 处（状态不被盖掉）与第 1 处（受理路径分开回报）：先把审查者的 `reaction` 探针改成正式测试（`run/interaction.test.ts`，真实内核、JSONL 存储，只让反应批那次写入失败），看它失败，再改。`resolve` 与 `send{settlePending}` 两条路共用一个测试辅助。
2. 第 3 处（只读打开也恢复）：`session/session.test.ts`，用 `kernel-crash-fixture` 的子进程做法，在运行等审批、缓冲区有一句时 `kill -9`；重开时 Profile 缺失，再换回。
3. 第 4 处（建会话原子发布）：`log/store.test.ts` 与 `session/session.test.ts`。写第一批时让发布失败、或子进程在 `create` 之后 `kill -9`：没有日志与索引，`list` 看不到，重建同一 id 恰好初始化一次；fork 同样。

每片单独提交；三片做完后交 omp 做一次实现审查（后端）。

## 验收映射

| 编号 | 覆盖 |
|---|---|
| runtime.md 新增的反应批失败一条 | `interaction.test.ts`：回执成功、工具收到 `deny`、状态帧末尾与快照是 `broken`、下一条指令 `log-broken`、同 `commandId` 重发成功；`resolve` 与 `settlePending` 各一 |
| session.md 输出 12 的补句 | 同上的状态断言 |
| session.md 输出 15（只读也恢复） | `session.test.ts`：重开后日志有 `interactionResolved{interrupted}`、`runEnded{interrupted}`；换回 Profile 后 `send` 的运行 id 是新的、没有 `runResumed` |
| session.md 输出 1（一起发布） | `store.test.ts`、`session.test.ts`：发布前被杀或失败时看不到会话、重建恰好一次初始化；fork 的复制批同样 |

## 验证

- `bun run --cwd packages/nb-harness test`、`typecheck`；应用里用到会话建立的 `packages/neuro-book/src/plugins/agent` 与 `bots` 的 bun 测试。
- e2e 不跑：改动在内核与存储，应用一侧的行为由上面的测试与 agent、bots 的集成测试覆盖。
- 变异检查：去掉“反应阶段不抛出”“按 `core.broken` 判状态”“只读也写恢复批”“延迟发布”，对应测试要失败。

## 不做与风险

- 不做：以前留下的只有会话头的日志的迁移；受理批写入结果不确定时的等待者（仍以 `aborted` 叫醒）；Agent 层建会话之后设审批模式那一步的崩溃窗口（`agent.ts` 的 `initial-approval-<id>`，另一个窗口，记后续）。
- 风险：延迟发布改了“建会话成功就有日志文件”的前提。发布前 `header`、`list`、`entry` 看不到它，会话表与 Agent 层的“建了马上读会话头”的路径（例如 `ensureMain` 建完读归属）要在建会话的同一调用里写完第一批之后才交回，`createSession` 现在正是这样，测试覆盖“建会话交回之后读得到会话头”。

## 待确认

1. **受理批写下、反应批写失败时的回执**：推荐交回成功。受理确实写下了，重发同一个 `commandId` 与重开之后都会说成功；句柄坏了由状态 `broken` 与之后的指令得 `log-broken` 表达。另一个做法是照旧交回 `log-broken`，只把等待者改成按日志叫醒，这样回执和重发的说法不一致。
2. **只读打开时就写恢复批**：推荐。恢复只有内核事件，不需要解析不到的 Profile；另一个做法是等第一次解除只读时再恢复，要另外区分“崩溃待恢复”与“回退造成的暂停”，复杂得多。
3. **以前留下的只有会话头的日志不迁移**：推荐。只在建会话的那一瞬被杀才会留下，迁移代码比它出现的概率贵。
