/**
 * 知情的两项诊断（docs/specs/plot/knowledge.md 输出 2、5，“输入与前置条件”的诊断表）：传话链断了、知情行不完整。
 * 都在读取位置上按读取的模式算，只查这个位置上的有效行（不查已经被覆盖的历史行）。剧情插件不拦写入，只报。
 */

import type {CanonReadView, DiagnosticCompute, Finding, Mode, ReadPosition, StoryChange} from "@notnotype/nb-canon/schema";

import {COMPONENT_IDS, DIAGNOSTIC_IDS, ENTRY_TYPES} from "../shared/declarations";
import {bodyOf, KnowingIndex} from "./knowledge";

/** 剧情插件登记给 canon 的知情诊断的计算，按诊断 id。 */
export function knowingDiagnostics(): Readonly<Record<string, DiagnosticCompute>> {
    return {[DIAGNOSTIC_IDS.relayBroken]: relayBroken, [DIAGNOSTIC_IDS.knowingIncomplete]: knowingIncomplete};
}

/**
 * 知情的诊断共用一份索引：同一次计算里几个诊断拿到的是同一份视图，按视图、模式与位置各建一次。不按读取输入的摘要跨视图
 * 缓存：摘要里只有世界的版本，不认是哪一份世界（同一进程里两份世界版本相同时会串用）。
 */
const indexes = new WeakMap<CanonReadView, Map<string, KnowingIndex>>();
export function knowingIndex(view: CanonReadView, mode: Mode, position: ReadPosition): KnowingIndex {
    const byView = indexes.get(view) ?? new Map<string, KnowingIndex>();
    indexes.set(view, byView);
    const key = `${mode}|${JSON.stringify(position)}`;
    const cached = byView.get(key);
    if (cached !== undefined) return cached;
    const index = new KnowingIndex(view, mode, position);
    byView.set(key, index);
    return index;
}

/** 有知情命名空间的人（人物与组织）。 */
function knowers(view: CanonReadView): string[] {
    return view.entries().filter((entry) => entry.deleted !== true && entry.init.data.know?.type === COMPONENT_IDS.knowing).map((entry) => entry.id);
}

function placementOf(view: CanonReadView, change: string | undefined): Finding["at"] | undefined {
    if (change === undefined) return undefined;
    const stored = view.object({kind: "change", id: change}) as StoryChange | undefined;
    return stored === undefined ? undefined : {kind: "placement", placement: stored.at};
}

/**
 * 传话链（输出 5）：一行有效知情的 `怎么知道` 是 `told`、`谁告诉的` 是 T 时，T 在这一行所在的变更之前，对同一个知识点要有
 * 知道、误信或怀疑；没有就报，说明 T 那时的程度。T 写成马甲的按本体算。同一条变更里先听到再转告的仍报（要拆成两条）。
 */
export const relayBroken: DiagnosticCompute = (view, at, mode) => {
    const index = knowingIndex(view, mode, at);
    const findings: Finding[] = [];
    for (const person of knowers(view)) {
        for (const row of index.all(person)) {
            if (row.source !== "explicit" || row.怎么知道 !== "told" || row.谁告诉的 === null || row.谁告诉的 === undefined) continue;
            const change = index.rowChange(person, row.point);
            if (change === undefined) continue;
            const teller = bodyOf(view, row.谁告诉的);
            const then = index.effective(teller, row.point, {before: change});
            if (then !== null && (then.程度 === "knows" || then.程度 === "misbelieves" || then.程度 === "suspects")) continue;
            const where = placementOf(view, change);
            findings.push({key: {objects: [{kind: "entry", id: person}, {kind: "entry", id: row.point}, {kind: "change", id: change}], line: view.line}, objects: [{kind: "entry", id: person}, {kind: "entry", id: teller}, {kind: "entry", id: row.point}, {kind: "change", id: change}], params: {teller, degree: then?.程度 ?? "none"}, ...(where === undefined ? {} : {at: where})});
        }
    }
    return findings;
};

/**
 * 知情行不完整（输出 2）：误信却没写“他以为的”、写了“谁告诉的”而“怎么知道”不是听说；以及知识点的 `揭穿` 指向的条目，
 * 它的 `sameAs` 不是这个知识点的主体（条目树里的父条目）。后一种没有“这个人”，稳定键的第一项用主体。
 */
export const knowingIncomplete: DiagnosticCompute = (view, at, mode) => {
    const index = knowingIndex(view, mode, at);
    const findings: Finding[] = [];
    for (const person of knowers(view)) {
        for (const row of index.all(person)) {
            if (row.source !== "explicit") continue;
            const misbelief = row.程度 === "misbelieves" && (row.他以为的 === null || row.他以为的 === undefined || row.他以为的 === "");
            const teller = row.谁告诉的 !== null && row.谁告诉的 !== undefined && row.怎么知道 !== "told";
            if (!misbelief && !teller) continue;
            const where = placementOf(view, row.change);
            findings.push({key: {objects: [{kind: "entry", id: person}, {kind: "entry", id: row.point}], line: view.line}, objects: [{kind: "entry", id: person}, {kind: "entry", id: row.point}], params: {reason: misbelief ? "misbelief-without-belief" : "teller-without-told"}, ...(where === undefined ? {} : {at: where})});
        }
    }
    for (const point of view.entries()) {
        if (point.deleted === true || point.type !== ENTRY_TYPES.point || point.parent === null) continue;
        const read = view.entry(point.id, at, mode);
        if (read === null || read === "chapter-not-found" || read.deleted) continue;
        const unmasks = (read.namespaces.point?.fields.揭穿?.value as {ref?: unknown} | null | undefined)?.ref;
        if (typeof unmasks !== "string") continue;
        const alias = view.object({kind: "entry", id: unmasks}) as {sameAs?: string} | undefined;
        if (alias?.sameAs === point.parent) continue;
        findings.push({key: {objects: [{kind: "entry", id: point.parent}, {kind: "entry", id: point.id}], line: view.line}, objects: [{kind: "entry", id: point.id}, {kind: "entry", id: unmasks}], params: {reason: "unmasks-not-an-alias-of-subject"}});
    }
    return findings;
};
