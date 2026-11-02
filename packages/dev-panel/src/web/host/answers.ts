import {isEarlierPageQuestion} from "../../core/questions.js";
import type {QuestionState, VersionQuestion} from "./types.js";

/**
 * 产物页侧栏的分组与答案的文字（t15 阶段 4 第 1 批）：答复表单、问题侧栏与提交成功的提示共用。
 * 分组只看最新一版的题表与现算的状态（docs/file-formats.md 的“状态现算”），不另存。
 */

/**
 * 控件里清空了的取值：多选全取消、文字只剩空白、单选与确认点了“清除选择”（`undefined`）。清空的题回到“没答”、不交；
 * 不这样它仍算改过，校验报“要选至少一个选项”，整份答复都交不了（t19，开发者 11-02：有的题不能不选）。
 */
export function isBlankAnswer(value: unknown): boolean {
    return value === undefined || (Array.isArray(value) && value.length === 0) || (typeof value === "string" && value.trim() === "");
}

/** 答案给人看的文字：选项值换成选项名，确认题写“同意”“不同意”，多选用顿号连起来。 */
export function answerText(question: Pick<VersionQuestion, "type" | "options">, value: unknown): string {
    const label = (entry: unknown) => question.options.find((option) => option.value === entry)?.label ?? String(entry);
    if (question.type === "confirm") return value === true ? "同意" : value === false ? "不同意" : String(value);
    if (Array.isArray(value)) return value.map(label).join("、");
    return question.type === "single" ? label(value) : String(value);
}

export type QuestionGroups = {
    /** 这一版里能答、还没答的题（含旧答复作废要重答的）；必答在前 */
    pending: QuestionState[];
    /** 这一版里能答、已经答了的题 */
    answered: QuestionState[];
    /** 之前几版的题：页面上已经没有、只为答案还查得到，只读 */
    earlier: QuestionState[];
    /** 已取代与撤回（服务端拒答时报 question_closed） */
    closed: QuestionState[];
};

export function groupQuestions(questions: readonly QuestionState[]): QuestionGroups {
    const groups: QuestionGroups = {pending: [], answered: [], earlier: [], closed: []};
    for (const state of questions) {
        if (state.state === "withdrawn" || state.state === "superseded") groups.closed.push(state);
        else if (isEarlierPageQuestion(state.question)) groups.earlier.push(state);
        else if (state.state === "answered") groups.answered.push(state);
        else groups.pending.push(state);
    }
    groups.pending.sort((left, right) => Number(right.question.required) - Number(left.question.required));
    return groups;
}

/** 这一版新加的题：第一次出现在最新一版，而且不是第一版（第一版的题都是新的，不标）。 */
export function isNewQuestion(question: Pick<VersionQuestion, "since">, latestVersion: number): boolean {
    return latestVersion > 1 && question.since === latestVersion;
}

/**
 * “改答”与提交时这道题的取值。控件不在加载时预填：提交成功后表单先按提交前的题表清空、新数据随后才到，
 * 别处（代录、另一个标签页）答的题也是推送来的，加载时的预填会漏掉它们。所以开始改答时才取现在的答案，
 * 提交时没改过取值（只写了说明）的题直接用现在的答案。
 */
export function editingValue(state: QuestionState, values: Readonly<Record<string, unknown>>, touched: Readonly<Record<string, boolean>>): unknown {
    return touched[state.question.id] ? values[state.question.id] : state.answer?.value;
}
export const submittedValue = editingValue;

/** 作废的旧答复为什么要重答。 */
export function staleText(state: QuestionState): string | null {
    if (!state.stale) return null;
    const value = answerText(state.question, state.stale.value);
    return state.stale.code === "stale_value" ? `旧答复“${value}”按 v${state.stale.artifactVersion} 合法，但选项后来改了，要重新答` : `旧答复“${value}”本身就不合法，要重新答`;
}
