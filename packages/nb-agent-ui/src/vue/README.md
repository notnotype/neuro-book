# 渲染层目录

`AgentConversationView` 及其零件。行为合同见 [ui.agent-conversation-view](../../../../docs/specs/ui/agent-conversation-view.md)，各组件的需求书是同名 `.md`。类型、注册表与纯逻辑在上一层的核心（`src/`），这里只放组件与组装它们的登记。

子目录按界面区域划分，新组件放进它所属的区域；某个区域第一次有组件时再建目录，不预建空目录。

| 位置 | 内容 |
|---|---|
| 根目录 | 顶层 `AgentConversationView`；宿主入口 `index.ts` 与只给 Component Lab 的入口 `lab.ts`（内部零件、`provideAgentView`、轮次样例）、`lab-sources.ts`；注入渲染组件与翻译端口的 `host.ts`、组件取文字的 `text.ts`；视图内部的 action（宿主的 action 加原图预览）与标签点击的去向 `view-action.ts`；一组可展开项的展开状态 `use-open-set.ts`；登记内置角色、消息操作和输入框触发字符与命令的 `builtin-*.ts`，以及给核心的内置工具登记挂上详情与节点组件的 `builtin-tools.ts` |
| `parts/` | 各区域共用的零件：回复正文 `AgentMarkdown`、带本包文字的代码块 `AgentCodeBlock`、渲染出错的兜底。卡片、步骤行与原图预览对话框在 nb-ui（`CollapsibleCard`、`CollapsibleRow`、`ImagePreviewDialog`） |
| `stream/` | 消息流：轮次、轮次块与其中的思维链块、工具与文字两种步骤行、用户消息、投递提示、消息操作、轮末改动文件、原始视图 |
| `tools/` | 工具详情：通用详情（没有专用组件时画登记项给的 diff）、命令、文件内容、任务清单 |
| `composer/` | 输入框：工具栏、模型与思考档位的下拉、排队消息、注入编辑器的句柄 `use-editor-handle.ts` |
| `fallback/` | 宿主没有注入渲染组件时的缺省实现：纯文字 Markdown、纯文字消息、普通文本框 |

后续切片按区域加目录，例如顶栏和状态栏、待处理区、面板与弹窗各成一组。

## 依赖方向

- `parts/`、`fallback/` 不引用其它子目录，保证任何区域都能用它而不形成环。
- `tools/` 可以用 `parts/`，不引用 `stream/`；工具详情要能脱离消息流单独挂载和登记。
- `stream/` 可以用 `parts/` 与 `tools/`。
- `composer/` 可以用 `parts/`，不引用 `stream/`、`tools/`；编辑器由宿主注入，经 `host.ts` 取。
- 子目录都可以引用根目录的 `host.ts`、`view-action.ts` 与核心；只有根目录的组件和 `builtin-*.ts` 负责把子目录组装起来。
