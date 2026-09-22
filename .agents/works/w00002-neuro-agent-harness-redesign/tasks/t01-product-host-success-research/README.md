---
schema: nbook.task/v2
taskId: t01-product-host-success-research
role: tasker
---

# 通用包测试治理与两领域试点（SSE、write/edit）

> 目录 ID 保留迁移历史（原 legacy `02-product-host-success-research`）；本文件于 2026-09-11 产品形态变更后重写。旧问题 `D-PRODUCT-01/02` 已作废，旧产物保留为历史（见文末）。

## 当前状态

- 2026-09-11：决策链已闭合——`004` 研究材料、`005` 简报、`006` 记录均已产出；`D-TEST-01` 接受 T1（含"禁止 mock LLM、真实调用"规则），`D-SPLIT-01` 接受领域级单包 + subpath，SSE 基线取独立包实现。
- 待决：真实 LLM 调用预算；`agent-shell` 与 `file-tools/tools` 的 seam 形状。bash 归属已定（B：单独成包 `@notnotype/agent-shell`，见 006 补充决定）。
- 2026-09-11：抽取 spike 已执行（`evidences/2026-09-11-extraction-spike-report.md`：RED→GREEN，10/10 测试通过、tsc 干净）；建包与规范落地移交 [`t02-generic-package-first-slice`](../t02-generic-package-first-slice/README.md)；本 Task 视为完成。

## 目标

1. 形成「领域无关通用包」的**测试治理规范草案**：测试分层、每个包的必测合同面、测试位置与命名、临时根与 fixture 策略、跨平台约束、CI 与证据门禁、未运行项记录方式。
2. 以两个试点领域给出可执行样例与边界判断：
   - **SSE 能力**：事件流帧、序列化、顺序保证、恢复/重连、取消与错误关闭；
   - **write/edit 通用工具**：写入/编辑语义、原子性、失败模式、路径与 workspace 边界、审批耦合。
3. 输出足以支撑 `D-TEST-01`（测试治理规范）与 `D-SPLIT-01`（两个试点包的边界与粒度）的决策简报。

事实来源以 NeuroBook 产品实现为主（抽取源）；`packages/neuro-agent-harness` 旧包只作对照——两者无关联，质量未比较。

## Agent 工作

1. 收集两个领域的实现/测试/合同证据（固定来源清单：路径、规模、读取日期），区分代码事实与文档声明。
2. 起草测试治理规范草案：分层边界、必测面、放置与命名、临时根与 fixture、跨平台、CI 与证据要求；对齐 `docs/testing/README.md` 的既有治理，但不把 `nbook/*` 别名等产品内部机制当作通用包前提。
3. 两个领域各一份试点：现状、领域耦合清单、领域无关化后的合同草案、测试矩阵、至少一个示例测试设计（只写进本 Task 产物，不落到源码）。
4. 写决策简报（候选、建议、选错代价、可逆性、证据缺口）；开发者判断后由 Leader 写决定记录。

## 开发者参与

开发者对以下内容给出明确判断（或判定 `evidence-insufficient`）：

- 测试治理规范草案是否成立（`D-TEST-01`）；
- SSE 与 write/edit 两个包的边界与粒度（`D-SPLIT-01` 试点部分）；
- 规范与现有 `docs/testing/` 治理的关系（扩展、并入还是并列）。

开发者不审批 Skill、验证命令或 Task 状态。

## 任务产物

- `walkthroughs/004-generic-package-testing-research.md`：测试治理规范草案 + SSE 试点 + write/edit 试点（含来源清单与未检查项）。
- `walkthroughs/005-testing-governance-brief.md`：决策简报（`D-TEST-01`、`D-SPLIT-01` 试点部分）。
- `walkthroughs/006-decision-record.md`：开发者判断后的持久记录。
- `evidences/**`：必要的结构化证据。

## 允许文件

- `walkthroughs/004-generic-package-testing-research.md`、`walkthroughs/005-testing-governance-brief.md`、`walkthroughs/006-decision-record.md`
- `evidences/**`（本 Task 目录内）
- README 与 `context.md` 由 Leader 维护，Tasker 不修改。

## 完成门禁

- 测试治理规范草案覆盖：分层、必测合同面、放置与命名、临时根/fixture、跨平台、CI 与证据、未运行项记录；每节有来源引用或明确标注为研究推论。
- 两个试点各有：现状事实、领域耦合清单、合同草案、测试矩阵、示例测试设计。
- 决策简报与决定记录齐备；`D-TEST-01`、`D-SPLIT-01`（试点部分）均有开发者明确判断，或 `evidence-insufficient` 加精确缺口。
- `docs-check`、`governance-check`、`diff-check` 对 current revision 有真实结果；未运行项有真实原因。

## 决策与权限边界

本轮只做包与设计：不修改产品源码、不改依赖/lockfile、不建 branch/worktree、不跑真实 Provider/Model、不写 Proposal/Spec、不接入 NeuroBook 产品。产品 `server/agent` 改为消费新包不在本轮范围。

恢复所需最小集合：本 README、`context.md`、Issue #193、`../../research/2026-09-11-assembly-cordis-vs-harness.md`、`docs/testing/README.md`，以及存在时的 004/005/006。

## 历史产物（保留，不删）

- `walkthroughs/001-host-evidence-and-observation.md`、`evidences/host-evidence-manifest.json`：旧形态的背景证据。
- `walkthroughs/002-product-decision-brief.md`：**已作废**（旧形态的宿主三选一前提），不得据其做决定。
