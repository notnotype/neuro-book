/**
 * 前史的先后（docs/specs/canon/time.md 输出 7、revisions.md 输出 18）：写入时没给 `order` 的前史变更，按它的时间范围的最早时间排进
 * 已有的前史。整份请求都套上以后在新数据上组一次网（安放不影响范围），逐条插入：
 * - 插在按 `order` 排的前史里、最后一件“有绝对的最早时间且不晚于它”的前史变更之后（最早时间相同的排在后面）；
 * - 比可比的前史变更都早，插在最早的那件可比的之前；
 * - 它自己没有绝对的最早时间，或已有前史里没有可比的，放在前史最后。
 * `order` 取相邻两处前史安放（变更、核对点与出场）的中数；中数不严格落在两者之间（浮点数用尽）时拒收，要写入者显式给 `order`。
 */

import type {Check, Entry} from "../core/schema";
import {buildNetwork, type TimeInput, type TimeSettings} from "./network";

interface Slot {
    readonly order: number;
    /** 前史变更的绝对最早时间；核对点、出场与没有可比时间的变更为 null。 */
    readonly earliest: number | null;
}

export function placePrehistory(input: TimeInput & {readonly checks: ReadonlyMap<string, Check>}, settings: TimeSettings, pending: readonly string[]): {readonly orders: ReadonlyMap<string, number>} | {readonly problem: {readonly change: string; readonly message: string}} {
    const {network} = buildNetwork(input, settings);
    const earliestOf = (id: string): number | null => {
        const range = network.range(id);
        return range.state === "ok" && range.anchored && Number.isFinite(range.lo) ? range.lo : null;
    };
    const waiting = new Set(pending);
    const slots: Slot[] = [];
    for (const change of input.changes.values()) if (change.at.kind === "prehistory" && !waiting.has(change.id)) slots.push({order: change.at.order, earliest: change.status === "active" ? earliestOf(change.id) : null});
    for (const check of input.checks.values()) if (check.place.kind === "prehistory") slots.push({order: check.place.order, earliest: null});
    for (const entry of input.entries.values() as Iterable<Entry>) if (entry.appears?.kind === "prehistory") slots.push({order: entry.appears.order, earliest: null});
    const orders = new Map<string, number>();
    for (const id of pending) {
        slots.sort((a, b) => a.order - b.order);
        const time = earliestOf(id);
        const comparable = slots.filter((slot) => slot.earliest !== null);
        let order: number;
        if (time === null || comparable.length === 0) order = slots.length === 0 ? 0 : slots.at(-1)!.order + 1;
        else {
            const notLater = comparable.filter((slot) => slot.earliest! <= time).at(-1);
            if (notLater !== undefined) {
                const next = slots.find((slot) => slot.order > notLater.order);
                order = next === undefined ? notLater.order + 1 : (notLater.order + next.order) / 2;
                if (next !== undefined && !(notLater.order < order && order < next.order)) return {problem: {change: id, message: "no room left between the neighbouring prehistory orders; give an explicit order"}};
            } else {
                const first = comparable[0]!;
                const previous = slots.filter((slot) => slot.order < first.order).at(-1);
                order = previous === undefined ? first.order - 1 : (previous.order + first.order) / 2;
                if (previous !== undefined && !(previous.order < order && order < first.order)) return {problem: {change: id, message: "no room left between the neighbouring prehistory orders; give an explicit order"}};
            }
        }
        orders.set(id, order);
        slots.push({order, earliest: time});
    }
    return {orders};
}
