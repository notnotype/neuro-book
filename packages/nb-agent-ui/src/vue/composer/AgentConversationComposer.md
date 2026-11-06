---
标签: [state:local, env:portal, state:inject]
别名: ["输入框", "对话输入框", "Composer"]
---

# AgentConversationComposer

对话视图底部的输入框：编辑器加一行工具栏。编辑器由宿主注入（形状见核心的 `ports.ts`，neuro-book 注入 `nbook.markdown` 的 `PromptEditor`，合同见 [`ui/prompt-editor.md`](../../../../../docs/specs/ui/prompt-editor.md)），引用、技能、命令、附件、粘贴块都按“文字写法”写进文字；没有注入时是包内的普通文本框 `PlainPromptEditor`，这时不显示“添加附件”、没有 `/` 命令菜单。本组件负责把编辑器的按键与事件翻译成对话视图的 action（发送、steer、followup、停止、命令、附件），并放上模式、模型与思考档位等运行设置。它不持有任何会话数据，草稿、附件状态、排队消息全部来自 `ctx`，用户意图全部以 `action` 交给宿主。

行为合同见 [ui.agent-conversation-view](../../../../../docs/specs/ui/agent-conversation-view.md) 的“输入框与待处理区”。

## 布局

自上而下：排队中的消息、拒收提示、输入框外框。

- **排队中的消息**：`ctx.composer.queued` 不为空时由 [`AgentQueuedMessages`](AgentQueuedMessages.md) 显示在外框上方。以后收进待处理区（S7）。
- **拒收提示**：添加的附件被拒收时，外框上方一行淡色说明，右端可关闭；发送或宿主换了草稿时也会消失。
- **外框**：圆角、描边、输入底色，焦点在框内时描边换成焦点色；只读时用只读底色。框里是编辑器（不带自己的外框，附件条在正文上方）和工具栏。
- **工具栏**：左侧依次为前置的登记按钮（`placement: "leading"`）、“添加附件”、模式按钮（图标加名称；当前不是第一种模式时用强调色）、模型与思考档位（有模型角色时是带面板的 [`AgentRoleModelPicker`](AgentRoleModelPicker.md)，没有时是下拉 [`AgentModelPicker`](AgentModelPicker.md)，没有可选的模型与思考档位时不显示）、其余登记的工具栏按钮；右侧为展开/收起与发送/停止。左侧放不下时，模式按钮只留图标，模型名截断。
- **单行版式**（`layout: "inline"`）：外框里只有一行，依次是前置的登记按钮、编辑器、控件（模式、模型与思考档位、上下文大小 [`AgentContextMeter`](AgentContextMeter.md)、其余登记按钮、展开、发送）。正文长高时只有编辑器长高，控件留在右下。输入框宽度小于 520px 时控件整排折到正文下面、靠右，前置按钮留在正文前。展开后编辑器撑满外框，控件仍在右下。上下文大小只在这个版式里画，`ctx.usage.contextLimit` 为空或 `contextTokens` 为 0 时不画。允许登记附件时（单行没有附件条的位置）退回两层版式。
- **高度**：平时编辑器随内容长高，最多约 200px，超出后内部滚动。展开后输入框占父元素高度的 55%（最多 560px），编辑器撑满外框，消息流让出高度。
- **`390×844`**：结构不变，模式按钮只留图标；单行版式的控件折到正文下面。

## 交互

发送与按键（编辑器聚焦时）：

| 操作 | 空闲 | 运行中 |
|---|---|---|
| 回车（展开时换行） | `composer.submit`，`delivery: "prompt"` | 允许补充说明时 `delivery: "steer"`，否则允许排队时 `"followup"`，否则不发 |
| Ctrl/⌘+回车 | `delivery: "prompt"` | 允许排队时 `delivery: "followup"`；否则展开时按回车的规则发（展开时回车是换行），不展开时不发 |
| 发送按钮 | 同回车 | 正文为空且允许停止时是停止按钮，发出 `composer.stop`；否则同运行中的回车 |
| Shift+Tab | 切到下一种模式，发出 `mode.set` | 同左 |

