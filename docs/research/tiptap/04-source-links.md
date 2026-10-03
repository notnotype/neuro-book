# 资料与源码索引

## 官方文档

| 主题 | 链接 | 判断 |
| --- | --- | --- |
| Comments overview | https://tiptap.dev/docs/comments/getting-started/overview | Start plan / 私有 registry，作为评论交互参考 |
| AI Generation overview | https://tiptap.dev/docs/content-ai/capabilities/generation/overview | Start plan，作为 AI 交互参考 |
| Menus example | https://tiptap.dev/docs/examples/advanced/menus | 免费示例，适合参考 Bubble/Floating menu |
| Mentions example | https://tiptap.dev/docs/examples/advanced/mentions | 免费示例，适合参考 ref/mention |
| Syntax highlighting | https://tiptap.dev/docs/examples/advanced/syntax-highlighting | 免费示例，推荐 CodeBlockLowlight |
| Forced content structure | https://tiptap.dev/docs/examples/advanced/forced-content-structure | 免费示例，只适合特定模板 |
| Slash commands | https://tiptap.dev/docs/examples/experiments/slash-commands | 实验示例，不建议依赖 |
| Awesome Tiptap | https://github.com/ueberdosis/awesome-tiptap | 社区资源索引，只用于调研 |
| Notion-like template | https://github.com/ueberdosis/tiptap-docs/blob/main/src/content/ui-components/templates/notion-like-editor.mdx | Start plan / 模板参考，不直接迁入 |

## 本地 Tiptap 源码

| 路径 | 用途 |
| --- | --- |
| `.agent/workspace/tiptap/packages/markdown` | Markdown 扩展源码 |
| `.agent/workspace/tiptap/packages/suggestion` | Suggestion utility 源码 |
| `.agent/workspace/tiptap/packages/extension-mention` | Mention 节点源码 |
| `.agent/workspace/tiptap/packages/extension-bubble-menu` | BubbleMenu 扩展源码 |
| `.agent/workspace/tiptap/packages/extension-floating-menu` | FloatingMenu 扩展源码 |
| `.agent/workspace/tiptap/packages/extension-code-block-lowlight` | 代码块高亮扩展源码 |
| `.agent/workspace/tiptap/packages/extension-document` | 自定义 Document schema 参考 |

## 本地 Tiptap 文档源码

| 路径 | 用途 |
| --- | --- |
| `.agent/workspace/tiptap-docs/src/content/comments/getting-started/overview.mdx` | Comments 能力和限制 |
| `.agent/workspace/tiptap-docs/src/content/comments/integrate/editor-commands.mdx` | 评论命令模型 |
| `.agent/workspace/tiptap-docs/src/content/content-ai/capabilities/generation/overview.mdx` | AI Generation 总览 |
| `.agent/workspace/tiptap-docs/src/content/content-ai/capabilities/generation/text-generation/stream.mdx` | `streamContent` 思路 |
| `.agent/workspace/tiptap-docs/src/content/content-ai/capabilities/ai-toolkit/overview.mdx` | AI Toolkit 总览 |
| `.agent/workspace/tiptap-docs/src/content/content-ai/capabilities/ai-toolkit/agents/streaming.mdx` | `streamTool` 思路 |
| `.agent/workspace/tiptap-docs/src/content/editor/extensions/functionality/bubble-menu.mdx` | BubbleMenu Vue 组件用法 |
| `.agent/workspace/tiptap-docs/src/content/editor/extensions/functionality/floatingmenu.mdx` | FloatingMenu Vue 组件用法 |
| `.agent/workspace/tiptap-docs/src/content/editor/extensions/nodes/mention.mdx` | Mention 配置 |
| `.agent/workspace/tiptap-docs/src/content/editor/api/utilities/suggestion.mdx` | Suggestion 配置 |
| `.agent/workspace/tiptap-docs/src/content/examples/experiments/slash-commands.mdx` | Slash command 实验说明 |
| `.agent/workspace/tiptap-docs/src/content/ui-components/components/slash-dropdown-menu.mdx` | React UI slash menu 参考 |
| `.agent/workspace/tiptap-docs/src/content/ui-components/templates/notion-like-editor.mdx` | Notion-like 模板参考 |

## 当前项目相关文件

| 路径 | 用途 |
| --- | --- |
| `package.json` | Tiptap 相关依赖版本 |
| `app/components/markdown-studio/MarkdownStudio.vue` | Markdown 工作区主体 |
| `app/components/markdown-studio/TipTapMarkdownEditor.vue` | Tiptap Markdown 主编辑器 |
| `app/components/markdown-studio/MarkdownSourceEditor.vue` | Markdown 源码编辑器 |
| `app/components/markdown-studio/MarkdownStudioToolbar.vue` | 标签栏和模式切换 |
| `app/composables/useMarkdownStudioController.ts` | 编辑器状态和流式控制器 |
| `app/composables/useMarkdownStudioSync.ts` | 富文本/源码同步 |
| `app/components/common/form/StructuredTextEditor.vue` | 表单编辑器包装层，复用 TipTap/Monaco 主编辑器能力 |
| `app/components/markdown-studio/tiptap/markdown-editor-extensions.ts` | 扩展组合入口 |
| `app/components/novel-ide/agent/tiptap/AgentReferenceNode.ts` | 当前 ref 节点 |
| `app/components/novel-ide/agent/tiptap/agent-suggestion.ts` | 当前 suggestion 菜单 glue code |
| `shared/markdown-workbench.ts` | comment/align Markdown 语法解析 |
