# t16 计划：统一标签条

## Context

**要解决什么。** 工具面板的标签带（nb-ui `Tabs` 的 `adapt`）和编辑组的标签条（`EditorTabBar`）各写一份语义、方向键、插入判定；编辑组的标签条还在编辑组的内容里，所以每标签一实例（t17）做不了：内容项按标签分开之后，标签条不能住在某个标签的内容里。提案第 5 节要的是 `nb-layout` 提供一个标签条。

**期望结果。** 一个 `TabStrip`：工具面板和编辑组共用语义、方向键、Home、End、Alt 加方向键换序、菜单键、多行的纵向导航、插入判定；编辑组的标签条搬到面板头（和工具面板一样在外框里），内容从它下面开始。行为上用户看到的只多一件事：工具面板的标签也能 Alt 加方向键换序。

**依据。** [提案](../../../../../docs/proposals/workbench-single-tree-layout.md) 第 5 节；[workbench-layout](../../../../../docs/specs/ui/workbench-layout.md) 输出 19、20、21、25、31；[workbench.editor](../../../../../docs/specs/workbench/editor.md) 输出 53 到 56、58、59。

**开发者已确认。** 2026-11-06：统一标签条与每标签一实例单列 Task，排在 t07 与 t08 之间。工作方式按 autonomous-delivery，取舍记在 [待确认清单](../../pending-confirmations.md)。

## 技术选型

无新依赖。`adaptTabs`（nb-ui `tabs-adapt.ts`，纯函数）与 `rovingMove`、`moveRoving`（nb-ui `utils`）复用；nb-ui 的 `index.ts` 补导出 `adaptTabs`。nb-ui `Tabs` 留给别处（nb-story、Lab），不动。

## 关键设计

### `packages/nb-layout/src/vue/TabStrip.vue`（新增，同名 `.md`，Lab 场景）

只管结构与语义，外观由宿主给（`--tab-strip-*` 与插槽），和 `DropFeedbackOverlay` 一样不用原子类。

```ts
interface TabStripItem {
    id: string;            // 写到 data-panel-tab；事件原样带回
    title: string;         // adapt 的“更多”菜单、测量用；可访问名称另由 tab 插槽的内容决定
    partition?: string;    // 属于哪个分区，缺省第一个
    iconClass?: string;    // adapt 的“只留图标”
    tooltip?: string;
}
props: {
    items; active: string | null; label: string;                  // tablist 的名称
    partitions?: ReadonlyArray<{id: string; layout: "scroll" | "wrap"}>;   // 缺省一个分区
    overflow: "scroll" | "wrap" | "adapt";                        // 缺省 scroll；adapt 不和分区一起用
    maxRows?: number;      // wrap 的上限，超了纵向滚动
    maxItemWidth?: number; moreLabel?: string;                    // adapt
    dragHint?: string; tabIdOf?(id): string;                      // 与内容互相引用的 DOM id
    panelIdOf?(id): string;
}
slots: tab({item, active, level}) 放进 role=tab 的按钮；action({item, active}) 放在按钮之后（关闭、图钉不能嵌进按钮）；
emits: activate(id)、reorder(id, -1 | 1)、close(id)（Delete、中键）、keep(id)（双击）、context-menu(id, {x, y})
expose: focusTab(id)
```

DOM：`[data-tab-strip]` 根是 `tablist`，每个分区一个 `[data-tab-row="<分区>"]`，每个标签 `.nb-tab-frame > button[role=tab][data-panel-tab]`。

- **键盘**：沿用 `EditorTabBar` 的 `onKeydown`（←→、↑↓ 只在多行、Home、End、Alt+←→、Shift+F10 与菜单键、Delete），焦点跟到新标签。选中的标签是 Tab 停靠点。
- **滚动**：活动标签换了滚到完整可见（`EditorTabBar` 的 `reveal` 搬过来）。
- **adapt**：测量层与 `adaptTabs` 搬过来，`level` 经插槽交给宿主决定只留图标。放不下的收进末尾的“更多”（nb-ui `DropdownMenu`）。`Tabs` 的测量靠隐藏的同款盒子，这里测量层也渲染 `tab` 插槽。

### `packages/nb-layout/src/tab-strip-geometry.ts`（新增，从 `editor/web/tab-drag.ts` 的 `resolveStripInsertion` 搬）

`resolveTabStripInsertion(strip: Element, point, tabId, sameStrip) => {index, partition, indicator, inPlace} | null`：纯读 DOM，只认 `[data-tab-row]`、`[data-panel-tab]`。多行、分区、滚出视口的标签都在这里。两种标签条共用，工作台的 `insertionIn` 删掉。同一个函数给 `visibleTabStops(strip)`：看得见的插入位，键盘用，所以滚出视口的不再算（t07 审查 G5）。

`EditorTabDrag.insertion` 随之删掉：工作台直接量 `[data-panel-strip=<面板>] [data-tab-strip]`。放下仍走 `EditorTabDrag.drop(tabId, action, part)`，`part` 是分区。

### 工具面板：`WorkbenchPanelHead`

标签带换成 `TabStrip overflow="adapt"`，外观在 `WorkbenchPanelHead.vue` 的样式里，和现在一样（下划线指示、`sm` 字号与内边距）。新增 `reorder` 事件接 store 的 `reorderTab(key, delta)`（`moveTabToStrip` 的 `activate: false`）。

### 编辑组：面板头搬到外框

