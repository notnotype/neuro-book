# t17 计划（第二稿，已确认）：对话界面第一版

## 1. Context

t10、t12、t18、t27 之后，服务端的 Agent 已经能跑，但应用里没有界面。第一版的标准是能真的用它写书。

依据：

- [Task README](README.md) 的 13 条方向、“第一版的范围”“注意力排序”“横屏与低代码”“静态稿定稿”（开发者 2026-11-05）。
- Spec：[`agent/conversation.md`](../../../../../docs/specs/agent/conversation.md)（新）、[`ui/agent-conversation-view.md`](../../../../../docs/specs/ui/agent-conversation-view.md)、[`agent/builtin-tools.md`](../../../../../docs/specs/agent/builtin-tools.md)、[`agent/contributions.md`](../../../../../docs/specs/agent/contributions.md)、[`agent/sessions.md`](../../../../../docs/specs/agent/sessions.md)、[`harness/runtime.md`](../../../../../docs/specs/harness/runtime.md)。
- 第一稿的设计审查 51 条，处理见 [evidences/design-review-disposition.md](evidences/design-review-disposition.md)。

约束：分支 `feat/w00032-t17-conversation-ui`（worktree `.worktree/w00032-t17-conversation-ui`），主会话自己写；实现审查前端派 Sonnet，内核与插件后端派 omp（额度用完改派 Opus）。

## 2. 技术选型

| 问题 | 选用 | 否决 |
|---|---|---|
| 文本差异 | `diff`（`diffLines`、`diffChars` 带 `maxEditLength`、`timeout`） | Monaco diff：要固定高度，中文长段落的换行与按字标记不好控制 |
| 表单 | `nb-form`，由宿主经 `renderers.form` 注入 | nb-agent-ui 直接依赖 nb-form：Vue 层只许依赖 vue 与 nb-ui，nb-story 也是它的宿主 |
| 消息流滚动条 | nb-ui 的 `OverlayScrollbar`（`views.md` 输出 12 要求 `fill` 视图用它） | 去掉 gutter 不加别的：越过阈值时重排；给输入框也留位置：把错位搬到别处 |
| 工具参数的流式解析 | 从片段里抽 `path` 字段加累计字数，手写十几行 | 通用 partial JSON 库：第一版只显示“正在写 第三章.md · 1200 字”，不解析全部 |

## 3. 关键设计

### 全局圆角（`packages/nb-ui`）

`themes/nbook/vars.css`：`--radius-control: 6px`、`--radius-panel: 10px`、`--radius-menu: 8px`、`--radius-dialog: 12px`。

`Button`、`IconButton` 的圆角按尺寸写死（6、8、10），不跟 `--radius-control` 走，只改 token 按钮不会变 6。`tokens.css` 新增 `--radius-button-sm: 6px`、`--radius-button-md: 8px`、`--radius-button-lg: 10px`（别的主题不变），两个组件改读它们，nbook 三档都设 6。

要跟着改：`e2e/popup-lists.spec.ts`、`e2e/dialog-surfaces.spec.ts` 里写死的数改成读 token，“对话框比窗口圆”的前提改成 `>=`（nbook 下都是 12）；`design-language.md` 的取值与“按尺寸写死”的说明；`vars.css` 里 26px 的注释；`Button.md`、`IconButton.md`。

nb-agent-ui：新增 `--nb-agent-bubble-radius`（缺省 `var(--radius-panel)`），用户气泡 `.acv-user-bubble`、Agent 气泡 `.acv-bubble` 共用，中间内容的小气泡走同一个；输入框走 `--radius-panel`。别的主题下气泡会随面板变，这一片各主题看一眼，接受。书架卡片的 16、34、22 不动，看图时如果不协调再说。

验证：nb-ui e2e 两个文件；截图书架、设置、编辑器、对话、nb-story 问答、nbdev 面板，菜单放大 4 倍看内圈半径（8−1−4=3）。

### 对齐（`packages/nb-agent-ui/src/vue/AgentConversationView.vue`）

输入框内边距 8 改 12，与消息流一致。`.acv-stream` 去掉 `scrollbar-gutter`，在 `.acv-body` 里放 `<OverlayScrollbar :target="streamRef" />`（`.acv-body` 已是定位元素）。e2e 量内容宽度在有无滚动条时相同。会话面板与模式菜单与输入框同宽。

