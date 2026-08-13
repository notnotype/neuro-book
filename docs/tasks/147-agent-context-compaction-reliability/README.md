# Agent 上下文压缩可靠性与材料恢复

## Relative documents refs

- [Task 02：Pi Agent Harness Migration](../02-pi-agent-harness-migration/README.md)
- [Task 126：Agent 上下文组成与缓存诊断面板](../126-agent-context-inspector/README.md)
- [archived：Agent Compaction Visible Context Contract](../archived/agent-compaction-visible-context-contract/README.md)
- [archived：Profile Compaction Config and History Reinjection](../archived/profile-compaction-config-and-history-reinjection/README.md)
- [PROJECT-STATUS.md](../../PROJECT-STATUS.md)

## User Request / Topic

用户报告自动压缩在长上下文附近失败：压缩摘要请求本身可能超过模型窗口，provider 拒绝后整个 invocation 进入 compaction error。用户要求先解释 NeuroBook 当前算法，调研 Pi、Claude Code、OpenCode、Codex 等 Harness，再修复根因；不能只调低触发线。

后续产品取舍已拍板：压缩输出保留文本 summary，并增加受 Harness 校验的 recovery materials。默认只从本 invocation 成功读取或修改的 Project 文件产生候选；注入引用清单和有限正文，校验失败时只记录并跳过。

## Goal

建立不会因“压缩请求自身超窗”而卡死的 Agent 上下文压缩合同，同时保留 session tree、tool call / approval 恢复、HistorySet / ModelContext / AppendingSet 分区和 Project Workspace 权限边界：

- 每次实际 provider 请求前检查最终物化的 system、tools 和 messages；
- 摘要输入与输出使用独立预算，provider 失败时自动路径仍写可恢复 checkpoint；
- 压缩后恢复 HistorySet 和有界文件材料，避免重复注入与 compaction thrashing；
- recovery material 必须经过 Project generation、路径授权、文件版本、大小和 token budget 校验；
- 用 Faux Provider 和 Harness 行为测试锁定摘要超窗、最终门禁、tool 配对、waiting/resume 和恢复材料合同。

## Current State

### 已实现的压缩流程

1. 自动压缩仍在一次成功 ReAct turn 完整 ingest 后、确定继续下一 turn 时执行。这里是安全切点：assistant tool call 和 toolResult 已经成对持久化，不会在消息中间改写 session tree。
2. 触发策略保持 profile 配置合同：默认 `enabled=true`、`trigger=autoReserve`、`reserveTokens=25_600`、`keepRecent=24_000 tokens`；`autoReserve` 触发线为 `contextWindow - reserveTokens`。
3. planner 以模型可见 session entry 选择 `firstKeptEntryId`，保留 recent tail；cut 落在 toolResult 时前移到对应 assistant tool call，未完成 tool call 仍拒绝压缩。
4. 被裁历史先构造成有界摘要输入。单条 toolResult 文本先裁到 2,000 chars；整体输入预算取模型窗口的 45%、32,000 tokens 和“窗口减去摘要输出预算”三者最小值，再确定性保留头尾。
5. 摘要输出预算独立计算，受 `model.maxTokens`、`reserveTokens * 0.8` 和 `contextWindow * 0.2` 共同限制。
6. 摘要 provider error、aborted 返回或最终请求门禁失败时，自动压缩写入有界 deterministic checkpoint，并在 `compaction.details` 记录 `summaryStrategy`、输入预算和脱敏错误；手动 `/compact` 仍保持失败可见。
7. checkpoint 写入后恢复 profile HistorySet；如果已有旧 checkpoint，恢复后的上下文仍达到同一触发线，则报“自动压缩无进展”并停止重复压缩。

### Provider 请求最终门禁

