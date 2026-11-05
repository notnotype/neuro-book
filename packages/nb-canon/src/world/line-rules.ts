/**
 * 写入时记录与世界线的规则（docs/specs/canon/worldlines.md 输出 1、3、4，失败表）：只查这次新写或改过的剧情变更与核对点。
 * 安放的线存不存在由引用的校验报（`ref-invalid` 的 `line-not-found`）；分叉自己的规则在 forks.ts。
 */

import {compareRanks, placementRank, type ChapterOrder} from "../core/position";
import type {Placement, StoryChange} from "../core/schema";
import type {WorldData} from "../engine/types";
import {compareOrder, lineOf, lineTable, MAIN_LINE} from "../lines/table";
import type {Problem} from "./world";

export function lineRuleProblems(data: WorldData, order: ChapterOrder, changed: {readonly changes: readonly string[]; readonly checks: readonly string[]}): Problem[] {
    const table = lineTable(data, order);
    const problems: Problem[] = [];
    const records: {kind: "change" | "check"; id: string; placement: Placement; change?: StoryChange}[] = [
        ...changed.changes.flatMap((id) => {
            const change = data.changes.get(id);
            return change === undefined ? [] : [{kind: "change" as const, id, placement: change.at, change}];
        }),
        ...changed.checks.flatMap((id) => {
            const check = data.checks.get(id);
            return check === undefined ? [] : [{kind: "check" as const, id, placement: check.place}];
        }),
    ];
    for (const record of records) {
        const ref = {kind: record.kind, id: record.id};
        const path = record.kind === "change" ? "at.line" : "place.line";
        const line = lineOf(record.placement);
        const entry = table.lines.get(line);
        const written = record.kind === "check" || (record.change!.kind === "written" && record.change!.status !== "undone");
        if (entry !== undefined) {
            // 计划线上只记计划（输出 1）。
            if (written && !entry.exists.actual && entry.exists.planned) problems.push({code: "line-planned", ref, path, message: `world line "${line}" exists only as a plan; record plans on it, or write the fork that fulfills it first`});
            // 子线自己的记录晚于切口，同一位置也不行（输出 3）。
            const rank = placementRank(order, record.placement);
            const cut = table.point(entry.fork.fork.cut);
            if (rank !== null && cut !== null && compareRanks(rank, cut.rank) <= 0) problems.push({code: "line-out-of-bounds", ref, path: record.kind === "change" ? "at" : "place", message: `a record on world line "${line}" must be placed after its cut ${entry.fork.fork.cut}`});
            // 结束的线：晚于结束点的新记录拒收（输出 3）。
            const {end, endAt} = entry.fork.fork;
            const self = table.point(record.id);
            const last = endAt === undefined ? null : table.point(endAt);
            if ((end === "return" || end === "stop") && last !== null && self !== null && record.id !== endAt && compareOrder(self, last) > 0) problems.push({code: "line-ended", ref, path: record.kind === "change" ? "at" : "place", message: `world line "${line}" ends at ${endAt ?? ""}`});
        }
        // 指向计划的连接：计划要在写入者所在线的视图里（输出 4，DS 9）。
        // 线不存在时已由引用的校验报过，这里不再查。
        if (record.change === undefined || (line !== MAIN_LINE && entry === undefined)) continue;
        for (const [index, link] of record.change.links.entries()) {
            const plan = link.plan;
            if (!data.changes.has(plan)) continue;
            if (!table.visible(line, plan)) problems.push({code: "plan-not-visible", ref, path: `links[${String(index)}].plan`, message: `plan ${plan} is not in the view of world line "${line}"`});
        }
    }
    return problems;
}