### `DiffView`（`packages/nb-ui/src/components/display/DiffView.{vue,md}`，核心 `packages/nb-ui/src/diff/`）

nb-ui 加依赖 `diff`，`exports` 加 `./diff` 给别的包用（nb-history 的收件箱以后用）。先看 `packages/dev-panel/src/web/parts/DiffView.vue` 这个同名组件能不能换掉或共用。

```ts
function diffRows(before: string, after: string, options?: {budgetMs?: number}): DiffResult;
type DiffResult = {rows: DiffRow[]; hunks: DiffHunk[]; stat: {added: number; removed: number}};
type DiffRow = {kind: "same" | "add" | "del" | "change"; left: DiffPiece[] | null; right: DiffPiece[] | null; leftLine: number | null; rightLine: number | null; hunk: number | null};
type DiffPiece = {text: string; mark: boolean; folded?: number};
type DiffHunk = {index: number; beforeRange: [number, number]; afterRange: [number, number]};
```

**规模上限（审查实测：两段各 3000 字完全不同的 `diffChars` 要 7.5 秒）：** 按行比；改了的一对行，两侧长度和超过 2000 字不按字比，整行标记；`diffChars` 带 `maxEditLength: max(50, 较短一侧的 20%)`，超了退回整行；累计预算 150 毫秒，用完之后的都按行。退回写进 `.md`：“很大的改动只标到行”。

**折叠：** 没变的连续行折叠（上下留 2 行）。中文一段就是一行，所以 `change` 行内部也折叠：离任何标记超过 40 字的没变文字收成“…（812 字）…”，点开展开。

组件属性 `before`、`after`、`mode: "inline" | "split"`、`label?`、`foldContext?`。两栏是一个 grid、一行一对（滚动天然同步）；能否切两栏用容器查询（自身宽度 ≥ 700），不看视口。新增与删除除颜色外有 `+`、`−` 前缀与 `<ins>`、`<del>`。每块一个 `actions` 插槽，参数 `{hunk, beforeText, afterText}`，t17 不用，测试里验证参数。文字进 nb-ui 的消息目录。不做语法高亮。

### 审批预览：只读查询，不进内核也不进日志（`packages/neuro-book/src/plugins/agent/`）

第一稿放进 `ToolImplementation`、写进事件，审查证明走不通：工具是懒包装，审批前建实现会提前激活提供方；预览加上 `args` 会把事件撑过 256 KiB 的内联上限，向导画不出来，运行一直等。改成：

- `agentSessionsContract` 加 `approvalPreview({sessionId, interactionId})`，只读。服务端从日志取这个事项的 `tool`、`args`，按会话的资源权限读现有文件、试算，不写盘。
- 只有 `nbook.agent` 内置的 `edit`、`edit-replace`、`write` 有预览，函数放在 `backend/builtin/preview.ts`，不激活任何提供方。别的工具得 `{files: []}`，向导用 nb-form 展示态画参数。
- 结果按文件分组（hashline 的 `edit` 一次能改多个文件）。一批审批是一起问的，还没执行：同一个文件前面有别的调用时，按当前磁盘算不出来的得 `failed`，向导写“这个文件前面还有改动，预览不到”，并显示参数：

```ts
type ApprovalPreview = {files: ReadonlyArray<{address: string; kind: "diff"; before: string; after: string} | {address: string; kind: "too-large"; bytes: number} | {address: string; kind: "failed"; code: string}>};
```

单个文件超过 256 KiB 给 `too-large`；整个结果按 `sessions.md` 输出 9 的通道上限走 `previewChunk` 那条分段路径。向导显示全部目标，多文件时按文件分节，批准的是整次调用。预览和实际执行之间文件可能变，以实际执行的结果为准，不另做保证。查询失败时向导显示“预览不可用”和参数，审批照常。

### `ask`（`backend/builtin/ask.ts`）

两条贡献，给模型的名字都是 `ask`。估算两条声明约差 220 token，是主创现有 6 个工具（约 1370）的 16%，实施时量准写进证据。主创绑 `ask-form`。

**回答的合同：**

```ts
type AskRequestData = {questions: AskQuestion[]};
type AskAnswerData = {answers: ReadonlyArray<{selected: readonly string[]; other?: string; form?: JsonValue}>};
```

