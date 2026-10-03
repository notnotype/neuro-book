import {describe, expect, it} from "vitest";
import type {AgentPendingUserInputSession} from "nbook/app/components/novel-ide/agent/agent-message";
import {
    acceptsAgentPendingOperation,
    buildAgentPendingResolutions,
    createAgentPendingResolutionDraft,
    ownsAgentPendingSubmission,
    pendingResolutionBatchKey,
    pendingResolutionItems,
    reconcileAgentPendingResolutionDraft,
    updateAgentPendingFormDraft,
    type AgentPendingResolutionDraft,
} from "nbook/app/components/novel-ide/agent/agent-pending-resolution";
import {AgentSurfaceOperationController} from "nbook/app/components/novel-ide/agent/agent-chat-surface-state";
import {parsePlainReferenceText, serializePlainReferenceDoc} from "nbook/app/utils/plain-reference-text";

const strings = {
    otherAnswer: "其他答案",
    addSuggestion: "补充建议",
    continueLabel: "继续",
    noteLabel: (note: string): string => `备注：${note}`,
};

describe("Agent pending resolution", () => {
    it("审批不会默认批准，所有 pending 明确完成后才生成批量 resolution", () => {
        const sessions = [approval("approve-1"), question("ask-1", ["A", "B"]), approval("approve-2")];
        const draft = createAgentPendingResolutionDraft(sessions);

        expect(pendingResolutionItems(sessions)).toHaveLength(3);
        expect(buildAgentPendingResolutions(sessions, draft, strings)).toEqual({
            status: "incomplete",
            firstIncompleteKey: "question:approve-1:0",
        });

        const completed: AgentPendingResolutionDraft = {
            answers: {
                "question:approve-1:0": {selectedOptionIndex: 1, note: "不要执行"},
                "question:ask-1:0": {selectedOptionIndex: 0, note: "补充上下文"},
                "question:approve-2:0": {selectedOptionIndex: 0, note: ""},
            },
            forms: {},
        };
        const result = buildAgentPendingResolutions(sessions, completed, strings);

        expect(result.status).toBe("ready");
        if (result.status !== "ready") return;
        expect(result.resolutions).toEqual([
            expect.objectContaining({kind: "tool_approval", toolCallId: "approve-1", approved: false}),
            expect.objectContaining({kind: "user_input", toolCallId: "ask-1"}),
            expect.objectContaining({kind: "tool_approval", toolCallId: "approve-2", approved: true}),
        ]);
        expect(result.resolutions[1]).toMatchObject({
            answers: [{questionIndex: 0, selectedOptionIndex: 0, note: "补充上下文", text: "A\n备注：补充上下文"}],
        });
    });

    it("其他答案和开放回答必须提供正文，普通选项允许可选说明", () => {
        const sessions = [question("ask-choice", ["A"]), question("ask-open")];
        const draft = createAgentPendingResolutionDraft(sessions);
        draft.answers["question:ask-choice:0"] = {selectedOptionIndex: -1, note: ""};

        expect(buildAgentPendingResolutions(sessions, draft, strings)).toEqual({
            status: "incomplete",
            firstIncompleteKey: "question:ask-choice:0",
        });

        draft.answers["question:ask-choice:0"] = {selectedOptionIndex: -1, note: "自定义答案"};
        draft.answers["question:ask-open:0"] = {note: "开放回答"};
        const result = buildAgentPendingResolutions(sessions, draft, strings);

        expect(result.status).toBe("ready");
        if (result.status !== "ready") return;
        expect(result.resolutions[0]).toMatchObject({
            answers: [{selectedOptionIndex: -1, note: "自定义答案", text: "其他答案\n备注：自定义答案"}],
        });
        expect(result.resolutions[1]).toMatchObject({
            answers: [{note: "开放回答", text: "开放回答"}],
        });
    });

    it("富文本回答保留引用 chip、selection、skill 和多行文本", () => {
        const session = question("ask-rich", ["默认答案"]);
        const draft = createAgentPendingResolutionDraft([session]);
        const richAnswer = [
            "先查看 [主角](lorebook/character/main/index.md)",
            "再处理 [[manuscript/001/chapter.md#L12-L18]] 并使用 $review",
        ].join("\n");
        const serializedAnswer = serializePlainReferenceDoc(parsePlainReferenceText(richAnswer));
        draft.answers["question:ask-rich:0"] = {selectedOptionIndex: -1, note: serializedAnswer};

        const result = buildAgentPendingResolutions([session], draft, strings);

        expect(serializedAnswer).toBe(richAnswer);
        expect(result).toEqual({
            status: "ready",
            resolutions: [{
                kind: "user_input",
                toolCallId: "ask-rich",
                answers: [{
                    questionIndex: 0,
                    selectedOptionIndex: -1,
                    note: richAnswer,
                    text: `其他答案\n备注：${richAnswer}`,
                }],
            }],
        });
    });

    it("表单必须显式确认，提交时合并默认值并保持服务端顺序", () => {
        const sessions = [form("form-1"), question("ask-1", ["继续"])];
        const draft = createAgentPendingResolutionDraft(sessions);
        draft.forms["form:form-1"] = {data: {name: "Alice"}, confirmed: false};
        draft.answers["question:ask-1:0"] = {selectedOptionIndex: 0, note: ""};

        expect(buildAgentPendingResolutions(sessions, draft, strings)).toEqual({
            status: "incomplete",
            firstIncompleteKey: "form:form-1",
        });

        draft.forms["form:form-1"] = {data: {name: "Alice"}, confirmed: true};
        const result = buildAgentPendingResolutions(sessions, draft, strings);

        expect(result.status).toBe("ready");
        if (result.status !== "ready") return;
        expect(result.resolutions).toEqual([
            {kind: "user_input", toolCallId: "form-1", data: {name: "Alice", enabled: true}},
            expect.objectContaining({kind: "user_input", toolCallId: "ask-1"}),
        ]);
    });

    it("多个表单按 toolCallId 隔离，确认后的表单再次修改会撤销确认", () => {
        const sessions = [form("form-1"), form("form-2")];
        const draft = createAgentPendingResolutionDraft(sessions);
        draft.forms["form:form-1"] = {data: {name: "A"}, confirmed: true};
        draft.forms["form:form-2"] = {data: {name: "B"}, confirmed: true};

        const changed = updateAgentPendingFormDraft(draft, "form:form-1", {name: "A2"});

        expect(changed.forms["form:form-1"]).toEqual({data: {name: "A2"}, confirmed: false});
        expect(changed.forms["form:form-2"]).toEqual({data: {name: "B"}, confirmed: true});
        expect(buildAgentPendingResolutions(sessions, changed, strings)).toEqual({
            status: "incomplete",
            firstIncompleteKey: "form:form-1",
        });
    });

    it("同一 request_user_input 的多问题合并为一个 resolution，并保持问题顺序", () => {
        const session = multiQuestion("ask-many");
        const draft = createAgentPendingResolutionDraft([session]);
        draft.answers["question:ask-many:0"] = {selectedOptionIndex: 1, note: "第一题说明"};
        draft.answers["question:ask-many:1"] = {note: "第二题回答"};

        const result = buildAgentPendingResolutions([session], draft, strings);

        expect(result).toEqual({
            status: "ready",
            resolutions: [{
                kind: "user_input",
                toolCallId: "ask-many",
                answers: [
                    {questionIndex: 0, selectedOptionIndex: 1, note: "第一题说明", text: "B\n备注：第一题说明"},
                    {questionIndex: 1, note: "第二题回答", text: "第二题回答"},
                ],
            }],
        });
    });

    it("recovery 重投影保留同身份草稿，并移除已完成 pending 的草稿", () => {
        const first = [question("ask-1", ["A"]), question("ask-2")];
        const draft = createAgentPendingResolutionDraft(first);
        draft.answers["question:ask-1:0"] = {selectedOptionIndex: 0, note: "保留"};
        draft.answers["question:ask-2:0"] = {note: "删除"};

        const reconciled = reconcileAgentPendingResolutionDraft([question("ask-1", ["A"]), approval("approve-3")], draft);

        expect(reconciled).toEqual({
            answers: {
                "question:ask-1:0": {selectedOptionIndex: 0, note: "保留"},
                "question:approve-3:0": {note: ""},
            },
            forms: {},
        });
    });

    it("退出计划模式的补充建议保持拒绝切换语义", () => {
        const session = approval("switch-1", true);
        const draft = createAgentPendingResolutionDraft([session]);
        draft.answers["question:switch-1:0"] = {selectedOptionIndex: -1, note: "先补测试"};

        const result = buildAgentPendingResolutions([session], draft, strings);

        expect(result.status).toBe("ready");
        if (result.status !== "ready") return;
        expect(result.resolutions[0]).toMatchObject({
            kind: "tool_approval",
            toolCallId: "switch-1",
            approved: false,
            answers: [{selectedOptionIndex: -1, note: "先补测试", text: "补充建议\n备注：先补测试"}],
        });
    });

    it("Project、Session 或 pending 批次变化后拒绝迟到发布，旧 finally 不清新提交键", async () => {
        const controller = new AgentSurfaceOperationController();
        let scopeKey = "project-a@ready:1";
        let sessionId = 7;
        let sessions = [question("ask-a", ["A"])];
        const owner = controller.begin(scopeKey);
        const batchKey = pendingResolutionBatchKey(sessionId, sessions);
        if (!batchKey) throw new Error("测试 pending batch key 为空");
        const operation = {owner, sessionId, batchKey};
        let release!: () => void;
        const deferred = new Promise<void>((resolve) => {
            release = resolve;
        });
        let published = false;
        let submittingKey: string | null = batchKey;
        const oldRequest = (async () => {
            try {
                await deferred;
                published = acceptsAgentPendingOperation(controller, operation, scopeKey, sessionId, sessions);
            } finally {
                if (ownsAgentPendingSubmission(controller, operation, scopeKey, sessionId, submittingKey)) {
                    submittingKey = null;
                }
            }
        })();

        expect(acceptsAgentPendingOperation(controller, operation, scopeKey, sessionId, sessions)).toBe(true);
        expect(acceptsAgentPendingOperation(controller, operation, scopeKey, 8, sessions)).toBe(false);
        controller.begin(scopeKey);
        expect(acceptsAgentPendingOperation(controller, operation, scopeKey, sessionId, sessions)).toBe(false);

        scopeKey = "project-b@ready:1";
        sessionId = 9;
        sessions = [question("ask-b", ["B"])];
        const nextOwner = controller.begin(scopeKey);
        const nextBatchKey = pendingResolutionBatchKey(sessionId, sessions);
        if (!nextBatchKey) throw new Error("测试新 pending batch key 为空");
        submittingKey = nextBatchKey;
        release();
        await oldRequest;

        expect(published).toBe(false);
        expect(submittingKey).toBe(nextBatchKey);
        expect(acceptsAgentPendingOperation(controller, {owner: nextOwner, sessionId, batchKey: nextBatchKey}, scopeKey, sessionId, sessions)).toBe(true);
        expect(acceptsAgentPendingOperation(controller, {owner: nextOwner, sessionId, batchKey: nextBatchKey}, scopeKey, sessionId, [question("ask-c")])).toBe(false);
    });
});

