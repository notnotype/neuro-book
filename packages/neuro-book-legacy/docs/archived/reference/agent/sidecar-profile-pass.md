# Sidecar Profile Pass（已归档）

> **归档说明（2026-07-21，Task 111 PLAN-E）**：sidecar 机制已从 Agent 核心中删除（`SidecarProfilePass`、`report_sidecar_result`、`profile.sidecars` 均不存在）。原 simulator.actor 的 context-load / memory-save 旁路暂缺，后续以 workflow / 后台 job 形态重建。本文仅作历史参考。

`SidecarProfilePass` 是 profile 声明的旁路 run。它沿用当前 profile、当前 session、当前 session tree 和当前 input，在主 run 前后 fork 一条 side branch，完成检索、反思或维护任务后，通过 `merge()` 把结果注入主线或持久化到主 session。

它不是新 profile，也不通过 `profileKey` 切换身份。

## When To Use

适合：

- `actor.context-load`：actor 主 run 前检索并整理角色可知设定。
- `actor.memory-save`：actor 主 run 后维护 `events.jsonl`、`memory.jsonl` 和 `mind.md`。
- writer 写作前检索相关 lorebook。
- simulator leader 推进前做规则审计。

不适合：

- 确定性上下文注入。确定性内容继续用 profile TSX、input schema、variables 或 `<Import />`。
- agent 主动临时切换 profile。V1 只支持 profile 声明式自动旁路。

## V1 Contract

```ts
type SidecarProfilePass<TInput, TSidecarData> = {
    name: string;
    stage: "prepareRun" | "settleRun";
    enterPrompt: string | ((ctx: SidecarContext<TInput>) => string);
    toolKeys?: readonly string[];
    sidecarDataSchema?: TSchema;
    outputFallback?: "final_message_as_result" | "parse_final_message_json";
    merge: (ctx: SidecarContext<TInput>, result: SidecarResult<TSidecarData>) => SidecarMergePlan;
};
```

V1 规则：

- `stage` 只支持 `prepareRun` 和 `settleRun`。
- sidecar 自己的 assistant / toolResult transcript 持久化在 session tree 的 side branch；完成后恢复主 run active leaf，不把 sidecar transcript 合入主 history。
- 禁止 nested sidecar。
- sidecar waiting、缺少必要结果、或多轮 tool error 后仍无法完成时，父 run 失败。
- `toolKeys` 必须是当前 profile 根 `tools` 的 key 子集。
- provider-visible tools 来自 profile 根 `tools`，保持 profile-stable；实际执行权限由主 run `toolKeys` 或 sidecar `toolKeys` 控制。
- sidecar 不能创建或覆盖工具绑定，不能修改工具 schema、description 或执行函数。

## Result And Merge

主路结果使用 `report_result`：

```ts
type ReportResultArgs = {
    result: string;
    data?: JsonValue;
};
```

sidecar 旁路结果使用 `report_sidecar_result`：

```ts
type ReportSidecarResultArgs = {
    result: string;
    data: {
        [sidecarName: string]: JsonValue;
    };
};
```

- `report_result.data` 是主路结构化输出，按 profile `outputSchema` 或 `builtin.result.main({ dataSchema })` 校验。
- `report_sidecar_result.data` 是旁路结构化输出的 keyed 包装。profile normalize 会收集所有 sidecar 的 `sidecarDataSchema`，把它们渲染成 `{ "<sidecar-name>": payload }` 形态的 profile-stable union provider-visible schema。
- provider-visible tools 和 schema 始终来自 profile root `tools`，不随当前 active sidecar 改变；sidecar 只用 `toolKeys` 收窄执行权限。
- sidecar 运行期按当前 active sidecar 精确读取并校验 `report_sidecar_result.data[activeSidecar.name]`；缺 key、传错 key、额外 key 或 payload 类型不匹配都会在 tool execution 阶段返回模型可见 error toolResult，并允许同一 run 自我修正。
- sidecar runtime schema 校验使用统一的严格 TypeBox formatter：不执行 Convert/default 填充，错误保留 sidecar 名称和 JSON Pointer 字段路径，不暴露裸 `Parse`。
- 没有 `report_sidecar_result` 时，可按 `outputFallback` 使用最后一条 assistant message。

`merge()` 可以返回：

- `runtimeMessages`：注入父 run 模型上下文，不落 session。
- `persistedMessages`：写入父 session active path，并在 `prepareRun` 本轮主 run 可见；第一版只允许 user message，写入 origin 为 `harness`。
- `runtimeState`：写入父 run runtime state。
- `writePlans`：显式持久化 session custom state 或 projection。

V1 推荐只在 `prepareRun` 使用 `persistedMessages`，用于“本轮需要像用户消息一样进入历史”的上下文。`settleRun` 虽可返回 `persistedMessages`，但它只会成为未来可见历史；维护状态仍优先使用 `writePlans` 或文件工具。`prepareRun` sidecar 合并后会做一次 provider-visible context 预算检查，超出模型窗口时父 invocation 直接失败，已写入的 persisted message 不回滚。

## Roleplay Actor Pattern

`actor.context-load`：

- stage: `prepareRun`
- toolKeys: `subject_rag_search`, `report_sidecar_result`
- 输入：actor-facing packet、actor path、当前 subject files。
- 输出：actor-safe current context、相关过往经历和相关稳定认知写入 `report_sidecar_result.result`；`data` 只返回 `{ "actor.context-load": {} }` 用于闭合 keyed 协议。
- 检索：`subject_rag_search` 只检索当前 subject 的指定单一 source；必须显式传 `["events"]` 或 `["memory"]`，需要两层记忆时分两次调用；查询调参第一版只使用 `limit`，不检索 lorebook、Project 全局文件或其他 subject。
- merge：把 actor-safe 摘要以 `persistedMessages` 写入 actor session，并注入 actor 主 run；主 run 不直接读取完整 subject files。
- 预算：第一版最多注入少量 events / memory 摘要，合并后若 provider-visible context 超出模型窗口，父 invocation 失败。

`actor.memory-save`：

- stage: `settleRun`
- toolKeys: `subject_event_append`, `subject_memory_update`, `read`, `edit`, `report_sidecar_result`
- 目标：追加 `events.jsonl`，通过 `subject_memory_update` 维护 `memory.jsonl`，并更新 `mind.md`。
- 不更新 `state.md`；位置、持有物、伤势等仍由 simulator leader / 后续变量系统裁决。

Subject RAG 的索引、embedding 配置和工具合同见 [../content/subject-rag-memory.md](../content/subject-rag-memory.md)。

历史设计过程见 [../../../../.agents/tasks/23-agent-sidecar-profile-pass/README.md](../../../../.agents/tasks/23-agent-sidecar-profile-pass/README.md)。
