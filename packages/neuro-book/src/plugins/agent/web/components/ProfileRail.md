---
标签: [state:inject]
---

# ProfileRail

Profile 设置页的左栏（[`agent/profile-settings.md`](../../../../../../../docs/specs/agent/profile-settings.md) 输出 2）：可选的 Profile，然后一组“后台”，最后“新建 Profile”。每项一行，高度同设置窗口左栏：图标、名称，行尾定宽的一格；有问题时这一格是图标（不可用是禁止图标、有错误是警示图标，颜色照问题的轻重），悬停条目时提示名称与原因（条目的 `title`，同 `ProviderRail`），原因也是条目的读屏描述；没有问题时空着。来源不写在列表里，详情头部的提示里有。选择同 `ProviderRail`：当前项 `aria-current="page"` 与半透明选中底色，上下键与 Home、End 移动并选中，只有当前项在 Tab 序列里，两组算一个序列，“新建”不在里面。

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
