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
| `incompatible` | 页面与服务端版本不一致 | 刷新页面 |
| `startup-failed` | 工作台启动失败 | 刷新页面 |
| `server-restarted` | 服务端已重启 | 刷新页面 |
| `closed` | 窗口已关闭 | 刷新页面 |

失败状态的根元素 `role="alert"`，并显示原因 `state.reason`（等宽、可断行）。根元素带 `data-browser-host-status="<status>"`，e2e 与挂载测试据此判断当前是哪一页。

## 不支持

- 不自动刷新：服务端重启后由用户点刷新，以后页面上有未保存内容时不会被刷掉。
- 不自己重试：重试与刷新都是事件，由宿主执行。
