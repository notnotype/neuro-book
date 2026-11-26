---
标签: [state:inject]
别名: ["确认条", "就地改", "Confirm Bar"]
---

# ConfirmBar

就地改的确认条与编辑卡（[`canon/author-ui.md`](../../../../../../../docs/specs/canon/author-ui.md) 输出 16、29、30、51）。两种样子：`bar` 是通用字段表与变更详情页顶上的确认条，`inline` 是人物、形象分页里的编辑卡（浮层或原处展开）。受控：填的值、意图、发生了什么、预览与原因都由宿主给（`in-place-edit.ts`），它只把交互翻成事件。

## 布局与交互

- 输入控件（`FieldInput`：数加单位、文字、有建议值的文字、选项、是否、引用、图片）；`inline` 时建议值嵌在输入框下面（`SuggestInput` 的 `inline`），成段的文字按内容长高、字号与行高同卡片上的原文、长到 8 行封顶（`FieldInput` 的 `prose`）。
- 选着剧情里变了时下面一行“发生了什么”（`note` 为 null 时不出），占位写不填时用的那一句（`noteFallback`）。`inline` 时只要意图里有剧情里变了，这一行就一直占着位置（`data-edit-note-slot`），选改设定时藏起来（`visibility` 加 `inert`，淡出淡入），两种意图卡片一样高；看得见时才有 `data-edit-note`。`bar` 照旧按需出现。
- `bar`：贴在分页顶上（`sticky`），外框用强调色，最上面写标题“改某某”；输入下面一行“这次改的是”加意图二选一（`SegmentedControl` 小号，只有一项时不出）；再下面是预览：预览在途写“正在预览…”，回来以后写写回哪里（`preview.route`）与逐条列出的变化（`data-edit-impact`），或者原因（危险色，`role="alert"`）与结局不明时的“再查一次”；最下面取消、保存靠右。
- `inline`：没有标题、外框与吸顶，放进宿主给的浮层或原处的编辑卡。提示：有原因时只写原因；没有原因、预览有别的变化（宿主在没有别的变化时给空的 `impact`）时一条警告色浅底的提示，收成“某某，还有 N 项”、整句在悬停提示里；不写写回哪里（落点在二选一里）。最下面一行：意图二选一（`SegmentedControl` 的 `raised`），结局不明时“再查一次”，右边取消与保存。保存是这张卡唯一的主色；单行的输入在保存旁写“↵”，成段的文字写“Ctrl ↵”（Mac 上写 ⌘），提示画在伪元素里，按钮另给 `aria-label`，读屏名只是“保存”。
- 两种样子的意图项名都是宿主给的 `intentLabels`（如“从最初起 | 从第 3 章起”），没给时写“改设定 | 剧情里变了”。出现、换内容按 `nb-ui-switch` 过渡。根上 `data-previewed` 表示预览回来了（测试等它）。
- `rows` 为 1 时文字是单行的输入框，短文字、有建议值的文字与数在输入框里按回车就是保存：预览回来以后发 `save`；预览还在途时也发（宿主等预览回来，除了正在改的这一项没有别的变化才存，有就停在预览上，见 `in-place-edit.ts`）；建议值的列表接走回车时不算。成段的文字回车换行，Ctrl（或 ⌘）加回车保存。

- 挂上时焦点进输入控件；用指针点了意图的一项以后焦点回到输入控件（键盘在意图里走时不动）。
- 改值：发 `update:value`；换意图：发 `update:intent`；写发生了什么：发 `update:note`。
- “保存”：发 `save`；预览没回来、没有预览、保存中、`locked` 或 `pristine`（填的值与打开时一样，宿主算）时不可用，`pristine` 时回车也不保存。原因（例如“这个值刚刚变了”）不锁保存：作者再点一次就行。
- “取消”或 Escape：发 `cancel`；Escape 落在输入法组字里时不发。
- 结局不明时原因后面有“再查一次”：发 `recheck`。

## 数据

```ts
type ConfirmBarKind = "number" | "text" | "suggest" | "enum" | "boolean" | "ref" | "image";
type EditIntent = "creative" | "story";

type ConfirmBarProps = {
    label: string;
    kind: ConfirmBarKind;
    options?: readonly string[];
    unit?: string;
    /** 数、文字、选项是字符串，是否是布尔，引用是条目 id 或 null，图片是 `{图片, 说明}` 或 null。 */
    value: unknown;
    /** 引用：条目选择器这一次的查找结果与当前值的名字。 */
    refResults?: EntryResults;
    refName?: string;
    intents: readonly EditIntent[];
    intent: EditIntent;
    /** 两项意图的写法；缺省 null（“改设定”“剧情里变了”）。 */
    intentLabels?: {readonly creative: string; readonly story: string} | null;
    /** 发生了什么；缺省 null（不出这一行）。 */
    note?: string | null;
    /** 不填时用的那一句；缺省空串。 */
    noteFallback?: string;
    /** `impact` 为空表示没有别的变化（不写提示）；`route` 只给宿主自己用，卡上不写。 */
    preview?: {readonly route: string; readonly impact: readonly string[]} | null;
    previewing?: boolean;
    /** 原因（`role="alert"`）；默认空。 */
    error?: string;
    recheck?: boolean;
    saving?: boolean;
    /** 保存不可用；默认 false。 */
    locked?: boolean;
    /** 缺省 "bar"。 */
    variant?: "bar" | "inline";
    /** 文字输入的行数；缺省 2。 */
    rows?: number;
    /** 填的值与打开时一样：保存不可用、回车不保存；默认 false。 */
    pristine?: boolean;
};

type ConfirmBarEmits = {
    (event: "update:value", value: unknown): void;
    /** 引用的条目选择器打开或打字。 */
    (event: "search-ref", query: string): void;
    (event: "update:intent", value: EditIntent): void;
    (event: "update:note", value: string): void;
    (event: "save"): void;
    (event: "cancel"): void;
    (event: "recheck"): void;
};
```

## 状态

- 默认、预览中（保存不可用）、有别的变化、有原因、保存中、锁住：如上。

## 隐藏通道理由

`state:inject`：经 `useCanonText()` 取宿主注入的翻译端口（命名空间 `nbook.canon`）。
