/**
 * 决策的两种守卫（docs/specs/plot/decisions.md 输出 1 到 3）：地址守卫（某个地址在章的范围里不准取某些值）与读者守卫（某章之前读者
 * 对某个知识点不得到某个程度）。只对已定的决策查；挂在决策上的标注 `nbook.plot.guard.*`。
 */

import {canonicalJson} from "@notnotype/nb-canon/schema";
import type {CanonReadView, Decision, DiagnosticCompute, EventKey, Finding, Mark, Mode, StoryChange} from "@notnotype/nb-canon/schema";

import {DECISION_DIAGNOSTIC_IDS, MARK_IDS} from "../shared/declarations";
import {readerTellings} from "./knowledge";

/** 摘要端口：由宿主注入（核心不导入 Node 的 crypto）。 */
export type Digest = (text: string) => string;

const INITIAL_KEY: EventKey = {rank: [Number.NEGATIVE_INFINITY, 0, 0], tie: {version: -1, id: ""}};

interface AddressGuard {
    readonly at: {readonly entry: string; readonly path: string};
    readonly notIn: readonly unknown[];
    readonly from?: string;
    readonly to?: string;
    readonly lines?: readonly string[];
}

interface ReaderGuard {
    readonly point: string;
    readonly atMost: "unaware" | "suspects";
    readonly until: string;
}

const guardsOf = <T>(decision: Decision, kind: string): {readonly payload: T; readonly mark: Mark}[] =>
    (decision.marks ?? []).filter((mark) => mark.kind === kind && mark.version === 1).map((mark) => ({payload: mark as unknown as T, mark}));

/** 地址守卫的载荷（去掉 `kind`、`version`）的规范 JSON：稳定键的 `detail` 取它的摘要。 */
function payloadOf(mark: Mark): string {
    const {kind: _kind, version: _version, ...payload} = mark as Mark & Record<string, unknown>;
    return canonicalJson(payload);
}

export function guardDiagnostics(digest: Digest): Readonly<Record<string, DiagnosticCompute>> {
    return {
        [DECISION_DIAGNOSTIC_IDS.addressGuardViolated]: (view, at, mode) => addressGuards(view, mode, digest),
        [DECISION_DIAGNOSTIC_IDS.readerGuardViolated]: (view) => readerGuards(view, digest),
    };
}

/** 一个地址的当前值是否可信（不完整的值不判）：看读取位置上字段的 `incomplete`。 */
function incompleteAt(view: CanonReadView, entry: string, path: string, position: Parameters<CanonReadView["entry"]>[1], mode: Mode): boolean | null {
    const dot = path.indexOf(".");
    if (dot === -1) return null;
    const read = view.entry(entry, position, mode);
    if (read === null || read === "chapter-not-found") return null;
    const field = read.namespaces[path.slice(0, dot)]?.fields[path.slice(dot + 1)];
    return field === undefined ? null : field.incomplete !== undefined;
}

/**
 * 地址守卫（输出 2）：在这条线的视图里（守卫的 `lines` 没给是所有线），守卫的章范围里，从范围开头的值起、到范围里每一条套上的剧情变更
 * 之后，地址的值在 `notIn` 里就违反。范围开头就违反报一条（没有变更），之后只在值从“不违反”变成“违反”的那条变更处报（同一段
 * 违反里连着改成别的违反值不重复报）。起点或终点的值不完整时不判（`unchecked`，只在决策视图里体现，不进待处理）。
 * 实际模式与按计划模式各按自己的事件序算。
 */
function addressGuards(view: CanonReadView, mode: Mode, digest: Digest): Finding[] {
    const findings: Finding[] = [];
    for (const decision of view.decisions({status: "decided"})) {
        for (const {payload, mark} of guardsOf<AddressGuard>(decision, MARK_IDS.guardAddress)) {
            const result = checkAddressGuard(view, mode, payload);
            if (result === "unchecked") continue;
            const detail = digest(payloadOf(mark));
            for (const violation of result) {
                const objects = [{kind: "decision" as const, id: decision.id}, ...(violation === null ? [] : [{kind: "change" as const, id: violation}])];
                const stored = violation === null ? undefined : (view.object({kind: "change", id: violation}) as StoryChange | undefined);
                findings.push({key: {objects, line: view.line, detail}, objects: [...objects, {kind: "entry", id: payload.at.entry}], params: {path: payload.at.path}, ...(stored === undefined ? {} : {at: {kind: "placement" as const, placement: stored.at}})});
            }
        }
    }
    return findings;
}

