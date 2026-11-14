---
标签: [state:inject]
---

# CloseLayer

桌面壳关窗时的“正在关闭”层与宿主自己的询问。行为合同见 [`runtime.browser-host`](../../../../docs/specs/runtime/browser-host.md) 输出 10；询问的先后在 `host/close-query.ts`，层与询问的状态、挡输入的做法在 `host/close-ui.ts`。它是一个独立的 Vue 根：`boot.ts` 在窗口启动之前把它挂到 `body` 下的 `[data-close-root]` 上，不随宿主页与工作台切换卸载，加载页阶段也能显示。普通浏览器里不会有壳的询问，它什么也不画。

## 数据

```ts
type Props = {
    /** 关闭前询问的界面状态（close-ui.ts 的 CloseUi）：层开没开、当前的询问；用户的选择经 `ui.answer` 交回。 */
    ui: CloseUi;
};
```

无 emits、无 slots、无 expose。

## 布局与状态

- **层**：一个模态对话框 `[data-close-layer]`，标题“正在关闭…”，没有按钮，Escape 与点遮罩都不关它。它关完（`closed`）之后把焦点还给盖层之前的位置。
- **询问**：叠在层上的第二个模态对话框 `[data-close-prompt]`，三种：
  - 关闭前的检查出错：原因写在 `[data-close-reason]`；
  - 宿主页上未保存的正文会丢失：文件路径列在 `[data-close-items]`；
  - 在跑的工作会被中断：各项按窗口语言显示在 `[data-close-items]`，取不到时多一行 `[data-close-uncertain]`。
- 按钮“取消”`[data-close-cancel]`（打开时的焦点）与“仍然关闭”`[data-close-confirm]`；Escape 与点遮罩等于取消。
- 参与方（例如编辑器）自己的对话框在询问期间打开，同样叠在层上面。

## 隐藏通道理由

- `state:inject`：经 `useText()` 取宿主注入的翻译端口，翻译宿主目录 `nbook.host` 的 `close.*` 与插件交来的工作项文字。
