/**
 * 目标的三项检查（docs/specs/plot/goals.md 输出 3、4）：前提变了（待处理）、停滞与缺一步（提示）。
 * 在读取位置上按读取的模式算、按这条线的视图算；只看这个位置上已出场、状态为进行或受挫的目标。
 */

import type {CanonReadView, DiagnosticCompute, EventKey, Finding, Mode, ReadPosition, StoryChange} from "@notnotype/nb-canon/schema";

import {GOAL_DIAGNOSTIC_IDS} from "../shared/declarations";
import {changeIndex} from "./change-index";
import {readGoal, type GoalRead} from "./goals";
import {perViewCache} from "./view-cache";
import {knowingIndex} from "./knowledge";

/** “停滞”：状态为进行的目标从最后一次被改到读取位置所在章超过这么多章（Spec：缺省值，用样本书量过以后再定）。 */
export const STALLED_AFTER_CHAPTERS = 30;

/** 比任何安放都早的键：初值。 */
const INITIAL_KEY: EventKey = {rank: [Number.NEGATIVE_INFINITY, 0, 0], tie: {version: -1, id: ""}};

export function goalDiagnostics(): Readonly<Record<string, DiagnosticCompute>> {
    return {
        [GOAL_DIAGNOSTIC_IDS.premiseChanged]: premiseChanged,
        [GOAL_DIAGNOSTIC_IDS.stalled]: stalled,
        [GOAL_DIAGNOSTIC_IDS.skippedStep]: skippedStep,
    };
}

const goalReads = perViewCache<GoalRead[]>();
/** 位置 P 上已出场的全部目标（三项检查共用，一次读待处理里只读一遍）。 */
function goalsAtPosition(view: CanonReadView, at: ReadPosition, mode: Mode): GoalRead[] {
    return goalReads(view, `${mode}|${JSON.stringify(at)}`, () => view.entries().flatMap((entry) => {
        if (entry.deleted === true || entry.type !== "目标") return [];
        const goal = readGoal(view, entry.id, at, mode);
        return goal === null ? [] : [goal];
    }));
}

/** 位置 P 上在的、状态为进行或受挫的目标。 */
function liveGoals(view: CanonReadView, at: ReadPosition, mode: Mode): GoalRead[] {
    return goalsAtPosition(view, at, mode).filter((goal) => goal.状态 === "active" || goal.状态 === "blocked");
}

/** 改过目标 `goal` 命名空间的、在这条线这个模式里生效、不晚于读取位置的剧情变更，按先后。 */
function touchesOf(view: CanonReadView, goal: string, mode: Mode, at: ReadPosition): {readonly change: StoryChange; readonly key: EventKey}[] {
    const touches: {change: StoryChange; key: EventKey}[] = [];
    // 只算读取位置为止的改动：读较早的位置时，之后才写的改动不能让该报的不报。
    const limit = view.positionKey(at);
    for (const change of changeIndex(view).goalTouches.get(goal) ?? []) {
        const key = view.eventKey(change.id, mode);
        if (key !== null && (limit === null || view.compareKeys(key, limit) <= 0)) touches.push({change, key});
    }
    return touches.sort((a, b) => view.compareKeys(a.key, b.key));
}

/**
 * 前提变了（输出 3）：目标 G 的持有者 H 对 G 的 `基于` 里某个知识点 K 的有效知情最后一次变化（程度或他以为的不同）所在的变更，
 * 之后没有任何变更改过 G 的 `goal` 命名空间（同一条变更也改了 G 算已跟着改）。隐秘目标推出的变化没有变更，不报；回溯带过去的变化
 * 取父线上的触发处进键。每对 (G, K) 只报最后一次变化（降噪；作者挂在旧键上的“有意为之”会在新变化出现后失效）。
 */
const premiseChanged: DiagnosticCompute = (view, at, mode) => {
    const findings: Finding[] = [];
    const index = knowingIndex(view, mode, at);
    for (const goal of liveGoals(view, at, mode)) {
        const touches = touchesOf(view, goal.id, mode, at);
        for (const point of new Set(goal.基于)) {
            const last = index.transitions(goal.holder, point).filter((transition) => transition.change !== undefined || transition.via !== undefined).at(-1);
            if (last === undefined) continue;
            if (touches.some((touch) => view.compareKeys(touch.key, last.key) >= 0)) continue;
            const change = (last.change ?? last.via)!;
            const stored = view.object({kind: "change", id: change}) as StoryChange | undefined;
            findings.push({
                key: {objects: [{kind: "entry", id: goal.id}, {kind: "entry", id: point}, {kind: "change", id: change}], line: view.line},
                objects: [{kind: "entry", id: goal.id}, {kind: "entry", id: point}, {kind: "change", id: change}, {kind: "entry", id: goal.holder}],
                params: {holder: goal.holder},
                ...(stored === undefined ? {} : {at: {kind: "placement" as const, placement: stored.at}}),
            });
        }
    }
    return findings;
};

