/**
 * 本章涉及的知识点，写完以后的集合（docs/specs/plot/knowledge.md 输出 10）：写之前的集合，加第 N 章已写变更引用到的、正文里出现了主体或
 * `揭穿` 马甲的名字与别名的；只取第 N 章章末已出场的。
 */

import type {CanonReadView, ReadPosition, StoryChange} from "@notnotype/nb-canon/schema";

import {ENTRY_TYPES} from "../../shared/declarations";
import {plansOf, pointsBeforeWriting, pointsReferencedBy} from "../brief/context";
import {perViewCache} from "../view-cache";
import {readAppeared, type CheckSegment} from "./segments";

const nameIndexes = perViewCache<ReadonlyMap<string, readonly string[]>>();
/** 每个条目用过的名字与别名（初值与补丁里写过的）：只是筛一遍，正文里都没有就不用读这个条目，读一个条目要几十微秒，每章要筛几百个。 */
function everyName(view: CanonReadView): ReadonlyMap<string, readonly string[]> {
    return nameIndexes(view, "", () => {
        const names = new Map<string, string[]>();
        const add = (entry: string, value: unknown) => {
            if (typeof value === "string" && value !== "") names.set(entry, [...(names.get(entry) ?? []), value]);
            else if (typeof value === "object" && value !== null) for (const item of Object.values(value)) add(entry, item);
        };
        for (const entry of view.entries()) {
            add(entry.id, entry.init.name);
            add(entry.id, entry.init.aliases);
        }
        for (const change of view.allChanges()) {
            for (const patch of change.patches) if (patch.at.path === "entry.name" || patch.at.path === "entry.aliases") add(patch.at.entry, patch.value);
        }
        return names;
    });
}

const maskingCache = perViewCache<ReadonlySet<string>>();
/** 可能写了 `揭穿` 的知识点（初值写了，或有补丁改过）。别的知识点不用读就知道没有。 */
function maskingPoints(view: CanonReadView): ReadonlySet<string> {
    return maskingCache(view, "", () => {
        const found = new Set<string>();
        for (const change of view.allChanges()) for (const patch of change.patches) if (patch.at.path === "point" || patch.at.path === "point.揭穿") found.add(patch.at.entry);
        for (const entry of view.entries()) if (entry.type === ENTRY_TYPES.point && (entry.init.data.point?.fields as {揭穿?: unknown} | undefined)?.揭穿 != null) found.add(entry.id);
        return found;
    });
}

export function pointsAfterWriting(segment: CheckSegment, chapter: string, written: readonly StoryChange[], text: string): string[] {
    const {frame, view} = segment;
    const end: ReadPosition = {kind: "chapter", chapter, edge: "end"};
    const points = new Set(pointsBeforeWriting(frame, chapter, plansOf(frame, chapter)));
    for (const change of written) for (const id of pointsReferencedBy(frame, change)) points.add(id);
    const names = everyName(view);
    const masking = maskingPoints(view);
    const memo = new Map<string, boolean>();
    /** 这个条目的名字或别名出现在正文里吗（按章末的名字）。先用用过的名字筛，都不在正文里就不读它。 */
    const named = (id: string): boolean => {
        const known = memo.get(id);
        if (known !== undefined) return known;
        let found = false;
        if ((names.get(id) ?? []).some((name) => text.includes(name))) {
            const read = readAppeared(view, id, end);
            found = read !== null && [read.name, ...read.aliases].some((name) => name !== "" && text.includes(name));
        }
        memo.set(id, found);
        return found;
    };
    for (const entry of view.entries()) {
        if (entry.deleted === true || entry.type !== ENTRY_TYPES.point || points.has(entry.id)) continue;
        if (entry.parent !== null && named(entry.parent)) {
            points.add(entry.id);
            continue;
        }
        if (!masking.has(entry.id)) continue;
        const read = readAppeared(view, entry.id, end);
        const mask = read === null ? undefined : (read.namespaces.point?.fields.揭穿?.value as {ref?: unknown} | null | undefined)?.ref;
        if (typeof mask === "string" && named(mask)) points.add(entry.id);
    }
    return [...points].filter((id) => {
        const stored = view.object({kind: "entry", id}) as {type?: string} | undefined;
        return stored?.type === ENTRY_TYPES.point && readAppeared(view, id, end) !== null;
    }).sort();
}
