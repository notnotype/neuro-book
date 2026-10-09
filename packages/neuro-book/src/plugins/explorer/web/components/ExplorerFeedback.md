---
标签: []
别名: ["资源管理器的结果区", "Explorer Feedback"]
---

# ExplorerFeedback

资源管理器底部的结果区（[`workbench/files-explorer.md`](../../../../../../../docs/specs/workbench/files-explorer.md) 的“新应用的插件、命令与界面”）：打开失败、编辑器尚未接入这类提示原位显示，用户关掉或下一条提示替换它。全部成功不打扰：没有提示时不渲染。文件操作的逐项结果随后续切片加入。

## 布局

视图底部，限高（不超过视图高度的 40%）并自己滚动，树始终保有空间；长路径折行。`390×844` 下按钮保持可见。

## 数据

```ts
type Props = {
    locale: DisplayLocale;
    /** 当前提示；`null` 时不渲染。 */
    notice: Notice | null;
};

type Emits = {
    (event: "dismiss"): void;
};
```

- 提示带 `role="status"`，出现与变化时由读屏播报。
- 没有 slots、expose；attrs 落在根元素上。