- 正文去掉首尾空白后为空时不发送。有附件还在上传或上传失败时也不发送，发送按钮不可用并在悬停提示里说明：没上传完的附件还不在文字里，这时发出去附件就丢了。正文以 `/名称` 开头、名称是登记的输入框命令时，发出 `command.run {name, argsText}`（`argsText` 是名称之后的文字，去掉首尾空白），不发 `composer.submit`。
- 发送后不自行清空：宿主受理后给出新版本的空草稿，失败时文字不会丢。每次编辑发出 `composer.draftChanged`。
- 触发字符取自登记的输入框触发字符。`/` 位于正文开头时，菜单列出登记的命令（名称、说明与参数提示），按名称过滤；其余情况的菜单来自 `services.resolveTriggerMenu`；宿主没有提供它时只把 `/` 交给编辑器，别的触发字符不打开菜单；正文中间打 `/` 时菜单只说明命令要写在开头。菜单每次从关到开发出 `menu.opened`。
- 附件：编辑器的 `attachment-add`、`attachment-retry`、`attachment-remove` 依次发出 `composer.attachmentAdded`、`composer.attachmentRetry`、`composer.attachmentRemoved`。“添加附件”打开文件选择，选中的文件插在光标处，与粘贴相同。允许登记附件时接受文件；当前模型支持图片时才接受图片。被拒收时显示提示：模型不支持图片、会话不能登记附件，分别说明。
- 点击正文里的标签或附件卡片：引用与选区发出 `reference.open`，技能发出 `skill.open`，文件发出 `attachment.open`，图片发出 `image.preview` 的 action，由对话视图打开原图预览；规则与已发送消息相同。
- 模式按钮点击与 Shift+Tab 相同；模型与思考档位在下拉里选，发出 `model.set`、`thinking.set`。不允许修改运行设置时三者都禁用。`interaction.canManageModels` 为真时下拉末尾有“管理模型…”，发出 `model.manage`。不允许登记附件时下拉不标“不支持图片”。
- 登记的工具栏按钮点击后发出各自的 action；带 `trigger` 的按钮（例如 nb-story 的 `+`）不发 action，而是让编辑器聚焦到末尾、插入这个触发字符并打开它的菜单（编辑器的 `openTrigger`：前一个字不是空白或标点时先补空格）。
- 展开/收起只改变高度与回车的含义，不改变正文；切换后焦点留在编辑器。

## 数据

```ts
import type {AgentConversationContext, AgentConversationServices, AgentViewAction, AgentViewRegistry} from "@notnotype/nb-agent-ui";
import type {ViewAction} from "@notnotype/nb-agent-ui/vue";

type AgentConversationComposerProps = {
    /** 必填，只读。用到 composer、interaction、availability、run。 */
    ctx: AgentConversationContext;
    /** 必填（其中各项可选）。用到 resolveTriggerMenu 与 resolveAttachmentUrl（附件缩略图）。 */
    services: AgentConversationServices;
    /** 必填。用到 commands、triggers、toolbarButtons 三个扩展点。 */
    registry: AgentViewRegistry;
    /** 版式，默认 "stacked"；"inline" 见“单行版式”。 */
    layout?: "stacked" | "inline";
};

type AgentConversationComposerEmits = {
    (e: "action", action: ViewAction): void;
};

type AgentConversationComposerExpose = {
    /** 聚焦编辑器，光标在末尾。 */
    focus(): void;
};
```

没有插槽。未声明的 attribute 落到根元素上。

## 状态

- **空闲**：占位文字“输入消息，回车发送”。
- **运行中**（含等待回答与停止中）：投递按 `interaction.canSteer`、`canQueue`：回车在允许补充说明时为 steer，否则在允许排队时为 followup；Ctrl/⌘+回车只在允许排队时为 followup。两者都不允许时能写不能发，发送键禁用、标题“运行结束后发送”；登记的 `/` 命令照常执行，这时标题是“发送”。占位文字按允许的组合四选一。正文为空时发送按钮变为停止。
- **只读**（`availability` 不是 `ready`，或不允许发送）：编辑器只读，添加附件、发送不可用；运行中允许停止时停止按钮仍可用。说明与恢复动作的横幅在第 4 步实现，当前只读时不显示原因。
- **展开**：见布局。
- 没有自己的加载中与出错状态：附件的上传状态由编辑器显示。

## 不支持

- 上传、登记附件、执行命令、保存草稿与输入历史：都由宿主根据 action 完成。
- 编辑或删除排队中的消息：没有对应的 action。

## 隐藏通道理由

- `state:local`：是否展开、拒收提示。都是纯界面状态，切换会话时不保留也不影响会话数据。
- `env:portal`：模型与思考档位的下拉与面板都渲染到 `body`。
