---
标签: []
---

# FailurePage

宿主页：窗口还没有可挂载的工作台、或已不能继续使用时，由宿主显示的整页说明。它在任何插件激活之前就可能出现，所以只用系统颜色与宿主自己的样式（`src/web/styles.css` 的 `.nb-host-page`），不依赖主题。行为合同见 [`runtime.browser-host`](../../../../docs/specs/runtime/browser-host.md) 的“失败呈现”。

## 数据

```ts
type Props = {
    /** 窗口当前不是 ready 的状态（window.ts 的 WindowState），受控。 */
    state: Exclude<WindowState, {status: "ready"}>;
};

type Emits = {
    /** 连接失败时点“重试”：宿主原地重新启动窗口。 */
    retry: [];
    /** 点“刷新页面”：宿主重新加载整个文档。 */
    reload: [];
};
```

无 slots、无 expose；attrs 透传到根元素 `<main>`。

## 状态

| `state.status` | 标题 | 动作 |
|---|---|---|
| `idle`、`starting` | 正在连接服务端… | 无；根元素 `role="status"` |
| `connection-failed` | 无法连接服务端 | 重试 |
| `project-unavailable` | 无法打开项目 | 重试；“不打开项目”链接到 `/` |
| `incompatible` | 页面与服务端版本不一致 | 刷新页面 |
| `startup-failed` | 工作台启动失败 | 刷新页面 |
| `server-restarted` | 服务端已重启 | 刷新页面 |
| `project-gone` | 项目已关闭 | 刷新页面；“不打开项目”链接到 `/` |
| `closed` | 窗口已关闭 | 刷新页面 |

失败状态的根元素 `role="alert"`，并显示原因 `state.reason`（等宽、可断行）。根元素带 `data-browser-host-status="<status>"`，e2e 与挂载测试据此判断当前是哪一页。

状态带 `rescued`（转入终态时插件经 `windowRescueKey` 交出的未保存正文）时，页面下方列出“未保存的修改”：每项是文件地址、“复制正文”按钮（写系统剪贴板，成功后按钮文字变“已复制”；剪贴板不可用时不报错，正文仍可在文本框里手动选中）与只读文本框。

## 不支持

- 不自动刷新：服务端重启、项目关闭后由用户点刷新，页面上列出的未保存内容不会被刷掉；刷新之后它们不保留。
- “不打开项目”是普通链接（整页加载 `/`），不经事件：回到 `/` 就是一个不绑定项目的新窗口。
- 不自己重试：重试与刷新都是事件，由宿主执行。
