/**
 * 写完以后的检查（docs/specs/plot/checks.md）的共用形状与远程合同 `nbook.plot/checks`。
 */

import {defineRemoteService} from "@notnotype/nb-runtime/remote";
import {Type} from "typebox";
import type {Static} from "typebox";

const Text = Type.String({maxLength: 20_000});

/**
 * 写手的自陈（brief.md 输出 11）与它实际拿到的上下文（checks.md 输入）。写完以后世界已经变了，重拼出来的上下文不是写手当时那份，
 * 所以由写作任务连同自陈一起交回。
 */
export const SelfReportSchema = Type.Object({
    chapter: Type.String(),
    report: Type.Object({
        names: Type.Array(Text, {maxItems: 500}),
        unsure: Type.Array(Text, {maxItems: 500}),
        deviations: Type.Array(Text, {maxItems: 500}),
    }, {additionalProperties: false}),
    brief: Type.String({maxLength: 400_000}),
}, {additionalProperties: false});

export type SelfReport = Static<typeof SelfReportSchema>;

/** 模型调用的角色：记账 Agent 回答窄问题，试读模型只给原文、不给真相（checks.md 术语）。 */
export type CheckRole = "ledger" | "reader";

const Answer3 = Type.Union([Type.Literal("yes"), Type.Literal("no"), Type.Literal("unclear")]);
const Quotes = Type.Array(Type.String());

/**
 * 各种答案的结构（强制调用的 `answer` 工具的参数）。结构校验放宽：引文长度、条数不写进 schema，由程序处理（`run.ts`），否则模型多写
 * 一点就整次失败。
 */
export const ANSWER_SCHEMAS = {
    yesNo: Type.Object({answer: Answer3, quotes: Quotes}),
    object: Type.Object({moved: Answer3, quotes: Quotes, before: Type.String(), after: Type.String(), who: Type.String()}),
    fixed: Type.Object({
        items: Type.Array(Type.Object({item: Type.String(), answer: Answer3, quotes: Quotes})),
        newFacts: Type.Array(Type.Object({kind: Type.Union([Type.Literal("knowing"), Type.Literal("invention")]), text: Type.String(), name: Type.Optional(Type.String()), quotes: Quotes})),
    }),
    trial: Type.Object({guess: Type.String(), confidence: Type.Union([Type.Literal("certain"), Type.Literal("strong"), Type.Literal("slight"), Type.Literal("none")]), quotes: Quotes}),
    judge: Type.Object({verdict: Type.Union([Type.Literal("consistent"), Type.Literal("partial"), Type.Literal("inconsistent")])}),
} as const;

export type AnswerKind = keyof typeof ANSWER_SCHEMAS;
export type YesNoAnswer = Static<typeof ANSWER_SCHEMAS.yesNo>;
export type ObjectAnswer = Static<typeof ANSWER_SCHEMAS.object>;
export type FixedAnswer = Static<typeof ANSWER_SCHEMAS.fixed>;
export type TrialAnswer = Static<typeof ANSWER_SCHEMAS.trial>;
export type JudgeAnswer = Static<typeof ANSWER_SCHEMAS.judge>;

/** 一次模型调用的请求：`system`、`user` 与答案的种类决定输入摘要（`maxTokens` 不算：加大重试不是输入变了）。 */
export interface CheckRequest {
    readonly system: string;
    readonly user: string;
    readonly answer: AnswerKind;
    readonly maxTokens: number;
}

const errors = {plot: Type.Object({code: Type.String()})};

const methods = {
    /** 按章替换写手的自陈（`value` 为 null 是删除）。 */
    putSelfReport: {input: Type.Object({chapter: Type.String(), value: Type.Union([SelfReportSchema, Type.Null()])}), output: Type.Object({dataVersion: Type.String()}), effect: "write", errors},
} as const;

export const plotChecksContract = defineRemoteService({id: "nbook.plot/checks", version: 1, provider: "project", callers: ["browser", "tui", "server"], methods, events: {}});
