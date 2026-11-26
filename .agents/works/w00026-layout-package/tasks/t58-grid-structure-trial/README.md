---
schema: nbook.task/v2
taskId: t58-grid-structure-trial
status: done
updated: 2026-11-25
---

# 结构操作能试做、树能复制（摩擦第 1 组）

## 目标与范围

nb-layout 加 grid.clone、结构操作的试做或 canSplit、在叶旁插入兄弟、同向拆分并入父分支、深度计法统一、restore 结果不易忽略；示例里的试拆代码随之删短（0.x 不兼容改动）

合同：[`ui/nested-grid`](../../../../../docs/specs/ui/nested-grid.md) 输出 160 到 165，失败 5、失败 7 的 `limit-exceeded` 与 `wrong-sizing`、`not-finite`，验收 7。计划见 [plan.md](plan.md)，探针在 [evidences/](evidences/)。

## 结果

2026-11-25 完成，三片由 coder 子代理实施，主会话审 diff、变基后自己复跑验证并合入 master：

- 拆分：`splitLeaf` 与目标的父分支同向时新叶并进父分支、挨着目标，不新建分支、不加深（输出 160）；`ratio` 可写 `"even"`（输出 161）；保留像素的目标报 `wrong-sizing`（`expected: "weight"`，输出 162）。
- 根不展平：删到、移到根只剩一块保留像素或带收起策略的节点时根分支留着（输出 163）；中间分支照旧展平。
- 层数：结构操作与快照恢复都按根算第 1 层；规模守卫只判这次新造的一处，`createGrid` 建进来的超深树，浅处的操作不再被拒。
- 复制与读档：`grid.clone()`（输出 164）；`restoreGrid(快照, 解析引用, 选项)` 与类型 `GridRestoredGrid`，失败时没有 `grid`（输出 165）；原地 `grid.restore` 保留。
- 使用方：两个示例改用 clone 与 restoreGrid，桌面平铺只调一次 `splitLeaf`；Lab 的 LivePanelsScene 预览改用 `clone()`（顺带保住约束与分隔线宽度）；`lab-grid-structure` 的分隔线选择器从 `a-split:0` 改成 `root:0`。工作台不用网格的结构操作，没受影响（从代码推断，`layout-doc.ts` 头注释改了一句）。
- 版本 0.3.0（包、三个示例的依赖、`bun.lock`），CHANGELOG 写了 4 项不兼容、3 项新增、1 项修复。还没发布：等 t59 合入后一起发。

旧值与新值（`grid.test.ts` 里改的旧用例，它们原来靠同向拆分新建分支）：

| 用例 | 旧 | 新 |
|---|---|---|
| side=before 拆成新分支 | 横向拆，宽 1001 下 174.75 / 524.25 | 改成竖向拆，高 100 / 300 |
| 往返 | 横向拆，added 349.5 | 竖向拆，added 高 300，拉到 250 / 350 |
| 上限 | 256 节点时横向拆被拒；深度 16 横向拆被拒 | 255 节点时竖向拆因节点数被拒、横向并入通过；深度 16 竖向拆被拒、横向并入通过 |
| 快照深度 | 17 层能恢复、18 层拒 | 16 层能恢复、17 层拒 |

示例测试两处 `"right"` 改成 `"bottom"`，桌面示例一条的标题改成“三块平分”。

- 变异检查（coder 做）：同向也新建分支红 7 条，`"even"` 当 0.5 红 3 条，去掉根不展平的例外红 1 条，clone 共用整棵树红 1 条，快照从第 0 层起算红 1 条；`copyTree` 共用 `collapse` 对象没红：写入都是整个替换 `collapse`，从外面观察不到，没加查实现的断言。
- 主会话复跑（变基后）：nb-layout 测试（683 加 vitest 363）、typecheck、`api:check`，nb-workbench-layout、nb-story、应用的 typecheck，`docs:check`、`governance:check`，应用的两份构建都过；负载 7 时 nb-layout 示例 e2e 48 passed、Lab 两个文件 22 passed，与 coder 的改前基线一致。`release:smoke` 由 coder 在干净工作树上跑过（三个示例照第三方装法装上 0.3.0，过），变基后没重跑：master 新增的提交没碰 nb-layout，发布前随 t59 再跑。
- `test:affected`（coder 跑，`bun.lock` 改了一行，选中全部包）4 项失败：dev-panel 的 herdr-live、nb-history 的性能 smoke、应用的 `ProvidersPage.dom.test.ts` 单独重跑都过，归负载；`scripts/release/packages.test.ts` 在 vitest 下用了 Bun 专有的 `import.meta.dir`，master 上同样失败（由 c88a69f5b 引入），不在本 Task；它要查的发布依赖 coder 手动跑过 `checkReleasePackages`，返回空。

与计划的偏离：

- `GridRestoredGrid` 定义在 `grid.ts`：放进 `grid-types.ts` 会循环导入。
- 同向并入时目标换成新对象、不原地改，与新建分支那条路一致。
- 失败码表多一条用例，锁住 `wrong-sizing` 先于方向与 id 检查。
- README 的新表格行写 `grid.layout().issues`：`readme.test` 会把表格里的裸标识符当成导出名核对。

没做：开发服务上没手动点过 Lab 场景（e2e 是生产构建）；真实工作台没在浏览器里看过（从代码推断不受影响）。

## 历程

2026-11-25 计划由规划子代理起草（先跑探针），主会话核对后定稿，待确认按推荐做、记进[待确认清单](../../pending-confirmations.md)；Spec 的 planned 条目先写在 master。编码派 coder 子代理，分支 `w00026/t58-grid-structure`，已合入并删除。t52 交开发者的“拆保留像素的叶要不要失败”在这里定了（失败）。实现审查并入 t56 到 t59 结束后的一次 omp 批量审查。
