---
schema: nbook.spec/v1
kind: behavior
status: planned
capability: agent.harness
owners:
  - nb-harness
  - nb-profile
  - nb-session
---

# Agent harness：Profile、工具与一次运行

## 目标与非目标

给宿主（nb-story 的问答、以后 NeuroBook 的 Agent 运行时）一个只经 Profile 运行的 Agent：Profile 声明它要哪些工具、上下文怎么组成；harness 按登记表与用户的禁用策略算出这个会话能用的工具，按 Profile 渲染出交给模型的全部上下文，跑一次带工具的循环或一次不带工具的请求，把停止原因、出错、用量与收尾工具交出的结果说清楚，并把一切写进可以恢复的会话日志。

明确不承诺：

- 不做工具发现（只列名字、按需取 schema）；生效工具集里的工具全部直接交给模型。
- 没有“对所有 Profile 生效”的公共工具（MCP 一类）；配置不能给 Profile 追加工具；没有工具审批。
- 没有步数上限与失控保护。
- 压缩见 [`compaction.md`](compaction.md)。
- 不解析模型角色（role）：宿主给出解析好的模型。
- 用量是下界，不是账单：见输出 11。
- 一个会话日志同一时刻只由一个进程里的一个会话写。

## 术语与参与者

- **宿主**：调用 harness 的程序，负责读配置、建登记表、给出模型与会话日志。
- **Profile**：一个 Agent 的完整定义：身份与版本、初始输入的 schema、需要的工具、上下文。
- **工具声明**：可复制、可冻结的部分：稳定 id（带命名空间，如 `builtin.read`、`story.search`）、给模型看的名字、说明、参数 schema、提供方与版本、是否收尾工具。
- **调用句柄**：可撤回的部分：每次调用时由它取得工具的实现。
- **登记表**：内置工具与插件贡献的工具（声明加句柄）的集合。插件只能贡献工具。
- **禁用策略**：宿主给出的禁用清单，可以全局，也可以按 Profile。
- **生效工具集**：一个会话里模型能看到、能调用的工具。
- **会话**：绑定一个会话日志的一串运行；**会话快照**是它的第一条条目。
- **运行**：一次 `turn()`（带工具的循环，直到模型停下或收尾）或一次 `complete()`（不带工具的单次请求）。
- **收尾工具**：声明为 `finish` 的工具；调用成功即结束这次运行，参数就是结果。

## 输入与前置条件

### Profile

```ts
defineProfile({
    manifest: {key: string; version: string; name: string; description: string};
    initialSchema: TSchema;                       // TypeBox；没有初始输入时写 Type.Object({})
    tools: ToolSet;                               // toolset(ref, optional(ref), 自带工具…)
    context: (ctx: {initial; tools: ReadonlySet<ToolId>; history}) => ProfileNode;
});
```

- `tools` 的每项是工具引用（只含稳定 id 与参数类型，不引入实现）、`optional(引用)`，或 Profile 自带的工具（声明与实现写在 Profile 里）。不加 `optional` 的是必需工具。
- `context` 可以用 `<If tool="<工具 id>">`：工具在生效工具集里时才渲染其中的内容，放在 `System` 里同样生效。

### 工具的执行上下文

工具实现的 `execute` 收到 `{sessionId, initial, signal}`：本会话的 id、校验过的初始输入、这次调用的中止信号。会话相关的数据只从这里取。

### 模型

`defineModel(options)` 返回 `{model, apiKey}`，后者是绑定在这个模型实例上的密钥解析：

| 选项 | 必需 | 缺省时 |
|---|---|---|
| `provider`、`api`、`baseUrl`、`id` | 是 | — |
| `name` | 否 | 等于 `id` |
| `apiKeyEnv` | 是（或写 `apiKey: "none"` 表示端点不要认证） | — |
| `reasoning`、`input`（模态） | 否 | 不推理、只收文字 |
| `contextWindow`、`maxTokens` | 否 | 不设限 |
| `price`：每百万 token 的输入、输出、缓存读、缓存写单价与币种 | 否 | 单价未知 |

