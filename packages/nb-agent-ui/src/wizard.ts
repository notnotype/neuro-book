/**
 * 审批与提问向导的纯逻辑（docs/specs/agent/conversation.md 输出 11–13）：选了什么、能不能提交、提交什么。放在组件外，单测能逐条覆盖。
 *
 * 选了的只在界面状态里，提交前不进内核：模型一次发起几个调用时，用户是对着这一批作答，能来回改。
 */
import type {InputResolution, JsonValue, PendingApprovalView, PendingInputView, PendingQuestionsView, PendingQuestionView} from "./types";

export type ApprovalDecision = "allow" | "allow-session" | "deny";
export type ApprovalChoice = {decision: ApprovalDecision; note?: string};
export type QuestionAnswer = {selected: string[]; other?: string; form?: JsonValue};

/** 向导的界面状态，能完整表示成 JSON：宿主替它存着，切标签回来还在。 */
export type WizardState = {
    collapsed: boolean;
    /** 第几步（第几个审批、第几题），从 0 数。 */
    step: number;
    /** 按事项 id。 */
    approvals: {[id: string]: ApprovalChoice};
    /** 没选定的附言，按事项 id：写到一半切走再回来还在。 */
    notes: {[id: string]: string};
    /** 按事项 id、再按题。 */
    answers: {[id: string]: QuestionAnswer[]};
};

export const EMPTY_WIZARD: WizardState = {collapsed: false, step: 0, approvals: {}, notes: {}, answers: {}};

/** 宿主放回来的是 JSON；读不懂的按空的来，不让向导画不出来。 */
export function readWizardState(value: JsonValue | undefined): WizardState {
    if (value === null || value === undefined || typeof value !== "object" || Array.isArray(value)) return EMPTY_WIZARD;
    return {...EMPTY_WIZARD, ...(value as unknown as Partial<WizardState>)};
}

export const isApproval = (item: PendingInputView): item is PendingApprovalView => item.kind === "approval";
export const isQuestions = (item: PendingInputView): item is PendingQuestionsView => item.kind === "question";

/** 选了一个决定。“本会话都批准”同时选中这批里同一个工具的其余调用：它们也不会再问了。 */
export function choose(state: WizardState, items: readonly PendingApprovalView[], id: string, decision: ApprovalDecision, note?: string): WizardState {
    const approvals = {...state.approvals, [id]: {decision, ...(note === undefined || note === "" ? {} : {note})}};
    if (decision === "allow-session") {
        const tool = items.find((item) => item.id === id)?.tool;
        for (const item of items) if (item.tool === tool) approvals[item.id] = {decision: "allow-session"};
    }
    return {...state, approvals};
}

/** 都选了才能提交。 */
export const allChosen = (state: WizardState, items: readonly PendingApprovalView[]): boolean => items.every((item) => state.approvals[item.id] !== undefined);

/** 第一个还没选的；都选了时是 null。 */
export function nextUnchosen(state: WizardState, items: readonly PendingApprovalView[], after: number): number | null {
    for (let offset = 1; offset <= items.length; offset += 1) {
        const index = (after + offset) % items.length;
        if (state.approvals[items[index]!.id] === undefined) return index;
    }
    return null;
}

export const approvalResolution = (choice: ApprovalChoice): InputResolution => ({kind: "approval", decision: choice.decision, ...(choice.note === undefined ? {} : {note: choice.note})});

export const emptyAnswer = (): QuestionAnswer => ({selected: []});

/** 这一题答了没有：选了选项、写了“其它”，或填了表单。表单对不对由 `formValid` 判断（向导问 nb-form）。 */
export function answered(question: PendingQuestionView, answer: QuestionAnswer | undefined, formValid: boolean): boolean {
    if (answer === undefined) return false;
    if (question.form !== undefined && answer.form !== undefined && !formValid) return false;
    return answer.selected.length > 0 || (answer.other ?? "").trim() !== "" || answer.form !== undefined;
}

/** 内核要求回答有文字（harness/runtime.md 输出 41）：按题拼成人话，写进日志。模型看到的是工具按结构化的值拼的。 */
export function answerText(questions: readonly PendingQuestionView[], answers: readonly QuestionAnswer[], labels: {other: string; form: string}): string {
    return questions.map((question, index) => {
        const answer = answers[index] ?? emptyAnswer();
        const parts = [...answer.selected, ...((answer.other ?? "").trim() === "" ? [] : [`${labels.other}${answer.other!.trim()}`]), ...(answer.form === undefined ? [] : [`${labels.form}${JSON.stringify(answer.form)}`])];
        return `${question.question} ${parts.join("、")}`;
    }).join("\n");
}

/** 提交的回答：没答的题给空的选项，“其它”去掉首尾空白，空的不带。 */
export function questionResolution(questions: readonly PendingQuestionView[], answers: readonly QuestionAnswer[], labels: {other: string; form: string}): InputResolution {
    const cleaned = questions.map((_, index) => {
        const answer = answers[index] ?? emptyAnswer();
        const other = (answer.other ?? "").trim();
        return {selected: answer.selected, ...(other === "" ? {} : {other}), ...(answer.form === undefined ? {} : {form: answer.form})};
    });
    return {kind: "question", answer: {text: answerText(questions, answers, labels), data: {answers: cleaned as unknown as JsonValue}}};
}
