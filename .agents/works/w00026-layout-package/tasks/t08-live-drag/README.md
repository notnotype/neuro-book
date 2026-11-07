---
schema: nbook.task/v2
taskId: t08-live-drag
status: done
updated: 2026-11-05
---

# Trellis 模式的拖动

## 目标与范围

加候选树预览与动画：卡片跟手、邻居实时让位、来源收起、取消飞回、落点稳定后才换预览（Trellis 文档是 150ms）、松手提交指针下的候选。VS Code 模式保留，各场景的默认模式按 t02 的结论定。遵守系统减少动效。

t06 手感确认后过渡合同变了：前后都有尺寸的叶内容逐帧跟外框，不再“只排一次版”（[nested-grid 的“过渡”](../../../../../docs/specs/ui/nested-grid.md)）。实时布局里每换一次候选邻居都要逐帧重排，长章节的代价要在这里重新量，数据见 [t06 的测量](../t06-flat-renderer/evidences/follow-content.txt)。

合同：[ui/layout-drag](../../../../../docs/specs/ui/layout-drag.md)、[workbench-layout](../../../../../docs/specs/ui/workbench-layout.md)。计划见 [`plan.md`](plan.md)。

## 当前状态

2026-11-07 已合入，实现审查已处理（`14651b39a`）。

- 验证：`test:affected --since master --typecheck` 只有已知失败；e2e 用 `NB_E2E_WIDE` 跑了拖动与读编辑器 DOM 的 14 个文件，处理后重跑失败项全过；`lab-scenes` 只有 ThemeEditor 假素材的 404。两个看落点指示、又要真实过渡的 e2e 写明设置 `dragFeel: indicator`。
- 测量：[`evidences/live-drag-frames.txt`](evidences/live-drag-frames.txt)，脚本 [`scripts/measure-live-drag.e2e.ts`](scripts/measure-live-drag.e2e.ts)。10.6 万字章节开着时中位 17ms；第一轮 p95 50 到 67ms、最长 100ms（负载 4.5、软件渲染），第一次运行按计划的线不达标；去掉每帧多余的渲染之后两次都是 p95 50ms、最长 83ms（负载 8.5 到 5.5）。手感由开发者试，退路进了待确认。
- 和计划不同的地方：标签滑开仍是 `TransitionGroup`，但只按 `move-class` 开关，一直是它，免得切换组件类型把标签重建。
- 没做的：卡片的头收起时内容体上移 32px 有一下跳（落地时头没了），手感由开发者定。


设计审查（一个 Sonnet，[`evidences/plan-review.txt`](evidences/plan-review.txt)，17 条：阻断 2、重要 8、建议 7）全部成立，计划照改：

| 条 | 处理 |
|---|---|
| 1 叠放 | 阻断。都放进 `NestedGrid` 的层叠上下文：卡片外观是拿起的内容项自己的，分区走新的 `#overlay` 插槽；不接指针 |
| 2 可见性 | 阻断。`visibleTabs` 与实例都按已提交的；预览只进渲染 |
| 3 投影 | store 只多一份渲染用的投影；撤预览挂 `onActiveChange(false)`，先于提交。编辑器异步提交时先回原样，接受 |
| 4 快照 | 拿起时先让过渡到终点，下一帧才量；标签条拆出快照；尺寸变了取消，改 Spec |
| 5 编辑器 | `previewable`；`EditorGroup` 按标签真正所在的组读。审查建议的“预览 API 给完整结果”不做：只要能不能预览 |
| 6 粘滞 | 只有新面板有；矩形取 `areaRect`；`commitsUnderPointer(keyboard)`，`shown` 为 null 不提交 |
| 7 预备区 | 补一节 |
| 8 外壳 | 两份文档，逐项列表 |
| 9 标签条 | `placeholder`、`animateMoves`；工具面板的 `adapt` 条不滑 |
| 10 落地 | `land` 让这一轮不跟随 |
| 11 t09 | 输出三态，`source-removed` 现在就做（原型如此） |
| 12 回退 | 列全，拿起时定一次 |
| 13 循环 | 自己的帧循环与 `pointermove`，挂 `onActiveChange` |
| 14 标记 | `data-drag-feel`、`data-live-preview` |
| 15 读屏 | 常驻 `role="status"` |
| 16 退路 | 阈值 p95 50ms，片 1 后就量；不达标的做法要开发者定 |
| 17 文档 | 补 |

实现审查（一个 Sonnet，[`evidences/impl-review.txt`](evidences/impl-review.txt)，13 条：重要 4、建议 9）：

| 条 | 判定 | 处理 |
|---|---|---|
| 1 判定矩形在过渡中冻结 | 成立，根因比报告深 | 摘掉过渡标记停不下进行中的 CSS 过渡（`transition-property` 缺省 all，还算匹配）：`useGridMotion.stop` 直接把网格根直接子元素的过渡走到终点；另在渲染之后马上重量基准。e2e 放慢过渡后拿起；变异删 `settleMotion` 失败 |
| 2 卡片每帧新对象 | 成立 | 矩形没变不换对象；内容项只读键与来源。没有缓存 `gridOrigin`：没有脏布局时读矩形很便宜 |
| 3 关标签晚两帧 | 成立 | `TransitionGroup` 加 `:css="false"`；每次更新多一次克隆读样式与逐标签读矩形还在，没量到问题，不手写 FLIP |
| 4 测试盖不住 | 成立 | 新增 `live-drag.test.ts`、`tab-strip-geometry.dom.test.ts`、`TabStrip.dom.test.ts`、`land` 用例、`moveBlocked` 对照表；同一任务派发移动与松手的 e2e（变异 `commitsUnderPointer` 恒假失败）。`land` 的用例还抓到一处：先落地后布局时别的叶不跟外框，已修 |
| 5 动态插槽 | 成立 | 插槽始终传，条件写进内容 |
| 6 撕下的起点 | 成立 | 从此刻摆着的预览里找面板 |
| 7 `moveBlocked` 同组 | 成立 | 与 `moveTab` 同条件 |
| 8 `resolve` 有副作用 | 成立，接受现状 | 注释改成实话；加 `onPublish` 只为了注释好看 |
| 9 没按 `pointerId` 过滤 | 不改 | 多指只让卡片错位、不影响落点；触屏呈现不在这一轮（t11） |
| 10 行尾的分区 | 成立 | 快照记下这一行原来以来源结尾，行尾用来源的分区；单测 |
| 11 不活动标签的卡片是空的 | 接受取舍 | 进待确认，Spec 写明：为它加载实例有副作用（输出 17） |
| 12 证据的说法 | 成立 | 证据里写明第一次不达标；便宜的修法做完重量 |
| 13 小的 | a 改注释并补用例；b、c 不改 | `data-drag-feel` 只给 e2e 用；`liveSectors` 随每次发布重算，没有错 |

## 下一步

无。手感由开发者试。
