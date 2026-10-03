# Harness 审查发现问题清单

## 审查概况

- **审查时间**：2026-06-21
- **审查范围**：NeuroBookHarness API 和内部接口
- **审查团队**：17 个 agent，耗时 1013 秒，使用 613,777 tokens
- **参考文档**：
  - `docs/tasks/18-agent-runtime-pipeline-hooks/HARNESS-BLACK-BOX-CONTRACT.md`
  - `docs/tasks/24-agent-sse-reload-recovery`

---

## 一、黑盒合同违规问题

### 1.1 Snapshot 在 waiting 状态下不完整 🔴 P0

**合同要求**：
> Snapshot 必须包含 durable projection 和 runtime state，能从未闭合 approval tool call 推导 `activeInvocation.status = "waiting"`

**实际情况**：
- `GET /api/sessions/:id/snapshot` 返回的 `activeInvocation` 在 waiting 状态下为 `null`
- 前端无法从 snapshot 重建 waiting UI
- 进程重启后，用户看到的是"空闲"状态，而不是"等待批准"状态

**影响**：
- 违反黑盒合同的核心保证
- 进程重启后丢失 waiting 状态，用户体验严重受损

**位置**：
- `server/agent/harness/neuro-agent-harness.ts:4782` - `getSnapshot()` 方法

---

### 1.2 ErrorBubble 隐藏时机偏差 🟡 P1

**合同要求**：
> 新 invocation **accepted** 时立即隐藏旧 ErrorBubble

**实际情况**：
- 在 invocation **start** 时才隐藏（晚了一个阶段）
- 导致短暂时间内前端同时显示旧 error 和新 invocation

**影响**：
- UI 闪烁，用户体验不佳
- 不影响功能正确性

**位置**：
- `server/agent/harness/neuro-agent-harness.ts:2134` - `admitInvocation()` 方法

---

## 二、SSE 事件协议问题

### 2.1 Sidecar 执行不可见 🔴 P0

**问题描述**：
- Sidecar 执行期间（context-load、memory-save 等）无任何 SSE 事件
- 前端无法区分「agent 思考」vs「sidecar 运行」vs「sidecar 合并」
- Sidecar pattern（fork → execute → merge → fork → execute → merge）完全不透明

**前端影响**：
- 用户看到 agent "卡住"，不知道在执行什么
- 长时间无反馈，用户可能误以为连接断开或系统挂起

**建议新增事件**：
```typescript
// Sidecar 开始
{ type: 'sidecar.start', sidecarType: 'context-load' | 'memory-save' | ... }

// Sidecar 进度（可选）
{ type: 'sidecar.progress', sidecarType: 'context-load', message: '加载 lorebook 节点...' }

// Sidecar 完成
{ type: 'sidecar.complete', sidecarType: 'context-load', result: { nodesLoaded: 42 } }

// Sidecar 合并
{ type: 'sidecar.merge', sidecarType: 'context-load' }
```

**位置**：
- `server/agent/harness/neuro-agent-harness.ts` - sidecar 调用点（多处）
- 需要在 `RuntimeHooks` 中添加 sidecar 事件钩子

---

### 2.2 Tool approval 等待期间无 heartbeat 🟡 P1

**问题描述**：
- 工具需要用户批准时，从 `tool.pending-approval` 到用户响应之间，无任何 progress 事件
- 长时间等待时（如用户离开电脑），前端无法判断连接是否还活着

**前端影响**：
- 无法区分"正在等待批准"和"连接已断开"
- 用户可能误以为系统挂起

**建议方案**：
- 每 30 秒发送 `invocation.heartbeat` 事件
- 或在 waiting 状态下每 30 秒发送 `tool.waiting-approval` 事件

**位置**：
- `server/agent/harness/neuro-agent-harness.ts` - tool approval 等待逻辑

---

### 2.3 Provider streaming 失败时事件顺序混乱 🟡 P1

**问题描述**：
- Claude API 返回 500 时，前端可能先收到 `invocation.error`，再收到未闭合的 `assistant.content.delta`
- 原因：streaming 和 error handling 在不同 async 分支

**前端影响**：
- 前端需要复杂的事件排序逻辑来处理这种竞态
- 可能导致 UI 显示不一致

**位置**：
- `server/agent/harness/neuro-agent-harness.ts:3456` - provider streaming 处理

---

### 2.4 Tool batch progress 事件缺失 🟢 P2

**问题描述**：
- 1 次 turn 调用 10+ 工具时，前端不知道执行到第几个
- 只有 `tool.call` 和 `tool.result`，没有整体进度

**前端影响**：
- 大批量工具调用时无进度指示
- 用户不知道还要等多久

**建议新增事件**：
```typescript
{ type: 'tool.batch.start', totalTools: 12 }
{ type: 'tool.batch.progress', current: 5, total: 12 }
{ type: 'tool.batch.complete' }
```

---

## 三、SSE 恢复机制问题

### 3.1 Event replay buffer 太小 🟡 P1

**问题描述**：
- 当前只缓存 100 条事件
- 复杂 turn（50+ 工具调用）可能产生 200+ 事件
- 重连时丢失早期事件，导致前端状态不完整

