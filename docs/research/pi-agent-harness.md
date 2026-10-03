# Pi Agent Harness 使用研究

## 背景

当前 Neuro Book Agent 系统仍大量依赖 LangChain message、provider adapter、thread runner 和自定义 profile/runtime glue。用户自定义 profile、thread 历史、message 序列化反序列化、provider 差异处理已经形成较高维护压力。Pi 仓库已经 clone 到本地 `.agent/workspace/pi`，本研究优先基于本地源码与文档，辅以 GitHub issue/PR 搜索，判断它是否适合作为下一轮 Agent 大重构的基础。

## 包结构

Pi 是一个 monorepo，根 README 把三个核心包分得很清楚：

- `@earendil-works/pi-ai`：统一多 provider LLM API。
- `@earendil-works/pi-agent-core`：agent runtime，负责工具调用和状态管理。
- `@earendil-works/pi-coding-agent`：完整 CLI coding agent，包含 sessions、skills、extensions、TUI、SDK、RPC 等上层 harness。

对 Neuro Book 来说，不建议直接把 `pi-coding-agent` 整个 CLI 嵌进来。更稳的切法是：

- 先用 `pi-ai` 替换 LangChain provider/message 边界。
- 再评估用 `pi-agent-core` 或它的新 `AgentHarness` 承接 loop、tool execution、state/event。
- `pi-coding-agent` 作为设计参考和 SDK/ResourceLoader/SessionManager 的可选来源，不直接照搬终端 UI。

## pi-ai

`pi-ai` 的核心价值是把 provider 差异收敛到统一的 `Context`、`Message`、`Tool`、`AssistantMessageEvent` 上。

### Message 模型

`packages/ai/src/types.ts` 定义的基本消息只有三类：

- `UserMessage`
- `AssistantMessage`
- `ToolResultMessage`

Assistant content 是块结构：

- `{ type: "text"; text }`
- `{ type: "thinking"; thinking }`
- `{ type: "toolCall"; id; name; arguments }`

ToolResult content 也支持 text/image block。这个模型比 LangChain 的 `BaseMessage + additional_kwargs + tool_calls + usage_metadata` 更适合持久化，因为字段都是普通 JSON 结构，Pi 文档也明确展示了 `Context` 可以直接 `JSON.stringify()` 后保存。

### Provider 与 streaming

`stream(model, context, options)` 返回 `AssistantMessageEventStream`，事件包括：

- `text_start` / `text_delta` / `text_end`
- `thinking_start` / `thinking_delta` / `thinking_end`
- `toolcall_start` / `toolcall_delta` / `toolcall_end`
- `done` / `error`

重要细节：文档强调不同 content block 的事件不保证连续，消费者必须用 `contentIndex` 关联。这点比我们当前对 LangChain chunk 的 provider-specific 修补更明确。

### Tool schema

Pi 使用 TypeBox 定义 tool schema，而不是 Zod。`Tool` 形状大致是：

```ts
interface Tool<TParameters extends TSchema = TSchema> {
    name: string;
    description: string;
    parameters: TParameters;
}
```

`validateToolCall(tools, toolCall)` 会按 TypeBox schema 校验 tool call 参数。`pi-agent-core` 的 `AgentTool` 进一步包含：

```ts
interface AgentTool<TParameters extends TSchema = TSchema, TDetails = any> extends Tool<TParameters> {
    label: string;
    prepareArguments?: (args: unknown) => Static<TParameters>;
    execute: (
        toolCallId: string,
        params: Static<TParameters>,
        signal?: AbortSignal,
        onUpdate?: AgentToolUpdateCallback<TDetails>,
    ) => Promise<AgentToolResult<TDetails>>;
    executionMode?: "sequential" | "parallel";
}
```

迁移影响：Neuro Book 当前大量 profile InputSchema 用 Zod，tool DTO 也常用 Zod。直接全面换 TypeBox 会动得很大。更现实的第一阶段是：

- Agent/profile input 仍可保留 Zod。
- provider/tool-call 层新增 Zod -> JSON Schema/TypeBox 适配，或局部把 tool schema 迁到 TypeBox。
- 新 Agent core 内部消息改用 Pi message block，不再持久化 LangChain message。

### Thinking / usage / provider compatibility

Pi 已经把 reasoning/thinking 作为一等能力：