向导提交 `resolve{decision: "answer", answer: {text, data}}`，`text` 是向导按题拼的人话（内核要求非空）。工具收到后按请求校验（题数、选项范围、`form` 用 `validateForm`），不合规得 `ask-invalid-answer` 交回模型。向导提交前已经校验过，这一步只防别的调用方；不改内核的 `resolve`。

**后台：** `ToolSessionContext` 加 `background?: true`，工具工厂拿到；后台会话得 `ask-unavailable`，不进等待。这样后台任务不会停在没人答的提问上。第一版只用同步提问，不提供 `async`。

**失败：** `declined`、`interrupted` 交回 `{status: "error", code: "ask-declined"}`；`aborted` 同样交回，运行收口时不再发给模型。工具说明写“单独调用，不要和别的工具放在同一条回复”，只靠说明。

### 内核的小改动（`packages/nb-harness/src/kernel/`）

计划第一稿说都不做，核对后这几项站不住，都很小：

- **逐个工具的结束帧（F4）：** 不进日志的帧 `{type: "tool", callId, status}`，`runCall` 收尾时推；权威仍是批末的 `toolResult`。没有它，已批准并执行完的 `edit` 一直转圈，下一个审批已经盖上来。
- **`toolArgs` 带工具名（F8）：** `omp.ts` 第一块带 `tool`。`write`、`edit-replace` 是写书的主路径，没有它写一章的几分钟里界面什么也看不见。
- **快照加 `model`：** `{ok: true; id; contextWindow; efforts} | {ok: false; code}`，内核调现有的 `models.resolve`。上下文百分比的分母、发送可不可用、推理档都从这里来，浏览器不重写解析规则。模型服务变了宿主重取。
- **`Spend` 加 token：** `SessionCore.spend` 在累计费用的同一处累加 `input`、`output`、`cacheRead`、`cacheWrite`，进快照 `usage`；运行中由适配器按 `assistant`、`modelEnded`、`modelFailed` 日志事件增量加。口径跨回退、含失败与后台用途，和费用一致。
- **同一条回复的审批一起问（开发者 2026-11-05 定）：** 模型一次发起多个编辑和 shell 时，先把要审批的都问完，再按顺序执行，和 `ask` 一样作答。`runTools` 在切段之前加审批阶段：按调用顺序逐个判定（参数校验、只读、审批钩子），判定 `ask` 的都写 `interactionRequested`，等全部应答，结果按 `callId` 记下。之后切段执行，`terminal` 用记下的结果，不再问。这条回复里不用审批的调用也等这个阶段结束，执行顺序不变。
  - **拦截改了参数：** 审批现在在拦截链最里层，看到的是改过的参数；提前问之后看到的是模型给的。`terminal` 拿到的参数和批准时不同（规范化 JSON 比较），就按现在的路径再问一次，用户不会批了 X 却执行 Y。
  - **拦截拦下了已批准的调用：** 用户白批一次，少见，接受。
  - 改 `runtime.md` 输出 39 的“同一段里别的调用照常”。

其余（F5、F6、F9、F10、F16、F17）第一版不做。`history.hasMore` 固定 false，写进 Spec。F6 的先后没有写在合同里，`session-host` 的测试覆盖“会话未打开时先订阅再取路径，中间写入不丢”。

### 新内核的适配器（`packages/nb-agent-ui/src/kernel-transcript.ts`）

形状同 `harness.ts`：纯 JSON 输入，不依赖 nb-harness，另有跑真内核的对契约测试。

```ts
createKernelTranscript({toolName?: (id: string) => string, text})
  applySnapshot(snapshot)   // 会话级基线：buffer、settings、title、description、archived、status、usage、model
  applyPath(events)         // 重建当前路径
  applyEvent(event)         // log 帧
  applyFrame(frame)         // delta、status、tool
  messages() pending() run() usage() queue() settings() interrupted() problems()
```

**事件表（每种事件只有一个去向）：**

