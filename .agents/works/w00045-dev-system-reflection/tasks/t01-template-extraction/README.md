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
- Spec 写法补齐（开发者 2026-11-12 认为 NeuroBook 的 Spec 写得好，要求模板跟上）：`docs/specs/README.md` 补回九节说明、`planned` 当黑盒、待晋升、术语表、Bug 与重构、完成条件；`writing-specs` 补回两个时序例子并加范例目录 `references/`，放 `agent/run-guards.md` 与 `workbench/quick-open.md` 两份原文（去掉内部链接），README 写明各学什么、quick-open 哪几处不合现行规则。机检那部分留到第 3 层。
- `design-review` 通用版：去掉 nbdev 与组件 Lab，评审板是 Task 的 `artifacts/review/index.html`、题带题号，开发者在会话里按题号答复、Agent 把决定写进 Task README；附评审板模板 `references/review-board.html`（无头 Chrome 渲染核对过）。原 Skill 里依赖 nbdev 与 Lab 的部分仍归第 5 层。
- `writing-proposals`：NeuroBook 没有这个 Skill，按 w00043 t01 的实际做法新写；`docs/README.md` 的流程改为方向 Task 在前（反思第 18 条）。
- 规范拆进模板：界面规范拆成模板的 `docs/standards/ui/` 六份（设计语言、工程合同、组件合同、状态与视图、踩过的坑 64 条、README），去掉 nb-ui 类名、nbook 取值、Work 编号与日期，只留判据与理由；另补 `languages/typescript.md`、`scripts.md`、`contracts.md`、`data-formats.md`、`prompts.md`，测试规范加“浏览器与界面测试”（UI 验收分档、e2e 写法）；新增通用版 `ui-development` Skill。模板内链接与锚点用脚本解析过，除 Work 模板里本来就是占位的一条外无失效。
- 反思：[reflection.md](reflection.md)，第 1 层 11 条、第 2 层 5 条、实际使用 1 条、写提案 1 条、规范拆分 4 条，每条带证据、模板的处理与给 NeuroBook 的建议。
- 实际使用：模板复制到 pc-notype 的 `D:\CodeRepository\manus`（Manus Studio 的笔试作答目录）。那里的 Agent 没建 Work、把调研写进宿主的 `.work/`，据此补了三处规则（反思第 17 条）并同步过去；那里已有的产出没有动。

## 决定

- 2026-11-12 开发者：第 1 层可以，继续第 2 层。
- 2026-11-12 开发者：`task-reflection`、`autonomous-delivery` 放进模板。
- 2026-11-12 开发者：两层的反思记成 NeuroBook 的一个 Work（本 Work）；模板里不再留反思副本。
- 2026-11-12 开发者：第 17 条的模板修改照做，并把模板同步到 manus。
- 2026-11-12 开发者：补齐 Spec 规则、加范例，并同步到 manus；“模板做上游”建成 [t02](../t02-template-as-upstream/README.md)。
- 2026-11-12 开发者：做 `design-review` 通用版，连同 `autonomous-delivery` 同步到 manus。manus 的 `AGENTS.md` 已被那边填写过，只在原处替换了触发表的一格，没有整文件覆盖；`autonomous-delivery` 在第一次复制时已同步，哈希一致。
- 2026-11-12 开发者：新增 `writing-proposals`、流程改为方向 Task 在前，并同步到 manus。manus 的 `AGENTS.md`、`docs/proposals/README.md` 已被那边改过（项目化、登记了它的提案），只在原处替换改动的句子；`TEMPLATE.md` 同步后被那边改写成“来源与适配说明”，保留了这次的改动。
- 2026-11-12 开发者：把项目规范去 NeuroBook 化拆进模板（点名 UI 规范），并同步到 pc-notype。

## 待开发者决定

- 下级 `AGENTS.md`（`docs/`、`.agents/`、`docs/specs/`、`.agents/works/`）留不留：是否为了某个宿主按目录自动加载？没找到写明理由的文档（[reflection.md](reflection.md) 第 5 条）。
- 小能力是否允许精简版 Spec（只要目标、输出、失败、验收四节）。
- 反思里给 NeuroBook 的建议做哪些；做的另建 Task。
- 第 3 层的技术栈：照搬 Bun 与 TypeScript，还是写成与技术栈无关的脚本。

## 下一步

等开发者决定是否提取第 3 层；模板尚未提交，开发者要求时再提交。
