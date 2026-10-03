# 推荐路线图

## 阶段 1：收敛编辑器模式

目标：

- 固定 Markdown Studio 两种模式语义：`rich`、`source`。
- `rich` 是 Notion-like 富文本编辑表面，图片、行内代码、表格、引用等进入真实 ProseMirror node / mark。
- `source` 是 Monaco Markdown 源码编辑表面。
- 工具栏默认可以轻量，但保留格式能力入口。

建议改动：

- 统一 `MarkdownStudioViewMode` 命名，避免 preview/rich/edit 混用。
- 删除 Markdown Studio 主编辑器里的 `mixed` / Obsidian Live Preview 路线。
- 保持 frontmatter 在编辑器顶部独立展示，不进入 ProseMirror schema。

验收：

- 同一 Markdown 在 rich/source 间切换不会丢内容。
- frontmatter 修改、正文修改、tab dirty、失焦保存语义一致。
- 图片、inline code、workspace reference 和表格在富文本模式中可正常显示，并能序列化回 Markdown。

## 阶段 2：菜单和 slash command

目标：

- 接入 BubbleMenu / FloatingMenu 的 Vue 组件路线。
- 自建 slash command，作为块级插入和 AI 操作入口。

建议改动：

- 用 `@tiptap/vue-3/menus` 的 BubbleMenu/FloatingMenu 承载格式工具。
- 用 `@tiptap/suggestion` 实现 `/` trigger，独立 `PluginKey`。
- 复用现有 `AgentTriggerMenuState` 的分组、键盘导航和 item 数据结构。

验收：

- 选中文本可弹出格式菜单。
- 空行或输入 `/` 可弹出命令菜单。
- 菜单可隐藏，但命令入口仍能通过快捷键或更多菜单打开。

## 阶段 3：评论系统

目标：

- 从当前 `<inline-comment>` 语法演进为可操作的评论侧栏。
- 不依赖 Tiptap Cloud Comments。

建议改动：

- 保留当前 Markdown 序列化：`<inline-comment body="...">...</inline-comment>`。
- 增加评论列表：选中、定位、编辑 body、删除。
- thread/replies 不作为第一版要求；如要多人协作再扩展。

验收：

- 可以在选区添加评论。
- 可以从侧栏看到当前文件评论。
- 编辑评论后 Markdown 保存内容一致。

## 阶段 4：流式 AI 写入 editor command 化

目标：

- 流式输出不再只是拼接 store 字符串。
- Agent 可以面向当前 selection/range 写入。

建议改动：

- 在 `MarkdownStudioEditorHandle` 中增加插入和替换类方法。
- 支持 append to document、insert at cursor、replace selection。
- 流式期间明确锁编辑器或做冲突提示。

验收：

- AI 输出可以流式插入当前光标。
- AI 可以替换选区。
- 流式写入结束后 dirty/save 状态正常。

## 阶段 5：编辑能力补全

目标：

- 补足代码块、图片/附件、表格、内容结构校验等长期能力。

建议改动：

- 引入 `CodeBlockLowlight` 支持代码块高亮。
- 图片和附件节点优先映射到工作区真实文件路径。
- 继续使用 `TableKit` 支持 Markdown table round-trip。
- forced content structure 仅用于专用模板，不作用于所有 Markdown。
- workspace validate 继续负责 manuscript/lorebook 内容节点规则。

验收：

- fenced code block 保留语言并高亮。
- 图片节点保存后仍是可追踪的 Markdown/file reference。
- Markdown table 在富文本模式中显示为表格，并能保存回 Markdown。
- 普通 Markdown 文件不受业务 schema 限制。
