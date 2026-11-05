# t17 计划：对话界面第一版

## 1. Context

t10、t12、t18、t27 之后，服务端的 Agent 已经能跑，但应用里没有界面。第一版的标准是能真的用它写书。

依据：

- [Task README](README.md) 的 13 条方向、“第一版的范围”“注意力排序”“横屏与低代码”“静态稿定稿”（开发者 2026-11-05）。
- Spec：[`agent/conversation.md`](../../../../../docs/specs/agent/conversation.md)（新）、[`ui/agent-conversation-view.md`](../../../../../docs/specs/ui/agent-conversation-view.md)（改）、[`agent/builtin-tools.md`](../../../../../docs/specs/agent/builtin-tools.md)（加 `ask`）、[`agent/contributions.md`](../../../../../docs/specs/agent/contributions.md)（加 `icon`）。
- 静态稿在分支 `t17/drafts`，不合并，图在 `artifacts/review/`。

约束：单独分支 `feat/w00032-t17-conversation-ui`，主会话自己写；前端审查派 Sonnet，内核与插件后端派 omp。

## 2. 技术选型

| 问题 | 选用 | 否决 |
|---|---|---|
| 文本差异 | `diff`（`diffLines`、`diffChars`），仓库已有依赖 | Monaco diff：要固定高度，不适合嵌在对话里，中文长段落的换行和按字标记不好控制 |
| 表单 | `nb-form`（`SchemaForm`、`checkDescription`） | — |
| 输入框 | 现有 `AgentConversationComposer` 与注入的 `PromptEditor` | — |

没有别的通用问题。

## 3. 关键设计

### 全局圆角（`packages/nb-ui/themes/nbook/vars.css`、`packages/nb-agent-ui`）

nbook 主题：`--radius-control: 6px`、`--radius-panel: 10px`、`--radius-menu: 8px`、`--radius-dialog: 12px`，`--radius-dialog-compact` 随 `--radius-window` 不变。

`nb-agent-ui` 里写死的 16、12、10 改走 token：新增 `--nb-agent-bubble-radius`（缺省 `var(--radius-panel)`，用户气泡 `.acv-user-bubble` 和 Agent 气泡 `.acv-bubble` 共用），输入框 `.acv-composer__frame` 走 `--radius-panel`。写进 `packages/nb-ui/docs/design-language.md`。其它主题（macos、aurora、editorial）开发者只提到默认主题，不动。

### 对齐（`packages/nb-agent-ui/src/vue/AgentConversationView.vue` 与输入框）

输入框的内边距从 8 改 12，和消息流一致。`.acv-stream` 的 `scrollbar-gutter: stable` 是气泡右边短 14px 的原因：去掉，改成滚动条覆盖内容（nb-ui 的滚动条规范里有做法，实施时按 `ui-development-spec.md`）。弹层（会话面板、模式菜单）和输入框同宽：`DropdownMenu` 给 `same width` 的定位。宽屏时都限宽 800 居中。

### `DiffView`（`packages/nb-ui/src/components/display/DiffView.{vue,md}`，核心 `packages/nb-ui/src/diff/`）

通用组件，nb-ui 加依赖 `diff`。

```ts
function diffRows(before: string, after: string): DiffRow[];
type DiffRow = {kind: "same" | "add" | "del" | "change"; left: DiffPiece[] | null; right: DiffPiece[] | null; hunk: number};
type DiffPiece = {text: string; mark: boolean};
```

按行比，改了的行按字比，再合并太碎的片段（相邻改动之间隔不到 2 个字就连起来）；没变的长段折叠，上下留 2 行，点开。组件属性 `before`、`after`、`mode: "inline" | "split"`、`label?`，宽度够 700 才显示切换。不横向滚动。每块（`hunk`）一个 `actions` 插槽，t17 不用，给以后的冲突解决。`CodeBlock` 的 tone 行用法留给补丁文字等拿不到前后全文的场合。

### `ask` 工具（`packages/neuro-book/src/plugins/agent/backend/builtin/ask.ts`）

两条贡献，给模型的名字都是 `ask`，写法同 `edit` 的两条：

- `nbook.agent.ask`：固定 schema。`questions: [{question, header?, options: [{label, description?}], multiSelect?}]`，1 到 4 题，每题 2 到 4 个选项，声明短。
- `nbook.agent.ask-form`：多一个 `form?`（JSON Schema）。说明里写清子集。

主创绑 `ask-form`（开发者要模型能出表单），用户经工具绑定换成固定的那条。实施时量两条声明的 token 差，写进证据。

