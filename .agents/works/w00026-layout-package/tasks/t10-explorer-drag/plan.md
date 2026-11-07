# t10 计划：资源树拖到编辑区与浮动打开

## Context

**要解决什么。** 资源树拖出树外现在只有“在这一组打开”（整组一个落点），别的地方没有落点。t01 决定 5：出树之后走工作台同一套：编辑组中央打开、标签条插入、四边拆分；没有落点就在松手处浮动打开，多个文件开成一个窗里的多个标签，最多 10 项；目录不能打开，只有目录时取消。树内是文件操作，不变。

**依据。** t01 决定 5、6；[提案](../../../../../docs/proposals/workbench-single-tree-layout.md)第 3 节“资源树”；[ui/workbench-layout](../../../../../docs/specs/ui/workbench-layout.md) 输出 25、26、37、39；[workbench/files-explorer](../../../../../docs/specs/workbench/files-explorer.md)“拖到编辑区”、验收 26；`workbench/editor.md` 输出 35。设计审查 [`evidences/plan-review.txt`](evidences/plan-review.txt)。

**开发者已确认。** 决定 5、6。2026-11-06“t11、t12、t14 先不做”：窗口外没有操作系统级窗口，回退成应用内浮动（输出 39 已写）。

**待确认的偏离（照做，进待确认清单，提案追加决策记录）。**
1. 提案写“一场拖动归工作台的会话”，这里保留资源树自己的会话，出树后只用工作台的落点规则，没有实时布局。树内要令牌冻结、`previewDrop`、边缘滚动与飞回，接到外壳会话要改一大片；Task 本身写着“实在难就全程用 VS Code 模式”。
2. 决定 6 在资源树自己的面板里收窄：指针还在拖动源所在的那块面板（树上下的横条、面板头、滚动条）时松手取消，不开窗。往树下边缘自动滚动时过冲是最常见的路径，开出一个窗不是用户要的。

## 技术选型

无。

## 关键设计

### 合同：`workbench/shared/contracts.ts`

取代 `editor/shared/contracts.ts` 的 `EDITOR_GROUP_FILE`（提案：资源树不再读编辑组的标记）。外壳根登记一个落点种类，资源树经 `dropTargetAt` 找到它，被 Teleport 出去的菜单、对话框挡住时自然找不到。

`shared/` 要过服务端 `tsc`（没有 DOM）：负载不写 `Element` 与 `./vue` 的类型。

```ts
export interface WorkbenchFileDrop {
    readonly action: LayoutDropAction;
    readonly part?: string;
    /** 比较键：`[layoutDropKey(action), part]`；`float` 的矩形每帧变，不算。 */
    readonly key: string;
    /** 拖影上的字：外壳的落点文字（放在这里、拆到这一边、浮动打开……）。 */
    readonly label: string;
}
export interface WorkbenchFileDropHost {
    /** 指针下文件能落到哪；`top` 是指针处最上层的元素（窗口外是 null），类型不带 DOM。 */
    resolve(point: GridDropPoint, top: unknown): WorkbenchFileDrop | null;
    /** 反馈归外壳画（`WorkbenchDragFeedback`：矩形、插入线、分区与读屏）：资源树只报这一刻的落点。 */
    show(drop: WorkbenchFileDrop | null): void;
    commit(drop: WorkbenchFileDrop, addresses: ReadonlyArray<string>): void;
}
export const WORKBENCH_FILE_DROP = defineDropKind<WorkbenchFileDropHost>("nbook.workbench.file");
```

### 判定：`nb-layout/src/layout-drop.ts`、`workbench/web/layout-drag.ts`

- `LayoutSource` 不动（会话、提交、实时布局、键盘都用它）。`layout-drop.ts` 加 `LayoutDropSource = LayoutSource | {kind: "new"; tab: TabRef}`，只有 `sourceTabs`、`resolveLayoutDrop`、`layoutDropPanelAt`、`layoutDropSectors`、`applyLayoutDrop`、`previewEdgeDrop` 接受它。`applyLayoutDrop` 对 `new` 给预览用的结果：中央、标签条 `insertTab`，外缘 `openPanelAtEdge`，提交不走这里。
- `layout-drag.ts` 整理（和 t09 审查第 14 条一起）：判定拆成 `dropFor(doc, source, resolved, point, input)`（有落点时算 preview 与分区）；`tabDrop`（标签）、`windowDrop`（整窗）、`fileDrop`（文件）三个入口，各自写“没有落点是什么”：标签是 `floatDrop`；整窗是移动；文件是 `floatDrop`，来源不查文档。文件这一路不用 `previews` 缓存、不读 `frozen` 与预备区。活动栏上段是 null，不开窗。
- `canFloat`、最小尺寸按来源分：`new` 只查窗数上限，最小尺寸是编辑组的 `EDITOR_GROUP_MINIMUM`。没有编辑器时（`editorTabs()` 是 null）没有落点。

### 反馈：`WorkbenchShell`

外壳登记 `WORKBENCH_FILE_DROP`（`registerDropTarget(hostEl, ...)`），持有 `fileDrop` 这份状态，`dropFeedback` 里和会话的落点一样画（`WorkbenchDragFeedback`，没有拖影）。文字走现成的 `dropLabel`。`data-drop-kind` 探针因此也有了。

### 提交：编辑器

