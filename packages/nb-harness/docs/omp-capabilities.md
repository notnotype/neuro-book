# OMP 能力上手报告

面向后续开发 agent：`@notnotype/nb-harness` 直接以 OMP 包族（`@oh-my-pi/*`，仓库 `github.com/can1357/oh-my-pi`，作者 Can Bölük / Stencil Labs）为底座。本文件记录**实测**的能力面、最小调用样例、编辑引擎语义与踩坑点。数字均为 2026-09-18 在本机（Windows x64，Bun 1.3.14，OMP 18.2.5）测得。

**2026-10-30 升到 18.14.0**（w00032 t20 第 0 片）：本包依赖的 `pi-agent-core`、`pi-ai`、`pi-catalog`、`pi-natives`、`pi-utils` 一起升级；下表的体积与数量仍是 18.2.5 时的实测。本包撞上的变化：

- `NO_AUTH_SENTINEL` 从 `pi-ai/providers/openai-shared` 移到 `pi-ai/auth-retry`（18.2.7）。
- `EditPolicy` 去掉 `localSandboxRoot`、`vaultRoots`，新增必填的 `maxColumns`、`urlSchemes`、`urlAliasSchemes`、`planWritableRoots`；内部 URL 改由 `EditSession` 的 `resolveUrl` 回调解析。
- 目录从 69 家服务商增到 79 家（新增免密钥的 `local`、`web`，要登录的 `snowflake` 等）；去掉了 `pi-catalog/models.json` 原始导出。
- `baseUrl` 是本机回环地址的 OpenAI 兼容端点被当作本地后端，输出上限按模型自己的 `maxTokens`，不再夹到 `OPENAI_MAX_OUTPUT_TOKENS`（64000）；远端端点照旧夹取（`pi-catalog` 的 `compat/resolve.ts`）。
- 其余 breaking 改动（服务商账号、Judge 改名、`pi-agent-core/utils/yield` 删除、`estimateImageContentTokens` 删除）本包没有用到。


先读这一句：**OMP 全部包以裸 TypeScript 源作为运行入口（`main: ./src/index.ts`），只有 Bun 能执行；没有编译产物供 Node 使用。**

## 1. 包清单与体量

| 包 | 用途 | exports 键 | 文件 / unpacked | 运行时依赖要点 |
| --- | --- | --- | --- | --- |
| `@oh-my-pi/pi-ai@18.2.5` | LLM 传输/流式/用量/认证 | — | 571 / 7.1 MB | `pi-catalog`、`pi-natives`、`pi-utils`、`pi-wire`、`omptype` |
| `@oh-my-pi/pi-catalog@18.2.5` | 模型目录（69 providers / 5,111 models） | — | 361 / 13.9 MB | `pi-utils`（→ `pi-natives`） |
| `@oh-my-pi/pi-agent-core@18.2.5` | agent 循环、工具协议、事件、压缩 | 4 | 81 / 2.0 MB | `pi-ai`、`pi-catalog`、`pi-natives`、`snapcompact`、`pi-wire`、`@opentelemetry/api` |
| `@oh-my-pi/pi-natives@18.2.5` | N-API 原生层（编辑引擎、token 计数、tree-sitter、PTY…） | — | 19 / 1.2 MB + 平台包 | 平台包：**win32-x64 172.2 MB / linux-x64 346.5 MB / darwin-arm64 158.2 MB** |
| `@oh-my-pi/hashline@18.1.5` | hashline 协议库（TS，独立于 agent） | 5 | 47 / 1.4 MB | `pi-utils@18.1.5`、`pi-natives@18.1.5`（注意与族内 18.2.5 错位） |
| `@oh-my-pi/pi-coding-agent@18.2.5` | 完整 CLI + 工具 + 会话 + 集成 | ≈116 | 2676 / 47.3 MB | `puppeteer-core`、12 个 `@opentelemetry/*`、`pi-tui`、`pi-agent-core` |
| `@oh-my-pi/pi-wire@18.2.5` | collab 协议类型/常量（**唯一零依赖**） | 3 | 9 / 1.1 MB（96% 是 NOTICES） | 无 |
| `@oh-my-pi/pi-mnemopi@18.2.5` | SQLite 记忆引擎（remember/recall/beam） | 9 | 137 / 1.9 MB | `pi-ai`、`pi-catalog`、`pi-natives`；embeddings 走 optional peer |
| `@oh-my-pi/snapcompact@18.2.5` | 位图帧上下文压缩 | 3 | 11 / 1.2 MB | `pi-natives` 渲染 |
| `@oh-my-pi/pi-tui@18.2.5` | 终端 UI 框架 | 11 | 830 / 7.4 MB | 8 个族内包 |
| `@oh-my-pi/omp-stats@18.2.5` | 会话统计 dashboard（CLI） | 6 | 150 / 2.6 MB | react / chart.js / tailwind |

