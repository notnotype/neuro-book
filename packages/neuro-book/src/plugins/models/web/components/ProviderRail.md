---
标签: [state:inject]
---

# ProviderRail

“服务商与模型”页的左栏（[`models/settings-pages.md`](../../../../../../../docs/specs/models/settings-pages.md) 输出 1）：顶上“全部模型”（写可用模型数），一条分隔线，下面是添加过的服务商，最后“添加服务商”。每个服务商两行：名称；第二行先说密钥的问题（没有密钥、环境变量没有值），再说有没有模型检测失败，都没有时写启用了几个模型。选择照设置窗口左栏：当前项 `aria-current="page"` 与半透明选中底色，上下键与 Home、End 移动并选中，只有当前项在 Tab 序列里。

## 数据

```ts
defineProps<{
    providers: readonly SnapshotProvider[];
    current: string;                              // 服务商 id 或 "all"（受控）
    checks?: ReadonlyMap<string, CheckState>;     // 检测结果，键 `<服务商>/<模型>`，缺省空
    disabled?: boolean;                           // 只读时停用“添加服务商”，缺省 false
}>();
defineEmits<{
    (e: "select", id: string): void;
    (e: "add"): void;
}>();
```

没有 slots 与 expose，attrs 落在根元素上。

## 隐藏通道理由

- `state:inject`：文字经宿主注入的翻译端口取。
