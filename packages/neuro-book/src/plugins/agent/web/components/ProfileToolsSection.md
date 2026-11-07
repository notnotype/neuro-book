---
标签: [state:local, state:inject, env:portal]
---

# ProfileToolsSection

Profile 设置页的工具一节（[`agent/profile-settings.md`](../../../../../../../docs/specs/agent/profile-settings.md) 输出 10–13）：只列模型看到的工具，按提供者分组，另外经 [`AddToolsDialog`](AddToolsDialog.md) 添加。

## 布局

标题行：“工具”、说明图标（下一次模型请求起生效）、开着几个，右边“恢复默认”（这个 Profile 在绑定里有项时才有）与“添加工具”。标题行的高度不随“恢复默认”的有无变。

下面每组：组头同 `ProviderDetail` 的模型系列（折叠箭头、组名、个数）；一个工具一行，带分隔线，名字、等级、说明各占一列上下对齐，说明单行截断，悬停看全文；最右一格定宽，放“必需”或“×”，文字宽度不随它变。页面窄于 600px 时一行变两行：名字、等级、最右一格；说明。

## 交互

- 组头是按钮，点了折叠，`aria-expanded`；折叠状态不保存。
- “×”发 `remove`，可访问名称带工具名与 id，同名的也分得清。`disabled` 时停用“×”“恢复默认”“添加工具”。
- 完成的写入由 `addTools` 交回结果，失败留在对话框。

## 数据

```ts
defineProps<{
    tools: ProfileToolsField;
    disabled?: boolean;                                                 // 缺省 false
    addTools?: (change: ToolChange) => Promise<string | null>;          // 失败原因，成功 null
    initialAdd?: boolean;                                               // 起始打开对话框（Lab 用），缺省 false
}>();
defineEmits<{
    (e: "remove", id: string): void;
    (e: "restore"): void;
}>();
```

没有 slots 与 expose，attrs 落在根元素上。

## 隐藏通道理由

- `state:local`：折叠的组、对话框开着没有。
- `state:inject`：文字经宿主注入的翻译端口取。
- `env:portal`：提示与对话框传送到 `body`。
