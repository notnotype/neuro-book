/**
 * 跑一次检查（docs/specs/plot/checks.md 输出 3、6、7、10）：按计划调模型，核对答案，组成记录。不碰世界：计划与要用的表都在第一次
 * `await` 之前算完，快照过了 `await` 就不能再用（canon 的项目内接口）。记录由调用方存。
 *
 * 一次检查要二十几次调用，所以失败分三类：可重试的（网络、限流、服务商、结构不对、这次超时）重试一次，不让中转站的偶发错误白花前面的钱；
 * 立即放弃的（鉴权、额度、本地、上下文溢出）重试没有意义，还取消同批在途的调用；撞上输出上限的加大上限重试一次，半截的答案不当答案。
 */

import {Value} from "typebox/value";

import {ANSWER_SCHEMAS, ZERO_USAGE} from "../../shared/checks";
import type {AnswerKind, CallRecord, CheckRecord, CheckRequest, CheckRole, CheckUsage, FixedAnswer, ObjectAnswer, SelfReport, TrialAnswer, YesNoAnswer} from "../../shared/checks";
import type {Digest} from "../guards";
import {inputDigest, type CheckPlan, type PlannedCall} from "./plan";
import {quoteIn} from "./segments";
import {judgeRequest} from "./trial";

/** 模型调用的结果。`failure` 是错误类别（`network`、`auth`……），`cancelled` 是这次调用被取消或超时。 */
export type AskResult =
    | {readonly ok: true; readonly answer: unknown; readonly usage: CheckUsage}
    | {readonly ok: false; readonly failure: "retryable" | "fatal" | "length" | "cancelled"; readonly kind: string; readonly usage: CheckUsage};

/** 宿主提供的模型调用（输出：记账 Agent 与试读模型）。 */
export interface CheckModels {
    /** 两个角色都能用时为 null；否则是解析失败的码。不花钱。 */
    available(): Promise<string | null>;
    ask(role: CheckRole, request: CheckRequest, signal: AbortSignal): Promise<AskResult>;
}

/** 项目实例一份的并发上限：批量重跑时总并发也受限。 */
export interface Limiter {
    run<T>(work: () => Promise<T>): Promise<T>;
}

export function createLimiter(limit: number): Limiter {
    let active = 0;
    const waiting: (() => void)[] = [];
    return {
        run: async (work) => {
            if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
            active += 1;
            try {
                return await work();
            } finally {
                active -= 1;
                waiting.shift()?.();
            }
        },
    };
}

export type RunFailure = {readonly ok: false; readonly code: "plot-check-unavailable" | "plot-check-failed" | "plot-check-cancelled"; readonly detail?: string; readonly kind?: string; readonly usage: CheckUsage};

export interface RunInput {
    readonly plan: CheckPlan;
    readonly models: CheckModels;
    readonly limiter: Limiter;
    readonly selfReport?: SelfReport;
    /** 带 `followUps` 时给：输入摘要相同的调用沿用它的答案（输出 5）。 */
    readonly reuse?: CheckRecord;
    /** 各段世界里已有的名字（`namesOfSegments`，在第一次 `await` 之前算好）。 */
    readonly names: ReadonlyMap<string, ReadonlySet<string>>;
    readonly signal: AbortSignal;
    readonly digest: Digest;
    readonly followUps: readonly string[];
    readonly start: {readonly worldVersion: number; readonly textDigest: string | null; readonly pluginVersion: string; readonly dependencies: string};
}

const MAX_QUOTE = 500;
const MAX_NEW_FACTS = 30;

const clip = (text: string) => [...text].slice(0, MAX_QUOTE).join("");

function addUsage(total: CheckUsage, usage: CheckUsage): CheckUsage {
    return {
        input: total.input + usage.input,
        output: total.output + usage.output,
        cacheRead: total.cacheRead + usage.cacheRead,
        cacheWrite: total.cacheWrite + usage.cacheWrite,
        cost: total.cost === null && usage.cost === null ? null : (total.cost ?? 0) + (usage.cost ?? 0),
    };
}

