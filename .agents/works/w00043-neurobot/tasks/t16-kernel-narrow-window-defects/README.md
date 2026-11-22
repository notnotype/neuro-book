---
schema: nbook.task/v2
taskId: t16-kernel-narrow-window-defects
status: active
updated: 2026-11-22
---

# 内核四个窄窗口缺陷：反应批失败时的等待者与状态、只读打开不恢复、只有会话头的半成品日志

## 目标与范围

[t06 设计审查](../t06-main-conversation/evidences/design-review-omp.txt)与实现审查查出的四个内核原有缺陷，t06 之前就有、所有会话都受影响，t06 只把它们写成 Spec 的已知限制（[处理](../t06-main-conversation/evidences/design-review-disposition.md)）：

1. 第 2 条：应答（`resolve`、`settlePending`）的受理批写下、它引起的反应批写失败时，指令交回 `log-broken`，等待者被以 `aborted` 叫醒，与日志里的结算不一致。改法要让受理路径分开回报主批与反应批。
2. 第 6 条：Profile 解析不到、以只读打开的会话不做中断恢复；换回能用的 Profile 之后，上次没收口的运行被当成暂停的运行接着跑。
3. 第 7 条：建会话时会话头与第一个写入批分两次写，两次之间被杀留下只有会话头的日志；再建同一个 id 得 `session-exists`，打开得到一个没有初始事件的会话。改法牵连 fork 的补写。

4. t06 实现审查第 2 条：同一个场景下（应答的反应批写失败），`releaseClaims` 叫醒等待者之后状态帧推 `running`、运行收口再推 `idle`，盖掉了 `broken`，快照与状态帧都报不出句柄已坏（`harness/session.md` 输出 12）。`resolve` 在 t06 之前就这样，`send` 的 `settlePending` 复用了同一条路径。改法：句柄已坏时事项的状态更新不改成运行态，收口时按 `core.broken` 保留 `broken`。探针 `kernel-faults.ts` 的 `reaction` 一支（[t06 实现审查](../t06-main-conversation/evidences/impl-review-omp.txt)）。

审查者的探针在 [t06 的证据](../t06-main-conversation/evidences/design-review-probes/)（`kernel-probes`、`kernel-crash-fixture`）。

合同：[`harness/runtime.md`](../../../../../docs/specs/harness/runtime.md) 与 [`harness/session.md`](../../../../../docs/specs/harness/session.md) 的“目标与非目标”里对应的已知限制，修好后去掉。

不阻塞第一版（开发者 2026-11-19 同意按推荐：建跟进、放 w00043、不阻塞）。

## 当前状态

2026-11-19 经 nbdev 新建；2026-11-22 开工，计划 [plan.md](plan.md)。

决定：

1. 计划草稿 1 的三处待确认都按推荐（开发者 2026-11-22 答“可以，都按推荐”）：应答的受理批写下、反应批写失败时回执报成功，等待者按日志里的结算叫醒，会话标成损坏；Profile 解析不到、以只读打开时也写恢复批收口；以前留下的只有会话头的日志不迁移。
2. 第 4 处（只有会话头的日志）这次不修，留作已知限制（开发者 2026-11-22 选“这次不修”）：两轮设计审查表明存储层发布与内核补完两种改法都牵连很广，它只在建会话的那一瞬被杀才出现。转 [t17](../t17-kernel-review-followups/README.md)。
3. 审查顺带查出的原有缺陷（真暂停误判、压缩先于受理、损坏后继续装扩展、占位装配解除只读、建会话早期漏放锁）另建跟进 [t17](../t17-kernel-review-followups/README.md)，t16 不扩范围（开发者 2026-11-22）。

## 下一步

omp 设计审查，处理后按计划三片实施；每条先用真实内核把探针改成正式测试、看它失败，再改。
