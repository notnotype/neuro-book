import type {
    AgentPendingUserInputQuestion,
    AgentPendingUserInputSession,
} from "nbook/app/components/novel-ide/agent/agent-message";
import type {
    AgentSurfaceActivationAttempt,
    AgentSurfaceOperationController,
} from "nbook/app/components/novel-ide/agent/agent-chat-surface-state";
import {withLowCodeFormDefaults} from "nbook/app/components/common/low-code-form/low-code-form-utils";
import {assertPublicToolCallId} from "nbook/shared/agent/public-tool-identity";
import type {AgentResolutionDto} from "nbook/shared/dto/agent-session.dto";
import type {LowCodeJsonObject} from "nbook/shared/dto/low-code-form.dto";

export type AgentPendingQuestionDraft = {
    /** 未选择时为空；-1 表示“其他答案”或计划补充建议。 */
    selectedOptionIndex?: number;
    note: string;
};

export type AgentPendingFormDraft = {
    data: LowCodeJsonObject;
    confirmed: boolean;
};

export type AgentPendingResolutionDraft = {
    answers: Record<string, AgentPendingQuestionDraft>;
    forms: Record<string, AgentPendingFormDraft>;
};

/** 当前 pending 批次的可恢复提交状态；批次变化后必须丢弃。 */
export type AgentPendingSubmissionIssue = {
    kind: "error" | "unknown";
    message: string;
};

export type AgentPendingOperationOwner = Readonly<{
    owner: AgentSurfaceActivationAttempt;
    sessionId: number;
    batchKey: string;
}>;

export type AgentPendingQuestionItem = {
    kind: "question" | "approval";
    key: string;
    toolCallId: string;
    session: AgentPendingUserInputSession;
    question: AgentPendingUserInputQuestion;
};

export type AgentPendingFormItem = {
    kind: "form";
    key: string;
    toolCallId: string;
    session: AgentPendingUserInputSession;
};

export type AgentPendingResolutionItem = AgentPendingQuestionItem | AgentPendingFormItem;

export type AgentPendingResolutionStrings = {
    otherAnswer: string;
    addSuggestion: string;
    continueLabel: string;
    noteLabel: (note: string) => string;
};

export type AgentPendingResolutionBuild =
    | {status: "ready"; resolutions: AgentResolutionDto[]}
    | {status: "incomplete"; firstIncompleteKey: string};

/** 生成问答草稿的稳定身份。 */
export function pendingQuestionKey(toolCallId: string, questionIndex: number): string {
    return `question:${toolCallId}:${String(questionIndex)}`;
}

/** 生成表单草稿的稳定身份。 */
export function pendingFormKey(toolCallId: string): string {
    return `form:${toolCallId}`;
}

/** 按服务端 pending 和问题顺序投影底部面板项目。 */
export function pendingResolutionItems(sessions: readonly AgentPendingUserInputSession[]): AgentPendingResolutionItem[] {
    return sessions.flatMap((session): AgentPendingResolutionItem[] => {
        if (session.form) {
            if (!session.formToolCallId) {
                throw new Error("Agent pending form 缺少 toolCallId");
            }
            return [{
                kind: "form",
                key: pendingFormKey(session.formToolCallId),
                toolCallId: session.formToolCallId,
                session,
            }];
        }
        return session.questions.map((question) => {
            const toolCallId = question.toolCallId ?? question.toolNodeId;
            return {
                kind: question.kind === "tool_approval" ? "approval" as const : "question" as const,
                key: pendingQuestionKey(toolCallId, question.questionIndex),
                toolCallId,
                session,
                question,
            };
        });
    });
}

/** 为当前权威 pending 列表创建空草稿；审批不会自动选择批准。 */
export function createAgentPendingResolutionDraft(sessions: readonly AgentPendingUserInputSession[]): AgentPendingResolutionDraft {
    return reconcileAgentPendingResolutionDraft(sessions, {answers: {}, forms: {}});
}

/** 只保留仍存在的稳定身份草稿，避免 recovery 重投影清掉用户输入。 */
export function reconcileAgentPendingResolutionDraft(
    sessions: readonly AgentPendingUserInputSession[],
    current: AgentPendingResolutionDraft,
): AgentPendingResolutionDraft {
    const next: AgentPendingResolutionDraft = {answers: {}, forms: {}};
    for (const item of pendingResolutionItems(sessions)) {
        if (item.kind === "form") {
            next.forms[item.key] = current.forms[item.key] ?? {data: {}, confirmed: false};
            continue;
        }
        next.answers[item.key] = current.answers[item.key] ?? {note: ""};
    }
    return next;
}

/** Low-Code Form 修改后原子撤销确认，避免提交用户尚未复核的新值。 */
export function updateAgentPendingFormDraft(
    current: AgentPendingResolutionDraft,
    key: string,
    data: LowCodeJsonObject,
): AgentPendingResolutionDraft {
    return {
        answers: current.answers,
        forms: {
            ...current.forms,
            [key]: {data, confirmed: false},
        },
    };
}

/** 判断单个待处理项目是否具备明确 resolution。 */
export function pendingResolutionItemComplete(item: AgentPendingResolutionItem, draft: AgentPendingResolutionDraft): boolean {
    if (item.kind === "form") {
        return draft.forms[item.key]?.confirmed === true;
    }
    const answer = draft.answers[item.key];
    if (!answer) return false;
    const note = answer.note.trim();
    if (item.kind === "approval") {
        if (answer.selectedOptionIndex === 0 || answer.selectedOptionIndex === 1) return true;
        return isPlanSuggestion(item.question, answer.selectedOptionIndex) && Boolean(note);
    }
    if (item.question.options.length === 0) return Boolean(note);
    if (answer.selectedOptionIndex === -1) return Boolean(note);
    return answer.selectedOptionIndex !== undefined
        && answer.selectedOptionIndex >= 0
        && answer.selectedOptionIndex < item.question.options.length;
}

