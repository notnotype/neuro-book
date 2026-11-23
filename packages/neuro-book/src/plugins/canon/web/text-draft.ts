/**
 * 主文字的稿（docs/specs/canon/author-ui.md 输出 39、44 到 46）：作者按块编辑、还没提交的那部分改动，以及它与世界之间的三件事——
 * 哪一块能做什么（`allowed`）、世界变了以后把稿对到新读的块上（`rebase`）、编成一批写入操作（`compile`）。全是纯函数：不碰
 * 界面、存储与网络，登记（`text-drafts.ts`）与界面都建在它上面。
 *
 * 稿只记动过的块。没动过的旧块在 `order` 里只占一个 id，文字每次从世界读，所以别处改了作者没碰的块不需要“合并”：重读就是了。
 * 拆开是“原块改字、后面加一个新块”，并是“上一块改字、这一块删掉”，不另设操作。
 *
 * 判断全部依据内核的 `textBlocks`（`@notnotype/nb-canon` 的 `text-blocks.ts`）：被剧情碰过的块只能改字；改设定的新块只能挂在
 * 初值的块后面，所以插不到剧情加出来的块前面。这里不重新推断来历。
 */

import {EntryEditsSchema} from "@notnotype/nb-canon/schema";
import type {EntryOp, ReadPosition, TextBlockInfo} from "@notnotype/nb-canon/schema";

/** 一次读到的块：读取戳（`version` 加 `inputDigest`）、解析后的位置与各块。 */
export interface TextRead {
    readonly version: number;
    readonly inputDigest: string;
    readonly at: ReadPosition;
    readonly blocks: readonly TextBlockInfo[];
}

/** 提交发出以后、结果回来之前记下的那次请求：靠它在断线、刷新以后原样重发，不换请求再发（author-ui 输出 46）。 */
export interface PendingSubmit {
    readonly requestId: string;
    readonly stamp: {readonly version: number; readonly input: string};
}

/** 存下来的也是这个形状。`pending` 在的期间别的字段不能改：请求要能逐字重建。 */
export interface TextDraft {
    /** 开始编辑时内核解析后的位置（写明线）。 */
    readonly at: ReadPosition;
    /** 现在的块序：旧块是块 id，新块是本地键（`isNewKey`）。 */
    readonly order: readonly string[];
    /** 动过的旧块读到的原文（改了字或删了）；没动过的不在里面。 */
    readonly base: Readonly<Record<string, string>>;
    /** 动过的旧块与新块现在的文字。 */
    readonly texts: Readonly<Record<string, string>>;
    /** 删掉的旧块（并掉的也在这里）。 */
    readonly removed: readonly string[];
    /**
     * 拆过、或并进过别的块的旧块：它们改的字不只是改字，还和相邻的块换过文字。这样的块后来被剧情碰了（别处新记了变更）就不能
     * 照发：改的字会写进那条变更，换出去的那一半却在初值里，别的章读到的就错了。`rebase` 据此列成冲突。
     */
    readonly moved?: readonly string[];
    readonly pending?: PendingSubmit;
}

const NEW_PREFIX = "new:";

/** 一次提交最多几项（内核的上限，写在一次改几处的 schema 上）。 */
export const SUBMIT_OPS_MAX = (EntryEditsSchema.properties.ops as {readonly maxItems?: number}).maxItems ?? 50;

export const isNewKey = (key: string): boolean => key.startsWith(NEW_PREFIX);

const without = <T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> => {
    const {[key]: _dropped, ...rest} = record;
    return rest;
};

const blockOf = (read: TextRead, id: string): TextBlockInfo | undefined => read.blocks.find((block) => block.id === id);

/** `moved` 里只留还动着的旧块。 */
const withMoved = (draft: TextDraft, add: string | null = null): TextDraft => {
    const moved = [...new Set([...(draft.moved ?? []), ...(add === null || isNewKey(add) ? [] : [add])])].filter((id) => draft.base[id] !== undefined);
    const {moved: _previous, ...rest} = draft;
    return moved.length === 0 ? rest : {...rest, moved};
};

