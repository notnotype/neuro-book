# @notnotype/nb-harness

NeuroBook 的 Agent harness：会话日志、Profile、配置、模型与凭据、工具与审批、压缩，以及把它们装配起来的运行时。它不依赖插件系统，离开应用也能装配、运行与测试；模型通信与 ReAct 循环基于 OMP 包族（`@oh-my-pi/*`）。本文件讲怎么用；行为合同以 [`docs/specs/harness/`](../../docs/specs/harness/) 为准，设计取舍见 [Agent harness 内核](../../docs/proposals/agent-harness-kernel.md)。

## 它做什么、不做什么

做：每个会话一个 OMP `Agent`，外面加上只追加的会话日志、状态机与排队、审批等待与崩溃后的恢复、Profile 渲染、压缩与带序号的事件。使用方拿到的是 `Runtime` 与 `AgentSession` 两个接口。

不做：传输与推送（SSE、WebSocket）、界面、配置文件的读写与分层合成、凭据从哪来（内核不读环境变量）、工具能碰哪些文件（由使用方按方案登记受根约束的提供者：`project://`、`local://` 等）。这些都由使用方决定并以依赖传入。

## 入口

一个模块一个公开入口，包内其它文件是实现细节，不要深导入。

| 入口 | 给什么 | 合同 |
|---|---|---|
| `@notnotype/nb-harness`（同 `./runtime`） | `openRuntime`、`createRuntime(deps)`、`unwrap`、`HarnessError`、`Runtime`、`AgentSession`、事件与结果类型 | [`runtime.md`](../../docs/specs/harness/runtime.md) |
| `./session`、`./session/jsonl` | 会话日志：新建、打开、追加、订阅、回放、分页；内存存储与 JSONL 存储 | [`session.md`](../../docs/specs/harness/session.md) |
| `./profile`、`./profile/loader`、`./profile/jsx-runtime` | `defineProfile`、内置节点组件、主机与注册、从文件加载 Profile | [`profile.md`](../../docs/specs/harness/profile.md) |
| `./config` | 配置快照：校验、缺省值、冻结、替换与通知 | [`config.md`](../../docs/specs/harness/config.md) |
| `./models` | 模型目录与解析、角色选择链、OMP 凭据库与 OAuth | [`models.md`](../../docs/specs/harness/models.md) |
| `./tools` | 工具协议 `defineTool`、来源、审批判定、审批模型、适配成 OMP `AgentTool` | [`tools.md`](../../docs/specs/harness/tools.md) |
| `./compaction` | 压缩方法注册、内置 `soft`、阈值判断 | [`compaction.md`](../../docs/specs/harness/compaction.md) |
| `./builtin`、`./builtin/local` | 内置 `read`、`edit` 与受根约束的本地文件访问 | [`builtin-tools.md`](../../docs/specs/harness/builtin-tools.md) |

共用术语见 [术语表](../../docs/specs/harness/glossary.md)。

## 快速开始

```tsx
/** @jsxImportSource @notnotype/nb-harness/profile */
import {openRuntime, unwrap} from "@notnotype/nb-harness";
import {Appending, defineProfile, History, Input, Prompt, System} from "@notnotype/nb-harness/profile";

const assistant = defineProfile({
    id: "assistant", name: "助手", description: "最小示例", version: 1,
    prompt: () => <Prompt><System>你是简洁的写作助手。</System><History /><Appending><Input /></Appending></Prompt>,
});

const runtime = await openRuntime({
    config: {providers: [{id: "luna", api: "openai-completions", baseUrl: "https://example.com/v1", models: [{id: "gpt-6-luna", contextWindow: 128_000}]}], models: {defaultModel: "luna/gpt-6-luna"}},
    profiles: [assistant],
    apiKeys: {luna: process.env.LUNA_API_KEY!},    // 内核不读环境变量：key 由使用方读出来给它，缺省进一个不落盘的 :memory: 凭据库
});
const session = unwrap(await runtime.createSession({profileId: "assistant"}));
const result = await unwrap(await session.prompt({content: "给一部航海小说起三个书名。"})).done;   // completed | waiting | aborted | failed
runtime.close();
```

- 各方法返回 `{ok: true, value}` 或 `{ok: false, code, detail}`，这是合同，界面与插件按 `code` 分支；脚本里用 `unwrap` 把失败变成带同一个 `code` 的 `HarnessError`。
- `openRuntime` 是便捷入口：配置给对象、Profile 给数组、凭据只给 key、会话存内存。要自己管的就换成自己的：`config` 给 `ConfigStore`，`profiles` 给目录，`credentials` 给 `openCredentials(...)` 的结果，`store` 给 `createJsonlSessionStore(...)`；同步的 `createRuntime(deps)` 要求自己给凭据。
- 一步一步加东西的可运行脚本在 [`examples/steps/`](examples/steps/)：Profile 文件与预览、工具与审批、会话落盘、数据源、压缩、工具结果溢出。全部装配见 [`examples/assemble.ts`](examples/assemble.ts)。

