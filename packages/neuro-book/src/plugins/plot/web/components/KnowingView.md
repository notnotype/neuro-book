---
标签: [state:inject, io:read]
别名: ["知道什么", "Knows"]
---

# KnowingView

人物条目页的“知道什么”分页（[`plot/author-ui.md`](../../../../../../../docs/specs/plot/author-ui.md) 输出 16）：替换 `nbook.plot.knowing` 这一命名空间的通用字段表，经 canon 的 `canon.component-views` 交给条目页。

## 布局与交互

- 两组，各有小标题：“保密的事”列出所有秘密（没有行的写“不知道”），“别的事”只列有行的；没有一组时写“还没有知情”。
- 每行：程度（文字）、秘密的名字（按钮，打开它的条目页）、他以为的那句（信错了时）或怎么知道（“当时在场”“听某某说”“读到的”“推断的”）、右边来处（“初值”“第 N 章第 M 段”“前史”“目标出场时”“从某某带过来”）。
- 最下面一节“字段”是这一页的通用字段（`context.FieldTable`）：知情与听过的说法，点值看来历，“改”打开条目页的确认条。

## 数据

```ts
type KnowingViewProps = {
    /** 条目页给的数据分页 context（canon/author-ui.md 的 ComponentViewContext）。 */
    context: ComponentViewContext;
    /** canon 的读取服务。 */
    reads: CanonReads;
    /** `nbook.plot/author` 的调用。 */
    client: PlotAuthorClient;
};
```

没有事件、插槽与 expose。

## 隐藏通道理由

`io:read`：经读取服务读 `person`，随条目页的位置、模式与窗口的线换读取。`state:inject`：界面文字。
