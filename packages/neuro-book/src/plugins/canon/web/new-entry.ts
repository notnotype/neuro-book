/**
 * 新建条目（docs/specs/canon/author-ui.md 输出 4）：对话框里填的东西变成一次改几处里的一项新建，发布一次写入。
 */

import type {EntryOp} from "@notnotype/nb-canon/schema";

/** 对话框里填的东西。 */
export interface NewEntryDraft {
    name: string;
    /** 种类（人物、地点这类词）；新写的也行。 */
    kind: string;
    /** 分组；作者没改过时跟着种类。 */
    folder: string;
    folderTouched: boolean;
    /** 放在谁下面；null 是最上面一层。 */
    parent: string | null;
    /** 启用哪些数据：登记的类型 id。作者没动过勾选时跟着种类换成它的默认（`withKind`）。 */
    types: string[];
    typesTouched: boolean;
    /** 它是谁的另一个身份；没有为 null。 */
    sameAs: string | null;
    /** 从哪里出场：null 是一开始就在，否则是那一章的开头。 */
    appears: string | null;
}

export function emptyDraft(parent: string | null): NewEntryDraft {
    return {name: "", kind: "", folder: "", folderTouched: false, parent, types: [], typesTouched: false, sameAs: null, appears: null};
}

/**
 * 选定一个种类（点了种类的按钮、种类的输入框失焦，author-ui.md 输出 4）：作者没改过的分组跟着种类，没动过的勾选整组换成这个种类的
 * 默认设定组（`defaults` 按种类给，没登记的种类是空的）。只改这两项，所以在每敲一个字时不用它。
 */
export function withKind(draft: NewEntryDraft, kind: string, defaults: Readonly<Record<string, readonly string[]>>): NewEntryDraft {
    return {
        ...draft,
        kind,
        ...(draft.folderTouched ? {} : {folder: kind}),
        ...(draft.typesTouched ? {} : {types: [...(defaults[kind.trim()] ?? [])]}),
    };
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
