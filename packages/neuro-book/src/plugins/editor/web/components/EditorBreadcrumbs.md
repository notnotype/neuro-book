---
标签: [state:local, state:inject]
别名: ["面包屑", "Editor Breadcrumbs"]
---

# EditorBreadcrumbs

编辑组标签条下面的一行路径（[`workbench/editor.md`](../../../../../../../docs/specs/workbench/editor.md) 输出 60）：作品名（`user://` 下为“用户资产”）› 目录 › 文件，Markdown 文件再接光标所在的标题。每一段都是一个下拉的触发器（nb-ui 的 `DropdownMenu`，紧凑密度）：

- 作品名与目录段：列出这个目录的子项；目录项点了在下拉里进入下一层（列表换成它的子项，下拉不关），文件项点了交出 `open`；符号链接、其它类型与缺失的项显示但不可选。读取中一行“正在读取”，空目录一行“空”，失败一行原因加“重试”。
- 文件段：列出同级（读它所在的目录），当前文件打勾。
- 标题段：列出这一章的大纲，按标题层级缩进，当前标题打勾；选中交出 `reveal`，带打开下拉时记下的 `binding` 与 `version`。

下拉关闭、换段、这一行的路径变了（换了文件）或组件卸下（关掉面包屑的设置）时，还没回来的目录读取作废，回来了也丢掉；卸下时焦点在面包屑里，交出 `escape` 让宿主把焦点还给编辑器。

它是纯展示加交互：不读文件服务、不认识控制器，读取经属性 `list` 交给宿主。

## 数据

```ts
type BreadcrumbSegment = {
    kind: "root" | "dir" | "file";
    label: string;
    /** 这一段的地址：根与目录是目录地址，文件是文件地址。 */
    address: string;
    /** 文件图标；只有文件段有。 */
    icon?: CatppuccinIcon;
};

type Props = {
    /** 从外到内的路径段；空数组时不渲染（页面标签、没有标签）。 */
    segments: ReadonlyArray<BreadcrumbSegment>;
    /** 文件段的父目录地址（列同级用）。 */
    parent: string | null;
    /** Markdown 的大纲（控件句柄的 `outline`）；没有为 null，不画标题段。 */
    outline: EditorOutline | null;
    /** 列出一个目录：失败给出原因。 */
    list: (address: string, signal: AbortSignal) => Promise<{ok: true; entries: ReadonlyArray<{name: string; address: string; kind: "file" | "directory" | "link" | "other" | "missing"}>} | {ok: false; reason: string}>;
    /** 聚焦请求的序号：变了就把焦点放到最后一段（命令 `focus-breadcrumbs`）。 */
    focusSeq?: number;
};

type Emits = {
    /** 选中一个文件。 */
    open: [address: string];
    /** 选中一个标题。 */
    reveal: [binding: string, version: number, id: string];
    /** 下拉都关着时按 Escape：宿主把焦点还给编辑器。 */
    escape: [];
};
```

无 slots、expose；attrs 落在根 `nav`（`data-editor-breadcrumbs`）。

## 布局

一行 26px 高，12px 字，次级文字色，与正文同底色；段与段之间一个 `chevron-right`。放不下时中间的目录段先缩短（截断，悬停提示全名），文件段与标题段不收缩；不换行、不横向滚动。

## 交互

段是 roving tabindex 的一组按钮：←/→ 换段，Enter、空格或 ↓ 打开下拉（`DropdownMenu` 的键盘），下拉里 ↑/↓ 选、Enter 确认、Escape 关；下拉都关着时 Escape 交出 `escape`。悬停段时浅底色。

`state:local`：打开着的是哪一段、目录下拉当前列的是哪个目录、它的读取状态与请求序号。

文字选择：面包屑不可选（见 nb-ui 开发规范的“文字能否选中”）。

## 隐藏通道理由

- `state:inject`：经 `useText()` 取宿主注入的翻译端口，段的标签、读取中、空与重试这些界面文字都在本插件的目录（命名空间 `nbook.editor`，`../../locales/`）；语言随端口切换，不重新挂载，组件没有语言属性。没有宿主注入时得到 nb-ui 的缺省端口，那里没有本插件的目录，只显示键名，所以测试与 Lab 场景要注入登记了本插件目录的宿主引擎端口。
