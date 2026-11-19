---
schema: nbook.proposal/v1
status: accepted
created: 2026-10-15
decided: 2026-10-15
supersedes: []
superseded-by: null
specs:
  - docs/specs/agent/harness.md
adrs: []
---

# nb-harness：Profile 定义、工具三层与一次运行的结果

## 问题

nb-story 要做内置问答（w00024 t05）：一个 Agent 用查图、搜索、读原文的工具查资料，最后调作答工具交出结构化的答案。这是 nb-harness 的第一个真实调用方。照这个场景核对现在的 nb-harness（`packages/nb-harness`，211 行的 `harness.ts`），缺的不止一处：

- **工具不由 Agent 自己决定**：`createHarness` 总会挂上以 cwd 为根的读文件、改文件两个工具；问答 Agent 不该能改文件，也读不该读的目录。插件的工具一律合进同一个列表，Profile 管不了。
- **Profile 只接了一半**：每轮渲染 Profile 后只取系统提示词，渲染出的消息被丢掉；交给模型的历史实际在 OMP Agent 的内存里，会话日志只是旁记，重启后接不上。
- **一次运行的结果说不清**：`turn()` 只返回最后一段文字。模型出错、被取消、输出被截断时，调用方拿到的是空文字或半截文字，分不清“说完了”和“失败了”；用量与费用没有交出，会话日志里也没有。
- **结构化的收尾做不到**：问答的作答工具调完就该结束，并且参数不通过校验时要退回给模型改；现在没有这种工具。
- **模型只认 OMP 内置目录**：自建的 OpenAI 兼容端点（例如 relay）用不了；`DEEPSEEK_API_BASE` 是只对 deepseek 生效的特例。
- **前缀缓存的路由键没带上**：创建 OMP Agent 时没传会话 id，OpenAI 一类服务的 `prompt_cache_key` 一直为空。
- **没有单次请求**：只有带工具的循环，不带工具的一次调用要调用方自己绕开 harness 去用 pi-ai。

## 目标与非目标

目标：

1. Profile 是一个 Agent 的完整定义：身份、需要的工具、上下文；上下文每轮由会话日志渲染，交给模型的就是渲染结果。nb-harness 只经 Profile 运行。
2. 工具分三层：登记表（有什么）、Profile 声明（要什么）、用户配置（禁用什么）。会话开始时算出生效工具集，会话内不变。
3. 一次运行（`turn`）返回停止原因、出错信息、用量与费用；会话日志记下这些和工具的结构化结果。
4. 收尾工具：调用且通过校验时结束这次运行，参数就是结果；不通过时当普通工具出错，模型改了再交。
5. 模型可以按配置给出（服务地址、模型名、密钥环境变量名、单价），不限于 OMP 内置目录。
6. 单次请求：同样经 Profile，与 Agent 共用模型配置、停止原因与用量统计。

非目标（开发者 2026-10-15 定为后续 Task，本稿先搁置）：

- 工具发现（OMP 的 `loadMode` 与 `xd://`、Claude Code 的延迟工具）。
- 插件给所有 Profile 提供的公共工具（MCP 一类）；配置里给 Profile 追加工具；工具审批。
- 步数上限与失控保护：现在的模型很少失控，有需要再做。
- 模型角色（role）的解析：属于宿主，见[模型角色的后端契约](model-roles-contract.md)。harness 只接收解析好的模型。

## 当前行为与证据

| 位置 | 行为 |
|---|---|
| `packages/nb-harness/src/harness.ts` 的 `createHarness` | 内置 `read`、`edit` 两个工具总在工具列表里；`use()` 中途加插件会立刻改动发给模型的工具列表 |
| 同上 `turn()` | `renderProfile(...)` 只取 `systemPrompt`；返回 `{text, entries}`；`agent.prompt` 出错时不抛，错误留在最后一条消息的 `stopReason: "error"` 与 `errorMessage` 上，被忽略 |
| `src/plugins.ts` | 插件 = `{manifest, tools?, readFormats?}`；只在同一插件内查工具重名，两个插件撞名不报错 |
| `src/model.ts` | `resolveModel` 只查 OMP 内置目录；`applyBaseUrlOverride` 只认 `DEEPSEEK_API_BASE` |
| `packages/nb-profile` | Profile 模块默认导出一棵 `ProfileNode` 树；节点只管提示词与消息，没有工具声明 |
| `packages/nb-session` | 工具结果只存文字；没有用量条目 |
| OMP `pi-agent-core` 18.2.5 | 有 `afterToolCall`、`syncContextBeforeModelCall` 钩子与 `sessionId` 选项；每条模型消息带 `usage`（含 `cost`）、`stopReason`、`errorStatus` 与错误标记；公开的 `TERMINAL_TOOL_RESULT_ABORT_REASON` 能在工具结果之后结束循环且不再请求模型（设计审查实测） |
| OMP `pi-ai` 18.2.5 | provider 层重试空回复与瞬时故障时，丢掉的那次请求的用量不交给 Agent（审查实测两次请求只计后一次）；`getApiKey` 返回空时退回同一 provider 的默认密钥（审查实测在自定义地址下发出了 `OPENAI_API_KEY`）；Agent 外层捕获的错误只留文字，丢掉结构化标记 |
| 旧应用 `packages/neuro-book-legacy/server/agent/profiles/` | Profile 用 `defineAgentProfile({manifest, tools: toolset(builtin.web.search, …), context})` 声明工具，工具以带类型的引用写出 |

