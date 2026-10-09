---
验证入口: EditorArea
标签: [state:local, env:timer]
别名: ["Markdown 编辑器", "Markdown Editor", "富文本编辑器"]
---

# MarkdownControl

Markdown 富文本控件：一个 Tiptap 编辑器实例，按编辑器控件合同（`control.ts`）绑定文档（[`workbench/editor.md`](../../../../../../../docs/specs/workbench/editor.md) 输出 9–13、19）。读写都是 Markdown，项目方言（批注、注音、双语、对齐、文字标记、内嵌 HTML、硬换行）由方言扩展组往返；同组的 Markdown 文件共用这一个实例，换文档只换编辑状态。

## 数据

```ts
type Props = {
    binding: ViewBinding | null;
    readonly: boolean;
    visible: boolean;
    /** 编辑区的可访问名称（文件名）。 */
    label: string;
    /** 空文档的占位文字；可选。 */
    placeholder?: string;
};

type Emits = {
    ready: [handle: EditorControlHandle | null];
    focus: [focused: boolean];
};
```

## 行为

- frontmatter 不进入富文本：按原始偏移切出（BOM、CRLF 原样），保存时原样拼回。
- 每“文档 × 组”一份编辑状态（含撤销历史与选区）连同滚动位置存在绑定的槽里；A→B→A 回来时撤销历史还在。组件重挂（拆分或关闭组让 grid 重建了这一组）后是另一个编辑器实例，编辑状态按新实例的 schema 重建，正文与选区保留，撤销历史丢掉。
- 停止输入 150 ms 后把正文交给文档；失焦、换文档、保存与资源管理器的操作之前立即结算。交出的正文是三方合并的结果（`markdown/source-merge.ts`）：只有编辑过的行换成编辑器的写法，其余保持原文字节；没编辑过时就是原文。
- 正文被别处改了时按文档的正文重建编辑状态（新的撤销历史，外部内容不进用户的撤销栈）；回执为 `conflict` 时保留自己的内容，裁决后重建。
- 链接点击不打开（编辑器里点链接是要编辑它）。
- 句柄：聚焦、撤销、重做、结算；不提供行号导航（富文本没有行号）。

`state:local`：编辑器实例与当前绑定。`env:timer`：输入后的结算延迟，卸载与结算时清除。

## 不支持

批注侧栏、选区浮动菜单、斜杠命令、Agent 与 AI 引用、工作区引用标签与 frontmatter 面板（frontmatter 用源码编辑器改）。
