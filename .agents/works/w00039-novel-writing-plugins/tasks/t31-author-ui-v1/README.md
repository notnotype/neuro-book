---
schema: nbook.task/v2
taskId: t31-author-ui-v1
status: active
updated: 2026-11-10
---

# 作者界面第一版

## 目标与范围

在 nb-canon 内核上做作者界面的第一版：样本项目打开后能在应用里看条目、切换位置、看回执与待处理、就地改、记一笔、还原

合同：要新写作者界面的 Spec（`docs/specs/canon/author-ui.md`，S0 写），并改编辑器 Spec 的页面标签（[`workbench/editor.md`](../../../../../docs/specs/workbench/editor.md) 输出 33）；读写世界按 [`canon/project.md`](../../../../../docs/specs/canon/project.md) 的方法表。

## 当前状态

2026-11-10 开发者定“按你的建议分两批开始”，本 Task 恢复：剧情侧（t32 到 t35）已做完，11-04 搁置的理由不再成立。

- **第一批（设定侧）**：范围照下面“第一版拟定的范围”，实施计划见 [`plan.md`](plan.md)（第一版，末尾五项待开发者确认）。确认后先写 Spec（`docs/specs/canon/author-ui.md` 与编辑器 Spec 输出 33 的扩展），与计划一起做设计审查，再实施。
- **第二批（剧情侧）**：剧情容器、剧情表、时间线、知情、伏笔账本、目标表、决策、检查、简报预览。先在 [t16](../t16-plot-workbench-ui/README.md) 出静态稿，开发者定了以后在本 Task 补第二批的计划。
- 前置的缺陷已修：内核来历的初值一步被后面的补丁改到（1a0080305）。

2026-11-04 经 nbdev 新建。同日开发者看过范围后收回提前：时间线还没做好，先不做界面（Work README 决定表）。

第一版拟定的范围：设定容器与条目树；条目页（位置选择、文字与 Component 的 Tab、点值看来历、面板流水与记一笔）；就地改的确认条与保存后的提示；回执页；变更详情页（保存前预览）；底部面板的待处理与改动记录、状态栏计数；星瑕样本项目。前置的平台改动：编辑器现在的标签只能开文件或无参数的页面，要先做“带参数的页面标签”（内核提案“五、影响”里的“带参数的虚拟文档”的最小版）。

开发者 2026-11-10 在 [t16 评审板](../t16-plot-workbench-ui/artifacts/review/index.html)第 7 版答了 `plan.md` 末尾的五项（答复 `20261110T065353529Z-971ce853`）：

| 题 | 决定 |
|---|---|
| `b1-entry-crud` | 做最小的条目新建与删除（推荐项） |
| `b1-restore` | 条目页刷新以后恢复（推荐项） |
| `b1-preview` | 第一批不做预览标签，单击就开正式标签（推荐项） |
| `b1-component-tabs` | **第一批就给人物、面板各写一个专门的界面**（没按推荐的通用字段表） |
| `b1-panel-quiet` | 底部面板默认隐藏，靠状态栏“待处理 N”打开（推荐项） |

设计审查（2026-11-10，Claude Sonnet，审计划第二版与 Spec 草稿）：35 条（阻断 4、重要 22、建议 9），核实后都成立（[报告](evidences/design-review-sonnet.txt)、[处理](evidences/design-review-resolution.txt)）。两件大事：

- **计划把内核合同当现成的，实际要补八项**（就地改的预览、回执的“改了什么”、章表、条目树的位置与出场和马甲与总数、来历里每一步的安放与按地址读、情节分页的筛选与倒序、字段声明、语义档的记一笔）。补它们要改内核、世界服务的接口与四份已 implemented 的 canon Spec，是范围的变化，放到 t16 评审板第 9 版问开发者（`b1-kernel-gaps`：补还是收窄，推荐补）。
- **带参数的页面标签比计划写的大**：页面标签只在活动时渲染、没有按标签区分的实例，context 是窗口共用的。改成每个标签自己的实例加一个随标签寿命的状态容器。

