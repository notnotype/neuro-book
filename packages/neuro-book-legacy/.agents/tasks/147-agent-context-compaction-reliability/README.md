# Agent 上下文压缩可靠性与材料恢复

## Relative documents refs

- [Task 02：Pi Agent Harness Migration](../02-pi-agent-harness-migration/README.md) —— NeuroBook 当前 Pi-based Agent Harness 的迁移边界与既有 compaction 合同。
- [Task 126：Agent 上下文组成与缓存诊断面板](../126-agent-context-inspector/README.md) —— NeuroBook 当前 provider context 四分区、动态 ModelContext 与 token 观测口径。
- [archived：Agent Compaction Visible Context Contract](../archived/agent-compaction-visible-context-contract/README.md) —— 当前模型可见 entry、HistorySet reinjection 和 compaction cut 合同的历史决策。
- [archived：Profile Compaction Config and History Reinjection](../archived/profile-compaction-config-and-history-reinjection/README.md) —— profile compaction 配置与压缩后 HistorySet 恢复的来源。
- [PROJECT-STATUS.md](../../PROJECT-STATUS.md) —— 仓库级 Agent / Workflow 状态与风险。

## User Request / Topic

用户报告自动压缩在长上下文附近失败：压缩摘要请求本身可能超过模型窗口，provider 拒绝后整个 invocation 进入 compaction error。用户同意修复该 bug，并要求吸收 Pi、Claude Code、OpenCode、Codex 等 Harness 的有效做法，设计适合 NeuroBook 的完整压缩算法，而不是只调低触发线。

本轮新增讨论：NeuroBook 当前 compaction entry 只有纯文本 summary；需要调研 Claude Code 所谓“预注入文件”或类似的结构化恢复材料，判断压缩输出是否应支持模型选择后续直接注入的文件材料。

## Goal

建立一个不会因“压缩请求自身超窗”而卡死的 Agent 上下文压缩合同，并保留 NeuroBook 的 session tree、tool call / approval 恢复、HistorySet / ModelContext / AppendingSet 分区和 Project Workspace 权限边界。最终算法应满足：

- 在每次实际 provider 请求前，对最终物化的 system、tools、持久历史、动态上下文和当前输入做有界 admission check；
- 摘要输入有独立预算，支持工具输出裁剪、必要时分段或无 LLM 降级，压缩失败不会把 session 留在不可恢复的死锁状态；
- 压缩后能恢复必要的 NeuroBook 初始化上下文，并防止重复 HistorySet 堆积和 compaction thrashing；
- 评估纯文本 summary 与“结构化 summary + 可选恢复材料引用”的取舍。文件材料必须经过现有授权、路径 containment、大小和版本检查，不能把摘要模型输出直接当成可执行文件读取指令；
- 用真实或可控 Faux Provider 复现用户的超窗错误，并用 focused tests 锁定触发边界、摘要输入预算、失败降级、tool/approval 完整性和材料恢复合同。

验证面：`server/agent/harness/compaction.ts`、`neuro-agent-harness.ts` 的行为测试与 Faux Provider 超窗复现；必要时使用真实 provider smoke、trace 和作者视角长 session 验收。未完成前不把“调低 triggerPercent”写成根治。

## Current State

### 已确认的 NeuroBook 行为

- 默认 compaction 为 `enabled=true`、`trigger=autoReserve`、`reserveTokens=25_600`、`keepRecent=24_000 tokens`。
- `autoReserve` 的触发线是 `contextTokens > contextWindow - reserveTokens`；`reserveTokens` 还参与摘要输出 `maxTokens = min(reserveTokens * 0.8, model.maxTokens)`。
- 自动检查发生在成功 Turn 完成后、且确定要继续下一 Turn 时的 `prepareNextTurn -> compactBeforeNextTurn`；不是每条消息后，也不是首个 provider 请求前的统一门禁。
- `generateCompactionSummary()` 将待摘要普通 message 全量拼入一个摘要 user message；没有输入 token 上限、分块或 toolResult 摘断。
- 摘要 provider 返回 error / aborted / 空文本时抛错，不写 compaction entry；自动路径会使 invocation 失败。该失败形态已用 Faux Provider 构造：2,000 token 窗口、估计摘要输入 2,029 tokens 时，provider 返回 `This model's maximum context length is 2000 tokens. However, you requested 2029 tokens.`，compaction entry 数量为 0。
- reducer 以 summary message 加 `firstKeptEntryId` 之后的模型可见消息重建上下文；自动压缩成功后会重新注入一次 profile HistorySet。
- 当前 compaction plan 已将模型可见 `custom_message` 纳入 recent cut 预算，但默认不将其交给 LLM summary，以避免 HistorySet / runtime context 重复摘要。

