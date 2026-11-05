/**
 * 插件诊断的一次计算结果怎样处理（docs/specs/canon/model.md 输出 34、35）：校验每条发现的稳定键，按返回的先后去重，
 * 截到 1000 条，再按作者挂在诊断上的已定决策分出已处理的。排序与内核自己的待处理、提示一起做（service.ts）。
 *
 * 这里只有纯函数：调用计算、计时、缓存与插件停用的判断在世界服务里。
 */

import {stableKeyProblem, type DiagnosticDeclaration} from "../components/diagnostics-registry";
import type {Decision, ObjectRef, Placement, ReadPosition} from "../core/schema";
import {canonicalJson} from "../core/stable-json";
import type {Mode} from "../engine/types";
import type {CanonReadView} from "./reads";

/** 插件登记的一个诊断的计算：同步，不调用模型，不写世界（model.md “诊断的计算”）。 */
export type DiagnosticCompute = (view: CanonReadView, at: ReadPosition, mode: Mode) => readonly Finding[];

/** 发现在哪：一个安放，或一处讲述（按讲述 id，发生点由内核按当前正文算）。 */
export type FindingAt = {readonly kind: "placement"; readonly placement: Placement} | {readonly kind: "telling"; readonly telling: string};

/** 诊断的一条发现（model.md “诊断的计算”）。 */
export interface Finding {
    readonly key: Readonly<Record<string, unknown>>;
    readonly at?: FindingAt;
    /** 给作者看的相关对象。 */
    readonly objects: readonly ObjectRef[];
    /** 说明的参数，键值都是文字或数。 */
    readonly params: Readonly<Record<string, string | number>>;
}

/** 一次计算之后要报的问题：计算没算出、发现的键不合形状、重复的键、截断。 */
export type DiagnosticNote =
    | {readonly code: "diagnostic-unavailable"; readonly diagnostic: string; readonly reason: string}
    | {readonly code: "diagnostic-duplicate-key"; readonly diagnostic: string; readonly key: string}
    | {readonly code: "diagnostic-truncated"; readonly diagnostic: string; readonly dropped: number};

export const FINDING_LIMIT = 1000;

export interface ProcessedFindings {
    readonly findings: readonly Finding[];
    /** 作者用一条已定决策处理了的（诊断 id、稳定键、版本都相同），连同那条决策。 */
    readonly handled: readonly {readonly finding: Finding; readonly decision: string}[];
    /** 版本不同的旧决策：发现照常报出，带上旧决策的 id，作者可以一键沿用（输出 35）。按稳定键的规范 JSON。 */
    readonly earlier: ReadonlyMap<string, string>;
    readonly notes: readonly DiagnosticNote[];
}

/**
 * 处理一个诊断这一次返回的发现。稳定键不合声明的，整次当作没算出（`diagnostic-unavailable`）：插件给的结果不可信时，
 * 不挑着报一部分。
 */
export function processFindings(declaration: DiagnosticDeclaration, returned: readonly Finding[], decisions: Iterable<Decision>): ProcessedFindings {
    for (const finding of returned) {
        const problem = stableKeyProblem(finding?.key, declaration.key);
        if (problem !== null) return {findings: [], handled: [], earlier: new Map(), notes: [{code: "diagnostic-unavailable", diagnostic: declaration.id, reason: `invalid finding key: ${problem}`}]};
    }
    const notes: DiagnosticNote[] = [];
    const seen = new Set<string>();
    const unique: {finding: Finding; key: string}[] = [];
    for (const finding of returned) {
        const key = canonicalJson(finding.key);
        if (seen.has(key)) {
            notes.push({code: "diagnostic-duplicate-key", diagnostic: declaration.id, key});
            continue;
        }
        seen.add(key);
        unique.push({finding, key});
    }
    const kept = unique.slice(0, FINDING_LIMIT);
    if (unique.length > FINDING_LIMIT) notes.push({code: "diagnostic-truncated", diagnostic: declaration.id, dropped: unique.length - FINDING_LIMIT});

    // 作者对这个诊断的处理：挂在 {kind: diagnostic, id, key, version} 上的已定决策。
    const current = new Map<string, string>();
    const older = new Map<string, string>();
    for (const decision of decisions) {
        if (decision.status !== "decided") continue;
        for (const about of decision.about) {
            if (about.kind !== "diagnostic" || about.id !== declaration.id) continue;
            const key = canonicalJson(about.key);
            if (about.version === declaration.version) current.set(key, decision.id);
            else older.set(key, decision.id);
        }
    }
    const findings: Finding[] = [];
    const handled: {finding: Finding; decision: string}[] = [];
    const earlier = new Map<string, string>();
    for (const {finding, key} of kept) {
        const decision = current.get(key);
        if (decision !== undefined) handled.push({finding, decision});
        else {
            findings.push(finding);
            const old = older.get(key);
            if (old !== undefined) earlier.set(key, old);
        }
    }
    return {findings, handled, earlier, notes};
}