许可：全部 **MIT**（`pi-agent-core` 的 LICENSE 原文含 Copyright (c) 2025 Mario Zechner、2025-2026 Can Bölük、2026 Stencil Labs, Inc.；`hashline` / `pi-wire` / `snapcompact` 的 LICENSE 同哈希）。

**体积事实**：任何一个功能包（`pi-ai` / `pi-catalog` / `pi-agent-core` / `hashline`）都会传递依赖 `pi-natives`，因此安装必然带上 ≥158 MB 的平台原生包（linux CI 为 346.5 MB）。只有 `pi-wire` 可以脱离它。

## 2. 能力矩阵

| 能力 | 提供方 | 入口（实测） |
| --- | --- | --- |
| 单轮/流式模型调用 | `pi-ai` | `streamSimple(model, context, options)`、`completeSimple(...)`、`stream(...)`、`complete(...)` |
| 模型目录与定价 | `pi-catalog` | `getBundledModel(provider, id)`、`getBundledProviders()`、`getBundledModels(provider)`、`calculateUsageCost(...)` |
| agent 循环 + 工具协议 | `pi-agent-core` | `new Agent(options)`、`agentLoop(...)`、`AgentTool`、`AgentEvent` |
| 编辑（五模式） | `pi-natives`（引擎在 Rust `crates/pi-edit`） | `EditStore`、`EditSession`、`EditPolicy`、`editDescription(mode)`、`editGrammar(mode)`、`editInspect(mode, argsJson)` |
| token 计数 | `pi-natives` | `countTokens(text, encoding?)`、`Encoding`（10 个编码） |
| 订阅登录 | `pi-ai` | `./oauth`、`./auth-broker`、`./auth-gateway`（本仓库 v1 未使用） |
| 记忆 / 压缩 / TUI / 统计 | `pi-mnemopi` / `snapcompact` / `pi-tui` / `omp-stats` | 见各自包 |

## 3. 最小调用样例（本仓库实测可跑）

### 3.1 直连一轮（不经过 agent）

```ts
import {completeSimple} from "@oh-my-pi/pi-ai";
import {getBundledModel} from "@oh-my-pi/pi-catalog";

const model = getBundledModel("deepseek", "deepseek-flash");   // pi-catalog 的 Model == pi-ai 的 Model
const message = await completeSimple(
    model,
    {systemPrompt: ["只回答一个词。"], messages: [{role: "user", content: "1+1 等于几？"}]},
    {apiKey: process.env.DEEPSEEK_API_KEY},
);
// 实测：344ms 返回；message.stopReason === "stop"；message.usage.input === 21
```

流式版本 `streamSimple(model, context, options)` 返回 `AssistantMessageEventStream`（`AsyncIterable<AssistantMessageEvent>`，另有 `result(): Promise<AssistantMessage>`）。

### 3.2 agent + 工具 + 事件

```ts
import {Agent} from "@oh-my-pi/pi-agent-core";
import {streamSimple} from "@oh-my-pi/pi-ai";

const agent = new Agent({
    initialState: {model, systemPrompt: ["你是助手"], tools: [readTool]},   // 部分 AgentState
    streamFn: streamSimple,                                                 // 默认就是这个
    getApiKey: (m) => process.env.DEEPSEEK_API_KEY,
});
agent.subscribe((event) => console.log(event.type));   // agent_start / turn_start / message_end / tool_execution_* / agent_end
await agent.prompt("读取 a.txt");
```

生命周期是 `prompt` / `continue` / `abort` / `waitForIdle` + `subscribe(AgentEvent)`（没有 `run`/`cancel`）。`AgentPromptOptions` 只有 `toolChoice`——**取消只能走 `agent.abort()`**。

### 3.3 编辑（hashline，本仓库 `edit` 工具的实现方式）

