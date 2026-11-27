/**
 * 新建条目（docs/specs/canon/author-ui.md 输出 4）：对话框里填的东西变成一次改几处里的一项新建，发布一次写入。
 */

import type {EntryOp} from "@notnotype/nb-canon/schema";

/** 对话框里填的东西。 */
export interface NewEntryDraft {
    name: string;
    /** 种类（人物、地点这类词）；新写的也行。 */
    kind: string;
    /**
     * 选定了的种类（点了种类的按钮、种类的输入框失焦，`withKind`），去掉首尾空白；没选定过是空串。勾选列表的“适用于”与预设跟着它，
     * 打字时不跟。
     */
    kindChosen: string;
    /** 分组；作者没改过时跟着种类。 */
    folder: string;
    folderTouched: boolean;
    /** 上级条目；null 是没有上级（界面写“无”）。 */
    parent: string | null;
    /** 上级条目的名字：选择器与段头的摘要显示用；宿主预填上级时一并给。 */
    parentName: string;
    /** 设定组：登记的类型 id。作者没动过勾选时跟着种类换成它的默认（`withKind`）。 */
    types: string[];
    typesTouched: boolean;
    /** 是谁的马甲（本体）；没有为 null。选了以后上级跟着它。 */
    sameAs: string | null;
    sameAsName: string;
    /** 出场：null 是一开始就在，否则是那一章的开头。 */
    appears: string | null;
    /** 从“新建某某”（例如“新建人物”）打开时的种类：对话框标题写“新建某某”；从“新建条目”打开时是空串。 */
    startKind: string;
}

/** 预填的位置：上级（带名字）与分组。 */
export interface NewEntryPlace {
    readonly parent?: {readonly id: string; readonly name: string} | null;
    readonly folder?: string;
}

/** 空草稿；`place` 是预填的上级与分组（右键“在它下面新建”、在树里选中了一项时的“新建条目”）。 */
export function emptyDraft(place: NewEntryPlace = {}): NewEntryDraft {
    const folder = place.folder ?? "";
    return {name: "", kind: "", kindChosen: "", folder, folderTouched: folder !== "", parent: place.parent?.id ?? null, parentName: place.parent?.name ?? "", types: [], typesTouched: false, sameAs: null, sameAsName: "", appears: null, startKind: ""};
}

/** 按种类取一项：种类是作者写的任意一个词（可能正好是 `constructor` 这类），只认表里自己的键。 */
export function byKind<T>(record: Readonly<Record<string, T>>, kind: string): T | undefined {
    return Object.hasOwn(record, kind) ? record[kind] : undefined;
}

/**
 * 选定一个种类（点了种类的按钮、种类的输入框失焦，author-ui.md 输出 4）：作者没改过的分组跟着种类，没动过的勾选整组换成这个种类的
 * 默认设定组（`defaults` 按种类给，没登记的种类是空的）。只改这两项，所以在每敲一个字时不用它。选定的还是同一个种类（再点一次、
 * 输入框失焦）时原样返回：点过的预设不算动过勾选，不能被同一个种类的默认冲掉。
 */
export function withKind(draft: NewEntryDraft, kind: string, defaults: Readonly<Record<string, readonly string[]>>): NewEntryDraft {
    const chosen = kind.trim();
    if (chosen === draft.kindChosen) return draft;
    return {
        ...draft,
        kind,
        kindChosen: chosen,
        ...(draft.folderTouched ? {} : {folder: kind}),
        ...(draft.typesTouched ? {} : {types: [...(byKind(defaults, chosen) ?? [])]}),
    };
}

/** “恢复某某的默认”（输出 4）：勾选换回选定种类的默认，之后又跟着种类换。 */
export function restoreDefaults(draft: NewEntryDraft, defaults: Readonly<Record<string, readonly string[]>>): NewEntryDraft {
    return {...draft, types: [...(byKind(defaults, draft.kindChosen) ?? [])], typesTouched: false};
}

/**
 * 照对话框填的建条目的那一项操作（canon.revisions 输出 25 的 `create`）：顺序排在同层最后由内核算，启用的类型的字段先都是
 * “未知”。临时 id 每次新取。
 */
export function newEntryOp(draft: NewEntryDraft): Extract<EntryOp, {op: "create"}> {
    const kind = draft.kind.trim();
    return {
        op: "create",
        id: `tmp:new-${crypto.randomUUID()}`,
        entry: {
            name: draft.name.trim(),
            kind,
            folder: draft.folderTouched ? draft.folder.trim() : kind,
            parent: draft.parent,
            ...(draft.sameAs === null ? {} : {sameAs: draft.sameAs}),
            ...(draft.appears === null ? {} : {appears: {kind: "chapter", chapter: draft.appears, key: 0}}),
            components: draft.types.map((type) => ({type})),
        },
    };
}
