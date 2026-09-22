# t37 两轴几何与快照：最终实现交接

2026-09-16 12:53：五项修复及 Leader 12:50 指出的分支留白消费遗漏均已完成聚焦验证，等待 Leader 统一门禁与复核。此前的完成判断漏掉了分支容器仍被 CSS 拉满的问题，以本次追加证据为准。沿用分支 `refactor/w00003-nb-ui-adoption`，基线 `7a5d04de`，未提交。ui.nested-grid 仍为 planned。

## 12:53 分支留白补修

只修改 WorkbenchBranch.vue、workbench-grid-consumers.test.ts 和本报告，共 3 文件。数学算法、主动字段传递、其它消费者与 Splitter 内部未改。

WorkbenchBranch 根容器去掉 h-full/w-full，宽高直接使用 layout.sizes[node.id] 的 px，并禁止 flex shrink 二次改变原语尺寸。内部百分比面板因而使用原语已分配的实际空间，不会将未吸收余量重新分给触顶的叶。

确定回归：父容器主轴 500px，两叶主轴 max100，交叉轴 max150：

| 方向 | sash | 原语分支尺寸 / 根 DOM style | 主轴留白 |
|---|---|---|---|
| 横向 | 0px | width 200px、height 150px | 300px |
| 横向 | 1px | width 201px、height 150px | 299px |
| 纵向 | 0px | width 150px、height 200px | 300px |
| 纵向 | 1px | width 150px、height 201px | 299px |

四例均验证原语的未吸收诊断、Splitter 两叶 default/min/max=50%、实际 sash 配置；父容器主轴缩小为 150px 后，根样式更新为 150×150px。

验证 cwd 为绝对路径 `C:/Users/notnotype/Documents/CodeRepository/GithubProjects/neuro-book/.worktree/w00003-neurobook-ui-foundation-migration/packages/neuro-book`：

- 修复前：`bun run test app/components/workbench/workbench-grid-consumers.test.ts`，exit 1，4 failed / 3 passed；失败为根元素缺少 200px/201px/150px 的宽高样式。
- 修复后：`bun run test app/components/workbench/workbench-grid-consumers.test.ts app/components/workbench/workbench-branch-layout.test.ts`，exit 0，2 文件 9 passed。
- `git diff --check -- packages/neuro-book/app/components/workbench/WorkbenchBranch.vue` 在绝对 worktree 根执行，exit 0。

这是实际 Vue 挂载后的 DOM style 与 Splitter 配置证据；jsdom 不提供真实浏览器盒布局，未声称 getBoundingClientRect 或视觉验收通过。本轮未运行全包命令，也未重跑数学验证；Leader 正在执行的浏览器门禁/typecheck 不受本 Task 并行干扰。下文 85 用例是上一轮的历史聚焦记录，本次新增 4 例并复跑上述 9 例。

12:55 类型反馈补修：同一测试文件新增 `sizeOf(layout, id)` fixture helper，缺节点时明确抛错再返回 GridExtent；用具名目标值替代数组索引读取。已处理 Leader 12:53 提供的 TS2532/TS18048 源头，没有忽略诊断、非空断言或双重断言。再次执行上面的两文件聚焦命令，exit 0，9 passed（12:54:34）；本 Task 未运行全包类型检查，正式类型复核仍由 Leader 执行。没有编辑 storage-context.test.ts。

## 五项修复与实证

| 问题 | 当前结果 | 证据 |
|---|---|---|
| 混合上下界分配溢出或少分 | 按夹取候选总量判断水位方向，只固定不会解除的一侧边界；没有事后缩放合法分配 | 原反例得到约 [17.142857,80,2.857143]；追加反例意图 [80,15,5] / min [0,30,0] / max [20,100,10] 得到 [20,70,10]，覆盖两轴、交换顺序、sash、零权重及 resize 补偿 |
| editor/right 选错主动节点 | WorkbenchBranch 一次传递全部子节点基线、目标和完整 active 列表；Shell 保存主动侧栏字段 | Shell 真实 SFC 测试：右栏命中目标、左栏偏好保留；远端补偿不写入左栏偏好 |
| viewport 手势无法逆算意图 | 用未触界节点确定比例，保留仍匹配目标的旧权重，发布前重新布局验证；no-op 保持快照 | 意图 [100,100,100]、宽 600、a.max=100：基线 [100,250,250]，目标 [100,270,230]，意图得到 [100,108,92]，回显命中目标；下限触界与零权重也覆盖 |
| 降级后 Renderer 重新夹回 min | WorkbenchBranch 直接消费 grid 有效交互约束与实际 sash；过期或取消手势不提交 | 501px 容器、两叶 min300、sash1，Splitter 收到两叶 default/min/max=50%；真实 Branch SFC 测试通过 |
| 泛型对象 ref 塌成字符串 | 沿用中间稿的 encodeRef 显式稳定编码合同并补齐公开文档；两个对象按不同 key 往返 | 原语对象 ref 往返用例通过；字符串消费者沿用默认编码 |

## 当前消费合同

