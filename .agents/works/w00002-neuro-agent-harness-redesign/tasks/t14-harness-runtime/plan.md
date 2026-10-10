# t14 实施计划：`runtime` 模块

## Context

- **为什么做**：Work 切片 6。前五个模块各自成立但没有装起来；`runtime` 是使用方唯一接触的接口，也是插件 `nbook.agent` 的基础。
- **依据**：[`harness.runtime`](../../../../../docs/specs/harness/runtime.md)（本 Task 新写，`planned`）；设计稿“Agent 运行时”“工具审批”“事件、推送与分页”。
- **开发者已确认的决定**：每个会话一个 OMP `Agent`；运行中的 `prompt` 按 `streamingBehavior` 入队否则拒绝；队列只在内存；受理错误不写东西、受理后失败写终态；审批自建、等待放在工具执行包装里、不开预测执行、`beforeToolCall` 不用；只做审批恢复；内核不做 SSE、事件带序号、发起与完成分开；压缩触发只做手动、溢出、一轮结束超阈值。
- **本 Task 自己定的（记入待确认清单）**：溢出不自动压缩重试，以 `failed(overflow: true)` 收口；`maxTurns` 放在 `RuntimeDeps.limits`（不是 Profile 字段）；事件不缓冲、不补发；审批模型的判定也写成 `interaction` 两条。
- **工作方式**：同前几个 Task；模型用 OMP `streamFn` 脚本化（tools 模块的 `scripted-agent` 做法，复制到 `runtime/testing/`），审批模型用 `judge.stream`；存储用真实内存与 JSONL；真实模型冒烟待授权。

## 关键设计

### 1. 类型与字段（`types.ts`、`fields.ts`）

- 类型照 Spec。`fields.ts`：`TOOLS_FIELD`（`Type.Array(Type.String({minLength: 1}), {uniqueItems: true})`）、`APPROVAL_FIELD`（枚举四种模式）；`registerRuntimeFields(host)` 把它们与 `MODEL_FIELD`、`COMPACTION_FIELD` 注册，`duplicate-registration` 不算错（使用方可能先注册）。

### 2. 受理（`accept.ts`）

- `acceptPrompt(deps, session, input, options)`：纯检查、不写：输入形状 → Profile（目录 `get`，`issues` 里有该 Profile 的 error → `invalid-profile`）→ `config.current` → `models.select({model: options.model ?? sessionSettings.model, profile: selectionFromProfile(profile)})` → `checkCapabilities`（图片按输入、工具按可见工具非空）→ `credentials.apiKeyFor` → `visibleTools({requested: harness/tools 字段, sources})` → `signal.aborted`。返回取定的一切（`Accepted`），供调用使用。

### 3. 一次调用（`invocation.ts`）

- `runInvocation(ctx)`：
  1. 写 `invocation start`（`detail`）；新会话（日志里没有 `harness/seed`）写种子；`host.prepare` → 失败写 `invocation error`（`profile`）；`renderAppending` → 写输入、追加消息、提醒、`profile-state`；`model_change` 按需。
  2. 装配 `Agent`：`replaceMessages(buildModelContext(entries 到本次输入之前))`，`setSystemPrompt(renderSystem)`, `setModel`, `setTools(visible → toAgentTool(descriptor, hooks))`, `transformContext`：`refresh`（有 `model-call` 源时）→ `renderRequest({history: messages, invocationStart})` → `setSystemPrompt(systemPrompt)`，返回 `messages`；`convertToLlm` 保留 developer；`streamFn: deps.model?.stream`；`getApiKey: () => apiKey`。
  3. 订阅 `Agent` 事件：`message_update` → `stream`；`message_end` → 角色 `assistant`/`toolResult`/插话的 `user`（不在“已写入”身份集合里）写日志；`tool_execution_*` → `tool` 事件；`turn_end` 计数 `maxTurns`，超过则 `agent.abort()` 并标记 `limit`。
  4. `await agent.prompt(appendedMessages)`；结束后按最后一条助手消息分类，写终态；日志写入失败在任何一步都 `agent.abort()`、标记 `log`、让句柄 `closed`。
  5. 返回 `InvocationResult`；自动压缩与追加队列由 `session.ts` 在 `done` 之前处理。
- 写入与事件：所有 `log.append` 经一个 `write(entries)` 包装，成功后逐条发 `entry` 事件。

### 4. 审批钩子（`approval.ts`）

- `approve(request)`：`evaluateRisk(request.definition.risk, args)` → `decideApproval({...mode, config.approval.tools, grants})`；`model` → `judgeWithModel`（写两条 `interaction`，`decidedBy: "approver"`）；`ask` → 写 request（第一次写 `invocation waiting`，状态 `waiting-user`）→ `Promise` 等待 `resolve` 或 `request.signal`；应答后写 response；该批全部应答后写 `invocation resumed`、状态 `running`。
- 待处理表：`Map<interactionId, {resolve, request, assistantEntryId, toolCallId}>` 在 `session.ts`；`abort` 时逐个以 reject（`note: "aborted"`）结算并写 response。
- 恢复执行（输出 13）：`resumePending(answer)`：按日志里的 request 找工具调用（助手条目 + toolCallId）→ `toAgentTool(descriptor, hooks(approve 直接返回已定决定)).execute(toolCallId, args, signal)` → 写工具结果；该批全部有结果 → `invocation resumed` → `replaceMessages(buildModelContext)` → `agent.continue()`，之后与普通调用共用步骤 3、4。

### 5. 会话句柄（`session.ts`）