执行：`form` 先过 `checkDescription(schema, {policy: "agent"})`（`nb-form` 的核心不依赖 Vue，能在服务端用），不合规返回工具错误 `ask-form-invalid` 带问题，交回模型。整批放进一次提问：`ctx.ask({question: 第一题, data: {questions}})`，回答在 `data`；工具把答案写成文字结果。没有 `ctx.ask`（后台运行）返回 `ask-unavailable`。`unavailable{declined}`、`aborted` 按运行中止处理。效果等级 `read`（只问人，不用审批）。

### 审批的预览（内核 `run/tools.ts`、`api/tool.ts`；`backend/builtin/edit.ts`、`write.ts`）

现在审批请求只有 `{tool, args, effect, reason}`，视图拿不到改前的全文。`ToolImplementation` 加 `preview?(args): Promise<ToolPreview | null>`，内核在写 `interactionRequested` 前调一次，放进 `request.preview`；抛错或超过 2 秒就不带预览，写诊断。

```ts
type ToolPreview = {kind: "diff"; address: string; before: string; after: string};
```

`edit-replace`、`edit` 用引擎试算不落盘，`write` 读现有文件。单个文件超过 256 KiB 不带全文，给 `{kind: "too-large"}`，向导显示说明。预览进日志：会话日志里本来就有文件内容的工具结果，这条会大一些，走现有的大块内容（blob）。

### 新内核的适配器（`packages/nb-agent-ui/src/kernel-transcript.ts`）

和 `harness.ts` 同样的形状：纯 JSON 输入、认不出的跳过并记 `problems()`，不依赖 nb-harness，另有一条对契约测试（开发依赖，跑真内核）。

- 输入：`applyEvent(item)`（`LogItem`）、`applyFrame(frame)`（`delta`、`status`）。
- 输出：`messages()`、`pending()`（`interactionRequested` 减去 `interactionResolved`）、`run()`（`RunStatus` 加用时起点）、`usage()`（累计来自快照的 `usage`，上下文按 Spec 输出 16）、`interrupted()`。
- 映射：`input`、`steer` → 用户消息；`assistant` → 助手消息，`toolStarted`、`toolResult` 挂到调用上；`continued`、`notice`、`compaction` → 系统条目；`modelFailed{retry}` → 丢掉那次的半截；`runEnded{error}` → 错误消息，码转人话在宿主。
- 增量只画正在生成的那条，`assistant` 到了换掉。

现有 `builtin-tools.ts` 的渲染器按旧工具名与参数，补 `nbook.agent.*` 的 id、`old_string`/`new_string`、`shell`。

内核这边 t20 审查转来的几项（F4 到 F17）第一版都不做：`path` 取全路径、`status` 的 `pending`、日志的 `toolResult` 够用；刷新时补发半截写进 Spec 的不承诺。实施时发现不够再回来改计划。

### 视图零件（`packages/nb-agent-ui/src/vue/`，都是纯受控，都有 Lab 场景）

- 顶栏：标题按钮（弹会话面板）、Profile 名、新建、溢出菜单。
- `AgentSessionPanel`（`AgentSessionList` 的上一层）：搜索、范围、过滤、分组。`AgentSessionListItem` 加 `icon`、`group`。
- `AgentStatusBar`：Spec 输出 15 到 17，取 `ctx.run`、`ctx.usage`、`ctx.connection`；`statusItems` 接进来（t10 审查转来的欠账）。
- `AgentApprovalWizard`、`AgentQuestionWizard`、外框 `AgentWizardFrame`（浮动、磨砂、60%、收起）。`ctx.pendingInputs` 扩成带 `kind: "approval" | "question"` 的联合类型；新 action `pending.resolve`、`pending.abort`。消息流底部留白用 `ResizeObserver` 量向导高度，向导变高时贴底的继续贴底。
- 输入框：`ctx.composer.resume: boolean` 控制占位文字与继续按钮；继续图标在 nb-agent-ui 里画（lucide 没有三个箭头）；模式菜单改下拉。
- 文字走现有目录。

这些在 Spec `ui/agent-conversation-view.md` 里改写顶栏、状态栏、输入框与待处理区、面板与弹窗。t10 审查转来的 S8 验收项（`aria-live`、停止与复制的反馈、夹具收成一处、开发期提示、操作条“更多”）这个 Task 只做 `aria-live` 和停止的反馈，其余留在 w00019 t11 的记录里。

### 宿主（`packages/neuro-book/src/plugins/agent/web/`）

`plugin.ts` 的 `locations` 加 `browser`。

