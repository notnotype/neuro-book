/**
 * 主文字里一个标签画成小块时显示什么（canon/author-ui.md 输出 10、48）：种类、文字、状态。富文本编辑器的小块与阅读视图的值共用
 * 这一份判断（`EntryValueChip` 的两种样子），值、未知、不完整、改过、读不到的写法只写一处。
 *
 * 值的来源有两个：世界服务按某一版整篇算的值表（对回到这个标签上的那一项，`entry-values.ts`），与本条目在这一页位置上已经读到的
 * 字段（作者刚插进来的取值不等请求就能显示）。两样都没有时，看值是不是正在算：正在算是“计算中”，整篇太长不算是“没有算”。
 */

import {lexTags} from "@notnotype/nb-canon/grammar";

import type {EntryTextValue} from "./components/text/entry-text";

export type ChipKind = "value" | "calc" | "if" | "ref" | "image" | "raw";
export type ChipState = "value" | "unknown" | "incomplete" | "pending" | "uncomputed" | "deleted" | "missing-field" | "no-branch";

/** 本条目的一个字段：地址、显示名、所在的设定组、这一页位置上的值（显示文字；未知为 null）。 */
export interface EntryField {
    readonly path: string;
    readonly label: string;
    readonly group: string;
    readonly display: string | null;
}

/** 小块显示的东西。 */
export interface ChipModel {
    readonly kind: ChipKind;
    /** 小块里的字。 */
    readonly text: string;
    readonly state: ChipState;
    /** 读屏与悬停用的名字：字段的显示名、式子原文、条目名。 */
    readonly label: string;
    /** 所选位置之前被改过时的说明（“第 3 章改过”，输出 10），只给本条目的字段。 */
    readonly changed?: string;
}

export interface ChipContext {
    /** 这个条目的 id：`V` 不写 `entry` 时指它自己。 */
    readonly self: string;
    /** 本条目的字段，按地址。 */
    readonly fields: ReadonlyMap<string, EntryField>;
    /** 本条目各字段的“改过”标记，按地址。 */
    readonly marks: Readonly<Record<string, string>>;
    /** 值正在算（整篇不太长、请求在途或马上要发）；为假时没有值的小块是“没有算”。 */
    readonly computing: boolean;
    /** 界面文字：未知、已删除的条目、需要插件。 */
    readonly words: {readonly unknown: string; readonly deletedRef: string; readonly needsPlugin: string};
}

const attribute = (tag: ReturnType<typeof lexTags>[number], name: string): string | undefined => tag.attributes.find((item) => item.name === name)?.value;

/** 一个标签原文（`<V of="panel.魔力" />` 这样）与对上它的值算出小块。条件（整段）的小块由条件的节点视图自己画，这里只给它的状态。 */
export function chipOf(source: string, value: EntryTextValue | undefined, context: ChipContext): ChipModel {
    const tag = lexTags(source)[0];
    if (tag === undefined) return {kind: "raw", text: source, state: "value", label: source};
    const waiting: ChipState = context.computing ? "pending" : "uncomputed";
    if (value !== undefined && "needsPlugin" in value) return {kind: "raw", text: context.words.needsPlugin, state: "value", label: source};
    switch (tag.name) {
        case "V": {
            const expr = attribute(tag, "expr");
            const of = attribute(tag, "of") ?? "";
            const entry = attribute(tag, "entry");
            const own = entry === undefined || entry === context.self;
            const field = own ? context.fields.get(of) : undefined;
            const label = expr ?? field?.label ?? of;
            const changed = own ? context.marks[of] : undefined;
            const withChanged = (model: Omit<ChipModel, "changed">): ChipModel => (changed === undefined ? model : {...model, changed});
            if (value !== undefined && value.tag === "V") {
                const kind: ChipKind = value.expr !== undefined ? "calc" : value.image !== undefined ? "image" : "value";
                if (value.unavailable !== undefined) return {kind, text: value.unavailable, state: "missing-field", label: value.label ?? label};
                if (value.image !== undefined) return {kind, text: value.image.caption, state: "value", label: value.label ?? label};
                if (value.unknown === true) return withChanged({kind, text: context.words.unknown, state: "unknown", label: value.label ?? label});
                return withChanged({kind, text: value.display, state: value.incomplete !== undefined ? "incomplete" : "value", label: value.label ?? label});
            }
            if (expr !== undefined) return {kind: "calc", text: expr, state: waiting, label};
            // 本条目的字段：这一页已经读到它的值，不等请求。
            if (own) {
                if (field === undefined) return {kind: "value", text: of, state: "missing-field", label};
                return withChanged(field.display === null ? {kind: "value", text: context.words.unknown, state: "unknown", label} : {kind: "value", text: field.display, state: "value", label});
            }
            return {kind: "value", text: label, state: waiting, label};
        }
        case "Ref": {
            const id = attribute(tag, "id") ?? "";
            if (value !== undefined && value.tag === "Ref") {
                if (value.deleted) return {kind: "ref", text: value.name !== "" ? value.name : context.words.deletedRef, state: "deleted", label: value.name};
                return {kind: "ref", text: value.name, state: "value", label: value.name};
            }
            return {kind: "ref", text: id, state: waiting, label: id};
        }
        case "Image": {
            const caption = value !== undefined && value.tag === "Image" ? value.caption : (attribute(tag, "alt") ?? "");
            return {kind: "image", text: caption, state: "value", label: caption};
        }
        default:
            // 没登记的标签、跨行条件的零件：原样显示原文。
            return {kind: "raw", text: source, state: "value", label: source};
    }
}
