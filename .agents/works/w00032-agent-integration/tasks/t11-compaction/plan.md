# t11 上下文压缩：实施计划

## Context

内核的压缩流程已经有了（`harness/runtime.md` 输出 46–52）：何时触发、按什么顺序调方法、怎样写事件、压缩后的对话长什么样。缺的是产品这一侧：`createAgentHost` 没有传 `compaction`，所以方法都算没有，压缩总是失败；长对话写到窗口上限就断。t17 之后作者能真的用它写书了，这是下一个会撞上的问题（开发者 2026-11-05：t17 做完紧接着做 t11）。

依据：[t11 决定](README.md)（下文写“决定 N”）、[外部参照第 7 节](../../../../../docs/research/agent-runtime-references.md)、`docs/specs/harness/runtime.md` 输出 46–52。

## 技术选型

无。方法与提示词是这个产品自己的内容；调模型走内核的 `job.model`，token 估算用内核的 `estimateTokens`。

## 关键设计

### `packages/nb-harness/src/kernel`：几处小改

- **就地压缩用会话的模型。** 现在 `purpose: "compaction"` 一律解析到“压缩”角色（`models/backend/core.ts`），压缩前的请求也按它算，就地方法吃不到缓存。`ModelCaller` 的选项加 `sessionModel?: true`：按对话请求解析模型，记录的用途仍是 `compaction`。`CompactionJob.request` 改成和对话请求相同的算法：按会话模型、带会话的推理档（`core.effort`）、跳过本次运行已撤回的扩展（`inactive`，`loop.ts` 普通请求的写法，输出 57）。对话模型解析不了时（输出 52 的只压缩运行）按压缩角色算，这时就地方法失败，换下一个。
- **方法拿得到模型的预算。** `CompactionJob` 加 `modelInfo(options) => {contextWindow, maxOutput} | null`，和 `model(request, options)` 同一次解析，摘要方法按它分段。
- **放回知道这次压缩的情况，也能交回结构。** `SessionEnv.compaction.restore(context, signal)` 改成 `restore(context, {signal, method, replacement, path, contextWindow})`，返回 `{notices: string[], restored?: JsonValue}`。`restored` 写进 `compaction` 事件的新字段，界面只读它，不解析给模型的文字。
- **方法顺序归宿主。** 内核不再内置方法名：`SessionEnv.compaction` 加 `order: {onThreshold, onOverflow}`，Profile 写了的优先。方法名就是贡献 id（`nbook.agent.shake` 这样，见下节），内核只按字符串查表，不认识任何一个。
- **校验：** `resultProblem` 要求 `result.method` 等于这次调用的方法，否则 `compaction-invalid`。
- **413 走溢出的路：** `model/classify.ts` 把状态码 413 归到 `context_overflow`（放在内容拦截之前）。决定 4 要的就是这条路：先 shake，成功就把请求再发一次，最多一次。不另加类别和分派。

### `packages/neuro-book/src/plugins/agent/backend/compaction/`：方法（新目录）

