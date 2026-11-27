---
标签: [state:inject]
别名: ["移动条目", "Move Dialog"]
---

# MoveDialog

把一个条目挪到别处、改它在树里的位置与身份（[`canon/author-ui.md`](../../../../../../../../docs/specs/canon/author-ui.md) 的“移动到……”）：上级、分组、种类、在同一层的顺序、从哪里出场、它是谁的另一个身份。确认后宿主发一次改几处的 `place`（只带改了的几项）。受控：填的东西（`MoveDraft`，`move-dialog.ts`）由宿主给，每改一项发新的完整草稿；上级与另一个身份用 `EntryPicker`，搜索词经事件交给宿主、结果经属性传回。

## 布局与交互

nb-ui 的 `Dialog`（中号），一列字段：

- 放在谁下面：`EntryPicker`（排除自己；清空是最上面一层）。
- 分组、种类：输入框。
- 顺序：“保持原位”“放在这一层最前”。换了上级时它排在新的一层最后。
- 从哪里出场：“一开始就在”与每一章的开头。
- 它是谁的另一个身份：`EntryPicker`（排除自己；清空是不是）。

“移动”发 `confirm`；取消、Escape、点遮罩发 `update:open(false)`（保存中不发）。失败的原因写在对话框里（`role="alert"`）；成环、指向自己由内核拒收，原因照写。

## 数据

```ts
type MoveDialogProps = {
    open: boolean;
    /** 要移动的条目：名字写在标题里，id 在两个选择器里排除。 */
    entry: {readonly id: string; readonly name: string};
    draft: MoveDraft;
    /** 上级、另一个身份两个选择器各自的查找结果（`useEntryFind`）。 */
    parentResults: EntryResults;
    sameAsResults: EntryResults;
    chapters?: readonly {readonly id: string; readonly index: number}[];
    saving?: boolean;
    error?: string;
};

type MoveDialogEmits = {
    (event: "update:open", value: boolean): void;
    (event: "update:draft", value: MoveDraft): void;
    (event: "search-parent", query: string): void;
    (event: "search-same-as", query: string): void;
    (event: "confirm"): void;
};
```

## 不支持

- “放在某项之后”：要先读新的一层，这次不做；拖动排序也不做。

## 隐藏通道理由

`state:inject`：经 canon 的翻译端口取文字。