宿主也可以给内置目录里的模型（`resolveModel("provider/id")`）：密钥按 OMP 的取法从环境变量取（目录登记的变量，加上 OMP 另认的来源，例如 anthropic 的 `ANTHROPIC_OAUTH_TOKEN`），都没有值时同输出 18 以 `auth` 结束，只有不要认证的服务商（下面的 `keyless`）不带密钥请求；单价按目录，目录单价全为 0 时当未知。

宿主自定义的模型没写的上下文、最大输出、推理与图片支持，可以先用 `suggestFromCatalog(modelId)` 按模型名在目录里找参照补上，再交给 `defineModel`；单价不补。

### 模型目录

给宿主画选模型的界面用，只读：

- `listCatalog()`：OMP 内置目录的全部服务商，每家 `{id, name, access, keyEnvs, models}`；每个模型 `{id, name, api, contextWindow, maxTokens, reasoning, efforts, images, price}`，`efforts` 是能选的推理档（不支持推理时为空），`price` 未知时为 `null`。
- `access` 说的是只认环境变量的宿主能不能用这家，按顺序取第一个符合的：`keyless`（不设密钥也能请求）、`login`（要登录 OMP 拿会过期的令牌；宿主不读登录态，只有它的变量有值时能用）、`key`（设环境变量就能用）、`unsupported`（云厂商凭据链，或目录没写认证方式）。
- `keyEnvs`：目录登记的密钥变量，按 OMP 查找的顺序；OMP 另认的来源不在其中。
- `providerKeyReady(id)`：这家在当前进程环境里有没有可用的密钥（云凭据链的占位不算）。它读进程环境与 OMP 补进来的 `.env`，宿主要“启动时”的状态就在启动时取一次。
- 推理档是 `minimal`、`low`、`medium`、`high`、`xhigh`、`max`；`clampEffort(model, effort)` 把选的档往下夹到模型支持的档，不支持推理的模型得到“不发”。`thinkingLevel` 给了模型不支持的档时由 OMP 拒绝，所以宿主先夹。

### 会话

```ts
createHarness({profile, initial?, registry, policy, model, sessionLog}): Promise<Harness>
harness.turn(input: string, {signal?}): Promise<TurnResult>
harness.subscribe(listener): () => void
harness.close(): Promise<void>
complete({profile, initial, input, model, signal?}): Promise<CompleteResult>
```

| 会话日志 | `initial` | 含义 |
|---|---|---|
| 空 | 必须给，按 `initialSchema` 校验 | 新会话 |
| 以会话快照开头 | 不给 | 恢复会话 |
| 没有会话快照的旧日志 | — | `session_incompatible` |

## 输出与可观察行为

### 工具

1. **生效工具集。** 新会话在写下任何条目之前算出：Profile 的必需工具，加上可选工具中已登记且未被禁用的。必需工具没登记或被禁用时得到 `tool_unavailable`，错误里写明 Profile、工具 id、原因（未登记或已禁用）与提供方；两个工具给模型看的名字相同时得到 `tool_name_conflict`。两种情况都不写会话日志。
2. **只有声明的工具。** 模型看到的工具正好是生效工具集，不多不少；harness 自带的工具（例如读文件）没被 Profile 声明时，模型看不到也调不到。
3. **会话快照。** 新会话的第一条条目是快照：Profile 的 key 与版本、校验后的 `initial`、生效工具集里每个工具的声明。整个会话按快照里的工具运行，登记表或禁用策略之后的变化不影响它。
4. **恢复会话。** 从快照重建工具声明，再向登记表取各工具的调用句柄；Profile 的 key 或版本与快照不同、或某个工具的声明（schema、提供方版本）与快照不一致、或必需工具已不在登记表里时，得到 `session_incompatible`，不换成当前配置继续。
5. **会话之间不串数据。** 同一个 Profile 同时服务两个会话时，每个工具调用拿到的执行上下文是自己会话的 `sessionId` 与 `initial`。
6. **撤回。** 会话运行中某个工具的句柄被撤回后：之后对它的调用得到工具错误 `plugin-unavailable`，运行继续；在途的调用收到中止信号，这次调用在会话日志里恰有一条结果（中断），之后才到的完成结果丢弃。等待在途调用的时长由宿主决定。

### 上下文