- `index.ts`：`compactionFor({editStores, ...})` 交给 `createAgentHost`（`backend/agent.ts`）。贡献点 `agent.compactionMethods`（`idPrefix: "plugin"`，内置的 id 是 `nbook.agent.shake`、`nbook.agent.inplace`、`nbook.agent.summary`，决定 8）。缺省顺序：超过阈值与手动 `shake → inplace → summary`，溢出 `shake → summary`（决定 2 的修改见末尾）。
- 贡献点的寿命照 `agent.tools`（`backend/tools.ts`）：声明先可读，第一次调用触发激活，激活失败算这个方法失败；按句柄代次取实现。撤回时中止在途调用并算失败，换下一个；晚到的结果丢弃。方法不设时限：内置方法的模型调用有内核的超时，第三方方法卡住时用户能停止（取舍，写进 Spec）。
- `cuts.ts`：`pickCut(job)` 取保留量不超过 20,000 token 的最早切点（决定 1），没有时取最后一个，允许最后一个不可切的单元超过 20,000。只供要摘要的两种方法用。`tokensAfter` = 摘要估算 + 保留量，和 `job.tokens` 同一口径。
- `shake.ts`：不调模型。`firstKeptEntryId` 用 `job.cuts[0]`，`replacement: null`，旧摘要留着。把保留窗口之外能找回的工具结果（`read`、`search`、`image`、输出长的 `shell`）列进 `omitted`，占位写明怎么找回。省下的不到 `job.tokens` 的 20% 时交回 `{failed}`。
- `inplace.ts`：`reason === "overflow"` 时失败（决定 2）。`job.request` 末尾追加压缩请求，`toolChoice: "none"`，`maxTokens` 16,384，`sessionModel: true`。回复带工具调用或没有文字都算失败：DeepSeek V4 Flash 不支持 `tool_choice`，发出去没有效果（审查实测），提示词里也写明不要调用工具。
- `summary.ts`：把请求的消息序列化成文字，换摘要系统提示词，用“压缩”角色发。输入预算 = `modelInfo` 的窗口 − 输出上限 − 余量，超了分段，后一段带前一段的摘要，走“更新已有摘要”。单条消息超预算时切块；图片写成尺寸占位，不序列化 base64。
- `prompts.ts`：摘要的小节按决定 5：用户的要求（原文）、约束与偏好（文风、人称、禁忌）、已定的设定与情节决定、进度（章节完成、在写、待办）、关键上下文（路径、章节、引用段落）、未回答的问题、下一步（引用原话）。再次压缩时原样保留旧摘要里“用户的要求”；能再取到的细节只留地址。
- `job.require` 拼进提示词（决定 7）。`details` 写 `{model, usage, require}`：`usage` 是这个方法各次模型调用之和（分段、重发都算），界面的花费只读这里；失败方法的花费只进累计。

不变量：方法不写盘、不写日志，只交结果；调模型失败、回复为空都交回 `{failed}`；不吞 `signal`。

### `.../backend/compaction/restore.ts`：放回

决定 6 的公共流程。`replacement` 为 null（shake）时跳过：对话没丢，放回会把省下的又加回去。其余情况每段一条给模型的文字：

1. 最近读过或改过的至多 5 个文件：从 `path` 按 `callId` 配对调用与结果，只取成功的 `read`、`write`，`edit` 按 `details.files` 里成功的文件，按时间倒序。用会话的资源视图重新读（权限按现在的算），读不到、撤权、删除、非文本都跳过并写诊断，不让压缩失败。单个文件最多 8,000 token，合计不超过 `min(20,000, 窗口的 25%)`。显示格式与 `read` 工具相同，并把快照记进同一个 `SessionEditStores`（`backend/plugin.ts` 拥有，经 `compactionFor` 注入，`builtin/read.ts` 的 `render` 提出来共用；只有完整显示的行算见过），模型接着用行锚能改。
2. `session://plan.md`，有才放，算在同一份预算里。
3. 完整对话记录的地址：`sessions://<本会话>/session.jsonl`。不另写副本（待确认 1）。

种子由内核的 `opening()` 重读，这里不管。`restored` 交回 `[{kind: "file" | "plan" | "log", target, tokens, truncated}]`。

### `packages/neuro-book/src/plugins/models`：阈值（决定 1）

- 全局设置 `nbook.models/compaction`：缺省按预留量（内核现有算法）、百分比或固定 token 数。
- 模型配置的 `compactAt` 换成 `compaction?: {base: number} | {percent: number} | {at: number}`，覆盖全局。端口解析时算成 `compactAt` 交给内核，内核不变。`base` 是把窗口当成这个数按预留量算；`percent` 是窗口的百分比，窗口未知时不生效；算出来超过窗口时按窗口，不大于 0 时退回内核缺省。
- 旧配置的 `compactAt` 读作 `{at}`，保存时写新形状；远程合同的 `compactAt` 字段同样换掉。
- 模型编辑窗口与模型服务设置页各加一项。

### `packages/nb-agent-ui` 与 `plugins/agent/web`：界面（决定 9）

