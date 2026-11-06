/**
 * `ask`（docs/specs/agent/builtin-tools.md 输出 23–25）：把一批问题交给内核的提问通道，运行停下等回答。两条贡献，给模型的名字相同：
 * 带 `form` 的那条声明多，省 token 时换绑固定 schema 的。
 *
 * 向导提交前校验过；工具再按请求校验一次，只防别的调用方（内核的 `resolve` 不认识问题的形状）。
 */

import {checkDescription, resolveForm, validateForm} from "@notnotype/nb-form";

import type {JsonValue, ToolResult} from "@notnotype/nb-harness/kernel/contracts";

import type {AgentToolDeclaration, AgentToolImplementation} from "../../shared/points";

import {failed} from "./common";

export interface AskQuestion {
    readonly question: string;
    readonly header?: string;
    readonly options: ReadonlyArray<{readonly label: string; readonly description?: string}>;
    readonly multiSelect?: boolean;
    readonly form?: Readonly<Record<string, unknown>>;
}

export interface AskAnswer {
    readonly selected: readonly string[];
    readonly other?: string;
    readonly form?: JsonValue;
}

const NOTE = "向用户提问并等回答：1 到 4 题，每题 2 到 4 个选项，界面总会另给一个“其它”，不用自己写。信息不够、要用户拍板时用它，能自己决定的不要问。单独调用，不要和别的工具放在同一条回复：同一条回复里的别的工具不会等这个回答。";

const questionProperties = {
    question: {type: "string", description: "完整的问题"},
    header: {type: "string", description: "很短的标题，显示在标签上"},
    options: {
        type: "array",
        minItems: 2,
        maxItems: 4,
        items: {type: "object", properties: {label: {type: "string"}, description: {type: "string"}}, required: ["label"]},
    },
    multiSelect: {type: "boolean", description: "可以多选"},
};

const declarationOf = (description: string, properties: Readonly<Record<string, unknown>>): AgentToolDeclaration => ({
    description,
    parameters: {
        type: "object",
        properties: {questions: {type: "array", minItems: 1, maxItems: 4, items: {type: "object", properties, required: ["question", "options"]}}},
        required: ["questions"],
    },
    version: "1",
    concurrency: "exclusive",
    effect: "read",
});

export const askDeclaration = declarationOf(NOTE, questionProperties);
export const askFormDeclaration = declarationOf(
    `${NOTE}要用户填几个值时，给这一题加 form（JSON Schema，根是对象，字段只用基本类型）；有表单的题用户可以只填表单。`,
    {...questionProperties, form: {type: "object", description: "JSON Schema：要用户填的表单"}},
);

/** 不合规交回问题的描述；都合规交回 null。 */
function answerProblem(questions: readonly AskQuestion[], answers: readonly AskAnswer[]): string | null {
    if (answers.length !== questions.length) return `expected ${String(questions.length)} answers, got ${String(answers.length)}`;
    for (const [index, question] of questions.entries()) {
        const answer = answers[index]!;
        const labels = new Set(question.options.map((option) => option.label));
        const unknown = answer.selected.find((label) => !labels.has(label));
        if (unknown !== undefined) return `question ${String(index + 1)}: ${unknown} is not one of the options`;
        if (question.multiSelect !== true && answer.selected.length > 1) return `question ${String(index + 1)} takes one option`;
        if (new Set(answer.selected).size !== answer.selected.length) return `question ${String(index + 1)} repeats an option`;
        if (question.form === undefined) {
            if (answer.form !== undefined) return `question ${String(index + 1)} has no form`;
        } else if (answer.form !== undefined) {
            const issues = validateForm(resolveForm(question.form), answer.form);
            if (issues.length > 0) return `question ${String(index + 1)}: the form is invalid (${issues.map((issue) => issue.code).join(", ")})`;
        }
        if (answer.selected.length === 0 && (answer.other ?? "").trim() === "" && answer.form === undefined) return `question ${String(index + 1)} is not answered`;
    }
    return null;
}

function isAnswers(value: unknown): value is {readonly answers: readonly AskAnswer[]} {
    if (typeof value !== "object" || value === null) return false;
    const {answers} = value as {answers?: unknown};
    return Array.isArray(answers) && answers.every((answer: unknown) => {
        if (typeof answer !== "object" || answer === null) return false;
        const {selected, other} = answer as {selected?: unknown; other?: unknown};
        return Array.isArray(selected) && selected.every((label) => typeof label === "string") && (other === undefined || typeof other === "string");
    });
}

/** 给模型看的文字按结构化的回答拼，不用向导拼给人看的那段：`details` 不进模型请求。 */
function modelText(questions: readonly AskQuestion[], answers: readonly AskAnswer[]): string {
    return questions.map((question, index) => {
        const answer = answers[index]!;
        const parts = [...answer.selected, ...(answer.other === undefined || answer.other.trim() === "" ? [] : [`其它：${answer.other}`]), ...(answer.form === undefined ? [] : [`表单：${JSON.stringify(answer.form)}`])];
        return `${question.question}\n回答：${parts.join("；")}`;
    }).join("\n\n");
}

export const askTool: AgentToolImplementation = {
    create: (context) => ({
        execute: async (args, call): Promise<ToolResult> => {
            // 后台会话没有人答：停在这里会一直等到任务超时，直接告诉模型。
            if (context.background === true || call.ask === undefined) return failed("ask-unavailable", "ask-unavailable: 这个会话没有人能回答问题，按现有信息继续，把不确定的地方写清楚。");
            const questions = args.questions as readonly AskQuestion[];
            for (const [index, question] of questions.entries()) {
                if (question.form === undefined) continue;
                const check = checkDescription(question.form, {policy: "agent"});
                if (check.status !== "invalid") continue;
                const problems = check.problems.filter((problem) => problem.severity === "error").map((problem) => `${problem.path === "" ? "/" : problem.path}: ${problem.code}`);
                return {...failed("ask-form-invalid", `ask-form-invalid: 第 ${String(index + 1)} 题的 form 不合规，用户没有看到这个问题：${problems.join("；")}`), details: {code: "ask-form-invalid", problems}};
            }
            const reply = await call.ask({question: questions.map((question) => question.question).join("\n"), data: {questions: questions as unknown as JsonValue}});
            if (reply.kind === "unavailable") return failed("ask-declined", "ask-declined: 用户没有回答，这一轮到此为止或换个做法，不要重复问同样的问题。");
            // 子会话的提问由父会话回答时只有文字（session 的 `questions: "caller"`）；用户从界面答总是结构化的，缺了和答错一样。
            if (reply.data === undefined && reply.by.kind === "session") return {text: reply.text};
            if (!isAnswers(reply.data)) return failed("ask-invalid-answer", "ask-invalid-answer: the answer is not in the expected shape");
            const problem = answerProblem(questions, reply.data.answers);
            if (problem !== null) return failed("ask-invalid-answer", `ask-invalid-answer: ${problem}`);
            return {text: modelText(questions, reply.data.answers), details: reply.data as unknown as JsonValue};
        },
    }),
};
