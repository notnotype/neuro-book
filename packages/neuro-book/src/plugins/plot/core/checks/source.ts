/**
 * 诊断读检查记录的来源（`diagnostics.ts` 的 `CheckSource`）：先比依赖的摘要，相同就是有效；不同才重拼，结论放进内存；仍有效时把新摘要回写进记录（不算内容，不改
 * 数据版本），否则每次重启都要重拼。回写由调用方排队，这里在诊断的同步段里，不等。
 */

import type {CanonReadView} from "@notnotype/nb-canon/schema";

import type {CheckRecord, SelfReport} from "../../shared/checks";
import type {InstructionSnapshot} from "../../shared/instructions";
import type {Digest} from "../guards";
import {dependenciesOf} from "./dependencies";
import type {CheckSource} from "./diagnostics";
import {isValid} from "./validity";

export interface ChapterRead<T> {
    get(chapter: string): T | undefined;
    digestOf(chapter: string): string | undefined;
}

export interface SourceInput {
    readonly records: {all(): readonly CheckRecord[]};
    readonly instructions: ChapterRead<InstructionSnapshot>;
    readonly selfReports: ChapterRead<SelfReport>;
    readonly pluginVersion: string;
    readonly digest: Digest;
    readonly writeBack: (record: CheckRecord) => void;
}

export interface FullCheckSource extends CheckSource {
    /** 这一章现在的依赖摘要；章不在章序里时为 null。`concerned` 是记录里存的（或这次计划算出的）本章涉及的知识点与条目。 */
    dependencies(view: CanonReadView, chapter: string, followUps: readonly string[], concerned: {readonly points: readonly string[]; readonly concerns: readonly string[]}): string | null;
}

export function createCheckSource(input: SourceInput): FullCheckSource {
    const {instructions, selfReports, digest} = input;
    const verdicts = new Map<string, {readonly dependencies: string; readonly valid: boolean}>();
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
            const current = dependencies(view, record.chapter, record.followUps, record);
            if (current === null) return false;
            if (current === record.dependencies) return true;
            const memo = verdicts.get(record.chapter);
            if (memo?.dependencies === current) return memo.valid;
            const instruction = instructions.get(record.chapter);
            const selfReport = selfReports.get(record.chapter);
            const valid = isValid({view, record, digest, ...(instruction === undefined ? {} : {instruction}), ...(selfReport === undefined ? {} : {selfReport})});
            verdicts.set(record.chapter, {dependencies: current, valid});
            if (valid) input.writeBack({...record, dependencies: current});
            return valid;
        },
    };
}