- **`/compact [要求]`：** `builtin-composer` 已经登记，缺的是宿主：`session-host.ts` 加 `command.run`，调 `remote.compact`。没有会话时不新建，说明“还没有对话”。被拒时文字放回输入框并说明，`nothing-to-compact`、`no-compaction-model`（带“打开设置”）、`read-only` 各有文案。运行中受理（`next-boundary`）给一条“将在这一步结束后压缩”的说明，下一次状态变化时清掉。结果未知只说明，不重发。要求为空时不传。
- **其余 8 个命令：** 宿主还不支持的不进菜单（t17 留下的死入口：菜单列着，发出去被丢弃）。
- **只压缩的运行：** 适配器记 `runStarted.kind`，`run` 视图带 `kind: "compact"`。这种运行不把上一轮算成运行中（不展开、不转圈），`aborted` 与 `error` 不碰上一轮的回复：停止显示“压缩已停止”，失败显示 `compaction-failed` 的文案（没成功、对话没动、可以换压缩模型或开新会话）。
- **分隔线：** `SystemMessageView` 加 `compaction?: CompactionView`（数字与字符串，适配器从事件的 `details` 与 `restored` 取，不解析 notice，也不配对 `modelEnded`）。`dividerHasBody` 改成有文字或有详情都能点开。详情用 `<dl>`，只显示有的字段：方法与模型、压缩前后 token（标“估算”，不算百分比）、花费、用到的要求、放回了什么、保留最近几轮原文或省略了几条工具结果、摘要全文（走 Markdown）。shake 写“没有调用模型”。
- **轮中的压缩：** 整轮收起时分隔线也显示，放在整轮摘要行和结果之间（待确认 3）。
- **上下文读数：** 压缩后到下一次回复前，显示 `tokensAfter` 加放回的量，悬停标“估算”，写进 `agent/conversation.md` 输出 16。
- 组件同名 `.md`、Lab 场景（有摘要、shake、含放回、含要求、token 增加）、locales 照常。做完发评审板看外观。

### Profile

主创用缺省顺序，不另写。写作用的 `compaction.require` 留空，随体验再加。后台与标题 Profile 维持 `compaction: false`。

## Spec 与文档改动

- 新建 `docs/specs/agent/compaction.md`（planned）：三种方法、放回、失败码；注册表登记。
- `harness/runtime.md`：输出 47、48 的顺序归宿主、`sessionModel`、`modelInfo`、`restore`、`restored` 字段、方法名校验。`harness/models.md`：`ModelCaller`；输出 2 的 413。
- `models/service.md`：阈值配置。`agent/contributions.md`：贡献点与它的寿命。`agent/conversation.md`：`/compact`、输出 16 的读数。`ui/agent-conversation-view.md`：分隔线详情、轮中压缩的位置、只压缩的运行。
- `agent/harness.md` 第 23 行、`agent/sessions.md` 第 22 行的“不做压缩”“没有压缩方法”改掉。

## 切片

1. **内核：** 请求算法、`sessionModel`、`modelInfo`、顺序归宿主、`restore` 的新形状、方法名校验、413。验证 `nb-harness` 的 `compaction`、`run`、`model`。
2. **方法与贡献点：** `shake`、`inplace`、`summary`、提示词、贡献点寿命，接到 `createAgentHost`。验证真实内核加本机端点。
3. **放回：** 文件、计划、日志地址。验证行锚在压缩后能用。
4. **阈值：** 模型服务的配置、界面、旧配置读取。验证 `plugins/models`。
5. **界面：** `/compact`、只压缩的运行、分隔线详情、Lab。验证 `nb-agent-ui`、`session-host` 与受影响的 e2e。评审板看外观。
6. **收口：** 真实模型冒烟、实现审查（后端 omp，前端 Sonnet）。

## 验收映射

