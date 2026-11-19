---
标签: [state:inject, io:read]
别名: ["目标与态度", "Goals and Attitudes"]
---

# AttitudeView

人物条目页的“目标与态度”分页（[`plot/author-ui.md`](../../../../../../../docs/specs/plot/author-ui.md) 输出 17）：替换 `nbook.plot.attitude` 这一命名空间的通用字段表，经 canon 的 `canon.component-views` 交给条目页。

## 布局与交互

- 他的目标（各状态都列），画法同目标表的一组（`GoalGroup`）。
- 态度一张表：对象（按钮）、态度（未归纳时写“还没归纳”）、起因（按钮，没有时空着）、称呼。
- 目标与态度都没有时写“还没有目标与态度”。
- 最下面一节“字段”是这一页的通用字段（`context.FieldTable`）：态度，点值看来历，“改”打开条目页的确认条。

## 数据

```ts
type AttitudeViewProps = {
    context: ComponentViewContext;
    reads: CanonReads;
    client: PlotAuthorClient;
};
```

没有事件、插槽与 expose。

## 隐藏通道理由

同 `KnowingView`（与它读同一个 `person`，读取层里合并成一次）。
