---
标签: [state:inject]
别名: ["竖排分页", "条目页导航", "Entry Page Nav"]
---

# EntryPageNav

条目页的竖排分页（[`canon/author-ui.md`](../../../../../../../../docs/specs/canon/author-ui.md) 输出 9、38）：编辑区够宽时代替页头下面的横排分页，放在内容左边，吸在页头下面。和横排读同一份分页（`entry-tabs.ts` 的 `EntryTab`），切换排法只换外形、不改选中。受控：选中哪一页由宿主给，点了、按了方向键发出新值。

## 布局

- 一列按钮，每页一行：图标、名字（过长截断）、条数（等宽数字，没有或为 0 时不写）。选中的一行是浅强调底、强调色图标、中等字重。
- 两段：设定组与文字在前，不对应设定组的看法（附加分页与“情节”）在后，分隔线画在看法的第一页上面（`data-segment-start`，列表里只有分页）；有能加的设定组时最后一行是“添加一组设定”（弱色，点开是“添加设定组”对话框，对话框归条目页的宿主）。
- 宽度由宿主给（168 像素一栏），本组件只占满它；窄了宿主换回横排，不在这里处理。
- 分页增减（加上、去掉一组设定，“情节”第一次出现）：新的一页淡入，去掉的淡出（脱离排布、钉在原处），其余的滑到新位置（`--motion-move`）；减弱动效时直接换。“添加一组设定”在列表外面，跟着直接移位。选中的底色在两页之间淡入淡出，不做滑动的指示。

## 交互

- 点一行发 `update:modelValue`；上下方向键在全部分页之间移动并选中（两端绕回），`Home`、`End` 到头尾，焦点跟到新选中的一行（同 nb-ui `Tabs` 的自动激活）。只有选中的一行 `tabindex="0"`。
- 右键一行发 `context`（带视口坐标），菜单由宿主画。
- 看法菜单（输出 9）：`menus` 为真时，能换看法的行（`EntryTab.looks`）行尾留一格向下的箭头，选中的那一行显出（`menuOpen` 时转半圈、`aria-expanded`）；选中的那一行再点发 `menu`（带这一行，菜单由宿主画），没选中的点了照旧只是选中。`note` 非空时选中的那一行在标题后写它（弱色、单独一格不截断，标题先截；出现与消失时宽度有过渡）。
- 点“添加一组设定”发 `add-toggle`；它标着开对话框（`aria-haspopup="dialog"`）；`addReason` 非空时不可用、悬停写原因。
- 读屏：`role="tablist"`、`aria-orientation="vertical"`，每行 `role="tab"`、`aria-selected`、`aria-controls` 指向内容面板。

## 数据

```ts
type EntryPageNavProps = {
    items: readonly EntryTab[];
    /** 选中的那一页；必填、受控。 */
    modelValue: string;
    /** 有能加的设定组、条目可写：出“添加一组设定”；缺省 false。 */
    canAdd?: boolean;
    /** 添加不可用的原因；缺省空串。 */
    addReason?: string;
    /** 每页的 id（内容面板的 `aria-labelledby` 指它）。 */
    tabId: (value: string) => string;
    /** 内容面板的 id。 */
    panelId: string;
    /** 有几种看法可换：能换看法的行留箭头格；缺省 false。 */
    menus?: boolean;
    /** 看法菜单开着（菜单归宿主）；缺省 false。 */
    menuOpen?: boolean;
    /** 选中那一行的看法名（不在缺省看法时）；缺省空串。 */
    note?: string;
};
type EntryPageNavEmits = {
    (event: "update:modelValue", value: string): void;
    /** 点了“添加一组设定”：宿主开“添加设定组”对话框。 */
    (event: "add-toggle"): void;
    (event: "context", value: string, at: {readonly x: number; readonly y: number}): void;
    /** 选中的、能换看法的那一行再被点：宿主把看法菜单贴着这一行开或关。 */
    (event: "menu", value: string, row: HTMLElement): void;
};
```

没有插槽与 expose；attrs 落在根元素上。

## 隐藏通道理由

`state:inject`：经 `useCanonText()` 取宿主注入的翻译端口。
