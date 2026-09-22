# 通用包测试治理与两领域试点恢复卡

## 当前状态

- Current Task：`t01-product-host-success-research`，所属 Work 通过目录表达；Work 关联 `i193`。
- Legacy 来源：`02-product-host-success-research`，迁移前为 `nbook.task/v1`、`actionIssueId: 193`、`in-progress`。
- 证据阶段已完成：`walkthroughs/001-host-evidence-and-observation.md` 与 `evidences/host-evidence-manifest.json` 已生成。
- 2026-09-11 开发者观察结果（聊天记录转写；模板未逐项填写，Agent 未代填）：开发者已审阅 001 与 manifest，声明"材料已足够详细、无补充观察"。
- `walkthroughs/002-product-decision-brief.md` 已按该声明写成，并在头部记录观察限制（候选与建议基于来源证据 + Leader 研究推论，不含开发者独立旅程观察）。
- 2026-09-11 产品形态变更（开发者）：`neuro-agent-harness` 定位为 NeuroBook 领域 harness（不追求通用）；领域无关能力（append-only session、agent profile 提示词装配 DSL、web 工具、编辑工具等）拆成通用包；本项目只做包与设计；组装方式（自组装 / dsh / Cordis）待讨论。
- 受此影响：`D-PRODUCT-01`、`D-PRODUCT-02` 作废；`walkthroughs/002-product-decision-brief.md` 作废（保留为历史）；001/manifest 保留为背景证据。本 Task 合同由 Leader 按新形态重写，候选问题见 `../../research/2026-09-11-assembly-cordis-vs-harness.md` §6。
- 远端已同步：Issue #193 正文与 `packages/neuro-agent-harness/docs/issue-193-roadmap.md` 已按 2026-09-11 形态更新（授权范围内）。
- 2026-09-11 开发者决定（装配）：领域 harness **自组装**起步；不引入 Cordis/dsh 作为装配层；通用包保持框架中立（Cordis 仅作证据驱动候选，见装配讨论材料 §5）。
- 2026-09-11 开发者决定（抽取源）：通用包**从 NeuroBook 抽**；`packages/neuro-agent-harness` 旧包与产品 `server/agent` 两套代码无关联、谁新谁 bug 少未知，旧包不作为新基线。
- 2026-09-11 开发者决定（目录结构，采纳 Leader 建议）：全部留在本 monorepo；通用包新增 `packages/<领域无关名>/`（同步登记 root `workspaces` 显式列表）；领域 harness **新建包**；旧包冻结、只服务 llmlint，待其退出后处置，暂不抢名字。
- 2026-09-11 开发者决定（本轮范围）：把领域无关能力做成新包（①）；产品 `server/agent` 改为消费新包（②）不在本轮，留给 #117 或单独授权。
- 2026-09-11 开发者决定（新 R1 方向）：研究通用包的**测试治理规范**，以 **SSE 能力**与 **write/edit 通用工具**两个领域为试点；本 Task 合同已据此重写（见 `README.md`）。
- 2026-09-11 开发者输入（测试方向）：采用 **TDD**（先失败测试、后实现；bug 先复现）；测试**只覆盖关键点、不追求数量**；**smoke 测试重要**；**允许测试做真实 LLM API 调用**（DeepSeek，`DEEPSEEK_API_KEY` 记录到 `.env`）。已并入 004 §2 草案与 005 候选。
- 2026-09-11 开发者判断（记录于 `walkthroughs/006-decision-record.md`）：接受 `D-TEST-01` T1；补充规则「**不要 mock LLM API 数据，直接用真实 LLM**」；接受领域级单包 + subpath；SSE 基线取独立包实现。待决：bash 归属、最小抽取 spike 是否单独执行、包名与 scope。

## 恢复顺序