- `session-host.ts`：`createSessionHost({client, models, project, store})`，一个对话位置一个。持当前会话、订阅、`kernel-transcript`，算出 `AgentConversationContext`，把 `AgentViewAction` 换成远程指令；乐观显示用户消息。纯 TS 加 Vue 响应式，能在 vitest 里用真实远程链路测。
- `ConversationHost.vue`：挂视图，视图与编辑区页面共用。
- `SessionsView.vue`：左栏的会话面板，点一行切到最近用过的对话位置。
- `activity.ts`：全窗口一个，订阅运行中与等用户的前台会话，给状态栏条目和公开状态 `nbook.agent/active`。现有 `running()` 是服务键，浏览器要的话 `agentSessionsContract` 加 `activity`（一个事件加一个快照），内核不动。
- 命令：`nbook.agent.open`、`new-session`、`focus-session`。
- 模型下拉：`modelsSettingsContract.snapshot` 与它的变更事件。

### 主创

`main.ts` 的 optional 加 `nbook.agent.ask-form`，声明加 `icon: "i-lucide-feather"`，提示词 `work` 节加一句什么时候问，升 `version: "2"`。

## 4. Spec 与文档改动

| 文件 | 改什么 |
|---|---|
| `docs/specs/agent/conversation.md` | 新建，`planned` |
| `docs/specs/README.md` | 登记 |
| `docs/specs/ui/agent-conversation-view.md` | 顶栏、状态栏、向导浮动与收起、模式菜单、会话面板、中断的输入框；Agent 模式按钮移到第二批 |
| `docs/specs/agent/builtin-tools.md` | `ask` 两条（planned） |
| `docs/specs/agent/contributions.md` | 声明加 `icon?`；工具实现加 `preview?`（planned） |
| `docs/specs/harness/runtime.md` | 审批请求的 `preview`（planned） |
| `packages/nb-ui/docs/design-language.md` | 圆角取值 |
| `DiffView.md`、`AgentSessionPanel.md` 等 | 新组件的同名文档 |

## 5. 切片

每片单独提交；先看到验证结果再提交。

| # | 内容 | 自跑验证 |
|---|---|---|
| 1 | 圆角与对齐 | nb-ui、nb-agent-ui 测试；Lab 截图看书架、设置、编辑器、对话 |
| 2 | `DiffView` | vitest、Lab 场景（短、长、两栏、窄屏、深色） |
| 3 | 内核 `preview`；`ask` 两条；工具预览 | nb-harness、agent 目录；量 token |
| 4 | `kernel-transcript` 与对契约测试 | bun 测试跑真内核 |
| 5 | 视图零件 | vitest、`*.dom.test.ts`、Lab 截图对照静态稿（开发者看） |
| 6 | 宿主、贡献、命令、活动 | vitest 真实远程链路 |
| 7 | 主创提示词升版；e2e 与真实模型 smoke | Playwright（真实浏览器、本机端点）；DeepSeek |

第 1 片影响全应用，单独发一轮截图给开发者看。第 5 片做完也发一轮，对照静态稿。

## 6. 验收映射

| Spec 条目 | 覆盖 |
|---|---|
| `conversation` 输出 1–4 | `session-host` vitest；`AgentSessionPanel` dom 测试 |
| 输出 5–8 | `session-host`，真实远程链路 |
| 输出 9 | `session-host`；e2e 验收 5 |
| 输出 10–14 | 向导 dom 测试；e2e 验收 2、3、4 |
| 输出 15–18 | `AgentStatusBar` dom 测试；`kernel-transcript` |
| 输出 19 | `activity` vitest；e2e |
| 验收 1–6 | `e2e/agent-conversation.spec.ts` |
| 验收 7 | `conversation.llm.test.ts` |
| `builtin-tools` 的 `ask` | `builtin-tools.test.ts`：`form` 不合规、后台没有 `ctx.ask`、回答回到模型 |
| `runtime` 的 `preview` | 内核 `interaction.test.ts`：抛错、超时不带预览 |

## 7. 验证

neuro-book、nb-harness、nb-agent-ui、nb-ui 全量与类型检查，受影响的 e2e，`docs:check`、`governance:check`，nb-story 内核验收门。变异检查：向导的 `allow-session`、附言即拒绝、上下文口径、`resume` 判断、`same width`、`preview` 超时。

未验证（留给后面）：横屏体验；长会话（几千条事件）的首屏与内存，第一版取全路径，实施时量一次 1000 轮的耗时写进证据。

## 8. 不做与风险

不做：见 Spec 的不承诺与 t28。

风险：

- **范围大。** 七片、跨内核、四个包。按切片提交，第 1、5 片让开发者看。如果做到第 5 片发现太大，第 6 片之前可以再拆。
- **没有压缩。** t11 在 t17 之后，长对话碰到上限会报错，第一版接受，错误显示成人话。
- **圆角改全局。** 控件从 10 到 6，所有页面都会变；可能有写死半径的地方不协调，第 1 片看图时查。
- **预览进日志。** 每次审批多存一份改前改后，单份上限 256 KiB。
- **`scrollbar-gutter` 去掉后**，内容变长出现滚动条时可能左右抖动，实施时确认，抖就改成给输入框也留同样的位置。
