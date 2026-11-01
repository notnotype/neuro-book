---
标签: [state:inject, env:portal]
---

# AllModelsView

“服务商与模型”页左栏选“全部模型”时的右边（[`models/settings-pages.md`](../../../../../../../docs/specs/models/settings-pages.md) 输出 11）：所有服务商启用的模型一张表，列模型名、服务商、能力图标、上下文窗口、检测状态与编辑按钮；回答“现在能用哪些模型”。没有启用的模型时写“没有启用的模型”。点编辑发 `edit`，由页面打开编辑对话框。

## 数据

```ts
defineProps<{
    providers: readonly SnapshotProvider[];
    checks?: ReadonlyMap<string, CheckState>;   // 缺省空
    disabled?: boolean;                         // 缺省 false
}>();
defineEmits<{(e: "edit", provider: string, model: string): void}>();
```

没有 slots 与 expose，attrs 落在根元素上。

## 隐藏通道理由

- `state:inject`：文字经宿主注入的翻译端口取。
- `env:portal`：提示传送到 `body`。
