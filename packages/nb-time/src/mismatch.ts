/**
 * 安放与时间对不上（docs/specs/canon/time.md 输出 5）：每件“安放得比时间晚”的事 B 一项——在 B 之前安放、按时间一定比 B 晚的事 A，
 * 有一件就成立。两类判据：
 * (a) 范围：B 的最晚早于 A 的最早（同一个坐标系里比：有锚的事共用元年，没有锚的分量各自一个）；无穷的一端照常比。
 * (b) 说法直接给出的先后：一条约束 `to - from ≥ lo > 0` 且 `to` 是起点，说 `to` 那件事晚于 `from` 那件事的起点（`from` 是终点时
 *     终点不早于起点，照样成立）；安放却是 `to` 在前。
 * 按安放顺序扫一遍：前缀里最早时间的最大值给出代表 A，按最早时间排的树状数组数出这样的 A 有几件，O(N log N)。经过几条不严格的
 * 说法才推得出的先后不查（要逐对算最短路）。有打架的分量里的事不参与。
 */

import type {EventRange, NetworkConstraint, TimeNetwork} from "./network";

export interface PlacementMismatch {
    /** 安放得比时间晚的那件事（项的键）。 */
    readonly event: string;
    /** 代表性的 A：范围判据下最早时间最晚的那件；只有说法判据时是说法指的那件。 */
    readonly partner: string;
    /** 在 B 之前安放、按时间一定比 B 晚的事共几件。 */
    readonly count: number;
    readonly criterion: "range" | "statement";
}

/** 树状数组：按下标累计。 */
class Fenwick {
    readonly #tree: Int32Array;
    constructor(size: number) {
        this.#tree = new Int32Array(size + 1);
    }
    add(index: number): void {
        for (let i = index + 1; i < this.#tree.length; i += i & -i) this.#tree[i]! += 1;
    }
    /** 下标不大于 index 的累计。 */
    prefix(index: number): number {
        let sum = 0;
        for (let i = index + 1; i > 0; i -= i & -i) sum += this.#tree[i]!;
        return sum;
    }
}

/** `network.events` 是按安放排好的事件；`constraints` 是组好的约束（判据 b 用）。 */
export function placementMismatches(network: TimeNetwork, constraints: readonly NetworkConstraint[]): PlacementMismatch[] {
    const placement = new Map(network.events.map((id, index) => [id, index]));
    const ranges = new Map<string, Extract<EventRange, {state: "ok"}>>();
    for (const id of network.events) {
        const range = network.range(id);
        if (range.state === "ok") ranges.set(id, range);
    }
    const found = new Map<string, {partner: string; count: number; criterion: "range" | "statement"; partners: Set<string>}>();

    // (a) 每个坐标系各扫一遍。
    const systems = new Map<string, string[]>();
    for (const id of network.events) {
        const range = ranges.get(id);
        if (range === undefined) continue;
        const key = range.anchored ? "origin" : `component:${String(network.component(id))}`;
        systems.set(key, [...(systems.get(key) ?? []), id]);
    }
    for (const ids of systems.values()) {
        const earliest = [...new Set(ids.map((id) => ranges.get(id)!.lo))].sort((a, b) => a - b);
        const rank = new Map(earliest.map((value, index) => [value, index]));
        const tree = new Fenwick(earliest.length);
        let best: string | null = null;
        let seen = 0;
        for (const id of ids) {
            const range = ranges.get(id)!;
            if (best !== null && range.hi < ranges.get(best)!.lo) {
                // 之前安放的事里最早时间严格晚于 B 的最晚的件数：总数减去最早时间不晚于它的。
                const upTo = upperIndex(earliest, range.hi);
                found.set(id, {partner: best, count: seen - (upTo < 0 ? 0 : tree.prefix(upTo)), criterion: "range", partners: new Set()});
            }
            if (Number.isFinite(range.lo) && (best === null || range.lo > ranges.get(best)!.lo)) best = id;
            tree.add(rank.get(range.lo)!);
            seen += 1;
        }
    }

    // (b) 说法直接给出的先后。
    for (const constraint of constraints) {
        if (!(constraint.lo > 0) || constraint.from.kind !== "event" || constraint.to.kind !== "event" || constraint.to.edge !== "start") continue;
        const [earlierInTime, laterInTime] = [constraint.from.id, constraint.to.id];
        if (earlierInTime === laterInTime || !ranges.has(earlierInTime) || !ranges.has(laterInTime)) continue;
        // 时间上晚的那件安放在前：时间上早的那件（B）安放得太晚。
        if (placement.get(laterInTime)! > placement.get(earlierInTime)!) continue;
        const item = found.get(earlierInTime);
        if (item === undefined) found.set(earlierInTime, {partner: laterInTime, count: 1, criterion: "statement", partners: new Set([laterInTime])});
        else if (!item.partners.has(laterInTime) && !(ranges.get(laterInTime)!.lo > ranges.get(earlierInTime)!.hi)) {
            // 范围判据没数到的 A 另加一件。
            item.partners.add(laterInTime);
            item.count += 1;
        }
    }
    return network.events.flatMap((id) => {
        const item = found.get(id);
        return item === undefined ? [] : [{event: id, partner: item.partner, count: item.count, criterion: item.criterion}];
    });
}

/** 升序数组里最后一个不大于 value 的下标；没有时为 -1。 */
function upperIndex(sorted: readonly number[], value: number): number {
    let low = 0;
    let high = sorted.length - 1;
    let answer = -1;
    while (low <= high) {
        const middle = (low + high) >> 1;
        if (sorted[middle]! <= value) {
            answer = middle;
            low = middle + 1;
        } else high = middle - 1;
    }
    return answer;
}
