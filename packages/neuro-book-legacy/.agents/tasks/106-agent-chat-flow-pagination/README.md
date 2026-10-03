# Agent Chat Flow Snapshot 分页

> 当前状态：实现中（分页Interface与前端合并已本地完成；等待Task 107/108/109合并后的Product证据与浏览器长Session验收）。

## 2026-07-19：104–109集成复核

- 生产代码未发现重新公开raw`snapshot.entries`的旁路；history继续只输出`AgentChatEntryDto`。
- durable tool-call identity现在在Stored Codec、history projector、live event与HTTP resolution/ack入口共用同一512 UTF-8 byte Module，非法历史数据fail closed。
- 当前Repository仍需完整读取JSONL并投影active path，因此复杂度仍为O(session file size)；30组/256 KiB只约束网络窗口与前端常驻历史，不宣称服务端O(page)。
- 本轮history/session query/frontend聚焦回归已通过；真实cold/hot、读取bytes、内存与浏览器滚动证据仍沿用待办，不增加未经benchmark证明的索引或cache。
- 本轮104/105/107/109安全与事务整合没有修改分页endpoint、DTO、opaque cursor或Repository seam；尚未重新取得长Session性能样本，因此不更新既有复杂度结论或宣称新的性能收益。

## Relative documents refs

