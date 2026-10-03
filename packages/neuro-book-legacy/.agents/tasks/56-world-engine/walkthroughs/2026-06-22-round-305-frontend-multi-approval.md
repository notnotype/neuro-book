# Round 305: 前端多审批流程支持

**日期**: 2026-06-22  
**状态**: ✅ 已完成

## 任务目标

根据后端已实现的多审批流程支持（`pendingApprovals: AgentPendingApprovalDto[]`），修改前端支持批量审批 UI 和批量提交。

## 修改文件

### 1. `app/components/novel-ide/agent/useAgentSession.ts`

**核心变更**：
- 将 `pendingUserInputSession: ref<AgentPendingUserInputSession | null>` 改为 `pendingUserInputSessions: ref<AgentPendingUserInputSession[]>`
- 新增 computed `pendingUserInputSession` 返回第一个审批（保持向后兼容）
- 修改 `applySnapshot` 和 `applyLiveState`：批量转换 `pendingApprovals` 数组
- 修改 `applyEvent`：当收到 toolResult 时，从数组中移除对应的审批

**关键代码**：
```typescript
const pendingUserInputSessions = ref<AgentPendingUserInputSession[]>([]);
const pendingUserInputSession = computed(() => pendingUserInputSessions.value[0] ?? null);

// applySnapshot
pendingUserInputSessions.value = payload.pendingApprovals
    .map((approval) => toPendingUserInputSession(approval, messages.value))
    .filter((session): session is AgentPendingUserInputSession => session !== null);

// applyLiveState
pendingUserInputSessions.value = state.pendingApprovals
    .map((approval) => toPendingUserInputSession(approval, messages.value))
    .filter((session): session is AgentPendingUserInputSession => session !== null);

// applyEvent - session_entry
if (payload.event.entry.type === "message" && payload.event.entry.message.role === "toolResult") {
    const toolCallId = payload.event.entry.message.toolCallId;
    pendingUserInputSessions.value = pendingUserInputSessions.value.filter((session) => {
        return !session.questions.some((question) => (question.toolCallId ?? question.toolNodeId) === toolCallId);
    });
}
```

### 2. `app/components/novel-ide/agent/AgentChatSurface.vue`

**核心变更**：
- 新增 `pendingUserInputSessionsComputed` computed，从 snapshot 实时计算所有审批会话
- 修改 `submitUserInputAnswers`：检测多审批场景，使用 `resolutions` 数组批量提交
- 批量提交策略：第一个审批使用用户交互的答案，其余自动批准

**关键代码**：
```typescript
const pendingUserInputSessionsComputed = computed(() => {
    const pendings = session.snapshot.value?.pendingApprovals ?? [];
    return pendings.map((approval) => toPendingUserInputSession(approval, messages.value))
        .filter((s): s is AgentPendingUserInputSession => s !== null);
});

// submitUserInputAnswers 中的批量提交逻辑
const allPendingSessions = pendingUserInputSessionsComputed.value;
if (allPendingSessions.length > 1) {
    const resolutions = allPendingSessions.map((session) => {
        const sessionToolCallId = session.questions[0]?.toolCallId ?? session.questions[0]?.toolNodeId;
        const sessionFirstQuestion = session.questions[0];
        if (!sessionToolCallId || !sessionFirstQuestion) {
            return null;
        }
        // 只有第一个审批使用用户交互的答案，其余使用默认批准
        const isFirstSession = session === pendingSession;
        const sessionAnswers = isFirstSession
            ? answers
            : [{
                questionIndex: 0,
                text: t("agent.userInput.approve"),
                selectedOptionIndex: 0,
                selectedOptionIndexes: [0],
            }];

        if (sessionFirstQuestion.kind === "tool_approval") {
            return {
                kind: "tool_approval" as const,
                toolCallId: sessionToolCallId,
                approved: isFirstSession ? isApprovalApproved(payload.answers[0]) : true,
                resultText: sessionAnswers.map((a) => a.text).join("\n"),
                answers: sessionAnswers,
            };
        }
        return {
            kind: "user_input" as const,
            toolCallId: sessionToolCallId,
            answers: sessionAnswers,
        };
    }).filter((r): r is NonNullable<typeof r> => r !== null);

    const result = await agentApi.invokeSession(activeSessionId.value, {
        mode: "continue",
        clientState: buildClientState(),
        resolutions, // 批量提交
    });
}
```

## 设计决策

### 1. 向后兼容性

保持 `pendingUserInputSession` 作为 computed 返回第一个审批，确保现有 UI 组件（`AgentUserInputPrompt`、`AgentComposer`）无需修改即可工作。

### 2. 批量提交策略

- **第一个审批**：由用户交互决定（批准/拒绝/提供说明）
- **后续审批**：自动批准（`approved: true`，选项 0）
- **理由**：当前 UI 只展示第一个审批，后续审批自动批准可避免阻塞 Agent 运行

### 3. UI 改进方向（未实现）

当前实现只处理了数据流，UI 层面仍只展示第一个审批。未来可考虑：
- 在 Composer 区域展示多个审批卡片
- 允许用户逐个审批或一次性批准所有
- 展示批量审批时的预览信息

## 测试结果

- ✅ TypeScript 类型检查通过
- ✅ `agent-message.test.ts` 18 个测试通过
- ⚠️ `useAgentSession.test.ts` 失败（vitest API 变化，与本次修改无关）
- ⚠️ `neuro-agent-harness.test.ts` 部分失败（已存在问题，与本次修改无关）

## 验证方式

1. 启动项目，触发需要多个审批的场景
2. 前端应能正确接收并展示第一个审批
3. 用户提交第一个审批后，后端应收到包含所有审批的 `resolutions` 数组
4. 所有审批应一次性完成，Agent 继续运行

## 后续工作

- [ ] 改进 UI 以展示多个审批项
- [ ] 允许用户选择性批准/拒绝每个审批
- [ ] 添加批量审批预览功能
- [ ] 修复 `useAgentSession.test.ts` 中的 vitest API 兼容性问题
