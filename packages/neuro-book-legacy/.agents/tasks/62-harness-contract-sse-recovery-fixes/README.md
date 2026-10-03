# Task 62: Harness 黑盒合同与 SSE 恢复修复

> 2026-07-19 superseded：本文件保留当时的历史计划，不再代表当前公开 SSE 合同。Task 22/107 已确认前端从未消费 `sidecar.*` / `sidecar_*` 或 `sidecarContext`；这些内部旁路生命周期已退出 Public Event Projection。Sidecar 执行、side-branch transcript 与日志仍保留。当前合同以 [Task 22](../22-agent-public-event-projection/README.md) 和 [Task 107](../107-agent-event-memory-boundaries/README.md) 为准。

## 任务概述

**创建时间**：2026-06-21  
**状态**：🟢 准备开始 P0 修复  
**优先级**：P0（核心功能缺陷）

### 背景

通过 ultracode 工作流对 NeuroBookHarness 进行全面审查，发现多个违反黑盒合同和 SSE 事件协议的问题。这些问题影响前端用户体验（agent "卡住"）和系统恢复能力（进程重启后丢失状态）。

### 审查范围

- ✅ 代码结构与架构
- ✅ 类型覆盖率
- ✅ 黑盒合同遵守情况
- ✅ SSE 事件协议完整性
- ✅ SSE 恢复机制健壮性
- ✅ 前端交互 API 边界案例

### 审查结果

- **审查模块数**：17 个
- **耗时**：1013 秒
- **Token 使用**：613,777
- **发现问题**：9 个（2 个 P0，4 个 P1，1 个 P2，2 个技术债）

详细发现见 [REVIEW-FINDINGS.md](REVIEW-FINDINGS.md)

---

## 修复计划

### 阶段 0：决策阶段 ✅ 已完成

**目标**：与用户确认关键设计决策

#### 已确认决策

1. **去掉 EventEpoch**
   - SSE 接口无参数：`GET /api/sessions/:sessionId/events`
   - 连接后立即推送当前 invocation 已生成的所有事件
   - 不标记 replay，前端自己维护 invocation transcript（通过 `seq <= lastSeq` 去重）
   - 客户端刷新：snapshot + SSE
   - 服务端重启：客户端收到 SSE error → 走刷新流程

2. **Snapshot waiting 状态重建**
   - 显式状态：`activeInvocation` 包含完整 waiting 状态
   - **支持多个 pendingApprovals**（数组）

3. **Event replay buffer 策略**
   - 按 invocation 分组，保留最近 2 个完整 invocation
   - 不需要硬上限兜底

4. **Sidecar 事件粒度**
   - 透传 sidecar 内部的流式响应
   - 发送 `sidecar.start`、内部事件、`sidecar.merge`
   - 所有事件带 `sidecarContext` 字段让前端区分

---

### 阶段 1：P0 修复 📋 待开始

**目标**：修复核心功能缺陷

#### 1.1 Sidecar 事件透传 🔴

**问题**：Sidecar 执行期间无 SSE 事件，前端看到 agent "卡住"

**修复内容**：
- [ ] 在 `RuntimeHooks` 中添加 sidecar 事件钩子
- [ ] 在 sidecar 开始时发送 `sidecar.start { sidecarType, leafId }` 事件
- [ ] 透传 sidecar 内部所有事件，带上 `sidecarContext: { type, leafId }` 字段
- [ ] 在 sidecar 合并时发送 `sidecar.merge { sidecarType, leafId }` 事件
- [ ] 更新 SSE 事件类型定义（所有事件加可选 `sidecarContext` 字段）
- [ ] 前端根据 `sidecarContext` 区分主路和 sidecar 事件

**影响模块**：
- `server/agent/harness/neuro-agent-harness.ts`（sidecar 调用点）
- `server/agent/harness/run-kernel-types.ts`（RuntimeHooks 定义）
- `shared/dto/agent-session.dto.ts`（事件 DTO）
- `app/components/novel-ide/agent/useAgentSession.ts`（前端事件处理）

**预计工作量**：4-6 小时

---

#### 1.2 Snapshot waiting 状态完整性 + 多 pendingApprovals 支持 🔴

**问题 A**：进程重启后无法恢复 waiting UI，违反黑盒合同  
**问题 B**：LLM 可能一次生成多个需要审批的工具调用，当前只支持单个

