---
标签: [state:inject, state:shared-write, io:read]
别名: ["改动记录宿主", "Change History Host"]
---

# RevisionsViewHost

底部面板“改动记录”视图的宿主（[`canon/author-ui.md`](../../../../../../../../docs/specs/canon/author-ui.md) 输出 24、26 到 28）：经读取层分页读 `revisions`（按两个筛选）与章表，折成 `RevisionsView` 的数据（`revisions.ts`）。由 `revisions-view.ts` 的视图实现创建；筛选与当前行在窗口里那一份 `RevisionsViewState` 上，视图停放、卸载再挂上时还在。

## 布局与交互

- 一次读 50 条；“再显示更多”读下一页。世界变了以后读取层按已经读出来的条数重读，行按修订 id 原地替换（输出 24）。
- `visible` 为假（视图停放、收起）时不读：两个读取都释放；屏幕上留着最后读到的行，回到前台时先显示它们，同时重读（输出 26）。
- 换筛选时接着显示旧的行，直到新的读到。筛着的那一章被删掉以后回到“全部章”。
- “还原”放进窗口里那一个还原对话框（`RevertRequests`）；对话框成功以后的提示由窗口里那一份保存后的提示决定去处：没有条目页、回执页、变更详情页挂着时是一条工作台通知（输出 18，验收 12）。
- “看回执”调 `receipt`，打开回执页。
- 世界写不了时（`writable.ts` 的 `writeBlocked`）所有“还原”不可用；只读另给横幅（`readOnlyBanner`）。

## 数据

```ts
type RevisionsViewHostProps = {
    world: CanonWorld;
    state: RevisionsViewState;
    revert: RevertRequests;
    receipt: (revision: string) => void;
    /** 视图可见（`ViewContext.visible`）。 */
    visible: boolean;
};
```

没有事件、插槽与 expose。

## 隐藏通道理由

- `io:read`：读什么取决于筛选与读到了几页，工作台不知道；读取随世界变跟着重读。只在真实界面里验证（`revisions-view.dom.test.ts`），Lab 里看 `RevisionsView`。
- `state:shared-write`：筛选与当前行写进窗口里那一份视图状态；点“还原”时往还原对话框里放要还原的那一次。
- `state:inject`：经 `useCanonText()`、`useText()` 取翻译端口。
