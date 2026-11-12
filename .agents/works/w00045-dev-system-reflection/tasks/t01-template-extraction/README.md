---
schema: nbook.task/v2
taskId: t01-template-extraction
status: active
updated: 2026-11-12
---

# 提取项目模板第 1、2 层与反思

## 目标与范围

从 NeuroBook 提取项目模板的第 1 层（骨架）与第 2 层（Skill），并记录提取中看到的体系问题。只读 NeuroBook，不改它的规则与代码；模板写在仓库外的 `~/CodeRepository/agent-project-template/`。

合同：行为合同未变（只读 NeuroBook，不涉及产品行为与 Spec）。

## 当前状态

- 第 1 层：根 `AGENTS.md`（核心规则、触发表、发命令前、授权边界、规则怎么改）、`CLAUDE.md`、`PROJECT-STATUS.md`、`docs/`（真相源优先级与流程、Spec、ADR、提案、编码与仓库流程、测试与验证门禁）、`.agents/works/README.md`（身份、状态、手工领号、记录只放主工作区、本地与入库、模板）。
- 第 2 层：`.agents/skills/` 下 7 个 Skill：implementation-planning、writing-specs、reviewing、diagnosing-bugs、doc-review、autonomous-delivery、task-reflection，加 `.claude/skills` 软链。Spec 模板与 `plan.md` 结构从第 1 层移进对应 Skill，第 1 层只留指针。`design-review`、`ui-development` 依赖 nbdev 与组件 Lab，留到第 5 层。
- 验证：模板内全部相对链接与锚点用脚本解析过，无失效；领号的 git 命令在 NeuroBook 上实跑，取到 `w00044-brand-and-mascot`（本 Work 领号前的最大值）。
- 反思：[reflection.md](reflection.md)，第 1 层 11 条、第 2 层 5 条、实际使用 1 条，每条带证据、模板的处理与给 NeuroBook 的建议。
- 实际使用：模板复制到 pc-notype 的 `D:\CodeRepository\manus`（Manus Studio 的笔试作答目录）。那里的 Agent 没建 Work、把调研写进宿主的 `.work/`，据此补了三处规则（反思第 17 条）并同步过去；那里已有的产出没有动。

## 决定

- 2026-11-12 开发者：第 1 层可以，继续第 2 层。
- 2026-11-12 开发者：`task-reflection`、`autonomous-delivery` 放进模板。
- 2026-11-12 开发者：两层的反思记成 NeuroBook 的一个 Work（本 Work）；模板里不再留反思副本。
- 2026-11-12 开发者：第 17 条的模板修改照做，并把模板同步到 manus。

## 待开发者决定

- 下级 `AGENTS.md`（`docs/`、`.agents/`、`docs/specs/`、`.agents/works/`）留不留：是否为了某个宿主按目录自动加载？没找到写明理由的文档（[reflection.md](reflection.md) 第 5 条）。
- 小能力是否允许精简版 Spec（只要目标、输出、失败、验收四节）。
- 反思里给 NeuroBook 的建议做哪些；做的另建 Task。
- 第 3 层的技术栈：照搬 Bun 与 TypeScript，还是写成与技术栈无关的脚本。

## 下一步

等开发者决定是否提取第 3 层；模板尚未提交，开发者要求时再提交。
