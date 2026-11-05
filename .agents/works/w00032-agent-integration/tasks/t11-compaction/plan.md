# t11 上下文压缩：实施计划

## Context

内核的压缩流程已经有了（`harness/runtime.md` 输出 46–52）：何时触发、按什么顺序调方法、怎样写事件、压缩后的对话长什么样。缺的是产品这一侧：`createAgentHost` 没有传 `compaction`，所以方法都算没有，压缩总是失败；长对话写到窗口上限就断。t17 之后作者能真的用它写书了，这是下一个会撞上的问题（开发者 2026-11-05：t17 做完紧接着做 t11）。

依据：[t11 决定](README.md)（下文写“决定 N”）、[外部参照第 7 节](../../../../../docs/research/agent-runtime-references.md)、`docs/specs/harness/runtime.md` 输出 46–52。

## 技术选型

无。方法与提示词是这个产品自己的内容；调模型走内核的 `job.model`，token 估算用内核的 `estimateTokens`。

## 关键设计

### `packages/nb-harness/src/kernel`：两处小改

- **就地压缩要用会话的模型。** 现在 `purpose: "compaction"` 一律解析到“压缩”角色（`models/backend/core.ts`），压缩前的请求也按它算，就地方法吃不到缓存。`ModelCaller` 的选项加 `sessionModel?: true`：按对话请求解析模型，记录的用途仍是 `compaction`。`CompactionJob.request` 改按会话模型计算（`compact.ts`），摘要方法只取它的内容、用角色模型发，不受影响。
- **放回要知道这次压缩的情况。** `SessionEnv.compaction.restore(context, signal)` 改成 `restore(context, {signal, method, replacement, path})`，`path` 是压缩前的路径事件。

### `packages/neuro-book/src/plugins/agent/backend/compaction/`：方法（新目录）

- `index.ts`：`compactionFor(...)` 交给 `createAgentHost`（`backend/agent.ts` 第 121 行）。方法表来自贡献点 `agent.compactionMethods`，内置的三种也走它（决定 8），写法照 `agent.tools`。
- `cuts.ts`：`pickCut(job)` 取保留量不超过 20,000 token 的最早切点（决定 1）；没有这样的切点时取最后一个。公用。
- `shake.ts`：不调模型。把保留窗口之外能找回的工具结果（`read`、`search`、`image`、输出长的 `shell`）列进 `omitted`，占位写明怎么找回（“内容已省略，重新 read 这个地址可以取回”）。`firstKeptEntryId` 用第一个切点，`replacement: null`。省下的不到压缩前的 20% 时交回 `{failed}`，换下一个方法：省得太少很快又会触发。
- `inplace.ts`：`reason === "overflow"` 时失败（决定 2）。`job.request` 末尾追加压缩请求，`toolChoice: "none"`，`maxTokens` 16,384，`sessionModel: true`。回复的文字就是摘要。
- `summary.ts`：把请求的消息序列化成文字，换摘要系统提示词，用“压缩”角色发。放不下时按窗口分段，后一段的请求带前一段的摘要，走“更新已有摘要”。
- `prompts.ts`：摘要的小节按决定 5：用户的要求（原文）、约束与偏好（文风、人称、禁忌）、已定的设定与情节决定、进度（章节完成、在写、待办）、关键上下文（路径、章节、引用段落）、未回答的问题、下一步（引用原话）。再次压缩时原样保留旧摘要里“用户的要求”；能再取到的细节只留地址。
- `job.require` 拼进提示词（决定 7）。`details` 写 `{model, require}`，界面要用。

不变量：方法不写盘、不写日志，只交结果；调模型失败、回复为空都交回 `{failed}`；不吞 `signal`。

### `.../backend/compaction/restore.ts`：放回

决定 6 的公共流程。`replacement` 为 null（shake）时跳过：对话没丢，放回会把省下的又加回去。其余情况每段一条给模型的文字：

1. 最近读过或改过的至多 5 个文件：从 `path` 里按时间倒序取 `read`、`edit`、`write` 的目标，重新读盘。单个文件最多 8,000 token，合计 20,000 token，超了截断。显示格式与 `read` 工具相同，并把快照记进 `EditStore`，模型接着用行锚能改（`builtin/read.ts` 的 `render` 提出来共用）。
2. `session://plan.md`，有才放。
3. 完整对话记录的地址：压缩时把压缩前的路径渲染成 Markdown 写到 `session://transcripts/<压缩序号>.md`，工具结果截到 2,000 字。这是决定 6 提前做的渲染对话记录。

读不到的跳过并写诊断，不让压缩失败。种子由内核的 `opening()` 重读，这里不管。

### `packages/neuro-book/src/plugins/models`：阈值（决定 1）