- model metadata 有 `reasoning` 和 `thinkingLevelMap`。
- simple options 支持 `reasoning: "minimal" | "low" | "medium" | "high" | "xhigh"`。
- thinking block 是标准 content block，不需要藏在 `additional_kwargs.reasoning_content`。

Usage 也在 `AssistantMessage.usage` 内直接归一化：

```ts
interface Usage {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    totalTokens: number;
    cost: { input; output; cacheRead; cacheWrite; total };
}
```

这正好对应我们现在在 `server/utils/model.ts` 里反复修 DeepSeek/OpenAI-compatible/Gemini thinking 与 usage 的痛点。

## pi-agent-core

`pi-agent-core` 是最接近 Neuro Book Agent runtime 的包。

### AgentMessage vs LLM Message

它把 app 内部消息和 LLM 消息分开：

```text
AgentMessage[] -> transformContext() -> AgentMessage[] -> convertToLlm() -> Message[] -> LLM
```

这条边界很适合 Neuro Book。我们可以把 UI-only、workspace state、profile preview、thread metadata、tool timeline 等都作为 app-level message 或 session entry 存在，只在 provider 请求前通过 `convertToLlm` 生成 LLM 看得懂的消息。

### Loop 事件

Agent loop emits：

- `agent_start` / `agent_end`
- `turn_start` / `turn_end`
- `message_start` / `message_update` / `message_end`
- `tool_execution_start` / `tool_execution_update` / `tool_execution_end`

这和 Neuro Book 前端 SSE event model 很契合。当前 `ThreadRunCoordinator` 里很多职责可以拆成：

- Pi event -> Neuro Book SSE event adapter。
- Pi message -> DB/session message codec。
- Tool execution hook -> 现有 tool registry。
- Profile prepare -> `systemPrompt + messages + tools` 的 turn snapshot。

### Tool execution

Pi 支持：

- 默认 parallel tool execution。
- 单个 tool 可声明 `executionMode: "sequential"`。
- `beforeToolCall` 可阻止工具执行。
- `afterToolCall` 可改写工具结果或设置 `terminate`。

这比我们当前手动处理 tool call batch、callIndex、并发回填、tool result 顺序更清楚。需要注意 Pi 的 parallel 语义是“执行完成事件按完成顺序，持久化 toolResult message 按 assistant source order”，这个设计可以直接借鉴。

### Steering / follow-up

Pi 原生区分：

- `steer`：agent 工作中输入，当前 assistant turn 和工具执行完成后插入。
- `followUp`：agent 完全停下后再执行。

这可以替代我们现在继续输入、interrupt、resume 之间较混乱的状态边界。它也适合 Novel IDE 中“用户在同一线程继续补充要求”的交互。

## AgentHarness

`packages/agent/docs/agent-harness.md` 是重构时最值得细读的文档。它不是简单 Agent class，而是更完整的编排层：

- session persistence
- runtime configuration
- resource resolution
- operation locking
- extension-facing mutation semantics
- save point
- pending session writes
- turn snapshot

关键理念是把状态分成：

- harness config：最新配置，影响未来 turn。
- turn snapshot：单次 LLM 请求使用的冻结快照。
- session：持久化 entries。
- pending session writes：忙碌期间接受但延后 flush 的写入。

这正好命中我们现在“旧 thread 是否用新 profile”“运行中改 profile/工具/模型是否影响当前请求”“message 持久化顺序”的长期问题。

不过文档也说明 `AgentHarness` 仍在演进，很多 TODO 还没完成，例如：

- generic hook/event extension mechanism 未完成。
- semi-durable recovery 仍是 planned。
- lifecycle hardening suite 仍是 planned。
- model registry 设计仍是 planned。

结论：如果要立刻落地，`AgentHarness` 可以作为架构蓝图和部分源码参考；是否直接依赖它，需要先做 spike。若直接依赖，应锁定版本，并接受 upstream API 仍在变化。

## Session 格式

`pi-coding-agent` 的 session 是 JSONL tree：

- 第一行是 session header。
- 后续 entry 通过 `id` / `parentId` 形成树。
- 支持 branch、fork、clone、compaction、label、model_change、thinking_level_change、custom entry。
- `buildSessionContext()` 从当前 leaf 回溯到 root，构造 LLM context。

它的设计比 Neuro Book 当前 thread/message tree 更明确，尤其适合：