- `store.commitFiles(addresses, action, part)` → `EditorTabDrag.openFiles(addresses, action, part)`。
- `tab-drag.ts` 的 `openFiles`：
  - 先定地方。中央、标签条：目标组。外缘、浮动：先建空组（`PanelTree.openAt(target)`，`openAtEdge` 成为它的特例；`PanelTree.openFloat(rect)`），和 `sideGroup` 同样的先例，所以别的组已有同一文件时不抢它的标签，新组里开一个新标签。
  - 标签条：**第一次打开之前**把下标换成标签 id（`before`），并排除属于被放下文件的标签（它们会被复用）；之后逐个打开、逐个 `moveTab(..., {before})`，所以多个文件按拖动顺序排在它前面。`refusal.samePlace` 算成功。分区按 `part`。
  - 遇到拒绝（目标组有未裁决输入）就停：`leave` 已经写了提示。新建的空组 `leave` 恒为真，能失败的只有区域已销毁，不做“开不成就关组”。
- nb-layout 加 `openFloatPanel(doc, {id, panel, rect})`：查窗数上限。

### 资源树：`explorer/web`

- `tree-drag.ts`：树外先看是不是还在拖动源那块面板里（`root.closest("[data-content-leaf]")` 的叶 id，`top` 在同一叶的外框或内容里）：是就 null，取消。否则 `dropTargetAt(top ?? root, WORKBENCH_FILE_DROP)`：窗口外 `top` 是 null，从树自己往上找外壳。目标 `{kind: "editor", host, drop}`。
- `actions/drop.ts`：`DropOver` 的 `editor` 带 `host`、`drop`；`resolveEditorDrop(sources, over, rowOf)`（目录跳过、最多 10 项）；`DropAction` 的 `open` 带它们；`dropKey` 用 `drop.key` 加地址。
- `controller.ts`：`open` 动作调 `host.commit(drop, addresses)`；`openDropped` 那条逐个执行命令的路径去掉。`editor-missing` 在拖动上不再出现：没有编辑器时没有落点。
- `ExplorerTree.vue`：hover 变化时 `host.show(drop)`，结束时 `host.show(null)`；`DropFeedbackOverlay` 去掉；拖影文字：有 `open` 时取 `drop.label`，超出 10 项另说明（`tree.drop.openSome`），`tree.drop.open` 退役。

### 编辑器退役

`EDITOR_GROUP_FILE` 删除（`git grep` 为零）。`useEditorGroupRoot` 去掉落点登记与 `root` 参数、`groupRect`。`data-editor-group` 还给 e2e 与样式用，不动。

## Spec 与文档改动

- `workbench/files-explorer.md`：“拖到编辑区”改写：**被替换的判据**：高亮整组（头加内容）换成工作台的落点（中央是正文、标签条是插入线、外缘是真实矩形、开着分区时有分区）；“放在没有落点处取消”改成：编辑区以外的别的面板、窗口外浮动打开，拖动源那块面板里、活动栏上取消；验收 26 改写。
- `workbench/editor.md` 第 20 行“非目标”、输出 35 的落点登记。`ui/workbench-layout.md` 输出 39 加文件；输出 21 的“头和内容一起算”核对。`ui/layout-drag.md` 验收 2 的说法。
- 组件 `.md`：`ExplorerTree`、`EditorGroup`、`EditorGroupHead`、`WorkbenchShell`。提案追加决策记录。

## 切片

| 片 | 内容 | 自跑验证 |
|---|---|---|
| 1 | nb-layout：`LayoutDropSource`、`openFloatPanel` | `layout-doc.test.ts`、`layout-drop.test.ts` |
| 2 | 工作台、编辑器：`fileDrop`、外壳的反馈、`openFiles`、`PanelTree` | `area.test.ts` |
| 3 | 资源树、退役、Spec | `transfer.test.ts`、`actions/plan.test.ts`、`files-explorer.e2e` |

## 验收映射

| 判据 | 覆盖 |
|---|---|
| 拖到编辑组中央：正式标签打开在那一组，成为活动组，磁盘不变；反馈是 `center` | `files-explorer.e2e`（验收 26） |
| 标签条插入位，多个文件按拖动顺序；落点就是自己的标签、落点本来就在那：不算失败 | `area.test.ts`、`files-explorer.e2e` |
| 四边拆分：新组；别的组已有同一文件不抢 | `area.test.ts`、`files-explorer.e2e` |
| 别的工具面板上：浮动打开；多个文件一个窗多个标签，最多 10 项，拖影说明；窗数到上限不开 | `files-explorer.e2e`、`area.test.ts` |
| 只有目录：没有落点，取消 | `files-explorer.e2e` |
| 拖动源那块面板里（横条、面板头）：取消，拖影飞回 | `files-explorer.e2e` |
| 按钮区、活动栏：不开窗。被对话框挡住：`dropTargetAt` 找不到（`drop-targets.dom.test.ts` 已测），拖动中途开不了模态，不写 e2e | `files-explorer.e2e` |
| 窗口外：浮动打开（先试 e2e，不稳就留给开发者试） | `files-explorer.e2e` |
| 树内不变 | `files-explorer.e2e` 现有用例 |

## 不做与风险

- 操作系统级窗口（t12）；文件来源的实时布局。
- 拖到别的工具面板上松手开窗：可能是拖错；决定 6 如此，Esc 取消。