/** 正面的答案要有引文，引文都要核对得上（输出 6）。 */
const quotesHold = (quotes: readonly string[], paragraphs: readonly string[]) => quotes.length > 0 && quotes.every((quote) => quoteIn(paragraphs, quote));

export async function runCheck(input: RunInput): Promise<{readonly ok: true; readonly record: CheckRecord} | RunFailure> {
    const {plan, models, limiter, signal, digest} = input;
    const unavailable = await models.available();
    if (unavailable !== null) return {ok: false, code: "plot-check-unavailable", detail: unavailable, usage: ZERO_USAGE};

    let total: CheckUsage = ZERO_USAGE;
    // 立即放弃时取消同批在途的调用；取消（外面的信号）与放弃走同一个控制器，都不再往下跑。
    const batch = new AbortController();
    const relay = () => batch.abort();
    signal.addEventListener("abort", relay, {once: true});
    if (signal.aborted) batch.abort();
    let failed: RunFailure | null = null;
    const fail = (failure: RunFailure) => {
        failed ??= failure;
        batch.abort();
    };
    const failure = (code: RunFailure["code"], kind: string): RunFailure => ({ok: false, code, kind, usage: total});

    /** 调一次模型，按结果重试；失败时记下并返回 null。 */
    const ask = async (role: CheckRole, request: CheckRequest): Promise<{readonly answer: unknown; readonly usage: CheckUsage} | null> => {
        let current = request;
        let retried = false;
        let lengthened = false;
        let spent: CheckUsage = ZERO_USAGE;
        for (;;) {
            if (batch.signal.aborted) return null;
            const result = await limiter.run(async () => (batch.signal.aborted ? null : models.ask(role, current, batch.signal)));
            if (result === null) return null;
            spent = addUsage(spent, result.usage);
            total = addUsage(total, result.usage);
            if (result.ok) {
                if (Value.Check(ANSWER_SCHEMAS[request.answer as AnswerKind], result.answer)) return {answer: result.answer, usage: spent};
            } else if (result.failure === "cancelled" && signal.aborted) {
                fail(failure("plot-check-cancelled", "cancelled"));
                return null;
            } else if (result.failure === "fatal") {
                fail(failure("plot-check-failed", result.kind));
                return null;
            } else if (result.failure === "length") {
                if (lengthened) {
                    fail(failure("plot-check-failed", "length"));
                    return null;
                }
                lengthened = true;
                current = {...current, maxTokens: current.maxTokens * 2};
                continue;
            }
            if (retried) {
                fail(failure("plot-check-failed", result.ok ? "invalid-answer" : result.kind));
                return null;
            }
            retried = true;
        }
    };

    const reused = new Map((input.reuse?.calls ?? []).map((call) => [call.id, call]));
    const counts = {narrow: 0, fixed: 0, trial: 0, judge: 0, reused: 0};
    const countOf = (layer: string): keyof typeof counts => (layer === "fixed" ? "fixed" : layer === "reader" ? "trial" : layer === "judge" ? "judge" : "narrow");

    /** 一次调用：摘要相同的沿用上一条记录校验过的答案，不再调模型。 */
    const resolve = async (call: {readonly id: string; readonly layer: string; readonly role: CheckRole; readonly request: CheckRequest; readonly digest: string}): Promise<{readonly answer: unknown; readonly usage: CheckUsage; readonly reused: boolean} | null> => {
        const previous = reused.get(call.id);
        if (previous !== undefined && previous.digest === call.digest) {
            counts.reused += 1;
            return {answer: previous.answer, usage: ZERO_USAGE, reused: true};
        }
        const answered = await ask(call.role, call.request);
        if (answered === null) return null;
        counts[countOf(call.layer)] += 1;
        return {...answered, reused: false};
    };

    let badQuotes = 0;
    const answers = await Promise.all(plan.calls.map(async (call) => {
        const answered = await resolve(call);
        return answered === null ? null : {call, answered};
    }));
    signal.removeEventListener("abort", relay);
    if (signal.aborted && failed === null) return failure("plot-check-cancelled", "cancelled");
    if (failed !== null) return failed;

    const calls: CallRecord[] = [];
    const incomplete: string[] = [];
    let newFacts: CheckRecord["newFacts"] = [];
    let unlisted = 0;
    const judges: {readonly point: string; readonly truth: string; readonly answer: TrialAnswer}[] = [];
    const record = (call: PlannedCall, answer: unknown, usage: CheckUsage, wasReused: boolean) => {
        calls.push({
            id: call.id,
            layer: call.layer,
            role: call.role,
            question: call.question,
            digest: call.digest,
            answer,
            usage,
            ...(wasReused ? {reused: true} : {}),
            ...(call.segment === undefined ? {} : {segment: call.segment}),
            ...(call.point === undefined ? {} : {point: call.point}),
            ...(call.person === undefined ? {} : {person: call.person}),
            ...(call.personName === undefined ? {} : {personName: call.personName}),
            ...(call.object === undefined ? {} : {object: call.object}),
            ...(call.contradicts === undefined ? {} : {contradicts: call.contradicts}),
        });
    };
    for (const item of answers) {
        if (item === null) continue;
        const {call, answered} = item;
        switch (call.layer) {
            case "presence":
            case "narration":
            case "time": {
                const answer = answered.answer as YesNoAnswer;
                if (answer.answer === "yes" && !quotesHold(answer.quotes, call.paragraphs)) {
                    badQuotes += 1;
                    record(call, {answer: "unclear", quotes: []} satisfies YesNoAnswer, answered.usage, answered.reused);
                } else record(call, {answer: answer.answer, quotes: answer.answer === "yes" ? answer.quotes.map(clip) : []} satisfies YesNoAnswer, answered.usage, answered.reused);
                break;
            }
            case "object": {
                const answer = answered.answer as ObjectAnswer;
                if (answer.moved === "yes" && !quotesHold(answer.quotes, call.paragraphs)) {
                    badQuotes += 1;
                    record(call, {moved: "unclear", quotes: [], before: "", after: "", who: ""} satisfies ObjectAnswer, answered.usage, answered.reused);
                } else record(call, {...answer, quotes: answer.moved === "yes" ? answer.quotes.map(clip) : []}, answered.usage, answered.reused);
                break;
            }
            case "fixed": {
                const answer = answered.answer as FixedAnswer | {readonly items: FixedAnswer["items"]};
                const items = checkRuleItems(plan, answer.items, incomplete, () => (badQuotes += 1));
                const facts = "newFacts" in answer ? checkNewFacts(plan, answer.newFacts, input.names, input.selfReport, () => (badQuotes += 1)) : {kept: input.reuse?.newFacts ?? [], unlisted: input.reuse?.unlisted ?? 0};
                newFacts = facts.kept;
                unlisted = facts.unlisted;
                record(call, {items}, answered.usage, answered.reused);
                break;
            }
            case "reader": {
                const answer = answered.answer as TrialAnswer;
                const valid = answer.confidence !== "none" && quotesHold(answer.quotes, call.paragraphs);
                if (answer.confidence !== "none" && !valid) badQuotes += 1;
                const checked: TrialAnswer = valid ? {...answer, quotes: answer.quotes.map(clip)} : {guess: "", confidence: "none", quotes: []};
                record(call, checked, answered.usage, answered.reused);
                // 看不出的不判一致（没有东西可判）。
                if (valid) judges.push({point: call.point!, truth: plan.trials.find((trial) => trial.point === call.point)!.truth, answer: checked});
                break;
            }
        }
    }

    // 判一致排在试读之后，输入只有试读的答案与命题，结果不回给试读（输出 4）。
    const judged = await Promise.all(judges.map(async (judge) => {
        const request = judgeRequest(judge.truth, judge.answer);
        const call = {id: `judge:${judge.point}`, layer: "judge", role: "ledger" as const, request, digest: inputDigest(request, digest)};
        const answered = await resolve(call);
        return answered === null ? null : {...call, point: judge.point, answered};
    }));
    if (signal.aborted && failed === null) return failure("plot-check-cancelled", "cancelled");
    if (failed !== null) return failed;
    for (const item of judged) {
        if (item === null) continue;
        calls.push({id: item.id, layer: "judge", role: "ledger", question: "判一致", digest: item.digest, answer: item.answered.answer, usage: item.answered.usage, point: item.point, ...(item.answered.reused ? {reused: true} : {})});
    }

    return {
        ok: true,
        record: {
            chapter: plan.chapter,
            worldVersion: input.start.worldVersion,
            textDigest: input.start.textDigest,
            pluginVersion: input.start.pluginVersion,
            dependencies: input.start.dependencies,
            points: [...plan.points],
            concerns: [...plan.concerns],
            segments: plan.segments.map(({id, line, from, to}) => ({id, line, from, to})),
            followUps: [...input.followUps],
            calls,
            rules: plan.rules.map((rule) => ({...rule})),
            trials: plan.trials.map(({point, truth, materialKind, material}) => ({point, truth, materialKind, material: material.map((item) => ({...item}))})),
            newFacts,
            unasked: plan.unasked.map((item) => ({...item})),
            unlisted,
            uncast: plan.uncast,
            incomplete,
            badQuotes,
            noSuspense: [...plan.noSuspense],
            noReaderQuestion: [...plan.noReaderQuestion],
            usage: {...counts, total},
        },
    };
}

