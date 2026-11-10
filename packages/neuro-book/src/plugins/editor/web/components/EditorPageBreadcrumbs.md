---
标签: [state:local]
别名: ["页面面包屑", "Editor Page Breadcrumbs"]
---

# EditorPageBreadcrumbs

页面标签的面包屑（[`workbench/editor.md`](../../../../../../../docs/specs/workbench/editor.md) 输出 33 的“面包屑”）：编辑组标签条下面的一行，与文件的面包屑（[`EditorBreadcrumbs`](EditorBreadcrumbs.md)）在同一个位置、同一个样子。各段由页面给出，从左到右；带命令的段是按钮，点了执行那条命令；没带命令的段与最后一段（当前页）只是文字。没有下拉。

它不认识命令系统：每一段要做的事由宿主包成 `run` 交进来。

## 布局与交互

一行，高 26px，不换行、不横向滚动；放不下时中间的段先缩短（截断，悬停提示完整的文字），第一段与最后一段不缩。段与段之间是一个箭头。`390×844` 下同一结构。

键盘：可点的段里只有一段在 Tab 顺序里（roving tabindex）；←/→ 在可点的段之间移动，Home/End 到第一、最后一个可点的段；Enter 或空格执行；Escape 交出 `escape`，由宿主把焦点还给页面。`focusSeq` 变了时把焦点放到最后一个可点的段；一段可点的都没有时不动焦点。

## 数据

```ts
type PageCrumbItem = {
    /** 已经翻译好的文字。 */
    label: string;
    /** 点这一段要做的事；没有时这一段只是文字。 */
    run?: () => void;
};

type Props = {
    /** 从外到内的各段；空数组时不渲染。受控，组件不改。 */
    items: ReadonlyArray<PageCrumbItem>;
    /** 聚焦请求的序号（命令 `focus-breadcrumbs`）；默认 0。 */
    focusSeq?: number;
};

type Emits = {
    /** 在面包屑里按了 Escape。 */
    escape: [];
};
```

没有 slots，没有 expose。未声明的 attribute 与 `class` 落在根节点 `nav` 上；`items` 为空时没有根节点，attribute 无处可落。

## 状态

- 默认：如上。
- 空数据：`items` 为空时什么也不渲染。
- 禁用、只读、加载中、出错：没有这些状态；页面还没给出面包屑时宿主不渲染本组件。

## 不支持

- 下拉、列出同级：页面的层级不是目录，要换页面点带命令的段。
- 最后一段不可点，即使它带了 `run`。