function question(toolCallId: string, labels: string[] = []): AgentPendingUserInputSession {
    return {
        assistantMessageId: `assistant-${toolCallId}`,
        status: "pending",
        questions: [{
            toolNodeId: toolCallId,
            toolCallId,
            toolName: "request_user_input",
            questionIndex: 0,
            kind: "question",
            question: `问题 ${toolCallId}`,
            options: labels.map((label) => ({label})),
        }],
    };
}

function multiQuestion(toolCallId: string): AgentPendingUserInputSession {
    const first = question(toolCallId, ["A", "B"]);
    return {
        ...first,
        questions: [
            first.questions[0]!,
            {
                ...first.questions[0]!,
                questionIndex: 1,
                question: "开放问题",
                options: [],
            },
        ],
    };
}

function approval(toolCallId: string, planExit = false): AgentPendingUserInputSession {
    return {
        assistantMessageId: `assistant-${toolCallId}`,
        status: "pending",
        questions: [{
            toolNodeId: toolCallId,
            toolCallId,
            toolName: planExit ? "switch_mode" : "run_workflow",
            questionIndex: 0,
            kind: "tool_approval",
            approvalAction: planExit ? "switch_mode" : undefined,
            switchTargetMode: planExit ? "normal" : undefined,
            question: "是否继续？",
            options: [{label: "批准"}, {label: "拒绝"}],
        }],
    };
}

function form(toolCallId: string): AgentPendingUserInputSession {
    return {
        assistantMessageId: `assistant-${toolCallId}`,
        status: "pending",
        questions: [],
        formToolCallId: toolCallId,
        form: {
            defaults: {enabled: true},
            fields: [
                {
                    path: "name",
                    component: "text",
                    label: "名称",
                    required: true,
                    options: [],
                },
                {
                    path: "enabled",
                    component: "switch",
                    label: "启用",
                    required: false,
                    options: [],
                },
            ],
        },
    };
}
