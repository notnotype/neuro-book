---
schema: nbook.task/v2
taskId: t44-lab-and-component-folders
status: planned
updated: 2026-11-27
---

# Lab 与组件目录的整理（开发者 11-26 第 3 条）

## 目标与范围

canon 的组件按区域分子目录、Lab 左栏跟着目录分组；场景一个状态一个（ConfirmBar 砍到 4 个左右）；场景登记按插件拆开、放进各插件自己的目录；规则写进 Lab 的场景说明与组件规范。开发者 2026-11-26 在 t43 里同意，计划把它拆成单独的 Task，t43 之后做

合同：[`ui/component-lab.md`](../../../../../docs/specs/ui/component-lab.md)（输入边界那一句：场景登记的位置）；产品界面的行为合同不变（组件只换目录）。规则改 [`fixtures/README.md`](../../../../../packages/neuro-book/src/plugins/lab/web/fixtures/README.md) 与 [组件规范](../../../../../docs/standards/code/components.md)。

## 当前状态

2026-11-26 经 nbdev 新建。2026-11-27 开发者定 t45 之后先做它；[plan.md](plan.md) 第 1 稿已写。开发者 2026-11-27 答“要开发者定的”三条，都按推荐：

1. 场景放各插件自己的 `web/lab/`（架构测试开一个口子，只许引 Lab 的 `scene-kit`）。
2. canon 的组件按计划的六组分子目录。
3. `ConfirmBar` 留 5 个场景；这次只精简 canon 的场景，别的插件以后改到哪个组件再照规则收。

设计审查（前端，Claude Sonnet）：15 条（阻断 1、重要 7、建议 7），全部成立。按[处理记录](evidences/design-review-resolution.txt)改成[计划](plan.md)第 2 稿：

- 写清开发代码进入产品插件目录的四处边界：架构测试三条规则、Tailwind 排除、产物标记、门禁扫描根。
- 写清共用支持模块与辅助件的归属。
- 旧路径给草稿 worktree 留再导出。
- 拆总表与挪文件改成可重跑的脚本，应对与 w00055 的冲突。
- 场景快照改为全量 JSON。

“一个状态一个场景”写成“模板里每个分支至少一个场景走到”。照它重选 `ConfirmBar`，是 6 个，开发者批的是 5 个，交付时说明。

工作位置：worktree `.worktree/w00039-novel-writing-plugins`，分支 `feat/w00039-t44-lab-and-component-folders`（从 master `1e60d53ba` 开）。

实施进展：

- S1（分支 `76b70ff34`）：做了以下几件事。
  - `define.ts` 收场景类型。`defineLabFixture` 与收集时核对登记形状，错误以 `nb-lab:` 开头，这也是产物门禁的标记。
  - 新增 `scene-kit.ts`。总表用 glob 收 `plugins/*/web/lab/fixtures.ts`。
  - 架构测试加三条规则，各带正反例。
  - `tailwind.product.css` 排除 `plugins/*/web/lab`。Tailwind 4.3.3 认通配，变异确认：去掉这一行时场景里的探针类进了产物 CSS。
  - 登记门禁的扫描根扩到草稿区与各插件的 `web/lab/`，并新增“每个 `web/lab/` 都有 `fixtures.ts` 且被收到”。
  - 先搬了 image-viewer、html-preview 两个插件的场景。

  验证：
  - 全量场景快照与基线逐字相同（287 个组件、1679 个场景）。
  - typecheck 通过；`bun run build`（含 `check:dist`）通过。
  - 架构测试 8 条、登记门禁 11 条通过；Lab 与两个插件的 dom 测试 64 条通过。
  - 变异检查 4 个全部被拦下：加载路径写错、导出名写错、缺 `fixtures.ts`、夹具自建定宽盒子。
  - `test:affected` 在负载 30 以上时有 7 条超时，单独重跑全过。
- SDK 修正（分支 `9e43a2934`）：t43、t45 给 nb-ui 加的 `TreeSurface`、`TreeToggleOn`、`PopoverReference` 没登记进插件 SDK 的组件子路径，master 上 `sdk.test.ts` 因此失败。这次补上，并写了变更记录。同一文件里 nb-layout 的 `NestedGrid` 快照不同，来自 w00026，没动。

## 下一步

S2：canon 组件分六个子目录。
