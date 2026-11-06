/**
 * 检查的测试夹具：按题目种类答题的模型替身。它和真实通道同一个端口（`CheckModels`），真实通道经本机假端点的测试在 `plot.test.ts`。只由测试用。
 */

import {createHash} from "node:crypto";

import type {CheckRecord, CheckRequest, CheckRole, FixedAnswer, SelfReport} from "../shared/checks";
import {ZERO_USAGE} from "../shared/checks";
import type {InstructionSnapshot} from "../shared/instructions";
import type {PlotWorld} from "./world";
import {checkDiagnostics} from "../core/checks/diagnostics";
import {namesOfSegments, planCheck, type CheckPlan} from "../core/checks/plan";
import {createLimiter, runCheck, type AskResult, type CheckModels, type RunFailure} from "../core/checks/run";
import {isValid} from "../core/checks/validity";

export const digest = (text: string) => createHash("sha256").update(text).digest("hex");
export const USAGE = {input: 10, output: 2, cacheRead: 0, cacheWrite: 0, cost: null};

/** 规则项的 id（题面里 `- <id>：`）。 */
export const ruleIds = (request: CheckRequest) => [...request.user.matchAll(/^- (\S+?)：/gmu)].map((match) => match[1]!);

/** 什么都没发现的答案。 */
export function cleanAnswer(request: CheckRequest): unknown {
    switch (request.answer) {
        case "yesNo":
            return {answer: "no", quotes: []};
        case "object":
            return {moved: "no", quotes: [], before: "", after: "", who: ""};
        case "fixed":
            return {items: ruleIds(request).map((item) => ({item, answer: "no", quotes: []})), newFacts: []} satisfies FixedAnswer;
        case "trial":
            return {guess: "", confidence: "none", quotes: []};
        case "judge":
            return {verdict: "inconsistent"};
    }
}

export type Script = (role: CheckRole, request: CheckRequest, attempt: number) => unknown;

/** 答题的替身：脚本返回 undefined 时答“没发现”；返回 `{ok: false, …}` 的算这次调用失败。记下每次调用。 */
export function scripted(script: Script = () => undefined, problem: string | null = null) {
    const asked: {role: CheckRole; request: CheckRequest}[] = [];
    const attempts = new Map<string, number>();
    const models: CheckModels = {
        available: () => Promise.resolve(problem),
        ask: (role, request) => {
            asked.push({role, request});
            const key = `${role}\u0000${request.user}`;
            const attempt = (attempts.get(key) ?? 0) + 1;
            attempts.set(key, attempt);
            const answer = script(role, request, attempt);
            if (typeof answer === "object" && answer !== null && "ok" in answer && (answer as {ok: unknown}).ok === false) return Promise.resolve(answer as AskResult);
            return Promise.resolve({ok: true, answer: answer === undefined ? cleanAnswer(request) : answer, usage: USAGE});
        },
    };
    return {models, asked};
}

export const failure = (kind: "retryable" | "fatal" | "length" | "cancelled", name = "network"): AskResult => ({ok: false, failure: kind, kind: name, usage: USAGE});

export interface Scene {
    readonly instruction?: InstructionSnapshot;
    readonly selfReport?: SelfReport;
    readonly followUps?: readonly string[];
    readonly reuse?: CheckRecord;
    readonly signal?: AbortSignal;
}

export function planOf(w: PlotWorld, chapter: string, scene: Scene = {}): CheckPlan {
    const plan = planCheck({view: w.view(), chapter, followUps: scene.followUps ?? [], digest, ...(scene.instruction === undefined ? {} : {instruction: scene.instruction}), ...(scene.selfReport === undefined ? {} : {selfReport: scene.selfReport})});
    if ("code" in plan) throw new Error(plan.code);
    return plan;
}

/** 跑一次检查。 */
export async function run(w: PlotWorld, chapter: string, models: CheckModels, scene: Scene = {}) {
    return runCheck({
        plan: planOf(w, chapter, scene),
        models,
        limiter: createLimiter(4),
        signal: scene.signal ?? new AbortController().signal,
        digest,
        followUps: scene.followUps ?? [],
        names: namesOfSegments(w.view(), chapter, scene.instruction),
        start: {worldVersion: w.world.version, textDigest: null, pluginVersion: "test", dependencies: ""},
        ...(scene.selfReport === undefined ? {} : {selfReport: scene.selfReport}),
        ...(scene.reuse === undefined ? {} : {reuse: scene.reuse}),
    });
}

export async function runOk(w: PlotWorld, chapter: string, models: CheckModels, scene: Scene = {}): Promise<CheckRecord> {
    const result = await run(w, chapter, models, scene);
    if (!result.ok) throw new Error(JSON.stringify(result as RunFailure));
    return result.record;
}

/** 这些记录现在报出什么：诊断 id 到发现。 */
export function reported(w: PlotWorld, records: readonly CheckRecord[], scene: Scene = {}, at?: string, edge: "start" | "end" = "end") {
    const compute = checkDiagnostics({
        all: () => records,
        valid: (view, record) => isValid({view, record, digest, ...(scene.instruction === undefined ? {} : {instruction: scene.instruction}), ...(scene.selfReport === undefined ? {} : {selfReport: scene.selfReport})}),
    }, digest);
    const view = w.view();
    const position = {kind: "chapter" as const, chapter: at ?? view.chapters.at(-1)!, edge};
    return Object.fromEntries(Object.entries(compute).flatMap(([id, fn]) => {
        const found = fn(view, position, "actual");
        return found.length === 0 ? [] : [[id, found] as const];
    }));
}

export {ZERO_USAGE};
