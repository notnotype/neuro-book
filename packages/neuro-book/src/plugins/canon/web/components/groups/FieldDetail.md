---
标签: [state:inject, io:read]
别名: ["值的细节", "Field Detail"]
---

# FieldDetail

一个值的细节（[`canon/author-ui.md`](../../../../../../../../docs/specs/canon/author-ui.md) 输出 11、13、17、51）：专门界面经 `context.FieldDetail` 放在浮层或展开处。读写都经 `context`，与通用字段表同一份逻辑（`field-detail.ts` 的 `useFieldDetail`）。

## 布局与交互

- 语义档的字段：从旧到新列出起点（“起点：……”）与之后记下的各句，各带位置；更早的写“还有更早的 N 句”；下面是“记一句”（`RecordForm` 的语义档），再下面“改起点”（发 `context.edit(path, {inline: true})`）。
- 别的字段：这个值的来历（`OriginList`，同通用字段表展开的那一行，可以“再显示更早的”、点一步打开那条变更）；数另有“记一笔”。
- 记一笔不可用时（选着最初、算着计划、写不了）表单写原因；失败的原因写在表单下面。

## 数据

```ts
type FieldDetailProps = {
    context: ComponentViewContext;
    /** 这个命名空间里的字段名。 */
    path: string;
};
```

没有事件、插槽与 expose；attrs 落在根上。

## 隐藏通道理由

- `io:read`：经 `context.origins` 按页读这个值的来历；读多少页、什么时候重读（世界版本变了按已读步数重读）只有它知道，宿主给不出（同 `FieldsDataView`）。所以它只在真实界面里验证（`entry-page.dom.test.ts`），Lab 里看 `OriginList` 与 `RecordForm`。
- `state:inject`：经 `useCanonText()` 取宿主注入的翻译端口（命名空间 `nbook.canon`）。