- 同一个 thread 内分支试验。
- 不破坏历史的 context compaction。
- 用 custom entry 持久化 app/harness 状态。
- 将 tool/UI/extension 状态和 LLM message 分开。

迁移时不一定要直接采用 Pi 的文件 session；Neuro Book 仍可用 Prisma/DB。但 entry tree + append-only reducer 的语义值得照搬。

## pi-coding-agent SDK 与 RPC

如果我们想先做小规模集成，SDK 和 RPC 都可用。

### SDK

`createAgentSession()` 可创建可编程 session：

- 自定义 `ResourceLoader`
- 自定义 tools
- 自定义 system prompt
- 自定义 skills/prompts/context files
- 自定义 `SessionManager`
- 订阅 streaming events

这适合在 Neuro Book server 进程内做 spike。

### RPC

`pi --mode rpc` 通过 stdin/stdout JSONL 通信。它适合非 Node 进程或想要进程隔离的集成。对 Neuro Book 而言，RPC 可以作为早期验证手段，但长期最好用 SDK/core 包，避免再引入一个 CLI 子进程生命周期。

## Skills 与可直接使用的指导

Pi 明确支持 Agent Skills 标准，并且可以复用其他 harness 的 skills。

### Pi skills 机制

本地文档 `packages/coding-agent/docs/skills.md` 说明：

- Pi 实现 Agent Skills standard。
- 启动时只把 skill name/description 放进 system prompt。
- 任务匹配时，agent 用 `read` 加载完整 `SKILL.md`。
- Skill 可放在：
  - `~/.pi/agent/skills/`
  - `~/.agents/skills/`
  - `.pi/skills/`
  - `.agents/skills/`
  - package 的 `skills/`
  - settings 的 `skills` 数组
  - CLI `--skill <path>`

文档还明确给了复用 Claude Code 或 Codex skills 的设置方式：

```json
{
    "skills": [
        "~/.claude/skills",
        "~/.codex/skills"
    ]
}
```

这对我们很有用：Neuro Book 已经有 `assets/agent/skills` 和用户 assets 覆盖层。重构后可以继续保持 skill 标准，不必绑定 Pi 自己的目录结构。

### 可直接参考或使用的 skill / package

我查到这些公开入口：