1. [Issue #193](https://github.com/notnotype/neuro-book/issues/193)：公开目标和整体进度。
2. [`packages/neuro-agent-harness/docs/issue-193-roadmap.md`](../../../../../packages/neuro-agent-harness/docs/issue-193-roadmap.md)：非绑定候选阶段；不能执行。
3. [`README.md`](README.md)：current Task 协作合同。
4. 本 Task 产物（存在时读取）：`walkthroughs/004-generic-package-testing-research.md`、`walkthroughs/005-testing-governance-brief.md`、`walkthroughs/006-decision-record.md`。
5. [`docs/testing/README.md`](../../../../../docs/testing/README.md)：仓库测试治理基线，两个试点研究的对齐对象。
6. 存在时读取 current diff；不存在不得推断其内容。

聊天不是执行授权或决定的持久记录。

## 固定输入与 provenance

| 输入 | 固定值 |
| --- | --- |
| Issue #193 revision | `updatedAt=2026-08-26T14:44:10Z`; body SHA-256 `8f12f047d24cc3e24c73a3113e6d61b5e922438fae88fb8dece507780e47f88a` |
| legacy 原始 accepted README revision | `385e49b692d29fb56dba84ea158f839fa636f3b725dd41e9b17160c1315855bb` |
| legacy 修复后 accepted README revision | `88b68203334db53e7e6a476b75058fe34032dd924d0cc742f45f99bf31ec972f`; 接受时间 `2026-08-27T09:29:32+08:00` |
| legacy 接受后执行 revision | `a479c0216298a0f6405a0f37de3d8d9360e7938b1b32785330d3b7565f57c380`（只记录旧运行状态元数据） |
| 仓库代码/文档基线 | `bf07359d3966900ddf9bfc4ad0031fa2b956f29d` |
| 外部来源访问日期 | `2026-08-27`；canonical URL、版本空值规则和覆盖见 manifest |

上述 Task revision 只作 legacy provenance。001 与 manifest 保留生成时的 `02-product-host-success-research` 标识，不回写伪造的新 revision。当前执行以 v2 README、本 context、001/manifest 和后续追加产物为准。

## 失败作业事实

- `R1HostEvidence` 已取消且无输出。
- `R1EvidenceResearch` 因外部服务返回 `524 A timeout occurred` 失败且无产物。
- Leader 随后完成证据阶段；001 与 manifest 是唯一正式证据，不消费失败作业潜在输出。

## 决策与范围

| 决策编号 | 人话问题 | 当前状态 | owner |
| --- | --- | --- | --- |
| `D-PRODUCT-01` | 第一版首先服务哪类宿主？ | `voided`（2026-09-11 形态变更） | — |
| `D-PRODUCT-02` | 第一版怎样才算成功？ | `voided`（2026-09-11 形态变更） | — |
| `D-ASSEMBLY-01` | 装配层归属（自组装 / 薄装配层 / Cordis / dsh） | **已决定**（2026-09-11）：领域 harness 自组装起步；通用包框架中立；Cordis/dsh 仅作证据驱动候选 | 开发者 |
| `D-TEST-01` | 通用包测试治理规范 | `已决定`（2026-09-11）：T1 + 禁止 mock LLM；记录见 006 | 开发者判断；Leader 记录 |
| `D-SPLIT-01` | 通用包清单与粒度 | `部分已决定`（2026-09-11）：领域级单包 + subpath；SSE 基线取独立包实现；bash 归属待定 | 同上 |

本 Task 不决定 Runtime、Session 字段、Store、API、包拓扑、Proposal 或 Spec；只产出测试治理草案与两个领域的试点边界。产品源码、依赖/lockfile、branch/worktree 与远端写入仍不在范围。

## 下一合法动作

本 Task 已完成：决策链闭合（`004` → `005` → `006`），抽取 spike 已执行（`evidences/2026-09-11-extraction-spike-report.md`：RED→GREEN 10/10 测试 + tsc 干净）。后续实现切片见 [`t02-generic-package-first-slice`](../t02-generic-package-first-slice/README.md)（已授权：建包、`workspaces` 登记、`docs/testing` 规范落地）。
