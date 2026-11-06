/**
 * 写完以后的检查（docs/specs/plot/checks.md）的共用形状与远程合同 `nbook.plot/checks`。
 */

import {ReadPositionSchema} from "@notnotype/nb-canon/schema";
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

const UsageSchema = Type.Object({input: Type.Number(), output: Type.Number(), cacheRead: Type.Number(), cacheWrite: Type.Number(), cost: Type.Union([Type.Number(), Type.Null()])});
export type CheckUsage = Static<typeof UsageSchema>;
export const ZERO_USAGE: CheckUsage = {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: null};

const Segment = Type.Object({id: Type.String(), line: Type.String(), from: Type.Integer(), to: Type.Integer()});
const Rule = Type.Object({item: Type.String(), text: Type.String(), segment: Type.Optional(Type.String()), decision: Type.Optional(Type.String())});
const NewFact = Type.Object({kind: Type.Union([Type.Literal("knowing"), Type.Literal("invention")]), text: Type.String(), name: Type.Optional(Type.String()), quotes: Quotes, segment: Type.String(), line: Type.String()});
const CallRecord = Type.Object({
    id: Type.String(),
    layer: Type.String(),
    role: Type.Union([Type.Literal("ledger"), Type.Literal("reader")]),
    question: Type.String(),
    digest: Type.String(),
    /** 校验过的答案（引文对不上的已改成“看不出”）。 */
    answer: Type.Unknown(),
    usage: UsageSchema,
    /** 沿用上一条记录的答案，这次没调模型。 */
    reused: Type.Optional(Type.Boolean()),
    segment: Type.Optional(Type.String()),
    point: Type.Optional(Type.String()),
    person: Type.Optional(Type.String()),
    personName: Type.Optional(Type.String()),
    object: Type.Optional(Type.String()),
    foreshadows: Type.Optional(Type.Array(Type.String())),
    contradicts: Type.Optional(Type.Boolean()),
    /** 这次调用丢掉了几条引文对不上的答案；沿用时跟着沿用。 */
    badQuotes: Type.Optional(Type.Integer()),
});
export type CallRecord = Static<typeof CallRecord>;

const CheckUsageCounts = Type.Object({narrow: Type.Integer(), fixed: Type.Integer(), trial: Type.Integer(), judge: Type.Integer(), reused: Type.Integer(), total: UsageSchema});

/** 一条检查记录（checks.md 输出 7）。模型调用的输入不存，只存摘要。 */
export const CheckRecordSchema = Type.Object({
    chapter: Type.String(),
    /** 开始时的世界版本与正文摘要（有效与否不读它们，只给作者看）。 */
    worldVersion: Type.Integer(),
    textDigest: Type.Union([Type.String(), Type.Null()]),
    pluginVersion: Type.String(),
    /** 依赖的摘要（`core/checks/dependencies.ts`）：不算内容，回写不改数据版本。 */
    dependencies: Type.String(),
    /** 本章涉及的知识点与条目：依赖摘要按它们取后面的揭示与挂着的决策。它们由世界的前缀决定，前缀没变它们就没变。 */
    points: Type.Array(Type.String()),
    concerns: Type.Array(Type.String()),
    segments: Type.Array(Segment),
    followUps: Type.Array(Type.String()),
    calls: Type.Array(CallRecord),
    rules: Type.Array(Rule),
    trials: Type.Array(Type.Object({point: Type.String(), truth: Type.String(), materialKind: Type.Union([Type.Literal("suspense"), Type.Literal("twoChapters")]), material: Type.Array(Type.Object({chapter: Type.String(), paragraph: Type.Optional(Type.Integer())}))})),
    newFacts: Type.Array(NewFact),
    unasked: Type.Array(Type.Object({id: Type.String(), layer: Type.String()})),
    unlisted: Type.Integer(),
    uncast: Type.Integer(),
    incomplete: Type.Array(Type.String()),
    noSuspense: Type.Array(Type.String()),
    noReaderQuestion: Type.Array(Type.String()),
    /** 费用的记录（输出 10）：这次实际调模型的次数与用量。 */
    usage: CheckUsageCounts,
});
export type CheckRecord = Static<typeof CheckRecordSchema>;

/** `kind` 是错误类别，`resolution` 是模型解析失败的码（配哪个角色），`usage` 是到此为止的用量（失败的检查不存记录，用量只有这里）。 */
const errors = {plot: Type.Object({code: Type.String(), kind: Type.Optional(Type.String()), resolution: Type.Optional(Type.String()), usage: Type.Optional(UsageSchema)})};
const Page = {cursor: Type.Optional(Type.String()), limit: Type.Optional(Type.Integer({minimum: 1, maximum: 200}))};

const methods = {
    /** 按章替换写手的自陈（`value` 为 null 是删除）。 */
    putSelfReport: {input: Type.Object({chapter: Type.String(), value: Type.Union([SelfReportSchema, Type.Null()])}), output: Type.Object({dataVersion: Type.String()}), effect: "write", errors},
    /**
     * 对第 N 章跑一次检查（输出 7）。等到完成才返回；调用方断开或中止不影响检查，结果照存（检查要几分钟、花钱），断开以后查 `status` 与
     * `record`。`followUps` 给了就替换补问清单，不给沿用记录里的，空数组清空（输出 5）。
     */
    run: {input: Type.Object({chapter: Type.String(), followUps: Type.Optional(Type.Array(Type.String(), {maxItems: 500}))}), output: Type.Object({chapter: Type.String(), calls: Type.Integer(), unasked: Type.Integer(), incomplete: Type.Integer(), usage: CheckUsageCounts}), effect: "write", errors},
    /** 取消正在跑的检查；没有在跑时什么也不做。 */
    cancel: {input: Type.Object({chapter: Type.String()}), output: Type.Null(), effect: "write", errors},
    /** 是否在跑、最近一次失败（只在内存：失败的检查不存记录，用量只有这里记）。 */
    status: {input: Type.Object({chapter: Type.String()}), output: Type.Object({running: Type.Boolean(), lastFailure: Type.Union([Type.Null(), Type.Object({code: Type.String(), kind: Type.Optional(Type.String()), resolution: Type.Optional(Type.String()), usage: UsageSchema})])}), effect: "read", errors},
    /** 这一章的检查记录与它现在有效不有效。 */
    record: {input: Type.Object({chapter: Type.String()}), output: Type.Object({status: Type.Union([Type.Literal("none"), Type.Literal("valid"), Type.Literal("stale")]), record: Type.Union([CheckRecordSchema, Type.Null()])}), effect: "read", errors},
    /** 保密账本（输出 9）：每个保密以上的知识点，在给定的线与位置上谁知道、谁误信、谁怀疑，读者从哪一段起怀疑、知道。 */
    secretLedger: {input: Type.Object({position: Type.Optional(ReadPositionSchema), mode: Type.Optional(Type.Union([Type.Literal("actual"), Type.Literal("planned")])), ...Page}), output: Type.Unknown(), effect: "read", errors},
    /** 读者现在知道什么（输出 9）：最新一章末尾读者的程度不是 `unaware` 的知识点。 */
    readerKnown: {input: Type.Object({...Page}), output: Type.Unknown(), effect: "read", errors},
    /** 改揭晓章的依赖（输出 9）：对知识点 K，哪些计划、悬念、决策、写作指示依赖它。 */
    revealDependencies: {input: Type.Object({point: Type.String()}), output: Type.Unknown(), effect: "read", errors},
} as const;

export const plotChecksContract = defineRemoteService({id: "nbook.plot/checks", version: 1, provider: "project", callers: ["browser", "tui", "server"], methods, events: {}});