**修复内容**：
- [ ] 修改 `getSnapshot()` 方法，在 waiting 状态下返回 `activeInvocation`
- [ ] `pendingApproval` 改为 `pendingApprovals: Array<PendingApprovalDto>`（数组）
- [ ] `PendingApprovalDto` 保持现有结构（包含 toolCallId、toolName、args 等）
- [ ] `continue` API 支持批量 resolutions：`resolutions: Array<{ kind, toolCallId, approved, ... }>`
- [ ] 后端 DTO 更新：`AgentInvokeRequestDto`、`AgentSessionSnapshotDto`、`AgentSessionLiveStateDto`
- [ ] Harness 在 waiting 状态下支持处理多个 tool approval
- [ ] Harness 验证每个 resolution 的 toolCallId 是否在 pendingApprovals 中
- [ ] 前端渲染多个审批卡片（每个 toolCallId 一个）
- [ ] 前端批量发送 resolutions（用户可以逐个批准/拒绝）
- [ ] 添加单元测试验证 waiting 状态恢复和多审批场景

**影响模块**：
- `server/agent/harness/neuro-agent-harness.ts:4782`（getSnapshot）
- `shared/dto/agent-session.dto.ts`（DTO 定义）
- `server/agent/harness/neuro-agent-harness.ts`（continue 处理逻辑）
- `app/components/novel-ide/agent/useAgentSession.ts`（前端 snapshot 处理）
- `app/components/novel-ide/agent/AgentRequestUserInputBubble.vue`（前端审批 UI）

**预计工作量**：3-4 小时

---

### 阶段 2：P1 优化 📋 待开始

**目标**：改善用户体验和系统健壮性

#### 2.1 去掉 EventEpoch，简化 SSE 协议 🟡

**当前问题**：EventEpoch 机制复杂，增加了协议复杂度

**修复内容**：
- [ ] 移除 `eventEpoch` 字段（DTO、EventHub、前端）
- [ ] SSE 接口改为无参数：`GET /api/sessions/:sessionId/events`
- [ ] SSE 连接后立即推送当前 invocation 已生成的所有事件（replay）
- [ ] 前端依赖现有 `seq <= lastSeq` 去重机制处理 replay
- [ ] 移除 `connected` handshake 事件（不再需要）
- [ ] 服务端重启后，客户端 SSE 断开 → 走刷新流程（snapshot + 重连）
- [ ] 更新相关测试

**影响模块**：
- `shared/dto/agent-session.dto.ts`（移除 eventEpoch）
- `server/agent/events/session-event-hub.ts`（移除 epoch 逻辑）
- `server/api/agent/sessions/[sessionId]/events.get.ts`（简化接口）
- `app/components/novel-ide/agent/useAgentSession.ts`（移除 epoch 检查）
- `app/components/novel-ide/agent/useAgentSessionStream.ts`（简化重连逻辑）

**预计工作量**：3-4 小时

---

#### 2.2 Event replay buffer 按 invocation 分组 🟡

**当前问题**：固定 100 条事件缓存，复杂 turn 重连时丢失事件

**修复内容**：
- [ ] EventHub 改为按 `invocationId` 分组缓存事件
- [ ] 保留最近 2 个完整 invocation 的所有事件
- [ ] 当前 active invocation 的事件必须全部保留
- [ ] 超出 2 个的旧 invocation 事件自动清理
- [ ] Sidecar 事件算在父 invocation 里
- [ ] 添加监控日志，记录 buffer 清理情况

**影响模块**：
- `server/agent/events/session-event-hub.ts`

**预计工作量**：2-3 小时

---

#### 2.3 Tool approval 等待期间添加 heartbeat 🟡

**修复内容**：
- [ ] 添加 waiting 状态下的定时 heartbeat 机制
- [ ] 每 30 秒发送 `invocation.heartbeat` 事件
- [ ] 前端添加 heartbeat 超时检测（可选）

**影响模块**：
- `server/agent/harness/neuro-agent-harness.ts`（tool approval 等待逻辑）

**预计工作量**：1 小时

---

#### 2.4 Provider streaming 失败时事件顺序混乱 🟡

**修复内容**：
- [ ] 重构 streaming 和 error handling 的并发控制
- [ ] 确保 `invocation.error` 在所有 delta 事件之后发送
- [ ] 添加事件序列验证测试

**影响模块**：
- `server/agent/harness/neuro-agent-harness.ts:3456`

**预计工作量**：2-3 小时

---

#### 2.5 ErrorBubble 隐藏时机偏差 🟡

**修复内容**：
- [ ] 将 ErrorBubble 隐藏逻辑从 `start` 移到 `accepted` 阶段
- [ ] 验证前端 UI 行为

**影响模块**：
- `server/agent/harness/neuro-agent-harness.ts:2134`

**预计工作量**：0.5 小时

---

### 阶段 3：P2 改进 📋 待开始

**目标**：锦上添花的功能增强

#### 3.1 Tool batch progress 事件缺失 🟢