| 场景 | 覆盖 |
|---|---|
| 超过阈值：shake 省得够就停；不够换就地，就地的模型、推理档与消息前缀和对话请求相同 | `compaction.test.ts`（真实内核、本机端点） |
| 服务商报溢出、回 413：shake、摘要，用“压缩”角色，同一请求重发一次 | 同上 |
| 就地的回复带工具调用：算失败，换摘要 | 同上（OMP 的 DeepSeek 兼容档） |
| 只配了压缩角色、对话模型不可用：手动压缩走到摘要 | 同上 |
| 摘要再压缩：旧摘要的“用户的要求”还在 | 同上 |
| 摘要分段：单条超预算、图片、压缩模型窗口比会话模型小 | 同上 |
| 方法失败、回复为空、中止、方法名不符：换下一个或按内核收口 | 同上 |
| 运行中撤回的扩展不进压缩请求 | `run` 的内核测试 |
| 第三方方法：未激活、激活失败、运行中撤回、按 Profile 顺序调用 | `compaction.test.ts`（真实平台登记） |
| 压缩后用放回的行锚直接 `edit` 成功 | `compaction.test.ts` |
| 放回只取成功的文件，撤权的跳过；小窗口模型预算收紧 | `compaction.test.ts` |
| 阈值三层、边界值与旧配置 | `plugins/models` 的测试 |
| 事件映射：详情、shake、只压缩运行的 `aborted`/`error` 不碰上一轮、压缩后的读数 | `kernel-transcript.test.ts` |
| 轮中压缩在收起的轮里可见；只压缩运行不把上一轮算运行中 | `conversation-turns.test.ts` |
| `command.run`：空闲、运行中、被拒、没有会话；不支持的命令不进菜单 | `session-host.test.ts` |
| shake 的分隔线能点开，详情字段 | `nb-agent-ui` 组件测试 |
| 空闲 `/compact 要求` 后出现带详情的分隔线 | `agent-conversation.e2e.ts` |
| 真实模型：长对话触发压缩，接着写 | `compaction.llm.test.ts`（DeepSeek） |

## 验证

只跑受影响的：切片里列的测试文件；e2e 跑 `agent-conversation`、`lab-agent-ui`，改了 Lab 场景再加 `lab-scenes`（t17 漏了它）；模型配置的界面改动加 `models`、`settings`；`docs:check`、`governance:check`。不跑全量（开发者 2026-11-05）。

未验证边界：缓存实际命中多少要看真实服务商，冒烟只记录 `cacheRead`，不设判据。

## 不做与风险

- 不做 remote、snapcompact（决定 2）。
- 不放回“加载过的 Skill”：Skill 还没有实现，有了之后在 `restore.ts` 加一段。
- 不做会生成图片的方法（决定 4）。
- 对话模型不可用时界面不开 `/compact`：输入框这时只读，输出 52 的这条只由内核测试覆盖。
- 不给方法设时限（见贡献点寿命）。
- 风险：摘要质量要靠实际写书的体验调，第一版只保证小节齐全、要求原文保留（开发者已说明随反馈优化）。
- 风险：`tokensAfter` 是估算，不含系统提示与工具，压缩后读数偏低，第一次回复后会跳上去。悬停写明“估算”，不另算。

## 待开发者确认（设计审查之后）

1. **完整对话记录用现有的日志地址，不另写一份渲染的。** 决定 6 要提前做渲染对话记录。审查指出写到 `session://transcripts/` 有两个问题：绕过按读者的出站过滤，留一份不过滤的副本；放在模型可写的目录里，和只读的权威日志成了两份。`sessions://<本会话>/session.jsonl` 已经可读。代价：模型读到的是 JSONL，比 Markdown 吵。渲染版留给 t14，要带过滤。
2. **缺省顺序末尾都加摘要：** 超过阈值与手动 `shake → inplace → summary`（决定 2 只到就地）。就地可能失败：DeepSeek V4 Flash 不支持禁止工具调用，只配了压缩角色时对话模型也不可用。不加的话这些情况压缩直接失败。代价：两个方法都失败时多花一次。
3. **轮中压缩的分隔线常显：** 整轮收起时也露出来，放在摘要行和结果之间。否则最常见的自动压缩默认看不到。外观随评审板看。

## 开发者已确认（2026-11-05）

偏离 [t11 决定](README.md) 的三处，决定记录在 Task README：

1. 不做“看压缩前的原文”：对话视图显示的是整条路径，压缩前的内容就在分隔线上面。
2. shake 之后不放回：`replacement` 为 null 时跳过放回。
3. 按模型的阈值不做前缀匹配：阈值写在每个模型自己的配置里。
