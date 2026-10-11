# @notnotype/nb-harness

NeuroBook 的 Agent harness：会话日志、Profile、配置、模型与凭据、工具与审批、压缩，以及把它们装配起来的运行时。它不依赖插件系统，离开应用也能装配、运行与测试；模型通信与 ReAct 循环基于 OMP 包族（`@oh-my-pi/*`）。本文件讲怎么用；行为合同以 [`docs/specs/harness/`](../../docs/specs/harness/) 为准，设计取舍见 [Agent harness 内核](../../docs/proposals/agent-harness-kernel.md)。

## 它做什么、不做什么

做：每个会话一个 OMP `Agent`，外面加上只追加的会话日志、状态机与排队、审批等待与崩溃后的恢复、Profile 渲染、压缩与带序号的事件。使用方拿到的是 `Runtime` 与 `AgentSession` 两个接口。

不做：传输与推送（SSE、WebSocket）、界面、配置文件的读写与分层合成、凭据从哪来（内核不读环境变量）、工具能碰哪些文件（由使用方给一个受根约束的 `FileAccess`）。这些都由使用方决定并以依赖传入。

## 入口

一个模块一个公开入口，包内其它文件是实现细节，不要深导入。

| 入口 | 给什么 | 合同 |
|---|---|---|
| `@notnotype/nb-harness`（同 `./runtime`） | `createRuntime(deps)`、`Runtime`、`AgentSession`、事件与结果类型 | [`runtime.md`](../../docs/specs/harness/runtime.md) |
| `./session`、`./session/jsonl` | 会话日志：新建、打开、追加、订阅、回放、分页；内存存储与 JSONL 存储 | [`session.md`](../../docs/specs/harness/session.md) |
| `./profile`、`./profile/loader`、`./profile/jsx-runtime` | `defineProfile`、内置节点组件、主机与注册、从文件加载 Profile | [`profile.md`](../../docs/specs/harness/profile.md) |
| `./config` | 配置快照：校验、缺省值、冻结、替换与通知 | [`config.md`](../../docs/specs/harness/config.md) |
| `./models` | 模型目录与解析、角色选择链、OMP 凭据库与 OAuth | [`models.md`](../../docs/specs/harness/models.md) |
| `./tools` | 工具协议 `defineTool`、来源、审批判定、审批模型、适配成 OMP `AgentTool` | [`tools.md`](../../docs/specs/harness/tools.md) |
| `./compaction` | 压缩方法注册、内置 `soft`、阈值判断 | [`compaction.md`](../../docs/specs/harness/compaction.md) |
| `./builtin`、`./builtin/local` | 内置 `read`、`edit` 与受根约束的本地文件访问 | [`builtin-tools.md`](../../docs/specs/harness/builtin-tools.md) |

共用术语见 [术语表](../../docs/specs/harness/glossary.md)。

## 快速开始

完整、可运行的版本在 [`examples/assemble.ts`](examples/assemble.ts)；下面是骨架：

```ts
import {createRuntime} from "@notnotype/nb-harness";
import {createBuiltinTools} from "@notnotype/nb-harness/builtin";
import {createLocalFileAccess} from "@notnotype/nb-harness/builtin/local";
import {createConfigStore} from "@notnotype/nb-harness/config";
import {openCredentials} from "@notnotype/nb-harness/models";
import {createProfileCatalog} from "@notnotype/nb-harness/profile";
import {loadProfile} from "@notnotype/nb-harness/profile/loader";
import {createJsonlSessionStore} from "@notnotype/nb-harness/session/jsonl";

const config = createConfigStore({
    providers: [{id: "luna", api: "openai-completions", baseUrl: "https://example.com/v1", models: [{id: "gpt-6-luna", contextWindow: 128_000}]}],
    models: {defaultModel: "luna/gpt-6-luna"},
    approval: {mode: "write"},
});
if (!config.ok) throw new Error(JSON.stringify(config.problems));          // 问题一次列全

// 内核不读环境变量，key 由使用方写进凭据库；sqlitePath 用 ":memory:" 就是不落盘的内存库
const credentials = await openCredentials({sqlitePath: "/path/to/state/auth.sqlite", apiKeys: {luna: process.env.MY_KEY!}});
if (!credentials.ok) throw new Error(credentials.detail);

const profile = await loadProfile("/path/to/writer.profile.tsx");
if (!profile.ok) throw new Error(profile.detail);

// host、models、tools、compaction 都可以省略：缺省是空主机、按 config 建的目录（配置 replace 后跟着变）、没有工具、只有 soft 的压缩注册表
const runtime = createRuntime({
    config: config.value,
    profiles: createProfileCatalog([{source: "user", profiles: [profile.value]}]),
    credentials: credentials.value,
    tools: [createBuiltinTools({access: createLocalFileAccess({root: "/path/to/workspace"})})],
    store: createJsonlSessionStore({root: "/path/to/state/sessions"}),      // 目录要先存在
});

const session = await runtime.createSession({profileId: "writer"});
if (!session.ok) throw new Error(session.code);
session.value.subscribe((event) => { /* status、stream、tool、interaction、entry、compaction */ });
const started = await session.value.prompt({content: "把第二行改成带船名的。"});
if (!started.ok) throw new Error(started.code);
for (;;) {
    const step = await started.value.next();                                   // 下一个要处理的点：等审批，或结束
    if (step.kind === "done") break;                                           // step.result.status：completed | waiting | aborted | failed
    for (const item of step.pending) await session.value.resolve({interactionId: item.interactionId, decision: "approve"});
}
console.log(session.value.status.context);                                     // {tokens, window, threshold}：上下文用了多少
```

