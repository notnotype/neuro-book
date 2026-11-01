---
标签: [state:local, state:inject, env:portal]
---

# ModelEditDialog

编辑一个模型的对话框，也用于自定义服务商的“手动添加”（[`models/settings-pages.md`](../../../../../../../docs/specs/models/settings-pages.md) 输出 9）。叠在设置窗口上，是二级对话框。分“基本”“能力与限制”“单价”“压缩”与默认收起的“高级”（模型级请求头，见 [`HeadersEditor`](HeadersEditor.md)）几节。表单是对话框自己的草稿：每次打开从当前模型重填，“保存”时校验，合格才经 `save` 交出模型配置，不合格的字段原位标原因、对话框不关；关闭不写。目录模型的能力、上限与单价来自目录，只读，交出的配置不带它们。

## 数据

```ts
defineProps<{
    open: boolean;                           // 受控
    providerKind: "catalog" | "custom";
    model: SnapshotModel | null;             // null 是手动添加：模型 id 可填、查重
    takenIds?: readonly string[];            // 手动添加时查重，缺省 []
    busy?: boolean;                          // 父组件写入中，缺省 false
    error?: string;                          // 写入失败的原因，显示在页脚，缺省空
}>();
defineEmits<{
    (e: "update:open", value: boolean): void;
    (e: "save", model: ModelConfig): void;   // 父组件写入成功后把 open 置假
}>();
```

没有 slots 与 expose；attrs 落在 `Dialog` 的面板上。

## 隐藏通道理由

- `state:local`：表单草稿（“保存”之前不写，取消即丢）。
- `state:inject`：文字经宿主注入的翻译端口取。
- `env:portal`：nb-ui `Dialog` 传送到 `body`。
