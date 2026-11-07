---
标签: []
别名: ["标签条", "Tab Bar"]
---

# EditorTabBar

编辑组的标签条（受控，[`workbench/editor.md`](../../../../../../../docs/specs/workbench/editor.md) 输出 53、54、56、58、59）：语义、键盘、多行与分区在 nb-layout 的 [`TabStrip`](../../../../../../nb-layout/src/vue/TabStrip.md)，这里是标签里的内容与外观。VS Code 式，条底是主题角色 `--editor-tabs-surface`（比正文低一档），活动标签是与正文同色（`--panel-surface`）的一块、顶部两角圆，不加粗；不是活动组时活动标签的文字降为次级色。同一行相邻标签之间是开放式分隔线（1px `--divider`，上下各空出四分之一），活动与悬停标签两侧不画。每个标签依次是文件图标（共享的 [`FileIcon`](../../../../ui/file-icons/FileIcon.md)，页面标签没有）、名字（preview 为斜体，过长截断，悬停提示完整地址）、同名提示（次级色小字，至多占标签宽度的一半，过长同样截断）与状态位；固定与未保存另有读屏文字。

## 数据

```ts
type TabItem = {
    id: string;
    label: string;
    /** 悬停提示：完整地址。 */
    title: string;
    preview: boolean;
    dirty: boolean;
    active: boolean;
    pinned: boolean;
    /** 文件图标；页面标签为 null。 */
    icon: CatppuccinIcon | null;
    /** 同名提示（`…/notes`、根名或编辑器名，宿主按 `web/tab-hints.ts` 算好）；不同名为 null。 */
    hint: string | null;
};

type Props = {
    tabs: ReadonlyArray<TabItem>;
    /** tablist 的可访问名称。 */
    label: string;
    /** 关闭按钮的可访问名称（参数是标签名）。 */
    closeLabel: (label: string) => string;
    /** 固定标签图钉按钮的可访问名称。 */
    unpinLabel: (label: string) => string;
    /** 未保存标记的读屏文字。 */
    unsavedLabel: string;
    /** 固定标签的读屏文字。 */
    pinnedLabel: string;
    /** 正被实时布局拖着、还在标签条里的标签（标签键）：留着盒子、看不见，别的标签滑开。 */
    draggingTab?: string | null;
    /** 多行（设置 `wrapTabs`）；缺省 true。 */
    wrap?: boolean;
    /** 这一组是活动组；缺省 true。 */
    groupActive?: boolean;
};

type Emits = {
    activate: [id: string];
    /** 双击：preview 转正。 */
    keep: [id: string];
    close: [id: string];
    /** 点固定标签的图钉：取消固定。 */
    unpin: [id: string];
    /** Alt+←/→：同一类标签（固定或普通）里移动一位。 */
    move: [id: string, delta: -1 | 1];
    /** 右键、Shift+F10 或菜单键：在视口坐标打开这个标签的菜单（键盘打开时取标签的左下角）。 */
    menu: [id: string, x: number, y: number];
};
```

## 布局

- **多行**：固定标签单独占第一行，这一行不换行、放不下时在行内横向滚动；普通标签放不下时换行。整个标签区至多 3 行（标签高 34px），再多在标签区里纵向滚动；组矮时由头的 flex 把它收到至少一行（见 `EditorGroupHead`）。
- **单行**（`wrap` 为假）：所有标签在一行里横向滚动，固定标签排在最前。
- 行末留 4px：编辑组落在半像素上时，没有这点余量滚到底也露不全最后一个标签。活动标签换了（新打开、键盘切换）或换了单行与多行时，滚到它完整可见（只动标签区自己的滚动）。

## 状态位

叠在同一格里，换来换去不改变标签宽度：固定标签是图钉（点它取消固定；未保存时平时是圆点，活动、悬停或聚焦时换回图钉）；普通标签未保存时是圆点，活动、悬停或键盘聚焦的标签上换成关闭按钮，其余标签上关闭按钮隐藏但占位。不能悬停的设备上一直显示关闭按钮。状态位的按钮不进 Tab 顺序。

## 交互

`role="tablist"`，标签是 `role="tab"` 的按钮，只有活动标签在 Tab 顺序里（roving tabindex）。←/→ 换到相邻标签（循环）并激活，多行时 ↑/↓ 换到上一行或下一行水平位置最近的标签（按此刻的几何算），Home/End 到首末，Delete 关闭当前标签，Alt+←/→ 移动；中键点击关闭；右键、Shift+F10 与菜单键交出 `menu`。右键不把焦点给标签（右键按下时不聚焦），所以不让这一组成为活动组。标签按钮填满标签的高度，焦点画成标签里面的一圈内嵌焦点线；状态位的按钮同样。

没有自己的状态。
