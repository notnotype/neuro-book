# t16 计划：统一标签条

## Context

**要解决什么。** 工具面板的标签带（nb-ui `Tabs` 的 `adapt`）和编辑组的标签条（`EditorTabBar`）各写一份语义、方向键、插入判定；编辑组的标签条还在编辑组的内容里，所以每标签一实例（t17）做不了：内容项按标签分开之后，标签条不能住在某个标签的内容里。提案第 5 节要的是 `nb-layout` 提供一个标签条。

**期望结果。** 一个 `TabStrip`：工具面板和编辑组共用语义、方向键、Home、End、Alt 加方向键换序、菜单键、多行的纵向导航、插入判定；编辑组的标签条搬到面板头（和工具面板一样在外框里），内容从它下面开始。行为上用户看到的只多一件事：工具面板的标签也能 Alt 加方向键换序。

**依据。** [提案](../../../../../docs/proposals/workbench-single-tree-layout.md) 第 5 节；[workbench-layout](../../../../../docs/specs/ui/workbench-layout.md) 输出 19、20、21、25、31；[workbench.editor](../../../../../docs/specs/workbench/editor.md) 输出 53 到 56、58、59。

**开发者已确认。** 2026-11-06：统一标签条与每标签一实例单列 Task，排在 t07 与 t08 之间。工作方式按 autonomous-delivery，取舍记在 [待确认清单](../../pending-confirmations.md)。

## 技术选型

无新依赖。nb-ui `Tabs` 留给别处（nb-story、Lab），行为不动。它的宽度适配抽成组合式 `useTabsAdapt`（测量、`adaptTabs`、观察尺寸），连同 `rovingMove`、`moveRoving` 从 nb-ui 公开入口导出，`Tabs` 与 `TabStrip` 共用，不复制（审查第 14 条）。

## 关键设计

### `packages/nb-layout/src/vue/TabStrip.vue`（新增，同名 `.md`，Lab 场景）

只管结构与语义，外观由宿主写。两种外观（下划线；块状加竖线分隔）靠变量表达不了，所以 `.md` 把钩子列成公开合同（`[data-tab-strip]`、`[data-tab-row]`、`.nb-tab-frame`、`[data-panel-tab]`、`[data-tab-level]`），宿主用 `:deep` 写，改它们算改接口（审查第 9 条）。

```ts
interface TabStripItem {
    id: string;            // 写到 data-panel-tab；事件原样带回
    title: string;         // 缺省内容、“更多”菜单与只留图标时的可访问名称
    partition?: string;    // 写到 data-tab-partition，插入判定要用；缺省第一个分区
    iconClass?: string;    // 缺省内容的图标；adapt“只留图标”看它
    tooltip?: string;
    attrs?: Readonly<Record<string, string>>;  // 写到 role=tab 的按钮上（data-editor-tab*、aria-description）
}
props: {
    items; active: string | null; label: string;                  // tablist 的名称
    partitions?: ReadonlyArray<{id: string; layout: "scroll" | "wrap"}>;   // 缺省一个分区
    overflow: "scroll" | "wrap" | "adapt";                        // 缺省 scroll；adapt 不和分区、tab 插槽一起用
    maxItemWidth?: number; moreLabel?: string;                    // adapt
    dragHint?: string; tabIdOf?(id): string; panelIdOf?(id): string;
}
slots: tab({item, active}) 放进 role=tab 的按钮，缺省是图标加标题；action({item, active}) 放在按钮之后（关闭、图钉不能嵌进按钮）
emits: activate(id)、reorder(id, -1 | 1)、close(id)（Delete、中键）、keep(id)（双击）、context-menu(id, {x, y})
expose: focusTab(id)
```

和提案第 5 节的差别：`canInsert` 不进标签条（分区限制在 `area.moveTab` 里，标签条只报插入位与分区）；`trailing` 插槽不要（工具面板的动作、编辑组的标题动作都在头里、标签条外面，标签条自己不需要知道）。

DOM：`[data-tab-strip]` 根是 `tablist`，每个分区一个 `[data-tab-row="<分区>"]`，每个标签 `.nb-tab-frame > button[role=tab][data-panel-tab][data-tab-partition]`。

- **键盘**：沿用 `EditorTabBar` 的 `onKeydown`（←→、↑↓ 只在多行、Home、End、Alt+←→、Shift+F10 与菜单键、Delete），焦点跟到新标签。选中的标签是 Tab 停靠点。
- **滚动**：活动标签换了滚到完整可见（`EditorTabBar` 的 `reveal` 搬过来）。
- **adapt**：只用缺省内容（图标加标题），测量层就是同款盒子，不渲染插槽，所以没有重复实例的问题（审查第 13 条）。“只留图标”时按钮 `aria-label` 是 `title`。放不下的收进末尾的“更多”（nb-ui `DropdownMenu`）。工具面板的标签都是图标加标题，够用。

### `packages/nb-layout/src/vue/tab-strip-geometry.ts`（新增，从 `editor/web/tab-drag.ts` 的 `resolveStripInsertion` 搬）

读 DOM，所以在 `src/vue/`，不进纯 TS 的核心入口（审查第 1 条：核心的 tsconfig 没有 DOM 类型）。

