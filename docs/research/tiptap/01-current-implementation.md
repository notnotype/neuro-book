# 当前实现盘点

## 依赖现状

当前项目已经引入 Tiptap 3.x 相关依赖：

- `@tiptap/vue-3`
- `@tiptap/starter-kit`
- `@tiptap/markdown`
- `@tiptap/suggestion`
- `@tiptap/extension-placeholder`
- `@tiptap/extension-image`
- `@tiptap/extension-table`

同时项目仍保留 Milkdown 依赖，但 Markdown Studio 的当前主实现已经转向 Tiptap。

## Markdown Studio

相关文件：

- `app/components/markdown-studio/MarkdownStudio.vue`
- `app/components/markdown-studio/TipTapMarkdownEditor.vue`
- `app/components/markdown-studio/MarkdownSourceEditor.vue`
- `app/components/markdown-studio/MarkdownStudioToolbar.vue`
- `app/composables/useMarkdownStudioController.ts`
- `app/composables/useMarkdownStudioSync.ts`

当前模型是“一份 Markdown 真状态 + 两个编辑表面”：

- 富文本侧使用 `TipTapMarkdownEditor`。
- 源码侧使用 `MarkdownSourceEditor`。
- `useMarkdownStudioController` 维护 `markdown`、`viewMode`、active editor、流式打字机状态。
- `useMarkdownStudioSync` 负责在富文本和源码编辑器之间显式同步。

这个模型是合理的。关键点是不能让富文本和源码各自成为真状态，否则 tab 切换、失焦保存、流式写入都会变成竞态。

## TipTapMarkdownEditor

`TipTapMarkdownEditor` 的核心特征：

- 输入输出始终是完整 Markdown。
- 用 `splitMarkdownFrontmatter()` 把 frontmatter 与正文分开。
- frontmatter 使用独立 textarea 编辑。
- 正文交给 Tiptap，并通过 `editor.getMarkdown()` 输出 Markdown。
- 富文本侧是 Notion-like 体验，图片、行内代码、表格、引用等进入真实 ProseMirror node / mark。
- 已经暴露 `undo`、`redo`、`addComment`、`setAlign`、`getValue` 等句柄能力。

Markdown Studio 主编辑器不再支持 Obsidian Live Preview / mixed 模式；源码感编辑统一通过 `source` 模式完成。

## StructuredTextEditor

相关文件：

- `app/components/common/form/StructuredTextEditor.vue`

它是表单场景包装层：

- 底层富文本能力复用 `TipTapMarkdownEditor`。
- 源码模式复用 `MarkdownSourceEditor`。
- 包装层只提供工具栏、紧凑尺寸、计数和 `rich` / `source` 切换。
- 不再维护独立 schema、overlay 或 mixed 模式。

## 自定义节点与语法

当前项目已经有一组自定义 Tiptap/Markdown 能力：

- `WorkspaceReference`：领域 Markdown link 节点，支持 workspace path 与剧情对象 scheme，使用 `@tiptap/suggestion` 实现 `@` 触发菜单，保存为 `[label](target)`。
- `InlineComment`：Markdown 内联评论，序列化为 `<inline-comment body="...">...</inline-comment>`。
- `MarkdownAlign`：块级对齐，序列化为 `<align value="...">...</align>`。
- `MarkdownCode`：行内代码 mark，沿用 Tiptap 官方 Code 解析和序列化。
- `AgentReference`：Agent 输入器引用节点。
- `AgentSkill`：技能节点，在表单包装层启用 quick triggers 时接入。
- `AgentQuickTrigger`：快速触发菜单。
- `AgentHardBreak`：自定义换行行为。

这些实现说明项目已经走在“业务语义自定义节点化”的路线上。后续应减少 `Agent*` 命名对通用编辑器的污染，但不需要把它们替换成官方 Mention。

## 当前不足

- 菜单能力还没有完全标准化，格式工具栏可以隐藏但不应该缺失。
- slash command 还没有成为 Markdown 主编辑器的一等入口。
- 评论只有 inline 标记，没有官方 thread/comment 面板和生命周期。
- 流式输出仍偏 store 拼接文本，缺少 editor command 级别的插入/替换/选区写入。
- code block 语法高亮还没有接入官方推荐的 `CodeBlockLowlight` 路线。
- ref 节点仍有 Agent 输入器侧命名，应逐步抽象为通用 `ReferenceNode`。