| 事件 | 去向 |
|---|---|
| `input`、`steer` | 用户消息；替换乐观消息（见宿主） |
| `assistant` | 助手消息；换掉正在生成的那条 |
| `toolStarted`、`toolResult` | 调用状态与结果 |
| `modelFailed` | 带 `retry`：丢掉那次半截。不带：有 `partial` 就落成已停止或出错的消息，带用量。按 `request` 关联 `modelStarted` 的 `purpose` |
| `runEnded` | `aborted` 已停止；`error` 错误消息，码转人话；`interrupted` 算中断 |
| `compaction` | 分隔条目，`text` 取 `replacement ?? ""`。界面照旧显示全部历史 |
| `continued`、`notice` | `text` 是写给模型的，界面按 `code`、`by` 查自己的文案。`result-requested`、`continued{by: core}` 一行小字；`tools-changed`、`restored` 不进消息流 |
| `interactionRequested`、`interactionResolved` | `pending()` |
| `titleChanged`、`descriptionChanged`、`archived`、`settingsChanged` | 会话级状态 |
| `inputQueued`、`inputEdited`、`inputRemoved`、`inputConsumed` | `queue()` |
| `leafChanged` | 通知宿主重建路径 |
| `sessionCreated`、`runStarted`、`turnStarted`、`turnEnded`、`toolsAnnounced`、`modelStarted`、`modelEnded`、`commandAccepted`、`profileChanged`、`approvalRemembered` | 明确忽略或只改内部状态 |
| 带 `ext` 声明的扩展事件 | 忽略（费用告警见状态栏） |
| 别的 | 记 `problems()` |

增量只画 `purpose === "turn"`；`n === 1` 且已有内容时清空重来（重连后合并器重新编号）。`toolArgs` 累加，抽 `path` 与字数，产出 `status: "streaming"` 的调用。

**工具状态：** `ToolCallStatus` 加 `denied`、`unknown`。`ok → success`；`error` 且码是 `invalid-arguments → invalid`，其余 `error`；`denied`、`blocked → denied`，副文字按 `code`、`by` 区分（你拒绝了、规则拒绝、只读模式、还没开始就停了）；`unknown → unknown`（“不确定有没有执行完，请核对”）。等审批、等回答的调用按 `status.waiting.pending` 的 `callId` 标成运行中。

**中断判定：** 当前路径最后一个 `runEnded` 是 `interrupted`，且之后没有 `runStarted`。用户停止（`aborted`）不算。

**渲染器：** `nb-agent-ui` 不出现 `nbook.`。宿主给 `toolName`：`nbook.agent.read → read` 等。`builtin-tools.ts` 补：`read` 新格式（去表头与行号前缀、行号取自前缀、尾注单独一行，目录与图片说明不走文件内容画法）；`grep`、`glob` 进 `explore`；`edit` 接 `old_string`、`new_string`；`shell` 用 `details.exitCode`；`ask` 的 `node` 呈现。

### 视图零件（`packages/nb-agent-ui/src/vue/`，纯受控，都有 Lab 场景）

**`ctx` 新增（`createAgentContext` 给缺省值，nb-story 与 Lab 不用改）：**

| 字段 | 内容 |
|---|---|
| `run.startedAt`、`run.retry?: {attempt, max, resumeAt}` | 用时、等重发；`status` 的 `stopping` 显示“正在停止” |
| `usage.input`、`usage.output`、`usage.costState: "ok" \| "warned" \| "unpriced"` | 状态栏 |
| `composer.approval?: {options, value}` | 审批模式，和 `modes` 平行，不塞进 Agent 模式；只给这一组时菜单只有这一组 |
| `composer.resume: boolean` | 中断的输入框 |
| `pendingInputs[].kind: "approval" \| "question"`，审批带 `tool`、`args`、`preview`、序号 | 向导 |
| `AgentSessionListItem.icon`、`group`、`status` 加 `waiting`、`archived?` | 会话面板 |

**action：** 沿用现有的 `input.*`，不另起名：`input.submit` 的负载写成联合 `{kind: "approval", decision, note?} | {kind: "question", answer}`，`input.cancelRun` 就是停止这一轮。新增 `run.continue`、`queued.edit`、`queued.remove`、`sessions.open`。Spec 动作表同一次改。

**零件：**

