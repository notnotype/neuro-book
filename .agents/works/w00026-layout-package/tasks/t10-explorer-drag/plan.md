# t10 计划：资源树拖到编辑区与浮动打开

## Context

**要解决什么。** 资源树拖出树外现在只有“在这一组打开”（整组一个落点），别的地方没有落点。t01 决定 5：出树之后走工作台同一套：编辑组中央打开、标签条插入、四边拆分；没有落点就在松手处浮动打开，多个文件开成一个窗里的多个标签，最多 10 项；目录不能打开，只有目录时取消。树内是文件操作，不变。

**依据。** t01 决定 5、6；[提案](../../../../../docs/proposals/workbench-single-tree-layout.md)第 3 节“资源树”；[ui/workbench-layout](../../../../../docs/specs/ui/workbench-layout.md) 输出 25、26、37、39；[workbench/files-explorer](../../../../../docs/specs/workbench/files-explorer.md)“拖到编辑区”、验收 26；`workbench/editor.md` 输出 35。

**开发者已确认。** 决定 5、6。2026-11-06“t11、t12、t14 先不做”：窗口外没有操作系统级窗口，回退成应用内浮动（输出 39 已写）。

## 技术选型

无。

## 关键设计

### 合同：`workbench/shared/contracts.ts`

取代 `editor/shared/contracts.ts` 的 `EDITOR_GROUP_FILE`（提案：资源树不再读编辑组的标记）。外壳根登记一个落点种类，资源树经 `dropTargetAt` 找到它，所以被菜单、对话框挡住时找不到（现成行为），也不用新服务。

```ts
export interface WorkbenchFileDrop {
    readonly action: LayoutDropAction;
    readonly part?: string;
    /** 比较键：`float` 的矩形每帧变，不算。 */
    readonly key: string;
    readonly preview: DropFeedbackPreview;
    readonly sectors: {rect; items; active} | null;
    /** 反馈的文字。 */
    readonly label: string;
}
export const WORKBENCH_FILE_DROP = defineDropKind<{
    /** 指针下文件能落到哪；`top` 是指针处最上层的元素，窗口外是 null。 */
    resolve(point, top): WorkbenchFileDrop | null;
    commit(drop: WorkbenchFileDrop, addresses: ReadonlyArray<string>): void;
}>("nbook.workbench.file");
```

### 判定：`layout-doc.ts`、`layout-drop.ts`、`layout-drag.ts`

- `LayoutSource` 加 `{kind: "new"; tabs: ReadonlyArray<TabRef>}`：文档里还没有的标签。`sourceTabs` 返回它，接受矩阵照问；`applyLayoutDrop` 对它给预览用的结果：中央、标签条 `insertTab`，外缘 `openPanelAtEdge`，所以原位判定是假、外缘的矩形是真实结果（`previewEdgeDrop`）。提交不走这里。
- `createLayoutDrag` 多一个 `fileDrop(point, top)`：`data-no-drag` 上 null，其余走 `dropAt(FILE_SOURCE, point, null)`：同一份规则、分区、标签条插入（编辑组的分区由 `part` 带）。没有落点就是 `floatDrop`。活动栏上段 `barDrop` 是 null，不开窗。这一场不是外壳的会话，不走实时布局。
- 判定每次都量 DOM，和落点指示一样。

### 提交：`layout-doc-store.ts`、编辑器

- `store.commitFiles(addresses, action, part)` → `EditorTabDrag.openFiles(addresses, action, part)`。没有编辑器时没有落点（`fileDrop` 返回 null）。
- `area.openFiles` 放在 `tab-drag.ts`：
  - 中央：`open(address, {mode: "permanent", group})` 逐个。
  - 标签条：先打开，再 `moveTab` 到落点（同文件已在这组时只是移动），分区按 `part`。
  - 外缘、浮动：先建空组（`PanelTree.openAt(target)`、`PanelTree.openFloat(rect)`），再打开到那一组，所以别的组已有同一文件时不抢它的标签，新组里开一个新标签。一个都没打开成：`PanelTree.closeEmpty(group)`。
- nb-layout 加 `openFloatPanel(doc, {id, panel, rect})`、`closeEmptyPanel(doc, id)`（复用 `settleEmptyPanel`）。

### 资源树：`explorer/web`

- `tree-drag.ts`：树外 `dropTargetAt(top ?? root, WORKBENCH_FILE_DROP)`：窗口外 `top` 是 null，从树自己往上找外壳。目标 `{kind: "editor", drop, commit}`。
- `actions/drop.ts`：`DropOver` 的 `editor` 带 `drop`；`resolveEditorDrop` 不变（目录跳过、最多 10 项），`DropAction` 的 `open` 带 `drop`；`dropKey` 用 `drop.key`。
- `controller.ts`：`open` 动作调 `commit(drop, addresses)`，放下时 `options.commands` 那条逐个打开的路径去掉；焦点、错误提示由编辑器（`area.notice`）给。
- `ExplorerTree.vue`：反馈从 `drop.preview` 画（`DropFeedbackOverlay`），`drop.sectors` 画 `DropSectorsOverlay`，拖影文字：`tree.drop.open` 不变，浮动写 `tree.drop.float`。

### 编辑器退役

`useEditorGroupRoot` 不再登记落点，`EDITOR_GROUP_FILE` 删除。`data-editor-group` 还给 e2e 与样式用，不动。

## Spec 与文档改动

- `workbench/files-explorer.md`：“拖到编辑区”改写，“放在没有落点处”取消的说法改；验收 26 扩写。
- `workbench/editor.md` 输出 35：删落点登记。`ui/workbench-layout.md` 输出 39：加文件。
- 组件 `.md`：`ExplorerTree`、`EditorGroup`。提案不用追加：和第 3 节一致。

## 切片

| 片 | 内容 | 自跑验证 |
|---|---|---|
| 1 | nb-layout：`new` 来源、`openFloatPanel`、`closeEmptyPanel` | `layout-doc.test.ts`、`layout-drop.test.ts` |
| 2 | 工作台、编辑器：`fileDrop`、`openFiles` | `area.test.ts` |
| 3 | 资源树、Spec | `transfer.test.ts`、`files-explorer.e2e` |

## 验收映射

| 判据 | 覆盖 |
|---|---|
| 拖到编辑组中央：正式标签打开在那一组，成为活动组，磁盘不变 | `files-explorer.e2e`（验收 26） |
| 标签条插入位；四边拆分：新组、别的组已有同一文件不抢 | `files-explorer.e2e`、`area.test.ts` |
| 没有落点（工具面板上、窗口外）：浮动打开；多个文件一个窗多个标签，最多 10 项，标签说明 | `files-explorer.e2e`、`area.test.ts` |
| 只有目录：没有落点，取消 | `files-explorer.e2e` |
| 被对话框挡住、按钮区：不开窗 | `files-explorer.e2e` |
| 树内不变 | `files-explorer.e2e` 现有用例 |

## 不做与风险

- 操作系统级窗口（t12）；实时布局（树的拖动不是外壳的会话，落点指示）。
- 拖到工具面板上松手开窗：可能是拖错；决定 6 如此，Esc 取消。
