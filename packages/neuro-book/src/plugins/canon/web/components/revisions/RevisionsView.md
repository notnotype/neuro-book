---
标签: [state:local, state:inject]
别名: ["改动记录", "Change History"]
---

# RevisionsView

底部面板里“改动记录”视图的骨架（[`canon/author-ui.md`](../../../../../../../../docs/specs/canon/author-ui.md) 输出 24、27、28）：按版本从新到旧列出修订，每条写标题、谁、什么时候、带来的变化的一句摘要，有“看回执”与“还原”；顶上两个筛选（按章、按写入者）。受控：行由宿主折好（`revisions.ts` 的 `RevisionRow`，宿主是 `RevisionsViewHost`），筛选的值与当前行由宿主持有，点了什么发出什么。它不读世界，也不自己还原。

## 布局

- 从上到下：世界横幅（`WorldBanners`，断开与只读）；筛选条（两个 `sm` 的 nb-ui `Select`，各 12rem，放不下时换行）；世界写不了而横幅没写的原因（例如“第 3 章记账正在写，写完以后才能改”），一行次级色；剩下的高度是列表，自己纵向滚动（视图声明 `layout: "fill"`），滚动条是叠在内容上的 nb-ui `OverlayScrollbar`。左右内边距取视图外框给的 `--view-inset-inline`。
- 一行两块：左边标题（中等字重，放不下时截断、悬停看全文）与一行次级色的“谁 · 什么时候 · 摘要”；右边是按钮旁的一句原因（“后面有 N 次改动依赖它”“调整章序的改动不能还原”，次级色）、“看回执”“还原”。行至少 40px 高，行间一条分隔线。
- 列表末尾“再显示更多”（`more` 为真时）。
- 视图宽度窄于 480 像素时（容器查询，量的是视图自己的宽度，不是窗口）：一行里上下排，按钮与原因换到文字下面、靠左；没有横向滚动。

## 交互

- “看回执”发 `receipt`，参数是修订 id；“还原”发 `revert`，参数是修订 id 与标题。章序调整的行，以及 `revertBlocked` 不为空时，“还原”不可用。
- 筛选的选择发 `update:chapter`、`update:writer`，值是选项的 `value`（“全部”是 `revisions.ts` 的 `ALL`）。
- 键盘（`roving.ts`）：上下键、Home、End 在行之间移焦点，只有当前行（`current`，不在列表里时是第一行）和它的按钮在 Tab 序列里；行或行里的按钮得到焦点时发 `update:current`。行的焦点线画在行里面。
- 按钮用 `aria-describedby` 指向这一行的标题，几行同名的“还原”读屏分得出是哪一条。

## 数据

```ts
type RevisionsViewStatus = "loading" | "failed" | "normal";

type RevisionsViewProps = {
    status: RevisionsViewStatus;
    /** 从新到旧。必填、受控。 */
    rows: readonly RevisionRow[];
    /** 后面还有；默认 false。 */
    more?: boolean;
    /** 按章筛的选项（含“全部章”）、按写入者筛的选项（含“全部写入者”）。必填。 */
    chapters: readonly FilterOption[];
    writers: readonly FilterOption[];
    /** 两个筛选的当前值。必填、受控。 */
    chapter: string;
    writer: string;
    /** 当前行（Tab 序列里的那一行）的修订 id；默认 null。受控。 */
    current?: string | null;
    /** 还原都不可用的原因（世界断开、只读、别人在独占写）；默认空。断开与只读已有横幅，只在都没有时把它写在列表顶上。 */
    revertBlocked?: string;
    disconnected?: boolean;
    /** 世界只读的原因；默认空。 */
    readOnly?: string;
};

type RevisionsViewEmits = {
    (event: "receipt", id: string): void;
    (event: "revert", id: string, title: string): void;
    (event: "more"): void;
    (event: "update:chapter", value: string): void;
    (event: "update:writer", value: string): void;
    (event: "update:current", id: string): void;
    (event: "retry"): void;
};
```

没有插槽、没有 expose；attrs 落在根上。

## 状态

- 加载中：列表的位置只有“读取中…”（`aria-busy`），筛选照常。换筛选时宿主接着给旧的行，直到新的读到，不闪成加载。
- 出错：“没有读出来”（`role="alert"`）。
- 空：没有筛选时“还没有改动”；有筛选时“没有符合筛选的改动”。
- 世界写不了：所有“还原”不可用；“看回执”照常。

## 不支持

- 按条目筛（`revisions` 有这个筛选，视图里没有入口）；条目页另有改动的来历。
- 多选、批量还原。
- 记住滚动位置以外的阅读位置：再显示更多与世界变了以后的重读都按修订 id 原地替换，滚动位置由浏览器保持。

## 隐藏通道理由

`state:inject`：经 `useCanonText()` 取宿主注入的翻译端口（命名空间 `nbook.canon`）。`state:local` 是列表与滚动元素的模板引用（焦点移动与叠加滚动条用）。