- 贡献点 `workbench.editor-area` 的 `EditorAreaParts` 加 `head`（按面板 id 渲染）。`WorkbenchSurface` 的 `head` 插槽给所有面板，`WorkbenchShell` 按角色画 `WorkbenchPanelHead` 或 `editorArea.head`；编辑器未交付时头是空的。
- `EditorGroupHead.vue`（新增）：从 `EditorGroup` 搬出提示条（`area.notice`）、标签条、标题动作、标签的右键菜单。`EditorTabBar` 只剩标签的内容与样式，包一个 `TabStrip`，`partitions` 由 `wrapTabs` 定（多行：固定一行滚动、普通一行折行；单行：一个分区）。
- `EditorGroup` 只留面包屑、进度条、横幅与控件。
- **内容的上边**：编辑组的 `insetTop` 不再是 0，是头的实测高度（1 到 3 行加提示条）。`WorkbenchSurface` 观察每块编辑组头的高度（`ResizeObserver`），`layoutContents(doc, editorHeads)` 用它。**头高变了内容立刻跟，不做 470ms 的过渡**：`decideMotion` 把“只有 inset 变了、叶矩形都没变”判成瞬时。组矮时头的 `max-height` 给正文留一行字（现在靠 flex，头搬走之后靠 `calc(100% - 44px)`）。
- **标记**：`data-editor-group`、`data-editor-group-active` 同时写在头的根与内容根，所以 `[data-editor-group="g0"] [data-editor-tab]` 与 `[data-editor-group="g0"] textarea` 都还成立；只有取根元素本身（量矩形）的 e2e 要改成 `[data-shell-card]`。`data-panel-strip` 写在头里标签条的外层（工具面板也写，`data-panel-head` 只留给头）。键位、`focusin`、`focusout`、主键按下换活动组、文件拖放落点，头的根与内容根都接：抽成 `useEditorGroupRoot(groupId)`。

### 关闭

提案写的工作台发起的两阶段关闭（`requestClose`）**不做**：标签条画在编辑器自己的头里，关闭由编辑器发起，结算之后才从布局拿掉，“关闭进行中再次关闭被忽略”编辑器区已经做到。工作台没有发起关闭的入口，这个接口没有调用方。t09 的浮动窗如果要整窗关闭，到时候再加（偏离提案，记入待确认清单）。

### 当前标签的样式（Spec 输出 19）

Spec 写“加粗的正文色”，实际是下划线加变色（旧外壳就如此）。改 Spec 跟实际：开发者一直看的是这个，也说过没有问题（记入待确认清单）。

## Spec 与文档改动

- `ui/workbench-layout.md`：输出 19（当前标签）、20（Alt 加方向键换序）、21（编辑组的头在外框里）、“边界与兼容”的贡献点与标记。
- `workbench/editor.md`：输出 53 到 56 的结构描述，`data-panel-strip` 位置；不改行为。
- 提案追加决策记录：`requestClose` 不做。
- 组件 `.md`：`TabStrip` 新建；`EditorTabBar`、`EditorGroup`、`EditorHost`、`WorkbenchPanelHead`、`WorkbenchSurface` 同步；`EditorGroupHead` 新建。

## 切片

| 片 | 内容 | 自跑验证 |
|---|---|---|
| 1 | `TabStrip`（scroll、wrap、分区、键盘）、`tab-strip-geometry`、Lab 场景、DOM 与 e2e 用例；不接产品 | `nb-layout` 单元，`lab-tab-strip` |
| 2 | `adapt` 模式；`WorkbenchPanelHead` 换上，store 的 `reorderTab`；`layout-drag` 用新几何 | `workbench-views`、`workbench-dnd` |
| 3 | 编辑组：`EditorGroupHead`、头搬到外框、`insetTop`、`decideMotion`；`EditorTabBar` 换上，`EditorTabDrag.insertion` 删掉；Lab 夹具 | `editor-area`、`lab-editor`、`editor-types`、`markdown-editing`、`files-explorer`、`editor-code-settings`、`markdown-input`、`themes`（`NB_E2E_WIDE`：编辑组的 DOM 结构变了，这些都写死了选择器） |

一个分支，整个 Task 合入。

## 验收映射

| 判据 | 覆盖 |
|---|---|
| 工具面板、编辑组的方向键、Home、End、菜单键行为不变 | `workbench-views`、`editor-area` 现有用例 |
| Alt+←→ 工具面板标签换序，活动标签不变（输出 20） | `workbench-views` 新增 |
| 多行插入、固定分区、滚出视口 | `lab-tab-strip` 新增；`editor-area` 现有 |
| 键盘拖动不停在滚出视口的标签上（G5） | `editor-area` 新增（关掉多行、标签多到滚动） |
| 头高变化内容立刻跟，不过渡 | `grid-motion.test.ts` 表驱动；`editor-area` 新增：多行从 1 变 2 时正文上边与头的下边贴着 |
| 组矮时正文至少留一行字 | `editor-area` 现有用例 |
| 编辑器未交付时工作台照常 | `workbench-shell` 现有 |

## 验证

单元：`bun run test:affected --since master`（提交前缺省只看未提交的改动，提交后要带 `--since`）。e2e 见切片。真实窗口手感由开发者在 4217 确认。未验证边界：读屏实测。

## 不做与风险

- 不做 `requestClose`（上面）。
- 工具面板的标签不能关闭（声明消失的占位除外，关闭按钮在占位里）。
- **风险**：编辑组的 DOM 结构变了，16 个文件写死了 `data-editor-group`。标记两处都写让大多数不用改；量根元素的要改。
- **风险**：内容项和头分开之后，头与正文之间不再有 flex：头高要先测才知道正文从哪开始，第一帧可能差一行。首次挂载时 `insetTop` 用单行高度 34，测到之后改；打开时只差 0 到 2 行，不做过渡，不可见。
