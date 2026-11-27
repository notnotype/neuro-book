---
标签: [state:inject]
别名: ["记一笔", "Record Form"]
---

# RecordForm

面板流水上面、通用字段表展开着的数或语义档字段的来历下面的“记一笔”（[`canon/author-ui.md`](../../../../../../../../docs/specs/canon/author-ui.md) 输出 17）：精确档填一句发生了什么与变化量（可正可负），语义档只填一句。受控：填的内容、原因与保存中由宿主给（`PanelDataView`、`FieldsDataView`）。

## 布局与交互

一行：发生了什么、变化（语义档没有）、“记一笔”按钮；宽度不够时换行。不可用时输入控件禁用，下面一行写原因（选着最初时“先选一章”、算着计划时“先不算计划”、世界写不了）；上一次没记进去时原因写在下面（`role="alert"`）。

- 改内容：发 `update:text`、`update:delta`。
- 按钮或 Enter：发 `submit`；没填发生了什么、精确档的变化量不是数、不可用或保存中时不发。

## 数据

```ts
type RecordFormProps = {
    semantic?: boolean;
    delta: string;
    text: string;
    blockedReason?: string;
    error?: string;
    saving?: boolean;
};

type RecordFormEmits = {
    (event: "update:delta", value: string): void;
    (event: "update:text", value: string): void;
    (event: "submit"): void;
};
```

## 隐藏通道理由

`state:inject`：经 `useCanonText()` 取宿主注入的翻译端口（命名空间 `nbook.canon`）。
