---
标签: [state:local, state:inject]
---

# ProfileSettingsPage

设置窗口的“Profile”分区（[`agent/profile-settings.md`](../../../../../../../docs/specs/agent/profile-settings.md)）：左边 [`ProfileRail`](ProfileRail.md)，右边 [`ProfileDetail`](ProfileDetail.md)。组件只管选中与布局，取数、写入在包装 `profile-page.ts`。

## 布局

撑满分区。加载中与读失败占满内容区居中（转动的指示加一句说明；图标、原因加“重试”，`role="alert"`）。页面窄于 600px 时左栏收成顶上的下拉加“新建”（同 `ProvidersPage`），下拉选项的说明写状态，后台的排最后。右边自己滚动，两侧留内边距让焦点环不被裁。

## 交互

- 选中项消失（删了、重载后没了）时回到第一项。
- 其余事件原样交给包装。

## 数据

```ts
defineProps<{
    state: "loading" | "ready" | {failed: string};
    profiles: readonly ProfileView[];
    writable?: boolean;      // 缺省 true
    initial?: string;        // 起始选中，缺省第一项（Lab 用）
}>();
defineEmits<{
    (e: "retry"): void;
    (e: "model", key: string, value: string): void;
    (e: "approval", key: string, value: string): void;
    (e: "open-file", key: string): void;
}>();
```

没有 slots 与 expose，attrs 落在根元素上。

## 隐藏通道理由

- `state:local`：选中项。
- `state:inject`：文字经宿主注入的翻译端口取。