- 顶栏：标题按钮、Profile 名、新建、溢出。写死，不经 `headerActions`。
- `AgentSessionPanel`：`./vue` 入口导出（改 `AGENTS.md`、`README`）。
- `AgentStatusBar`：接 `statusItems`。`trayItems` 接排队消息。`headerActions`、`panels` 留给 w00019 t11，登记时给开发期警告。
- `AgentQueuedMessages`：每行删和改（改是取出到输入框，再发送走 `edit`）。
- 向导 `AgentWizardFrame`、`AgentApprovalWizard`、`AgentQuestionWizard`：表单经 `renderers.form` 注入，缺省实现是只读键值加 JSON 文本框。

**向导的位置（审查的改法，比第二个 `ResizeObserver` 好）：** 放进 `.acv-stream__content` 末尾，`position: sticky; bottom: 0`，最高 `60cqh`（`.acv-body` 设 `container-type: size`）。它占的高度就是留白，贴在底部时不盖最后一条，往上滚时浮在内容上，贴底逻辑不用改。`useStreamScroll` 的点击锚点要排除向导。输入框用 `v-show` 加 `inert`，不卸载，草稿与撤销栈都在。固定部分超过上限时整体滚动，diff 区最少 8 行高。

**同一条回复的多个审批：** 和提问向导同一种走法。`pending` 是这条回复全部要审批的调用，“第 1 / 3 个”是真的分母。每一步选批准、本会话都批准或拒绝（可带附言），能来回改，全部选完才能提交；提交时宿主逐个发 `resolve`。“全部拒绝”随时可点，带一段附言交给模型。不加“全部批准”（开发者第 3 轮定）。“本会话都批准”同时选中这批里同一个工具的其余调用。选了的只在宿主里，提交前不进内核，切走标签再回来还在。

**焦点与读屏：** 向导 `role="group"` 带 `aria-label`，出现时 `aria-live` 播一句。焦点到向导容器，不落到批准按钮（用户可能正在打字，回车会直接批）。没有焦点陷阱，消息流还要能读。收起后焦点到展开按钮，全部答完回输入框。Esc 只收起。附言非空时批准禁用，提示“写了附言会作为拒绝发送”。表单状态按事项 id 设 key。

**表面：** `ui-development-spec.md` 的浮层表加一行“对话内浮动面板”，用 `.nb-ui-popover-surface` 并设 `--nb-popover-pad` 为实际内边距；不写 `backdrop-filter`，`style-tokens.dom.test.ts` 加一条。收起的小条阴影按定稿调轻，也走这个类。

### 宿主（`packages/neuro-book/src/plugins/agent/web/`）

`plugin.ts` 的 `locations` 加 `browser`。入口 `onStartup`，只贡献声明与轻量的 `activity.ts`，视图与宿主动态导入；Lab 窗口不启动 `activity`（做法同 explorer）；量一次首屏与服务端激活的耗时。

**`session-host.ts`：** 按位置键（`view`、`page`）放在插件级。组件借用并计数，归零后延迟 30 秒取消订阅：编辑区页面切标签就卸载，也没有“被关闭”的信号。未提交的答案、收起状态放在这里，不放组件，切回来还在。

**打开会话的算法（Spec 输出 5）：**

1. 先订阅 `frames`，缓存帧。
2. 取 `snapshot`，得 `head`、`leaf`、会话级基线。
3. 固定这个 `leaf`，分页取 `path`，交给 `applyPath`。
4. 处理缓存：seq 不大于 `head` 的 log 帧丢掉，其余依次 `applyEvent`；`snapshot` 返回之前的 `status` 帧丢掉。
5. 遇到 `oversized` 经 `eventChunk` 拼回，按 seq 保序后再交给适配器，后续帧排队。
6. 收到 `leafChanged`：按新叶子重取路径。回退后不能把各分支的日志接在一起。

用 `onResync` 按最后的 seq 补 `log`。收到 `server-restarted` 节点已是终态：走现有的 `FailurePage` 重新加载，加载后从存储恢复当前会话。

**乐观消息：** `input` 帧先于 `send` 的响应到达，且拦截可能改写文字。适配器遇到 `input` 就替换最早的乐观消息，再用 `commandAccepted.commandId` 核对，对不上放回。明确被拒（`empty-input`、`input-too-large`、`input-rejected`、`read-only` 等）：撤掉乐观消息，文字放回输入框，上方给人话原因。连接断开、结果未知时标 `unknown`，可重发（同一个 `commandId`）或移除。

