---
schema: nbook.walkthrough/v1
taskId: t05-component-lab
sequence: 3
role: tasker
status: in-progress
createdAt: 2026-09-01T00:00:00Z
---

# t05 第三轮：Lab 换用 nb-ui 主题包，加零件描边与悬停探针

在 `.worktree/w00003-neurobook-ui-foundation-migration`、分支 `refactor/w00003-nb-ui-adoption` 上执行。

开发者看过四个 tab 齐备的 Lab 后提了三个问题（devtools 悬浮球没了、左侧树是什么实现、中间预览能否高亮），并拍了两个方向：**Lab 先当 nb-ui 主题系统的试验场**（产品不动），**描边与探针两个都要**。

## 查清楚的三件事

- **devtools 不是 Lab 弄丢的**：`nuxt.config.ts:231` 把它压在 `NUXT_DEVTOOLS=1` 后面，这条早于整个 Lab 工作。启动脚本原样继承环境变量，带上即可。
- **左侧树是 nb-ui 的 `Tree`**，内部包 reka-ui 的 `TreeRoot` / `TreeItem`。**交互归 reka，外观归 nb-ui**——上一轮记的那张「浮着的卡片」写死在 `Tree.vue:46` 的根节点 class 上。
- **仓库里并存两套主题系统**：主应用 8 套主题 / 36 变量 / 存 Global Config（Spec 标 `implemented`）；nb-ui 配色—主题—插件三层，内置只剩 1 套暗色配色，四个主题包 Aurora / Editorial / macOS / NeuroBook。**主应用那 8 套里有 7 套在 nb-ui 侧已明确下线**，因此产品迁移不是平移。

## 已完成

文档先于实现的顺序保持：`HighlightBox.md`（`c8d753d0`）早于实现（`f7eae6fb`）。

- Lab 的主题切换从主应用那 8 套换成 nb-ui 的两条轴：**主题**（四个包）与**配色**（内置暗色 + 主题自带的四套，共五套）。换主题时跟到该主题 manifest 里按明暗给的默认配色，之后仍可单独换配色。
- 新增零件 `HighlightBox`：在视口坐标上画一个不吃鼠标事件的框加标签，两个配色档（实线主色=零件，虚线中性=探针）。
- 预览区上方新增一条工具栏：当前零件名、场景名、**描边**开关（默认开）、**探针**开关（默认关）。
- fixture 合同扩展一处：在被检视的零件上标 `data-lab-subject`，Lab 据此画常亮描边。五个既有 fixture 全部标好。
- Lab 展品由五个增加到六个。

## 已验证

- `bun run --cwd=packages/neuro-book typecheck`：无输出，退出码 0。
- **产物门禁仍成立。**真实生产构建（Σ 5.63 MB）后全文搜十七个词，命中文件数均为 0：既有的十个，加本轮新增的 `HighlightBox`、`data-lab-subject`、`nb-lab-highlight`，再加四个主题包的标记 `data-nb-theme`、`glass-lens`、`TimePickerWheel`、`Liquid Glass`。**主题包没有跟着 Lab 混进产物**。
- **否定结论有效**：同一套 grep 在同一份产物里，`preview` 命中 51 个文件、`workbench` 37 个、`novel-ide-theme` 5 个、`JsonViewer` 4 个；路由表取到 32 条路由含 14 条 preview，其中没有 `lab`。
- 开发服务下 Lab 的七个模块与 nb-ui 的六个主题模块经 Vite 转换均返回 200（`highlight-box.types.ts` 转换后 0 字节，是纯类型文件的正常结果）。
- **变量覆盖没有真缺口**：Lab 界面用到 15 个 CSS 变量，nb-ui 的配色契约与四个主题包合起来唯一没有的是 `--bg-page`，而它在代码里本来就写成 `var(--bg-page, var(--bg-main))`；被展出的产品组件 `JsonViewer` 用到的 11 个变量全部覆盖。

## 未验证

