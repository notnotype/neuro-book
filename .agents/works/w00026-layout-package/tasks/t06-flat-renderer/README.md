---
schema: nbook.task/v2
taskId: t06-flat-renderer
status: done
updated: 2026-11-05
---

# 扁平渲染层

## 目标与范围

在 nb-layout 里实现按矩形摆放的渲染层：模型算出叶子与分隔线的矩形，都放在同一父元素下，取代递归的 NestedGrid；独立的 Splitter 保留给 nb-story 与 dev-panel，拿掉 branchId、sashLineEnds。处理 Tab 与读屏顺序（按 t02 的结论）。

合同：[`ui/nested-grid.md`](../../../../../docs/specs/ui/nested-grid.md) 的摆放、取整、过渡、停放、Tab、F6、读屏顺序与验收 8、9。计划：[`plan.md`](plan.md)。

## 当前状态

开发者 2026-11-05 确认计划要点（“没问题”）：470ms 外框过渡放在这一片，新增依赖 `tabbable`，工作量大的切片按难度派 Haiku 或 Sonnet。

设计审查（Sonnet，[报告](evidences/design-review.txt)）22 条，重要 11、建议 11，已改进 Spec 与计划，没有开第二轮：

| 条 | 处理 |
|---|---|
| 1 取整做不到缝宽相同 | 成立（枚举核实）。改成沿主轴按设备像素累加，缝宽也取整，单元枚举 |
| 2 预览矩形为零就停放 | 成立。停放只看已发布的布局 |
| 3 放下收尾按帧数量矩形，会和过渡打架 | 成立。上限改成按时间 |
| 4 `snapLines` 在过渡开始时读旧位置 | 成立。过渡结束再排一次；窗口监听与 rAF 合并到父组件一份 |
| 5 过渡的判定有漏 | 成立。按结果判定，手势开始、尺寸变化无条件撤掉，计时重置，差不到 1px 不过渡 |
| 6 新叶、离开的叶没有定义 | 成立。新叶从边上长出来，离开的立即消失 |
| 7 Tab 进入 grid、点空白后按 Tab 回到 DOM 序 | 成立（Chrome 复现）。这一片不做，写进 Spec 的已知限制，t07 处理；配合第 13 条，这一片只在外壳改面板位置后才不一致 |
| 8 Tab 的边界 | 成立。纯函数 `nextFocusStop` 跳过空项，`compareDocumentPosition` 处理不在列表里的焦点，输入法组字放行。外层接手的“标记冒泡”去掉：内层 DOM 序总等于树序 |
| 9 `ariaSnapshot()` 看不到 `aria-owns` | 成立（Chrome 复现）。改用 CDP；id 用不透明串 |
| 10 搬走 grid 模式会丢的行为 | 成立，逐条写进计划。其中“分隔线上 Enter 收起的动画会丢”不成立：`keydown` 时手势已激活，属性写不上，现在就是瞬时的 |
| 11 选择器迁移写不死 | 成立。不派 Haiku，主会话随第 3 片改；“不改断言”改成“行为断言不改” |
| 12 分隔线的 key | 成立。DOM key 用前后节点 id，`data-sash` 不变 |
| 13 新叶不必排到 DOM 最后 | 成立（审查在 Chrome 里验证）。改成插在树序的前一块之后，Tab 接管和 `aria-owns` 只在不一致时挂 |
| 14 第 2 片前后矛盾 | 成立。只抽组件，grid 模式第 3 片删 |
| 15 第一帧、Teleport 时序、尺寸记录 | 成立。第一帧不停放，`stableOrder` 同步算，关闭时清记录 |
| 16 交叉轴 | 成立。取父分支的完整长度 |
| 17 F6 绕过命令系统 | 成立。库导出 `moveGridFocus`，工作台登记命令 |
| 18 量几何的用例约 113 个 | 成立。e2e 默认减少动态效果，测动画的开回来 |
| 19 `dpr` 的来源 | 成立。`ref` 加 `resize` 与 `matchMedia` |
| 20 `shellNodeRects` 重复 | 成立但接受：t07 换树时去掉 |
| 21 公开面的变化 | 成立。写进 `NestedGrid.md`；包还没发布 |
| 22 根上的标记与 t08 不相容 | 成立。标记写在外框上 |

实现审查（Sonnet，[报告](evidences/impl-review.txt)）14 条，阻断 1、重要 3、建议 10：