## 写 Profile

Profile 是 TSX，提示词函数是纯函数（只读 `ctx`，不做 I/O）：

```tsx
/** @jsxImportSource @notnotype/nb-harness/profile */
import {Appending, defineProfile, History, Input, Prompt, Reminder, System, Tag, User} from "@notnotype/nb-harness/profile";

export default defineProfile({
    id: "writer", name: "写作助手", description: "读改章节", version: 1,
    tools: ["read", "edit"], compaction: {threshold: {percent: 80}},        // 并进 fields["harness/tools"]、fields["harness/compaction"]
    prompt: (ctx) => (
        <Prompt>
            <System>你是写作助手。</System>
            <History>
                <User once>本会话的任务：{ctx.session.title ?? "未命名"}</User>
            </History>
            <Appending>
                <Input />
                <Reminder id="style" every={5}>保持第三人称。</Reminder>
            </Appending>
        </Prompt>
    ),
});
```

- `ctx` 是运行时在每次调用（与预览）准备 Profile 时给的只读上下文：`session`（`id`、`createdAt`，可选的 `title`）、`turn`（第几轮用户发言，从 1 起）、`now`、`fields`（校验过的字段值）。
- `<System>` 每次请求重新渲染；`<History>` 的子节点是种子，新会话开始时写进会话、每次压缩后再写一次（`once` 的除外）；`<Appending>` 的内容在调用开始时写进会话，`<Input />` 是用户这次的输入。
- 要用外部数据：注册一个数据源与一个读它的节点（见 [`examples/nodes/workspace-tree.ts`](examples/nodes/workspace-tree.ts)）。
- 四个常用设置是一等属性：`tools`（工具 id 列表；请求了运行时没装的工具不算错，预览的 `diagnostics` 会给 `unknown-tool` 警告）、`model`（`{model?, role?}`）、`compaction`、`approval`。它们并进 `fields` 的 `harness/*` 字段；`fields` 留给第三方命名空间的字段（例如插件登记的），`harness/` 下拼错的字段是错误（`invalid-profile`），别的命名空间的未知字段只警告。
- `defineProfile` 只校验并冻结定义、打上标记，不碰文件系统；同一进程里直接把结果放进 `profiles` 就能用。`loadProfile(path)` 用来加载放在别处的 Profile 文件：它就是 `import()` 那个模块（提示词是函数，只有执行模块才拿得到），只认带 `defineProfile` 标记的默认导出，并把文件里对本包的导入解析到本进程已加载的实例，所以文件旁不需要 node_modules；文件全部受信任（加载就是执行）。
- Profile 的设计（主机、准备与渲染两段、三类消息与日志的关系）见讲解页 [`docs/profile-architecture.html`](docs/profile-architecture.html)（浏览器打开）。

## 工具与审批

```ts
import Type from "typebox";
import {defineTool} from "@notnotype/nb-harness/tools";

const lookup = defineTool({
    id: "lookup", description: "查人物设定", parameters: Type.Object({name: Type.String()}), risk: "read",
    execute: async (args, ctx) => ({ok: true, content: `${args.name}：海员，二十六岁。`}),   // ctx.signal、ctx.report(progress)
});
```

- 等级 `read`、`write`、`exec`（缺省 `exec`）；`risk` 也可以是按参数算等级与策略的函数（例如 `shell` 的 `rm` 一律 `ask`）。
- 判定顺序：策略 `deny` → 配置 `deny` → 本会话内允许 → 策略 `ask` → 配置 `allow`/`ask` → 模式表（`always-ask`、`write`、`auto`、`yolo`）。`auto` 把 `write`、`exec` 交给模型角色 `approval` 绑定的审批模型，它拿不准就转问用户。
- 要询问时先问宿主：`openRuntime`/`createRuntime` 的 `approve(request)` 回调拿到工具名、参数、等级与 Profile，返回 `{decision: "approve" | "reject", scope?, note?}` 就照办（会话里记 `decidedBy: "host"`），返回 `null` 才交给用户。
- 交给用户时会话进入 `waiting-user`，`status.pending` 列出事项，`resolve({interactionId, decision, scope, note})` 应答；`scope: "session"` 的批准记在日志里，同会话同工具同等级以后不再问。界面订阅 `interaction` 事件后 `resolve`；命令行那种“停下来问人”的交互用 `invocation.next()`：进入等待或结束时返回（见 [`examples/cli.ts`](examples/cli.ts)）。
- 等待期间进程退出也没关系：下次 `openSession` 从日志恢复成 `waiting-user`，应答后运行时替模型执行那次调用再让它继续。

