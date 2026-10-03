# Tiptap 调研总览

## 结论

当前项目适合继续把 Tiptap 作为 Markdown Studio 的富文本编辑内核，但不应该把核心写作流程绑定到 Tiptap Pro、Tiptap Cloud 或私有 registry。项目的真实存储仍应是本地文件系统里的 Markdown 字符串，frontmatter 继续由项目层解析和写回，Tiptap 负责正文编辑、选择区交互、菜单、引用节点、评论标记和后续流式写入。

这个方向符合当前架构：`workspace-files` 管真实文件，`MarkdownStudio` 管编辑体验，Agent 通过文件工具和编辑器能力协作。Tiptap 的价值在于让正文编辑更像 IDE/Notion，而不是替代文件系统或业务数据模型。

## 能力边界

| 类别 | 能力 | 建议 |
| --- | --- | --- |
| 免费 OSS 核心 | `@tiptap/vue-3`、`@tiptap/starter-kit`、`@tiptap/markdown`、`@tiptap/suggestion` | 继续作为主线使用 |
| 免费 OSS 扩展 | BubbleMenu、FloatingMenu、Mention、CodeBlockLowlight、Document schema | 按需引入，优先吸收设计 |
| Pro / Cloud | Comments、AI Generation、AI Toolkit、Server AI Toolkit、Notion-like template | 只作为交互和架构参考 |
| 实验示例 | Slash Commands 示例 | 不依赖包，自建 slash command |
| 社区生态 | awesome-tiptap 中的扩展与示例 | 仅用于调研，不默认引入 |

## 当前项目定位

- Markdown 文件继续以 Markdown 字符串作为真实格式，不切换为 Tiptap JSON。
- Tiptap 编辑器只负责正文 body，frontmatter 仍保持在 Markdown 文件头部，由项目层拆分、编辑、保存。
- 引用系统继续使用项目自己的 `Reference` 语义，不降级为普通用户 mention。
- 评论使用自托管 `<inline-comment body="...">text</inline-comment>` Markdown 语法，不接入 Tiptap Cloud Comments。
- AI 流式输出优先接入现有 SSE / Agent runtime，不依赖 Tiptap Content AI。
- 工具栏可以默认隐藏或折叠，但格式化能力、菜单能力、命令入口不能删除。

## 官方资料判断

官方 Comments 文档说明 Comments 能创建 thread/comment，并支持 REST API 与 webhook，但需要 Start plan、Document server 和私有 registry。官方 AI Generation 也属于 Start plan，默认走 Tiptap 的云服务或其自定义 LLM 集成方式。这些能力很完整，但会把核心能力引向云服务和付费扩展，不适合作为当前项目的基础依赖。

相反，Suggestion、Mention、BubbleMenu、FloatingMenu、CodeBlockLowlight、Markdown、Document schema 这些 OSS 能力更适合当前项目。它们可以直接增强现有编辑器，而不改变存储和后端架构。

## 推荐原则

1. 核心写作体验自托管。
2. Markdown 是主存储，Tiptap JSON 只作为运行时内部状态。
3. Pro/Cloud 能力只记录为可选方案，不进入默认路线。
4. 自定义业务语义保留在项目层，例如 ref、lorebook、manuscript、frontmatter。
5. 能用官方 Vue 组件解决定位/菜单问题时，优先用官方组件，不手写脆弱的浮层定位。

## 源码（git 仓库）

- .agent/workspace/tiptap
- .agent/workspace/tiptap-demo
- .agent/workspace/tiptap-docs