**修复内容**：
- [ ] 添加 `tool.batch.start` 事件（包含 totalTools）
- [ ] 添加 `tool.batch.progress` 事件（包含 current/total）
- [ ] 添加 `tool.batch.complete` 事件
- [ ] 前端添加批量工具进度条（可选）

**影响模块**：
- `server/agent/harness/neuro-agent-harness.ts`（tool batch 执行逻辑）

**预计工作量**：1-2 小时

---

### 阶段 4：验证与文档 📋 待开始

**目标**：确保修复有效，更新规范文档

#### 4.1 测试验证

**验证场景**：
- [ ] Sidecar 执行时前端显示进度（透传 sidecar 内部事件）
- [ ] 进程重启后 waiting 状态正确恢复
- [ ] 多个 pendingApprovals 同时存在时，前端渲染多个审批卡片
- [ ] 用户可以逐个批准/拒绝多个 pendingApprovals
- [ ] 复杂 turn（100+ 事件）重连后状态完整
- [ ] 去掉 EventEpoch 后，客户端刷新能正常恢复（snapshot + SSE replay）
- [ ] 去掉 EventEpoch 后，服务端重启后客户端能检测到并走刷新流程
- [ ] Tool approval 长时间等待时连接保持活跃（heartbeat）
- [ ] Provider streaming 失败时事件顺序正确
- [ ] 新 invocation accepted 时旧 ErrorBubble 立即隐藏

#### 4.2 文档更新

- [ ] 更新黑盒合同，补充新增 SSE 事件规范（sidecar 事件、heartbeat 事件）
- [ ] 更新 `docs/tasks/24-agent-sse-reload-recovery`：
  - 移除 EventEpoch 相关描述
  - 更新为简化后的 SSE 协议（无参数，直接 replay）
  - 更新恢复流程说明
- [ ] 添加 Sidecar 事件使用指南
- [ ] 更新前端 SSE 事件处理文档
- [ ] 更新多 pendingApprovals 的前端处理文档

---

## 技术债（暂不修复）

以下问题已记录但不在本次修复范围内：

### 代码结构问题

- **主 Harness 文件屎山**：`neuro-agent-harness.ts` 5014 行，建议拆分成多个协调器类
- **超大函数**：`invokeAgent` (151行)、`runToolBatch` (133行)、`commitTurn` (86行)

### 类型覆盖问题

- **`any/unknown` 漏洞**：18 处 `any`、12 处 `unknown`、6 处 `Record<string, unknown>`，部分未注释

**后续处理**：
- 在代码稳定后，单独创建重构 task
- 优先修复功能问题，避免同时进行大规模重构和功能修复

---

## 里程碑

- [x] **M1 - 决策完成**（已完成）
  - 所有待决策问题已确认
  
- [ ] **M2 - P0 修复完成**（预计 1.5 天）
  - Sidecar 事件透传
  - Snapshot waiting 状态 + 多 pendingApprovals 支持

- [ ] **M3 - P1 优化完成**（预计 2 天）
  - 去掉 EventEpoch
  - Event replay buffer 按 invocation 分组
  - Tool approval heartbeat
  - Streaming error 事件顺序
  - ErrorBubble 隐藏时机

- [ ] **M4 - P2 改进完成**（预计 0.5 天）
  - Tool batch progress 事件

- [ ] **M5 - 验证与文档完成**（预计 0.5 天）
  - 所有验证场景通过
  - 文档更新完成

**总预计工作量**：4.5 天

---

## 变更记录

### 2026-06-21
- 创建 task 目录和文档
- 完成审查发现记录（ultracode 工作流，17 agents，613k tokens）
- 完成所有设计决策：
  - 去掉 EventEpoch，简化 SSE 协议
  - Snapshot waiting 状态显式返回 + 支持多 pendingApprovals
  - Event replay buffer 按 invocation 分组（保留 2 个）
  - Sidecar 事件透传内部流式响应
- 工具审批功能独立成单独 task（不在本次修复范围）
- 状态：✅ 决策阶段完成，准备开始 P0 修复

---

## 相关文档

- [审查发现详情](REVIEW-FINDINGS.md)
- [黑盒合同](../18-agent-runtime-pipeline-hooks/HARNESS-BLACK-BOX-CONTRACT.md)
- [SSE 恢复设计](../24-agent-sse-reload-recovery/README.md)
- [审查工作流输出](C:\Users\NOTNOT~1\AppData\Local\Temp\claude\C--Users-notnotype-Documents-CodeRepository-GithubProjects-neuro-book\8a3d0608-25a1-49f6-9413-268f73664a29\tasks\wi62wa4mc.output)