/** 读取位置所在章在章序里的下标；初值是 0。 */
function chapterIndexOf(view: CanonReadView, position: ReadPosition): number {
    return position.kind === "chapter" ? Math.max(0, view.chapters.indexOf(position.chapter)) : 0;
}

/** 停滞（输出 4）：状态为进行的目标，最后一次被改（从没改过是出场）到读取位置所在章超过 `STALLED_AFTER_CHAPTERS` 章。 */
const stalled: DiagnosticCompute = (view, at, mode) => {
    const findings: Finding[] = [];
    const now = chapterIndexOf(view, at);
    for (const goal of liveGoals(view, at, mode)) {
        if (goal.状态 !== "active") continue;
        const last = touchesOf(view, goal.id, mode, at).at(-1)?.change.at ?? (view.object({kind: "entry", id: goal.id}) as {appears?: StoryChange["at"]} | undefined)?.appears;
        const since = last === undefined || last.kind !== "chapter" ? 0 : Math.max(0, view.chapters.indexOf(last.chapter));
        if (now - since > STALLED_AFTER_CHAPTERS) findings.push({key: {objects: [{kind: "entry", id: goal.id}], line: view.line}, objects: [{kind: "entry", id: goal.id}], params: {chapters: now - since}});
    }
    return findings;
};

/** 状态补丁的一步：状态值与让它成为这样的变更（初值没有）。 */
interface StateStep {
    readonly state: unknown;
    readonly key: EventKey;
    readonly change?: string;
}

/**
 * 缺一步（输出 4）：目标从进行直接变成达成，两步的排序键之间没有别的涉及它的剧情变更（`involves` 或补丁地址里有它）。
 * 同一条变更里先后改两次、初值直接是达成都不报。
 */
const skippedStep: DiagnosticCompute = (view, at, mode) => {
    const findings: Finding[] = [];
    for (const goal of liveGoals(view, at, mode).concat(achievedGoals(view, at, mode))) {
        const steps = view.origins({entry: goal.id, path: "goal.状态"}, at, mode);
        if (steps === "chapter-not-found") continue;
        const states: StateStep[] = [];
        for (const step of steps) {
            if (step.kind === "init") states.push({state: step.value, key: INITIAL_KEY});
            else if (step.kind === "patch") {
                const key = view.eventKey(step.change, mode);
                if (key !== null) states.push({state: step.result, key, change: step.change});
            } else if (step.kind === "carried" && step.key !== null) states.push({state: step.value, key: step.key});
        }
        const touches = changeIndex(view).involving.get(goal.id) ?? [];
        for (let i = 1; i < states.length; i += 1) {
            const [from, to] = [states[i - 1]!, states[i]!];
            if (from.state !== "active" || to.state !== "achieved" || (to.change !== undefined && to.change === from.change)) continue;
            // 同一条变更里先后改了几次状态（来历里每一步都是这条变更套完以后的值）：中间经过别的状态，不是直接。
            const stored = to.change === undefined ? undefined : (view.object({kind: "change", id: to.change}) as StoryChange | undefined);
            if (stored !== undefined && stored.patches.filter((patch) => patch.at.entry === goal.id && patch.at.path === "goal.状态").length > 1) continue;
            const between = touches.some((change) => {
                if (change.id === from.change || change.id === to.change) return false;
                const key = view.eventKey(change.id, mode);
                return key !== null && view.compareKeys(key, from.key) > 0 && view.compareKeys(key, to.key) < 0;
            });
            if (!between) findings.push({key: {objects: [{kind: "entry", id: goal.id}], line: view.line}, objects: [{kind: "entry", id: goal.id}], params: {}});
        }
    }
    return findings;
};

/** 位置 P 上状态为达成的目标（缺一步要看已经达成的）。 */
function achievedGoals(view: CanonReadView, at: ReadPosition, mode: Mode): GoalRead[] {
    return goalsAtPosition(view, at, mode).filter((goal) => goal.状态 === "achieved");
}