- [Agent Runtime Event OOM 与 SSE 内存边界](../107-agent-event-memory-boundaries/README.md)
- [Agent 图片附件引用与持久化](../108-agent-image-attachment-references/README.md)
- [Agent SSE Front-End Contract](../14-agent-sse-front-end-contract/README.md)
- [Agent Session Management](../15-agent-session-management/README.md)
- [Agent Session Tree UI](../49-agent-session-tree-ui/README.md)
- [Harness Contract / SSE Recovery](../62-harness-contract-sse-recovery-fixes/README.md)
- [Agent Command Performance](../74-agent-command-performance/README.md)
- [GitHub Issue #6](https://github.com/notnotype/neuro-book/issues/6)
- [参考 PR #7](https://github.com/notnotype/neuro-book/pull/7)

## User Request / Topic

- 长 session 的 append-only history 会让 `GET /api/agent/sessions/:id` 返回数 MB JSON，服务端部署和弱网络下打开、刷新、recovery 很慢。
- 保留原有 `GET /api/agent/sessions/:id` 作为唯一 session recovery/history 查询入口；不拆 `/entries`、`/tree`、`/context-usage` 等 GET 端点。
- 首屏只加载最近历史；用户在 `AgentChatFlow.vue` 向上滚动接近顶部时，继续加载更早历史并保持视口。
- PR #7 仅作参考，不合并其中 Markdown 编辑器、文件下载、安装脚本、Config、invocation recovery 等无关修改。
- Task 107 已完成 live runtime/SSE OOM 治理；Task 106 直接复用其公开 `AgentChatEntryDto`。
- 图片 base64 的 JSONL/Provider 引用改造由 Task 108 负责，本任务不实现附件存储或 hydration。

## Goal

将 Agent Chat Flow 的 recovery snapshot 与历史查询统一成一个小接口、深实现的分页模块：

- recovery snapshot 返回当前 session shell、lightweight tree 和最近一页 `AgentChatEntryDto`。
- history page 通过服务端 opaque cursor 向前读取，不重建或重复传输 snapshot shell。
- Task 107 的中央 projector 是 HTTP/SSE 唯一公开 entry 投影；JSONL 和模型上下文仍使用内部 `SessionEntry`。
- `messages`、raw `entries` 和重复兼容字段退出公开 snapshot。
- retry/tree/edit 等 active path mutation 不再内嵌 snapshot；所有历史恢复统一走 GET。
- 前端 revision-aware prepend，无重复、无遗漏、无迟到响应串 session，并保持滚动锚点。
- System Prompt 默认不在 recovery 中构建；只有显式请求时才生成。

以公共 HTTP API、session store 和 Chat Flow 行为测试验证；若现有 `AgentChatEntryDto` 无法表达历史 UI 所需内容，先修中央 projector，不在 snapshot 路径建立第二套 DTO。

## Current Architecture Map

```text
Append-only JSONL SessionEntry truth
    ├─ Provider context: repo.reduce() -> internal AgentMessage[]
    ├─ Session Tree: repo.tree() -> lightweight SessionTreeNode[]
    └─ Public Chat Flow: projectAgentChatEntry() -> AgentChatEntryDto
            ├─ Task 107: live session_entry / runtime SSE
            └─ Task 106: recovery snapshot / history page

GET /api/agent/sessions/:id
    -> agent/http
    -> NeuroAgentHarness session query
    -> recovery shell or history page
    -> useAgentSessionApi
    -> useAgentSession / useAgentSessionStream
    -> AgentChatSurface
    -> AgentChatFlow
```

职责边界：

- `JsonlSessionRepository`：append-only truth、active path、tree、reduce。
- `projectAgentChatEntry()`：内部 entry 到公开 Chat Flow DTO 的唯一边界。
- Task 107：live delta、public event、replay、subscriber、SSE backpressure。
- Task 106：durable history window、cursor、recovery merge、滚动分页。
- Task 108：图片 attachment ref 与 Provider hydration。

## Diagnosis / Evidence

### 旧 raw snapshot 样本（2026-07-13）

| Session | Raw active path | Raw provider messages | Tree |
| --- | ---: | ---: | ---: |
| 94 | 10.25 MB / 285 entries | 10.18 MB | 107 KB / 285 nodes |
| 61 | 1.51 MB / 70 entries | 1.49 MB | 25 KB / 72 nodes |
| 41 | 1.32 MB / 20 entries | 1.32 MB | 6 KB / 20 nodes |
| 160 | 61 KB / 18 entries | 57 KB | 323 KB / 851 nodes |
| 324 | 761 KB / 217 entries | 692 KB | 86 KB / 228 nodes |
| 489 | 648 KB / 126 entries | 620 KB | 54 KB / 133 nodes |

### Task 107 projector 落地后的公开 history（2026-07-15）

| Session | Projected entries | Projected bytes | 最近 30 显示组 | 最大单 entry |
| --- | ---: | ---: | ---: | ---: |
| 94 | 234 | 537 KB | 61 KB / 45 entries | 17 KB |
| 61 | 56 | 114 KB | 102 KB / 50 entries | 17 KB |
| 41 | 17 | 24 KB | 24 KB | 9 KB |
| 160 | 13 | 55 KB | 55 KB | 12 KB |
| 324 | 166 | 775 KB | 244 KB / 56 entries | 45 KB |
| 489 | 95 | 680 KB | 465 KB / 67 entries | 49 KB |

结论：

- Task 107 已解决公开图片 base64 和单 entry 无界问题；Task 106 不应再设计 64 KiB tool-result 截断。
- Task 107 最终收口后，recovery/history 复用的 assistant entry 使用单条 96 KiB 目标预算并公开 `omittedToolCalls`；pending user input 复用轻量 `AgentUserInputFormDto`，不再把设置系统的 resource-preset Markdown 带入 recovery。
- 完整 projected history 仍可达到 600–800 KB，分页仍必要。
- 最近 30 显示组通常在 24–244 KB，但 session 489 因一个 assistant 带多个 tool results 达到 465 KB；分页必须同时考虑显示组和服务端字节目标。
- `messages + entries` 是近似双份历史；provider `messages` 没有前端消费者，必须退出公开 DTO。
- tree 是独立维度。当前最大样本 851 nodes / 323 KB，但 branch switcher 与 Session Tree Dialog 依赖它；本轮保留 lightweight tree，不顺手设计 tree 分页。
- Task 74 曾记录 `snapshotSystemPrompt=2264.6ms`；它会加载 config/settings/home/catalog/skills、读取多个 Import 并编译动态 profile prompt，不能留在普通 recovery 热路径。

## Final API Design

### 1. Endpoint 与判别查询

唯一入口：

```http
GET /api/agent/sessions/:sessionId
```

同一 endpoint 使用严格的 `view` 判别查询，不增加同义子路由：

```typescript
type AgentSessionQueryDto =
    | {view?: "recovery"}
    | {view: "history"; cursor: string}
    | {view: "systemPrompt"};
```

请求形态：

```http
GET /api/agent/sessions/123
GET /api/agent/sessions/123?view=history&cursor=...
GET /api/agent/sessions/123?view=systemPrompt
```

前端只暴露三个强类型调用，不让通用 `$fetch` 的 query union 扩散到调用者：

```typescript
getSessionRecovery(sessionId)
getSessionHistory(sessionId, cursor)
getSessionSystemPrompt(sessionId)
```

用户已确认删除 Session Tree 节点详情能力。Tree Dialog 保留 lightweight tree、preview/status、结构审计和分支切换，不再按节点读取 thinking、tool result、compaction/custom details。不得为已删除功能保留 raw `entries` 或 entry detail 查询。

不提供：

- `offset`
- `beforeEntryId`
- `activePathRevision`
- `maxBytes`
- 客户端可调 page size
- 宽松 boolean query 或可非法组合的 `cursor/include`

原因：cursor 应隐藏 active path revision、显示组边界和内部 entry ID；分页数量/字节预算是服务端策略，不是客户端协议。`view` 判别让 schema 在入口拒绝 `cursor + systemPrompt` 等非法组合，而不是把组合规则散落到 handler。

### 2. Opaque cursor

cursor 是版本化、base64url 编码的服务端值，内部至少包含：

```typescript
type AgentHistoryCursorV1 = {
    version: 1;
    sessionId: number;
    activePathRevision: string | null;
    beforeEntryId: string;
};
```

- 客户端只保存并原样回传。
- cursor 的 sessionId 必须匹配路由参数。
- 当前 `activePathRevision` 与 cursor 不一致：`409 ACTIVE_PATH_CHANGED`。
- entry 不存在、不属于 active path 或不是合法分页边界：`400 INVALID_HISTORY_CURSOR`。
- 普通尾部 append 不改变 revision，旧 cursor 继续有效。
- cursor 不包含正文，不需要加密；必须限制长度和严格解析版本。

### 3. Response union

```typescript
type AgentSessionQueryResultDto =
    | AgentSessionRecoveryDto
    | AgentSessionHistoryPageDto
    | AgentSessionSystemPromptDto;

type AgentChatHistoryPageDto = {
    /** 从旧到新排列的逐 entry DTO。 */
    entries: AgentChatEntryDto[];
    /** 为空表示已到 active path 起点。 */
    previousCursor: string | null;
};

type AgentSessionRecoveryDto = {
    kind: "recovery";
    eventCursor: AgentEventCursorDto;
    summary: AgentSessionSummaryDto;
    summarizer?: AgentSessionSummarizerStateDto;
    activeLeafId: string | null;
    activePathRevision: string | null;
    history: AgentChatHistoryPageDto;
    tree: SessionTreeNode[];
    linkedAgents: AgentLinkedSessionDto[];
    linkedByAgents: AgentLinkedSessionDto[];
    pendingUserInputs: AgentPendingUserInputDto[];
    steerQueue: AgentQueuedMessageDto[];
    followUpQueue: AgentFollowUpQueueStateDto;
    activeInvocation: AgentActiveInvocationDto | null;
    model: AgentSessionLiveStateDto["model"];
    thinkingLevel: ThinkingLevel | null;
    effectiveThinkingLevel: ThinkingLevel;
    agentMode: AgentMode;
    contextUsage?: AgentSessionContextUsageDto;
};

type AgentSessionHistoryPageDto = {
    kind: "history";
    sessionId: number;
    activePathRevision: string | null;
    history: AgentChatHistoryPageDto;
};

type AgentSessionSystemPromptDto = {
    kind: "systemPrompt";
    sessionId: number;
    systemPrompt: string;
};
```

### 4. Removed snapshot fields

硬切删除：

- `eventEpoch`：与 `eventCursor.eventEpoch` 重复。
- `latestSeq`：仅调试用途，不应成为公开恢复合同。
- `lastSeq`：与 `eventCursor.after` 重复的兼容字段。
- `messages`：provider context，不属于 UI snapshot。
- `entries`：raw `SessionEntry[]`，替换为 `history.entries: AgentChatEntryDto[]`。
- `pendingApprovals`：它是已 deprecated 的重复字段；snapshot、live state 和前端统一使用 `pendingUserInputs`。
- 顶层 `usage`：与 `summary.usage` 重复，前端已经消费 `summary.usage`。

不保留 legacy DTO 或兼容 fallback；同步迁移所有调用者和测试。

### 5. Server pagination policy

策略集中在一个模块，不进入 HTTP query：

```typescript
const AGENT_HISTORY_PAGE_MAX_GROUPS = 30;
const AGENT_HISTORY_PAGE_TARGET_BYTES = 256 * 1024;
```

- 从 active path 尾部向前组装显示组。
- assistant 与其连续 tool results 不从中间切开。
- compaction、branch summary、visible custom message、invocation error 是独立组。
- 返回至少一个完整组；字节数是目标上限，单个完整组超过目标时允许单组返回。
- Task 107 已约束单 entry；Task 106 不重新截断 entry。
- page builder 返回 flat `AgentChatEntryDto[]`，显示组仅是服务端分页实现，不进入 live transport DTO。
- 默认 30 groups 是基于真实样本的起点；后续调整不改变 API。

### 6. Recovery vs history construction

Recovery 请求构建：

- readSession / reduce / profile runtime
- live shell
- relations
- lightweight tree
- 最近 history page
- context usage
- 不构建 system prompt

History 请求只构建：

- readSession
- active path revision 校验
- public history page

History 请求不得调用：

- `snapshotSystemPrompt()`
- `sessionContextUsage()`
- `sessionRelations()`
- profile home/settings/catalog/skills prompt materialization

System Prompt 请求只构建 prompt 所需材料，不顺带返回 shell/history/tree。

### 7. Command/tree contract

`GET /sessions/:id` 是唯一 snapshot/recovery 生产入口。

- 轻 command：继续返回 `kind:"live_state"`。
- retry/tree/edit/delete/branch switch：执行 durable mutation 后返回最新 `AgentSessionLiveStateDto`，不内嵌 snapshot。
- 前端应用 live state；发现 `activePathRevision` 变化后，通过现有 snapshot single-flight 请求 recovery。
- `POST /tree` 如同时 invoke，返回 `{status, state, invocation?}`，不返回 snapshot。
- 删除 `AgentCommandResult.kind="snapshot"` 和 `AgentTreeResult.snapshot`。

这样避免 GET 有界而 command/tree 仍回传全量历史的双轨设计。

## Front-End State Design

`useAgentSession` 内部分离但不额外建立大型 store：

- recovery shell：summary/model/queues/pending/tree/revision/cursor。
- durable history：按 ID 去重的 `AgentChatEntryDto[]`。
- live overlay：Task 107 runtime delta。
- optimistic user messages。
- System Prompt view：独立于 durable history 的按需 UI state。

行为：

- initial recovery：替换 shell 和尾页，定位底部。
- same-revision recovery：保留已经加载的更早页，替换重叠尾页并合并 live/optimistic overlay。
- revision changed：清空旧 history，使用新 active path 尾页重建。
- history response 到达时，校验 sessionId、请求 cursor 和当前 revision；不匹配则丢弃。
- `AgentChatFlow.vue` 距顶部约 160 px 时触发加载。
- 同一 cursor single-flight。
- prepend 前后按 `scrollHeight` 差值恢复视口。
- 保留显式加载/失败重试按钮；到达起点后隐藏。
- 历史 prepend 不改变 `shouldStickToBottom`。
- System Prompt 使用独立折叠卡/查看动作，不再投影成 history 中的虚拟 system message；单次 session 打开期间可保留已加载结果，切换 session 或显式刷新时失效。

## Architecture Impact Review

### Blocking — Preview 消息不能直接编辑保存

`AgentChatEntryDto` 的 user/assistant 正文是 `PublicTextPreviewDto`。当前 `AgentTextBubble` 编辑动作会把前端 `message.content` 直接提交为新正文；若 `omitted=true`，保存会把截断预览永久写回 JSONL。

本轮最小安全合同：

- 前端 `AgentMessage` 保留 `contentBytes/contentOmitted`；
- omitted 历史消息禁止进入可保存编辑态，并明确提示“当前仅展示预览”；
- 复制动作说明复制的是预览；
- 如果未来要求编辑完整超长正文，必须另行设计受控原文查询，不允许从 preview 反推原文，也不在本任务预留半成品 Interface。

### Blocking — Recovery snapshot 与 Event cursor 的原子可恢复语义

若 recovery 先读取 JSONL、再获取 EventHub cursor，二者之间新写入的 durable entry 可能既不在 snapshot 中，又被 cursor 跳过。Recovery builder 必须先捕获 replay-safe cursor/anchor，再读取和投影 JSONL；其后事件允许与 snapshot 重复，由前端按稳定 entry ID 去重。

必须有公开 Harness/route 竞态测试：在 cursor 捕获与 snapshot read 之间 append/publish，最终前端不得丢 entry。

### Resolved — 删除 Session Tree 节点详情

当前 `AgentSessionTreeDialog.vue` 不只消费 `tree`：选中节点后还从 raw `snapshot.entries` 读取 assistant thinking/tool calls、tool result、compaction details、custom/variable data。用户已确认删除这部分 raw entry 内容详情。迁移后：

- tree 行、branch switcher 仍可工作；
- Tree Dialog 继续展示 `SessionTreeNode` 已有的 preview/status/role/time/branch/parent/childCount 等结构元数据；
- 删除正文、thinking、tool result、compaction/custom data 等 raw entry 内容详情及其 projection、lookup 和测试；
- “切换到此节点”、复制 entry ID、搜索、折叠等只依赖 tree 的操作继续保留；
- Task 49 的结构审计、折叠、搜索、branch switcher 继续保留。

这是明确的产品删减，不建立 `view=entry`，不能把 raw `entries` 继续塞回 recovery，也不能让前端解析 JSONL/parent 链。

### Important — 服务端读取复杂度

当前 `JsonlSessionRepository.readSession()` 每次都会完整读取和解析 JSONL。history page 虽然减少响应体，但仍可能是 O(session file size)：

- session 94 的约 10 MB 文件每一页都可能重新解析；
- cursor 只减少 projection/serialization，不自动减少 repository read cost；
- 本任务必须记录冷/热 `readSession`、reduce、project、serialize timing，不能把“分页”描述成服务端 O(page) 查询。

如果真实热路径仍不可接受，再单独设计 append-only repository index/cache；不要在本任务临时加入无失效规则的全局 Map。

### Important — Recovery shell 仍不是小对象

recovery 继续返回 lightweight tree、relations、pending input、context usage 和 model。它比 raw history 小很多，但 tree 可以随分支数增长，context usage 仍要扫描完整 provider context。实现后应分别记录字段 bytes；任何一个字段成为主瓶颈时另开设计，不把所有内容继续塞进 history page。

### Moderate — 其他调用者影响

- `ProfileTemplateVisualEditor.vue` 当前调用 `getSession()` 后丢弃结果；应迁移到真正的 scope/存在性读取 Seam，避免无意义 recovery。
- Inline Editor 复用同一 session store/stream，但没有历史分页入口；它应只消费 recovery 尾页，不共享主 Chat Flow 的 history window。
- Harness 中约 73 个 `getSessionSnapshot()` 测试调用直接检查 raw entries；应迁移到 `JsonlSessionRepository.readSession()` 或 public query seam，不能为了测试保留旧公开 DTO。
- `pendingUserInputs/pendingApprovals`、`eventCursor/lastSeq/eventEpoch` 等重复字段必须同步迁移 live state、snapshot、command result 和前端 fixture，不能只改 GET DTO。

### Important — 前端真相层与 cursor 所有权

分页后 `AgentMessage[]` 不能继续作为 durable history 真相。`useAgentSession` 必须明确维护：

- recovery shell；
- 按 active path 顺序、稳定 ID 去重的 `durableEntries: AgentChatEntryDto[]`；
- 当前最老已加载页的 `previousCursor`；
- live overlay；
- optimistic messages。

same-revision recovery 只能替换重叠尾页，必须保留已加载旧页及其最老 cursor；不能用新尾页 cursor 覆盖，否则会重复翻页。History prepend 后再统一投影 durable messages，不能复用只支持尾部 append 的 live reducer。

### Important — HTTP active-path mutation 必须显式触发 recovery

当前 `applyLiveState()` 只设置 `needsSnapshot`，真正的 `syncSnapshot()` 由 SSE handler 驱动。tree/retry/edit 改为只返回 live state 后，HTTP result applicator 必须：

```text
apply live state -> 判断 revision change -> 进入同一个 snapshot single-flight
```

不能依赖随后“可能到达”的 SSE。HTTP 与 SSE 同时报告 revision change 时仍只能有一次 recovery。

### Important — Query 组合必须由 schema 判别

- `view=history` 的 cursor 与 `view=systemPrompt` 由判别 schema 严格互斥；缺少必填参数或携带额外模式参数时返回明确 400。
- opaque cursor 的 base64url 只是编码，不是完整性保护；服务端仍必须验证 sessionId、revision、active path membership 和合法推进边界。
- raw active path 中 projector 可能返回 null；page builder 必须跨过不可见账本 entry 且保证 cursor 每页推进，禁止空页死循环。
- assistant/tool result 分组优先按 toolCallId 所属关系确认，不只依赖表面连续性。

## Error Contract

```typescript
type AgentHistoryErrorCode =
    | "INVALID_HISTORY_CURSOR"
    | "ACTIVE_PATH_CHANGED";
```

- `INVALID_HISTORY_CURSOR`：HTTP 400，显示局部重试/刷新入口，不静默回最新页。
- `ACTIVE_PATH_CHANGED`：HTTP 409，前端自动触发一次 recovery，并用局部说明告知历史分支已变化。
- Project 未 open 继续使用现有 `PROJECT_NOT_OPEN` 409。
- history 加载失败是 Chat Flow 局部可恢复状态，不使用全局成功通知。

## Scope

### In scope

- query schema、opaque cursor、recovery/history response union。
- 复用 Task 107 `AgentChatEntryDto` 的 active path projector/page builder。
- snapshot DTO 去重与所有调用者迁移。
- GET、retry/tree/edit 等入口的唯一 recovery 合同。
- `useAgentSessionApi`、`useAgentSession`、`useAgentSessionStream`。
- `AgentChatSurface.vue`、`AgentChatFlow.vue` 的向上分页和滚动锚点。
- payload/timing 基线、API/reducer/组件测试。

### Out of scope

- 图片 attachment ref、迁移和 hydration：Task 108。
- SSE/replay/backpressure：Task 107。
- Session Tree UI 重设计或 tree 分页。
- System Prompt 缓存；本轮只改为显式按需构建。
- Agent session 列表分页：Task 73。
- Markdown 编辑器、下载、安装、Config、依赖升级。
- 浏览器验证，除非用户后续明确授权。

## Systematic TDD Implementation Plan

实现遵循纵向 tracer bullet：每个 Slice 先增加一条穿过公共 Interface 的失败行为测试，再写最小实现，转绿后才重构。禁止先批量创建 DTO shape 单测，也禁止通过保留旧 snapshot 双轨让测试暂时通过。

### Phase 0 — Interface freeze 与基线

- 决策：冻结 `recovery/history/systemPrompt` 三种判别查询、response union、错误码和删除字段；记录删除 Tree 节点详情的产品决策。
- 基线：记录 session 94/160/324/489 的 `readSession`、reduce、project、serialize、response bytes、tree node/bytes。
- 代码地图：列出所有 `getSessionSnapshot()`、`getSession()`、command/tree snapshot 消费者及约 73 个依赖 raw entries 的测试。
- 退出条件：不存在未归类调用者；文档明确 recovery history 有界，但 whole recovery 因 tree/context usage 暂非严格有界。
- 不做：业务实现、全局缓存、JSONL index、tree 分页。

### Slice 1 — 深化 Session Query Module

- RED：通过真实 route/harness 分别请求三种 view；非法参数组合返回 400；普通 recovery 无 raw `messages/entries`、重复 cursor/usage/pending 字段。
- GREEN：把 query/response DTO 迁入 `shared/dto`，建立单一 Session Query Module；HTTP handler 只做 schema 解析和错误映射。
- 迁移：`ProfileTemplateVisualEditor.vue` 改用真正需要的轻量存在性/作用域 Interface，不再无意义构建 recovery。
- 退出条件：三个 typed client 方法闭合；删除 command/tree 从前端反向导入 harness types 的依赖。
- 不做：分页算法、滚动 UI、repository 优化。

### Slice 2 — Recovery shell 与 durable history 真相层

- RED：初始 recovery 只用新 DTO 即可恢复 shell、尾页、运行态；same-revision recovery 保留已经加载的旧页和最老 `previousCursor`；revision changed 才清空旧 history。
- GREEN：`useAgentSession` 内明确维护 `recoveryShell`、`durableEntries`、`previousCursor`、`liveOverlay`、`optimisticMessages`，统一按稳定 entry ID 合并。
- 退出条件：Inline Editor 只消费尾页；Agent Chat Surface 可在无 raw entries/provider messages 下打开；live overlay 最终可被 durable entry 收敛。
- 不做：向上滚动触发。

### Slice 3 — Opaque cursor 与基础 history page

- RED：使用 recovery cursor 连续请求两页，无重叠、无遗漏、顺序稳定；history response 不包含 shell/tree/relations/context usage。
- GREEN：实现版本化 cursor codec、长度限制、sessionId/revision/active-path membership/分页边界校验。
- 退出条件：合并全部页后等于当前 active path 的完整中央公开投影；普通尾部 append 后旧 cursor 仍有效。
- 不做：加密 cursor、客户端 page size、offset/beforeEntryId 公共参数。

### Slice 4 — 显示组、字节目标与不可见 entry 推进

- RED：assistant 与其 tool results 按 toolCallId 归组且不被拆开；projector 返回 null 的 entry 被跨过；每页 cursor 必须推进，不出现空页死循环；超大单组允许独页。
- GREEN：在 Session Query Module 内实现内部显示组 builder，集中使用 30 groups / 256 KiB target，公开结果仍是 flat entries。
- 退出条件：页首无孤立 tool result；session 489 的超大组行为明确；预算常量不泄漏到 HTTP Interface。
- 不做：第二套 projector、对 entry 再截断、把显示组变成 live DTO。

### Slice 5 — Recovery cursor 并发正确性

- RED：在捕获 cursor 与读取 JSONL 之间 append/publish durable entry，应用 recovery + replay 后该 entry 至少出现一次且最终按 ID 去重，不得丢失。
- GREEN：recovery builder 先捕获 replay-safe cursor/anchor，再读取 session truth；重复交付交给 durable merge 去重。
- 退出条件：Task 14/62 的 seq gap、snapshot_required、event epoch、single-flight 契约保持成立。
- 不做：跨 EventHub/JSONL 的分布式事务或全局锁。

### Slice 6 — Tree 详情删除与 omitted 编辑保护

- RED：Tree Dialog 在没有 raw entries 时仍可展示结构元数据并完成 tree row、搜索、折叠、复制 ID 和 branch switch；`contentOmitted=true` 的消息不能保存编辑，复制明确是预览。
- GREEN：删除 Tree Dialog 的 raw entry 内容详情及 lookup，保留只依赖 `SessionTreeNode` 的 inspector/action；前端编辑入口依据 DTO 元数据禁用，不从 preview 反推完整正文。
- 退出条件：Task 49 的结构审计与 branch switcher 不退化；raw entry 内容详情相关状态、projection 和测试被删除；公开响应不出现 raw details/provider metadata。
- 不做：完整超长正文编辑、图片 hydration、Tree UI 重设计。

### Slice 7 — Active-path mutation 统一 recovery

- RED：retry/tree/edit/delete/branch switch 只返回 live state；HTTP 与 SSE 同时报告 revision change 时只触发一次 recovery；迟到的旧 session recovery 不可回写当前 session。
- GREEN：删除 `AgentCommandResult.kind="snapshot"` 和 `AgentTreeResult.snapshot`，所有入口调用同一个 reason-aware snapshot single-flight。
- 退出条件：GET 是唯一 recovery/history 生产入口；Task 74 command 轻路径保持轻量。
- 不做：靠“随后可能到达的 SSE”隐式同步。

### Slice 8 — Chat Flow prepend transaction

- RED：距顶部阈值只对同一 cursor 发起一个请求；prepend 后首个可见锚点位置不变；迟到、旧 revision、旧 session response 被丢弃；失败可局部重试。
- GREEN：`AgentChatFlow.vue` 只发出 load-previous 意图；宿主执行 cursor single-flight、revision guard 和 `scrollHeight` anchor transaction。
- 退出条件：自动加载、显式重试、到起点停止、自动吸底互不干扰；历史加载错误留在 Chat Flow 局部。
- 不做：虚拟列表。只有真实 DOM/内存测量证明必要时另行设计。

### Slice 9 — System Prompt 独立按需视图

- RED：普通 recovery/history 均不调用 prompt build seam；只有用户展开独立 System Prompt 视图时请求 `view=systemPrompt`；结果不进入 durable entries，也不改变历史滚动锚点。
- GREEN：将现有 prompt materialization 放到独立判别分支；前端维护 session-local loading/error/value，切换 session 或显式刷新时清除。
- 退出条件：普通 recovery 的 `snapshotSystemPrompt=0`；System Prompt 功能保持可用且不伪装成历史消息。
- 不做：服务端 prompt cache、预热或跨 session 持久缓存。

### Final Phase — 回归、性能与 walkthrough

- 回归：公共 route/harness、Task 107 projector、Task 14/62 recovery、Task 49 tree、Task 74 command、前端 durable merge/scroll tests、typecheck。
- 真实只读 smoke：session 94/160/324/489 至少翻两页，记录 response bytes 和阶段 timing；确认 history page 不构建 prompt/context/relations。
- 复杂度结论：明确报告分页后的网络/前端收益与仍为 O(session file size) 的 repository 读取成本。只有测量不达标才提出独立 index/cache 任务。
- Walkthrough：逐项记录实际结果、预算调整、删除/迁移的测试，以及与本计划的偏差；浏览器验证仍需用户另行授权。

## Verification

- [x] route/harness 公共 Interface tracer bullets 全部通过。
- [x] Task 107 public projection tests 保持通过。
- [x] Task 14/62 recovery、seq gap、event epoch、single-flight 回归通过。
- [x] Task 49 tree/branch switcher 回归通过。
- [x] Task 74 command live-state 回归通过。
- [x] session 94/41/160/324/489 只读 smoke 记录新 response bytes 与 timing。
- [x] 普通 recovery 不包含 base64、raw entries 或 provider messages。
- [x] history page 不构建 system prompt/context usage/relations。
- [x] typecheck 通过。
- [ ] 用户授权后再做真实浏览器长 session 向上滚动验收。

## Implementation Result（2026-07-15）

### Interface 与后端

- `GET /api/agent/sessions/:id` 已硬切为 `recovery/history/systemPrompt` 三种严格判别 query；非法组合返回 `400 INVALID_SESSION_QUERY`。
- recovery 只返回 shell、lightweight tree 和最近 history page；已删除 raw `messages/entries`、System Prompt、重复 cursor、顶层 usage 和 `pendingApprovals`。
- 新增版本化 opaque cursor 和集中 history page builder：30 显示组 / 256 KiB target，assistant 与所属 tool results 不拆分，不可见账本 entry 可跨过且 cursor 必须推进。
- cursor 严格校验版本、长度、session、active path revision 和分页边界；session/格式错误为 `400 INVALID_HISTORY_CURSOR`，revision 变化为 `409 ACTIVE_PATH_CHANGED`。
- recovery 在读取 JSONL 前捕获 EventHub replay-safe cursor，建立“允许重复、禁止遗漏”的恢复顺序；前端按稳定 entry ID 去重。
- history 分支只读取 session truth 并构建 page，不构建 prompt、relations、context usage 或 recovery shell。
- System Prompt 只在 `view=systemPrompt` 时构建；普通 recovery 的 `snapshotSystemPrompt` timing 为 0。
- retry/tree/edit 等 active-path mutation 只返回 live state；删除 command/tree 内嵌 recovery。Harness Interface 统一命名为 `getSessionRecovery/getSessionQuery`，旧 Snapshot DTO/方法无残留。

### 前端状态与交互

- `useAgentSession` 真相层已拆为 `recoveryShell`、`durableEntries/durableRevision`、`previousCursor`、`liveOverlay` 和 `optimisticMessages`。
- same-revision recovery 保留已加载旧页与最老 cursor；revision changed 重建 durable history；history/systemPrompt 请求均具备 session generation、single-flight 和迟到响应保护。
- HTTP mutation 与 SSE revision change 进入同一个 reason-aware recovery single-flight；history 409 也会自动 recovery。
- `AgentChatFlow.vue` 在顶部 160 px 自动加载，支持显式加载/局部失败重试，并用 prepend transaction 保持视口；transaction 期间显式抑制短列表的自动吸底。
- System Prompt 改为独立按需 panel，不再伪装成历史消息，也不影响历史顺序和滚动锚点。
- `contentOmitted` user/assistant 消息禁止编辑，复制按钮明确提示复制的是预览；Surface 再做一次保存前保护。
- Tree Dialog 删除 raw entry 的正文、thinking、tool result、compaction/custom data 内容详情，保留 lightweight tree 的结构元数据、搜索、折叠、复制 ID 和 branch switch。
- `ProfileTemplateVisualEditor.vue` 删除结果被丢弃的无意义 session recovery 请求；command/tree result DTO 不再从前端反向导入 Harness 内部类型。

### 真实 session smoke

| Session | readSession | active path | latest page | previous page | tree |
| --- | ---: | ---: | ---: | ---: | ---: |
| 94 | 25.32 ms | 285 entries | 45 / 60,858 B | 52 / 88,629 B | 285 / 106,883 B |
| 41 | 5.98 ms | 20 entries | 17 / 24,459 B | 无 | 20 / 6,276 B |
| 160 | 8.76 ms | 18 entries | 13 / 55,175 B | 无 | 851 / 323,171 B |
| 324 | 5.13 ms | 217 entries | 56 / 244,171 B | 58 / 258,833 B | 228 / 86,412 B |
| 489 | 7.95 ms | 126 entries | 45 / 214,672 B | 25 / 253,993 B | 133 / 53,737 B |

两页 history 投影耗时约 0.26–4.73 ms，序列化约 0.05–1.23 ms。该结果证明网络与前端常驻 history 已有界，但 repository 读取仍为 O(session file size)，tree 仍是独立增长维度；本轮没有据此添加缓存/index 或 tree 分页。

### Verification Result

- Task 106/107 公共查询、projection、前端状态/UI 聚焦回归：15 files / 93 tests passed。
- Agent Chat Surface 目录回归：16 files / 90 tests passed。
- Harness + black-box：2 files / 186 tests passed。
- Profile 受影响面单独重跑：5 files / 84 tests passed。
- `bun run typecheck` passed。
- 扩大到整个 `server/agent` 的回归为 69 files / 807 tests passed，另有 6 files / 11 tests failed：其中 6 项 SillyTavern card 测试缺少 `.agent/workspace/cards` 私有 fixture；其余 5 个 profile 测试是并行大套件超时/调度失败，单独重跑 84 tests 全绿。未为这些无关失败修改业务代码。

### 计划偏差

- 最终没有建立额外的通用 Session Query class/DI seam；查询逻辑集中在现有 Harness + `history-query.ts`，避免只有一个 adapter 的浅抽象。
- `ProfileTemplateVisualEditor.vue` 的旧调用结果完全未使用，因此直接删除，而不是为它新增存在性 endpoint。
- 浏览器验证仍未执行，符合任务 Out of scope；后续需要用户明确授权。

## Review Fix Result（2026-07-15）

本轮在实现后按 HTTP、history pagination、SSE recovery、optimistic UI 四条链重新审查，修复以下遗漏：

- `INVALID_HISTORY_CURSOR` 不再停留在不可重试状态：前端保留当前内容，请求既有 recovery single-flight；成功后以最新尾页和新 cursor 重置失效窗口并滚动到底部，失败时不提前清空。普通网络错误仍保留原 cursor 供局部重试。
- history 显示组改为按 `toolCallId` 归属形成 span。assistant 到其最后一个 tool result 之间的可见 entry 保持原始顺序并纳入同组；相交 span 合并，orphan tool result 独立，避免 system/lifecycle entry 插入后错误拆组。
- invocation、command、tree、abort 的公开 HTTP result DTO 已迁入 `shared/dto/agent-session.dto.ts`；Harness 只保留内部输入和运行模型。`reportResult.data` 在内部→公开边界校验为 JSON value，前端不再反向导入 Harness 类型。
- optimistic user message 改用本地唯一序列；live entry 与 recovery 都按出现顺序逐条消费同正文 optimistic message，不再一次删除全部重复文本。
- 删除无人使用的 `retryHistory()` 包装；`getSessionRecovery()` 注释与当前职责对齐。

本轮没有新增 endpoint、cursor rebase、cache/index、tree pagination、持久化 `clientMessageId` 或图片引用协议。invalid cursor 采用已确认的“恢复成功后重置到最新尾页”方案，没有引入复杂的视口保留协议。

### Review Fix Verification

- Agent Chat Flow、history query 与 Task 107 public projection：20 files / 127 tests passed。
- Harness、black-box、HTTP 与 shared result contract：4 files / 199 tests passed。
- `bun run typecheck` passed。
- 未执行浏览器验证；建议后续授权验证长 session 向上翻页、invalid cursor 重置后滚动到底部，以及短列表 prepend 锚点。

### Review Fix 计划偏差

- 实际审查额外发现不同 invocation 可能复用相同 `toolCallId`；owner map 若只按 toolCallId 建键会让后一个结果变成 orphan。实现已将 ownership key 收窄为 invocation + toolCallId，并补分页边界回归。
- recovery 成功后的滚动行为保留在 Surface 编排层，没有为单一调用抽取新的 helper/state machine；确定性状态由 composable 测试覆盖，真实滚动交互留给浏览器验收。
- 原计划要求的 HTTP wire shape 没有变化；本轮只移动 TypeScript 所有权并在内部→公开边界增加 JSON value 校验。

## Second Review Fix Result（2026-07-15）

第一轮完成审查后又沿 optimistic/recovery side-effect/shared abort client 三条链补齐以下遗漏：

- recovery 不再用尾页中的全部 user entry 消费 optimistic message。实现现在区分 durable revision 与显示窗口合并条件，只允许同 revision 下、本地此前未见过的 durable entry 按正文顺序收敛 optimistic；旧尾页重放和新分支历史不会误删刚发送的同文本消息。
- `applyRecovery()` 返回内部 `historyWindowReset` 结果。既有 stream side-effect seam 会等待该结果对应的异步副作用；invalid cursor 无论由 history HTTP 还是并发 SSE 首先完成 recovery，都只会在成功应用后滚动到底部一次。失败时不清空内容、不改变视口。
- stream recovery reason 显式识别 `invalid_history_cursor`；Surface 不再从可能被 recovery 清空的 reasons 数组推断滚动副作用。
- `abortSession()` 已使用 shared `AgentAbortResult` 作为 `$fetch` 返回类型，补齐四类公开 HTTP result 的前端合同。

### Second Review Verification

- optimistic、pagination、stream single-flight/side-effect、abort API：3 files / 25 tests passed。
- Task 106 history/command 与未受并行变更影响的 Task 107 projection 聚焦回归：8 files / 66 tests passed。
- 额外纳入 `public-event-projection.test.ts` 的最终审计为 76/77 passed；唯一失败是并行修改中的超大 Low-Code `formSpec` 当前抛出 `agent_user_input_form_too_large`，不属于本轮 optimistic/recovery/abort 改动。
- Harness/black-box/HTTP/shared contract 扩大回归共 199 tests，其中 180 passed、19 failed；失败均来自工作区另一组正在演进的 steer/follow-up queue 与 pending input public projection 形状，和本轮三个修复无关。
- workspace-wide `bun run typecheck` 同样被上述并行 DTO 演进阻断；本轮新增 fixture 唯一暴露的 `intent` 缺失已修复。未越界修改无关 queue/public-tool 代码。
- 未执行浏览器验证；仍建议验证 invalid cursor reset、长 session 向上翻页和短列表滚动锚点。

### Second Review 计划偏差

- 原计划期望全量 Harness 与 typecheck 全绿，但当前共享工作区存在无关且未收口的 DTO 变更，因此只能完成 scoped verification，不能把 workspace-wide gate 记录为通过。
- 没有为滚动新增第二套状态机，也没有扩展 `loadPrevious()` 返回协议；窗口重置意图通过既有 recovery apply/side-effect seam 传递。

## Third Review Fix Result（2026-07-15）

本轮继续沿公开投影与 recovery 交叉链审查，补齐两个遗漏：

- optimistic 消费现在使用公开 user content 的 `{preview, bytes, omitted}` 描述。未截断文本使用全文匹配；截断文本使用 UTF-8 总字节数相等且完整 optimistic 正文以公开 preview 开头，live entry 与 recovery 共用规则。长中文/emoji prompt 不再同时保留 optimistic 与 durable 两条消息。
- `historyWindowReset` 改为同一 session 的失效窗口是否被本次 recovery 替换，不再要求 revision 相同。因此 invalid cursor 后 active path 同时变化时仍会执行一次最新尾页滚动；普通 revision change、首次加载和 session 切换不触发该副作用。

### Third Review Verification

- pagination/optimistic/stream/abort/history/public projection：8 files / 71 tests passed。
- 最终 `bun run typecheck` 仅剩并行 queue DTO 迁移造成的 3 个 `write-plan.test.ts` fixture 错误（`steerQueue` 仍使用旧数组形状）；没有出现本轮新增的类型错误。
- 未执行浏览器验证；建议授权验证长 prompt、invalid cursor + branch change 和长 session 滚动。

### Third Review 计划偏差

- 使用浏览器原生 `TextEncoder` 计算 UTF-8 bytes，没有引入 Node `Buffer` 或新共享运行时工具。
- 没有扩展 JSONL、HTTP DTO 或 optimistic 持久化协议；仍采用当前串行 prompt 假设下的 preview-prefix + bytes 本地匹配。

## Architecture Guardrails

- 不新增同义 GET 端点。
- “Session Query Module”表示集中查询语义与实现 locality，不要求新增只有一个 adapter 的抽象 Interface、DI 层或 pass-through class。
- 不在前端解析 cursor、entry parent 链或 raw SessionEntry。
- 不复制 Task 107 projector/preview 常量。
- durable entries 与 pending formSpec 的预算继续完全由 Task 107 projector/validator 提供；Task 106 不在 history builder 或前端分页层二次截断。
- 不暴露客户端可调字节预算。
- 不为分页建立第二套 active path revision。
- 不保留新旧 snapshot DTO 双轨。
- 不改变 JSONL、模型上下文、compaction 或图片持久化语义。
- 不在本任务顺手分页 tree、缓存 prompt 或设计附件系统。

## Final Task Review（2026-07-15）

### 审查结论

Task 106 已达到可实施状态，没有未决的 Interface 或产品阻断。最终设计保持一个深 Session Query Module：调用者只学习三种严格 query、两种 history/recovery 合并规则和两个 cursor 错误；active path 读取、公开投影、分组预算、并发恢复和性能计时留在实现内部。

用户已确认删除 Session Tree 的 raw entry 内容详情，因此：

- 不建立 `view=entry`、detail DTO、detail cache 或相关错误码；
- 删除 raw `snapshot.entries` 后不会再有隐藏兼容消费者；
- lightweight tree 的结构审计、preview/status、搜索、折叠、复制 ID 和 branch switcher 必须保留。

### 实施影响面

- Shared DTO：session query/result、command/tree result、重复 snapshot 字段硬删除。
- Server：HTTP query schema、Harness recovery builder、history page builder、cursor codec、command/tree mutation result、timing instrumentation。
- Frontend state：`useAgentSessionApi`、durable entries/recovery shell/live overlay/optimistic message、snapshot single-flight。
- Frontend UI：Chat Flow prepend transaction、System Prompt 独立视图、omitted 编辑保护、Tree Dialog raw 内容详情删除。
- Tests：route/Harness public behavior、cursor/group/recovery race、frontend merge/scroll、Task 49/14/62/74/107 回归；直接检查 raw snapshot entries 的测试迁移到 repository truth 或公共 query Interface。
- Documentation：Task 49 的详情删减合同、Task 106 walkthrough、PROJECT-STATUS。

### 已接受的剩余风险

1. history page 仍需完整解析 JSONL，服务端复杂度暂为 O(session file size)；Task 106 只承诺降低网络响应和前端常驻历史。最终 smoke 必须报告真实 timing，不能宣称 O(page)。
2. recovery 仍包含完整 lightweight tree 与 context usage，whole recovery 不是严格常量大小；必须分别记录 tree nodes/bytes 和 shell 字段 bytes。
3. Task 108 完成前，历史 JSONL/Provider context 中仍可能存在图片 base64；Task 107/106 只保证它不进入公开 history/SSE 响应。
4. 单个完整显示组可超过 256 KiB target；这是保持 assistant/tool result 语义完整性的明确例外，不是预算失效。

### 实施停止条件

实现中出现以下情况时必须停止并重新设计，不能用 fallback/hack 绕过：

- `AgentChatEntryDto` 无法表达现有 Chat Flow 的必要可见内容，需要 raw `SessionEntry` 才能渲染；应修中央 projector。
- recovery cursor 与 EventHub 无法建立“允许重复、禁止遗漏”的顺序语义；应先修恢复合同。
- 分页只能通过复制 Task 107 截断逻辑或建立第二套 active path revision 完成；应合并到既有 Module。
- history 实测解析时间不可接受且需要缓存/index；应基于测量另开 repository 任务，先定义失效与生命周期，不在本任务加入全局 Map。
- 删除 raw entries 后发现未登记的产品消费者；先确认该能力保留或删除，不能偷偷恢复旧 DTO。

## Walkthrough Status

- [x] 核对 Task 107 实际实现与共享 DTO。
- [x] 重新测量真实 session 的 projected history。
- [x] 将图片引用移交 Task 108。
- [x] 冻结单 GET、opaque cursor、response union 和 snapshot 去重设计。
- [x] 完成跨 Task 14/49/62/74/107/108 的整体影响审查。
- [x] 制定带依赖、退出条件和明确非目标的系统性纵向实施计划。
- [x] 用户确认删除 Session Tree 节点详情，不建立 `view=entry`。
- [x] 完成最终整体审查，记录影响面、接受风险和实施停止条件。
- [x] 完成 Phase 0 与 Slice 1–9 实现。
- [x] 完成 scoped regression、真实 session smoke、typecheck 和计划偏差记录。
- [x] 完成 review fixes：invalid cursor、ownership span、shared result DTO 与 optimistic 精确收敛。
- [ ] 用户授权后执行真实浏览器长 session 验收。