**停止：** `composer.stop` 带 `keepQueue: true`。状态栏显示“正在停止”和用时，超过 10 秒提示“工具没有响应”；以快照的 `status` 收口，不靠结束事件。

**当前会话的存储：** Storage 没有窗口作用域，两个窗口共用一条记录。按位置分键存“最近用过的会话”：运行期间各窗口各选各的，刷新后回到最近切到的那个。作品范围按 `project` 分区。

**没有会话时：** 第一次发送自动用 `nbook.agent.main` 新建（nb-story 的做法），不用先找新建按钮。

**action 表：**

| 接 | 忽略（第一版） |
|---|---|
| `composer.*`、`input.*`、`run.continue`、`queued.*`、`message.copy`、`tool.copy`（有反馈）、`session.rename`、`archive`、`restore`、`reference.open`、`link.open`、`file.openDiff`（第一版打开文件）、`availability.act` | `command.run`（`/` 开头按普通文字发）、`attachment.*`、`skill.open` |

`interaction`：`canMutateHistory: false`（编辑、重试、分支都在 t28），`canRegisterAttachments: false`，其余为真。

**注入：** `renderers` 从 `nbook.markdown` 的 `markdownKey.components` 取 Markdown 与提示词编辑器（已套好 nbook 的宿主），`form` 用 nb-form。依赖写 `markdownKey`、`commandServiceKey`、`windowProjectKey`、`storageKey`。

**`activity.ts`：** `agentSessionsContract` 加 `activity`：先订阅后快照，服务端由 `SessionTable` 维护 `{id, state: "running" | "waiting"}`，只有前台。同步等待不会被 30 秒空闲关闭（审查实测），所以开着的表就够。异步提问第一版不用，写进不承诺。订阅失败时条目不显示、写诊断。

**命令：** `nbook.agent.open`、`new-session`、`focus-session`。窗口级的位置登记：宿主挂载时登记、记最近使用；没有活位置时目标记成待领取，下一个挂载的宿主优先读它。优先最近用过的活位置，其次打开默认右栏。

**模型下拉：** 只订阅 `modelsSettingsContract.changed`。列 `enabled`、`status: ok`、有凭据的模型；当前选中的不合格也列出标“不可用”；第一项“跟随默认”写 `core.model: null`；`not-provided` 时隐藏。推理档用 `snapshot.model.efforts`。

**费用告警：** 不读 `costWarned` 事件（会话级，`path` 不返回）。用快照与设置算：`warnCost > 0 && cost >= warnCost`；单价未知看 `usage.unpriced > 0`。

### 主创（`backend/builtin/profiles/main.ts`）

optional 加 `nbook.agent.ask-form`，声明加 `icon: "i-lucide-feather"`，`work` 节加一句什么时候问（`If` 两条共用一个常量，换绑固定 `ask` 也对），`version: "2"`。

## 4. Spec 与文档改动

| 文件 | 改什么 |
|---|---|
| `docs/specs/agent/conversation.md` | 按本稿改：打开算法、事件、失败表、焦点、存储语义、贡献与激活 |
| `docs/specs/ui/agent-conversation-view.md` | 工具状态、动作表、`ctx`、向导位置与焦点、`history.hasMore` 固定 false、`renderers.form` |
| `docs/specs/agent/builtin-tools.md` | `ask` 回答合同与失败码；预览查询 |
| `docs/specs/agent/builtin-profiles.md` | 主创多 `ask-form` |
| `docs/specs/agent/contributions.md` | 声明加 `icon?` |
| `docs/specs/agent/sessions.md` | `activity`、`approvalPreview` |
| `docs/specs/harness/runtime.md` | 去掉第一稿的输出 76；加 `tool` 帧、`toolArgs` 的 `tool`、快照 `model`、`Spend` 的 token、`ToolSessionContext.background` |
| `packages/nb-ui/docs/design-language.md`、`ui-development-spec.md`、`Button.md`、`IconButton.md`、`DiffView.md` | 圆角、浮层表、新组件 |
| `packages/nb-agent-ui/AGENTS.md`、`README.md`、`docs/modules/monorepo-boundaries.md` | `./vue` 多导出、依赖 |

## 5. 切片

每片单独提交；先看到验证结果再提交。

