/**
 * 新建条目（docs/specs/canon/author-ui.md 输出 4）：对话框里填的东西变成一个新条目，顺序排在同层最后，发布一次写入。
 */

import type {ComponentType, Entry, Placement} from "@notnotype/nb-canon";

import type {CanonClient} from "../shared/contracts";

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
    /** 启用哪些数据：登记的类型 id。 */
    types: string[];
    /** 它是谁的另一个身份；没有为 null。 */
    sameAs: string | null;
    /** 从哪里出场：null 是一开始就在，否则是那一章的开头。 */
    appears: string | null;
}

export function emptyDraft(parent: string | null): NewEntryDraft {
    return {name: "", kind: "", folder: "", folderTouched: false, parent, types: [], sameAs: null, appears: null};
}

/** 一层里最后一项的顺序：读完这一层，再读最后一项存下的条目。读不到时为 0。 */
async function lastOrder(call: CanonClient["call"], parent: string | null): Promise<number> {
    let cursor: string | undefined;
    let last: string | undefined;
    for (;;) {
        const page = await call("tree", {parent, limit: 500, ...(cursor === undefined ? {} : {cursor})});
        if (!page.ok) return 0;
        last = page.value.items.at(-1)?.id ?? last;
        cursor = page.value.cursor;
        if (cursor === undefined) break;
    }
    if (last === undefined) return 0;
    const stored = await call("object", {ref: {kind: "entry", id: last}});
    const order = stored.ok ? (stored.value.object as Entry | null)?.order : undefined;
    return typeof order === "number" ? order : 0;
}

/** 照对话框填的建条目；启用的类型的字段先都是“未知”。 */
export async function buildNewEntry(call: CanonClient["call"], draft: NewEntryDraft, types: readonly ComponentType[]): Promise<Entry> {
    const data: Entry["init"]["data"] = {};
    for (const id of draft.types) {
        const type = types.find((item) => item.id === id);
        if (type === undefined) continue;
        data[type.namespace] = {type: type.id, version: type.version, enabled: true, fields: Object.fromEntries(type.fields.map((field) => [field.id, null])), ...(type.instanceFields ? {declared: []} : {})};
    }
    const appears: Placement | undefined = draft.appears === null ? undefined : {kind: "chapter", chapter: draft.appears, key: 0};
    return {
        id: `tmp:new-${crypto.randomUUID()}`,
        type: draft.kind.trim(),
        parent: draft.parent,
        folder: draft.folderTouched ? draft.folder.trim() : draft.kind.trim(),
        order: (await lastOrder(call, draft.parent)) + 1,
        ...(draft.sameAs === null ? {} : {sameAs: draft.sameAs}),
        ...(appears === undefined ? {} : {appears}),
        init: {name: draft.name.trim(), aliases: [], summary: "", text: [], data},
    };
}