- GridNode.size 是意图；layout(container) 只返回呈现、有效约束、实际 sash 与诊断，不改快照。
- resizeBranch(branchId, axis, baseline, target) 接受全部直接子节点当前呈现 px（不含 sash），完整验证后一次发布。错误轴、缺节点、非有限值、不守恒、过期基线、越界或不可逆目标均失败且不改树。
- 宿主捕获手势开始时的布局，窗口或上下文变化后旧手势失效。Shell 和 Spike 均消费同一原子入口，不逐面板 resize。
- Shell 的产品偏好仍是左右侧栏绝对 px，只有 active 侧栏保存目标；当前呈现保留原语反解结果，自己的 store 回写不会立即重建造成回弹。外部偏好、容器和显隐变化时按产品模型重建。隐藏叶重新展开的约束取当前默认拓扑，避免从已经裁掉隐藏叶的树读取出 0 上限。
- Spike 实例先加载当前宿主约束，再 restore v2；可见树单独结算并渲染，手势只合回可见子节点的意图。隐藏叶、其它分支和另一轴保留原值。
- v2 仅存稳定结构/ref 和两轴意图；v1 和未知高版本明确拒绝，未知引用过滤单独报告。后续插件宿主仍须保留原件并合成保存；本 Task 不把过滤后 serialize 视为无损备份。
- 公共 API 与兼容规则见 packages/nb-ui/src/components/layout/grid.md；Spec 只补充本切片实现事实，保持 planned。

## 本轮实际编辑文件

共 15 文件（在接手的 dirty 中间稿上继续编辑；不是整个 Work 的文件数）：

1. packages/nb-ui/src/components/layout/grid-geometry.ts
2. packages/nb-ui/src/components/layout/grid.ts
3. packages/nb-ui/src/components/layout/grid.test.ts
4. packages/nb-ui/src/components/layout/grid.md（新增）
5. packages/neuro-book/app/components/workbench/WorkbenchBranch.vue
6. packages/neuro-book/app/components/workbench/WorkbenchShell.vue
7. packages/neuro-book/app/components/workbench/workbench-branch-layout.ts
8. packages/neuro-book/app/components/workbench/workbench-grid-consumers.test.ts（新增）
9. packages/neuro-book/app/components/workbench-spike/WorkbenchSpike.vue
10. packages/neuro-book/app/components/workbench-spike/layout.ts
11. packages/neuro-book/app/components/workbench-spike/layout.test.ts
12. packages/neuro-book/app/utils/workbench/layout.ts
13. packages/neuro-book/app/utils/workbench/layout.test.ts
14. docs/specs/ui/nested-grid.md
15. 本报告。

grid-types.ts、grid-snapshot.ts、已有 workbench-branch-layout.test.ts 和 barrel 的中间稿被沿用并验证。本轮没有编辑 Splitter 内部、其 helper/测试/文档、UI 规范、用户已有 descriptors 两文件，也没有操作其它 Task 的产物。

## 实际验证

所有命令使用绝对 worktree cwd：C:/Users/notnotype/Documents/CodeRepository/GithubProjects/neuro-book/.worktree/w00003-neurobook-ui-foundation-migration，下表 cwd 为其子目录。

| cwd | 命令 | 退出码与结果 |
|---|---|---|
| packages/nb-ui | `bun run test src/components/layout/grid.test.ts` | 首次新回归 4 failed / 44 passed，exit 1；修复后最终 1 文件 52 passed，exit 0（12:42） |
| packages/neuro-book | `bun run test app/utils/workbench/layout.test.ts app/components/workbench-spike/layout.test.ts app/components/workbench/workbench-branch-layout.test.ts app/components/workbench/workbench-grid-consumers.test.ts` | 最终 4 文件 33 passed，exit 0（12:46） |
| worktree 根 | `bun run governance:context -- --work w00003-neurobook-ui-foundation-migration --task t37-grid-geometry` | exit 0，身份/路径匹配，failures 空 |
| worktree 根 | `git diff --check`（限定本 Task 已跟踪改动路径） | exit 0；仅 Git 的 CRLF 转换提示 |

聚焦合计 **5 文件 85 用例通过**。组件测试实际挂载 WorkbenchBranch、WorkbenchShell、WorkbenchSpike；Splitter 使用受控 stub，验证 props 和手势消费，不能据此声称真实 Reka 指针/键盘或浏览器视觉验收通过。

未运行：全包 typecheck、build、E2E、docs 全局门禁、真实浏览器验收；遵守当前 Task 只跑聚焦检查的安排，由 Leader 统一执行。三个被改 Vue 组件尚无同名组件文档，属于现有待声明项；本轮新增 grid API 文档，不宣称组件文档门禁已闭合。未联网、未启动产品服务、未访问 3001、未创建代理、未提交/push。

## Leader 接续

先复核本 diff 与 t38 手势合同，再统一类型检查/构建及浏览器验收。当前五项代码修复没有等待开发者决定的新增取舍；未知引用合成保存、Storage 插件宿主和完整产品持久化仍按后续 Task 推进。
