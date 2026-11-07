---
标签: [state:local, state:inject, env:portal]
---

# AddToolsDialog

“添加工具”对话框（[`agent/profile-settings.md`](../../../../../../../docs/specs/agent/profile-settings.md) 输出 14、15），做法同 `ManageModelsDialog`：搜索，按提供者分组，每行“+”，点过变“−”。改动留在对话框里，“完成”时只交一次差，没有改动直接关，“取消”不写。

## 布局

上面搜索框，下面可滚动的列表（上限 420px，两侧留内边距让焦点环不被裁）。组头同 `ProviderDetail` 的系列，不折叠。每行两行文字：名字与等级；说明，单行截断，有同名工具时说明后面接“加入后换掉已开的同名工具”。行等高。

## 交互

- 候选在打开时定下：打开期间目录变了不刷新，完成时的改动由页面对当时的设置值求值。
- 同名的只能选一个：选了另一个，先选的自动取消。
- 同名工具是 Profile 必需的：“+”停用，说明换成原因。
- `busy` 时按钮停用；失败原因由 `status` 写在页脚左侧，对话框不关。
- 按钮的可访问名称带工具名与 id。

## 数据

```ts
defineProps<{
    open: boolean;                                     // 受控；每次打开从 candidates 重来
    candidates: readonly ProfileToolCandidateGroup[];
    busy?: boolean;                                    // 缺省 false
    status?: string;                                   // 写入失败的原因，缺省空
}>();
defineEmits<{
    (e: "update:open", value: boolean): void;
    (e: "done", change: ToolChange): void;             // 有改动才发；父组件写入成功后关掉
}>();
```

没有 slots 与 expose；attrs 落在 `Dialog` 的面板上。

## 隐藏通道理由

- `state:local`：搜索词、选中的工具。
- `state:inject`：文字经宿主注入的翻译端口取。
- `env:portal`：nb-ui `Dialog` 传送到 `body`。
