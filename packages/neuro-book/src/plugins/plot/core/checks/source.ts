/**
 * 诊断读检查记录的来源（`diagnostics.ts` 的 `CheckSource`）：先比依赖的摘要，相同就是有效；不同才重拼，结论放进内存；仍有效时把新摘要回写（不是记录的内容，不改数据版本），否则
 * 每次重启都要重拼。回写由调用方排队，这里在诊断的同步段里，不等。
 *
 * 摘要只覆盖一份计划读的东西（`dependencies.ts`），所以只有按**这份计划**涉及的条目算的摘要没变，才能说这份计划没变。记录过期以后，存下的摘要是旧计划的；结论的备忘要按重拼时的计划算，
 * 不能按记录存的。
 */

import type {CanonReadView} from "@notnotype/nb-canon/schema";

import type {CheckDependencies, CheckRecord, SelfReport} from "../../shared/checks";
import type {InstructionSnapshot} from "../../shared/instructions";
import type {Digest} from "../guards";
import {dependenciesOf} from "./dependencies";
import type {CheckSource} from "./diagnostics";
import {validityOf} from "./validity";

export interface ChapterRead<T> {
    get(chapter: string): T | undefined;
    digestOf(chapter: string): string | undefined;
}

/** 本章涉及的知识点与条目：依赖摘要按它们取条目的历史。 */
export interface Concerned {
    readonly points: readonly string[];
    readonly concerns: readonly string[];
}

export interface SourceInput {
    readonly records: {all(): readonly CheckRecord[]};
    /** 这条记录内容的摘要：存下的依赖摘要、结论的备忘都认它。 */
    readonly recordDigest: (record: CheckRecord) => string;
    readonly dependencies: {get(chapter: string): CheckDependencies | undefined};
    readonly instructions: ChapterRead<InstructionSnapshot>;
    readonly selfReports: ChapterRead<SelfReport>;
    readonly pluginVersion: string;
    readonly digest: Digest;
    /** 仍有效时把新摘要写回去。调用方排队，轮到时表里还是 `of` 那条记录才写：期间跑了新的检查，这份摘要就不是它的。 */
    readonly writeBack: (updated: CheckDependencies) => void;
    /** 抽样复核发现摘要的结论与重拼不同：记一条诊断，这是依赖摘要的 bug。 */
    readonly warn: (event: string, detail: string) => void;
}

export interface FullCheckSource extends CheckSource {
    /** 这一章现在的依赖摘要；章不在章序里时为 null。`concerned` 是存下的（或这次计划算出的）本章涉及的知识点与条目。 */
    dependencies(view: CanonReadView, chapter: string, followUps: readonly string[], concerned: Concerned): string | null;
}

const NOTHING: Concerned = {points: [], concerns: []};
const AUDITS_PER_VIEW = 2;
/** 永远对不上的摘要：抽样复核发现这条记录的摘要不可信时写回去。 */
const DISTRUSTED = "distrusted";

export function createCheckSource(input: SourceInput): FullCheckSource {
    const {instructions, selfReports, digest} = input;
    // 结论是“重拼的计划与这条记录比”的结果：记录没变（`of`）、这份计划读的东西没变（按它涉及的条目算的摘要），结论就没变。
    const verdicts = new Map<string, {readonly of: string; readonly concerned: Concerned; readonly dependencies: string | null; readonly valid: boolean}>();
    const distrusted = new Set<string>();
    // 抽样复核：每张新视图重拼几章，与摘要的结论比（输出 7）。依赖摘要是对“计划读了什么”的推理，漏过几次（dependencies.ts）；漏了的话旧结论会一直报下去，不提示要重跑。按章轮流抽，
    // 一千章每次发布抽两章，几百次发布轮一遍；别的章的结论不受影响。
    const audits = new WeakMap<CanonReadView, Set<string>>();
    let auditCursor = 0;
    const auditsOf = (view: CanonReadView): Set<string> => {
        let picked = audits.get(view);
        if (picked === undefined) {
            const rows = input.records.all();
            picked = new Set(Array.from({length: Math.min(AUDITS_PER_VIEW, rows.length)}, (_, index) => rows[(auditCursor + index) % rows.length]!.chapter));
            auditCursor = rows.length === 0 ? 0 : (auditCursor + AUDITS_PER_VIEW) % rows.length;
            audits.set(view, picked);
        }
        return picked;
    };
    const dependencies: FullCheckSource["dependencies"] = (view, chapter, followUps, concerned) => {
        const instruction = instructions.get(chapter);
        const instructionDigest = instructions.digestOf(chapter);
        const selfReport = selfReports.digestOf(chapter);
        return dependenciesOf({view, chapter, followUps, points: concerned.points, concerns: concerned.concerns, pluginVersion: input.pluginVersion, digest, ...(instruction === undefined || instructionDigest === undefined ? {} : {instruction: {snapshot: instruction, digest: instructionDigest}}), ...(selfReport === undefined ? {} : {selfReport})});
    };
    return {
        all: () => input.records.all(),
        dependencies,
        valid: (view, record) => {
            const {chapter, followUps} = record;
            const of = input.recordDigest(record);
            const stored = input.dependencies.get(chapter);
            const memo = verdicts.get(chapter);
            // 摘要能回答就不重拼。章不在章序里时摘要是 null，计划也读不到它。
            let answer: boolean | null = null;
            if (stored?.of === of && !distrusted.has(of)) {
                const current = dependencies(view, chapter, followUps, stored);
                if (current === null) return false;
                if (current === stored.dependencies) answer = true;
            }
            if (answer === null && memo !== undefined && memo.of === of && memo.dependencies !== null && dependencies(view, chapter, followUps, memo.concerned) === memo.dependencies) answer = memo.valid;
            if (answer !== null && !auditsOf(view).delete(chapter)) return answer;

            const instruction = instructions.get(chapter);
            const selfReport = selfReports.get(chapter);
            const {valid, plan} = validityOf({view, record, digest, ...(instruction === undefined ? {} : {instruction}), ...(selfReport === undefined ? {} : {selfReport})});
            // 只留这两个数组：整份计划带着每次调用的全文，每章一份能到 100 KiB。
            const concerned = plan === null ? NOTHING : {points: plan.points, concerns: plan.concerns};
            const next = dependencies(view, chapter, followUps, concerned);
            verdicts.set(chapter, {of, concerned, dependencies: next, valid});
            if (answer !== null && answer !== valid) input.warn("plot.check.digest-mismatch", `${chapter}：摘要的结论是 ${String(answer)}，重拼是 ${String(valid)}`);
            if (answer === true && !valid) {
                // 这份摘要不可信：回写之前的这段时间也不走它；写一个对不上的值，重启以后同样不走它。
                distrusted.add(of);
                if (stored !== undefined) input.writeBack({...stored, dependencies: DISTRUSTED});
            }
            // 回写现在涉及的知识点与条目，连同按它们算的摘要：只换摘要的话，之后才进本章的知识点、条目上的改动就看不见了。
            if (valid && plan !== null && next !== null && next !== stored?.dependencies) input.writeBack({chapter, of, dependencies: next, points: [...plan.points], concerns: [...plan.concerns]});
            return valid;
        },
    };
}