所有方法都不抛业务失败：返回 `{ok: true, value}` 或 `{ok: false, code, detail}`；只有违反类型约束才会抛出。

## 写 Profile

Profile 是 TSX，提示词函数是纯函数（只读 `ctx`，不做 I/O）：

```tsx
/** @jsxImportSource @notnotype/nb-harness/profile */
import {Appending, defineProfile, History, Input, Prompt, Reminder, System, Tag, User} from "@notnotype/nb-harness/profile";

export default defineProfile({
    id: "writer", name: "写作助手", description: "读改章节", version: 1,
    fields: {"harness/tools": ["read", "edit"], "harness/compaction": {threshold: {percent: 80}}},
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

- `<System>` 每次请求重新渲染；`<History>` 的子节点是种子，新会话开始时写进会话、每次压缩后再写一次（`once` 的除外）；`<Appending>` 的内容在调用开始时写进会话，`<Input />` 是用户这次的输入。
- 要用外部数据：注册一个数据源与一个读它的节点（见 [`examples/nodes/workspace-tree.ts`](examples/nodes/workspace-tree.ts)）。
- 字段由各模块登记：`harness/tools`（工具 id 列表）、`harness/model`（`{model?, role?}`）、`harness/compaction`、`harness/approval`。运行时创建时把它们注册到主机；`harness/` 下拼错的字段是错误（`invalid-profile`），别的命名空间的未知字段只警告。
- Profile 文件可以放在任何目录，`loadProfile(path)` 会把对本包的导入解析过来；文件全部受信任（加载就是执行）。

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
- 询问用户时会话进入 `waiting-user`，`status.pending` 列出事项，`resolve({interactionId, decision, scope, note})` 应答；`scope: "session"` 的批准记在日志里，同会话同工具同等级以后不再问。调用方不用自己盯状态：`invocation.next()` 在进入等待或结束时返回。
- 等待期间进程退出也没关系：下次 `openSession` 从日志恢复成 `waiting-user`，应答后运行时替模型执行那次调用再让它继续。

## 事件与界面

`session.subscribe` 收到带会话内序号的事件：`status`、`invocation`、`queue`、`stream`（助手消息的流式快照）、`tool`、`interaction`、`entry`（每条写入日志的条目，带日志序号）、`compaction`。事件不缓冲、不补发：断线后用 `status` 与日志（`readPage` 分页、`log.subscribe({afterSeq})` 续传）补齐。

运行中再来输入：`prompt(input, {streamingBehavior: "steer"})` 或 `session.steer` 在当前工具批次之后送给模型；`"followUp"` 或 `session.followup` 在本次完成后自动开始下一次调用。`abort()` 中止并把挂起的审批写成拒绝。

## 模型、凭据与压缩

- 配置里的 `providers` 自建或覆盖服务（`api` 是 OMP 的 Api 名，如 `openai-completions`、`anthropic-messages`）；OMP 内置目录里的服务不必列出。`models.defaultModel`、角色 `roles.items[].modelKey`、Profile 的 `harness/model` 构成选择链。
- 凭据只在 OMP 的凭据库（SQLite，路径由使用方给）或使用方实现的存储里；`setApiKey`、`login(provider, controller)`（OAuth）、`accounts`。
- 压缩：一次调用完成后用量超过阈值就自动压缩（`harness/compaction` 字段），也可以 `session.compact()`；自建服务的模型要在配置里给 `contextWindow`，否则阈值算不出、`compact()` 报 `compaction-failed`；`status.context` 给当前用量与阈值。上下文溢出时调用以 `failed`（`overflow: true`）收口，使用方 `compact()` 后 `continue()`。内置 `soft` 是本地模型摘要（两到三次模型调用）；插件可以注册自己的方法。

## 测试

- 合同测试与源码同目录（`bun test`），模型的流用 OMP `StreamFn` 脚本化（写法见 [`examples/testing/scripted-model.ts`](examples/testing/scripted-model.ts)），压缩的摘要传输用 `createCompactionRegistry({soft: {completeImpl}})` 脚本化，凭据库用 `:memory:`，不联网、不落盘。
- 真实模型只在 `bun run test:llm` 下运行：服务由仓库根 `.env` 的 `NBOOK_LLM_BASE_URL`、`NBOOK_LLM_API_KEY`、`NBOOK_LLM_MODEL` 描述（[真实模型测试](../../docs/testing/README.md#真实模型测试)），要花钱，先取得授权。
- 示例与命令行见 [`examples/README.md`](examples/README.md)；OMP 的能力与陷阱见 [`docs/omp-capabilities.md`](docs/omp-capabilities.md)；包内规则见 [`AGENTS.md`](AGENTS.md)。
