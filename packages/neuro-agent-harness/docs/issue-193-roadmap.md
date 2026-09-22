# Issue #193 候选路线

本文件是 [Issue #193](https://github.com/notnotype/neuro-book/issues/193) 的非绑定路线图，只保存可能需要研究或设计的后续阶段。它不是 Task 合同：没有 Task ID、状态、owner、允许文件或执行授权，Tasker 不得据此执行。

2026-09-11 产品形态更新：`neuro-agent-harness` 定位为 NeuroBook 领域 harness；领域无关能力拆成通用包；本项目只做包与设计。当前 Work 为 `w00002-neuro-agent-harness-redesign`，其 current Task 合同正在按新形态重写；重写完成前不创建其它 Task，也不执行本路线图条目。

## 候选阶段

| 候选阶段 | 上游必须产生 | 新 Leader 必须重新核对 |
| --- | --- | --- |
| 通用包边界与清单 | 形态变更已有持久记录 | 哪些能力领域无关、哪些必须留在领域 harness；包粒度；抽取源（产品 `server/agent` 与独立包）与最终归属 |
| 装配方式 | 通用包清单稳定 | 自组装 / 薄装配层 / Cordis / dsh 的证据与代价；装配层是否属于通用面；Cordis 评估是否要做 spike |
| 通用包合同 | 装配方式确定 | 每个包的可观察行为、错误与恢复语义、并发与版本承诺；不得携带 NeuroBook 领域概念 |
| 领域 harness 首批接入 | 通用包合同稳定 | 首批接入的验收面与集成边界；接入过程不得把领域概念写回通用包 |
| 运行时与依赖 | 包的模型/工具边界稳定 | 保留 pi（`@earendil-works/pi-*`）、改用 oh-my-pi 或其它；运行时约束与构建影响 |
| Proposal / Spec 切片 | 上述设计成熟 | 哪些取舍需要 Proposal、哪些行为需要 Spec、实现切片与门禁；每份正式产物唯一 owner |
| llmlint 等消费者处置 | 通用包与领域 harness 合同确定 | 旧消费者迁移到通用包、保留旧 harness，还是删除；数据与调用方切换矩阵 |

## 创建下一 Task 的规则

1. Leader 读取 Issue #193、current Work/Task README/context、最新 walkthrough/evidence 和本路线图。
2. 只有 current Task 的完成门禁或重写条件满足，才选择一个候选阶段。
3. Leader 重新调查 current 代码与合同，不继承本路线图中的假设为事实，不恢复已删除的 Task 草案。
4. Leader 在 `w00002-neuro-agent-harness-redesign/tasks/` 创建一个完整 current Task，写清 Agent 工作、开发者参与、任务产物、完成门禁和继续条件，然后按其 canonical role 派发并停止。
5. 并行只用于上游合同已固定，且文件、接口和状态 owner 不重叠的已创建 Task；路线条目本身不能并行派发。

## Issue 导航边界

Issue 正文应只链接当前 Work/Task、这份路线图、研究输入和重大阻塞，不复制 Task 的步骤、Gate、允许文件或验证命令。远端 Issue 更新需要单独授权；本文件更新不代表远端正文已同步。