/**
 * 一条地址守卫在这条线上的违反：`null` 是范围开头就违反，字符串是让它违反的那条变更；`"unchecked"` 是值不完整无法检查、或这条线不在
 * 守卫的 `lines` 里时返回空数组（不违反）。
 */
export function checkAddressGuard(view: CanonReadView, mode: Mode, guard: AddressGuard): (string | null)[] | "unchecked" {
    if (guard.lines !== undefined && !guard.lines.includes(view.line)) return [];
    const [low, high] = [guard.from === undefined ? 0 : view.chapters.indexOf(guard.from), guard.to === undefined ? view.chapters.length - 1 : view.chapters.indexOf(guard.to)];
    if (low === -1 || high === -1 || low > high || view.chapters.length === 0) return [];
    const start = guard.from === undefined ? ({kind: "initial"} as const) : ({kind: "chapter", chapter: guard.from, edge: "start"} as const);
    const endPosition = {kind: "chapter", chapter: view.chapters[high]!, edge: "end"} as const;
    const startKey = guard.from === undefined ? INITIAL_KEY : view.positionKey(start);
    const endKey = view.positionKey(endPosition);
    if (startKey === null || endKey === null) return [];
    const [startIncomplete, endIncomplete] = [incompleteAt(view, guard.at.entry, guard.at.path, start, mode), incompleteAt(view, guard.at.entry, guard.at.path, endPosition, mode)];
    if (startIncomplete === true || endIncomplete === true) return "unchecked";
    const steps = view.origins(guard.at, endPosition, mode);
    if (steps === "chapter-not-found") return [];
    const bad = (value: unknown) => guard.notIn.some((candidate) => canonicalJson(candidate) === canonicalJson(value));
    // 每一步之后的值（`check`、`reduce` 没有值）：初值、套上的补丁的结果、带过去的值。
    const states: {value: unknown; key: EventKey; change?: string}[] = [];
    for (const step of steps) {
        if (step.kind === "init") states.push({value: step.value, key: INITIAL_KEY});
        else if (step.kind === "patch") {
            const key = view.eventKey(step.change, mode);
            if (key !== null) states.push({value: step.result, key, change: step.change});
        } else if (step.kind === "carried" && step.key !== null) states.push({value: step.value, key: step.key});
    }
    // 范围开头的值：键不晚于范围开头的最后一步（从初值起时是初值本身）。
    const violations: (string | null)[] = [];
    const first = states.filter((state) => view.compareKeys(state.key, startKey) <= 0).at(-1);
    let wasBad = first !== undefined && bad(first.value);
    if (wasBad) violations.push(null);
    for (const state of states) {
        if (view.compareKeys(state.key, startKey) <= 0 || view.compareKeys(state.key, endKey) > 0) continue;
        const nowBad = bad(state.value);
        if (nowBad && !wasBad && state.change !== undefined) violations.push(state.change);
        wasBad = nowBad;
    }
    return violations;
}

/**
 * 读者守卫（输出 3）：`until` 之前（不含）的每个讲述位置上，读者对这个知识点的程度超过 `atMost` 就违反；第一处让它超过的讲述记在键里。
 * 读者读过的讲述按活页夹的分段取（不分线，结果与当前线无关）。
 */
function readerGuards(view: CanonReadView, digest: Digest): Finding[] {
    const findings: Finding[] = [];
    for (const decision of view.decisions({status: "decided"})) {
        for (const {payload, mark} of guardsOf<ReaderGuard>(decision, MARK_IDS.guardReader)) {
            const until = view.chapters.indexOf(payload.until);
            if (until === -1) continue;
            const limit = payload.atMost === "unaware" ? 0 : 1;
            for (const item of readerTellings(view, {effective: true, mark: MARK_IDS.reveal})) {
                if (item.located.kind !== "found" || view.chapters.indexOf(item.located.occurrence.chapter) >= until) continue;
                const exceeding = (item.telling.marks ?? []).some((candidate) => candidate.kind === MARK_IDS.reveal && candidate.version === 1 && candidate.point === payload.point && (candidate.mode === "explicit" ? 2 : 1) > limit);
                if (!exceeding) continue;
                // 前面的讲述没让它超过、这一处第一次超过：记键。
                const detail = digest(payloadOf(mark));
                findings.push({key: {objects: [{kind: "decision", id: decision.id}], telling: item.telling.id, detail}, at: {kind: "telling", telling: item.telling.id}, objects: [{kind: "decision", id: decision.id}, {kind: "entry", id: payload.point}], params: {atMost: payload.atMost}});
                break;
            }
        }
    }
    return findings;
}
