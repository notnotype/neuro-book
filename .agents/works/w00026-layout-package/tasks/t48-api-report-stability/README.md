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

2026-11-22：[计划](plan.md)第 1 稿的设计审查（Claude Sonnet，阻断 2、重要 5、建议 3，[证据](evidences/design-review.txt)）十条都成立，计划要重写。其中一件按推荐先做、记进待确认清单（“待开发者追认”），不停下：

**按推荐先做、待开发者追认的**（与 nb-layout 首发、晋升 `ui/nested-grid`、`ui/layout-drag` 一起交开发者）：插件 SDK（`packages/neuro-book/src/sdk/components.ts`）转出了 nb-layout 的 7 个组件与约 16 个类型，文件头写着“这里每一项都是兼容承诺”，SDK 已经发布；ADR 0054 第 10 条说 nb-layout 只承诺标 `@stable` 的符号，而按映射规则这些名字现在会标 `@experimental`。两个承诺对不上，要选一个：
- 照做：SDK 转出的这些名字在 nb-layout 里标 `@stable`（以 SDK 已经许下的承诺为准；代价是这些名字在 nb-layout 的 0.x 里也不能随便改）。nb-layout 还是 `private`，改回去便宜。
- 另一个方向只有开发者能定：SDK 的承诺对转出的 nb-layout 名字写例外（跟着 nb-layout 的标注走），已经用 SDK 的插件作者会失去原来的承诺。

**第 2 稿要改的**（审查各条的改法都采纳）：
1. 非组件的名字不用类型检查器打印类型，改用 `ts.createPrinter` 打印声明节点本身（结构变化才看得见；打包后的声明里类型、接口、函数是真名）。
2. 不再把 `import("…/shared-xxx").Z` 改写成名字（那是打包器的压缩名）：声明节点打印后引用就是真名，组件部分用入口文件作封闭声明打印。
3. 组件分四段：props、事件（取自 `$emit` 的调用签名）、插槽（含 `panel-${string}` 这样的索引签名）、expose（实例上声明在包里的非 `$` 成员，例如 `NestedGrid` 的 `settleMotion`）；`typeof __VLS_N` 展开打印；透传的 `HTMLAttributes` 单独记一行；默认值看不到，写进限制。
4. 事实改正：`SortableList` 在状态栏设置页（`StatusLinePage.vue`）有使用方；SDK 转出的是 7 个组件加类型，不只 `NestedGrid`。
5. 标注要让 npm 上的使用方看得到：`pack.ts` 生成声明后把标注写成 JSDoc 标签（函数、类型、常量加在声明上，组件加在入口导出的那个 `declare const` 上）；入口清单仍是核对名字的依据。
6. 映射规则写成可判的口径与“名字到 Spec”的表，“全部 `@experimental`”诚实写成“暂缓标注”。
7. 确定性：外部类型去掉 `node_modules` 的绝对路径、排序用码元比较、Vue 版本升级导致的整体变化单独提示。
8. 同名名字在两个入口里的标注要一致；核对去重前的全部行。
9. `api:check` 先自己构建；工具链版本写在报告头但与正文差异分开提示。
10. 补评估 `vue-component-meta`（Volar 一族，专出 props、events、slots、exposed）再决定自写；ADR 第 10 条另两项承诺（主题 CSS 变量、`data-*` 表）没有机检，记进 Work 后续。

## 下一步

第 2 稿之前先补两个探针：`vue-component-meta` 能不能出组件的 props、事件、插槽、expose（含 `panel-${string}` 插槽与 `HTMLAttributes` 透传）；把标注写进声明之后产物与 tarball 是否仍逐字节稳定。然后按上面十条写第 2 稿 → 第 2 轮设计审查。
