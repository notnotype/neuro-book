---
标签: [state:local, state:inject]
别名: ["人物卡", "角色卡", "Character Card"]
---

# CharacterCard

人物分页的展示层（[`canon/author-ui.md`](../../../../../../../docs/specs/canon/author-ui.md) 输出 49、51、52）：只收属性、发事件，不读写世界；绑定层 `CharacterView` 把 `context` 折成它的属性，并经插槽把就地改的编辑器与细节放进来。Lab 里直接挂它。

## 布局与交互

- 左边立绘（`CanonImage`，竖长 3:4、宽度固定，宽窗口里不随窗口变大），右边短资料两列、一项一行（行高固定：换成“填写”、多出“第 N 章改过”或行尾按钮都不改变行高），末尾“添加一项资料”；下面是现在的状态（一行，可换行），再下面成段的文字各一节。容器窄于 520 像素时立绘在上、缩小；右边资料那一栏窄于 34rem（放不下两列）时资料排成一列。
- 立绘那一格按 `portrait`：`image` 是图（悬停显出“形象”），`no-image` 是“添加立绘”，`absent` 也是“添加立绘”（宿主点了一次到位：加上形象、切过去、打开选图），`removed` 是“恢复形象”，`later` 写“第 N 章起有形象”（不可点），`unavailable` 时这一格不画。点了发 `portrait`。
- 值本身是按钮：点了发 `edit(id, 按钮)`；值是 null 时写“填写”。引用的值用链接色。读屏名是“显示名：值”（一个刚建的人物有六七个“填写”）；一行放不下截断时悬停看整个值。写不了时（`editReason` 非空）按钮不可用、悬停写原因。值换了淡入换上。
- 有 `mark` 时值旁有“第 N 章改过”按钮，点了发 `origins(id, 按钮)`。
- 自己加的项（`own`）行尾常显“更多”（低对比度，指到这一行变清楚）：菜单“改名”“去掉”，发 `rename`、`remove`。
- “添加一项资料”（`canAdd` 时）：浮层（受控 `addOpen`）里列 `presets`（点了发 `add-preset`）与 `removed`（“恢复‘某某’”，发 `restore`），下面一栏自己写名字（回车或“添加”发 `add-own`），被拒的原因 `addError` 写在下面。`adding` 时按钮不可用。宿主加好以后调 `clearOwn()` 清掉那一栏。
- 现在的状态：值是按钮，点了发 `toggle-condition`；`conditionOpen` 时下面浮出细节（`condition-detail` 插槽），不推动后面的内容。它的“第 N 章改过”也是按钮、同样展开细节（语义档的来历就是细节里的起点与各句）。值的位置上也有 `passage-editor` 插槽（细节里的“改起点”）。
- 每段文字：值是按钮（空着写 `hint`），点了发 `edit`；`passage-editor` 插槽放在这一段原文按钮的后面：插槽里的编辑卡带 `data-editing-in-place` 时原文藏起来，原文占位不变（`visibility: hidden`），编辑卡浮在原处、向下长，盖住后面的内容，别的内容不动（输出 51；现在的状态的值与它的插槽同样）。有 `mark` 时标题旁“第 N 章改过”按钮发 `origins(id, 按钮)`。
- 立绘那一格加上形象在途（`portraitBusy`）时不可用，被拒的原因（`portraitError`）写在立绘下面。
- 过渡：资料行加去、细节出现消失、值（短资料、现在的状态、成段的文字）换了按设计语言的动效；减弱动效时不动。

## 数据

```ts
type CharacterCardProps = {
    facts: readonly CardFact[];
    condition?: CardPassage | null;
    passages?: readonly CardPassage[];
    portrait: CardPortrait;
    editReason?: string;
    /** 值按钮的 `data-edit` 写成 `<命名空间>.<字段>`；缺省只写字段名。 */
    namespace?: string;
    conditionOpen?: boolean;
    canAdd?: boolean;
    presets?: readonly CardAddable[];
    removed?: readonly CardAddable[];
    addError?: string;
    adding?: boolean;
    addOpen?: boolean;
    /** 立绘那一格加上（恢复）形象在途：不可用。 */
    portraitBusy?: boolean;
    /** 加上形象被拒的原因，写在立绘下面。 */
    portraitError?: string;
};
// CardFact、CardPassage、CardPortrait、CardAddable 见 character-card.ts。

type CharacterCardEmits = {
    (event: "edit", id: string, anchor: HTMLElement): void;
    (event: "origins", id: string, anchor: HTMLElement): void;
    (event: "toggle-condition"): void;
    (event: "portrait"): void;
    (event: "add-preset", id: string): void;
    (event: "restore", id: string): void;
    (event: "add-own", label: string): void;
    (event: "rename", id: string): void;
    (event: "remove", id: string): void;
    (event: "update:addOpen", value: boolean): void;
};

type CharacterCardSlots = {
    editor?(props: {id: string; anchor: HTMLElement | null}): unknown;
    "passage-editor"?(props: {id: string}): unknown;
    "condition-detail"?(props: {id: string}): unknown;
};

type CharacterCardExpose = {clearOwn(): void};
```

## 隐藏通道理由

- `state:local`：各值按钮的元素（给插槽作浮层的锚）、自己写名字那一栏填的字。
- `state:inject`：canon 的翻译端口；立绘的取图地址经 `CanonImage` 注入。