设计审查（omp，13 条）的报告与探针说明见 [w00002 t21 的证据](../../.agents/works/w00002-neuro-agent-harness-redesign/tasks/t21-harness-profile-tools/evidences/design-review.txt)。

调用方：目前只有 nb-harness 自己的测试调用 `createHarness`；`packages/llmlint` 用的是已冻结的 `neuro-agent-harness`，不受影响。

## 方案

### 1. Profile 定义

Profile 模块的默认导出从一棵树改成一份定义：

```ts
export default defineProfile({
    manifest: {key: "story-qa", version: "1", name: "剧情问答", description: "…"},
    initialSchema: Type.Object({book: Type.String(), at: PositionSchema}),
    tools: toolset(story.find, story.card, story.search, story.readSource, optional(story.timeline), answerTool),
    context: (ctx) => (
        <ProfilePrompt>
            <System>{rules(ctx.initial)}</System>
            <If tool="story.timeline"><System>…时间线的用法…</System></If>
            <HistorySet />
        </ProfilePrompt>
    ),
});
```

- **初始输入**：`initialSchema` 是 TypeBox schema。新会话开始时按它校验 `initial`，写进会话快照（第 3 节），会话内只读。它和每一轮的用户输入是两回事：`turn(input)` 的 `input` 是这一轮说的话。
- **工具引用**：`tools` 里每项是提供方导出的带类型句柄，只含稳定 id（`builtin.read`、`story.search`）与参数类型，不 import 工具的执行代码。也可以是 Profile **自带的工具**（例如问答的作答工具）。默认必需，`optional(…)` 标为可选。
- **工具取得会话数据**：工具的 `execute` 收到本会话的执行上下文 `{sessionId, initial, signal}`。作品、阅读位置这类会话数据只从这里取，不放进模块级变量。同一个 Profile 模块被两个会话复用时互不串状态。
- **上下文**：`context(ctx)` 的 `ctx` 有 `initial`、本会话的生效工具集与历史。`<If tool="…">` 按工具 id 判断是否在生效工具集里，嵌在 `System` 里同样生效（nb-profile 的 `If` 加 `tool` 参数，渲染输入加生效工具集）。
- **只经 Profile 运行**：nb-harness 只经 Profile 运行，单次请求也一样（见第 6 节）。

### 2. 渲染结果是模型的上下文，会话日志存完整消息

- **日志存原样消息**：会话日志改存 OMP 的原样消息，新增条目 `agent_message`。它保留助手消息的内容块顺序、thinking 与签名、provider 回放字段（`providerMetadata`、`providerPayload`），以及工具结果的 `toolName`、多模态内容与 `details`。现在的 `message`、`tool_call`、`tool_result` 文字条目不再由 harness 写；给人看的文字由读取方从原样消息里取。
- **渲染即上下文**：`HistorySet` 渲染出的就是这些原样消息，顺序不变，工具调用与结果总是整组出现。
  - 每次模型请求前，harness 先等会话日志写完，再渲染 Profile。
  - 渲染结果经 OMP 的 `syncContextBeforeModelCall`（系统提示词与消息）交给模型。OMP Agent 仍保留它自己调度用的状态，但送给模型的内容以渲染结果为准。
  - 两次请求之间历史只追加不改写，前缀缓存保持稳定。
- **旧日志**：旧格式（只有文字条目）的日志只能读，不能接着运行，接着运行时报 `session_incompatible`。目前只有 nb-harness 自己的测试写过这种日志。

### 3. 工具三层与会话快照

