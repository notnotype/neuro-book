# @notnotype/nb-layout

两轴嵌套的分栏布局库：一棵布局树、按约束求尺寸、拖分隔条调整、收起与展开、快照存取、拖动与落点的几何，Vue 层给出渲染组件与组合式函数。它不是现成的“标签停靠”布局：标签条、面板头、拖标签到边缘拆分这些由宿主（使用本库的应用）在它之上搭（工作台的那一层在 [`@notnotype/nb-workbench-layout`](https://github.com/notnotype/neuro-book/blob/master/packages/nb-workbench-layout/README.md)）。

完整的行为合同在仓库的 [`docs/specs/ui/nested-grid.md`](https://github.com/notnotype/neuro-book/blob/master/docs/specs/ui/nested-grid.md)，拖动会话在 [`docs/specs/ui/layout-drag.md`](https://github.com/notnotype/neuro-book/blob/master/docs/specs/ui/layout-drag.md)；取舍见 [ADR 0054](https://github.com/notnotype/neuro-book/blob/master/docs/adr/0054-nb-layout-general-library.md)。

```ts
import {createGrid, NB_LAYOUT_THEME_VARS} from "@notnotype/nb-layout"; // 纯 TS：树、尺寸、落点、变量清单，不依赖 Vue 与 DOM
import {NestedGrid, useGridHost} from "@notnotype/nb-layout/vue";     // 组件与组合式函数，只依赖 vue 与 tabbable
import {LAYOUT_TEXT_KEY} from "@notnotype/nb-layout/text";              // 宿主接文字的注入点
import {NB_LAYOUT_CATALOGS} from "@notnotype/nb-layout/locales";        // 自带的 en-US（缺省）、zh-CN 文字目录
```

## 安装

```sh
npm install @notnotype/nb-layout   # 或 bun add、pnpm add
```

- 对等依赖：`vue` 3.5 以上。
- 包是编译好的 ES 模块与类型声明。组件的样式单独一份，在入口文件里导入一次，不导入时组件没有样式：

  ```ts
  import "@notnotype/nb-layout/style.css";
  ```

- 承诺的宿主是 Vue 3 加 Vite；别的打包器没有实测。

## 起步

一个能直接用的单文件组件：两列，左栏可以拖宽、收起，编辑区可以拆分，布局变了存快照。

<!-- starter: packages/neuro-book/src/plugins/lab/web/fixtures/nb-layout/StarterScene.vue -->
<!-- 这段与仓库 Lab 的 starter 场景一字不差，src/readme.test.ts 核对。 -->
```vue
<script setup lang="ts">
import {computed, shallowRef} from "vue";
import {createGrid} from "@notnotype/nb-layout";
import {NestedGrid, useGridHost} from "@notnotype/nb-layout/vue";

// 1. 建树：左栏保留像素、可以收起，编辑区吸收余量。sashSize 要给正数：缺省是 0，分隔条没有宽度、拖不动。
const grid = shallowRef(createGrid<string>({
    kind: "branch",
    id: "root",
    orientation: "horizontal",
    children: [
        {
            kind: "leaf",
            id: "files",
            ref: "files",
            size: {width: 240, height: 0},
            sizing: "fixed",
            minimumSize: {width: 160, height: 0},
            collapse: {collapsed: false, collapsedSize: 0, collapseThreshold: 24, expandThreshold: 24},
        },
        {kind: "leaf", id: "editor", ref: "editor", size: {width: 600, height: 0}},
    ],
}, {sashSize: 4}));

// 快照只存结构与尺寸；保留像素、最小尺寸、收起策略不在里面，恢复时由解析函数按 ref 再给（见“约定”）。
const saved = shallowRef(grid.value.serialize());
function save(): void {
    saved.value = grid.value.serialize();
}

// 2 到 4. 量容器、算布局、接纳手势提交：都在 useGridHost 里，整包绑到 NestedGrid 上。
// contextKey 标出这是哪一块布局：换了它，进行中的旧手势就不落账。
const host = useGridHost({
    grid,
    contextKey: "starter",
    onApplied: save,
    // 诊断的唯一出口：放不下、被拒的提交都从这里交出。不给时库不打印，开发检查只警告一次“没有出口”。
    onIssues: (issues) => console.warn("nb-layout issues", issues),
});

// 5. 结构变了要通知：原地改了树之后调 invalidate()。收起与展开用 host.setCollapsed，它自己重发布局。
function split(): void {
    const result = grid.value.splitLeaf("editor", {branchId: "editor-split", orientation: "vertical", side: "after", ratio: 0.5, leaf: {kind: "leaf", id: "preview", ref: "preview"}});
    if (!result.ok) return;
    host.invalidate();
    save();
}

// 收起状态从网格读：拖过最小尺寸也会收起，按钮要跟着它。每次重发布局版本都会变，读它就会跟着重算。
const filesCollapsed = computed(() => {
    void host.revision.value;
    return grid.value.find("files")?.collapse?.collapsed === true;
});
function toggleFiles(): void {
    host.setCollapsed("files", !filesCollapsed.value);
}
</script>

<template>
    <!-- 承载盒要有确定的高度：NestedGrid 的根铺满它，尺寸由它自己量。这里直接给外层一个高度。 -->
    <div style="display: flex; flex-direction: column; gap: 8px; height: 480px">
        <div style="display: flex; gap: 8px">
            <button type="button" data-starter-action="split" @click="split()">拆分编辑区</button>
            <button type="button" data-starter-action="toggle" @click="toggleFiles()">{{ filesCollapsed ? "展开左栏" : "收起左栏" }}</button>
        </div>
        <div style="flex: 1; min-height: 0">
            <NestedGrid v-bind="host.bindings.value">
                <template #leaf="{node}">{{ node.id }}</template>
            </NestedGrid>
        </div>
    </div>
</template>
```

左栏的 `collapse` 是它的收起策略：拖过最小尺寸后再往里 `collapseThreshold` 像素就收起到 `collapsedSize`（这里是 0）；从收起处往外拉过 `expandThreshold` 就展开；分隔条上按 Enter 或调 `setCollapsed` 也能收起、展开，展开回到意图。`collapsed` 是当前状态。

它做了五件事，每件对应一处：

1. **建树**：`createGrid(根, {sashSize})`。节点的 `size` 是分配意图，不是呈现尺寸；`sizing: "fixed"` 的保留像素，其余按比例分余量。
2. **量容器**：`NestedGrid` 自己量根盒，经 `useGridHost` 交给宿主；宿主不另量。承载盒（包着 `NestedGrid` 的那个元素）要有确定的高度，组件的根铺满它；例子直接给外层写了 480px，放进页面时也可以让 `html`、`body`、`#app` 一路是 `height: 100%`。
3. **算布局**：`useGridHost` 按网格与尺寸算布局，整包 `bindings` 绑到组件上。没量到可用尺寸时布局为空、手势停用。
4. **接纳手势提交**：拖完一次，`bindings` 里的提交处理核对并落账，然后调 `onApplied`。经 `host.setCollapsed` 收起、展开与经 `host.setSize` 设尺寸之后也调它，存盘就在这里；结构操作之后要自己存（例子的 `save`）。
5. **结构变了通知**：原地改了树（拆分、关闭、移动）之后调 `host.invalidate()`，它不调 `onApplied`；收起与展开用 `host.setCollapsed`，它自己重发布局。

接线的细节（`contextKey` 只经选项给、诊断一个出口、提交前的布局）见 [`useGridHost`](src/vue/useGridHost.md)；组件的属性、插槽与事件见 [`NestedGrid`](src/vue/NestedGrid.md)；树的结构操作与快照见 [`grid`](src/grid.md)。

## 示例应用

仓库里有照公开入口写的完整示例，每个目录可以单独拷走、`npm install` 后 `npm run dev`：

- [`tabbed-panels`](https://github.com/notnotype/neuro-book/tree/master/packages/nb-layout/examples/tabbed-panels)：标签编组。标签在编组之间拖、拖到边上拆出新编组、关空的编组缩回去、侧栏收起、布局存进浏览器、读档失败保留原件、F6 在面板之间走。本库不带的“标签停靠”就是这样在它之上搭的。
- [`desktop`](https://github.com/notnotype/neuro-book/tree/master/packages/nb-layout/examples/desktop)：浮动窗口的桌面。拖标题栏移动、拖边角缩放、按到就到最上面、最大化与最小化、拖到桌面左右缘平铺进布局树再取消平铺。演示浮动窗与树之间来回。
- [`ide`](https://github.com/notnotype/neuro-book/tree/master/packages/nb-layout/examples/ide)：IDE 式的工具窗。三个停靠区靠边上的按钮条开关、收起再展开回到原来的宽度、按钮在条之间拖动换区、编辑区最大化、快捷键。演示停靠区的收起与恢复。

示例跟着仓库 master 上的本库，可能用到 npm 上还没发布的名字。

## 我要做 X 用哪个导出

| 要做的事 | 用这个 | 从哪个入口 |
|---|---|---|
| 建树、拆分、关闭、移动叶 | `createGrid`，`grid.splitLeaf`、`grid.removeLeaf`、`grid.moveLeaf`、`grid.addLeaf` | 根 |
| 把网格画出来、接手势 | `NestedGrid` 加 `useGridHost` | `./vue` |
| 关掉一块，内容跟着缩回去再卸载 | `NestedGrid` 的内容层，内容项标 `leave: "retain"`（[说明](src/vue/NestedGrid.md)；只用 leaf 插槽时删叶没有缩回去的过渡；留着的这段时间宿主的数据已经删了，面板头与正文都别按 key 查数据，写法见说明的“过渡”） | `./vue` |
| 收起与展开一块面板 | `host.setCollapsed`（直接调 `grid.setCollapsed` 的，之后要调 `host.invalidate()`；示例见 ide） | `./vue`、根 |
| 把一块保留像素的设成已知宽度（偏好、菜单） | `host.setSize`（直接调 `grid.setSize` 的，之后要调 `host.invalidate()`） | `./vue`、根 |
| 保存与恢复 | `grid.serialize()`、`restoreGrid(快照, 解析引用, 选项)` | 根 |
| 先试一遍再决定做不做（这次拆分放不放得下） | `grid.clone()`，在副本上照做、读结果与副本的 `grid.layout().issues` | 根 |
| 键盘在叶之间走（F6） | `moveGridFocus`，键位由宿主登记 | `./vue` |
| 量一个盒子的布局尺寸 | `useLayoutExtent`（[说明](src/vue/useLayoutExtent.md)） | `./vue` |
| 一组可拖的东西（拖动会话） | `useDragSession`、`createDragSession`（[说明](src/vue/drag-session.md)；示例见 tabbed-panels、ide，整窗移动见 desktop） | `./vue` |
| 拖到边缘、插到两项之间的落点几何 | `resolveGridEdgeDrop`、`resolveListInsertion`（示例见 tabbed-panels） | 根 |
| 拖动时的落点反馈 | `DropFeedbackOverlay`、`DropSectorsOverlay`、`DropIndicatorLabel`（示例见 tabbed-panels） | `./vue` |
| 实时布局：拖动中布局真的变，拿起的内容做成卡片跟手 | `useLiveDragSession`、`createLiveDragSession`（[说明](src/vue/live-drag-session.md)） | `./vue` |
| 自己画卡片：把布局摆成每块的矩形 | `placeGrid` | 根 |
| 只要一行或一列的分栏 | `Splitter` | `./vue` |
| 可排序的列表 | `SortableList`、`useSortable` | `./vue` |
| 浮动窗的把手 | `FloatWindowHandles`（示例见 desktop） | `./vue` |
| 把浮动窗的矩形夹进一块区域、按手柄改尺寸 | `clampFloatRect`、`resizeFloatRect`（都只收尺寸、从 0 开始：区域不在网格根原点时先减掉原点；示例见 desktop） | 根 |
| 换主题 | 设 `--nb-layout-*` 变量；全部名单 `NB_LAYOUT_THEME_VARS` | 根 |
| 换文字、换语言 | `LAYOUT_TEXT_KEY` 注入翻译函数；只有一种语言时用 `layoutCatalogTranslate`；目录在 `./locales` | `./text`、`./locales` |
| 分隔线读屏时念出面板的名字，不念 id | `NestedGrid` 的 paneLabel 属性、`Splitter` 面板配置的 label | `./vue` |
| 开发时查接线错误 | `setLayoutDevChecks(true)`，在网格挂载之前调 | 根 |

## 约定

这几条在接口签名上看不出来：

- **快照只存结构、引用与两轴的尺寸意图**：保留像素（`sizing`）、最小与最大尺寸、收起策略（含收起没收起）都不在里面。恢复时解析函数要按引用把它们再给回去，只返回 `{ref}` 的话，左栏会变成按比例分、也收不起来，而且没有任何诊断：

  ```ts
  // 宿主按引用记着的运行期策略；没列在这里的（例如拆分出来的 preview）按比例分、没有收起策略。
  const policies: Record<string, Omit<GridRefResolution<string>, "ref">> = {
      files: {sizing: "fixed", minimumSize: {width: 160, height: 0}, collapse: {collapsed: false, collapsedSize: 0, collapseThreshold: 24, expandThreshold: 24}},
  };
  const known = new Set(["files", "editor", "preview"]); // 宿主此刻还有的内容
  // 宿主已经没有的内容返回 null；恢复也要给 sashSize：它不在快照里
  const result = restoreGrid<string>(saved, (ref) => (known.has(ref) ? {ref, ...policies[ref]} : null), {sashSize: 4});
  const grid = result.ok ? result.grid : null; // 失败时结果里没有 grid；存档原件要留着，见下面“读失败时保留原件”
  ```

  `restoreGrid`、`GridRefResolution` 从根入口导出。收起状态要跨会话保存的，宿主另存 `collapsed`（`setCollapsed` 的结果、`grid.find(id).collapse`），恢复时放进 `policies` 里对应的 `collapse`；展开回到意图，意图已经在快照里。引用不是字符串时，建网格要给 `encodeRef`（见 [`grid`](src/grid.md)）。
- **意图的单位**：节点的 `size` 是意图。保留像素（`sizing: "fixed"`）的意图是像素；按比例分的意图是同一分支里按比例分的兄弟之间的相对份额，单位由兄弟决定。增删与移动不改兄弟的意图：保留像素的栏宽度不变，按比例分的按份额重分；新加的按比例分的叶不给意图就平分一份，要等分就别给（细则见 [`grid`](src/grid.md) 的“结构操作”）。
- **`maximumSize` 的 0 就是上限 0**，不是不限：只给主轴约束的叶，交叉轴的上限写 `Infinity`，或者整个 `maximumSize` 不写。写成 0 时 `layout()` 报出的那根轴的尺寸是 0（`NestedGrid` 按父分支的盒子画，画面上看不出来，读布局结果的代码会读到 0）：

  ```ts
  {kind: "leaf", id: "nav", ref: "nav", sizing: "fixed", size: {width: 188, height: 0},
      minimumSize: {width: 150, height: 0}, maximumSize: {width: 300, height: Number.POSITIVE_INFINITY}}
  ```
- **读失败时保留原件**：`restoreGrid` 失败（版本不认识、结构坏了）时结果里没有网格，原地的 `grid.restore` 失败时树不变；成功但 `dropped` 非空，说明有引用没解析出来。推荐的做法是两种情况都把存档原件留着，不要拿缺省布局覆盖它，等宿主修好了还能再读。
- **层数与节点数的上限**：根算第 1 层，最多 16 层、256 个节点（`GRID_MAX_DEPTH`、`GRID_MAX_NODES`）。拆分、插入与移动按这次新造出来的那一处判，超了返回 `limit-exceeded`、树不变；同向拆分并进父分支、不加深。恢复超过 16 层或 256 个节点的快照整体拒绝；`createGrid` 不查。拖标签到边缘拆分这类交互要预料到它会被拒。
- **窗口太窄不报错**：放不下时库按约束压缩，并在 `layout().issues` 里给诊断（例如 `over-constrained`）。想知道放不放得下，读布局结果里根节点的 `constraints`（最小尺寸）；想先知道一次操作之后放不放得下，在 `grid.clone()` 上照做一遍读它的 `issues`。
- **键盘**：`moveGridFocus(container, "next" | "previous")` 在叶之间按树序移动焦点，返回移动了没有（宿主据此决定要不要 `preventDefault`）；`container` 是包着网格的元素。只有前后两个方向，没有上下左右；只停在叶里能聚焦的元素上，叶里没有就跳过。F6 的键位由宿主登记；标签条里的左右键与漫游 `tabindex` 是宿主的事。
- **两种矩形**：`placeGrid` 给的是 `{x, y, width, height}`，相对网格根的 CSS px（`NestedGrid` 的 `placeLifted` 也收这种）；落点几何用 `{left, top, right, bottom}`，视口坐标（`clientX`、`clientY`）。库不替你互转：减掉网格根在视口里的左上角就是前者。
- **自己画的拖动反馈**要带 `data-drag-feedback`：拖动会话判定落点时跳过它们，不然它们会挡住指针下的目标。`sourceAt` 里要自己排除可交互的元素（按钮、输入框），不然点按钮也会起拖。

## 主题

组件只读本包命名空间下的 CSS 变量 `--nb-layout-*`，每处都带回退：

- 装了 nb-ui 的宿主不用做什么：nb-ui 的 `tokens.css` 在根元素上把主题的名字接过来（`--nb-layout-sash-line-color: var(--sash-line-color)`），主题照旧写旧名（[主题系统](https://github.com/notnotype/neuro-book/blob/master/docs/specs/theme/system.md)的“布局组件的桥接”）。旧名只在根元素上改才传得过来；子树要改 nb-layout 的外观，直接设 `--nb-layout-*`。
- 不装 nb-ui 时用回退：尺寸、时长、圆角与 nb-ui 的缺省相同，颜色是系统色（`Canvas`、`CanvasText`、`Highlight` 一类）。要自己的配色，在根上设下表的变量。
- 系统减少动态效果时，四个时长（`--nb-layout-motion-*`）在根上归零，宿主在根上设的值也压不过；设在子树上的不受这条约束，宿主自己在子树上给时长时要顾及减少动效。
- 缺省时长是真的过渡：在没有过渡的测试环境里（happy-dom），宿主的组件测试要自己把时长设成 0ms。happy-dom 不继承自定义属性，根上设的值子元素读不到，要用命中每个元素的规则，例如在测试的样式里写 `* { --nb-layout-motion-layout: 0ms; --nb-layout-motion-move: 0ms; }`。
- 时长写成 `ms` 或 `s` 的字面值：组件的 JS 也按它计时（过渡收尾、放下的滑回），`calc()` 这类写法 JS 读不出、当 0。

主题级的变量（承诺不随意改名）：

| 变量 | nb-ui 主题里的名字 | 回退 |
|---|---|---|
| `--nb-layout-motion-fast` | `--motion-fast` | `120ms` |
| `--nb-layout-motion-base` | `--motion-base` | `180ms` |
| `--nb-layout-motion-move` | `--motion-move` | `280ms` |
| `--nb-layout-motion-layout` | `--motion-layout` | `470ms` |
| `--nb-layout-ease-layout` | `--ease-layout` | `cubic-bezier(0.23, 1, 0.32, 1)` |
| `--nb-layout-sash-line-color` | `--sash-line-color` | `Highlight` |
| `--nb-layout-sash-line-size` | `--sash-line-size` | `3px` |
| `--nb-layout-sash-line-inset` | `--sash-line-inset` | `0px` |
| `--nb-layout-sash-line-radius` | `--sash-line-radius` | `0px` |
| `--nb-layout-sash-line-glow` | `--sash-line-glow` | `none` |
| `--nb-layout-drop-area-fill` | `--drop-area-fill` | 系统色（`Highlight` 12%） |
| `--nb-layout-drop-area-border` | `--drop-area-border` | 系统色（`Highlight` 70%） |
| `--nb-layout-scrim` | `--layout-scrim` | 系统色（压暗的 `Canvas`） |
| `--nb-layout-sector-fill` | `--layout-sector-fill` | 系统色（`Highlight` 5%） |
| `--nb-layout-sector-line` | `--layout-sector-line` | 系统色（`Highlight` 65%） |
| `--nb-layout-sector-active-fill` | `--layout-sector-active-fill` | 系统色（`Highlight` 12%） |
| `--nb-layout-sector-active-line` | `--layout-sector-active-line` | 系统色（`Highlight` 70%） |
| `--nb-layout-card-radius` | `--layout-card-radius` | `10px` |
| `--nb-layout-card-shadow` | `--layout-card-shadow` | 黑色投影加一圈系统色描边 |
| `--nb-layout-focus-ring` | `--focus-ring` | 系统色（`Highlight` 外圈） |
| `--nb-layout-focus-outline` | `--focus-outline` | `Highlight` |

其余变量（面、文字、线等通用令牌，两个落点浮层的层级，宿主旋钮与组件写在行内的几何）是内部名字，全部名单与回退在根入口导出的 `NB_LAYOUT_THEME_VARS` 里；宿主旋钮的用法见各组件的同名 `.md`。

## 文字

分隔条、可排序列表与浮动窗把手的读屏名称与提示经 `LAYOUT_TEXT_KEY`（`@notnotype/nb-layout/text`）注入的翻译函数取：`(key, params) => string`，键不带命名空间，宿主按命名空间 `nb-layout` 查自己的目录（`@notnotype/nb-layout/locales` 有 `en-US` 与 `zh-CN`，源语言 `NB_LAYOUT_SOURCE_LOCALE` 是 `en-US`）。函数要在每次调用时读宿主的当前语言，组件才会跟着换语言。没有注入时用自带的 `en-US` 目录。

只有一种语言、没有翻译引擎的宿主，用 `layoutCatalogTranslate` 按自带目录注入：

```ts
import {LAYOUT_TEXT_KEY, layoutCatalogTranslate} from "@notnotype/nb-layout/text";

createApp(App).provide(LAYOUT_TEXT_KEY, layoutCatalogTranslate("zh-CN"));
```

它固定这一种语言、不跟着宿主换；传自带目录里没有的语言（例如 `"zh"`）会抛 `RangeError`。目录不处理复数，`{{size}} pixels` 在 1 时读成“1 pixels”。

## 版本承诺

跨版本承诺不变的只有三样：主题级的一小批 CSS 变量（见“主题”）、README 里列出的 `data-*` 属性，以及标 `@stable` 的名字。`GridSnapshot` 的格式从 1.0 起才承诺兼容。

- **0.x 期间所有公开名字都标 `@experimental`**：签名与行为在次版本里都可能变，变了写在变更记录的“不兼容的改动”里。
- **标注在哪看**：编辑器里悬停（函数、类型、组件的声明上都有）。GitHub 仓库的 `packages/nb-layout/api/*.api.txt` 是每个入口一份的 API 报告，列着每个名字的标注与签名；变更记录在同一目录的 `CHANGELOG.md`。这两样不随 npm 包发布。
- **将来标 `@stable` 的条件**：名字所在的 Spec 已经实现、它签名里引到的公开名字也都是 `@stable`、并在变更记录里写明。`@stable` 承诺签名与 Spec 写的行为不做不兼容的改动：删名字、改名、新增必填参数或属性、参数类型变窄、返回类型变宽、删事件或让事件载荷变窄都算不兼容；加可选参数与属性、加事件不算。
- **API 报告看不到的**：运行时行为与 CSS；组件属性的缺省值是求值后的字符串。Vue 或 TypeScript 升级会让报告整批变化，报告头记着生成它的工具版本。

## 许可证

MIT，见包里的 `LICENSE`。它所在的仓库其余部分是 AGPL-3.0-only，只有这个包例外。
