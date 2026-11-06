---
验证入口: EditorArea
标签: [state:inject]
别名: ["编辑组", "Editor Group"]
---

# EditorGroup

一个编辑组（[`workbench/editor.md`](../../../../../../../docs/specs/workbench/editor.md) 输出 1–20）：标签条、加载进度条、状态条与控件。它是宿主：按组 id 读编辑器区控制器的组、文档与绑定，把用户动作交回控制器。

## 数据

```ts
type Props = {
    area: EditorArea;
    groupId: string;
    /** 编辑器此刻的组件（`editor-registry.ts`）：不在（gone）、未交付（pending）或已交付（ready，带组件）。 */
    control: (editor: string) => {kind: "gone"} | {kind: "pending"} | {kind: "ready"; component: Component};
    /** 页面标签（输出 33）的标题与组件；不给时页面标签显示页面 id 与“这个页面已经不在了”。 */
    pages?: EditorPageSource | null;
    /** 没有标签时的提示，宿主已按命令可用性筛好（`web/empty-tips.ts`）；缺省为空，空态只有标志。 */
    emptyTips?: ReadonlyArray<{command: string; label: string; keys: ReadonlyArray<string> | null; hint: string | null}>;
    /** 标签条右侧的标题动作（输出 34）：只有活动组拿到（`group` 是这一组），别的组为 null；缺省 null。 */
    titleActions?: {group: string; model: (maxButtons: number) => TitleActionsModel; identity: string} | null;
    /** 标签的右键菜单（输出 57，`web/tab-menu.ts` 算好）：按标签 id 给出菜单项与菜单身份；缺省 null，右键不出菜单。 */
    tabMenu?: {entries: (tabId: string) => ReadonlyArray<TabMenuEntry> | null; identity: (tabId: string) => string | null} | null;
    /** 多行标签（输出 54），交给 `EditorTabBar`；缺省 true。 */
    wrapTabs?: boolean;
    /** 面包屑（输出 60）；缺省 true。 */
    breadcrumbs?: boolean;
    /** 作品名，面包屑的第一段；缺省 null（写“作品”）。 */
    workTitle?: string | null;
};

type Emits = {
    /** 点了空态里的一条提示：交出它的命令 id，由宿主执行。 */
    (event: "run-tip", command: string): void;
    /** 点了标题动作：交出它的 key，由宿主执行。 */
    (event: "title-action", key: string): void;
    /** 点了标签菜单的一项：交出被右击的标签 id 与项的 key，由宿主执行。 */
    (event: "tab-menu", tabId: string, key: string): void;
};
```

无 slots、expose；attrs 落在根 `section`（`data-editor-group`，活动组另有 `data-editor-group-active`；这两个标记是样式与测试钩子）。根元素经 `useDropTarget` 登记两种落点（[`ui/layout-drag.md`](../../../../../../../docs/specs/ui/layout-drag.md) 输出 16）：`EDITOR_GROUP_FILE` 给资源管理器拖文件，`EDITOR_GROUP_TAB` 给标签拖动，数据都是组 id。

标签区下面是面包屑（[`EditorBreadcrumbs`](EditorBreadcrumbs.md)，输出 60）：活动标签是文件时才有，段由活动标签的地址算出，目录读取经控制器的 `list`，Markdown 的标题段读本组控件句柄的大纲（`handleOf`），选中文件在本组 preview 打开、选中标题交给句柄的 `revealHeading`，Escape 把焦点还给本组的编辑器；命令 `focus-breadcrumbs` 经控制器的 `breadcrumbFocus` 聚焦本组的面包屑。

标签的右键菜单（`EditorTabBar` 的 `menu` 事件）用 nb-ui 的 `ContextMenu` 在给出的位置打开；右键不让这一组成为活动组（只有主键按下才切换活动组），菜单的项作用于被右击的标签而不是活动的那个；打开时记下这个标签的菜单身份，身份变了（标签关闭、移到别的组、换编辑器）就关上，之前的选择不交出。

## 布局与状态