7. **渲染结果就是上下文。** 每次模型请求前，这次运行之前写下的条目都已写进会话日志；交给模型的系统提示词与消息正是 Profile 按会话日志渲染的结果。
8. **历史保真。** 会话日志存模型消息的原样：内容块的顺序、thinking 与签名、provider 回放字段、工具调用与工具结果（含工具名与结构化结果）。渲染时工具调用与它的结果总在一起；关闭再恢复后，同一个模型收到的历史与关闭前逐字段相同。同一会话换了服务商或接口时，日志照样不改，发给新模型的历史由 OMP 按目标转换：别家的签名思考去掉或转成文字，Responses 的原生回放字段只在同一模型时使用。
9. **前缀稳定。** 同一会话的两次模型请求之间，已经交给模型的历史只追加、不改写。请求带上会话 id 作为前缀缓存的路由键（provider 支持时）。

### 一次运行的结果

10. **`TurnResult`。**

    ```ts
    type TurnResult = {
        stopReason: "stop" | "finished" | "length" | "error" | "aborted";
        text: string;
        finish: {tool: ToolId; args: unknown} | null;
        error: {kind: ErrorKind; status: number | null; message: string} | null;
        usage: Usage;
        entries: SessionEntry[];
    };
    type ErrorKind = "network" | "rate_limit" | "auth" | "quota" | "context_overflow" | "provider" | "local";
    type Usage = {input: number; output: number; cacheRead: number; cacheWrite: number; cost: number | null; complete: boolean};
    ```

    - `stop`：模型说完；`text` 是最后一段助手文字。`finished`：收尾工具结束了运行（输出 13），`finish` 有值。`length`：输出达到上限被截断，`text` 是截断的文字。`error`：出错，`error` 有值。`aborted`：调用方的 `signal` 中止，或会话被关闭。
    - `entries` 只含这次运行写下的条目。
    - 运行期的出错按 `stopReason: "error"` 返回，不抛异常。
11. **用量。** `usage` 是这次运行里交到 Agent 手上的模型消息的用量之和。发生过取消、或察觉到 provider 层重试（被丢弃的那次请求的用量拿不到）时，`complete` 为 `false`，调用方应把它当作下界（“至少”）。`cost` 在模型的单价未知时为 `null`；单价已知、计量不完整时 `cost` 照算，`complete` 为 `false`。
12. **错误归类。** `kind` 由 provider 返回的状态码与错误标记决定，不按错误文字判断，优先级从上到下：余额或配额用尽为 `quota`（网关常以 403 回余额不足，同时带认证失败的标记，仍归 `quota`）；认证失败或 401、403 为 `auth`；429 为 `rate_limit`；上下文超长为 `context_overflow`；网络中断与网关超时为 `network`；其余 provider 错误为 `provider`。harness 自己的步骤出错：密钥缺失为 `auth`；渲染 Profile、写会话日志失败为 `local`。

### 收尾工具

13. **成功即结束。** 一条助手消息里只调用了一个收尾工具、参数通过 schema 校验且 `execute` 返回成功时，这次运行结束：`stopReason` 为 `"finished"`，`finish` 是参数；工具结果写进会话日志（调用与结果成对），之后不再请求模型。
14. **校验失败就退回。** `execute` 返回工具错误时，按普通工具出错处理：结果交给模型，运行继续。
15. **混在一批。** 同一条助手消息里收尾工具与别的工具一起被调用，或者有两个收尾工具时，收尾工具都不执行，各得到工具错误“收尾工具要单独调用”；别的工具照常执行，运行继续。
16. **以写下结果为准。** 收尾工具的结果写进会话日志的那一刻运行算结束：之前 `signal` 中止，结果是 `aborted`；之后的中止不改变 `finished`。写会话日志失败时结果是 `error`（`local`），不是 `finished`。

### 单次请求

17. **`complete()`。** 只接受不声明任何工具的 Profile，否则得到 `profile_has_tools`；按 Profile 渲染系统提示词，`input` 作为唯一一条用户消息，请求一次模型；不读写会话日志。结果是 `Omit<TurnResult, "finish" | "entries">`，`stopReason` 不会是 `"finished"`；错误归类与用量同输出 11、12。

### 模型与密钥