**建议方案**：
- 按 invocationId 分组缓存，保证至少保留最近 2 个 invocation 的完整事件
- 或增加缓存上限到 500 条

**位置**：
- `server/agent/harness/event-hub.ts` - event buffer 配置

---

## 四、代码结构问题（暂不修复）

### 4.1 主 Harness 文件屎山 ⚠️ 技术债

**问题描述**：
- `server/agent/harness/neuro-agent-harness.ts`：5014 行
- 超大函数：`invokeAgent` (151行)、`runToolBatch` (133行)、`commitTurn` (86行)
- 100+ 私有方法，管理 10+ 个 Map

**建议重构**（暂不执行）：
- 拆分成 `InvocationCoordinator`、`ToolExecutor`、`SessionSummarizer`、`QueueManager`

---

### 4.2 类型覆盖漏洞 ⚠️ 技术债

**问题描述**：
- `any` 使用 18 处，部分未注释
- `unknown` 使用 12 处，部分未注释
- `Record<string, unknown>` 使用 6 处

**未注释案例**：
- `neuro-agent-harness.ts:1247` - tool result 的 `content: any`
- `event-hub.ts:89` - event payload `unknown` 未说明何时允许

**建议**（暂不执行）：
- 为所有 `any/unknown` 添加注释说明原因
- 用 Zod schema 或 branded type 替代裸 `unknown`

---

## 五、优先级总结

### 🔴 P0 - 必须修复（影响核心功能）

1. **Sidecar 事件不可见** - 导致前端长时间"卡住"体验
2. **Snapshot 在 waiting 状态下不完整** - 违反黑盒合同，进程重启后无法恢复

### 🟡 P1 - 应该优化（影响用户体验）

3. **Event replay buffer 太小** - 复杂 turn 重连时丢失事件
4. **Tool approval 等待期间无 heartbeat** - 前端无法判断连接活性
5. **Provider streaming 失败时事件顺序混乱** - 前端可能收到未闭合的 delta
6. **ErrorBubble 隐藏时机偏差** - 应在 accepted 而非 start 时隐藏

### 🟢 P2 - 可以改进（锦上添花）

7. **Tool batch progress 事件缺失** - 大批量工具调用时前端无进度

### ⚠️ 技术债（暂不修复）

8. **主 Harness 文件屎山** - 5014 行单文件
9. **类型覆盖漏洞** - 部分 `any/unknown` 未注释

---

## 六、待决策问题

### 6.1 Sidecar 事件粒度

**问题**：Sidecar 事件应该多细粒度？

**选项 A - 粗粒度**：
- 只发送 `sidecar.start` 和 `sidecar.complete`
- 优点：实现简单，事件量少
- 缺点：长时间 sidecar 仍然像"卡住"

**选项 B - 细粒度**：
- 发送 `sidecar.start`、`sidecar.progress`（含进度百分比和消息）、`sidecar.complete`
- 优点：用户体验最好，可以看到详细进度
- 缺点：需要 sidecar 内部支持进度报告

**选项 C - 混合**：
- 必须发送 `sidecar.start` 和 `sidecar.complete`
- `sidecar.progress` 由各 sidecar 自行决定是否实现
- 优点：平衡实现成本和用户体验

**需要决策**：选择哪个选项？

---

### 6.2 Snapshot waiting 状态重建方式

**问题**：如何在 snapshot 中传递 waiting 状态？

**选项 A - 显式状态**：
- `activeInvocation` 包含完整的 waiting 状态：`{ status: 'waiting', pendingApproval: {...} }`
- 优点：前端无需推导，直接使用
- 缺点：需要在 harness 中额外维护 waiting 状态

**选项 B - 隐式推导**：
- `activeInvocation` 为 `null`，但 snapshot 包含未闭合的 tool call
- 前端从未闭合 tool call 推导出 waiting 状态
- 优点：符合合同描述"从未闭合 tool call 推导"
- 缺点：前端逻辑复杂，容易出错

**选项 C - 混合**：
- `activeInvocation` 包含 `status: 'waiting'`，但详细信息（如 toolCallId）从未闭合 tool call 推导
- 优点：平衡实现成本和合同遵守
- 缺点：需要前端和后端都理解这个约定

**需要决策**：选择哪个选项？

---

### 6.3 Event replay buffer 策略

**问题**：如何扩展 event replay buffer？

**选项 A - 固定大小增加**：
- 从 100 增加到 500
- 优点：实现简单
- 缺点：仍然可能不够，占用内存增加

**选项 B - 按 invocation 分组**：
- 保证至少保留最近 2 个 invocation 的完整事件
- 优点：更智能，适应不同 invocation 规模
- 缺点：实现复杂，需要跟踪 invocation 边界

**选项 C - 基于时间**：
- 保留最近 5 分钟的所有事件
- 优点：简单，适合大多数场景
- 缺点：极长 invocation 仍然可能不够

**需要决策**：选择哪个选项？

---

## 七、后续行动

1. **决策阶段**：与用户确认待决策问题的选择
2. **修复阶段**：按 P0 → P1 → P2 顺序修复
3. **验证阶段**：搭建测试环境，验证修复效果
4. **文档更新**：更新黑盒合同，补充新增 SSE 事件规范
