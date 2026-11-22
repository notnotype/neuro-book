---
标签: [state:local, state:inject, env:portal]
---

# AllModelsView

“服务商与模型”页左栏选“全部模型”时的右边（[`models/settings-pages.md`](../../../../../../../docs/specs/models/settings-pages.md) 输出 11）：回答“现在能用哪些模型”。每家服务商一节（图标、名称、启用数），默认收起、收起的不渲染；展开时发 `load` 要这家的行，节里列启用的模型（模型名、能力图标、上下文窗口、检测状态与编辑按钮）。不搜索时每节各自至多画 200 行。搜索框按名称与 id 过滤：开始搜索时对每家发 `load`，命中的节展开，一共至多画 200 行；多出的写“还有 N 条，缩小搜索词”。展开的节还在读、没有行时写“读取模型中”，读失败写原因；搜索没有命中写“没有匹配的模型”，还有服务商在读时先写“读取模型中”。所有服务商都没有启用的模型时写“没有启用的模型”。点编辑发 `edit`，由页面打开编辑对话框。

## 数据

```ts
defineProps<{
    providers: readonly SnapshotProvider[];
    rows?: Readonly<Record<string, readonly ModelRow[]>>;   // 各家已读到的行，按服务商 id，缺省空
    loading?: ReadonlySet<string>;                         // 正在读行的服务商 id，缺省空
    failures?: Readonly<Record<string, string>>;           // 读行失败的服务商 id → 原因，缺省空
    checks?: ReadonlyMap<string, CheckState>;   // 缺省空
    disabled?: boolean;                         // 缺省 false
}>();
defineEmits<{
    (e: "edit", provider: string, model: string): void;
    (e: "load", provider: string): void;      // 要这家的行；父组件读完经 `rows` 交回
}>();
```

没有 slots 与 expose，attrs 落在根元素上。

钩子：每节 `data-all-models-provider="<服务商 id>"`、每行 `data-all-models-row="<服务商>/<模型>"`、`data-all-models-search`、`data-all-models-loading`、`data-all-models-failure`、`data-all-models-none`、`data-all-models-more`。

## 隐藏通道理由

- `state:local`：搜索词与展开了哪几节。

- `state:inject`：文字经宿主注入的翻译端口取。
- `env:portal`：提示传送到 `body`。