18. **只用指定的密钥。** 模型用 `apiKeyEnv` 指定的环境变量作密钥；它缺失或为空时，在发出任何请求之前以 `error.kind: "auth"` 结束运行，不改用别的凭据（同一 provider 的默认密钥、其他环境变量）。请求发往模型配置里的 `baseUrl`。密钥不写进会话日志、快照与结果；provider 的错误正文回显了这次请求所用的密钥时，写进日志与结果之前替换成固定的遮盖文字，错误归类与状态码不变；交给订阅者（`subscribe`）的每个事件里的消息快照与消息列表同样遮盖。

### 进程中断

19. **（planned）中断时的收尾。** 导入 nb-harness 的进程收到 SIGINT 时，经 `onProcessInterrupt(callback)` 登记的回调都会被调用，进程等它们返回的 Promise 完成（最多约 10 秒）后以 130 退出；宿主自己注册的 SIGINT 处理拦不住这次退出。正常退出时不调用回调；返回的函数解除登记。
20. **终止时由宿主收尾。** 长驻的宿主经 `onProcessTermination(callback)` 登记：进程收到 SIGINT、SIGTERM 或 SIGHUP 时调用 `callback(信号)`，它返回的 Promise 完成后进程以它给的退出码退出（不再以 128 加信号号退出）。同一次清理里别的登记与它同时开始，它完成时还没完成的会被截断，所以只在进程里只有这一处要慢慢收尾时用（`nbstory serve`）。正常退出时不调用；返回的函数解除登记。
21. **相邻用户消息合并。** 会话历史里相邻的几条用户消息（例如 nb-story 问答里改阅读位置时写的提醒与随后的问题，是两条独立持久的消息），发给模型的上下文里合并成一条：文字块之间空一行，非文字块按原顺序保留。只改这一次请求的上下文，不改会话里的消息、日志与订阅者看到的事件；有的端点（例如 DeepSeek 的 reasoner、个别网关）拒绝连续的 user 消息，OMP 的各传输层都原样转发。助手消息、工具结果隔开的用户消息不合并。

## 状态与转换

| 状态 | 进入 | 可调用 |
|---|---|---|
| 空闲 | `createHarness` 成功；一次运行结束 | `turn`、`subscribe`、`close` |
| 运行中 | `turn` 开始 | `subscribe`、`close`；`turn` 得到 `session_busy` |
| 关闭中 | `close` 开始 | 都得到 `session_closed`（`close` 再调用等同一次关闭完成） |
| 已关闭 | 关闭完成 | 都得到 `session_closed` |

时序与寿命：

- 同一会话同一时刻只有一次运行。运行中再调 `turn()`，在读历史、渲染、写会话日志之前就得到 `session_busy`，不排队，不影响在途的运行。
- `turn()` 的 `signal` 只中止它自己的运行。
- `close()` 先拒绝新的调用，再中止在途运行，等它结束、它的条目全部写进会话日志，最后解除订阅；`close()` 完成时会话日志里没有未配对的工具调用。
- 订阅在 `close()` 完成前一直收到事件；`subscribe` 返回的函数解除后不再收到。
- `complete()` 与会话无关，可以和任何会话的运行同时进行。

## 副作用与数据

- 会话日志（nb-session）新增条目：`session_snapshot`（第一条）、`agent_message`（模型消息与工具结果的原样）、用量（每条模型消息之后）、运行结束（出错、取消时记原因）。harness 不再写只有文字的消息、工具调用与工具结果条目。
- 只有文字条目的旧日志可以读，不能恢复为会话（`session_incompatible`）。
- 快照与条目里没有密钥；`initial` 原样写进快照，宿主不要把秘密放进初始输入。

## 失败与恢复

