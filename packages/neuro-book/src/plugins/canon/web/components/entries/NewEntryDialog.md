---
标签: [state:inject]
别名: ["新建条目", "New Entry Dialog"]
---

# NewEntryDialog

新建条目的对话框（[`canon/author-ui.md`](../../../../../../../../docs/specs/canon/author-ui.md) 输出 4）。受控：填的东西（`NewEntryDraft`，`new-entry.ts`）与各个选项由宿主给（`entries-view.ts`），确认后宿主发布；结果回来之前对话框不关、按钮不可用，失败时原因写在对话框里。

## 布局与交互

nb-ui 的 `Dialog`（中号），一列字段：

- 名字（必填）；为空时“新建”不可用。
- 种类：可以新写，下面一排候选（登记的种类在前，已有条目用过的接在后面），点了填进去。点候选或输入框失焦算选定种类：作者还没动过“启用哪些数据”的勾选时，勾选整组换成这个种类的默认设定组（`kindDefaults`，没登记的种类是空的）；打字时不换。
- 分组：作者没改过时跟着种类。
- 放在谁下面：“最上面一层”与已读到的条目。
- 启用哪些数据：登记的类型，用 `ComponentChecklist`（搜索框、预设一排、按组列出的勾选行；不封顶，由对话框统一滚）。列表的“适用于<种类>”一组与预设（`kindPresets`）跟着选定的种类（草稿的 `kindChosen`）换，打字时不换。点行勾或取消算作者动过，之后不再跟着种类换（草稿的 `typesTouched`）；点预设不算，之后选定别的种类，勾选照旧换成那个种类的默认；再选定同一个种类什么都不换。Ctrl 加回车在这里不做什么（新建要先填名字，主按钮另点）。
- 它是谁的另一个身份：“不是”与已读到的条目；选了以后“放在谁下面”变成那个条目。
- 从哪里出场：“一开始就在”与每一章的开头。

每改一个字段发一次 `update:draft`（新的完整草稿）；“新建”发 `confirm`；取消、Escape、点遮罩发 `update:open(false)`（保存中不发）。

## 数据

```ts
type NewEntryDialogProps = {
    open: boolean;
    draft: NewEntryDraft;
    /** 种类的候选：登记的在前，用过的在后。 */
    kinds?: readonly string[];
    /** 登记的种类默认带的设定组（类型 id）；没登记的种类不在里面。 */
    kindDefaults?: Readonly<Record<string, readonly string[]>>;
    entries?: readonly {readonly id: string; readonly name: string}[];
    /** 登记的类型：勾选列表的各行（没有“已添加”）。 */
    items?: readonly ChecklistItem[];
    /** 每个登记的种类的预设；没登记的种类不在里面。 */
    kindPresets?: Readonly<Record<string, readonly ChecklistPreset[]>>;
    // ChecklistItem、ChecklistPreset 见 component-checklist.ts。
    chapters?: readonly {readonly id: string; readonly index: number}[];
    saving?: boolean;
    /** 失败的原因（`role="alert"`）；默认空。 */
    error?: string;
};

type NewEntryDialogEmits = {
    (event: "update:open", value: boolean): void;
    (event: "update:draft", value: NewEntryDraft): void;
    (event: "confirm"): void;
};
```

## 隐藏通道理由

`state:inject`：经 `useCanonText()` 取宿主注入的翻译端口（命名空间 `nbook.canon`）。
