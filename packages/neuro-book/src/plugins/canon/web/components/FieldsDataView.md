---
标签: [state:inject, io:read]
别名: ["通用字段表", "人物的界面", "Fields Data View"]
---

# FieldsDataView

数据分页的字段表界面（[`canon/author-ui.md`](../../../../../../../docs/specs/canon/author-ui.md) 输出 12、13）：没有专门界面的类型用它（通用字段表），canon 给人物（`nbook.canon.person`）交的界面也是它（`semanticNotes`）。经条目页给的 `context`（`ComponentViewContext`）读字段与来历，交给 `FieldTable` 与 `OriginList` 画；展开着哪个字段记在 `context.state.open`。

## 数据

```ts
type FieldsDataViewProps = {
    context: ComponentViewContext;
    /** 语义档的字段在值下面列出起点与之后记下的每一句；默认 false。 */
    semanticNotes?: boolean;
};
```

## 状态

同 `FieldTable` 与 `OriginList`。

## 隐藏通道理由

- `io:read`：展开一个值、列出语义档的各句时经 `context.origins` 按页读来历；读多少页、什么时候重读（世界版本变了按已读步数重读）只有它知道，宿主给不出。所以它只在真实界面里验证（`entry-page.dom.test.ts`），Lab 里看 `FieldTable` 与 `OriginList`。
- `state:inject`：经 `useCanonText()` 取翻译端口。
