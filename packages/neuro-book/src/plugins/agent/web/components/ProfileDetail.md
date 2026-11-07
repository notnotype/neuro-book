---
标签: [state:inject, env:portal]
---

# ProfileDetail

Profile 设置页右边的一个 Profile（[`agent/profile-settings.md`](../../../../../../../docs/specs/agent/profile-settings.md) 输出 3–9）：头部一行、模型与审批，下面的默认插槽放工具一节。

## 布局

头部一行，高度等于小号控件：名称（超长截断）、说明（占剩下的宽度，截断）、问题块（[`SettingsNotice`](../../../../ui/settings/SettingsNotice.md)，说明先让位）、用户级的两个图标按钮。名称加说明是一个提示的触发器，可以聚焦，提示写全文、key 与来源：说明为空或被挤没时也拿得到。

模型、审批各一行，左边标题与说明（文字块 40px：20、2、18，同 `SettingsRow`，说明行单行截断），右边控件。有问题时标题后一个 14px 的警告图标，说明行换成问题并用警告色：一行本来就是两行，换字不改高度。页面窄于 600px 时控件换到标题下面。

## 交互

- 改模型发 `model`，改审批模式发 `approval`，值的编码见 `profile-view.ts`；由页面写入。
- `打开文件`发 `open-file`，只读时也能点；`删除`发 `delete`，`disabled` 时停用。

## 数据

```ts
defineProps<{
    profile: ProfileView;
    disabled?: boolean;   // 这一层不能写时为真，缺省 false
}>();
defineEmits<{
    (e: "model", value: string): void;
    (e: "approval", value: string): void;
    (e: "open-file"): void;
    (e: "delete"): void;
}>();
```

默认插槽放工具一节。没有 expose，attrs 落在根元素上。

## 隐藏通道理由

- `state:inject`：文字经宿主注入的翻译端口取。
- `env:portal`：下拉与提示传送到 `body`。
