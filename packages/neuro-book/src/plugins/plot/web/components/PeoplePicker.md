---
标签: [state:inject]
别名: ["选要看的人", "People Picker"]
---

# PeoplePicker

“谁知道什么”表右上角的“选要看的人（选中数 / 候选数）”（[`plot/author-ui.md`](../../../../../../../docs/specs/plot/author-ui.md) 输出 10）：点了在弹层里多选哪些人做表的列。受控，选中的人存在页面标签的状态里。

## 布局与交互

- 触发器是一个小号按钮，文字带选中数与候选数；弹层贴在它下面、右对齐，宽 256 像素，内容多时在弹层里滚动。
- 弹层第一行写上限（“最多选 12 个”），下面是 nb-ui 的 `CheckboxGroup`，一行一个人。键盘：Tab 进弹层，空格勾选，Escape 关闭并把焦点还给按钮（弹层的行为来自 nb-ui `Popover`）。
- 勾选后发 `update:modelValue`；超过上限时这一下不生效（发回原来的选中）。

## 数据

```ts
type PeoplePickerProps = {
    /** 候选的人：id 与名字，按显示的先后；必填。 */
    candidates: readonly {readonly id: string; readonly name: string}[];
    /** 选中的人的 id；必填、受控。 */
    modelValue: readonly string[];
    /** 至多选几个；默认 12。 */
    max?: number;
};

type PeoplePickerEmits = {
    (event: "update:modelValue", value: string[]): void;
};
```

没有插槽、没有 expose；`attrs` 落在弹层的根上（nb-ui `Popover`）。

## 不支持

- 搜索候选：候选是表里出现过的人加主要角色，作品里通常几十个以内。