export function emptyDraft(read: TextRead): TextDraft {
    return {at: read.at, order: read.blocks.map((block) => block.id), base: {}, texts: {}, removed: []};
}

/** 有没有未提交的内容：有旧块动过，或有新块。改回原样的块不算（`setText` 会把它从 `base` 里拿掉）。 */
export function hasChanges(draft: TextDraft): boolean {
    return Object.keys(draft.base).length > 0 || draft.order.some(isNewKey);
}

/** 动过的块数（那一行的“未提交几块”）：改了字的、删掉的、新加的各算一块。 */
export function changedCount(draft: TextDraft): number {
    return Object.keys(draft.base).length + draft.order.filter(isNewKey).length;
}

export function isRemoved(draft: TextDraft, key: string): boolean {
    return draft.removed.includes(key);
}

/** 这一块现在的文字：稿里有就是稿里的，否则是读到的原文。 */
export function textOf(draft: TextDraft, read: TextRead, key: string): string {
    return draft.texts[key] ?? blockOf(read, key)?.source ?? "";
}

export function setText(draft: TextDraft, read: TextRead, key: string, text: string): TextDraft {
    if (isNewKey(key)) return {...draft, texts: {...draft.texts, [key]: text}};
    const source = draft.base[key] ?? blockOf(read, key)?.source;
    if (source === undefined) return draft;
    // 改回读到的原文、又没删它：这一块不算动过。
    if (text === source && !isRemoved(draft, key)) return withMoved({...draft, base: without(draft.base, key), texts: without(draft.texts, key)});
    return {...draft, base: {...draft.base, [key]: source}, texts: {...draft.texts, [key]: text}};
}

/** 在 `after` 后面（null 是最前）加一个空的新块。 */
export function addAfter(draft: TextDraft, after: string | null, text = ""): {readonly draft: TextDraft; readonly key: string} {
    const used = draft.order.filter(isNewKey).map((key) => Number(key.slice(NEW_PREFIX.length)));
    const key = `${NEW_PREFIX}${String(Math.max(0, ...used) + 1)}`;
    const at = after === null ? 0 : draft.order.indexOf(after) + 1;
    return {draft: {...draft, order: [...draft.order.slice(0, at), key, ...draft.order.slice(at)], texts: {...draft.texts, [key]: text}}, key};
}

export function removeBlock(draft: TextDraft, read: TextRead, key: string): TextDraft {
    if (isNewKey(key)) return {...draft, order: draft.order.filter((item) => item !== key), texts: without(draft.texts, key)};
    const source = draft.base[key] ?? blockOf(read, key)?.source;
    if (source === undefined || isRemoved(draft, key)) return draft;
    return {...draft, base: {...draft.base, [key]: source}, removed: [...draft.removed, key]};
}

/** 恢复一个删掉的旧块：删之前改过字的话，改的字还在。 */
export function restoreBlock(draft: TextDraft, key: string): TextDraft {
    if (!isRemoved(draft, key)) return draft;
    const removed = draft.removed.filter((item) => item !== key);
    const edited = draft.texts[key] !== undefined && draft.texts[key] !== draft.base[key];
    return edited ? {...draft, removed} : withMoved({...draft, removed, base: without(draft.base, key), texts: without(draft.texts, key)});
}

/** 这一块前面最近的、没删掉的块。 */
export function previousKey(draft: TextDraft, key: string): string | null {
    for (let index = draft.order.indexOf(key) - 1; index >= 0; index -= 1) {
        if (!isRemoved(draft, draft.order[index]!)) return draft.order[index]!;
    }
    return null;
}

/** 从 `offset` 处拆开：前半留在原块，后半成新的一块；切口两边的空行不留。 */
export function splitAt(draft: TextDraft, read: TextRead, key: string, offset: number): {readonly draft: TextDraft; readonly key: string} {
    const text = textOf(draft, read, key);
    const first = text.slice(0, offset).replace(/\s+$/u, "");
    const second = text.slice(offset).replace(/^\s+/u, "");
    return addAfter(withMoved(setText(draft, read, key, first), key), key, second);
}

