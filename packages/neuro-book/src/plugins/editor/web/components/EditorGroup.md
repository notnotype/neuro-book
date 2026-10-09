---
验证入口: EditorArea
标签: []
别名: ["编辑组", "Editor Group"]
---

# EditorGroup

一个编辑组（[`workbench/editor.md`](../../../../../../../docs/specs/workbench/editor.md) 输出 1–20）：标签条、加载进度条、状态条与控件。它是宿主：按组 id 读编辑器区控制器的组、文档与绑定，把用户动作交回控制器。

## 数据

```ts
type Props = {
    area: EditorArea;
    groupId: string;
    locale: DisplayLocale;
    control: (kind: "markdown" | "code") => Component;
};
```

无 emits、slots、expose；attrs 落在根 `section`（`data-editor-group`，活动组另有 `data-editor-group-active`）。

## 布局与状态

纵向：标签条（`EditorTabBar`）、2px 的进度条位（活动文档 800 ms 后仍在读取时出现一条往复的细条，减少动效时为静止的整条）、状态条、内容区。内容区：

- 没有标签：一行提示“在资源管理器里打开一个文件”。
- 打开失败：原因与“重试”（`role="alert"`）。
- 其余：每种出现过的编辑器各挂一个控件，换文档只换绑定、不重建控件；当前不用的那种控件停放（`v-show`，不卸载）。文档还在读取时两种控件都停放，内容区空白，不显示旧文件的正文。

状态条（`role="status"`）按优先级只显示一条：本视图的未裁决输入（采用当前正文 / 保留本视图的内容）、磁盘冲突（重新载入磁盘版本 / 覆盖磁盘版本）、订阅结束、已删除、磁盘已变化（重新载入）、保存失败或结果未知。

焦点进入或按下组时这组成为活动组。

## 不支持

- 不显示面包屑、编辑器工具栏与差异比较。
