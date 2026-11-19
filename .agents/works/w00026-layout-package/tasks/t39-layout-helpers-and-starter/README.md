---
schema: nbook.task/v2
taskId: t39-layout-helpers-and-starter
status: active
updated: 2026-11-19
---

# 宿主接线：useGridHost 与 useDragSession

## 目标与范围

按提案第一档第 5 项“库里补的小东西”的前两条：`useGridHost`（把 `NestedGrid` 要的几样打成一包，`NestedGrid` 量一次容器交给宿主，宿主不再另量）与 `useDragSession`（根出现时建会话，换根或作用域结束时销毁）；迁移工作台与 Lab 的五个宿主、三个拖动会话的调用方，验收就是盘点里列出的重复接线消失。新 API 的形状先写 Spec。

2026-11-19 拆分：收起与展开入口、L2 的意图回写拆到 [t40](../t40-collapse-and-intent-writeback/README.md)，拖不动时报错拆到 [t41](../t41-config-error-reporting/README.md)，README 起步与三份短文档拆到 [t42](../t42-readme-starter/README.md)：几块的形状互相独立，合在一份计划里送审会一轮轮互相牵扯（t34 的教训）。

合同：`NestedGrid` 新增 `extent` 事件，新增 `useGridHost`、`useDragSession`；已有行为不变。改 [`ui/nested-grid`](../../../../../docs/specs/ui/nested-grid.md)、[`ui/layout-drag`](../../../../../docs/specs/ui/layout-drag.md)。

## 当前状态

2026-11-19 经 nbdev 新建。盘点（Claude Haiku）见 [`evidences/inventory.txt`](evidences/inventory.txt)：五个宿主里 `:node`、`:layout`、`:revision`、`:on-gesture-commit` 一字不差，`contextKey` 同一个值写两到三遍；`NestedGrid` 没有 `extent` 事件，宿主量外层、`NestedGrid` 再量自己的根；`useGridLayout` 已返回 `node`、`layout`、`revision`、`invalidate`、`onGestureCommit`，接近提案说的 `useGridHost`；`createDragSession` 三处调用方是同一段挂载建、卸载销毁的样板，只有 `useSortable` 处理换根。

## 设计审查

第 1 稿（Claude Sonnet，[`evidences/design-review.txt`](evidences/design-review.txt)，含时序实测与站在使用方位置写的接入草稿）：12 条，阻断 0、重要 6、建议 6，都成立，改成第 2 稿：

| 条 | 内容 | 处理 |
|---|---|---|
| 1 | “卸载发 null”照计划写的同步 watch 做不到：卸载时 watcher 先停 | `NestedGrid` 卸载前显式发 null |
| 2 | `useDragSession` 的选项函数没有根参数、只读一次却不像只读一次 | 改成 `createOptions(root)`，名字与注释写明建时读一次 |
| 3 | 会话在 `onMounted` 里还是 null，`ExplorerTree` 的 `watch` 要改 | 迁移写明改法；验证加 `ExplorerTree.dom.test.ts` |
| 4 | “两者并存”与迁移后没人直接用 `useGridLayout` 自相矛盾 | `useGridHost` 唯一，`useGridLayout` 降为内部 |
| 5 | `bindings` 与模板里同名属性静默覆盖；`disabled` 只判 null | 写明只经选项给；可用尺寸判据与空布局共用 |
| 6 | 工作台转发丢了 `immediate`，同步链没有验收 | 保留 `immediate`；验收补同步链 |
| 7 | `DragSession` 只有两个类型参数 | 改正 |
| 8 | `useDragSession` 没消掉三处 `state` 样板 | 同时返回 `state` |
| 9 | SDK 没提 | 不进 SDK（SDK 没有 `createGrid`，插件建不出网格），开放网格宿主另记 |
| 10 | 风险方向反了，漏写承载盒前提与 `v-if` 死锁 | 以 `NestedGrid` 的盒为准；前提写进 Spec 输出 146 |
| 11 | `useSortable` 的迁移描述自相矛盾 | 留一个 `watch(root)` 管捕获监听与收尾 |
| 12 | 验收映射缺 Spec 编号 | 先写 Spec（`ui/nested-grid` 输出 144 到 146、`ui/layout-drag` 输出 18、19，planned）再映射 |

第 2 稿（第二轮，[`evidences/design-review-r2.txt`](evidences/design-review-r2.txt)）：7 条，阻断 0、重要 1、建议 6，第一轮的处理都到位；改成第 3 稿，不再送审，实现审查兜底：

| 条 | 内容 | 处理 |
|---|---|---|
| 1 | 验收有三处用真实运行时写不出来（布局事实、改尺寸、没有的 Surface dom 测试） | 输出 146 只写可判定的一半；尺寸变化经 Lab 读数在真实浏览器验；工作台同步链靠 `lab-workbench-surface`、`workbench-shell` 等 e2e |
| 2 | “同名属性覆盖”与实测不符：提交处理会合成数组出错 | Spec 输出 145 改写 |
| 3 | `useDragSession` 的“挂载回调里还是 null”只对模板 ref 成立；选项一句不可判定 | 输出 18、19 改写，列出建时定死的字段与抛错时的结果 |
| 4 | 输出 144 与 143 写在同一行 | 补换行 |
| 5 | 卸载时谁收得到 null 没写 | 写进输出 144 与计划 |
| 6 | 输入三种形状、`contextKey` 必填、诊断两个出口；“组合式函数加整包绑定”而不是包装组件的上游选择没记理由 | 输入都收值、ref 或 getter；`contextKey` 可省；诊断合成一个出口；上游选择写明理由，交开发者（待确认清单） |
| 7 | 文档清单漏项；可用尺寸判据有三份 | 补全清单；`usableExtent` 一处，三处共用 |

## 下一步

计划见 [`plan.md`](plan.md)（第 3 稿）。Spec 已写（planned）。

1. 在 worktree `w00026-t39-host-wiring` 按三片实施；基线已跑（构建与三个 e2e 文件通过）。