/** 并到上一块：文字接在上一块后面、中间空一行，这一块删掉。没有上一块时原样返回。 */
export function mergeUp(draft: TextDraft, read: TextRead, key: string): {readonly draft: TextDraft; readonly into: string} | null {
    const into = previousKey(draft, key);
    if (into === null) return null;
    const [head, tail] = [textOf(draft, read, into), textOf(draft, read, key)];
    const joined = head.trim() === "" ? tail : tail.trim() === "" ? head : `${head.replace(/\s+$/u, "")}\n\n${tail.replace(/^\s+/u, "")}`;
    return {draft: removeBlock(withMoved(setText(draft, read, into, joined), into), read, key), into};
}

/** 一个动作做不了的原因。 */
export type Blocked =
    /** 剧情变更碰过这一块（改过、加出来、删过，或有剧情加出来的块挂在它后面）：只能改字。 */
    | {readonly kind: "story"; readonly changes: readonly string[]}
    /** 这一块是从别的世界线带过来的。 */
    | {readonly kind: "carried"}
    /** 这个位置后面紧挨着剧情加出来的块：改设定的新块放不进来。 */
    | {readonly kind: "before-story"}
    /** 两块在初值里不相邻（中间有这个位置上看不到的块）。 */
    | {readonly kind: "not-adjacent"}
    /** 前面没有块了。 */
    | {readonly kind: "first"}
    /** 这一块已经删掉了。 */
    | {readonly kind: "removed"}
    /** 这一块在世界里已经不在了（等作者在冲突里选）。 */
    | {readonly kind: "gone"};

export interface BlockAllowed {
    readonly edit: Blocked | null;
    readonly remove: Blocked | null;
    readonly split: Blocked | null;
    readonly mergeUp: Blocked | null;
    readonly addAfter: Blocked | null;
}

/** 旧块能不能从初值里拿掉（删、拆、并都要它）：值来自初值、没有变更碰过它。 */
function freeProblem(info: TextBlockInfo): Blocked | null {
    if (info.write === "none") return {kind: "carried"};
    if (info.write === "init" && info.fixed.length === 0 && info.init !== undefined) return null;
    return {kind: "story", changes: info.fixed.length > 0 ? info.fixed : info.change === undefined ? [] : [info.change]};
}

/**
 * 一个新块放在 `key` 后面（null 是最前）时 `addBlock` 该写的 `after`，或放不了的原因。改设定的块只能挂在初值的块后面，剧情加出
 * 来的块总紧跟自己的锚点：所以一处能放，当且仅当它后面紧挨着的旧块在初值里（或后面没有旧块了）；`after` 是它前面最近的旧块
 * 的锚点。
 */
function slotAfter(draft: TextDraft, read: TextRead, key: string | null): {readonly after: string | null} | Blocked {
    let before = -1;
    if (key !== null) {
        for (let index = draft.order.indexOf(key); index >= 0 && before < 0; index -= 1) before = read.blocks.findIndex((block) => block.id === draft.order[index]);
    }
    const next = read.blocks[before + 1];
    if (next !== undefined && next.init === undefined) return {kind: "before-story"};
    if (before < 0) return {after: null};
    const anchor = read.blocks[before]!.anchor;
    return anchor === undefined ? {kind: "carried"} : {after: anchor};
}

/** 每一块能做什么（null 是能做），与在最前加一块能不能做。 */
export function allowed(draft: TextDraft, read: TextRead): {readonly first: Blocked | null; readonly blocks: Readonly<Record<string, BlockAllowed>>} {
    const slot = (key: string | null): Blocked | null => {
        const found = slotAfter(draft, read, key);
        return "kind" in found ? found : null;
    };
    const free = (key: string): Blocked | null => {
        if (isNewKey(key)) return null;
        const info = blockOf(read, key);
        return info === undefined ? {kind: "gone"} : freeProblem(info);
    };
    const edit = (key: string): Blocked | null => {
        if (isNewKey(key)) return null;
        const info = blockOf(read, key);
        return info === undefined ? {kind: "gone"} : info.write === "none" ? {kind: "carried"} : null;
    };
    const blocks: Record<string, BlockAllowed> = {};
    for (const key of draft.order) {
        if (isRemoved(draft, key)) {
            const gone: Blocked = {kind: "removed"};
            blocks[key] = {edit: gone, remove: gone, split: gone, mergeUp: gone, addAfter: slot(key)};
            continue;
        }
        const into = previousKey(draft, key);
        let merge: Blocked | null = free(key);
        if (merge === null) {
            if (into === null) merge = {kind: "first"};
            else if (isNewKey(key) || isNewKey(into)) merge = edit(into);
            else {
                // 两块都是旧块：上一块也要能从初值的角度随便改，并且两块在初值里挨着，否则别的章读到的文字会变。
                const [above, below] = [blockOf(read, into), blockOf(read, key)];
                merge = free(into) ?? (above?.init !== undefined && below?.init === above.init + 1 ? null : {kind: "not-adjacent"});
            }
        }
        blocks[key] = {edit: edit(key), remove: free(key), split: free(key) ?? slot(key), mergeUp: merge, addAfter: slot(key)};
    }
    return {first: slot(null), blocks};
}