`resolveTabStripInsertion(strip: Element, point) => {before: string | null; after: string | null; partition: string | null; indicator} | null`：只认 `[data-tab-row]`、`[data-panel-tab]`、`[data-tab-partition]`。返回**邻居的标签键**，不返回下标（审查第 2 条）：收进“更多”的标签不在 DOM 里，单行时固定与普通同在一行，下标与分区都要宿主按文档换算。

`tabStripStops(strip) => ReadonlyArray<{before: string | null; point}>`：看得见的插入位，键盘用，所以滚出视口的不算（t07 审查 G5）。

工作台的 `layout-drag.ts` 一条路径处理两种标签条：`stripDrop(source, panel, point)` 量 `[data-tab-strip]`，按文档把 `before` 换成 `index`，判原位（同一面板、同一分区、紧挨着自己），`partition` 作为 `part`。工作台的 `insertionIn` 与 `EditorTabDrag.insertion` 都删掉。放下仍走 `EditorTabDrag.drop(tabId, action, part)`。`enumerateDropCandidates` 的 `stripCount` 换成 `stripIndexes(panel)`：宿主按看得见的插入位给文档下标（审查第 10 条）。键盘够不到滚出视口的位置，能放到中央。

工具面板的标签条矩形还是整个面板头（标题、动作区都算，动作区经 `data-no-drag` 不接收），编辑组是头里写 `data-panel-strip` 的那一行（审查第 15 条）。只写标题的头没有 `[data-tab-strip]`，落在上面是中央（片 7c）。

### 工具面板：`WorkbenchPanelHead`

标签带换成 `TabStrip overflow="adapt"`，外观在 `WorkbenchPanelHead.vue` 的样式里，和现在一样（下划线指示、`sm` 字号与内边距；`workbench-views` 的 `data-tabs-level`、`data-tabs-more` 这些标记由 `TabStrip` 写同名的）。新增 `reorder` 事件接 store 的 `reorderTab(key, delta)`（`moveTabToStrip` 的 `activate: false`）。

### 编辑组：面板头搬到外框

- 贡献点 `workbench.editor-area` 的 `EditorAreaParts` 加可选的 `head`（按面板 id 渲染；探针插件与 `sample-views` 的提供者不给）。`WorkbenchSurface` 的 `head` 插槽给所有面板，`WorkbenchShell` 按角色画 `WorkbenchPanelHead` 或 `editorArea.head`；没有 `head`（编辑器未交付、提供者不给）时不画，`insetTop` 是 0。
- `EditorGroupHead.vue`（新增）：从 `EditorGroup` 搬出提示条（`area.notice`）、标签条、标题动作（含算预算的 `ResizeObserver`）、标签的右键菜单。`EditorTabBar` 只剩标签的内容与样式，包一个 `TabStrip`，`partitions` 由 `wrapTabs` 定（多行：固定一行滚动、普通一行折行；单行：一个分区）。`maxRows` 用 CSS 在 `EditorTabBar` 的样式里写。
- `EditorGroup` 只留面包屑、进度条、横幅与控件。`returnFocus` 的回退到头里找标签（审查第 11 条）。
- **内容的上边**：`layoutContents(doc, headHeightOf)`：工具面板是 `PANEL_HEAD_HEIGHT`，编辑组是头的实测高度（1 到 3 行加提示条），没测到是 0。`WorkbenchSurface` 经 `ResizeObserver` 观察头的高度；它的回调在绘制之前，第一帧就是对的，不用猜一个缺省。t17 的内容项按标签分开时只改 `layoutContents` 的内容项，头高的来路不变（审查第 16 条）。
- **头高变了不做 470ms 的过渡**：`placementMoved` 比内容矩形时不算 `insetTop`（比 `y - insetTop`）：只有 inset 变了不算程序布局变化。外框正在过渡时（开关侧栏）标签又折行，内容仍带着过渡，新的一行会被盖一小会儿：接受（审查第 4 条），很少见，470ms 就好了。
- **组矮的时候**：头的 `max-height: calc(100% - 56px)`，给正文留面包屑 26、进度条 2、一行字 28（审查第 5 条）；标签条在头里 `flex: 0 1 auto`、`min-height` 一行、纵向滚动。横幅不算在内：有横幅时正文自己滚。
- **内容裁切框**：编辑组内容的上圆角去掉（头在上面），飞行中的底色不变；卡片的上圆角由外框给头（审查第 17 条）。
- **标记**：`data-editor-group`、`data-editor-group-active` 只留在内容根（每组一个，t17 之后是活动标签的内容根，还是一个），头的根写 `data-editor-group-head`（审查第 6 条：两处都写，计数和 `boundingBox` 的 54 处都要改）。e2e 里 `[data-editor-group="g0"] [data-editor-tab…]` 这类约 20 行改成 `data-editor-group-head`；`EditorHost` 的 `closest` 两个都认。`data-panel-strip` 写在头里标签条那一行。
- **头和内容一起算这块编辑组**：键位、`focusin`、`focusout`、主键按下换活动组抽成 `useEditorGroupRoot(groupId)`，两个根都用。标题动作“随鼠标显示”改用 `WorkbenchSurface` 现成的 `data-hover-actions-scope`（表面按指针与焦点所在的面板写），编辑组也写（审查第 3 条）；现在的 `[data-editor-group]:hover` 规则删掉。
- **文件拖到编辑组**：`useDropTarget` 登记在内容根，反馈矩形要是整块编辑组（审查第 8 条）：落点的高亮改量 `[data-shell-card]`；头也登记同一个落点，指针在标签条上也能放。具体看 `useDropTarget` 的接口，t10 会把这段换成工作台的会话。

