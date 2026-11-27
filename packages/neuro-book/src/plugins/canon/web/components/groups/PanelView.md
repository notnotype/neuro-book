---
标签: [state:inject]
别名: ["面板", "值卡", "Panel View"]
---

# PanelView

数值（`panel`，原叫“面板”）的数据分页（[`canon/author-ui.md`](../../../../../../../../docs/specs/canon/author-ui.md) 输出 14）：一列值卡，每个字段一张；选中一张，旁边是这个字段的流水（来历，用 `OriginList`）。受控：值卡、选中哪张与流水的各行都由宿主给；canon 给面板交的界面 `PanelDataView` 经条目页的 `context` 读数据后交给它。

## 布局与交互

左边一列值卡（显示名、“改过”标记、当前值与单位；列表字段列出各元素），右边是“某某的流水”标题、`record` 插槽（记一笔的输入，写入片做）与流水。容器窄时流水换到值卡下面；视口 390 像素宽时值卡占满一行、流水在下面。

- 单击值卡（或 Enter、空格）：发 `select`（字段路径）；值卡是一组按钮，选中的那张 `aria-pressed` 为 true，用 Tab 在各张之间移动。
- `editing` 时可改的卡右边有“改”（同 `FieldTable`）：发 `edit`；不能改的卡那一格空着，各卡等宽、按钮上下对齐（这一格按最宽的按钮定宽，英文也放得下）。
- 流水的“再显示更早的”“重试”“改这一笔”：分别发 `more`、`retry`、`change`。
- 没有字段时写“还没有数值”。

## 数据

```ts
type PanelViewProps = {
    /** 值卡，形状同 `FieldTable` 的行。 */
    cards: readonly FieldRow[];
    /** 选中的值卡；默认没有，没有时不显示流水。 */
    selected?: string;
    /** 流水的各行，形状同 `OriginList`；默认空。 */
    ledger?: readonly OriginRow[];
    ledgerRemaining?: number;
    ledgerLoading?: boolean;
    ledgerFailed?: boolean;
    /** 流水读取失败时服务给的说明。 */
    ledgerReason?: string;
    /** 在可改的卡旁显示“改”；默认 false。 */
    editing?: boolean;
    /** “改”不可用的原因；默认空。 */
    editReason?: string;
};

type PanelViewEmits = {
    (event: "select", path: string): void;
    (event: "more"): void;
    (event: "retry"): void;
    (event: "change", id: string): void;
    (event: "edit", path: string): void;
};

type PanelViewSlots = {
    /** 流水上面的输入（`PanelDataView` 放 `RecordForm`）。 */
    record?(): unknown;
};
```

## 状态

- 默认、空数据：如上。流水的加载中与出错同 `OriginList`。禁用、只读：没有。

## 隐藏通道理由

`state:inject`：经 `useCanonText()` 取宿主注入的翻译端口（命名空间 `nbook.canon`）。