- 全局设置 `compaction`：缺省按预留量（内核现有算法）、百分比或固定 token 数。
- 模型配置的 `compactAt` 换成 `compaction?: {base: number} | {percent: number} | {at: number}`，覆盖全局。端口解析时算成 `compactAt` 交给内核，内核不变。旧配置的 `compactAt` 读作 `{at}`。
- 模型编辑窗口与模型服务设置页各加一项。

### `packages/nb-agent-ui` 与 `plugins/agent/web`：界面（决定 9）

- `/compact [要求]`：登记进 `commands`，宿主在 `command.run` 里调已有的 `remote.compact`。`nothing-to-compact`、`no-compaction-model` 用输入框上方的说明显示。
- 分隔线：`SystemMessage` 加可选的 `compaction` 详情，点开看方法与模型、压缩前后 token、花费、摘要全文、放回了什么、用到的要求。适配器把 `compaction` 事件与紧跟的 `notice{restored}` 并成一条，花费取它之前 `purpose: "compaction"` 的 `modelEnded`。压缩中的状态与停止 t17 已有。
- 组件同名 `.md`、Lab 场景、locales 照常。做完发评审板看外观。

### Profile

主创用内核的缺省顺序，不另写。写作用的 `compaction.require` 留空，随体验再加。后台与标题 Profile 维持 `compaction: false`。

## Spec 与文档改动

- 新建 `docs/specs/agent/compaction.md`（planned）：三种方法、放回、失败码；注册表登记。
- `harness/runtime.md`：输出 47、48 的 `sessionModel` 与 `restore`。`harness/models.md`：`ModelCaller`。
- `models/service.md`：阈值配置。`agent/contributions.md`：贡献点。`agent/conversation.md`：`/compact`。`ui/agent-conversation-view.md`：分隔线详情。
- `agent/harness.md` 第 23 行、`agent/sessions.md` 第 22 行的“不做压缩”“没有压缩方法”改掉。

## 切片

1. **内核两处小改**：`sessionModel`、`restore` 的参数。验证 `nb-harness` 的 `compaction`、`run`。
2. **方法与贡献点**：`shake`、`inplace`、`summary`、提示词，接到 `createAgentHost`。验证真实内核加本机端点。
3. **放回**：文件、计划、对话记录。验证行锚在压缩后能用。
4. **阈值**：模型服务的配置、界面、旧配置读取。验证 `plugins/models`。
5. **界面**：`/compact`、分隔线详情、Lab。验证 `nb-agent-ui` 与受影响的 e2e。评审板看外观。
6. **收口**：真实模型冒烟、实现审查（后端 omp，前端 Sonnet）。

## 验收映射

| 场景 | 覆盖 |
|---|---|
| 超过阈值：shake 省得够就停；不够换就地，就地用会话模型 | `compaction.test.ts`（真实内核、本机端点，断言请求的模型与消息前缀） |
| 服务商报溢出：shake、摘要，用“压缩”角色，同一请求重发 | 同上 |
| 摘要再压缩：旧摘要的“用户的要求”还在 | 同上 |
| 方法失败、回复为空、中止：换下一个或按内核收口 | 同上 |
| 压缩后用放回的行锚直接 `edit` 成功 | `compaction.test.ts` |
| 第三方插件贡献方法并按 Profile 顺序调用 | `compaction.test.ts` |
| 阈值三层与旧配置 | `plugins/models` 的测试 |
| `/compact 要求`：要求进提示词；分隔线详情 | `agent-conversation.e2e.ts` 加一条；`nb-agent-ui` 组件测试 |
| 真实模型：长对话触发压缩，接着写 | `compaction.llm.test.ts`（DeepSeek） |

## 验证

只跑受影响的：切片里列的测试文件、`agent-conversation` e2e、`lab-agent-ui` 里分隔线相关的用例；`docs:check`、`governance:check`。不跑全量（开发者 2026-11-05）。

未验证边界：缓存实际命中多少要看真实服务商，冒烟只记录 `cacheRead`，不设判据。

## 不做与风险

- 不做 remote、snapcompact（决定 2）。
- 不放回“加载过的 Skill”：Skill 还没有实现，有了之后在 `restore.ts` 加一段。
- 不做会生成图片的方法。字节太大（413）时缺省顺序本来就先走 shake（决定 4）。
- 风险：摘要质量要靠实际写书的体验调，第一版只保证小节齐全、要求原文保留（开发者已说明随反馈优化）。
- 风险：`job.request` 改按会话模型算后，对话模型不可用时只压缩的运行（输出 52）要能算出请求。切片 1 单独测这条。

## 开发者已确认（2026-11-05）

偏离 [t11 决定](README.md) 的三处，决定记录在 Task README：

1. 不做“看压缩前的原文”：对话视图显示的是整条路径，压缩前的内容就在分隔线上面。
2. shake 之后不放回：`replacement` 为 null 时跳过放回。
3. 按模型的阈值不做前缀匹配：阈值写在每个模型自己的配置里。
