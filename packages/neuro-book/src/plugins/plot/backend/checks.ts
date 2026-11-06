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
import type {CheckDependencies, CheckRecord, CheckUsage, SelfReport} from "../shared/checks";
import type {InstructionSnapshot} from "../shared/instructions";
import type {ChapterTable, PlotStore} from "./store";

export interface CheckFailure {
    readonly code: string;
    readonly kind?: string;
    /** 模型解析失败的码（配哪个角色）。 */
    readonly resolution?: string;
    readonly usage: CheckUsage;
}

export interface ChecksInput {
    readonly canon: Pick<CanonProject, "snapshot">;
    readonly store: Pick<PlotStore, "queued" | "write">;
    readonly instructions: ChapterTable<InstructionSnapshot>;
    readonly selfReports: ChapterTable<SelfReport>;
    readonly checks: ChapterTable<CheckRecord>;
    readonly dependencies: ChapterTable<CheckDependencies>;
    readonly models: CheckModels;
    readonly digest: Digest;
    readonly pluginVersion: string;
    /** 算依赖的摘要（`core/checks/dependencies.ts`）。 */
    readonly dependenciesOf: (view: Parameters<typeof planCheck>[0]["view"], chapter: string, followUps: readonly string[], concerned: {readonly points: readonly string[]; readonly concerns: readonly string[]}) => string;
    /** 写成功以后报新的数据版本（一处，否则 `pending` 命中旧缓存）。 */
    readonly changed: () => void;
    readonly stop: AbortSignal;
    readonly warn: (event: string, detail: string) => void;
}

export type RunResult = {readonly ok: true; readonly record: CheckRecord} | ({readonly ok: false} & CheckFailure);

/** 依赖摘要的回写（`core/checks/source.ts`）：轮到它时表里还是 `of` 那条记录才写，排队期间跑了新的检查，这份摘要就不是它的。写失败只多重拼一次，记诊断。 */
export function writeBackDependencies(store: Pick<PlotStore, "queued" | "write">, checks: ChapterTable<CheckRecord>, dependencies: ChapterTable<CheckDependencies>, warn: (event: string, detail: string) => void) {
    return (updated: CheckDependencies): void => {
        void store.queued(async () => {
            if (checks.digestOf(updated.chapter) !== updated.of) return;
            const written = await store.write(dependencies, updated.chapter, updated);
            if (!written.ok) warn("plot.store.write-back", `${written.code}: ${written.detail}`);
        }).catch((error: unknown) => warn("plot.store.write-back", String(error)));
    };
}

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
        if (running.has(chapter)) return {ok: false, code: "plot-check-busy", usage: ZERO_USAGE};
        if (input.stop.aborted) return {ok: false, code: "plot-check-cancelled", usage: ZERO_USAGE};
        const controller = new AbortController();
        running.set(chapter, controller);
        const fail = (failure: CheckFailure): RunResult => {
            failures.set(chapter, failure);
            return {ok: false, ...failure};
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
            const start = {worldVersion: view.version, textDigest: view.chapterTextDigest(chapter), pluginVersion: input.pluginVersion};
            const result = await runCheck({plan, models, limiter, signal: controller.signal, digest, followUps, names, start, ...(selfReport === undefined ? {} : {selfReport}), ...(given !== undefined && previous !== undefined ? {reuse: previous} : {})});
            if (!result.ok) return fail({code: result.code, ...(result.kind === undefined ? {} : {kind: result.kind}), ...(result.resolution === undefined ? {} : {resolution: result.resolution}), usage: result.usage});
            // 模型都答完了，排队等存储时仍可能被取消或入口停止：这次不存（失败表）。信号只在队列里看，轮到它之后就不再能取消。
            const saved = await store.queued(async () => {
                if (controller.signal.aborted) return null;
                const written = await store.write(checks, chapter, result.record);
                if (!written.ok) return written;
                // 记录已经存了：摘要写失败这次检查仍算成功（钱花了，结果在），下次读待处理多重拼一次。
                const stored = await store.write(input.dependencies, chapter, {chapter, of: checks.digestOf(chapter)!, dependencies, points: [...plan.points], concerns: [...plan.concerns]});
                if (!stored.ok) input.warn("plot.store.write-back", `${stored.code}: ${stored.detail}`);
                input.changed();
                return written;
            });
            if (saved === null) return fail({code: "plot-check-cancelled", kind: "cancelled", usage: result.record.usage.total});
            if (!saved.ok) return fail({code: "plot-check-failed", kind: saved.code, usage: result.record.usage.total});
            return {ok: true, record: result.record};
        } catch (error) {
            // 约定不抛错；真抛了也要收口：调用方拿到失败，`status` 能查到，不留一个内部错误。
            input.warn("plot.check.exception", String(error));
            return fail({code: "plot-check-failed", kind: "exception", usage: ZERO_USAGE});
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