- 主对话请求在 attachment 授权与 hydrate 后，先只裁剪 toolResult 正文，再对最终 system、tools 和 messages 做窗口断言，随后才调用 `streamSimple`。
- compaction 摘要请求和 model health-check 也在 `completeSimple` / `streamSimple` 前使用同一门禁。
- token 估算同时计算两条口径并取较大值：Pi 最近 assistant usage 加 trailing messages，以及当前 system + 当前 tools + 全 messages 的保守估算。这样动态 system/tools 不会因为上一轮已有 usage 而被漏算。
- 首次请求、steer、approval resolution、HistorySet reinjection、动态上下文和大工具结果最终都会经过同一 provider seam；不要求在每条内部消息写入后重复检查。

### Recovery materials

- 候选只来自本 invocation 成功的 Project-bound `read`、`write`、`edit` 和 `apply_patch`；摘要文本中的新路径不会触发读取。
- tracker 记录 exact `ReadyProjectSessionRef`、Project root/generation、canonical relative path、来源集合、size、mtime 和 SHA-256。
- 自动压缩确认触发后、checkpoint 写入前执行验证：复用 `authorizeFileOperation`，要求同一 Project generation 和 canonical target，并在读前/读后 stat 稳定后复算 SHA-256。
- 单文件验证上限为 256 KiB；超过上限的文件不进入恢复。正文最多捕获 16 KiB，单文件正文最多 1,200 tokens，引用与正文合计最多 2,000 tokens，最多 16 个引用。
- 验证通过的同一组 metadata 同时写入 `compaction.details.recoveryCandidates`，并作为下一 turn 的临时模型消息；临时正文不持久化为普通 session message。
- 去重 key 包含 Project root、generation、path 和 SHA-256。集合属于 invocation tracker，跨 waiting/resume 复用；文件变化、Project 重开、路径越界、授权失败和 token 超限均跳过。
- 恢复材料记录是辅助状态；记录时的 stat 失败不会把已经成功的文件工具调用改成失败。

## External Research

