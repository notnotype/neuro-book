/**
 * 涉及条目的样子（docs/specs/plot/brief.md 输出 13）：本章计划涉及的条目按纯文字写给写手（写手不回写，带值写法的注记与条目 id
 * 对他没有用）。名字、简介、别名、正文的每一块与字段值都经关卡（`gate.ts`，输出 16）。
 *
 * 跳过：知识点、目标（保密以上的内容只在这一场的秘密里，目标在在场的人里）、伏笔（只在伏笔段写）、名字不能照写的条目（用马甲而
 * 身份是秘密的本体：马甲条目本来就在本章涉及的条目里，他这一场就是那个样子；已删除；之后才出场）。不写 `know`、`att` 两个命名
 * 空间：态度在在场的人一段按“两人都在本章”与“认不认得”给出，这里再列一遍会绕过那两条。
 */

import {ENTRY_TYPES} from "../../shared/declarations";
import * as fixed from "./fixed";
import type {Gate} from "./gate";
import type {BriefItem} from "./types";

const SKIPPED_TYPES: ReadonlySet<string> = new Set([ENTRY_TYPES.point, ENTRY_TYPES.goal, ENTRY_TYPES.foreshadow]);
const SKIPPED_NAMESPACES: ReadonlySet<string> = new Set(["know", "att"]);

export function appearanceItems(gate: Gate, chapter: string): BriefItem[] {
    const view = gate.frame.view;
    const items: BriefItem[] = [];
    for (const id of view.chapterEntries(chapter, "planned")) {
        const stored = view.object({kind: "entry", id}) as {type?: string; deleted?: boolean} | undefined;
        if (stored === undefined || stored.deleted === true || SKIPPED_TYPES.has(stored.type ?? "") || gate.kind(id) !== "plain") continue;
        // 本章才出场的条目照写：章首读时它算没出场，字段值仍读得到（到章末还没出场的由关卡挡在上面）。
        const read = view.entry(id, gate.frame.position, "planned");
        if (read === null || read === "chapter-not-found" || read.deleted) continue;
        const name = gate.name(id);
        const lines = [name];
        const summary = gate.summary(id);
        if (summary !== "") lines.push(summary);
        const aliases = gate.aliases(id);
        if (aliases.length > 0) lines.push(`别名：${aliases.join("、")}`);
        for (const block of gate.blocks(id)) lines.push(block.withheld === null ? block.text : fixed.WITHHELD_BLOCK);
        for (const [namespace, data] of Object.entries(read.namespaces)) {
            if (SKIPPED_NAMESPACES.has(namespace)) continue;
            for (const [field, value] of Object.entries(data.fields)) {
                if (value.value === null || value.value === undefined || (Array.isArray(value.value) && value.value.length === 0)) continue;
                lines.push(`${value.label ?? field}：${gate.value(value.value)}`);
            }
        }
        items.push({label: name, text: lines.join("\n")});
    }
    return items;
}
