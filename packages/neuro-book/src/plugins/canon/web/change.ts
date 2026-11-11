/**
 * 变更详情（docs/specs/canon/author-ui.md 输出 21）：一条剧情变更折成页面上的几块：文字、安放、已写还是计划、生效状态（待定时
 * 写原因）、讲到它的原句（每句写出处）、涉及的条目、每一处改动（“星瑕的存款 −300”与依据）。名字经调用方给的查找取，这里都是
 * 纯函数。
 */

import type {Placement, StoryChange} from "@notnotype/nb-canon";

import type {CanonBoundText} from "./positions";
import {basisRow, patchLine} from "./rows";
import type {OriginRow} from "./rows";

export interface ChangeLookups {
    /** “星瑕的存款”这样的一句。 */
    address(at: {readonly entry: string; readonly path: string}): string;
    entryName(id: string): string | undefined;
    place(at: Placement): string;
}

export interface ChangeQuote {
    readonly key: string;
    readonly quote: string;
    /** 出处：“第 2 章正文”“细纲”……。 */
    readonly source: string;
    /** 出处是章节正文时那一章的 id：有“打开这一章”。 */
    readonly chapter: string | null;
}

export interface ChangePatch {
    readonly index: number;
    /** “星瑕的存款 −300”。 */
    readonly line: string;
    readonly basis?: OriginRow["basis"];
    /** 数的改动可以改（输出 21）。 */
    readonly editable: boolean;
    /** 确认条写在改哪个：“星瑕的存款”。 */
    readonly label: string;
}

export interface ChangeModel {
    readonly text: string;
    readonly place: string;
    readonly kind: string;
    readonly status: StoryChange["status"];
    readonly statusText: string;
    /** 待定的原因；不是待定时为空。 */
    readonly heldReason: string;
    readonly undoneReason: string;
    readonly quotes: readonly ChangeQuote[];
    readonly involved: readonly {readonly id: string; readonly name: string}[];
    readonly patches: readonly ChangePatch[];
}

/** 能在详情页里改的一处：加减或设成一个数。 */
export function editablePatch(patch: StoryChange["patches"][number] | undefined): boolean {
    return patch !== undefined && (patch.op === "add" || patch.op === "set") && typeof patch.value === "number";
}

function sourceText(telling: StoryChange["told"][number], lookups: ChangeLookups, text: CanonBoundText): string {
    switch (telling.source) {
        case "chapter": return telling.chapter === undefined ? text("change.sources.chapterUnknown") : text("change.sources.chapter", {place: lookups.place({kind: "chapter", chapter: telling.chapter, key: 0})});
        case "outline": return text("change.sources.outline");
        case "seed": return text("change.sources.seed");
        case "message": return text("change.sources.message");
        case "ui": return text("change.sources.ui");
        default: return text("change.sources.note");
    }
}

export function changeModel(change: StoryChange, lookups: ChangeLookups, text: CanonBoundText): ChangeModel {
    const statusText = text(change.status === "held" ? "plot.held" : change.status === "undone" ? "plot.undone" : "receipt.active");
    const heldReason = change.status === "held" && change.held !== undefined
        ? text(change.held.reason === "conflict" ? "change.heldConflict" : "change.heldUnsure", {note: change.held.note})
        : "";
    return {
        text: change.text,
        place: lookups.place(change.at),
        kind: text(change.kind === "plan" ? "plot.plan" : "receipt.written"),
        status: change.status,
        statusText,
        heldReason,
        undoneReason: change.status === "undone" ? change.undoneReason ?? "" : "",
        quotes: change.told.map((telling) => ({
            key: telling.id,
            quote: telling.quote ?? telling.anchor ?? "",
            source: sourceText(telling, lookups, text),
            chapter: telling.source === "chapter" && telling.chapter !== undefined ? telling.chapter : null,
        })),
        involved: change.involves.map((id) => ({id, name: lookups.entryName(id) ?? text("names.someEntry")})),
        patches: change.patches.map((patch, index) => {
            const label = lookups.address(patch.at);
            const basis = basisRow(patch.basis, text);
            return {index, line: patchLine(patch, label), ...(basis === undefined ? {} : {basis}), editable: editablePatch(patch), label};
        }),
    };
}
