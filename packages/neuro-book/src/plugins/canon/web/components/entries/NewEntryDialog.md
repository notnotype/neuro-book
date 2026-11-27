---
标签: [state:inject]
别名: ["新建条目", "New Entry Dialog"]
---

# NewEntryDialog

新建条目的对话框（[`canon/author-ui.md`](../../../../../../../../docs/specs/canon/author-ui.md) 输出 4）。受控：填的东西（`NewEntryDraft`，`new-entry.ts`）与各个选项由宿主给（`entries-view.ts`），确认后宿主发布；结果回来之前对话框不关、按钮不可用，失败时原因写在对话框里。

## 布局与交互

nb-ui 的 `Dialog`（`lg`，720 宽），正文两栏，按对话框自己的宽度（容器查询，560 以下）上下排。行高只由左栏决定（至少 17rem）：右栏绝对定位、与左栏等高，列表在里面滚，左栏展开“位置与出场”变高时右栏跟着拉长；上下排时右栏按自己的高度、列表封顶 20rem。标题：草稿的 `startKind` 有值（“新建人物”入口）、且选定的种类还是它时写“新建<种类>”，否则“新建条目”（改选了别的种类，标题不与下面的种类对不上）。没有登记的类型（`items` 空：还没读到、一个也没有）时只有左栏一列。

左栏是条目本身：

- 名字（必填）；为空时“新建”不可用。在名字框里按回车等于点“新建”（输入法组字时的回车不算：`isComposing`，以及 WebKit 组字结束后才发的 `keyCode` 229；名字为空时不新建）。
- 种类：可以新写，下面一排常用种类的按钮（登记的种类在前，已有条目用过的接在后面），选定的那个是按下的样子（`aria-pressed`，强调色浅底 `--accent-bg` 配 `--accent-text`，前面一个勾）。点按钮或输入框失焦算选定种类：作者还没动过勾选时，勾选整组换成这个种类的默认设定组（`kindDefaults`，没登记的种类是空的）；打字时不换。
- “位置与出场”一段（nb-ui 的 `Collapsible`，缺省收起，高度与透明度有过渡）：段头整行可点，右边单行截断写现在的值（分组或“不分组”、“某某的马甲”或“在某某下面”、出场），里面依次：
  - 分组（`SuggestInput`，候选是作品里已有的分组，也能新写）：作者没改过时跟着种类。
  - 是谁的马甲（`EntryPicker`，缺省“不是马甲”）：选了以后上级变成那个条目；清掉时上级一起清掉（选本体之前预填的上级不还原，已知限制）。
  - 上级条目（`EntryPicker`，缺省“无”）：选了本体以后这一项换成一行“某某（跟着本体）”，不给框。
  - 出场（`SearchSelect`）：“一开始就在”与每一章的开头。

  两个条目选择器按名字与别名在整个世界里找：打开、打字时发 `search-parent`、`search-same-as`，宿主经 `useEntryFind` 查，结果从 `parentResults`、`sameAsResults` 回来；选中时从这一次的结果里取名字写进草稿（段头与“跟着本体”要写名字）。

右栏是“设定组”：标题一行定高，选定了种类、勾选作者动过（`typesTouched`）又与这个种类的默认不同时，右端淡入“恢复<种类>的默认”，点了换回默认并清掉 `typesTouched`（之后又跟着种类换），焦点交给勾选列表的搜索框；下面是撑满右栏的 `ComponentChecklist`（`fill`：搜索框、预设一排、按组列出的勾选行，没有“已添加”）。列表的“适用于<种类>”一组与预设跟着选定的种类（草稿的 `kindChosen`）换，打字时不换；点行勾算作者动过，点预设不算。Ctrl 加回车在这里不做什么。

页脚：“取消”与主按钮“新建”；失败的原因写在页脚左边的状态行（`Dialog` 的 `status`），按钮与正文都不动。每改一个字段发一次 `update:draft`（新的完整草稿）；“新建”发 `confirm`；取消、Escape、点遮罩发 `update:open(false)`（保存中不发）。

## 数据

```ts
type NewEntryDialogProps = {
    open: boolean;
    draft: NewEntryDraft; // new-entry.ts：名字、种类、分组、上级与名字、设定组、马甲与名字、出场、startKind
    /** 种类的候选：登记的在前，用过的在后。 */
    kinds?: readonly string[];
    /** 登记的种类默认带的设定组（类型 id）；没登记的种类不在里面。 */
    kindDefaults?: Readonly<Record<string, readonly string[]>>;
    /** 作品里已有的分组。 */
    folders?: readonly string[];
    /** 两个条目选择器的查找结果；默认没查过。 */
    parentResults?: EntryResults;
    sameAsResults?: EntryResults;
    /** 登记的类型：勾选列表的各行（没有“已添加”）。 */
    items?: readonly ChecklistItem[];
    /** 每个登记的种类的预设；没登记的种类不在里面。 */
    kindPresets?: Readonly<Record<string, readonly ChecklistPreset[]>>;
    // ChecklistItem、ChecklistPreset 见 component-checklist.ts；EntryResults 见 entry-picker.ts。
    chapters?: readonly {readonly id: string; readonly index: number}[];
    saving?: boolean;
    /** 失败的原因，写在页脚的状态行；默认空。 */
    error?: string;
};

type NewEntryDialogEmits = {
    (event: "update:open", value: boolean): void;
    (event: "update:draft", value: NewEntryDraft): void;
    (event: "confirm"): void;
    (event: "search-parent", query: string): void;
    (event: "search-same-as", query: string): void;
};
```

## 状态

- “位置与出场”的开合是组件自己的状态，每次挂上都收起；开合走 `Collapsible` 的高度与透明度过渡（`--motion-move`），箭头转 90 度（`--motion-fast`）。
- “恢复默认”出现与消失淡入淡出（`--motion-fast`），在定高的标题行里，不推动列表。
- 种类按钮的按下样子、段头的浅底换色走 `--motion-fast`。

## 隐藏通道理由

`state:inject`：经 `useCanonText()` 取宿主注入的翻译端口（命名空间 `nbook.canon`）。
