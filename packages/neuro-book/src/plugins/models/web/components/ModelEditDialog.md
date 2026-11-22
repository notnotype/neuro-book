---
标签: [state:local, state:inject, env:portal]
---

# ModelEditDialog

编辑一个模型的对话框，也用于“手动添加”（每家服务商都有）（[`models/settings-pages.md`](../../../../../../../docs/specs/models/settings-pages.md) 输出 9）。叠在设置窗口上，是二级对话框。分“基本”“能力与限制”“单价”“压缩”与默认收起的“高级”（模型级请求头，见 [`HeadersEditor`](HeadersEditor.md)）几节。表单是对话框自己的草稿：只在打开时从当前模型填一次（开着时别处改了这个模型不打断正在填的表单），“保存”时校验，合格才经 `save` 交出模型配置，不合格的字段原位标原因、对话框不关（请求头有没填完的行也算）；关闭不写。来源模型（模板目录里的）各字段先填目录的值，可以改；用户改过、与来源值不同的字段（行的 `overridden`，六个：名称、上下文窗口、最大输出、能看图、支持推理、单价）旁有“恢复来源值”（`data-restore="<字段>"`），点了把行的 `source` 里的来源值填回表单、按钮消失；保存时照表单交出，服务端存条目时去掉与来源值相同的字段，这个覆盖就没了。来源没给上下文窗口时窗口不能恢复成“不明”。手加的模型整条交出；推理档不在表单里编辑，手加的原样带回，来源模型不带。模型在对话框开着时被别处删掉，由页面关掉对话框。

## 数据

```ts
defineProps<{
    open: boolean;                           // 受控
    model: ModelRow | null;                  // 模型行（`providerModels` 读到的）；null 是手动添加：模型 id 可填、查重
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
