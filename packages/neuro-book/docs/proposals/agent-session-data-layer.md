# Agent 会话数据层后续提案

状态：draft（2026-09-28 起草，只记录问题与方向，尚未评审）

关联：[Agent 对话视图重做提案](agent-conversation-view.md)（本提案不在其范围内）；[应用运行时与内置插件架构](application-runtime-and-plugins.md)中的 `agent-runtime` 服务组与 `agent-ui` 功能插件。

## 问题

Agent 面板的前端数据层（会话模型、SSE 订阅、动作执行）和它依赖的后端接口有一批设计问题。它们把大量复杂度推给了前端，是旧面板代码量大的原因之一。

2026-09-28 开发者决定：Agent 面板重做（Work w00019）只做前端组件，不碰数据层和后端接口；这些问题先记录在这里，等 w00017 插件体系完成后，用插件重新实现数据层，再与重做后的组件组装。

## 目标与非目标

### 目标

1. 在插件体系就绪后，为 `agent-ui` 提供一个按[对话视图合同](agent-conversation-view.md#d1视图合同)供数的前端数据层。
2. 在不破坏现有恢复协议的前提下，消除下文列出的双通道对账、状态无序、重复入口等问题。

### 非目标

- 本提案被接受之前，不修改任何后端接口或前端数据层代码。
- 不改变 Session 持久化格式与恢复协议中已经做得好的部分（见下节）。

## 当前行为与证据

### 做得好的部分（保留）

- 事件带 `eventEpoch + seq`，服务端保留最近 500 条、4 MiB 的事件，断线后用 `after` 续传；缓冲过期、游标超前、缺少 epoch 统一返回 `snapshot_required`（[`session-event-hub.ts`](../../server/agent/events/session-event-hub.ts)）。“快照是真相，事件只是增量”的原则清楚。
- SSE 写出时处理背压（[`agent-sse-writer.ts`](../../server/agent/events/agent-sse-writer.ts)）。
- 事件与历史都有字节上限和截断标记，大内容按需读取。
- 服务端直接给出当前可执行的交互能力（`interaction`）。
- 历史分页使用服务端生成的不透明游标；请求 DTO 用 zod 严格校验。

### 后端接口的问题

| # | 问题 | 证据 | 对前端的影响 |
|---|---|---|---|
| B1 | invoke 只能阻塞调用，`block:false` 抛出“第一版尚未实现”。一次运行期间 HTTP 请求一直挂着，结束时才返回受理回执；同一次运行的内容同时从 SSE 推送。审批与回答提问也走同一个阻塞 invoke | [`neuro-agent-harness.ts`](../../server/agent/harness/neuro-agent-harness.ts) 中 `invokeCore` 开头 | 前端要在 HTTP 回执、SSE 落盘条目、网络失败三者之间对账 |
| B2 | 实时状态 `AgentSessionLiveStateDto` 有四个来源（SSE `session_state_changed`、command 返回、tree 返回、recovery），都不带版本号 | [`agent-session.dto.ts`](../../shared/dto/agent-session.dto.ts) | 前端按到达顺序覆盖，HTTP 返回晚于 SSE 时可能用旧状态盖掉新状态（从代码推断，未复现） |
| B3 | 运行中是 pi 层事件（按 contentIndex 增量、`tool_execution_*`），落盘后是 `AgentChatEntryDto`，两套形状 | 同上与 [`agent-public-event.dto.ts`](../../shared/dto/agent-public-event.dto.ts) | 前端维护两套投影再合并 |
| B4 | 同一操作两个入口：新建会话（`POST /sessions` 与 command `new`）、切换分支（command `tree` 与 `POST /tree`）、重试和分叉在 command 与 tree 中各有一份 | `server/api/agent/sessions/` | 前端混用两套入口 |
| B5 | live state 里的待回答提问可能带 `detailsOmitted`；两种 resolution 的 answers 结构重复，还留有 `@deprecated` 别名 | `agent-session.dto.ts` | 前端从运行事件或 recovery 拼回完整表单 |
| B6 | Workflow 另成体系：详情轮询 `/workflow/runs/:id`，待处理项走 `/jobs/events` SSE，提交走 `/resume` | `server/api/agent/workflow/`、`server/api/agent/jobs/` | 数据分散在三处，旧气泡自己轮询 |
| B7 | SSE 没有心跳 | `agent-sse-writer.ts` | 连接半断时（如睡眠唤醒）要等 TCP 超时才发现（从代码推断） |
| B8 | `GET /sessions/:id?view=recovery\|history\|systemPrompt` 一个地址返回三种形状 | `server/api/agent/sessions/[sessionId]/index.get.ts` | 影响小 |
| B9 | 附件上传只按图片设计：大小上限与报错文案都是图片的，存储层只校验 MIME 的格式 | [`attachments.post.ts`](../../server/api/agent/sessions/[sessionId]/attachments.post.ts)、[`attachment-store.ts`](../../server/agent/attachments/attachment-store.ts) | 新输入框（w00019 t07）要上传 PDF、txt 以及大段粘贴转成的文本文件，需要非图片的上传入口与各自的大小上限 |
| B10 | 文件附件以路径给模型：正文里写 `[file #N · 文件名](附件路径)`，模型按需用读文件工具去读 | [`PromptEditor.md`](../../app/components/common/form/PromptEditor.md) 的“文字写法” | 需要确认读文件工具能读会话附件路径 `workspace/.nbook/agent/attachments/…`（未验证）；以后可换成 omp 那种 `local://` 地址，写法不变 |
| B11 | 图片写法 `![image #N](目标)` 的名称存为附件块的 `name`，发给模型的请求里是否带上未验证 | [`neuro-agent-harness.ts`](../../server/agent/harness/neuro-agent-harness.ts) 中把 Markdown 图片转为附件块处 | 模型看不到 `#N` 时，用户正文里写的“见 #2”对不上图片 |

### 前端数据层的问题

| # | 问题 | 证据 |
|---|---|---|
| F1 | 防止旧响应回填的机制分散：activation、operation、load 三种 controller，request guard，多个 generation 计数器和 requestId | [`agent-chat-surface-state.ts`](../../app/components/novel-ide/agent/agent-chat-surface-state.ts)、`AgentChatSurface.vue` |
| F2 | 会话列表的真相挂在组件实例上，页面通过 `defineExpose` 反向读取，驱动左侧会话栏 | `AgentChatSurface.vue` 的 `defineExpose`，`app/pages/index.vue` |
| F3 | slash 命令在宿主里用 if 链解析 | `AgentChatSurface.vue` 的 `handleSlashCommand` |
| F4 | 服务端请求前端修改 IDE 状态（`client_variable_patch_requested` 加 ack），处理逻辑放在 Agent 面板里 | `client-variables.ts` |
| F5 | “记住上次会话”等直接读写 localStorage，违反 [frontend.md](../../../../docs/standards/code/frontend.md) 禁止组件裸写浏览器存储的规定 | `AgentChatSurface.vue` 中多处 `localStorage` |
| F6 | 旧 WebView 草稿迁移：0.9（`63b0b66d`，2026-07-31）之前草稿存在浏览器 localStorage（前缀 `agent:composer-draft:v1:`），之后改存磁盘，首次加载时批量上传迁移。超过 30 天的草稿本来就会丢弃，这段迁移现在基本不会再触发 | [`agent-composer-draft.ts`](../../app/components/novel-ide/agent/composer/agent-composer-draft.ts)、`server/api/agent/composer-drafts/migrate.post.ts` |
| F7 | `AgentChatSurface.vue` 中约 380 行 Inline AI 代码的入口已无调用方，实际逻辑在 `useInlineEditorAgentController.ts`（从代码推断） | `AgentChatSurface.vue` |

## 方案方向（待评审）

以下只是方向，具体方案在插件体系就绪后展开。

1. **前端数据层分层：** 接口适配层（包住 HTTP 与 SSE，吸收 B1 到 B8）、按会话隔离的会话模型（落盘条目为准，运行中内容按 messageId 临时挂上，状态只从一个入口变化）、应用级会话列表（取代 F2）、动作分发（执行视图发出的 action）。
2. **一致性规则：** SSE 是唯一的状态来源；HTTP 只用于判断是否受理和取得 SSE 中看不到的错误。在后端提供版本号之前，前端记录发请求时的 seq，HTTP 返回的状态只在期间没有更新的 SSE 状态时才应用。
3. **并发：** 按会话作用域管理请求，切换会话时销毁旧作用域并取消其中所有请求，取代 F1 的多套机制。
4. **后端候选改动：** 非阻塞 invoke（先返回受理回执，结果只走 SSE）；live state 带版本号；运行中与落盘统一条目形状；合并重复入口；Workflow 事件并入会话事件流或统一的任务事件流；SSE 心跳。
5. **归属调整：** F4 移到应用级的“Agent 客户端桥”服务；F5 改由宿主注入存储接口，接入 Storage 服务；F6 评估后删除；F7 随旧目录一起删除。
6. **服务端事件回放：** 新会话模型就绪后，Lab 的时间线回放增加服务端事件脚本，让真实会话模型在 Lab 中驱动视图。

## 数据、接口、安全、迁移、发布与回滚影响

待方案展开后补充。已知约束：Session 持久化格式与恢复协议不做破坏性修改；后端接口调整需要同时考虑桌面版和旧前端的兼容窗口。

## 对 Spec 的预期改动

待方案展开后补充。预计涉及 Agent Session 持久化与历史的规范缺口（见 [Spec 注册表](../../../../docs/specs/README.md#规范缺口)），以及对话视图 Spec 中 ctx 与 action 的供数方。

## 决策记录

| 日期 | 决策者 | 结论 |
|---|---|---|
| 2026-09-28 | 开发者 | Agent 面板重做本次不碰后端接口和数据层；本提案所列问题留到 w00017 完成后用插件重新实现 |