| # | 内容 | 自跑验证 |
|---|---|---|
| 1 | 圆角与对齐、`OverlayScrollbar` | nb-ui、nb-agent-ui 测试；nb-ui e2e 两个文件；截图六处（**发给开发者看**） |
| 2 | `DiffView` | vitest（含“3000 字对 3000 字”耗时上限）；Lab：短、长、段内折叠、两栏、窄屏、深色 |
| 3 | 内核小改动 | nb-harness 全量；nb-story 验收门 |
| 4 | `ask` 两条、审批预览查询 | agent 目录；量 token |
| 5 | `kernel-transcript` | bun 测试跑真内核：对契约，含回退、停止、中断、并发工具 |
| 6 | 视图零件 | vitest、`*.dom.test.ts`；Lab 截图对照静态稿（**发给开发者看**） |
| 7 | 宿主、贡献、命令、活动 | `*.test.ts`（`bun test` 加 `agentWorld`，先例 `models/web/models-store.test.ts`）；扩 `testing/endpoint.ts`：一条回复多个调用、参数分块 |
| 8 | 主创升版；e2e；真实模型 smoke | Playwright；DeepSeek |

## 6. 验收映射

| Spec 条目 | 覆盖 |
|---|---|
| `conversation` 输出 1–4 | `session-host.test.ts`；`AgentSessionPanel.dom.test.ts` |
| 输出 5（打开算法） | `session-host.test.ts`：回退后打开、订阅期间切分支、页间回退、`oversized` 保序 |
| 输出 6–9 | `session-host.test.ts`（被拒放回、`unknown`、`keepQueue`、乐观替换）；`AgentQueuedMessages.dom.test.ts` |
| 输出 10–14 | 向导 `*.dom.test.ts`（焦点落点、Esc、附言禁用、id 换了清状态）；`session-host`（切走回来答案还在）；e2e |
| 输出 15–18 | `AgentStatusBar.dom.test.ts`；`kernel-transcript.test.ts` |
| 输出 19 | `activity.test.ts`；e2e |
| 验收 1–6 | `e2e/agent-conversation.e2e.ts`（`*.e2e.ts` 才会被跑；端点由 e2e 起 Bun 子进程） |
| 验收 7 | `conversation.llm.test.ts` |
| `builtin-tools` 的 `ask` | `builtin-tools.test.ts`：`form` 不合规、后台 `ask-unavailable`、回答越界、回答回到模型 |
| 预览查询 | `builtin-tools.test.ts`：两文件 `edit`、一大一小、读失败；懒提供方没被激活 |
| `runtime` 的新条目 | 内核测试 |
| 对齐 | `lab-agent-ui.e2e.ts` 量 390 与 1200 下左右边界与滚动条前后宽度 |

## 7. 验证

neuro-book、nb-harness、nb-agent-ui、nb-ui 全量与类型检查，受影响的 e2e，`docs:check`、`governance:check`，nb-story 内核验收门。变异检查：审批阶段先于执行、参数被改后再问、`allow-session`、附言即拒绝、上下文口径、中断判定、`maxEditLength`、打开算法的 seq 过滤、`keepQueue`、`ask` 回答校验。

未验证（留给后面）：横屏体验；1000 轮会话的视图渲染与内存（审查实测远程取 300 轮、2102 个事件 222 毫秒没问题，渲染没量，实施时量一次）。

## 8. 待开发者定与风险

**开发者已定（2026-11-05）：**

1. 同一条回复的审批一起问，全部作答或直接全部拒绝（见“内核的小改动”）。这替换了第二稿问的“拒绝一个之后怎么办”。
2. 按停止时排队的消息保留（`keepQueue`）。
3. 当前会话：运行期间各窗口各选各的，刷新后回到这个位置最近切到的，先接受两个窗口刷新后可能回到同一个。

**风险：**

- **范围大。** 八片、跨内核和四个包。第 6 片之后可以再拆。
- **没有压缩。** t11 紧接在后，第一版长对话碰到上限报错，显示成人话。
- **圆角改全局。** nb-story、nbdev 面板也用 nbook 主题，一起变。
- **`ask` 的“单独调用”只靠说明。** 模型同时发 `ask` 和 `write` 时，`write` 在回答之后照常执行，模型还没看到回答。硬保证要内核把 `finish` 的规则推广，第一版不做。