- **Pi（已验证）**：`CompactionEntry` 使用 `firstKeptEntryId` 确定性重建 summary + recent tail，并记录 read/modified file paths；没有 NeuroBook 所需的 Project generation 和内容版本授权合同。证据：[Pi compaction docs](https://pi.dev/docs/latest/compaction)、[Pi compaction source](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/src/core/compaction/compaction.ts)。
- **OpenCode / Codex（已验证）**：都在 LLM 摘要前执行确定性裁剪，并在仍超限时给出显式 overflow；没有文件授权与哈希版本合同。证据：[OpenCode compaction](https://github.com/sst/opencode/blob/dev/packages/opencode/src/session/compaction.ts)、[Codex compact](https://github.com/openai/codex/blob/main/codex-rs/core/src/compact.rs)。
- **Anthropic API / Claude Code（已验证）**：API 的 compaction block 是纯文本；Claude Code 会先清理工具输出、重注入持久规则，并在压缩后立即再次填满时停止 thrashing。公开合同没有“摘要模型自由选择任意文件并直接注入”。证据：[Anthropic Compaction](https://platform.claude.com/docs/en/build-with-claude/compaction)、[Claude Code context window](https://code.claude.com/docs/en/context-window)、[Claude Code troubleshooting](https://code.claude.com/docs/en/troubleshooting#auto-compaction-stops-with-a-thrashing-error)。
- **Cursor（行为参考）**：长工具输出落盘、摘要保留文件引用，属于拉取式恢复；本任务没有把它当作授权实现。证据：[Dynamic context discovery](https://cursor.com/blog/dynamic-context-discovery)。

## ADR / Decisions

- 不把调低 `triggerPercent` 当根因修复。
- 压缩检查点只能在完整 turn save point 后写入；最终 provider 门禁负责覆盖首次请求和所有动态上下文。
- 自动摘要失败优先保留可恢复 checkpoint；手动压缩失败继续对用户可见。
- 文本 summary 是兼容核心；恢复 metadata 是 Harness 管理的旁路事实，不把模型输出路径当权限凭证。
- 恢复材料采用“引用清单 + 有限正文”；候选范围不扩展到本轮未实际访问的文件。
- 旧 session 不迁移；新 checkpoint 和 reducer 行为从后续写入开始生效。

## Verification / Test

### 已通过

- `bunx vitest run server/agent/harness/compaction.test.ts server/agent/harness/recovery-materials.test.ts server/agent/harness/prepare-next-turn.test.ts server/agent/harness/run-frame-state.test.ts server/agent/harness/turn-transaction.test.ts server/agent/harness/turn-failure.test.ts server/utils/model-settings.test.ts --reporter=dot`
  - `7 files / 53 tests passed`。
- `bunx vitest run server/agent/harness/neuro-agent-harness.test.ts --reporter=dot`
  - `1 file / 188 tests passed`。
- `bunx vitest run server/agent/tools/file-tools.test.ts --reporter=dot`
  - `1 file / 49 tests passed`。
- `bun run generate`
  - Prisma Client `7.8.0` 与 Project Prisma Client `7.8.0` 生成成功。
- `bunx tsc --noEmit --pretty false`
  - 退出码 0。
- `git diff --check`
  - 退出码 0。

### 已验证行为

- 2,000-token Faux model 的摘要输入在 provider 前被裁到窗口内；不再复现 `This model's maximum context length is 2000 tokens. However, you requested 2029 tokens.` 导致零 checkpoint 的旧故障。
- 摘要最终上下文超窗时 provider 调用次数为 0，自动路径写 deterministic checkpoint。
- 自动 compaction 开启时，首次超窗主请求在 Faux Provider 前失败并返回明确的 model-phase overflow；关闭 compaction 时保留原有明确错误。
- tool call / toolResult cut point、未完成 tool call 拒绝、HistorySet reinjection 和 waiting/resume 行为通过完整 Harness 套件。
- 真实 `read` 工具产生的恢复材料在自动压缩后进入下一轮 provider，并同步写入已验证 checkpoint metadata；临时恢复正文不进入普通 session history。
- 文件变化、路径越界、旧 Project generation、超过 256 KiB、重复版本和 token 超限均 fail closed。

### 未运行

- 未运行真实 provider smoke 或 Pi trace payload 验收。
- 未运行作者视角长 session / 压缩频率验收。
- 未运行浏览器人工验收；本任务没有 UI 改动。
- 未运行全仓 `bun test`；验证范围为完整 Harness、文件工具、相关聚焦套件和根 TypeScript。

## Implementation Walkthrough

### 2026-08-13：诊断与外部调研

- 用 Faux Provider 复现摘要请求自身超窗；确认旧实现只在成功 ReAct loop 后检查，且摘要输入无界。
- 并行核对 Pi、OpenCode、Codex、Anthropic/Claude Code 和 Cursor 的压缩、裁剪、thrashing 与文件恢复行为。
- 产品政策收敛为文本 summary + 受验证 recovery materials。

### 2026-08-13：实现与收口

- 新增独立摘要输入/输出预算、toolResult 裁剪、deterministic fallback 和无进展保护。
- 新增统一 provider context admission，并覆盖主对话、compaction 和 model health-check。
- 新增 invocation-scoped recovery tracker、授权/版本/token 校验、checkpoint metadata 和临时正文注入。
- 修复 waiting/resume tracker 重置与跨帧去重，统一 metadata 和临时注入使用同一验证结果。
- 完成完整 Harness、文件工具、聚焦套件和 TypeScript 验证。

## TODO / Follow-ups

- [x] 摘要输入独立预算与确定性裁剪。
- [x] 所有生产 provider seam 的最终上下文门禁。
- [x] 自动摘要失败 checkpoint 与 compaction thrashing 保护。
- [x] recovery material 候选追踪、授权、版本、大小、token 和重复注入合同。
- [x] tool 配对、waiting/resume、HistorySet、首次 overflow 和恢复材料行为测试。
- [ ] 真实 provider / trace 与作者视角长 session 验收；该项不由 Faux 测试替代。
