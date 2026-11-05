/** 涉及条目的样子（brief.md 输出 13）：本章计划涉及的条目按给 Agent 的带值写法渲染，去掉 `know` 命名空间，知识点与目标不在这里（保密以上的内容只在这一场的秘密里，目标在在场的人里）。 */

import {ENTRY_TYPES} from "../../shared/declarations";
import {nameOf, type Frame} from "./context";
import type {BriefItem} from "./types";

export function appearanceItems(frame: Frame, chapter: string): BriefItem[] {
    const view = frame.view;
    const items: BriefItem[] = [];
    for (const id of view.chapterEntries(chapter, "planned")) {
        const stored = view.object({kind: "entry", id}) as {type?: string; deleted?: boolean} | undefined;
        if (stored === undefined || stored.deleted === true || stored.type === ENTRY_TYPES.point || stored.type === ENTRY_TYPES.goal) continue;
        const read = view.entry(id, frame.position, "planned");
        if (read === null || read === "chapter-not-found" || read.deleted || !read.appeared) continue;
        const lines = [nameOf(frame, id)];
        if (read.summary !== "") lines.push(read.summary);
        const rendered = view.render(id, frame.position, "planned");
        if (rendered !== null && typeof rendered !== "string") for (const block of rendered.blocks) lines.push(block.text);
        for (const [namespace, data] of Object.entries(read.namespaces)) {
            if (namespace === "know") continue;
            for (const [field, value] of Object.entries(data.fields)) {
                if (value.value === null || value.value === undefined || (Array.isArray(value.value) && value.value.length === 0)) continue;
                lines.push(`${namespace}.${field}：${typeof value.value === "string" ? value.value : JSON.stringify(value.value)}`);
            }
        }
        items.push({label: nameOf(frame, id), text: lines.join("\n")});
    }
    return items;
}