/** 生成用于异步 compare-and-publish 的有序 pending 批次键。 */
export function pendingResolutionBatchKey(sessionId: number | null, sessions: readonly AgentPendingUserInputSession[]): string | null {
    if (!sessionId || sessions.length === 0) return null;
    const toolCallIds = sessions.map((session) => {
        const toolCallId = session.formToolCallId ?? session.questions[0]?.toolCallId ?? session.questions[0]?.toolNodeId;
        if (!toolCallId) throw new Error("Agent pending session 缺少 toolCallId");
        return toolCallId;
    });
    return `${String(sessionId)}\n${toolCallIds.join("\n")}`;
}

/** Project owner、主 Session 与有序 pending 批次必须同时匹配。 */
export function acceptsAgentPendingOperation(
    controller: AgentSurfaceOperationController,
    operation: AgentPendingOperationOwner,
    currentScopeKey: string,
    currentSessionId: number | null,
    sessions: readonly AgentPendingUserInputSession[],
): boolean {
    return controller.accepts(operation.owner, currentScopeKey)
        && currentSessionId === operation.sessionId
        && pendingResolutionBatchKey(currentSessionId, sessions) === operation.batchKey;
}

/** finally 只能释放自己持有的提交键；批次已变化不妨碍清理旧键。 */
export function ownsAgentPendingSubmission(
    controller: AgentSurfaceOperationController,
    operation: AgentPendingOperationOwner,
    currentScopeKey: string,
    currentSessionId: number | null,
    submittingKey: string | null,
): boolean {
    return controller.accepts(operation.owner, currentScopeKey)
        && currentSessionId === operation.sessionId
        && submittingKey === operation.batchKey;
}

/** 所有项目完成后，按服务端 pending 顺序一次生成完整 resolutions。 */
export function buildAgentPendingResolutions(
    sessions: readonly AgentPendingUserInputSession[],
    draft: AgentPendingResolutionDraft,
    strings: AgentPendingResolutionStrings,
): AgentPendingResolutionBuild {
    const items = pendingResolutionItems(sessions);
    const firstIncomplete = items.find((item) => !pendingResolutionItemComplete(item, draft));
    if (firstIncomplete) {
        return {status: "incomplete", firstIncompleteKey: firstIncomplete.key};
    }

    const resolutions = sessions.map((session): AgentResolutionDto => {
        if (session.form) {
            const toolCallId = assertPublicToolCallId(session.formToolCallId ?? "");
            const formDraft = draft.forms[pendingFormKey(toolCallId)];
            if (!formDraft?.confirmed) throw new Error(`Agent pending form ${toolCallId} 尚未确认`);
            return {
                kind: "user_input",
                toolCallId,
                data: withLowCodeFormDefaults(session.form, formDraft.data),
            };
        }

        const firstQuestion = session.questions[0];
        if (!firstQuestion) throw new Error("Agent pending question session 没有问题");
        const toolCallId = assertPublicToolCallId(firstQuestion.toolCallId ?? firstQuestion.toolNodeId);
        const answers = session.questions.map((question) => {
            const answer = draft.answers[pendingQuestionKey(toolCallId, question.questionIndex)];
            if (!answer) throw new Error(`Agent pending question ${toolCallId} 缺少草稿`);
            const note = answer.note.trim();
            return {
                questionIndex: question.questionIndex,
                text: formatAnswerText(question, answer.selectedOptionIndex, note, strings),
                ...(answer.selectedOptionIndex !== undefined ? {selectedOptionIndex: answer.selectedOptionIndex} : {}),
                ...(note ? {note} : {}),
            };
        });

        if (firstQuestion.kind === "tool_approval") {
            return {
                kind: "tool_approval",
                toolCallId,
                approved: answers[0]?.selectedOptionIndex === 0,
                resultText: answers.map((answer) => answer.text).join("\n"),
                answers,
            };
        }
        return {kind: "user_input", toolCallId, answers};
    });
    return {status: "ready", resolutions};
}

/** 判断审批的 -1 是否表示退出计划模式时的补充建议。 */
export function isPlanSuggestion(question: AgentPendingUserInputQuestion, selectedOptionIndex?: number): boolean {
    return selectedOptionIndex === -1
        && question.approvalAction === "switch_mode"
        && question.switchTargetMode === "normal";
}

/** 保留现有模型可读答案格式，同时把结构化选择与 note 分开提交。 */
function formatAnswerText(
    question: AgentPendingUserInputQuestion,
    selectedOptionIndex: number | undefined,
    note: string,
    strings: AgentPendingResolutionStrings,
): string {
    const selectedText = selectedOptionIndex === undefined
        ? ""
        : selectedOptionIndex === -1
            ? isPlanSuggestion(question, selectedOptionIndex) ? strings.addSuggestion : strings.otherAnswer
            : question.options[selectedOptionIndex]?.label ?? String(selectedOptionIndex);
    if (selectedText && note) return `${selectedText}\n${strings.noteLabel(note)}`;
    return note || selectedText || strings.continueLabel;
}
