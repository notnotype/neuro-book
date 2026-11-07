---
标签: [state:local, state:inject, env:portal]
---

# NewProfileDialog

新建用户级 Profile 的对话框（[`agent/profile-settings.md`](../../../../../../../docs/specs/agent/profile-settings.md) 输出 21）：只问名字。

## 布局

`Dialog` 的小号，一个字段：名字；字段说明写规则，填了名字时写文件地址与 key。提交之后才知道的错（同名、新建失败）写在页脚左侧的状态行，字段标红并得到焦点。

## 交互

- 每次打开名字清空。回车或“新建并打开”发 `create`；名字不合规则时不发，原位说明。
- `busy` 时按钮停用。
- 失败原因由 `status` 给，对话框不关；改了名字后状态行由页面清掉（发 `edit`）。

## 数据

```ts
defineProps<{
    open: boolean;     // 受控
    busy?: boolean;    // 缺省 false
    status?: string;   // 失败原因，缺省空
}>();
defineEmits<{
    (e: "update:open", value: boolean): void;
    (e: "create", name: string): void;
    (e: "edit"): void;
}>();
```

没有 slots 与 expose；attrs 落在 `Dialog` 的面板上。

## 隐藏通道理由

- `state:local`：名字。
- `state:inject`：文字经宿主注入的翻译端口取。
- `env:portal`：nb-ui `Dialog` 传送到 `body`。
