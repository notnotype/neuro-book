---
schema: nbook.task/v2
taskId: t01-doc-shape-survey
---

# 文档结构现状调查与分档方案

## 启动条件

本 Task 不立即执行。启动条件是 `docs/standards/code/components.md` 已被真实使用过一轮，即至少有一批组件按它标注过能力标签，使用者对它啰嗦还是不够细有实际反馈。在此之前只保留本 Task，不开始调查。

原因：模板该怎么分档取决于真实文档在真实使用中的失配方式，不取决于一次静态比较。缺少使用证据时提前定档，会重复一次「照着某类文档剪裁模板，再让其它类文档去适应」的错误。

## 目标

给出仓库文档结构约束的分档方案，使规范、标准、政策各自拥有匹配的结构要求，并消除强制填充与零约束这两种失配。本 Task 只产出调查结论和方案建议，不修改检查器、不批量改写现有文档。

## 已知现状

以下为 2026-08-30 在 master 上的静态观察，后续执行时须重新核对：

- `scripts/ci/check-documentation.ts` 只对 `kind: behavior` 强制九个章节（目标与非目标、术语与参与者、输入与前置条件、输出与可观察行为、状态与转换、副作用与数据、失败与恢复、边界与兼容、验收与 Smoke）以及证据章节；每章不得为空且不得为占位文本。
- `kind` 的合法取值为 `behavior`、`architecture`、`glossary`。后两者没有任何章节要求，因此不想要九章时只能落入零结构。
- `docs/specs/TEMPLATE.md` 明确要求空章节写出「本能力不引入持久状态」这类句子，即以统一优先于信号。
- `docs/standards/` 无模板、无 frontmatter、无检查。`docs/standards/code/` 下 14 个文件中，12 个以「适用」开头、13 个以「完成标准」结尾，属于靠自觉维持的事实约定。
- 除本轮新增的 `components.md`（118 行、9 个小节）外，`docs/standards/code/` 其余文件为 9 至 28 行、最多 3 个小节。该文件是当前唯一的显著偏离样本。

## Agent 工作

1. 重新核对上述现状，并统计 `docs/specs/` 下现有规范中被强制章节实际承载了多少内容，识别哪些章节反复出现占位或与主题无关的填充。
2. 判断 `components.md` 的偏离属于哪种情况：本身写得过长、standards 目录约定过窄，还是这类内容需要规范与标准之外的第三种文档形态。以真实使用反馈为准，不以篇幅本身下结论。
3. 提出分档方案，至少覆盖：新增文档类型的取值与各自的强制章节集合；`docs/standards/` 是否引入轻量约束及其最小集合；现有文档的迁移代价与是否需要批量改写。
4. 评估方案对 agent 检索的影响。统一结构对 agent 定位信息有真实价值，方案不得以灵活为由退回到零结构。

## 开发者参与

开发者决定是否引入新的文档类型、是否给 `docs/standards/` 加检查，以及现有规范是否需要批量改写。Agent 负责现状统计、失配证据、方案与代价评估，不把这些选择当作机械决定自行拍板。

## 任务产物

- `walkthroughs/`：现状统计、失配证据、分档方案与代价评估。
- 需要长期行为变更时，按 `docs/proposals/README.md` 创建 Proposal，由开发者决策后再考虑实施 Task。
- 原始命令输出或结构化统计按需写入 `evidences/`。

## 完成门禁

- 每一条现状结论都有当前 revision 的可复核命令或文件证据，不沿用本 README 记录的旧观察。
- 方案对每一类文档给出明确的强制章节集合，并说明该集合为何刚好够用。
- 明确列出现有文档中不满足新方案的部分及其处理方式，不留下需要实施者自行选择的空白。
- 未运行或未授权的项目标注为未验证，不以静态阅读代替执行结果。

## 固定依据与非目标

- 触发依据：本轮把 `ui.component-contracts` 从 `docs/specs/ui/` 改写并移动到 `docs/standards/code/components.md` 时暴露的模板失配。
- 相关文件：[`docs/specs/TEMPLATE.md`](../../../../../docs/specs/TEMPLATE.md)、[`docs/specs/README.md`](../../../../../docs/specs/README.md)、[`docs/standards/code/README.md`](../../../../../docs/standards/code/README.md)、[`docs/standards/code/components.md`](../../../../../docs/standards/code/components.md)。

本 Task 不修改检查器、不改动 `docs/specs/TEMPLATE.md`、不批量改写现有规范或标准、不改变 `w00003-neurobook-ui-foundation-migration` 的范围，也不执行 push、PR、远端写入、合并、发布或部署。
