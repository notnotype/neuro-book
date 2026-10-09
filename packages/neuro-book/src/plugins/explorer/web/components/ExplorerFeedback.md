---
标签: []
别名: ["资源管理器的结果区", "Explorer Feedback"]
---

# ExplorerFeedback

资源管理器底部的结果区（[`workbench/files-explorer.md`](../../../../../../../docs/specs/workbench/files-explorer.md) 的“新应用的插件、命令与界面”）：三块内容各自出现——正在进行的批量（动作、项数与“取消”）、一条提示（打开失败、编辑器尚未接入、单项操作没做成、清单没改成），以及最近一次批量的逐项结果（完成、失败及原因、跳过、未执行、取消，目录删除停下时已删除与残留的范围，清单没改成的说明，结果被省略时的提示）。全部成功不打扰：批量全部完成时没有逐项结果，三块都没有时不渲染。

## 布局

视图底部，限高（不超过视图高度的 40%）并自己滚动，树始终保有空间；长路径折行。`390×844` 下按钮保持可见。

## 数据

```ts
type Props = {
    locale: DisplayLocale;
    /** 当前提示；没有时为 null。 */
    notice: Notice | null;
    /** 最近一次批量的逐项结果；全部成功时为 null。默认 null。 */
    report?: OperationReport | null;
    /** 正在进行的批量；默认 null。 */
    running?: {readonly action: "delete"; readonly count: number} | null;
};

type Emits = {
    /** 关掉提示。 */
    (event: "dismiss"): void;
    /** 关掉逐项结果。 */
    (event: "dismiss-report"): void;
    /** 取消正在进行的批量：已完成的项不回滚，正在执行的项做完。 */
    (event: "cancel"): void;
};
```

- 提示、逐项结果的标题与进行中都带 `role="status"`，出现与变化时由读屏播报；逐项列表本身不是 live region。
- 没有 slots、expose；attrs 落在根元素上。