/** 规则项（输出 3）：缺了的算未答，让这次检查标不完整；不是规则项的丢掉；答 yes 的引文要对得上（按段的规则项要落在那一段）。 */
function checkRuleItems(plan: CheckPlan, items: FixedAnswer["items"], incomplete: string[], bad: () => void): FixedAnswer["items"] {
    const given = new Map(items.map((item) => [item.item, item]));
    const whole = plan.segments.flatMap((segment) => segment.paragraphs);
    const checked: FixedAnswer["items"] = [];
    for (const rule of plan.rules) {
        const item = given.get(rule.item);
        if (item === undefined) {
            incomplete.push(rule.item);
            continue;
        }
        if (item.answer !== "yes") {
            checked.push({item: rule.item, answer: item.answer, quotes: []});
            continue;
        }
        const segment = plan.segments.find((candidate) => candidate.id === rule.segment);
        if (quotesHold(item.quotes, segment?.paragraphs ?? whole)) checked.push({item: rule.item, answer: "yes", quotes: item.quotes.map(clip)});
        else {
            bad();
            checked.push({item: rule.item, answer: "unclear", quotes: []});
        }
    }
    return checked;
}

/** 新事实（输出 3）：按第一处引文归段；对不上的丢掉并计数；带 `name` 的查世界与自陈，查到就不算；超过上限的记未列。 */
function checkNewFacts(plan: CheckPlan, facts: FixedAnswer["newFacts"], names: ReadonlyMap<string, ReadonlySet<string>>, selfReport: SelfReport | undefined, bad: () => void): {readonly kept: CheckRecord["newFacts"]; readonly unlisted: number} {
    const kept: CheckRecord["newFacts"] = [];
    let unlisted = 0;
    for (const fact of facts) {
        const home = fact.quotes.length === 0 ? undefined : plan.segments.find((segment) => quoteIn(segment.paragraphs, fact.quotes[0]!));
        if (home === undefined || !fact.quotes.every((quote) => plan.segments.some((segment) => quoteIn(segment.paragraphs, quote)))) {
            bad();
            continue;
        }
        const name = fact.name?.trim();
        if (name !== undefined && name !== "" && (names.get(home.id)?.has(name) === true || selfReport?.report.names.some((reported) => reported.includes(name)) === true)) continue;
        if (kept.length >= MAX_NEW_FACTS) {
            unlisted += 1;
            continue;
        }
        kept.push({kind: fact.kind, text: fact.text, ...(name === undefined || name === "" ? {} : {name}), quotes: fact.quotes.map(clip), segment: home.id, line: home.line});
    }
    return {kept, unlisted};
}
