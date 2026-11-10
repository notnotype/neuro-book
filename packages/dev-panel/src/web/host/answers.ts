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

/**
 * 这份草稿会交哪些题：待答的，加上点了“改答”的已答题，其中改过取值或写了说明的。
 * 表单的“提交 N 题”与产物页收起答题栏后的提交栏共用（t23）。
 */
export function chosenQuestions(questions: readonly QuestionState[], draft: Pick<AnswerDraft, "touched" | "comments" | "editing">): QuestionState[] {
    const {pending, answered} = groupQuestions(questions);
    const editable = [...pending, ...answered.filter((state) => draft.editing[state.question.id])];
    return editable.filter((state) => draft.touched[state.question.id] || (draft.comments[state.question.id] ?? "").trim() !== "");
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

/**
 * 答复表单里还没交的填写（t21）：取值、哪些题改过、各题的说明与是否展开说明框、哪些已答的题点了“改答”、整份的备注，
 * 以及哪些题的取值是在评审板页面里填的（t23，`fromPage`，侧栏据此标“页面里填的”）。
 * 由产物页持有、存在这台浏览器里（`host/answer-draft.ts`），表单经 `v-model:draft` 改它；离开页面、刷新、面板重启后回来还在。
 */
export type AnswerDraft = {
    values: Record<string, unknown>;
    touched: Record<string, boolean>;
    comments: Record<string, string>;
    commenting: Record<string, boolean>;
    editing: Record<string, boolean>;
    note: string;
    fromPage: Record<string, boolean>;
};

export function emptyAnswerDraft(): AnswerDraft {
    return {values: {}, touched: {}, comments: {}, commenting: {}, editing: {}, note: "", fromPage: {}};
}

/**
 * 改一道题的取值，返回新的整份草稿：取值照存（文本框里的空白仍显示），清空了的不算改过、不交。
 * `fromPage` 记这次是不是页面里改的：侧栏里再改就去掉标记，清空了也去掉。
 */
export function setDraftValue(draft: AnswerDraft, id: string, value: unknown, fromPage: boolean): AnswerDraft {
    const blank = isBlankAnswer(value);
    const marks = Object.fromEntries(Object.entries(draft.fromPage).filter(([key]) => key !== id));
    return {...draft, values: {...draft.values, [id]: value}, touched: {...draft.touched, [id]: !blank}, fromPage: fromPage && !blank ? {...marks, [id]: true} : marks};
}

/** 草稿里有没有值得留的东西：改过的取值、写了字的说明或备注、点了“改答”的题。只展开了空的说明框不算。 */
export function hasDraftContent(draft: AnswerDraft): boolean {
    const any = (record: Record<string, boolean>) => Object.values(record).some(Boolean);
    return any(draft.touched) || any(draft.editing) || Object.values(draft.comments).some((text) => text.trim() !== "") || draft.note.trim() !== "";
}

/** 读回存着的草稿：形状不对（旧版本存的、被手改过）就当没有，返回 null。取值不在这里校验，表单按题当场校验。 */
export function parseAnswerDraft(raw: unknown): AnswerDraft | null {
    if (typeof raw !== "object" || raw === null) return null;
    const draft = raw as Record<string, unknown>;
    const recordOf = (value: unknown, check: (entry: unknown) => boolean) => typeof value === "object" && value !== null && !Array.isArray(value) && Object.values(value).every(check);
    const isBoolean = (entry: unknown) => typeof entry === "boolean";
    const isString = (entry: unknown) => typeof entry === "string";
    if (!recordOf(draft.values, () => true) || !recordOf(draft.touched, isBoolean) || !recordOf(draft.comments, isString) || !recordOf(draft.commenting, isBoolean) || !recordOf(draft.editing, isBoolean) || typeof draft.note !== "string") return null;
    // t21 存下的草稿没有 `fromPage`：补成空的；有但形状不对就整份不要。
    if (draft.fromPage !== undefined && !recordOf(draft.fromPage, isBoolean)) return null;
    return {
        values: draft.values as Record<string, unknown>,
        touched: draft.touched as Record<string, boolean>,
        comments: draft.comments as Record<string, string>,
        commenting: draft.commenting as Record<string, boolean>,
        editing: draft.editing as Record<string, boolean>,
        note: draft.note,
        fromPage: (draft.fromPage ?? {}) as Record<string, boolean>,
    };
}

/** 作废的旧答复为什么要重答。 */
export function staleText(state: QuestionState): string | null {
    if (!state.stale) return null;
    const value = answerText(state.question, state.stale.value);
    return state.stale.code === "stale_value" ? `旧答复“${value}”按 v${state.stale.artifactVersion} 合法，但选项后来改了，要重新答` : `旧答复“${value}”本身就不合法，要重新答`;
}
