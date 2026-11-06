/**
 * 本章涉及的知识点，写完以后的集合（docs/specs/plot/knowledge.md 输出 10）：写之前的集合，加第 N 章已写变更引用到的、正文里出现了主体或
 * `揭穿` 马甲的名字与别名的；只取第 N 章章末已出场的。
 */

import type {ReadPosition, StoryChange} from "@notnotype/nb-canon/schema";

import {ENTRY_TYPES} from "../../shared/declarations";
import {plansOf, pointsBeforeWriting, pointsReferencedBy} from "../brief/context";
import {readAppeared, type CheckSegment} from "./segments";

export function pointsAfterWriting(segment: CheckSegment, chapter: string, written: readonly StoryChange[], text: string): string[] {
    const {frame, view} = segment;
    const end: ReadPosition = {kind: "chapter", chapter, edge: "end"};
    const points = new Set(pointsBeforeWriting(frame, chapter, plansOf(frame, chapter)));
    for (const change of written) for (const id of pointsReferencedBy(frame, change)) points.add(id);
    const named = (id: string | null) => {
        if (id === null) return false;
        const read = readAppeared(view, id, end);
        return read !== null && [read.name, ...read.aliases].some((name) => name !== "" && text.includes(name));
    };
    for (const entry of view.entries()) {
        if (entry.deleted === true || entry.type !== ENTRY_TYPES.point || points.has(entry.id)) continue;
        const read = readAppeared(view, entry.id, end);
        if (read === null) continue;
        const mask = (read.namespaces.point?.fields.揭穿?.value as {ref?: unknown} | null | undefined)?.ref;
        if (named(entry.parent) || named(typeof mask === "string" ? mask : null)) points.add(entry.id);
    }
    return [...points].filter((id) => {
        const stored = view.object({kind: "entry", id}) as {type?: string} | undefined;
        return stored?.type === ENTRY_TYPES.point && readAppeared(view, id, end) !== null;
    }).sort();
}
