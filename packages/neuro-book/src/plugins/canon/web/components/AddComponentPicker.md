---
标签: [state:local, env:portal]
别名: ["添加一组设定", "设定组选择", "Add Component Picker"]
---

# AddComponentPicker

条目页“添加一组设定”的浮层（[`canon/author-ui.md`](../../../../../../../docs/specs/canon/author-ui.md) 输出 38）：设定组多到几十个时也好选。受控：开不开、锚在哪、列哪些由宿主给，它只把作者的选择翻成事件。触发它的按钮归宿主（分页条后面的“＋”、竖排导航里的“添加一组设定”），宿主把按钮当锚传进来。

## 布局与交互

- 锚在 `anchor` 上的浮层（nb-ui `SuggestionMenu`，宽度随内容）：上面一个搜索框，下面是列表，每项是图标与名字；去掉过的写“恢复‘某某’”。
- 没打字时按组列出这个条目还没有的：最前面“适用于<种类>”（类型的 `kinds` 含条目的种类），其余按登记它的插件分“设定”（canon）、“剧情”、“插件”（别的插件）三组，组内照给的顺序；空的组不出。条目已经有的组不列。
- 打了字只按名字筛（不分大小写、不管空格），不分组；这时条目已经有的组也列出来，行尾写“已添加”。没有对得上的写“没有叫“…”的设定组”。
- 打开时焦点进搜索框、高亮第一项；上下键在各项之间走（到头绕回），Enter 选高亮的那项，点一项同样；鼠标真的移动时高亮跟着指针。
- 选了还没有的发 `add`，选了已添加的发 `show`（宿主切到那一页），之后发 `close(true)`；Escape 发 `close(true)`（宿主把焦点放回锚）；Tab 离开、点浮层与锚以外的地方发 `close(false)`。

## 数据

```ts
interface AddComponentItem {
    /** 类型 id。 */
    readonly value: string;
    readonly label: string;
    readonly iconClass: string;
    /** 按登记它的插件分的组（`addComponentGroup`）。 */
    readonly group: "canon" | "plot" | "other";
    /** 适用于这个条目的种类。 */
    readonly fits: boolean;
    /** 条目上已经有这一组：平时不列，搜到时列出、写“已添加”。 */
    readonly present: boolean;
    /** 去掉过：写“恢复‘某某’”。 */
    readonly restore: boolean;
}

type AddComponentPickerProps = {
    /** 锚；null 时关着。缺省 null。 */
    anchor?: HTMLElement | null;
    items: readonly AddComponentItem[];
    /** 条目的种类；空串时没有“适用于”那一组。缺省空串。 */
    kind?: string;
};

type AddComponentPickerEmits = {
    (event: "add", type: string): void;
    (event: "show", type: string): void;
    /** 要关上；`refocus` 为真时宿主把焦点放回锚。 */
    (event: "close", refocus: boolean): void;
};
```

## 依赖与边界

- 用 nb-ui `SuggestionMenu`（键盘由这里处理）与 `Input`；文案在 canon 的语言包（`entry.addGroup.*`）。
- 不读世界、不写入：加上、切页、记下打开时的版本都由宿主做。