Spec 草稿 `docs/specs/canon/author-ui.md` 与 `editor.md`、`docs/specs/README.md` 的改动都还没提交，等 `b1-kernel-gaps` 定了以后与计划第三版一起重写，不照现在的草稿实施。

另：写 Spec 时发现“底部面板默认隐藏”要落在工作台的视图容器合同里（w00026 t24 正在改），本 Task 没动那两份 Spec，放到评审板问由谁加（`b1-panel-default-owner`）。

开发者 2026-11-10 在 t16 评审板第 9 版答（答复 `20261110T081136877Z-57ae1ba0`）：`b1-kernel-gaps` 选“补上这八项，第一批前面加一片内核补口”（推荐项）；`b1-panel-default-owner` 选“让 t24 顺手加”（推荐项，由开发者转告那边；本 Task 在它提供之前按默认显示做）。

S0（2026-11-10）：计划第三版已提交（2ba5231dd）。Spec 草稿写在主工作区、**未提交**：四份内核 Spec 的补口条目（`canon/project.md` 方法表与输出 28 到 32、`revisions.md` 输出 22、23 与 18 末句、`model.md` 输出 37、`components.md` 输出 21）、重写的 `canon/author-ui.md`、`workbench/editor.md` 输出 33 的“带参数与可恢复的页面”、`workbench/commands.md` 的域词表、`docs/specs/README.md` 的登记行。第二轮设计审查分两路在跑：内核补口派 Opus、界面与编辑器派 Sonnet，说明与报告在 `/tmp/review-w00039-t31-design2/`（处理后存进 `evidences/`）。

第二轮设计审查（2026-11-10）：内核补口派 Claude Opus（15 条：阻断 1、重要 7、建议 7），界面与编辑器派 Claude Sonnet（18 条：阻断 1、重要 8、建议 9）。33 条逐条核实都成立：27 条改了 Spec 与计划，4 条记为已知限制，2 条随改，面包屑交开发者定。报告在 [`evidences/design-review-r2-kernel-opus.txt`](evidences/design-review-r2-kernel-opus.txt)、[`evidences/design-review-r2-ui-sonnet.txt`](evidences/design-review-r2-ui-sonnet.txt)，处理在 [`evidences/design-review-r2-resolution.txt`](evidences/design-review-r2-resolution.txt)。要点：

- 来历改成按步分页（主角字段的来历有几千步，整份返回会超远程预算）；`changedAt` 改成可选、倒扫时间线算。
- 内核补口从八项变成十项：加“重发同一请求 id 返回第一次的结果”（现有缺陷）与事件 `inputChanged`（章表、登记变了而版本不动）。
- “改这一笔”与“把待定的改成生效”不加内核方法，按对那条变更的普通写入做。
- 带视图令牌时不给上级、本体与 `changedAt`：剧情插件按视角过滤时会原样带出。
- 页面标签：实例本来就是每个标签一份，要补的是标签状态（含填了一半的输入）、记着的标题、存盘与恢复只看标签。
- 组件测试用的世界：现有场地在 Vitest 里跑不了，S2 先写 Node 侧的场地。
- 面包屑第一批不做，放到 t16 评审板第 6 轮上问。

计划改成第四版；Spec 草稿相应改过，仍未提交，`bun run docs:check` 通过。同一对象已审两轮，这一轮没有推翻方向的发现，不开第三轮。

开发者 2026-11-10 在 t16 评审板第 10 版批准了第一批的 Spec（`b1-spec-approve`），并定面包屑第一批就做（`r6-breadcrumb`）。Spec 已提交为 planned，连同补上的面包屑：`workbench/editor.md` 输出 33 的 `breadcrumbs(arg)`、`canon/project.md` 输出 33 的上级链 `ancestors`、`canon/author-ui.md` 输出 6、20、21 的面包屑。计划相应改了“一、编辑器”与 K4、E 两片。

## 下一步

1. 建 worktree `.worktree/w00039-novel-writing-plugins`（分支 `feat/w00039-t31-author-ui`），从 K 三片与 E 开工；内核三片做完派 Opus 做实现审查。
2. “底部面板默认不显示”的声明等 w00026 t24；提供之前按默认显示做。