/** 重读以后要作者定的事。 */
export type Conflict =
    /** 作者动过的块别处也改了。`mine` 为 null 是作者要删它。 */
    | {readonly kind: "changed"; readonly key: string; readonly mine: string | null; readonly theirs: string}
    /** 作者改过的块被别处删了。 */
    | {readonly kind: "gone"; readonly key: string; readonly mine: string}
    /**
     * 作者要删的块现在删不了了，或改的字现在发不了了（它换成了带过来的值；或它拆过、并过，现在又被剧情碰了）。`remove` 为真
     * 是删。只能照现在的来。
     */
    | {readonly kind: "locked"; readonly key: string; readonly remove: boolean; readonly reason: Blocked};

/**
 * 把稿对到新读的块上（author-ui 输出 44）。没动过的块照新读的来；动过的块与新读的一致就留着，对不上的列成冲突、稿里原样
 * 留着等作者选（`resolve`）。两边改成一样的、两边都删了，当作已经一致，不问。
 */
export function rebase(draft: TextDraft, read: TextRead): {readonly draft: TextDraft; readonly conflicts: readonly Conflict[]} {
    let base: Record<string, string> = {...draft.base};
    let texts: Record<string, string> = {...draft.texts};
    let removed = [...draft.removed];
    const conflicts: Conflict[] = [];
    const settle = (id: string): void => {
        base = without(base, id);
        texts = without(texts, id);
        removed = removed.filter((item) => item !== id);
    };
    for (const id of Object.keys(draft.base)) {
        const info = blockOf(read, id);
        const removing = draft.removed.includes(id);
        const mine = draft.texts[id] ?? draft.base[id]!;
        const edited = mine !== draft.base[id];
        if (info === undefined) {
            if (removing || !edited) settle(id);
            else conflicts.push({kind: "gone", key: id, mine});
        } else if (info.source !== draft.base[id]) {
            if (removing) conflicts.push({kind: "changed", key: id, mine: null, theirs: info.source});
            else if (mine === info.source) settle(id);
            else conflicts.push({kind: "changed", key: id, mine, theirs: info.source});
        } else if (removing) {
            const reason = freeProblem(info);
            if (reason !== null) conflicts.push({kind: "locked", key: id, remove: true, reason});
        } else if (info.write === "none") {
            conflicts.push({kind: "locked", key: id, remove: false, reason: {kind: "carried"}});
        } else if (edited && draft.moved?.includes(id) === true) {
            const reason = freeProblem(info);
            if (reason !== null) conflicts.push({kind: "locked", key: id, remove: false, reason});
        }
    }
    // 块序：旧块照新读的顺序；新块（与等着选的、已经不在的块）跟着稿里它前面最近的那个还在的键。
    const kept = new Set(read.blocks.map((block) => block.id));
    const pendingGone = new Set(conflicts.filter((conflict) => conflict.kind === "gone").map((conflict) => conflict.key));
    const order = read.blocks.map((block) => block.id);
    let last: string | null = null;
    for (const key of draft.order) {
        if (kept.has(key)) {
            last = key;
            continue;
        }
        if (!isNewKey(key) && !pendingGone.has(key)) continue;
        order.splice(last === null ? 0 : order.indexOf(last) + 1, 0, key);
        last = key;
    }
    return {draft: withMoved({...draft, order, base, texts, removed}), conflicts};
}

