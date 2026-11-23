---
标签: [state:inject]
---

# TasksHover

状态栏“后台任务”条目的悬停内容（[`workbench/background-tasks.md`](../../../../../../../docs/specs/workbench/background-tasks.md) 输出 12、27）：列出在跑的后台一次性工作（自己的任务与提供方不是前台的行，服务端给前 20 件），每件两行，标题与进度条一行、进展一行；超过 20 件时末尾写“还有 N 件”。外壳在条目上方的提示框里显示它（[`ui/workbench-shell.md`](../../../../../../../docs/specs/ui/workbench-shell.md) 输出 43）。

## 布局

宽 16rem（提示框最宽 18rem）；两列：标题（截断）与 56px 的进度条；进展占一整行、淡一档。数字画确定进度，`null` 画不确定进度。没有在跑的任务时（条目只剩图标）只写一句说明，与条目的 `tooltip()` 同一句（`statusSummary`）：有没看过的失败时写“后台任务：有没看过的失败”，否则写“后台任务：都结束了”；宽度随文字。

## 数据

```ts
type Props = {
    /** 本窗口的任务仓库，只读它的 `background`。必填。 */
    store: TasksStore;
};
```

没有事件、插槽与 expose。

## 隐藏通道理由

- `state:inject`：经 `useText()` 取窗口的翻译端口，翻任务的标题与进展（文字值）。