- [badlogic/pi-skills](https://github.com/badlogic/pi-skills)：Pi 文档直接列出的 skills 仓库，描述是 “compatible with Claude Code and Codex CLI”。适合看它如何写可跨 harness 的 `SKILL.md`。
- [Anthropic Skills](https://github.com/anthropics/skills)：Pi 文档也列为 skill repository，可作为 Agent Skills 标准参考。
- [qualisero/awesome-pi-agent](https://github.com/qualisero/awesome-pi-agent)：awesome list，聚合 Pi add-ons、hooks、tools、skills、resources。
- [HazAT/pi-config](https://github.com/HazAT/pi-config)、[dannote/dot-pi](https://github.com/dannote/dot-pi)：公开的个人 Pi 配置仓库，可观察真实用户如何组织 skills/extensions。

### 与 skills 有关的 issue/PR

GitHub issue 搜索显示 Pi 的 skills 体系很活跃，但也有一些边界问题：

- [#4761](https://github.com/earendil-works/pi/issues/4761)：`~/.agents/skills` 发现的 skill 在 `pi config` 里 exclusion path 不匹配。
- [#4053](https://github.com/earendil-works/pi/pull/4053)：给 extensions 暴露 `registerSkillsOverride()`，让扩展能参与 skill normalization / dedupe。
- [#3405](https://github.com/earendil-works/pi/issues/3405)：`~/.pi/agent/skills` symlink 到 `~/.agents/skills` 时 config 显示重复 skill。
- [#4703](https://github.com/earendil-works/pi/issues/4703)：扩展想做 `$skill-name` autocomplete，但 editor trigger 字符当前硬编码。

这些 issue 对 Neuro Book 的启发是：skill discovery 不能只靠 path string；应有稳定 resource identity、realpath/canonical path、source metadata、enable/disable override 规则。

## Extensions 与可直接参考的 agent 指导

Pi 的 philosophy 是：核心很小，sub-agent、plan mode、permission gate、MCP 等都用 extension 做。

本地 `packages/coding-agent/examples/extensions/` 里有大量可直接参考的例子：

- `subagent/`：通过 spawn 独立 `pi` 进程实现 single / parallel / chain subagent。
- `plan-mode/`：只读 plan mode，切换 active tools，拦截危险 bash。
- `permission-gate.ts`：危险工具调用确认。
- `protected-paths.ts`：保护路径写入。
- `qna.ts` / `questionnaire.ts`：结构化向用户提问。
- `structured-output.ts`：用 terminating tool result 结束 agent。
- `provider-payload.ts`：inspect provider request/response。
- `custom-provider-*`：注册自定义 provider。

这些不是 “skills”，而是更接近我们要重构的 runtime/harness 插件系统。对 Neuro Book 而言：

- Plan Mode 不应该硬塞 profile prompt，可以参考 Pi extension：通过 active tools + tool_call hook + 状态 widget/消息来实现。
- Subagent 不应该只靠 prompt 约定，可以参考 Pi subagent extension 的 single/parallel/chain 协议，但不要照搬 spawn CLI；我们应在 server 内建立 child thread/session。
- Permission gate 可以从 extension hook 变成 Neuro Book 的 tool preflight policy。

### 与 subagent / plan mode 相关的 issue/PR

我搜索到几条有价值的 upstream 讨论：

- [#4197](https://github.com/earendil-works/pi/issues/4197)：subagent 场景中 pending next-turn message 造成 user message duplicate。说明 session/queue drain 边界很容易出错。
- [#4805](https://github.com/earendil-works/pi/pull/4805)：给 ExtensionContext 暴露 `agentDir`，动机之一是 sub-agent spawning 需要继承 settings/extensions/skills context。
- [#4807](https://github.com/earendil-works/pi/issues/4807)：extension API additions，包含 global LLM usage listener、agentDir context、working timer。
- [#3701](https://github.com/earendil-works/pi/issues/3701)：subagent example 的 promptSnippet 问题，提醒 tool 是否能被 system prompt 正确暴露很重要。
- [#4710](https://github.com/earendil-works/pi/issues/4710)：subagent parallel mode 曾截断输出、吞掉失败诊断。对我们的 `invoke_subagent` 结果回收很有警示意义。
- [#3568](https://github.com/earendil-works/pi/pull/3568)：subagent provider routing via settings，说明子 agent 的 provider/model 路由是常见需求。

## 对 Neuro Book 的迁移建议

### 第一阶段：provider/message 边界替换

目标是先去掉 LangChain 最摇晃的一层。

- 新增 `server/agent-pi` 或 `server/agent-next` 子树，不直接大面积改 v2。
- 引入 `@earendil-works/pi-ai`。
- 建立 Neuro Book message codec：
  - Pi `UserMessage` / `AssistantMessage` / `ToolResultMessage` <-> DB thread message。
  - 保留 app-specific display/event metadata，但不要塞进 provider message。
- 建立 provider config -> Pi `Model` resolver：
  - 映射现有 `config.yaml` provider。
  - 优先覆盖 OpenAI-compatible、DeepSeek、Anthropic、Google。
- 做一条最小 smoke：无工具单轮 streaming + usage + thinking。

### 第二阶段：tool loop 替换

- 把现有 `AgentToolRegistry` 包装成 Pi `AgentTool`。
- 将当前 tool result DTO 映射成 Pi `ToolResultMessage.content/details/isError`。
- 使用 Pi 的 `toolExecution`、`beforeToolCall`、`afterToolCall` 或同等设计替代自写 batch glue。
- 保留现有前端 SSE event，但由 Pi event adapter 生成。

### 第三阶段：profile prepare 边界重塑

当前 TSX profile 系统可以保留，但输出目标改掉：

- `prepare()` 不再返回 LangChain `BaseMessage[]`。
- 改为返回 Pi `AgentContext` 或 Neuro Book 自己的 `PreparedRun`，内部 message 是 Pi block message。
- `HistorySet` / `DynamicSet` / `AppendingSet` 继续作为 profile DSL，但 renderer 输出 Pi messages。
- built-in/user profile 的 Zod InputSchema 继续保留，运行前校验仍用 Zod。

### 第四阶段：thread/session append-only 重构

参考 Pi JSONL tree，但不一定落文件：

- Thread history 改为 append-only entry log。
- Message、tool lifecycle、model change、thinking level、profile change、compaction、branch summary、custom app entry 分开。
- 当前 active leaf 显式持久化。
- `buildContext()` 从 leaf 回溯并 reduce，而不是散落在多个 service 里。

### 第五阶段：resource/skills/extensions 化

- Skill 继续采用 Agent Skills 标准。
- 用户 assets 中的 skills/profile/resource 仍保留覆盖层。
- 后续可以把 profile、tool policy、permission gate、plan mode 都变成 Neuro Book extension/resource，而不是越塞越多 hardcoded profile prompt。

## 风险与注意点

- Pi 当前版本要求 Node `>=22.19.0`，Neuro Book 部署镜像要确认 Node 版本。
- Pi 使用 TypeBox，Neuro Book 使用 Zod；schema 体系需要设计适配层，不能一刀切。
- `AgentHarness` 仍在演进，直接依赖可能跟随 upstream churn。
- Pi coding-agent 的 subagent 示例是 CLI spawn 方案，不适合直接用于 Web server 内长生命周期线程。
- Pi skills/config issue 显示资源 discovery/disable/override 边界仍复杂；我们自己的 user-assets 覆盖规则要继续保持单一真相源。
- 不要一次性替换整个 `server/agent`。先在并行子树做 adapter 和 smoke，再逐步迁移生产入口。

## 需要继续阅读的源码入口

- `.agent/workspace/pi/packages/ai/src/types.ts`
- `.agent/workspace/pi/packages/ai/src/stream.ts`
- `.agent/workspace/pi/packages/ai/src/providers/openai-completions.ts`
- `.agent/workspace/pi/packages/ai/src/providers/openai-responses.ts`
- `.agent/workspace/pi/packages/agent/src/agent-loop.ts`
- `.agent/workspace/pi/packages/agent/src/agent.ts`
- `.agent/workspace/pi/packages/agent/src/harness/agent-harness.ts`
- `.agent/workspace/pi/packages/agent/docs/agent-harness.md`
- `.agent/workspace/pi/packages/agent/docs/durable-harness.md`
- `.agent/workspace/pi/packages/coding-agent/docs/sdk.md`
- `.agent/workspace/pi/packages/coding-agent/docs/session-format.md`
- `.agent/workspace/pi/packages/coding-agent/docs/skills.md`
- `.agent/workspace/pi/packages/coding-agent/docs/extensions.md`
- `.agent/workspace/pi/packages/coding-agent/examples/extensions/subagent/`
- `.agent/workspace/pi/packages/coding-agent/examples/extensions/plan-mode/`

## 资料来源

- 本地 Pi 仓库：`.agent/workspace/pi/README.md`
- 本地 Pi 文档：`.agent/workspace/pi/packages/ai/README.md`
- 本地 Pi 文档：`.agent/workspace/pi/packages/agent/README.md`
- 本地 Pi 文档：`.agent/workspace/pi/packages/agent/docs/agent-harness.md`
- 本地 Pi 文档：`.agent/workspace/pi/packages/agent/docs/durable-harness.md`
- 本地 Pi 文档：`.agent/workspace/pi/packages/coding-agent/README.md`
- 本地 Pi 文档：`.agent/workspace/pi/packages/coding-agent/docs/sdk.md`
- 本地 Pi 文档：`.agent/workspace/pi/packages/coding-agent/docs/session-format.md`
- 本地 Pi 文档：`.agent/workspace/pi/packages/coding-agent/docs/skills.md`
- 本地 Pi 文档：`.agent/workspace/pi/packages/coding-agent/docs/extensions.md`
- Pi docs: https://pi.dev/docs/latest
- Pi repo: https://github.com/earendil-works/pi
- Pi skills: https://github.com/badlogic/pi-skills
- Awesome Pi Agent: https://github.com/qualisero/awesome-pi-agent
- Issue/PR: https://github.com/earendil-works/pi/issues/4761
- Issue/PR: https://github.com/earendil-works/pi/pull/4053
- Issue/PR: https://github.com/earendil-works/pi/issues/4703
- Issue/PR: https://github.com/earendil-works/pi/issues/4197
- Issue/PR: https://github.com/earendil-works/pi/pull/4805
- Issue/PR: https://github.com/earendil-works/pi/issues/4807
- Issue/PR: https://github.com/earendil-works/pi/issues/3701
- Issue/PR: https://github.com/earendil-works/pi/issues/4710
- Issue/PR: https://github.com/earendil-works/pi/pull/3568
