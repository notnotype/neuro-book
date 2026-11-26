---
标签: [state:inject, env:clipboard]
别名: ["原始数据", "设定组的存储视图", "Component Raw View"]
---

# ComponentRawView

设定组分页的“原始数据”（[`canon/author-ui.md`](../../../../../../../docs/specs/canon/author-ui.md) 输出 54）：这一组存下来的原样，不跟“在看”走。两块：初值里这一组的数据，与改过这个条目这一组的剧情变更（每条只留落在这一组下的改动）。读取与裁剪由宿主做（`EntryPageHost`，`object` 与按 `namespace` 筛的 `changes`），这里只显示。

## 布局

- “初值”一节：应用的 `JsonViewer`（只读，树形，最高 320 像素、在里面滚）；初值里没有这一组（是剧情变更加上的）时一行弱色字“初值里没有这组设定”。
- “剧情变更（N 条）”一节：一个 `JsonViewer` 摊开已读到的各条，按安放从旧到新；还有没读的时下面一个“再显示 20 条”。一条也没有时一行弱色字。
- 读取中两节都写“读取中”；读失败时一行警告色的原因与“重试”。

## 交互

- 点“再显示”发 `more`，点“重试”发 `retry`。`JsonViewer` 自己的切换模式、复制、展开收起照常可用。

## 数据

```ts
type ComponentRawViewProps = {
    /** 初值里这一组的数据；undefined 是初值里没有这一组。 */
    initial: unknown;
    /** 已读到的剧情变更（宿主裁好的原样），按安放从旧到新。 */
    changes: readonly unknown[];
    /** 符合筛选的总条数。 */
    total: number;
    /** 还没读的条数；0 时不出“再显示”。 */
    remaining: number;
    loading: boolean;
    /** 读失败的原因；null 是没失败。 */
    failed: string | null;
};
type ComponentRawViewEmits = {
    (event: "more"): void;
    (event: "retry"): void;
};
```

没有插槽与 expose。

## 隐藏通道理由

`state:inject`：经 `useCanonText()` 取宿主注入的翻译端口。`env:clipboard`：`JsonViewer` 的复制按钮写系统剪贴板。