- 状态机字段：`phase`、`current: {invocationId, done resolvers, aborted?: "user" | "limit"}`、`steerQueue`（只记数量，消息直接 `agent.steer`）、`followUpQueue: UserInput[]`、`pending`、`seq`、`listeners`。
- `prompt`：按矩阵；`idle` → `acceptPrompt` → `runInvocation`（不 await，返回 `{invocationId, done}`）。`done` 链：结果 → 自动压缩（`completed` 且 `shouldCompact`）→ `status` 事件 → resolve `done` → 处理追加队列。
- `subscribe`：监听函数抛错 → 该订阅结束。`close`：中止、等收口、`log.close()`、结束订阅。

### 6. 入口与边界

- `runtime.ts`：`createRuntime`；`createSession` 写会话头（有 `title` 时再写一条 `title_change`），Profile 只记在句柄里，第一次调用时写进 `invocation start` 的 `detail`；`openSession` 的 `status.profileId` 取最近一次 `invocation start` 的 `detail.profileId`。
- `package.json` 加 `./runtime`；模块表登记 `runtime`：依赖模块全部六个；`typebox`、`@oh-my-pi/pi-agent-core`、`@oh-my-pi/pi-ai` 运行时，`@oh-my-pi/pi-catalog` 只 `import type`。
- 删除旧原型（S3）：`src/prototype/`、`package.json` 的 `.` 与 `./testing` 入口改指向 `runtime`（`.` 再导出 runtime 与各模块入口；`./testing` 指向 `src/runtime/testing/index.ts`）；删除 `packages/nb-session`、`packages/nb-profile`：根 `package.json` workspaces、`scripts/ci/workspace-package-matrix.ts`、`.github/workflows/workspace-packages.yml` 与 `code-baseline.yml`、`packages/AGENTS.md`、`nb-harness/AGENTS.md`、仓库根 `AGENTS.md` 的结构图、`docs/modules/monorepo-boundaries.md`、`docs/testing/README.md` 中的提及；`architecture.test.ts` 去掉 `PROTOTYPE` 例外。

## Spec 与文档改动

| 文档 | 改什么 | 片 |
|---|---|---|
| `docs/specs/harness/runtime.md` | 本 Task 新写；实现中发现歧义先改 Spec；收口加证据 | 计划时、S2 |
| `docs/specs/README.md` | 登记；收口标“待晋升” | 计划时、S2 |
| `packages/nb-harness/package.json`、`src/architecture.test.ts` | 入口与模块表；S3 去掉原型例外 | S1、S3 |
| 根 `package.json`、CI 工作流、`packages/AGENTS.md`、`nb-harness/AGENTS.md`、根 `AGENTS.md`、`docs/modules/monorepo-boundaries.md`、`docs/testing/README.md` | 删除两个包与原型的提及 | S3 |
| Work README | 切片 6 链接 | 计划时 |
| 本 Task README | 每片更新 | 各片 |

## 切片

| 片 | 内容 | 关键设计 | 自跑验证 |
|---|---|---|---|
| S1 | 类型、字段、受理、一次调用、审批钩子、会话句柄、入口；合同测试（场景 1–8）与 llm 冒烟（不运行） | 1–6（除删除） | `bun test src/runtime`、`bun run typecheck`、`bun test src/architecture.test.ts` |
| S2 | Spec 证据与注册表；omp 审查（计划与实现合一） | 全部 | `bun test`、仓库根 `bun run governance:check` 与 `bun run docs:check` |
| S3 | 删除旧原型与 `nb-session`、`nb-profile`；工作区、CI 与文档同步 | 6 | 仓库根 `bun install`、`bun run typecheck`（受影响包）、`bun test`（nb-harness）、CI 脚本 `workspace-package-matrix` 自检、门禁 |

## 验收映射

| `harness.runtime` | 测试 |
|---|---|
| 输出 1–5、9–12；场景 1、2、5、6 | `src/runtime/runtime.test.ts`（真实内存存储、真实 OMP `Agent`、脚本化模型） |
| 输出 6–8；场景 3、4 | `src/runtime/approval.test.ts`（真实 JSONL 存储） |
| 输出 13；场景 7 | `src/runtime/recovery.test.ts`（真实 JSONL：丢弃句柄后重开） |
| 输出 14、15；场景 8 | `src/runtime/compaction.test.ts`（脚本化摘要传输经 `deps.compaction` 注册的 `createSoftCompaction({completeImpl})`） |
| 场景 9 | `src/runtime/runtime.llm.test.ts` |

## 验证

- `bun test src/runtime`、`bun run typecheck`；变异检查：受理失败仍写入、种子每次都写、助手消息在 `message_start` 写、终态前就改状态、`abort` 不写拒绝应答、`scope: session` 不生效、追加队列在 `aborted` 后也处理、`maxTurns` 不生效、恢复后不写 `resumed`、自动压缩在 `done` 之后。
- 未验证边界：真实模型（待授权）；插件阶段的远程传输。

## 不做与风险

- 不做：传输；溢出自动重试；子代理等第一批之外的能力。
- 风险：OMP `Agent` 内部事件顺序（`message_end` 与 `tool_execution_end` 的先后、错误路径合成的工具结果）随 OMP 升级变化；合同测试用真实 `Agent`，升级时先失败。
- 风险：审批等待期间 OMP 的循环停在工具批次上，`steer` 的送达时机依赖 OMP 的队列实现；测试锁定“在工具结果之后”。
- 风险：删除两个包牵涉 CI 与文档多处，漏改由 `workspace-package-matrix` 与 `docs:check` 兜底。