- **浏览器里的渲染、交互与视觉全部未验证**：四套主题的实际观感、描边位置准不准、探针跟不跟得手、离开 Lab 后主题有没有复原，都没有运行证据。
- 没有覆盖新零件的自动化测试。

## 发现一：nb-ui 的主题包不能作用域到某个节点，这推翻了上一轮的做法

上一轮把 Lab 的主题变量写在 Lab 自己的根节点上，理由是不影响产品。**这条对主应用那套成立，对 nb-ui 主题包不成立。**

两个原因叠在一起：主题包的变量声明写在 `:root[data-nb-theme="…"]` 选择器下，只认文档根；而 `macos` 与 `nbook` 的取值大量派生自配色变量（`color-mix(… var(--accent-main) …)`），CSS 自定义属性在**声明处**完成替换，配色不写在 `:root` 的话，这些派生值会拿主应用 `:root` 上那套米黄底色去算，玻璃与阴影全部失真。

因此本轮改为写文档根，离开页面时复原。`/lab` 是整页路由，页面上没有产品界面，代价是可控的。

**给 nb-ui 的反馈**：`:root` 前缀使同一页面无法并排展示两套主题——而这正是组件 Lab 想要的。选择器去掉 `:root` 改为 `[data-nb-theme="…"]` 即可两者兼得。

## 发现二：nb-ui 的两个 store 把「应用」和「记住」绑在了一起

`createThemeStore` 与 `createColorwayStore` 的 `setXxx` 和 `initXxx` 都写 localStorage。Lab 规范明写不写浏览器持久化，因此两个 store 一个都不能用，只能用它们下面那层无状态的 `installTheme` / `collectThemeColorways` / `applyColorway` 自己拼一层。

代价是 Lab 的主题选择刷新即丢。这是有意的，也与上一轮一致。

**给 nb-ui 的反馈**：想要「应用但不记住」的消费方（开发工具、预览、截图）必须绕开 store 自己拼一遍。store 可以把持久化做成可关的。

## 发现三：两套配色契约差 6 个领域变量

主应用有而 nb-ui 配色契约没有的：`--editor-bg`、`--source-bg`、`--source-text`、`--source-muted`、`--toolbar-bg`、`--chat-ai-bg`。六个都是编辑器与对话面板专用。

Lab 的展品一个都没用到，所以本轮不受影响。**但产品迁移时这 6 个必须有去处**——要么升为配色契约的角色，要么由产品自己的主题包声明。这是那次迁移绕不开的第一个决定。

## 发现四：描边不能改被框元素的样式

给元素加一圈 `outline` 会挤动布局、覆盖它原有的边框、还可能被组件内部样式盖掉——看到的就不是零件本来的样子了，而调试时要看的恰恰是本来的样子。

因此 `HighlightBox` 画在独立的一层上，用视口坐标定位，被框元素一个字节不变。

## 发现五：覆盖层必须不吃鼠标事件

探针模式下框一直跟着鼠标走。框只要接收鼠标事件，它就会立刻挡在光标和真实元素之间：预览区点不动，探针自己也会锁死在框上量自己。`pointer-events: none` 要落到框和标签两个节点上，不是只落在外层容器。

## 发现六：ResizeObserver 看不见位移

它只看得见目标**自身**的尺寸变化。改了假数据之后零件被兄弟节点推走、而它自己尺寸没变的情况观察不到，框会留在原地。因此测量那一层留了手动重测的口子，由 Lab 在改数据、换尺寸档之后调用。

滚动则要在 capture 阶段监听——预览区有嵌套滚动容器，scroll 事件不冒泡到 window。

## 发现七：上一轮建议的 `.types.ts` 惯例，nb-ui 早就在用

上一轮提出「组件对外的类型放同目录 `.types.ts`」时以为是新提法。实际上 nb-ui 的 `navigation/file-tree.types.ts` 已经是这么做的。这条给组件规范的建议**有仓库内先例支撑**，不是凭空发明。

本轮的 `highlight-box.types.ts` 按同样的惯例落地。
