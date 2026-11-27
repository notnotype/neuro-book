---
标签: [state:local, state:inject, state:shared-write, io:read, io:mutate]
别名: ["待处理宿主", "Pending Host"]
---

# PendingViewHost

底部面板“待处理”视图的宿主（[`canon/author-ui.md`](../../../../../../../../docs/specs/canon/author-ui.md) 输出 23、25 到 28）：经读取层分页读展开着的组（`pending`，缺省位置、实际模式，同状态栏的条数），读各行与选中那一条要的对象（`object-heads.ts`）与条目名字（`entry-heads.ts`），折成 `PendingView` 的数据（`pending.ts`）；管选中的规则与“强行解除”。由 `pending-view.ts` 的视图实现创建；展开与选中在窗口里那一份 `PendingViewState` 上。

## 布局与交互

- 每组一次读 50 条；收起的组不读。条数、不完整与停用的诊断取自状态栏那一个读取（“待处理”一组、一页一条），所以组都收起时也有条数。
- 选中：第一次打开与 `nbook.canon.show-pending` 之后（`pickFirst`），读到“待处理”一组现在的结果时选中它的第一条，没有就不选；读取层留着的旧结果（`ReadState.stale`，视图停放后回到前台时先到的就是它）不算。焦点移到一行上就选中它。每次读到现在的结果，选中的那一条还在就记下它现在的位置，不在了就选这个位置上的那一条，没有就不选；那一组收起、视图停放、结果还是旧的时不判断。
- 名字与位置：选中那一条的详情要的对象排在最前，再是各行的，一页最多读 50 个对象；超出的行只写种类。插件诊断的显示名取各页带的 `labels` 合起来（“再显示更多”之后读取的数据只是新的一页）；世界一变（状态栏那一个读取换了结果）从头合，停用了的诊断不留旧名字。
- 套不上：内核按根因合并，根因是让它们套不上的那次修订。经 `changes`（安放到第一条套不上的情节为止、从新到旧、一条）读那条情节这次的结局，写原因；根因是修订时另读它的标题，给“看那次改动的回执”。
- `visible` 为假时所有读取都释放，屏幕上留着最后读到的；回到前台时先显示它们，同时重读（输出 26）。
- 强行解除：世界状态里有人独占时列表顶上写是谁；点了开二次确认（`BreakExclusiveDialog`），确认后调 `breakExclusive`。确认时持有者已经变了：没人独占了就关掉，换了一位就把对话框里的名字换成它、要作者再点一次（`breakExclusive` 解除的是现在这一位）。结果回来之前不关、按钮不可用；成功后关掉（列表顶上那一行跟着 `exclusive` 事件消失），失败时原因写在对话框里。
- 详情里的点击：剧情变更、条目、修订（回执）调 `open`，原句的“打开这一章”调 `openChapter`。

## 数据

```ts
type PendingViewHostProps = {
    world: CanonWorld;
    state: PendingViewState;
    open: (target: PendingTarget) => void;
    openChapter: (chapter: string) => void;
    /** 视图可见（`ViewContext.visible`）。 */
    visible: boolean;
};
```

没有事件、插槽与 expose。

## 隐藏通道理由

- `io:read`：读什么取决于展开了哪几组、选中了哪一条与读到了几页，工作台不知道；读取随世界变跟着重读。只在真实界面里验证（`pending-view.dom.test.ts`），Lab 里看 `PendingView`。
- `io:mutate`：强行解除是作者在这个视图里确认的一次写入，宿主之外没有地方知道要不要发。
- `state:shared-write`：展开与选中写进窗口里那一份视图状态。
- `state:local`：二次确认对话框开着没有、是否正在解除、失败的原因。
- `state:inject`：经 `useCanonText()`、`useText()` 取翻译端口。