1. **登记表**：内置工具与插件贡献的工具都登记在这里。每个工具分两部分：
   - **声明**：可以复制、可以冻结，包括 id、给模型看的名字、参数 schema、提供方与版本、是否收尾工具；
   - **调用句柄**：可以撤回，每次调用时经句柄取得实现，不缓存实现。

   插件只能贡献工具（原来的 `readFormats` 改成 `read` 工具自己的构造参数）。`harness.use()` 去掉，登记改在登记表上做，只影响之后新建的会话。
2. **Profile 声明**：见第 1 节。
3. **用户配置**：宿主传入禁用清单（全局或按 Profile）。harness 不读配置文件，只接收解析好的策略。

新会话在写入第一条用户输入之前算出生效工具集：

```
Profile 必需 ∪（Profile 可选 ∩ 已登记 − 已禁用）
必需的工具没登记或被禁用 → 会话起不来，报 tool_unavailable（写明 Profile、工具、原因、该由谁提供）
两个工具给模型看的名字相同 → 报 tool_name_conflict
```

- **会话快照**：算出的结果连同 Profile 的 key 与版本、`initial`、各工具的声明，作为会话的第一条条目（`session_snapshot`）写进日志。整个会话都用这份快照，前缀缓存不会因为中途装卸插件失效。
- **恢复会话**：从快照重建工具声明，再向登记表取调用句柄。Profile 版本不同、或某个工具的声明（schema、提供方版本）和快照对不上时，报 `session_incompatible`，不悄悄换成新配置。
- **撤回**：会话运行中某个工具的句柄被撤回时，按[可扩展应用平台](extensible-application-platform.md)的 P1、P11：
  - 之后的调用得到 `plugin-unavailable` 工具错误，运行继续；
  - 在途的调用收到中止信号，只记一条结果，迟到的完成丢弃；
  - 等待多久由宿主决定，平台定的是 5 秒加 2 秒中止宽限。

### 4. 一次运行与会话的寿命

- **同一会话同一时刻只有一次运行**：运行中再调 `turn()` 或 `complete()`，在读历史、渲染、写日志之前就拒绝，报 `session_busy`，不排队。
- **关闭的顺序**：`close()` 先拒绝新的运行，再中止在途运行，等它结束、日志写完，最后解除订阅；关闭后再调用报 `session_closed`。

`turn()` 返回：

```ts
type TurnResult = {
    stopReason: "stop" | "finished" | "length" | "error" | "aborted";
    text: string;                                    // 最后一段助手文字
    finish: {tool: string; args: unknown} | null;    // 收尾工具结束时
    error: {kind: ErrorKind; status: number | null; message: string} | null;
    usage: Usage;
    entries: SessionEntry[];                         // 只含这一次运行写下的条目
};
type ErrorKind = "network" | "rate_limit" | "auth" | "quota" | "context_overflow" | "provider" | "local";
```

- **错误归类**：`kind` 是 harness 自己的归类，不是 OMP 的枚举，也不按错误文字判断。来源有两层：
  - **provider 的错误**：按 OMP 消息上的 `errorStatus` 与错误标记归类，优先级如下：
    1. 401、403 或认证标记归为 `auth`；
    2. 余额与配额标记归为 `quota`；
    3. 429 归为 `rate_limit`；
    4. 上下文超长标记归为 `context_overflow`；
    5. 网络与网关超时归为 `network`；
    6. 其余归为 `provider`。
  - **harness 自己的错误**：解析密钥、渲染 Profile、写会话日志都放在 harness 能保留错误类型的地方处理。密钥缺失归为 `auth`，本地 I/O 与渲染失败归为 `local`，不谎报成模型出错。

  出错不抛异常，按 `stopReason: "error"` 返回。启动期与生命周期的合同错误照旧抛出：`tool_unavailable`、`tool_name_conflict`、`session_incompatible`、`session_busy`、`session_closed`、Profile 不合法、`initial` 不合 schema。
- **会话日志**：每条模型消息之后记一条用量，出错与取消也各记一条。
- **用量的口径**：`usage` 是这次运行里看得到的模型消息的用量之和，另带 `complete: boolean`。发生过取消、或者察觉到 provider 层重试（经 `onResponse` 数到的响应多于模型消息）时为 `false`，调用方写成“至少”。OMP 在 provider 层重试时，被丢掉的那次请求的用量不交给 Agent，所以这个和是下界，不是账单。单价未知时 `cost` 为 `null`，与“计量不完整”分开表达：

  ```ts
  type Usage = {input: number; output: number; cacheRead: number; cacheWrite: number; cost: number | null; complete: boolean};
  ```

