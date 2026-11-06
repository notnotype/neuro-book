/**
 * 对第 N 章跑一次检查的入口（docs/specs/plot/checks.md 输出 7、10 与失败表）：取快照、同步拼计划、调模型、存记录。
 *
 * `run` 的信号只接 `cancel` 与入口停止，不接调用方的：检查要几分钟、花钱，刷新页面不该丢已花的钱。
 */

import type {CanonProject} from "nbook/plugins/canon/shared/contracts";

import {createLimiter, runCheck, type CheckModels} from "../core/checks/run";
import {namesOfSegments, planCheck} from "../core/checks/plan";
import type {Digest} from "../core/guards";
import {ZERO_USAGE} from "../shared/checks";
import type {CheckRecord, CheckUsage, SelfReport} from "../shared/checks";
import type {InstructionSnapshot} from "../shared/instructions";
import type {ChapterTable, PlotStore} from "./store";

export interface CheckFailure {
    readonly code: string;
    readonly kind?: string;
    readonly usage: CheckUsage;
}

export interface ChecksInput {
    readonly canon: CanonProject;
    readonly store: PlotStore;
    readonly instructions: ChapterTable<InstructionSnapshot>;
    readonly selfReports: ChapterTable<SelfReport>;
    readonly checks: ChapterTable<CheckRecord>;
    readonly models: CheckModels;
    readonly digest: Digest;
    readonly pluginVersion: string;
    /** 算依赖的摘要（`core/checks/dependencies.ts`）。 */
    readonly dependenciesOf: (view: Parameters<typeof planCheck>[0]["view"], chapter: string, followUps: readonly string[], concerned: {readonly points: readonly string[]; readonly concerns: readonly string[]}) => string;
    /** 写成功以后报新的数据版本（一处，否则 `pending` 命中旧缓存）。 */
    readonly changed: () => void;
    readonly stop: AbortSignal;
}

export type RunResult = {readonly ok: true; readonly record: CheckRecord} | {readonly ok: false; readonly code: string};

export function createChecks(input: ChecksInput) {
    const {canon, store, instructions, selfReports, checks, models, digest} = input;
    const running = new Map<string, AbortController>();
    const failures = new Map<string, CheckFailure>();
    // 项目实例一份的并发上限：批量重跑时总并发也受限。
    const limiter = createLimiter(4);

    const onStop = () => {
        for (const controller of running.values()) controller.abort();
    };
    input.stop.addEventListener("abort", onStop, {once: true});

    const run = async (chapter: string, given: readonly string[] | undefined): Promise<RunResult> => {
        if (running.has(chapter)) return {ok: false, code: "plot-check-busy"};
        const controller = new AbortController();
        running.set(chapter, controller);
        const fail = (failure: CheckFailure): RunResult => {
            failures.set(chapter, failure);
            return {ok: false, code: failure.code};
        };
        try {
            failures.delete(chapter);
            const snapshot = await canon.snapshot();
            if ("code" in snapshot) return fail({code: snapshot.code, usage: ZERO_USAGE});
            const {view} = snapshot;
            if (!view.chapters.includes(chapter)) return fail({code: "chapter-not-found", usage: ZERO_USAGE});
            // 没有正文的章问模型没有意义，不花这个钱。
            if ((view.chapterText(chapter) ?? "").trim() === "") return fail({code: "chapter-empty", usage: ZERO_USAGE});
            const previous = checks.get(chapter);
            const followUps = given ?? previous?.followUps ?? [];
            const instruction = instructions.get(chapter);
            const selfReport = selfReports.get(chapter);
            // 同步段：计划与依赖的摘要都在第一次 `await` 之前算完（快照过了 `await` 就不能再用）。
            const plan = planCheck({view, chapter, followUps, digest, ...(instruction === undefined ? {} : {instruction}), ...(selfReport === undefined ? {} : {selfReport})});
            if ("code" in plan) return fail({code: plan.code, usage: ZERO_USAGE});
            const dependencies = input.dependenciesOf(view, chapter, followUps, plan);
            const names = namesOfSegments(view, chapter, instruction);
            const start = {worldVersion: view.version, textDigest: view.chapterTextDigest(chapter), pluginVersion: input.pluginVersion, dependencies};
            const result = await runCheck({plan, models, limiter, signal: controller.signal, digest, followUps, names, start, ...(selfReport === undefined ? {} : {selfReport}), ...(given !== undefined && previous !== undefined ? {reuse: previous} : {})});
            if (!result.ok) return fail({code: result.code, ...(result.kind === undefined ? {} : {kind: result.kind}), usage: result.usage});
            const saved = await store.queued(async () => {
                const written = await store.write(checks, chapter, result.record);
                if (written.ok) input.changed();
                return written;
            });
            if (!saved.ok) return fail({code: "plot-check-failed", kind: saved.code, usage: result.record.usage.total});
            return {ok: true, record: result.record};
        } finally {
            running.delete(chapter);
        }
    };

    return {
        run,
        cancel: (chapter: string) => running.get(chapter)?.abort(),
        status: (chapter: string) => ({running: running.has(chapter), lastFailure: failures.get(chapter) ?? null}),
        release: () => input.stop.removeEventListener("abort", onStop),
    };
}
