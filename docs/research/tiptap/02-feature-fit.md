# 功能适配评估

## 流式输出

官方方案：

- AI Generation 提供 `streamContent` 命令，但属于 Start plan / 私有 registry。
- AI Toolkit 提供 `streamTool`，可以把 AI tool call 增量写入文档，但属于 AI Toolkit add-on。

当前实现：

- `useMarkdownStudioController` 已经有 `useTypewriterStream`，能把流式文本追加到 Markdown 真状态。
- 这条路径更像“字符串打字机”，不是 editor command。

建议：

- 保留自有 SSE / Agent runtime。
- 在 Tiptap 编辑器句柄里增加 append、replace selection、insert at cursor 等 command。
- 流式输出写入当前编辑器 selection 或指定 range，而不是只做 `markdown += chunk`。

风险：

- Tiptap command 写入和 Markdown 源码同步必须共用同一真状态。
- 流式期间要锁定或明确处理用户同时编辑。

## Slash Command

官方方案：

- 官方 slash commands 示例是实验性质，未发布正式 package。
- 官方说明该实验本质上也是基于 `@tiptap/suggestion`。
- Tiptap UI Components 有 React 版 Slash Dropdown Menu，但不是当前 Vue 项目的直接可用组件。

当前实现：

- 项目已经有 `@tiptap/suggestion` 和 `AgentReference` 菜单框架。
- Agent 输入器也已经有 trigger menu、reference selector 等可复用思路。

建议：

- 不依赖官方实验 slash package。
- 用 `@tiptap/suggestion` 自建 `/` trigger。
- 菜单项优先包括：标题、列表、引用、评论、AI 续写、插入 lorebook/ref、代码块。

风险：

- slash command 与 `@` ref trigger 共存时，需要独立 `PluginKey` 和清晰的键盘导航状态。

## 菜单与格式工具栏

官方方案：

- BubbleMenu 适合选区上的格式化菜单。
- FloatingMenu 适合空行、块级插入菜单。
- Vue 3 包提供对应菜单组件，使用时不需要自己管理 DOM element。

当前实现：

- Markdown Studio toolbar 已经有模式切换和 tab 栏。
- 富文本内部缺少稳定的 Bubble/Floating 格式菜单。

建议：

- 引入官方 Vue BubbleMenu / FloatingMenu 组件。
- 格式菜单默认可以隐藏或轻量化，但保留能力入口。
- 菜单动作直接调用 editor chain，例如 bold、italic、heading、list、blockquote、codeBlock、comment。

风险：

- 菜单浮层要考虑编辑区滚动容器、SSR ClientOnly、暗色/sepia 主题。

## 评论

官方方案：

- 官方 Comments 支持 inline/document/sidebar comments、resolve、delete、REST API、webhook、mention users。
- 但需要 Start plan、Document server 和私有 registry。

当前实现：

- 项目使用 `<inline-comment body="...">...</inline-comment>` 自定义 Markdown 语法。
- `TipTapMarkdownEditor.addComment()` 可以插入评论标记。

建议：

- 继续用自定义 Markdown inline comment，避免绑定 Cloud。
- 第一版支持新增、编辑 body、删除标签并保留正文。
- 后续如需要多人协作或 thread/replies，再评估是否扩展自有模型或接入官方 Comments。

风险：

- 当前 comment body 放在 HTML attribute 中，适合短文本评论，不适合承载长富文本讨论。
- 嵌套、重叠、多段选区评论需要专门设计，不宜靠简单 inline tag 硬撑。

## Ref / Mention

官方方案：

- Mention 支持自定义 HTML/text rendering、多 trigger、`@tiptap/suggestion`、删除 trigger 行为。
- Suggestion utility 支持 async items、custom `findSuggestionMatch`、`exitSuggestion`、`shouldShow`、`allowSpaces`。

当前实现：

- `AgentReference` 已经是 atom inline node。
- 支持多种引用 kind，例如 chapter、volume、lorebook、thread、scene、plot、pending。
- 使用项目自己的 Markdown 链接语法，例如 `[label](kind://target)`。

建议：

- 不直接替换成 `@tiptap/extension-mention`。
- 吸收 Mention 的接口设计，把 `AgentReference` 抽象为更通用的 `ReferenceNode`。
- 保留 Markdown 链接序列化，继续兼容文件存储。

风险：

- 当前 `chapter/volume` 等旧 kind 会和新 workspace 文件系统语义冲突，需要后续统一到 file/ref URI。

## Syntax Highlighting

官方方案：

- 官方推荐 `CodeBlockLowlight`。

当前实现：

- Markdown 编辑器当前没有明显的 code block highlighting 主线。

建议：

- 优先引入 `@tiptap/extension-code-block-lowlight` 与 lowlight。
- 对 Markdown source 模式继续由 Monaco/源码主题负责。

风险：

- 需要处理 Markdown round-trip：语言标记、fence code、lowlight 注册语言。

## Forced Content Structure

官方方案：

- 通过自定义 `Document` schema 强制内容结构。
- 官方提醒 Trailing Node 与自定义 schema 组合时要显式配置 trailing node。

当前实现：

- 项目内容结构主要由文件系统、frontmatter、校验脚本表达。
- manuscript/lorebook 内容节点不是单个 Tiptap document 内部结构。

建议：

- 不在普通 Markdown 编辑器里强制 schema。
- 未来只在特定表单或内容模板中使用轻量 schema 限制。
- 内容节点规则继续由 workspace validate 负责。

风险：

- 强制 schema 会影响 Markdown 通用性，容易让用户普通 Markdown 文件无法正常编辑。

## Notion-like Editor

官方方案：

- Notion-like template 是完整模板，包含协作、AI、图片上传、Pro/Cloud 配置。

当前实现：

- 项目正在构建通用文件系统 IDE，不是单文档 Notion clone。

建议：

- 只参考交互：slash command、block menu、drag handle、AI menu。
- 不引入整个模板。

风险：

- 直接搬模板会和 Nuxt/Vue 技术栈、文件系统 IDE 架构、Markdown 存储目标冲突。