```ts
import {EditSession, EditStore, editDescription} from "@oh-my-pi/pi-natives";

const store = new EditStore();
const tag = store.recordSnapshot(absolutePath, originalText, [1, 2, 3]);   // 登记「已展示的行」
const session = new EditSession(store, policy);                            // policy 见下
session.setArgsJson(JSON.stringify({input: `[a.txt#${tag}]\nPUT 2.=2:\n+BETA\n`}));
session.finish();
const outcome = await session.apply({lspFlush: false}, async (error, request) => {
    // request.op: create | update | delete | move；request.content 为最终文本（delete 时为 undefined）
    await writeFile(request.path, request.content ?? "");
    return {written: request.content ?? ""};
});
session.close();
```

`policy` 的**全部字段**（`EditPolicy`）：`cwd`、`mode`（`replace|patch|apply_patch|hashline|sloppy`）、`allowFuzzy`、`fuzzyThreshold`、`enforceSeenLines`、`blockAutoGenerated`、`planActive`、`localSandboxRoot?`、`vaultRoots?`、`homeDir`、`rawInput`。工具描述与语法分别来自 `editDescription(mode)` 与 `editGrammar(mode)`（Lark，可作为 `customFormat` 交给支持的 provider）。

### 3.4 token 计数

```ts
import {countTokens, Encoding} from "@oh-my-pi/pi-natives";
countTokens("汉字汉字", Encoding.ClaudeV3);   // 7（o200k: 4 / cl100k: 6 / deepseek-v3: 2）
```

## 4. 编辑引擎的实测语义（本仓库已按此实现，改动前先读）

1. **入参形状**：`rawInput: false` 时 `setArgsJson(JSON.stringify({input: "<模式原文>"}))`；`rawInput: true` 时直接传原文。**字段名就是 `input`**（用 `{patch: ...}` 会被拒绝，报错要求首行是 `[PATH#HASH]`）。
2. **apply 会回显编辑后的 hashline 视图**，首行是新内容的新 tag（例如 `[a.txt#F1C1]`），这正是模型下一步要用的锚。
3. **快照记账由引擎负责**：成功 apply 后不要手动 `recordSnapshot` 覆盖新状态（会污染 seen-line 集合）；引擎已经能支持「用回显的新 tag 直接发起下一次编辑」（实测：连续两次编辑均成功）。
4. **未展示行守卫**默认开（`enforceSeenLines: true`）：只读了第 1 行却改第 3 行 → `isError: true`，磁盘不变，错误文本说明该 tag「never displayed」那些行。
5. **伪造 tag**（不在本 session 里）→ `isError: true`、磁盘不变，文本为 `hash #0000 is not from this session. The current file hashes to #B6C1…`。
6. **陈旧 tag + 文件外部漂移** → 引擎**重映射恢复**：把锚点映射到未变的当前行、继续应用，返回 `isError: false` 并在 `files[].warnings` 里带 `Recovered by remapping stale line anchors to unchanged current lines…`。这是 OMP 的自愈语义，本项目**选择接受**；恢复逻辑不可关闭（`EditSession` 无条件构造 `Recovery`）。
7. **`read` 必须输出 `[path#tag]` 头**：模型靠它锚定编辑（错误文案也明确要求「re-read to copy a current [path#tag] header」）。本仓库的 `read` 工具把展示过的行登记进同一个 `EditStore` 并输出该头。
8. 五种模式全部已实现（`crates/pi-edit/src/modes/`）：`replace`、`patch`、`apply_patch`、`hashline`、`sloppy`；错误文本与模型训练一致，**不要改写**。

## 5. OMP 自己的 agent 文档入口

OMP 把仓库 `docs/**/*.md` 在构建期 gzip 进 `dist/docs-index.generated.txt`，通过内部 URL 协议 `omp://<name>` 暴露（**扁平命名，没有 `docs/` 前缀**；含 `tools/`、`toolconv/`、`skills/` 三个子目录）。本机安装实测 **131 篇**；远程等价地址：`https://github.com/can1357/oh-my-pi/blob/main/docs/<同名>.md`。

```text
read omp://                     # 列出全部文档
read omp://sdk.md               # 读某一篇
```

常用入口（均已实测存在）：`sdk.md`、`tools/edit.md`、`tools/read.md`、`tools/manage_skill.md`、`skills.md`、`providers.md`、`models.md`、`cli-reference.md`、`config-usage.md`、`settings.md`、`environment-variables.md`、`extensions.md`、`custom-tools.md`、`hooks.md`、`context-files.md`、`system-prompt-customization.md`、`task-agent-discovery.md`、`porting-from-pi-mono.md`、`tree.md`、`marketplace.md`。

仓库 `docs/`：约 78 篇顶层文档（体量最大的 `provider-quirks.md` 342 KB、`settings.md` 110 KB、`environment-variables.md` 107 KB、`models.md` 44 KB、`providers.md` 30 KB）+ 32 篇 `tools/*.md` + `skills/authoring-*.md`。`@oh-my-pi/pi-coding-agent` 还把约 200 个提示词模板以 `./prompts/*` 子路径随包发布。

## 6. skill 机制（回答「OMP 是否给 agent 提供 skill」）

- `skill://<name>` 指向 `<skills-root>/<name>/SKILL.md`；规范位置 `.agent[s]/skills`（本项目已在用 `.agents/skills/`）。
- 通过 `/skill:<name>` 注入、`manage_skill` 工具写入（需开启 autolearn）；marketplace 插件可携带 `skills/` 目录。
- **没有 `omp skill` CLI 子命令**（见其 `docs/cli-reference.md` 子命令表）。
- OMP 仓库自身 dogfood 了三个 skill：`.omp/skills/{semantic-compression,system-prompts,tool-prompt-optimization}`。

## 7. 陷阱（踩过或实测确认）

1. **裸 TS 入口**：Node 无法 import（`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`，且加 `--experimental-strip-types` 也一样）；只有 Bun（≥1.3.14）或自备 TS loader 的打包器可用。
2. **import 期副作用**：`@oh-my-pi/pi-utils` 的 `env` 模块在**顶层**读取 `$HOME/.env` 与 CWD/configRoot/agentDir 的 `.env`、**删除** `Bun.env` 中不合规的键、注入解析值、重算 OMP 目录（`getAgentDir()` 等）。任何 import 到它的进程都会继承这套行为。
3. **原生包体积**：见“1. 包清单与体量”；CI 安装成本主要是它（linux 346.5 MB）。
4. **不要 import `@oh-my-pi/pi-coding-agent`**：47.3 MB 闭包，含 puppeteer-core 与 12 个 OTel 包；其工具层需要约 110 个成员的 `ToolSession` 宿主上下文。需要工具就自己写（本仓库的 `read`/`edit` 就是范例）。
5. **版本错位**：`hashline@18.1.5` 与其余包 `18.2.5`，且它把 `pi-utils`/`pi-natives` 钉在 18.1.5；混装会出现两份原生包。
6. **`pi-utils.format` 只有** `formatBytes`/`truncate`/`countNewlines` 等小工具，**没有**行/字节预算截断——需要 `read` 输出预算时得自己写（本仓库 `src/text-budget.ts`）。
7. **错误文本即产品行为**：`crates/pi-edit` 的注释明确「error strings are byte-identical to the TypeScript implementation they replace; models are trained on them」，不要翻译或改写。语言政策里的这条例外见 [ADR 0034](../../../docs/adr/0034-language-policy.md) 决策 4。
8. `pi-ai` 的类型入口会把 `AssistantMessageEventStream` 作为**类型**再导出（`export type`），需要**值**（如测试替身）时从子路径取：`@oh-my-pi/pi-ai/utils/event-stream` 的 `createAssistantMessageEventStream()`。
9. **钩子要按实际公开入口验证**（2026-10-15 w00002 t21 计划审查实测）：`syncContextBeforeModelCall` 只在底层 `AgentLoopConfig` 上，`Agent` 不转发同名选项；要在每次模型请求前改上下文，用 `agent.addBeforeModelCallHook`（OMP 随后把 `state.systemPrompt` 同步进请求）加 `transformContext`（替换送模型的消息，不改 Agent 内部历史）。
10. **工具执行完成、结果事件、日志提交是三个边界**：顺序是 `execute` → `afterToolCall` → `tool_execution_end` → 工具结果的 `message_end`。在前面的钩子里等后面事件驱动的写入会环等。要在工具结果后结束循环且不再请求模型，用公开的 `TERMINAL_TOOL_RESULT_ABORT_REASON` 中止（普通 `abort()` 会多一次请求并留下一条 aborted 消息）；`beforeToolCall` 返回 `{block: true}` 的调用不执行，但照样有成对的错误结果。
11. **provider 层重试的用量不交出**：空回复、503、响应前断连等由 provider 内部重试，被丢弃的那次请求的用量不进 Agent 的消息；`onResponse` 只在成功响应后触发，数不到传输层的重试。nb-harness 用流选项里的 `fetch` 计数实际请求来察觉；不支持 `fetch` 选项的 provider 察觉不到。
12. **`getApiKey` 返回空会退回默认密钥**：自定义 `baseUrl` 下也会改用同一 provider 的环境变量（例如 `OPENAI_API_KEY`）。指定的密钥缺失时必须在发请求前失败；无认证的 OpenAI 兼容端点返回公开的 `NO_AUTH_SENTINEL`（`@oh-my-pi/pi-ai/providers/openai-shared`），不带认证头。
13. **`buildModel` 会套目录修正**（2026-10-15 w00002 t21 实现审查实测）：`@oh-my-pi/pi-catalog/build` 按 provider 与 id 应用目录里的单价、分时价、上下文与输出上限、模态修正，宿主显式给的值会被覆盖（例如 `deepseek/deepseek-flash` 的 `maxTokens: 100` 变成 384000）。自定义端点要在构建后用宿主的值盖回去，`cost` 整个替换，并以实际请求参数与费用验证。
14. **错误归类不按文字**：失败的助手消息带 `errorStatus` 与 `errorId`（`@oh-my-pi/pi-ai/error/flags` 的 `Flag` 位）；没有状态码不等于网络故障（SSE 里的内容拦截、模型终态错误也没有状态码，带 `ContentBlocked`、`ProviderFinishError`）； `getApiKey`、上下文变换、`streamFn` 抛出的错误经 Agent 外层捕获后只剩文字，要在调用 OMP 之前或钩子里自己捕获并保留类型。
15. **import 期装上 SIGINT 处理**（2026-10-16 w00024 t05 实测）：`@oh-my-pi/pi-utils` 的 postmortem 在主线程顶层注册 SIGINT，跑完 `postmortem.register` 登记的清理（最多 10 秒）就以 130 退出。宿主自己的 `process.on("SIGINT")` 照样被调用，却拦不住退出，回调里异步的收尾会丢。要在中断时收尾，经 nb-harness 的 `onProcessInterrupt` 登记。
16. **多余的工具参数被悄悄删掉**：工具参数 schema 写了 `additionalProperties: false` 时，OMP 在调用 `execute` 之前删掉模型多写的字段，不报错；要让模型知道哪个参数写错了，schema 不写这一项，由 `execute` 或下游的严格校验报错。
17. **事件是异步投递的**（2026-10-16 w00024 t05 实测）：循环把事件推进流里就往下走，`Agent.subscribe` 的订阅者异步收到。同一批并行工具里最后完成的那条结果，它的 `message_end` 可能晚于下一次请求前的 `addBeforeModelCallHook`；按订阅到的消息渲染上下文时会漏掉它，真实服务会因为工具调用没有结果而拒绝请求。`transformContext` 拿到的是循环自己的完整上下文，在那里等落后的消息。

## 8. 本仓库的使用位置

| 能力 | 使用点 |
| --- | --- |
| 模型（目录与自定义端点 `buildModel`）、绑定在实例上的密钥 | `packages/nb-harness/src/model.ts` |
| 会话：上下文替换、事件落盘、收尾工具、运行锁 | `packages/nb-harness/src/harness.ts`、`src/context.ts` |
| 错误归类与用量 | `packages/nb-harness/src/run-result.ts` |
| 工具登记表、生效工具集、交给 OMP 的桥 | `packages/nb-harness/src/tools/registry.ts`、`effective.ts`、`bridge.ts`、`builtin.ts` |
| 单次请求 | `packages/nb-harness/src/complete.ts` |
| read（含 `[path#tag]` 头与快照登记） | `packages/nb-harness/src/tools/read.ts` |
| edit（`EditSession` 薄层 + 写回 + 写前确认） | `packages/nb-harness/src/tools/edit.ts` |
| SSE 序列化 / 写入器 | `packages/nb-harness/src/sse.ts`、`src/sse-writer.ts` |
