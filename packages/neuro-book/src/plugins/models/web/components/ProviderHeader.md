---
标签: [state:local, state:inject, env:portal]
别名: ["服务商标题区", "Provider Header"]
---

# ProviderHeader

服务商详情的标题区（[`models/settings-pages.md`](../../../../../../../docs/specs/models/settings-pages.md) 输出 4）：左边图标按钮、中间名称、右边“复制一份”。删除不在这里，仍在左栏条目上（决定 19）。

## 布局与交互

- **图标**：点图标按钮开一个面板，三页签。“内置”：搜索框加网格，只列模板用到的、图标表里有的；“上传”：选一张图片，在客户端缩成边长 128 像素以内的 PNG 再发 `set-icon`（不收 SVG；不是图片、读取失败、缩后仍过大各有原因）；“首字母”：一个按钮。服务商已有自己的图标时底部多一个“恢复模板的图标”。面板里一行 `role="alert"` 写失败原因（客户端的，或父组件交回的 `iconError`）；写入中（`iconBusy`）与上传中面板的控件停用。
- **名称**：点铅笔变成输入框，回车或失焦提交，Esc 取消并把焦点还给铅笔；空名或没改回退不报错；与别家重名在输入框下写“已有同名服务商”并停在编辑状态，不发事件。名称保持 `h3` 的标题语义。
- **复制一份**：发 `duplicate`，写入中停用；成功后父组件选中副本并把焦点放到名称，密钥没复制成功时父组件通知。
- 窄屏（390 宽）或英文放不下时按钮换到下一行，名称省略号截断。

## 数据

```ts
defineProps<{
    provider: SnapshotProvider;
    takenNames?: ReadonlySet<string>;     // 别家的名称（小写），缺省空
    builtinKeys?: readonly string[];      // 内置图标可选的键，缺省空
    disabled?: boolean;                   // 只读时停用，缺省 false
    iconBusy?: boolean;
    iconError?: string;
    duplicating?: boolean;
    codec?: IconCodec;                    // 缩图的解码与编码；缺省是浏览器画布，测试给假的
}>();
defineEmits<{
    (e: "rename", name: string): void;
    (e: "set-icon", icon: {kind: "upload"; png: string} | {kind: "builtin"; key: string} | {kind: "initial"} | null): void;
    (e: "duplicate"): void;
}>();
```

钩子：`data-provider-header`、`data-provider-icon-button`、`data-provider-icon-panel`、`data-icon-choice`、`data-icon-file`、`data-icon-initial`、`data-icon-restore`、`data-icon-error`、`data-provider-name`、`data-provider-rename`、`data-provider-name-input`、`data-name-problem`、`data-provider-duplicate`。

## 隐藏通道理由

- `state:local`：名称是否在编辑与草稿、面板的页签与搜索词、上传中、客户端的失败原因。
- `state:inject`：文字经宿主注入的翻译端口取。
- `env:portal`：图标面板与提示传送到 `body`。