### 外部参考的已确认方向

- **Pi（已验证）**：`CompactionEntry` 用 `firstKeptEntryId` 做稳定切点，`buildContextEntries()` 确定性重建摘要与保留尾部；`details.readFiles/modifiedFiles` 记录工具调用涉及的路径，并在摘要文本中列出。它没有文件 stat/hash 版本校验，文件列表不能直接作为 NeuroBook 的授权合同。证据：[Pi compaction docs](https://pi.dev/docs/latest/compaction)、[session-manager.ts](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/src/core/session-manager.ts)、[compaction.ts](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/src/core/compaction/compaction.ts)。
- **OpenCode / Codex（已验证）**：两者都把 LLM 摘要放在确定性裁剪之后；OpenCode 先 prune 旧工具结果，Codex 在压缩回合超窗时删最旧历史重试，并都在仍超限时给出显式 overflow error。它们提供了摘要标记、保留尾部和窗口元数据，但没有对文件引用做授权或内容版本校验。证据：[OpenCode compaction.ts](https://github.com/sst/opencode/blob/dev/packages/opencode/src/session/compaction.ts)、[OpenCode overflow.ts](https://github.com/sst/opencode/blob/dev/packages/opencode/src/session/overflow.ts)、[Codex compact.rs](https://github.com/openai/codex/blob/main/codex-rs/core/src/compact.rs)。
- **Anthropic API（官方、已验证）**：`compact_20260112` 只生成包含纯文本的 `compaction` block；公开参数只有 trigger、`pause_after_compaction` 和 summarization `instructions`，没有“摘要模型选文件”的字段。`pause_after_compaction` 允许客户端在摘要后追加自己保留的消息块，但不等于模型自由读取文件。证据：[Compaction](https://platform.claude.com/docs/en/build-with-claude/compaction)。
- **Claude Code（官方文档、已验证）**：上下文接近窗口时先清理旧工具输出，再摘要；项目规则、auto memory 等从磁盘重注入，路径规则和嵌套规则按需重载；压缩后立即重新填满时停止重试并报告 thrashing。官方工程博客曾描述“summary plus five most recently accessed files”，但这只是实现描述，不是稳定 API 合同；公开文档没有“摘要模型选择任意文件并直接注入”的协议。证据：[context window](https://code.claude.com/docs/en/context-window)、[memory](https://code.claude.com/docs/en/memory.md)、[troubleshooting](https://code.claude.com/docs/en/troubleshooting#auto-compaction-stops-with-a-thrashing-error)、[Anthropic context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)。
- **Cursor（官方博客、行为参考）**：长工具输出落盘为可按需检索的文件，摘要携带历史文件引用；这是拉取式恢复思路，不是 NeuroBook 可验证的授权实现。证据：[Dynamic context discovery](https://cursor.com/blog/dynamic-context-discovery)。
- **综合约束（已验证事实 + 设计推断）**：主流实现共同采用“文本摘要 + 机器可读旁路元数据 + 保留最近尾部 + 无 LLM 裁剪/overflow 回退”。没有一家公开实现提供“Harness 验证文件引用、哈希和 Project 权限”的完整合同；这应成为 NeuroBook 的差异化安全边界，而不是照搬最近文件自动注入。

### NeuroBook 现有能力对照

- `Project File Address` 的唯一权威入口是 `authorizeFileOperation`，它能做 Project open gate、realpath containment 和 exact generation 捕获；恢复材料不能复用 Profile DSL `Import`，因为 `workspace/**` Import 当前只有 lexical containment、没有 Project open gate/realpath/Context Access 记账，且 `maxBytes` 没有默认上限（`server/workspace-files/authorized-file-operation.ts:51-175`、`server/agent/profiles/profile-dsl.ts:1148-1217`）。
- `read` 工具已有 2,000 行 / 50KB 文本上限和 Context Access 记账；`StableAttachmentSnapshotReader` 已证明同一文件句柄的读前/读后身份校验模式可复用。恢复材料仍应只允许文本，图片继续走既有 Attachment 管线（`server/agent/tools/file-tools.ts:115-161`、`server/agent/tools/truncate.ts:1-4`、`server/agent/attachments/stable-attachment-snapshot-reader.ts:18-92`）。
- 当前 compaction entry 的模型可见面只有 `summary`，`details` 是内部 JSON metadata；`applyCompaction` 以 `summary + firstKeptEntryId` 确定性重建。自动 HistorySet reinjection 尚无按内容去重，因此恢复材料不能直接复制该路径，否则每次压缩会堆积（`server/agent/session/types.ts:155-178`、`server/agent/session/session-repo.ts:841-868`、`server/agent/harness/neuro-agent-harness.ts:5003-5052`）。

## ADR / Decisions / Discussion

### 已决定

1. 本任务不把“调低自动压缩触发比例”当作唯一修复；它只能降低摘要输入过大的概率。
2. 摘要输入预算与 provider 主请求预算必须分开计算；限制摘要输出不等于限制摘要输入。
3. 目标边界优先定义为“每次实际 provider 请求前检查最终上下文”，而不是机械地在每条内部消息后重复检查。
4. 任何文件恢复材料都只能引用 NeuroBook 已授权的 Project Workspace / Workspace Root 文件地址；摘要模型不能凭文本路径绕过 file tool 的授权和 containment。
5. 在没有完成来源核实和产品取舍前，不把“预注入文件”命名为既定产品能力；候选术语暂定为“恢复材料（recovery materials）”。

### 待讨论：压缩输出形态

- **纯文本 summary**：兼容当前 compaction entry 和 provider message，最简单；缺点是文件、精确代码片段和结构化状态只能依赖模型摘要转述，容易丢失或重新读取。
- **结构化 checkpoint**：summary 仍是模型可见文本，同时记录稳定字段（目标、进度、决策、阻塞、下一步、关键路径、工具/文件事实）；优点是可诊断、可验证和可增量更新；代价是 schema、版本和 provider 兼容成本。
- **summary + recovery materials**：摘要模型可提出候选文件引用或小型材料片段，Harness 在压缩后验证授权、存在性、大小和版本，再按确定顺序注入；优点是保留关键源码/配置的原貌，代价是权限、陈旧文件、上下文预算和“模型把任意路径当真相”的风险。

当前偏向：保留文本 summary 作为兼容的核心事实，同时把结构化字段和恢复材料设计为受 Harness 验证的内部 metadata；不直接把任意文件全文自动塞回上下文，先采用引用 + 有界读取或显式 Project File Address。

### 本轮设计收敛

- **Compaction Summary（压缩摘要）**：模型可见的纯文本连续性记录，替代被裁掉的旧 Agent ReAct Loop 内容；其中的路径和符号是事实描述，不是文件读取命令或权限凭证。
- **Compaction Checkpoint（压缩检查点）**：代表一次压缩边界的持久记录，至少包含摘要、保留起点和 token 统计；可携带不直接展示给模型的恢复 metadata。
- **Recovery Material（恢复材料）**：压缩后重新提供的、有界上下文内容或其引用；必须经过 Harness 的授权、存在性、内容版本和 token budget 校验。
- **Recovery Reference（恢复材料引用）**：指向已授权文件的稳定地址及读取时需要核对的版本信息；默认用于按需拉取，不承诺自动全文注入。

当前推荐的后续实现形态：保留纯文本 `summary` 兼容面；把切点、预算、裁剪结果和恢复引用放在 checkpoint 旁路 metadata；候选优先来自本轮实际成功读取/修改的文件；默认注入有界引用清单，只有通过授权、版本校验、去重和总预算检查的短文本才有限推送正文。摘要中的新路径不能直接触发任意文件读取。

### 已拍板：恢复材料默认政策

- **默认恢复形态**：采用“引用清单 + 有限正文”。压缩后先注入有界引用清单；仅对本轮成功读取/修改、通过授权、版本、去重和 token budget 校验的短文本，允许有限正文注入。
- **候选文件范围**：采用保守默认，仅允许本轮实际成功读取、修改或生成 diff 的文件。用户未另行选择扩大范围，因此摘要文本中的新路径不能直接触发文件读取。
- **校验失败策略**：文件不存在、已变化、目标 Project 未打开或超预算时只记录 trace 并跳过，不向模型写入缺失 marker。

这组政策优先保证不会因为恢复材料重复或陈旧再次填满上下文；以后可以在不改变 Session Summary 兼容面的前提下扩展候选来源。

### 2026-08-13：输出形态调研完成

- 三个只读子代理分别核对 Claude Code/Anthropic、Pi/OpenCode/Codex/Cursor 和 NeuroBook 文件授权能力；结果均已回收，没有修改业务代码。
- 已验证结论：没有公开稳定的“摘要模型自由选择文件并直接注入”协议；Anthropic API 的 compaction block 是纯文本，Claude Code 的文件恢复来自规则重注入、按需读取和版本相关实现细节。
- 设计约束收敛为“Compaction Summary + Compaction Checkpoint + 受验证 Recovery Material”，而不是把文件全文塞进摘要或把摘要中的路径当执行指令。
- 待用户确认后再冻结默认恢复政策；本轮不实现代码，不把建议方向写成已完成合同。


## TODO / Follow-ups

- [x] 读取 Claude Code 公开文档、可验证源码镜像和版本信息，区分“压缩后重注入持久规则”与“摘要模型选择文件”。
- [x] 盘点 NeuroBook Project File Address、Attachment、HistorySet、ModelContext 和 file tool 的授权/大小/版本合同。
- [x] 形成 recovery material schema、注入时机、版本校验和失败策略的候选方案，并明确需要用户拍板的产品取舍。
- [ ] 用户确认恢复材料默认是引用清单还是有限正文推送，并确认候选文件范围与失败提示策略。
- [ ] 设计摘要输入 budget、tool output prune、overflow recovery、thrashing guard 和 pre-provider admission 的实现方案。
- [ ] 先写超窗/失败/最终请求前门禁回归测试，再实现代码。
- [ ] 完成 focused tests、typecheck、真实 provider smoke、长 session / trace 验收后更新 `PROJECT-STATUS.md`。

## Verification / Test

### 已运行

- `bunx vitest run server/agent/harness/compaction.test.ts server/agent/harness/prepare-next-turn.test.ts server/agent/harness/run-frame-state.test.ts --reporter=dot`
  - `3 files / 19 tests passed`。
- Faux Provider 最小复现已确认摘要请求可超出窗口并且失败时不写 compaction entry。

### 本任务验收目标

- 压缩摘要输入永不以无界全量字符串直接请求 provider；输入超预算有可观测的裁剪、分段、重试或安全降级证据。
- 首次请求、下一 Turn、steer、HistorySet reinjection、approval resolution 和大工具结果均在最终 provider 请求前接受窗口检查。
- 摘要失败、压缩后无进展和 provider overflow 均有明确且可恢复的结果，不破坏 tool call / toolResult 配对或 approval resume。
- 如采用恢复材料，测试验证路径授权、文件不存在/变更、大小上限、重复注入、branch 切换和压缩后 token 预算。
- 相关 focused tests、typecheck、真实 provider smoke / trace 和长 session 行为分别如实记录；任何未运行的检查明确标记。

## Implementation Walkthrough

### 2026-08-13：任务建立与初始诊断

- 创建 Task 147，记录当前 compaction 调用边界、摘要超窗复现、Pi/OpenCode/Codex/Claude Code 参考方向。
- 本轮只读诊断，没有修改业务代码。
- 新增调研问题：Claude Code 的“预注入文件”是公开稳定合同、内部实现细节，还是用户通过 CLAUDE.md / rules / `/compact` instructions 实现的近似能力；NeuroBook 是否应将其建模为恢复材料引用而非自由文件注入。

## TODO / Follow-ups

- [ ] 读取 Claude Code 公开文档、可验证源码镜像和版本信息，区分“压缩后重注入持久规则”与“摘要模型选择文件”。
- [ ] 盘点 NeuroBook Project File Address、Attachment、HistorySet、ModelContext 和 file tool 的授权/大小/版本合同。
- [ ] 形成恢复材料 schema、注入时机和失败策略的候选方案，并明确哪些需要用户拍板。
- [ ] 设计摘要输入 budget、tool output prune、overflow recovery、thrashing guard 和 pre-provider admission 的实现方案。
- [ ] 先写超窗/失败/最终请求前门禁回归测试，再实现代码。
- [ ] 完成 focused tests、typecheck、真实 provider smoke、长 session / trace 验收后更新 `PROJECT-STATUS.md`。
