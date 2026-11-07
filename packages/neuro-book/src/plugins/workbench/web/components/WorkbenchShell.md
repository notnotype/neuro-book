---
标签: [state:local, state:inject, state:shared-read, state:shared-write, io:mutate, env:global, env:portal]
别名: ["工作台外壳", "Workbench"]
---

# WorkbenchShell

产品的工作台外壳（[`ui/workbench-layout.md`](../../../../../../../docs/specs/ui/workbench-layout.md)）：把一棵树的布局 store 接到 [`WorkbenchSurface`](WorkbenchSurface.md)，放标题栏、活动栏、面板头、状态栏与视图内容，把按钮接到命令，把拖放接到 `layout-drag.ts`。Lab 用 [`WorkbenchSurface`](WorkbenchSurface.md) 的场景演示几何与手势，这个组件要真实的 store、命令与视图注册表，只在产品页验证（`e2e/workbench-shell.e2e.ts`、`workbench-views.e2e.ts`、`workbench-dnd.e2e.ts`）。

## 布局

外壳根占满页面（父级给它确定的宽高），底色是主题的 `--shell-ground`（卡片主题里是窗体底；平铺的主题没有这个变量，用面板底色），字体 `--font-ui`。

- 标题栏：固定 36px，在树之外（[`WorkbenchTitleBar`](WorkbenchTitleBar.md)）。
- 活动栏：[`WorkbenchToolStrip`](WorkbenchToolStrip.md)，上段是全部工具视图，底段是 `chrome` 给的全局项。
- 工具面板：[`WorkbenchPanelHead`](WorkbenchPanelHead.md) 加视图内容（[`WorkbenchViewFrame`](WorkbenchViewFrame.md)）。视图动作由共享组件 [`TitleActions`](../../../../ui/menus/TitleActions.md) 画在面板头，按面板宽度算放几个按钮，其余收进“⋯”：一个截断的标签、其余只留图标的宽度总要留给标签带。
- 编辑区：树里每块 `role: "editor"` 的面板是 `editorArea` 提供者的一个组组件（属性 `panelId`、`context: {visible}`，别的面板最大化盖住它时 `visible` 为假），提供者的区级组件在外壳根上挂一次，交出标签的拖动；提供者换了才重挂。没有提供者时编辑组里是欢迎文字，那块面板有标签时写不可用的原因。
- 状态栏：[`WorkbenchStatusBar`](WorkbenchStatusBar.md)。

## 交互

- 拖动边界的结果交给 store 的 `commitGesture`，布局发布的尺寸交给 `acceptPresented`；记录读完之前边界不能拖。
- 面板头的框架按钮执行命令（`set-panel-collapsed`、`toggle-panel-maximized`、`set-part-hidden`），可用与原因取命令系统的可用性。收起按钮只给上下排的面板。标签的右键或菜单键开“移动到”：别的工具面板、“新面板（挨着 X）”、“重置位置”，视图所在面板、交付状态或代际一变菜单就关。
- 活动栏只列侧栏这一列的视图。条目按 `toolEntryIntent`：不可见显示并聚焦，可见隐藏（无名面板收起）。右键或菜单键同标签。
- 状态栏的面板按钮执行 `set-part-hidden`；重试、放弃转给 store。
- 内容被停放时焦点还在里面：移到同一面板看得见的标签，面板看不见时移到活动栏条目，都没有时外壳根；焦点在外壳之外时不抢。
- F6 由 `attachPaneFocus` 接到命令，调表面的 `moveFocus`。
- 拖放的来源是视图标签、侧栏这一列的标题、活动栏条目与编辑器标签，规则见 `layout-drag.ts` 与 Spec 的“拖动”。树里整块面板不能拖；浮动窗能整窗拖，头的空白处或它唯一的标签（Spec 输出 39）。

## 数据

```ts
type Props = {
    /** 外壳挂上时交出移动焦点的实现，返回撤销。 */
    attachPaneFocus?: (move: PaneFocusMover) => () => void;
    /** 布局文档的 store；受控，必填。 */
    layout: LayoutDocStore;
    /** 命令服务；必填。 */
    commands: CommandService;
    /** 视图的交付与加载；必填。 */
    views: ViewSource;
    /** 编辑器槽的提供者；不给时是欢迎文字。 */
    editorArea?: EditorAreaSource;
    /** 标题栏与活动栏的条目、视图动作；不给时标题栏只有品牌与项目名。 */
    chrome?: ShellChrome;
    /** 作品的显示名；必填，没有项目为 null。 */
    project: string | null;
};
```

没有 emits、slots、expose；attrs 落在根元素上。

## 状态

记录没读完：按默认树显示，手势与依赖就绪的命令不可用。读不了或存不下：状态栏给出原因与重试、放弃，显示不受影响。放不下：呈现降级写在外壳根的 `data-layout-diagnostics`，不写文档。

## 不支持

手机呈现（w00026 t11）、浮动窗（t09）、拖动中实时重排（t08）都不在这里。

## 隐藏通道理由

`state:shared-read`、`state:shared-write` 是它的本职：它就是 store 与界面之间的接线。`state:inject` 取翻译端口。`io:mutate` 经命令服务。`env:global` 是拖放会话与表面对文档根的监听，`env:portal` 是拖动反馈与菜单传送到 body。