## 事件与界面

`session.subscribe` 收到带会话内序号的事件：`status`、`invocation`、`queue`、`stream`（助手消息的流式快照）、`tool`、`interaction`、`entry`（每条写入日志的条目，带日志序号）、`compaction`。事件不缓冲、不补发：断线后用 `status` 与日志（`readPage` 分页、`log.subscribe({afterSeq})` 续传）补齐。

运行中再来输入：`prompt(input, {streamingBehavior: "steer"})` 或 `session.steer` 在当前工具批次之后送给模型；`"followUp"` 或 `session.followup` 在本次完成后自动开始下一次调用。`abort()` 中止并把挂起的审批写成拒绝。

`session.preview(input?, {profileId?, model?})` 回答“此刻发起这次调用，模型会收到什么”：走受理检查但不取凭据，Profile 的数据源真的跑，返回系统提示词、种子（新会话）、追加消息、请求消息、可见工具与诊断；不写条目、不发请求、不改状态，任何状态下都能调。`status` 的 `pending` 与 `context` 按日志条目缓存，界面每个事件读一次也不会随日志变长而变慢。

## 模型、凭据与压缩

- 配置里的 `providers` 自建或覆盖服务（`api` 是 OMP 的 Api 名，如 `openai-completions`、`anthropic-messages`）；OMP 内置目录里的服务不必列出。`models.defaultModel`、角色 `roles.items[].modelKey`、Profile 的 `harness/model` 构成选择链。
- 凭据只在 OMP 的凭据库（SQLite，路径由使用方给）或使用方实现的存储里；`setApiKey`、`login(provider, controller)`（OAuth）、`accounts`。`:memory:` 每次打开各一份：关掉再开是另一份空库。
- 压缩：一次调用完成后用量超过阈值就自动压缩（`harness/compaction` 字段），也可以 `session.compact()`；自建服务的模型要在配置里给 `contextWindow`，否则阈值算不出、`compact()` 报 `compaction-failed`；`status.context` 给当前用量与阈值（还没有助手消息报告用量时按回放上下文估算，`source: "estimated"`）。上下文溢出时调用以 `failed`（`overflow: true`）收口，使用方 `compact()` 后 `continue()`。内置 `soft` 是本地模型摘要（两到三次模型调用）；插件可以注册自己的方法。

## 资源与溢出

- 内置 `read`、`edit` 按资源地址 `方案://路径` 工作（[`workspace.resources`](../../docs/specs/workspace/resources.md) 的规则）；方案由使用方用 `createResourceAccess` 登记：目录型提供者是受根约束的 `FileAccess`（`createLocalFileAccess({root, readonly?})`），按会话的方案给工厂（`createSessionDirectories` 给 `local://`）；虚拟提供者只读。内核不预设任何方案。
- 工具结果有统一预算（[`harness.tools`](../../docs/specs/harness/tools.md) 输出 9）：文本超过 50 KiB 时全文进溢出存储（`RuntimeDeps.artifacts`，缺省内存；JSONL 存储旁的目录用 `createJsonlArtifactStore`），上下文里留头尾各 20 KiB 与一句 `read artifact://N` 的回读提示；把 `createArtifactProvider(artifacts)` 登记成 `artifact://` 方案，模型就能按 `offset`、`limit` 回读。阈值经 `limits.toolResult` 调整。

## 测试

- 合同测试与源码同目录（`bun test`），模型的流用 OMP `StreamFn` 脚本化（写法见 [`examples/testing/scripted-model.ts`](examples/testing/scripted-model.ts)），压缩的摘要传输用 `createCompactionRegistry({soft: {completeImpl}})` 脚本化，凭据库用 `:memory:`，不联网、不落盘。
- 真实模型只在 `bun run test:llm` 下运行：服务由仓库根 `.env` 的 `NBOOK_LLM_BASE_URL`、`NBOOK_LLM_API_KEY`、`NBOOK_LLM_MODEL` 描述（[真实模型测试](../../docs/testing/README.md#真实模型测试)），要花钱，先取得授权。
- 示例与命令行见 [`examples/README.md`](examples/README.md)；OMP 的能力与陷阱见 [`docs/omp-capabilities.md`](docs/omp-capabilities.md)；包内规则见 [`AGENTS.md`](AGENTS.md)。