| 编号 | 码 | 何时 | 调用方怎么办 |
|---|---|---|---|
| F1 | `tool_unavailable` | 新建或恢复会话时必需工具未登记或被禁用（抛出） | 登记或启用该工具，或换 Profile |
| F2 | `tool_name_conflict` | 两个工具给模型看的名字相同（抛出） | 改名或去掉其一 |
| F3 | `invalid_initial` | `initial` 不合 `initialSchema`，或恢复会话时给了 `initial`（抛出） | 改正初始输入 |
| F4 | `profile_invalid` | Profile 定义不合法（抛出） | 改正 Profile |
| F5 | `session_incompatible` | 恢复会话时 Profile 版本或工具声明与快照不一致，或日志没有快照（抛出） | 开新会话 |
| F6 | `session_busy` | 运行中再调 `turn`（抛出） | 等这次运行结束 |
| F7 | `session_closed` | 会话关闭中或已关闭（抛出） | 新建或恢复会话 |
| F8 | `profile_has_tools` | `complete()` 收到声明了工具的 Profile（抛出） | 用不带工具的 Profile |
| F9 | `plugin-unavailable` | 调用的工具句柄已撤回（工具错误，交给模型） | 无需处理；模型可改用别的工具 |
| F10 | `ErrorKind` 各类 | 运行期出错（`stopReason: "error"` 返回） | 按 `kind` 提示用户；`network`、`rate_limit` 可以稍后重试 |

## 边界与兼容

- 公开接口是 `@notnotype/nb-harness` 的入口导出、`@notnotype/nb-profile` 的 `defineProfile` 与节点、`@notnotype/nb-session` 的条目类型。
- 底座是 OMP 包族，版本精确锁定；升级 OMP 时用本 Spec 的验收复核。
- 信任边界：工具实现在宿主进程内运行，harness 不隔离它们；会话日志与密钥都在宿主本机。

## 验收与 Smoke

以下都用脚本化的模型输出或 provider 的 fetch 接缝，不调用真实模型：

1. **封闭的问答 Agent。** Profile 声明三个查询工具（一个可选、未登记）与一个收尾工具：模型看到的工具是三个（输出 1、2）；`<If tool>` 包着的可选工具说明不在系统提示词里；第一次收尾因校验失败被退回，模型第二次单独提交后 `finished`，之后没有模型请求（输出 13、14）；同一批里收尾工具与查询工具一起被调用时，收尾工具被退回、查询工具照常返回（输出 15）。
2. **关闭与恢复。** 跑完两轮带工具的运行后关闭再恢复：恢复后第一次请求收到的历史与关闭前逐字段相同（输出 8）；把某个工具的 schema 改了再恢复，得到 `session_incompatible`（输出 4）。
3. **重叠与关闭。** 第一次运行挂在模型请求上时再调 `turn`：得到 `session_busy`，会话日志里没有第二次的输入；随后 `close()`：第一次运行以 `aborted` 结束，日志里没有未配对的调用。
4. **撤回在途调用。** 工具执行中撤回它的句柄：这次调用记一条中断结果，迟到的完成被丢弃，之后的调用得到 `plugin-unavailable`，运行继续（输出 6）。
5. **两个会话。** 同一 Profile 以不同 `initial` 开两个会话并行运行，各自的工具调用拿到各自的 `initial`（输出 5）。
6. **用量与重试。** provider 第一次返回空回复、第二次正常：`usage` 只含第二次，`complete` 为 `false`；单价未知时 `cost` 为 `null`（输出 11）。
7. **密钥不外泄。** `apiKeyEnv` 指向的变量未设、另有同一 provider 的默认密钥时：运行以 `auth` 结束，没有任何请求发出（输出 18）。端点回 401、错误正文里带着收到的密钥时：运行以 `auth` 结束，`error.message` 与会话日志里都没有这个密钥（输出 18）。
8. **模型目录。** 对仓库锁定的 OMP 版本，全部服务商的 `access` 与 `keyEnvs` 与快照一致；目录模型的上下文、推理档来自目录，单价全为 0 的 `price` 为 `null`、`priceKnown` 为假；多变量的服务商任一变量有值即“有值”，都没有时错误列出全部变量；`keyless` 的服务商没有值时不报错；`clampEffort` 往下夹到支持的档。

Smoke：用真实模型跑两条：自定义端点（`defineModel`）的一次 `turn`；带收尾工具的 Profile 以 `finished` 结束。缺凭据时跳过并记为未验证。

## 证据

- 批准依据：[nb-harness：Profile 定义、工具三层与一次运行的结果](../../proposals/nb-harness-profile-and-tools.md)（accepted，2026-10-15）。
