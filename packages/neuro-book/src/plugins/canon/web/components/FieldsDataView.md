---
标签: [state:inject, io:read]
别名: ["通用字段表", "Fields Data View"]
---

# FieldsDataView

数据分页的字段表界面（[`canon/author-ui.md`](../../../../../../../docs/specs/canon/author-ui.md) 输出 12、13）：没有专门界面的类型用它（通用字段表）。别的插件的专门界面经 `context.FieldTable` 嵌的一节通用字段也是它（`only` 只列其中几个字段）。经条目页给的 `context`（`ComponentViewContext`）读字段与来历，交给 `FieldTable` 与 `OriginList` 画；展开着哪个字段记在 `context.state.open`。

## 布局与交互

同 `FieldTable`：点值在这一行下面展开来历（`OriginList`），再点收起；来历在世界版本、所选位置或模式变了以后按已读的步数重读。

- 展开着的字段是数或语义档时，来历下面一行 `RecordForm`（输出 17）：语义档记一句，数记一笔，落在所选位置；填了一半的按字段存在 `context.state.records`，切走再回来还在。来历与记一笔是 `field-detail.ts` 的 `useFieldDetail`，与专门界面的 `FieldDetail` 同一份。初值上、按计划或写不了时表单不可用并写原因。
- 列表字段的元素与末尾的“添加”交给 `context.listAdd`、`listEdit`、`listRemove`（条目页开元素对话框）。

## 数据

```ts
type FieldsDataViewProps = {
    context: ComponentViewContext;
    /** 只列这几个字段（字段名）；默认列全部。 */
    only?: readonly string[];
};
```

## 状态

同 `FieldTable` 与 `OriginList`。

## 隐藏通道理由

- `io:read`：展开一个值、列出语义档的各句时经 `context.origins` 按页读来历；读多少页、什么时候重读（世界版本变了按已读步数重读）只有它知道，宿主给不出。所以它只在真实界面里验证（`entry-page.dom.test.ts`），Lab 里看 `FieldTable` 与 `OriginList`。
- `state:inject`：经 `useCanonText()` 取翻译端口。
