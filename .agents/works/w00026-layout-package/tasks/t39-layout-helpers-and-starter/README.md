---
schema: nbook.task/v2
taskId: t39-layout-helpers-and-starter
status: done
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

## 实施记录

worktree `w00026-t39-host-wiring`（分支 `w00026/t39-host-wiring`），基于 master `adf6779dd` 之后：

| 片 | 提交 | 内容 |
|---|---|---|
| 1（含原第 2 片） | `c78f38591` | `usableExtent` 判据；`NestedGrid` 的 `extent` 事件（同步发、卸载前发 null）；`useGridHost`（整包绑定、诊断一个出口），`useGridLayout` 从入口拿掉；Lab 四个网格夹具与工作台 `WorkbenchSurface` 改用它；`NestedGrid.md` 的“接入”重写 |
| 2 | `cd53bd58c` | `useDragSession`；`useSortable`、Lab `DragSessionScene`、`ExplorerTree` 改用它 |

验证：

- 第 1 片：nb-layout 363 与 235 条、应用类型检查通过；`useGridHost` 4 条用例，变异（去掉卸载前发 null、去掉整包里接 `issues` 的处理）都会红。e2e 10 个文件 249 条：238 条过，11 条在负载 18 到 24 时失败（Lab 就绪超时 4、等元素超时 5、实时布局块数 1、动画帧数值 1），单独重跑 11 条全过。
- 第 2 片：nb-layout 363 与 237 条、应用类型检查、Explorer 的 dom 测试 23 条通过；`useDragSession` 2 条用例，变异（去掉销毁）会红。拖动相关 e2e 51 条：48 条过；`lab-drag-session` 83、95 是 Lab 就绪超时（负载 14 到 16），单独重跑通过；`files-explorer` 634 是原有失败（菜单项被盖住 2 个），t39 分支起点与 t35 开工前的 `7d92146ef` 上同样失败。

收口（2026-11-19）：

- 把 master（`afb78ff51`）并进分支，合并提交 `261c29729`，没有冲突；带进来的 Lab 剧情夹具改用 `provideHostText`，与本 Task 的改动不相交。合并后应用类型检查（后端、web、浏览器测试三份）通过。
- `test:affected --since master`（合并前，负载 43 到 50）：vitest 942 条里 2 条失败、1 个文件的钩子超时，bun 3703 条里 38 条失败。逐条归类：
  - 负载：服务端与 Agent 的真实子进程用例 33 条（13 个文件，5 秒超时或子进程在启动中被结束）、`architecture`、`layout-constraints`、SDK 的 `pack` 一条与 `third-party-text`（构建超时）。负载降到 4 后单独重跑：和 nb-layout 有关的四个文件、SDK 两个文件通过，子进程那批 13 个文件 300 条全过。
  - 原有失败：SDK 组件清单缺 `ImagePreviewDialog`（master `e5397b32e` 上同样失败，别的 Work 引入）。
  - 分支起点的问题：markdown 的两条 dom 测试（`PromptEditor` 挂上、小块）与内置插件清单缺 `nbook.stickers`，在分支上单独重跑仍失败，同一时刻 master 上通过；并入 master 后在分支上通过，所以不是本 Task 引起的。

## 实现审查

Claude Sonnet（[`evidences/impl-review.txt`](evidences/impl-review.txt)），审查 worktree 固定在 `261c29729`，diff 是相对 master `afb78ff51` 的净改动（20 个文件）：7 条，阻断 0、重要 1、建议 6，都成立，修正单独提交：

| 条 | 内容 | 处理 |
|---|---|---|
| 1 | 输出 144 的“同步发”“两轴变了才再发”没有测试，改回异步不会红 | `NestedGrid.dom.test.ts` 加一条：观察器回调返回时监听已拿到新值，两轴不变不再发；把 `flush: "sync"` 去掉会红 |
| 2 | 卸载时先发 null 再收尾手势，宿主的监听抛出会跳过收尾 | 先 `scope.dispose()` 再发 null |
| 3 | `useGridHost` 的选项透传与 getter 没有用例 | 加三条：`disabled` 与 `contextKey` 用 getter（换键后旧提交 `stale-context`）、`grid` 换实例重算、`onApplied` 抛出给 `notify-failed`；审查者列的三个变异都会红 |
| 4 | “选项只读一次”用例空过，输出 19 的抛错没有用例 | 加两条：选项读的 ref 变了不重建（改成 `watchEffect` 会红）、`createOptions` 抛出交给应用的错误处理、没有会话 |
| 5 | `usableExtent` 的类型谓词把零尺寸收窄成 null | 改返回 `boolean`，调用处自己判 null |
| 6 | `usableExtent` 插在 `readExtent` 与它的注释之间 | 挪到 `readExtent` 之后 |
| 7 | 文档与注释残留 | 夹具头注释、Lab 登记注释改成 `useGridHost`；`NestedGrid.md` 的“量到 0 高”注释改成同输出 146；补回 `useLayoutExtent` 一句；`WorkbenchSurface` 用 `GridHostIssue`、删多余空行；`DragSessionScene` 读不到滚动容器时报错，不建没有边缘滚动的会话。Spec 里 `useGridLayout` 的三处说法在合入后晋升时改 |

## 合入

2026-11-19：修正提交 `640226453`（单元测试、类型检查通过；Lab e2e `lab-drag-session`、`lab-grid-structure` 33 条：19 条在负载 16 到 21 时等 Lab 就绪超时，单独重跑全过）。再把 master 并进分支两次（只带进别的 Work 的插件与文档，与本 Task 不相交；合并后 SDK、内置插件清单、Explorer 的 dom 测试、nb-layout 243 条、应用类型检查通过），快进合入 master `a5de33888`，删掉 worktree `w00026-t39-host-wiring`、`review-t39-impl` 与分支。

## Spec 晋升

2026-11-19：`ui/nested-grid` 输出 144 到 146、`ui/layout-drag` 输出 18、19 晋升 implemented；`useGridLayout` 的三处说法（输出 139 的出口、失败 6、实现合同）改成 `useGridHost`。

逐句核对（Claude Sonnet，[`evidences/promotion-check.txt`](evidences/promotion-check.txt)）：28 句，16 句有断言、9 句只有部分、3 句没有。处理：

- 补断言（`ff277aec6`，每条做了变异）：
  - 宿主整个卸载时宿主作用域里的侦听看不到 null；
  - 宽或高为 0 时叶照常挂着、分隔条停用；
  - 只改高也再发；
  - 换根先销毁再建；
  - 根没了与作用域结束时，进行中的一场按 disposed 收尾。
- 改写 Spec 的句子：
  - “布局盒，不含边框与内边距”改成“布局尺寸，不随祖先的变换缩放”（读 `clientWidth`，测试能区分读的是不是变换后的矩形）；
  - “非有限”删掉：量布局尺寸量不到非有限值；
  - “模板里再写一遍会覆盖”删掉：那是 Vue 合并属性的行为，库里没有能违反它的实现，留在 `NestedGrid.md` 的用法约定里；
  - 输出 19 的四个字段的枚举删掉，只留“建好后不再读”（已有断言）。

## 下一步

无。
