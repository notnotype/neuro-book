# t19 计划：改窗口大小时页面的重排开销

## 量法

生产构建（`bun run build`，`bun dist/server/main.js`，独立状态根），本机 Chrome 经 Playwright 打开工作台（打开一章正文，带桌面能力标记），把视口宽度在 1280 与 780 之间、高度在 740 与 800 之间来回改 60 步，每步等两帧。读 CDP `Performance.getMetrics` 的 `RecalcStyleCount`、`RecalcStyleDuration`，再用 `Tracing`（`devtools.timeline` 加栈）按调用点归类每一次样式重算与布局。脚本在仓库外（本机 `/tmp/w46-shot/`），结果抄进 `evidences/`。

Chrome 的视口改变不等于 WebView2 的窗口拖动（后者还有窗口式托管的闪白，上游 blackboardsh/electrobun#484，不在这里做），但页面这一层的重算是同一份代码，用它比前后。

## 基线（master c5754bc1c）

每步约 26 次样式重算，样式约 10.5 ms、往返 p50 约 37 ms（负载约 2）。强制重算按来源：

| 来源 | 每步 | 原因 |
| --- | --- | --- |
| 编辑器标签条（`TabStrip` 的 `TransitionGroup`） | 约 2.7 次更新 | `EditorGroupHead` 随标签条宽度重渲染（标题动作的取舍），模板里的 `:close-label="(name) => …"` 每次都是新函数；标签条的插槽读它，`TransitionGroup` 跟着重渲染，每次都克隆节点量 `transform`、量所有标签的位置 |
| 活动栏（`WorkbenchToolStrip` 的 `TransitionGroup`） | 1 次更新 | 条目区随窗口高度变，`shownEntries` 每次是新数组 |
| 资源管理器（`ExplorerTree` 的 `TransitionGroup`） | 1 次更新 | 视图高度变，`rendered` 每次是新数组，即使画的还是同一批行 |
| 分隔线对齐（`SashHandle.snap`） | 每条线 1 到 2 次 | 一帧里逐条“读位置、写样式、读 `--sash-line-size`”，后一条的读被前一条的写强制重算 |
| 状态栏条目（`WorkbenchItemStrip.remeasure`） | 2 次（左右两条） | 重量的 `watch` 用一个返回数组的函数当来源，上游每换一次条目数组就触发；测量层没写宽度，条目合起来比条带宽时被条带夹窄，尺寸随窗口变 |

## 改法（行为合同不变）

1. `useSashSnap` 改成两段：对齐函数只读、交回写入函数，一帧里所有分隔线量完再统一写；`SashHandle.snap` 把读 `--sash-line-size` 挪到量的一半。
2. `EditorGroupHead` 的两个文案函数在 setup 里建一次。
3. `WorkbenchToolStrip.shownEntries`、`ExplorerTree.rendered` 用 Vue 3.4 起的 `computed(previous => …)`：内容没变时交回上一次的数组。
4. `WorkbenchItemStrip`：`watch` 改成三个来源的数组形式（Vue 逐个比值）；量出来的宽度没变时不换 `Map`；测量层 `width: max-content`（顺带修掉条目被夹窄时量到的是压过的宽度）。

不做：让 `TransitionGroup` 只在拖动时出现（换组件会重建子元素，拖动中的标签会丢）；把各处 `ResizeObserver` 合并成一个调度（架构改动，收益是剩下的每步一两次）。

## 验证

- 类型检查：nb-layout、neuro-book；`bun run test:affected`。
- e2e（覆盖改动的组件）：`lab-nested-grid`、`lab-grid-panels`、`lab-item-strip`、`editor-area`、`workbench-views`、`files-explorer`、`workbench-containers`。
- 前后对比用同一个脚本、同一个状态根，各跑三次，写明负载。

## 审查

改动小、行为合同不变、有量化对比：按 reviewing 的“按任务大小降级”跳过设计审查；实现审查派 Sonnet（前端）。
