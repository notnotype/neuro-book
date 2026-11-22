---
schema: nbook.task/v2
taskId: t17-kernel-review-followups
status: planned
updated: 2026-11-22
---

# t16 审查挖出的内核原有缺陷：真暂停误判、压缩先于受理、损坏后继续装扩展、占位装配解除只读、建会话早期漏放锁、只有会话头的日志

## 目标与范围

跟进 [t16](../t16-kernel-narrow-window-defects/README.md) 两轮设计审查顺带查出、与 t16 的缺陷无关的内核原有缺陷，以及 t16 留作已知限制的“只有会话头的日志”（开发者 2026-11-22 定：t16 不扩范围，这些另建跟进）。审查报告与基线探针的结论见 t16 的 [第一轮](../t16-kernel-narrow-window-defects/evidences/design-review-omp.txt)、[第二轮](../t16-kernel-narrow-window-defects/evidences/design-review-r2-omp.txt)。

1. 回退后的真暂停被误判成中断：`rewind` 之后扩展在 `on.leafChanged` 里发一条路径事件，`leafSetBy` 被改掉，重开时补写 `runEnded{interrupted}`、关门（第二轮第 11 条；t16 的只读恢复继承同一判据）。
2. 运行中 `compact` 在受理批写下之前就交给运行边界，压缩方法可能已经开始执行，受理批随后写失败（第二轮第 14 条）。
3. 换 Profile 时装新扩展：第一个新扩展的 `mount` 写坏日志之后，后面的扩展照样装（第二轮第 17 条）。
4. 缺依赖的占位装配：Profile 找得到但缺扩展、以占位装配冷打开，补上依赖后的重新装配不重新解析原 Profile，就解除只读（第一轮第 12 条）。
5. 建会话在拿到存储句柄之后、失败收口之前调宿主资源，那里抛错时不放锁（第一轮第 3 条）；打开只有会话头的日志、解析 Profile 抛错时同样（第二轮第 13 条）。
6. 只有会话头的日志（t16 原第 4 处，留作 [`harness/session.md`](../../../../../docs/specs/harness/session.md) 的已知限制）：两轮审查对存储层发布与内核补完两种改法的全部发现（第一轮第 1、6、8、9、10、13、14 条，第二轮第 1–3、8–10、12、16 条）是设计这一条的输入；fork 补写的判断（目标被开着、只看有没有事件）一并处理。

合同：[`harness/runtime.md`](../../../../../docs/specs/harness/runtime.md)、[`harness/session.md`](../../../../../docs/specs/harness/session.md)；第 6 条另牵 [`agent/sessions.md`](../../../../../docs/specs/agent/sessions.md) 与 [`bots/main-conversation.md`](../../../../../docs/specs/bots/main-conversation.md)。

## 当前状态

2026-11-22 经 nbdev 新建，尚未开工。

## 下一步

t16 合入之后排期；各条先用真实内核把审查者的探针改成正式测试、看它失败，再定改法。第 6 条要先出方案给开发者看。
