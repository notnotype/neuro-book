---
标签: [state:inject]
---

# ProfileRail

Profile 设置页的左栏（[`agent/profile-settings.md`](../../../../../../../docs/specs/agent/profile-settings.md) 输出 2）：可选的 Profile，然后一组“后台”，最后“新建 Profile”。每项两行：名称；来源，有问题时换成“不可用”或“有错误”。选择同 `ProviderRail`：当前项 `aria-current="page"` 与半透明选中底色，上下键与 Home、End 移动并选中，只有当前项在 Tab 序列里，两组算一个序列，“新建”不在里面。

## 数据

```ts
defineProps<{
    items: readonly ProfileView[];
    current: string;
    disabled?: boolean;   // 只读时停用“新建”，缺省 false
}>();
defineEmits<{
    (e: "select", key: string): void;
    (e: "create"): void;
}>();
```

没有 slots 与 expose，attrs 落在根元素上。

## 隐藏通道理由

- `state:inject`：文字经宿主注入的翻译端口取。