/** 作者对一条冲突的选择：`mine` 以我的为准，`theirs` 照现在的；被删了的块另有 `keep`（当作新加的一块留着）与 `drop`。 */
export type Choice = "mine" | "theirs" | "keep" | "drop";

/** 照作者的选择改稿；选了以后再 `rebase` 这一条不再出现。给了这条冲突没有的选项时原样返回。 */
export function resolve(draft: TextDraft, read: TextRead, conflict: Conflict, choice: Choice): TextDraft {
    const key = conflict.key;
    const undo = (): TextDraft => withMoved({...draft, base: without(draft.base, key), texts: without(draft.texts, key), removed: draft.removed.filter((item) => item !== key)});
    if (conflict.kind === "changed") {
        // 以我的为准：把“读到的原文”换成现在的，我的文字（或删除）照留。
        if (choice === "mine") return {...draft, base: {...draft.base, [key]: conflict.theirs}};
        return choice === "theirs" ? undo() : draft;
    }
    if (conflict.kind === "gone") {
        if (choice === "drop" || choice === "theirs") return {...undo(), order: draft.order.filter((item) => item !== key)};
        if (choice !== "keep") return draft;
        const placed = addAfter(draft, key, conflict.mine);
        return withMoved({...placed.draft, order: placed.draft.order.filter((item) => item !== key), base: without(placed.draft.base, key), texts: without(placed.draft.texts, key)});
    }
    if (choice !== "theirs") return draft;
    // 现在做不了：撤掉删除（删之前改的字还在），或撤掉对它的改动。
    return conflict.remove ? restoreBlock(draft, key) : undo();
}

/** 编成的一批操作。 */
export interface Compiled {
    readonly ops: readonly EntryOp[];
    /** 与 `ops` 一一对应：这一项是稿里的哪个键（失败带序号时对回哪一块）。 */
    readonly keys: readonly string[];
    /** 编不进去的块与原因（新块所在的位置放不了、清空了一个不能删的块）；非空时不能提交。 */
    readonly problems: Readonly<Record<string, Blocked>>;
    readonly tooMany: boolean;
}

const blank = (text: string): boolean => text.trim() === "";

/**
 * 把稿编成一批写入操作（author-ui 输出 44）。稿要先 `rebase` 到这次读取上、冲突都选过。顺序是改字、加块、删块：加块要用的
 * 锚点可能正是这一批要删的块。清空的旧块按删掉算，空的新块不发。净变化是零时 `ops` 为空，调用方不发请求。
 */
export function compile(draft: TextDraft, read: TextRead, entry: string): Compiled {
    const sets: {op: EntryOp; key: string}[] = [];
    const adds: {op: EntryOp; key: string}[] = [];
    const removes: {op: EntryOp; key: string}[] = [];
    const problems: Record<string, Blocked> = {};
    const at = (id: string) => ({entry, path: `text[${id}]`});
    const remove = (id: string): void => {
        const info = blockOf(read, id);
        const reason: Blocked | null = info === undefined ? {kind: "gone"} : freeProblem(info);
        if (reason !== null) problems[id] = reason;
        else removes.push({op: {op: "removeBlock", at: at(id)}, key: id});
    };
    for (const key of draft.order) {
        if (isNewKey(key)) {
            const text = draft.texts[key] ?? "";
            if (blank(text)) continue;
            const slot = slotAfter(draft, read, key);
            if ("kind" in slot) problems[key] = slot;
            else adds.push({op: {op: "addBlock", entry, source: text, after: slot.after}, key});
            continue;
        }
        const source = draft.base[key];
        if (source === undefined) continue;
        const text = draft.texts[key] ?? source;
        if (isRemoved(draft, key) || blank(text)) remove(key);
        else if (text !== source) sets.push({op: {op: "set", at: at(key), value: text, read: source}, key});
    }
    const all = [...sets, ...adds, ...removes];
    return {ops: all.map((item) => item.op), keys: all.map((item) => item.key), problems, tooMany: all.length > SUBMIT_OPS_MAX};
}
