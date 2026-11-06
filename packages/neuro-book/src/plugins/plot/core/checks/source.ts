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
}

export interface FullCheckSource extends CheckSource {
    /** 这一章现在的依赖摘要；章不在章序里时为 null。`concerned` 是存下的（或这次计划算出的）本章涉及的知识点与条目。 */
    dependencies(view: CanonReadView, chapter: string, followUps: readonly string[], concerned: Concerned): string | null;
}

const NOTHING: Concerned = {points: [], concerns: []};

export function createCheckSource(input: SourceInput): FullCheckSource {
    const {instructions, selfReports, digest} = input;
    // 结论是“重拼的计划与这条记录比”的结果：记录没变（`of`）、这份计划读的东西没变（按它涉及的条目算的摘要），结论就没变。
    const verdicts = new Map<string, {readonly of: string; readonly concerned: Concerned; readonly dependencies: string | null; readonly valid: boolean}>();
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
            if (stored?.of === of) {
                const current = dependencies(view, chapter, followUps, stored);
                if (current === null) return false;
                if (current === stored.dependencies) return true;
            }
            const memo = verdicts.get(chapter);
            if (memo !== undefined && memo.of === of && memo.dependencies !== null && dependencies(view, chapter, followUps, memo.concerned) === memo.dependencies) return memo.valid;
            const instruction = instructions.get(chapter);
            const selfReport = selfReports.get(chapter);
            const {valid, plan} = validityOf({view, record, digest, ...(instruction === undefined ? {} : {instruction}), ...(selfReport === undefined ? {} : {selfReport})});
            const concerned = plan ?? NOTHING;
            const next = dependencies(view, chapter, followUps, concerned);
            verdicts.set(chapter, {of, concerned, dependencies: next, valid});
            // 回写现在涉及的知识点与条目，连同按它们算的摘要：只换摘要的话，之后才进本章的知识点、条目上的改动就看不见了。
            if (valid && plan !== null && next !== null) input.writeBack({chapter, of, dependencies: next, points: [...plan.points], concerns: [...plan.concerns]});
            return valid;
        },
    };
}
