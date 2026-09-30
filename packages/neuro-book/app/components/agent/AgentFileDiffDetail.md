---
标签: []
别名: ["改动详情", "File Diff Detail"]
---

# Agent 改动详情

改文件工具展开后的 diff，标题是文件路径：

- `edit`：每个替换片段先列删除的旧文本、再列新增的新文本，片段之间一行淡色省略号。视图拿不到文件原文，所以显示的是替换片段本身，不是精确的逐行 diff。
- `write`：整文件内容全部标为新增。
- `apply_patch`：按补丁行首的 `+`、`-` 着色，文件头与 `@@` 行淡色；标题是补丁涉及的文件。

由 `AgentToolDetail` 按注册表挂载，接收 `ToolDetailProps`。

## 数据

```ts
type AgentFileDiffDetailProps = {
    /** edit、write 或 apply_patch 调用，必填；只读 args。 */
    call: ToolCallView;
    /** 对话视图的 ctx，必填；本组件不使用。 */
    ctx: AgentConversationContext;
};
```

没有 emits、插槽和 expose。未声明的 attribute、`class` 与 `style` 落到根节点。