底色是面板底色 `--panel-surface`（纸面，与外壳同一块面）。纵向：标签区（底色是主题角色 `--editor-tabs-surface`，比正文低一档；`EditorTabBar` 占剩下的宽度，一到三行，组矮的时候先收它、至少留一行，正文至少留一行字的高度；拿到 `titleActions` 时右侧是共享组件 [`TitleActions`](../../../../ui/menus/TitleActions.md)，落在最后一行的右侧，不随标签滚动、不收缩，只在鼠标位于组上、焦点在组里或“⋯”打开时显示，其余时候透明但占位，不能悬停的设备一直显示；这一行的宽度用 `ResizeObserver` 量，按它决定放几个按钮：至多 4 个，给标签条至少留一个截断标签的宽度，放不下一个按钮时只剩“⋯”）、2px 的进度条位（活动文档 800 ms 后仍在读取时出现一条往复的细条，取强调色 `--accent-main`，减少动效时为静止的整条；细条只是装饰，同时给读屏一条“正在读取”的状态并把内容区标为 `aria-busy`）、状态条、内容区。内容区：

- 没有标签：内容区正中是淡色的图形标志（`NeuroBookMark`，132px，组很矮时缩小）与 `emptyTips` 给的几行提示，两列对齐：说明靠右，快捷键（nb-ui `Kbd`）或入口位置靠左。每行是一个原生按钮，点了发 `run-tip`。它是两列对齐的列表行（像资源管理器的行），不是按钮控件：nb-ui `Button` 自带的固定高度、内边距与 inline-flex 装不进跨两列的 subgrid 行，所以不用它；焦点用全局焦点环，悬停是 `--bg-hover`（[`workbench/editor.md`](../../../../../../../docs/specs/workbench/editor.md) 输出 32）。
- 打开失败：原因与“重试”（`role="alert"`）；不是 UTF-8 文本时只有原因，没有重试（[`workbench/editor.md`](../../../../../../../docs/specs/workbench/editor.md) 输出 37）。
- 已知二进制（标签的编辑器是 `nbook.editor.binary`）：一行“不能在这里打开”（`data-editor-unavailable="binary"`），不读文件。
- 标签的编辑器不在了：说明与“用默认编辑器打开”（`data-editor-unavailable="gone"`、`data-editor-reopen-default`）；还没交付：800 ms 内空白，之后一行“正在加载编辑器”（`data-editor-pending`，CSS 动画延迟显示，不用计时器）（输出 40）。
- 活动标签是页面（`page://<id>`，[`workbench/editor.md`](../../../../../../../docs/specs/workbench/editor.md) 输出 33）：内容区渲染页面组件（属性 `context`），自己滚动；贡献方停了时一行“这个页面已经不在了”。页面标签的文字是页面标题。
- 其余：组里出现过、已交付的每种编辑器各挂一个控件（容器带 `data-editor-kind="<编辑器 id>"`），换文档只换绑定、不重建控件；当前不用的控件停放（`v-show`，不卸载）。文档还在读取时控件都停放，内容区空白，不显示旧文件的正文。

控件的 `readonly` 取 `area.viewWritable`：预览视图、按字节显示的编辑器与只读文档都不能输入。字节标签（图片这类）的控件收到字节绑定（`url`、`version`）。

状态条是 nb-ui [`Banner`](../../../../../../nb-ui/src/components/feedback/Banner.md)（冲突、无法表示、订阅结束、保存失败用 `error` 色调，读屏立即播报；其余用 `warning`），按活动文件标签的文件条目（`area.fileOf`，字节标签也有）、按优先级只显示一条：本视图的未裁决输入（采用当前正文 / 保留本视图的内容）、磁盘冲突（重新载入磁盘版本 / 覆盖磁盘版本）、订阅结束、已删除、磁盘已变化（重新载入）、保存失败或结果未知。

焦点进入或按下组时这组成为活动组。

## 不支持

- 不显示差异比较。

## 隐藏通道理由

- `state:inject`：经 `useText()` 取宿主注入的翻译端口，标签条的无障碍文字、状态条、读取失败与编辑器不可用的说明这些界面文字都在本插件的目录（命名空间 `nbook.editor`，`../../locales/`）；语言随端口切换，不重新挂载，组件没有语言属性。没有宿主注入时得到 nb-ui 的缺省端口，那里没有本插件的目录，只显示键名，所以测试与 Lab 场景要注入登记了本插件目录的宿主引擎端口。 交给控件的 `locale` 属性是控件合同的一员（`shared/contracts.ts` 的 `EditorControlProps`，别的插件的控件要用），取自同一个端口的当前语言，不是编辑组自己取文字用的。