### 关闭

提案写的工作台发起的两阶段关闭（`requestClose`）**不做**（偏离提案，记入待确认清单）：标签条画在编辑器自己的头里，关闭由编辑器发起，结算之后才从布局拿掉；工作台没有发起关闭的入口，这个接口没有调用方。提案写的“关闭进行中，再次关闭被忽略”现在的行为是后一次询问取消前一次（`area.ask`），结果同样只关一次，行为不变，Spec 不写前者。t09 的浮动窗如果要整窗关闭，到时候再加。t07 计划把它推给 t16 的那句、t16 的目标改掉（审查第 12 条）。

### 当前标签的样式（Spec 输出 19）

Spec 写“加粗的正文色”，实际工具面板是下划线加变色（旧外壳就如此），编辑组是块状（`workbench/editor.md` 输出 53）。改 Spec 跟实际，分开写两种。没有记录的理由，是我的推断：代码一直如此，开发者试过几轮没提（记入待确认清单）。

## Spec 与文档改动

- `ui/workbench-layout.md`：输出 19（当前标签）、20（Alt 加方向键换序）、21（编辑组的头在外框里）、“边界与兼容”的贡献点与标记。
- `ui/nested-grid.md`：内容层的 inset 可以变，只有 inset 变了不过渡（“内容层”“过渡”、验收 10）。
- `workbench/editor.md`：输出 53 到 56 的结构描述，`data-panel-strip` 位置；不改行为。
- 提案追加决策记录：`requestClose` 不做。
- 组件 `.md`：`TabStrip` 新建；`EditorTabBar`、`EditorGroup`、`EditorHost`、`WorkbenchPanelHead`、`WorkbenchSurface` 同步；`EditorGroupHead` 新建。

## 切片

| 片 | 内容 | 自跑验证 |
|---|---|---|
| 1 | `TabStrip`（scroll、wrap、分区、键盘）、`tab-strip-geometry`、Lab 场景、DOM 与 e2e 用例；不接产品 | `nb-layout` 单元，`lab-tab-strip` |
| 2 | `adapt` 模式；`WorkbenchPanelHead` 换上，store 的 `reorderTab`；`layout-drag` 用新几何 | `workbench-views`、`workbench-dnd` |
| 3 | 编辑组：`EditorGroupHead`、头搬到外框、`insetTop`、`placementMoved`；`EditorTabBar` 换上，`EditorTabDrag.insertion` 删掉；Lab 夹具 | `editor-area`、`lab-editor`、`editor-types`、`markdown-editing`、`files-explorer`、`editor-code-settings`、`markdown-input`、`themes`（`NB_E2E_WIDE`：编辑组的 DOM 结构变了，这些都写死了选择器） |

一个分支，整个 Task 合入。

## 验收映射

| 判据 | 覆盖 |
|---|---|
| 工具面板、编辑组的方向键、Home、End、菜单键行为不变 | `workbench-views`、`editor-area` 现有用例 |
| Alt+←→ 工具面板标签换序，活动标签不变（输出 20） | `workbench-views` 新增 |
| 多行插入、固定分区、滚出视口 | `lab-tab-strip` 新增；`editor-area` 现有 |
| 键盘拖动不停在滚出视口的标签上（G5） | `editor-area` 新增（关掉多行、标签多到滚动） |
| 头高变化内容立刻跟，不过渡 | `grid-motion` 单元（只有 inset 变不算移动）；`editor-area` 新增：多行从 1 变 2 时正文上边与头的下边贴着 |
| 组矮时正文至少留一行字 | `editor-area` 现有用例 |
| 编辑器未交付时工作台照常 | `workbench-shell` 现有 |

## 验证

单元：`bun run test:affected --since master`（提交前缺省只看未提交的改动，提交后要带 `--since`）。e2e 见切片。真实窗口手感由开发者在 4217 确认。未验证边界：读屏实测。

## 不做与风险

- 不做 `requestClose`（上面）。
- 工具面板的标签不能关闭（声明消失的占位除外，关闭按钮在占位里）。
- **风险**：编辑组的 DOM 结构变了，12 个 e2e 文件与 `scripts/perf` 写死了 `data-editor-group`，约 20 行选择器要改（派 Sonnet 或 Haiku，规则写死），量根元素矩形的用例按新结构判断。
- **风险**：头与正文之间不再有 flex，高度靠测量。测量在绘制之前完成；`NestedGrid` 的内容矩形晚一拍时（发布在 `flush: post`）第一帧可能差，片 3 用 e2e 读第一帧核实。