| 条 | 处理 |
|---|---|
| 1 改窗口高度也过渡 | 成立（审查用假 `ResizeObserver` 复现，Chrome 里两个回调之间确实跑微任务）。实测盒也算容器尺寸变化，用例改成高度也变、等两帧再看 |
| 2 新分隔线直接在终点 | 成立。`enteringRects`：从挨着同一节点的旧分隔线出发，否则从新叶的起点出发 |
| 3 单元测试放过关键行为 | 成立。补上。其中“长出方向”查出来确实写反了：第一块应当起点不动，否则中间露空白，我推了一遍几何才确认 |
| 4 默认减少动态后老用例变弱 | 成立。`lab-nb-ui`、`markdown-editing` 开回动画，写进 `docs/testing/README.md` |
| 5 `fromGesture` 的合并情形 | 接受取舍：手势进行中改树极少见，代价只是这一次不过渡。第三点（外壳的第二次发布）加了真实用例 |
| 6 `domIds` 与分隔线 key | 成立。清理不再用的 id，key 用 JSON，节点 id 含分隔符也不撞。`renderedKeys` 在 `computed` 里写闭包不改：审查推演没有失败路径，放进 watch 反而赶不上外壳的 Teleport 时序 |
| 7 每次 resize 重建 `matchMedia` | 成立。缩放比变了才重建 |
| 8 文档与公开面 | 成立。`WorkbenchShellLayout.md`、实现合同改了；`index.ts` 显式导出，`panelBounds`、`ariaMax` 不公开 |
| 9 `attachPaneFocus(null)` | 成立。返回只清自己的撤销函数 |
| 10 `NestedGrid` 太长 | 成立。动效、停放拆成 `useGridMotion`、`useLeafParking`（494 行到 407 行） |
| 11 `getElementById` | 部分成立。改用 `getRootNode()`，Shadow DOM 里也查得到；不改函数 ref，每次渲染换闭包更不值 |
| 12 卸载后又排一帧 | 成立。`useSashSnap` 卸载后不再排 |
| 13 定时器早于过渡结束 | 部分成立。计时加 50ms 余量；不用 `transitionend` 计数，多个属性、中途打断都要处理，末端曲线很平，不值 |
| 14 半像素比较 | 成立。`lab-nested-grid.e2e.ts` 同样改 |

可维护性与 API 形状审查（两个 Sonnet，[可维护性](evidences/shape-review-maintainability.txt)、[接入与 API](evidences/shape-review-api.txt)）共 23 条，阻断 0：

| 条 | 处理 |
|---|---|
| 维护 1 过渡、停放、焦点没有单元测试 | 成立。过渡判定拆成纯函数 `decideMotion` 表驱动测，停放与 Tab 不介入的分支各补；Tab 走到头之后的跳转依赖真实布局，仍只在 e2e |
| 维护 2、接入 8 两个 DOM 属性没登记、F6 要两次调用 | 成立。`data-grid-scope` 等写进 `NestedGrid.md` 的“公开的标记与变量”；`moveGridFocus(container, direction)` 一次调用。紧凑模式手写的同形状 DOM 不动，t07 一棵树之后消失 |
| 维护 3 手势旗标跨文件、靠 watcher 顺序 | 成立。改成按数据判定：预览中，或上一次还在预览中。删掉 `markGesture` |
| 维护 4、5 渲染序与焦点接线摊在 `NestedGrid` | 成立。`useRenderOrder`、`useGridFocus` 拆出，脚本回到约 250 行 |
| 维护 6 `grid-rects.ts` 四件事 | 成立。过渡起点与渲染序进 `grid-motion.ts`，`nextFocusStop` 进 `grid-focus.ts` |
| 维护 7 重复三块 | 只改 (d)：缺省缝宽共用一个常量。(a) 的 aria 公式两处各一次，(b) 的两个 provide 成对写，抽出去的部件比重复的更多 |
| 维护 8 类型循环、多余公开 | 成立。`SplitterPanelConfig` 移进 `grid-splitter.ts`，两个内部函数不再公开 |
| 维护 9 对齐算术在 `.vue` 里、测试挂在 Splitter 下 | 不改：Splitter 的测试 1282 行，搬家风险大于收益，t14 迁移 Splitter 时一起整理 |
| 维护 10 dpr 两个来源 | 成立。`useSashSnap` 用 `useDevicePixelRatio`，缩放变了自己重排 |
| 维护 11、12 文档与小问题 | 成立，已改 |
| 接入 3 `sashSize` 缺省 0 不可拖却没有说明 | 成立。`grid.md`、`NestedGrid.md` 写明；缺省值不改（改了是行为变化） |
| 接入 4 没有接入说明 | 成立。`NestedGrid.md` 加“接入”一节和最小宿主 |
| 接入 9 样式与属性合同只在注释里 | 成立。同上的表；`--nb-splitter-seam*` 不改名，宿主在用，没有收益 |
| 接入 1、2、5、6、7、10、11 | 不在这一片做，记入遗留。理由：它们都要同时改外壳、编辑器区、视图容器等宿主的接线，而外壳在 t07 整个重做；接口收窄（入口导出减半）在包发布前做 |

**遗留**（t07 动手前先看）：

- `useGridLayout` 返回可直接 `v-bind` 的对象，`contextKey`、`revision` 不再手工对齐（接入 1）。
- 宿主与 `NestedGrid` 各测一次容器尺寸，合同没写测哪个盒；`EditorArea` 的提示条在 grid 之上、也算进测量根，从代码推断提示条出现时底部被裁（已有问题，未在浏览器里复现）（接入 2）。
- `onIssues` prop 与 `@issues` 事件重复触发，`issues` 载荷是累计的最近 8 条，诊断是中文字符串、没有错误码（已有问题）（接入 5）。
- `useDragSession(root, options)` 组合式函数，四个调用点各省约 8 行（接入 6）。
- 入口导出收窄：核心入口 34 个名字里 27 个没有外部使用，事件类型还叫 `Splitter*`，`DragState`、`DragStops` 放进核心入口（接入 7）。
- 叶是否停放、过渡何时结束由 `NestedGrid` 通知宿主，外壳不再数帧猜（接入 10）。
- SDK 只导出了 `NestedGrid`，没有 `createGrid`、`useGridLayout`，插件用不起来；要么补齐，要么在 Spec 写明暂不开放（接入 11）。

## 下一步

开发者确认计划后，按 `plan.md` 的切片实施。
