---
标签: [state:local, state:inject]
别名: ["设定组勾选列表", "Component Checklist"]
---

# ComponentChecklist

设定组的勾选列表（[`canon/author-ui.md`](../../../../../../../docs/specs/canon/author-ui.md) 输出 4、38）：设定组多到几十个时也好选、能一次勾几组。加设定组对话框（`AddComponentDialog`）与新建条目对话框（`NewEntryDialog`）共用。受控：列哪些、勾了哪些由宿主给，它只把作者的操作翻成事件。

## 布局与交互

- 上面一个搜索框（焦点由外面放进来：加设定组对话框的初始焦点、`focus()`；之后焦点一直留在这里）；有预设时下面一排预设按钮（一组按钮，读屏名“预设”）；再下面是列表。
- 列表没打字时按组：最前面“适用于<种类>”（项的 `kinds` 含 `kind`；`kind` 为空时没有这一组），其余按登记它的插件分“设定”“剧情”“插件”三组，组内照给的顺序，空的组不出。每行左边一格勾（勾着时画勾），再是图标与名字；去掉过的写“恢复‘某某’”；条目上已经有的（`present`）勾着、勾画淡、行尾写“已添加”。打了字只按名字筛（不分大小写、不管空格）、不分组；没有对得上的写“没有叫“…”的设定组”。被筛掉的勾选照旧算数。
- 点一个预设：把它里面还没添加、还没勾的几组勾上，不取消别的（`withPreset`），发 `update:modelValue`（`via` 是 `"preset"`）；里面都已添加或都已勾时这个按钮不可用。点它不让焦点离开搜索框，用键盘按的按完焦点回到搜索框。
- 键盘（焦点在搜索框里）：上下键移高亮（到头绕回，高亮走到看不见的行时列表滚到露出它）；Enter 勾或取消高亮的那一行，高亮的是已添加的那一行时发 `present`；Ctrl（Mac 上 ⌘）加 Enter 发 `submit`；输入法组字中的按键不处理（含 WebKit 组字结束后才发的那次 Enter，keyCode 229）；Escape 不拦（交给外面的对话框）。点一行同 Enter，鼠标真的移动时高亮跟着指针。
- 勾与取消有过渡（勾的出现、方框的底色）；预设一排出现、消失时收放，选定的种类变了时列表淡出淡入地换成新的分组（打字筛选时不换）；高亮的底色同弹出列表的行；高亮只在焦点在搜索框里或指针在列表上时画（新建对话框里焦点先在名字上，列表不亮一块），记着的那一行不变。
- 读屏：搜索框是 `combobox`（`aria-controls` 指列表、`aria-activedescendant` 指高亮的那一行），列表是 `listbox`（`aria-multiselectable`），每组是 `group`（组名作读屏名），每行是 `option`（`aria-selected` 是勾没勾）。

## 数据

```ts
type ComponentChecklistProps = {
    items: readonly ChecklistItem[];
    /** 选定的种类；空串时没有“适用于”一组。新建对话框只在种类选定以后传。默认空串。 */
    kind?: string;
    /** 这个种类的预设（`kindPresets`）。默认空。 */
    presets?: readonly ChecklistPreset[];
    /** 勾着的类型 id（不含已添加的）；受控。 */
    modelValue: readonly string[];
    /** 列表封顶的高度（CSS 长度），超出在列表里滚；不给时不封顶（由外面统一滚）。 */
    maxHeight?: string;
};
// ChecklistItem、ChecklistPreset 见 component-checklist.ts。

type ComponentChecklistEmits = {
    /** `via`：点的是一行（`"row"`，含回车）还是一个预设（`"preset"`）；新建对话框据此不把预设算作作者动过勾选。 */
    (event: "update:modelValue", value: readonly string[], via: "row" | "preset"): void;
    /** 在已添加的那一行上按 Enter 或点它。 */
    (event: "present", type: string): void;
    /** Ctrl 或 ⌘ 加 Enter。 */
    (event: "submit"): void;
};
```

没有插槽；`expose` 一个 `focus()`（把焦点放回搜索框）；attrs 落在根元素上。

## 隐藏通道理由

- `state:local`：搜索词、高亮的那一行，焦点与指针在不在。
- `state:inject`：经 `useCanonText()` 取宿主注入的翻译端口。
