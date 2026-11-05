---
标签: [state:local, state:inject]
别名: ["编辑器区", "Editor Area"]
---

# EditorArea

编辑器槽里的根（[`workbench/editor.md`](../../../../../../../docs/specs/workbench/editor.md)）：按编辑器区控制器（`area.ts` 的 `EditorArea`）的组模型，用 nb-layout 的 grid 排列编辑组，每组一个 `EditorGroup`；承载关闭询问与编辑器区内的键位。它是宿主：直接读控制器的状态、调它的动作，不经属性展开；命令由插件的宿主执行，组件只发意图。

## 数据

```ts
type Props = {
    /** 编辑器区控制器：组与标签、文档、绑定、进度、关闭询问。 */
    area: EditorArea;
    /** 编辑器此刻的组件（按 `shared/contracts.ts` 的控件合同），转给每个编辑组。 */
    control: (editor: string) => {kind: "gone"} | {kind: "pending"} | {kind: "ready"; component: Component};
    /** 页面标签的来源（页面贡献点 `editor.pages`，输出 33），原样交给每个编辑组；默认 null。 */
    pages?: EditorPageSource | null;
    /** 空编辑组的提示（输出 32，`web/empty-tips.ts` 按命令可用性筛好），原样交给每个编辑组；缺省为空。 */
    emptyTips?: ReadonlyArray<EmptyTip>;
    /** 活动组的标题动作（输出 34，`web/title-actions.ts` 算好）：只交给 `group` 那一组；缺省 null。 */
    titleActions?: {group: string; model: (maxButtons: number) => TitleActionsModel; identity: string} | null;
    /** 标签的右键菜单（输出 57，`web/tab-menu.ts` 算好），原样交给每个编辑组；缺省 null。 */
    tabMenu?: {entries: (tabId: string) => ReadonlyArray<TabMenuEntry> | null; identity: (tabId: string) => string | null} | null;
    /** 多行标签（设置 `nbook.editor/wrapTabs`，输出 54），原样交给每个编辑组；缺省 true。 */
    wrapTabs?: boolean;
    /** 面包屑（设置 `nbook.editor/breadcrumbs`，输出 60），原样交给每个编辑组；缺省 true。 */
    breadcrumbs?: boolean;
    /** 作品名（面包屑的第一段）；未绑定作品为 null，写“作品”；缺省 null。 */
    workTitle?: string | null;
};

type Emits = {
    /** 编辑器区有焦点时按下 Ctrl+S、Ctrl+W、Ctrl+\：宿主执行保存、关闭、向右拆分的命令。 */
    intent: ["save" | "close" | "split-right"];
    /** 点了某个编辑组空态里的一条提示：宿主执行这条命令。 */
    "run-tip": [command: string];
    /** 点了活动组的一个标题动作：宿主按 key 执行。 */
    "title-action": [key: string];
    /** 点了某个编辑组标签菜单的一项：宿主按标签 id 与 key 执行。 */
    "tab-menu": [tabId: string, key: string];
};
```

无 slots、无 expose；attrs 落在根元素。

拖动标签（[`workbench/editor.md`](../../../../../../../docs/specs/workbench/editor.md) 输出 55）装在根上（`web/tab-drag.ts`）：按住标签主体移动起拖，落点用 nb-layout 的 `DropFeedbackOverlay` 画出（插入线，或正文区的整块与半块），带 `data-editor-drop`（落点种类）；指针右下 12px 有一个跟手的拖影（`body` 下，`data-editor-drag-ghost`）：被拖标签的图标与名字，与标签同字号、同底色，没有落点时也跟着；拖动中整个编辑器区是抓手光标、不扩选文字；起拖后组、标签或固定状态、多行设置变了就取消，松手时与最后显示的落点相同才交给控制器的 `moveTab`、`moveToNewGroup`。

## 布局与交互

填满父级、自己不滚动，底色是面板底色 `--panel-surface`。grid 用 `useLayoutExtent` 测量承载盒、`useGridLayout` 落账，拖动分隔条落账后告诉控制器记下会话；组模型原地拆分或关闭组时重算布局。根元素记焦点进出（控制器的 `focused`，即公开键 `nbook.editor/focused`）。控制器的提示（换文档时有未裁决输入）显示在顶部，可关闭；提示是文字值，经翻译端口按当前语言翻译，换语言后原位更新。

关闭询问是 nb-ui `Dialog`：标题带文件名，按钮依次是取消、不保存、保存（默认焦点在 Dialog 的规则上）；关闭对话框等于取消。选“保存”后保存期间还能输入，保存完有新输入时再问一次。同一文件还在别的标签里时不问，只有这个视图自己的未裁决输入要问（不保存只丢这份输入）。开始关闭时焦点在编辑器区，关闭后焦点交给新的活动视图（空组关闭时是相邻组），不落到页面根；拆分时焦点在编辑器区则交给新组。布局变化让控件重挂时，只有活动视图的控件会被重新聚焦。活动视图的控件还没挂上（例如 Monaco 在加载）时交接先挂着，用户在这之前把焦点移到编辑器区之外，交接就撤销，控件迟到不抢回焦点。恢复会话时同样等活动组的活动标签就绪后聚焦一次，光标在它记下的位置（输出 30）；在此之前焦点去了别处就不聚焦。

## 隐藏通道理由

- `state:inject`：经 `useText()` 取宿主注入的翻译端口，关闭询问、拖影的落点说明、提示条的文字与它的“关闭提示”这些界面文字都在本插件的目录（命名空间 `nbook.editor`，`../../locales/`）；语言随端口切换，不重新挂载，组件没有语言属性。没有宿主注入时得到 nb-ui 的缺省端口，那里没有本插件的目录，只显示键名，所以测试与 Lab 场景要注入登记了本插件目录的宿主引擎端口。 向下传给编辑组的控件时，语言也取自这个端口（见 `EditorGroup`）。
