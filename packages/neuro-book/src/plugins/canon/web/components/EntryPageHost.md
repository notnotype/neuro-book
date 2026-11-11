---
标签: [state:inject, io:read]
别名: ["条目页宿主", "Entry Page Host"]
---

# EntryPageHost

条目页 `nbook.canon.entry` 的宿主（[`canon/author-ui.md`](../../../../../../../docs/specs/canon/author-ui.md) 输出 6 到 15、26、27）：按标签的状态（`state`，编辑器给每个标签的那一份）经读取层读条目、章表、渲染与情节，交给 `EntryPage` 与各分页的组件；数据分页按类型用 `canon.component-views` 交来的界面，没有、贡献方停了或加载失败时用 `FieldsDataView`。由 `entry-page.ts` 的页面实现创建。

## 数据

```ts
type EntryPageHostProps = {
    id: string;
    /** 编辑器给这个标签的响应式状态（`EntryPageState`）。 */
    state: EntryPageState;
    world: CanonWorld;
    fetchOrigins: (address: TextAddress, position: ReadPosition, mode: "actual" | "planned", cursor?: string) => Promise<OriginsPage>;
    views: ComponentViewRegistry;
    open: (ref: {readonly kind: "entry" | "change"; readonly id: string}) => void;
    /** 读到页头时报给页面实现：标签标题与面包屑用它。 */
    onHead: (head: EntryHead) => void;
};
```

## 隐藏通道理由

- `io:read`：读取随标签的状态变（换位置、换分页、展开一个值），只读当前分页要的；这些状态在页面里，宿主（编辑器）不知道条目页要读什么。只在真实界面里验证（`entry-page.dom.test.ts`），Lab 里看 `EntryPage` 与各分页的组件。
- `state:inject`：经 `useCanonText()`、`useText()` 取翻译端口。