### 5. 收尾工具

工具声明上标 `finish: true`。规则：

- **成功即结束**：一条助手消息里只调用了一个收尾工具，且 `execute` 返回成功时，这次运行结束。参数（按 schema 校验过）放进 `TurnResult.finish`，`stopReason` 为 `"finished"`。工具结果照常写进会话日志，调用与结果成对，但不再回传给模型。实现用 OMP 公开的 `TERMINAL_TOOL_RESULT_ABORT_REASON`，审查时实测过：只发一次模型请求，历史保持成对。
- **校验失败就退回**：`execute` 返回 `isError`（例如问答的作答工具发现依据晚于阅读位置），当普通工具出错，结果回传，模型改了再交。
- **和别的调用混在一起**：同一条助手消息里收尾工具与别的工具一起调用，或者调用了两个收尾工具时，收尾工具一律以工具错误退回（“收尾工具要单独调用”），不执行；别的工具照常执行，模型下一轮单独再交。不会有两个答案同时被接受，也不会中止正在跑的工具。
- **结束以哪一刻为准**：收尾工具的结果写进会话日志的那一刻。在此之前用户取消，结果是 `aborted`；在此之后的取消不影响 `finished`。写日志失败时结果是 `error`（`local`），不返回 `finished`。

### 6. 单次请求

`complete({model, profile, initial, input, signal})`：

- **只用无工具的 Profile**：Profile 声明了任何工具就报 `profile_has_tools`，不悄悄忽略声明。
- **不经会话**：不写会话日志，不占用会话，传入的 `input` 就是这一次的用户消息。
- **返回值**：返回 `Omit<TurnResult, "finish" | "entries">`；模型配置、错误归类与用量统计和 `turn()` 共用同一套代码。
- **用途**：给摘要、标题这类一次性调用。问答的“全读”仍是同一个问答 Agent，一开始就拿到全部原文（w00024 t05 决定 13），不走单次请求。

### 7. 模型与缓存

`defineModel(options)` 返回 `{model, apiKey}`：`model` 是 OMP 的模型对象，`apiKey` 是绑定在这个模型实例上的密钥解析。选项：

| 字段 | 必需 | 缺省时 |
|---|---|---|
| `provider`、`api`、`baseUrl`、`id` | 是 | — |
| `name` | 否 | 等于 `id` |
| `apiKeyEnv` | 是 | 不允许缺省；无认证的端点另写 `apiKey: "none"` |
| `reasoning`、`input`（模态） | 否 | 不推理、只收文字 |
| `contextWindow`、`maxTokens` | 否 | 交给 OMP 的 `null`，不猜数 |
| `price`（每百万 token 的输入、输出、缓存读、缓存写单价，币种） | 否 | 未知；交给 OMP 时补零，对外的 `cost` 为 `null` |

- **密钥只认指定的变量**：`apiKeyEnv` 指定的环境变量缺失或为空时，在发请求之前报 `auth` 错误，不让 OMP 退回去用同一 provider 的默认密钥。审查时实测过：自定义地址下 OMP 会把别的 `OPENAI_API_KEY` 发出去。OMP 导入时会从项目、agent、配置目录与家目录的 `.env` 补环境变量，这一点写进文档，不承诺“只读宿主给的变量”。
- **内置目录照旧可用**：`resolveModel` 仍查 OMP 内置目录。
- **`DEEPSEEK_API_BASE` 挪到测试**：harness 去掉这个特例。测试支持（`neuro-book-test-support` 的 `llmTestConfig`）改成用它组出 `defineModel` 的选项，测试规范里这个环境变量照旧有效。
- **缓存键**：创建 OMP Agent 时传会话 id 作 `sessionId`。OpenAI 一类服务据此带上 `prompt_cache_key`，把开头相同的请求路由到同一缓存；这只是路由提示，不保证命中。

### 8. 测试替身

`scriptedStreamFn` 扩成按步骤给出的脚本，每步可以有：
- 内容块（文字、thinking、工具调用）、`stopReason`、用量；
- 可观察的取消屏障；
- 检查这次请求收到的上下文。

替身只替换模型的输出，Agent 调度、schema 校验与会话日志都走真的。provider 层的行为（隐藏重试、密钥、请求地址）用 OMP 公开的 fetch 接缝测，不调用真实模型。

### 备选与取舍

