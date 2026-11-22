---
schema: nbook.task/v2
taskId: t48-api-report-stability
status: active
updated: 2026-11-22
---

# API 报告 CI 与 @stable、@experimental 标注

## 目标与范围

公开入口出 API 报告并在 CI 里比对，全部公开符号标 @stable 或 @experimental（提案第二档第 2、3 项）；报告与导出名清单测试的分工、与 @stable 范围的对应在这个 Task 定。

合同：行为合同未变（不改 Spec；标注是包的发布承诺，写在包 README 与 [ADR 0054](../../../../../docs/adr/0054-nb-layout-general-library.md) 第 10 条）。

## 当前状态

2026-11-22：[计划](plan.md)第 2 稿的设计审查（第 2 轮，Claude Sonnet，重要 7、建议 3，[证据](evidences/design-review-2.txt)）十条都成立。其中两条牵涉 nb-layout 对外承诺哪些名字，**停下等开发者**；同一对象最多审三轮，第 3 轮要先有这两个决定。

**要开发者定的**（与 nb-layout 首发、晋升 `ui/nested-grid`、`ui/layout-drag` 是同一组）：
1. **`@stable` 由谁定**（第 2 轮第 4 条）：第 2 稿是“插件 SDK 转出了，nb-layout 就必须标 `@stable`”，等于应用里加一行转出就替 nb-layout 在 npm 上许下承诺。推荐改成 nb-layout 自己维护一份显式的稳定清单；SDK 转出的名字必须在清单里，否则 SDK 本地再包一层，或请开发者把它加进清单。
2. **稳定的范围要不要连核心类型一起**（第 2 轮第 2 条）：SDK 转出的 7 个组件，签名里引用了 23 个核心类型（`GridNode`、`GridLayoutResult`、`GridRect`、`GridContentInput` 等）。只标组件 `@stable`，承诺是空的；连这 23 个一起标，等于现在就冻结网格的核心模型，而 `ui/nested-grid` 还是 `planned`、当天还改了三次行为。三种做法：
   - 现在全部 `@experimental`，包括 SDK 转出的（SDK 那边的兼容承诺另写例外）；nb-layout 1.0 或晋升 Spec 时一起定；
   - SDK 转出的组件加上它们引到的类型（约 46 个名字）现在就标 `@stable`；
   - 先晋升 `ui/nested-grid`，再按闭包标。
   我的倾向是第一种：nb-layout 还没发过，0.x 期间整体 `@experimental` 最诚实；SDK 的承诺本来就是应用对插件作者许的，可以在 SDK 里写明“转出的 nb-layout 名字跟着 nb-layout 的标注走”，代价是已经用 SDK 的插件作者要知道这一点。

**第 3 稿照改的**（不需要开发者定）：可达但没导出的类型也进报告并告警（第 1 条）；`@stable` 的签名闭包机检（第 2 条，按开发者定的范围）；工具链版本记全（vue-tsc 与它的 TypeScript、报告脚本的 TypeScript、vue-component-meta、rolldown-plugin-dts、vue），头与正文分开比（第 5 条）；非组件的标注写在源码声明的 JSDoc 上，只有 7 个组件走入口行尾加 `pack.ts` 后处理（第 6 条）；组件的插槽、透传、`inheritAttrs: false`、事件名的取法各写一句并各配样本（第 7 条）；`api:check` 按 `@stable` 与 `@experimental` 分级，接进本地门禁（第 8 条）；组件段与产物声明交叉核对、打印保留 `@deprecated`（第 9 条）；删掉压缩别名还原，改成“不含 `$N` 与 `__VLS`”的断言（第 10 条）；映射规则第 2 条删掉或补名字到 Spec 的表（第 3 条）。

此前：第 1 轮设计审查（Sonnet，阻断 2、重要 5、建议 3，[证据](evidences/design-review.txt)）都成立，改出第 2 稿；探针见[证据](evidences/probes.txt)。

## 下一步

开发者定上面两件（连同首发、晋升 Spec）→ 第 3 稿 → 第 3 轮设计审查（最后一轮）→ 实施。
