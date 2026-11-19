/**
 * 作者用的经历（docs/specs/plot/knowledge.md 输出 17）：同输出 8 的在场变更，从新到旧；每条带安放的章（前史为 null）、文字、同时在场的人、
 * 是不是“记得原线上的”。旧的 `experience`（正序、整条变更）给 Agent 用，口径不变。
 */

import type {CanonReadView, Mode, ReadPosition} from "@notnotype/nb-canon/schema";

import {experienceChanges} from "../knowledge";
import {bodyOf} from "./knowing";

export interface AuthorExperienceItem {
    readonly change: string;
    readonly chapter: string | null;
    readonly text: string;
    /** 同时在场的人：有条目的给 id（马甲照写），只有称呼的给 label；不含这个人自己。 */
    readonly cast: readonly ({readonly who: string} | {readonly label: string})[];
    readonly remembered: boolean;
}

export function authorExperience(view: CanonReadView, mode: Mode, position: ReadPosition, person: string): {readonly items: readonly AuthorExperienceItem[]; readonly uncast: number} {
    const body = bodyOf(view, person);
    const read = experienceChanges(view, mode, position, body);
    const items = read.changes.map((change): AuthorExperienceItem => ({
        change: change.id,
        chapter: change.at.kind === "chapter" ? change.at.chapter : null,
        text: change.text,
        cast: (change.cast ?? []).filter((member) => member.who === undefined || bodyOf(view, member.who) !== body).map((member) => (member.who !== undefined ? {who: member.who} : {label: member.label ?? ""})),
        remembered: read.remembered.has(change.id),
    }));
    return {items: items.reverse(), uncast: read.uncast};
}