- **Profile 只写工具的 schema，实现缺失时调用报错**：模型会看到一个用不了的工具反复去试，依赖它的提示词照样误导。不取。这个形态适合“实现由宿主在运行时提供”的工具（浏览器侧执行），以后需要时作为一种工具来源再加。
- **保留内置工具常驻，Profile 只能减**：问答这类封闭的 Agent 要逐个列出不要的工具，新增内置工具时还会悄悄多出来。不取：工具只来自 Profile 的声明。
- **收尾工具成功后也回传一句“已记录”**：多一次模型请求，而 OMP 已有干净停止的做法。不取。
- **会话日志继续只存文字**：thinking、签名、provider 回放字段都会丢，同一 provider 的推理与工具历史重放失真。不取。
- **加步数上限**：开发者定不加（见非目标）。

## 影响

- **接口**：
  - `createHarness` 的入参从 `{node, plugins, …}` 改成 `{profile, initial, registry, policy, model, sessionLog, …}`；
  - `turn()` 的结果加字段；
  - 去掉 `harness.use()`；
  - 插件接口去掉 `readFormats`；
  - nb-profile 的默认导出改成 `defineProfile`，`If` 加 `tool` 参数。

  目前只有 nb-harness 自己的测试是调用方，一并改。
- **数据**：
  - nb-session 新增 `agent_message`、`session_snapshot` 两种条目和用量条目，不再写文字的消息与工具条目；
  - 旧日志只读，不能接着运行。
- **安全**：
  - 工具只来自 Profile 的声明，默认不能读写文件；
  - 密钥只从指定的环境变量读，缺了就失败，不退回别的凭据；
  - 密钥不进会话日志与快照。
- **依赖**：不新增依赖，OMP 版本照旧精确锁定 18.2.5。会用到它的公开导出 `TERMINAL_TOOL_RESULT_ABORT_REASON`、`syncContextBeforeModelCall` 与 `@oh-my-pi/pi-catalog/build`。
- **回滚**：改动都在 nb-harness、nb-profile、nb-session 与 neuro-book-test-support 的 `llm.ts` 里，整体回退即可。

## 对 Spec 的预期改动

新建 `docs/specs/agent/harness.md`（`planned`，capability `agent.harness`）：

- **输入**：Profile 定义（含 `initialSchema`）、工具登记表（声明与句柄）、禁用策略、`defineModel` 的选项、会话日志。
- **输出**：
  - 生效工具集的算法与会话快照；
  - 渲染结果就是模型的上下文；
  - `TurnResult` 各字段的含义、错误归类与优先级、用量口径；
  - 收尾工具的规则与结束的时刻；
  - 单次请求。
- **状态**：同一会话同一时刻一次运行；关闭的顺序；恢复会话时校验快照；撤回句柄时在途调用的结算。
- **失败**：`tool_unavailable`、`tool_name_conflict`、`session_incompatible`、`session_busy`、`session_closed`、`profile_has_tools`、`plugin-unavailable`（工具错误），以及 `ErrorKind` 各类。
- **验收**（脚本化流与 fetch 接缝，都不调用真实模型）：
  - 工具集计算；
  - 两次请求之间上下文逐字段保真；
  - 关闭后重开时快照不变，配置改了就拒绝恢复；
  - 收尾工具成功、退回、混在一批里、与取消竞争；
  - 重叠的运行、关闭在途运行；
  - 同一 Profile 两个会话不串状态；
  - 隐藏重试与取消时的用量；
  - 密钥缺失不退回、请求地址来自模型配置。

  真实模型两条：自定义端点的模型；收尾工具结束循环。

## 待定项

无。

## 决策记录

| 日期 | 决策者 | 结论 |
|---|---|---|
| 2026-10-15 | 开发者 | 在 w00024 t05 讨论问答时定：nb-harness 强制使用 Profile；工具由 Profile 选；不加步数上限；加单次请求；工具发现、公共工具、配置追加工具放到后续 Task；插件只能贡献工具。 |
| 2026-10-15 | 开发者 | 草稿要点确认，三个待定项按推荐：插件接口去掉 `readFormats`（改成 `read` 工具的构造参数）；Spec 新建在 `docs/specs/agent/harness.md`；在 w00002 下新开 Task 实施，w00024 t05 等它完成再接问答。 |
| 2026-10-15 | 开发者 | 设计审查（omp 13 条）处理后定两个待定项，都按推荐：收尾工具和别的调用混在一批、或一批里有两个收尾工具时，收尾工具一律退回；用量取看得到的模型消息之和，另给“是否完整”。提案接受。 |
