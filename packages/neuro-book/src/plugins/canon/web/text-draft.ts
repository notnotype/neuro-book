/**
 * 主文字的稿（docs/specs/canon/author-ui.md 输出 39、44 到 46）：作者按块编辑、还没提交的那部分改动，以及它与世界之间的三件事——
 * 哪一块能做什么（`allowed`）、世界变了以后把稿对到新读的块上（`rebase`）、编成一批写入操作（`compile`）。全是纯函数：不碰
 * 界面、存储与网络，登记（`text-drafts.ts`）与界面都建在它上面。
 *
 * 稿只记动过的块。没动过的旧块在 `order` 里只占一个 id，文字每次从世界读，所以别处改了作者没碰的块不需要“合并”：重读就是了。
 * 拆开是“原块改字、后面加一个新块”，并是“上一块改字、这一块删掉”，不另设操作；只另记两样，免得文字在不知情的时候换了地方：
 * 动过的旧块当时改字会写到哪（`routes`），与哪些旧块之间换过文字（`moved`、`merged`）。
 *
 * 判断全部依据内核的 `textBlocks`（`@notnotype/nb-canon` 的 `text-blocks.ts`）：被剧情碰过的块只能改字；改设定的新块只能挂在
 * 初值的块后面，所以插不到剧情加出来的块前面。这里不重新推断来历。
 *
 * 块 id 由内核定、可以是任何字符串（旧数据里有 `constructor` 这样的）：按 id 取字典里的值一律只认自有属性（`own`）。
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

/**
 * 提交发出以前记下的那次请求（author-ui 输出 46）：整份冻结，结局不明时只原样重发它，不从稿重编、不换请求 id。`keys` 与 `ops`
 * 一一对应，是各项在稿里的键（拒收带序号时对回哪一块）。
 */
export interface PendingSubmit {
    readonly requestId: string;
    readonly title: string;
    readonly stamp: {readonly version: number; readonly input: string};
    readonly ops: readonly EntryOp[];
    readonly keys: readonly string[];
}

/** 存下来的也是这个形状。`pending` 在的期间别的字段不改。 */
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
    /** 动过的旧块第一次动的时候，改它的字会写到哪：`init`，或给出它的那条变更的 id。重读发现换了地方要问作者。 */
    readonly routes?: Readonly<Record<string, string>>;
    /**
     * 与别的旧块换过文字的旧块（拆出去一半、或并进来一块）。它们改的字不只是改字：一旦写回的地方变了，或作者在冲突里撤掉其中
     * 一端，另一端照发就会多字、少字。
     */
    readonly moved?: readonly string[];
    /** 并掉的旧块并进了谁、并过去的是哪段文字：恢复它的时候把那段文字从对方拿回来。 */
    readonly merged?: Readonly<Record<string, {readonly into: string; readonly text: string}>>;
    readonly pending?: PendingSubmit;
}

const NEW_PREFIX = "new:";

/** 一次提交最多几项（内核的上限，写在一次改几处的 schema 上）。 */
export const SUBMIT_OPS_MAX = (EntryEditsSchema.properties.ops as {readonly maxItems?: number}).maxItems ?? 50;

export const isNewKey = (key: string): boolean => key.startsWith(NEW_PREFIX);

/** 字典里这个键自己的值；继承来的（`constructor`、`toString`）不算。 */
export const own = <T>(record: Readonly<Record<string, T>> | undefined, key: string): T | undefined => (record !== undefined && Object.hasOwn(record, key) ? record[key] : undefined);

const without = <T>(record: Readonly<Record<string, T>> | undefined, key: string): Record<string, T> => {
    const {[key]: _dropped, ...rest} = record ?? {};
    return rest;
};

const blockOf = (read: TextRead, id: string): TextBlockInfo | undefined => read.blocks.find((block) => block.id === id);

/** 改这一块的字写到哪：`init`、变更的 id，或 `none`。 */
const routeOf = (info: TextBlockInfo): string => (info.write === "change" ? info.change ?? "none" : info.write);

const blank = (text: string): boolean => text.trim() === "";

/** 去掉空的可选字段，免得“动过又改回去”的稿与没动过的稿不相等。 */
function tidy(draft: TextDraft): TextDraft {
    const {routes, moved, merged, ...rest} = draft;
    const touched = (id: string): boolean => own(draft.base, id) !== undefined;
    const keptRoutes = Object.fromEntries(Object.entries(routes ?? {}).filter(([id]) => touched(id)));
    const keptMoved = (moved ?? []).filter(touched);
    const keptMerged = Object.fromEntries(Object.entries(merged ?? {}).filter(([id]) => draft.removed.includes(id)));
    return {
        ...rest,
        ...(Object.keys(keptRoutes).length === 0 ? {} : {routes: keptRoutes}),
        ...(keptMoved.length === 0 ? {} : {moved: keptMoved}),
        ...(Object.keys(keptMerged).length === 0 ? {} : {merged: keptMerged}),
    };
}

/** 第一次动一个旧块：记下读到的原文与当时写回的地方。读不到这一块时为 null。 */
function touch(draft: TextDraft, read: TextRead, id: string): TextDraft | null {
    if (own(draft.base, id) !== undefined) return draft;
    const info = blockOf(read, id);
    if (info === undefined) return null;
    return {...draft, base: {...draft.base, [id]: info.source}, routes: {...draft.routes, [id]: routeOf(info)}};
}

/** 这一块不再算动过。 */
function untouch(draft: TextDraft, id: string): TextDraft {
    return tidy({...draft, base: without(draft.base, id), texts: without(draft.texts, id), removed: draft.removed.filter((item) => item !== id)});
}

export function emptyDraft(read: TextRead): TextDraft {
    return {at: read.at, order: read.blocks.map((block) => block.id), base: {}, texts: {}, removed: []};
}

/** 写了字的新块（空的新块不会发出去，也不算改动：没有主文字的条目进编辑时就先放着一个）。 */
const written = (draft: TextDraft): string[] => draft.order.filter((key) => isNewKey(key) && !blank(own(draft.texts, key) ?? ""));

/** 有没有未提交的内容：有旧块动过，或有写了字的新块。改回原样的块不算（`setText` 会把它从 `base` 里拿掉）。 */
export function hasChanges(draft: TextDraft): boolean {
    return Object.keys(draft.base).length > 0 || written(draft).length > 0;
}

/** 动过的块数（那一行的“未提交几块”）：改了字的、删掉的、新加而写了字的各算一块。 */
export function changedCount(draft: TextDraft): number {
    return Object.keys(draft.base).length + written(draft).length;
}

export function isRemoved(draft: TextDraft, key: string): boolean {
    return draft.removed.includes(key);
}

/** 这一块现在的文字：稿里有就是稿里的，否则是读到的原文。 */
export function textOf(draft: TextDraft, read: TextRead, key: string): string {
    return own(draft.texts, key) ?? blockOf(read, key)?.source ?? "";
}

export function setText(draft: TextDraft, read: TextRead, key: string, text: string): TextDraft {
    if (isNewKey(key)) return {...draft, texts: {...draft.texts, [key]: text}};
    const touched = touch(draft, read, key);
    if (touched === null) return draft;
    // 改回读到的原文、又没删它：这一块不算动过。
    if (text === own(touched.base, key) && !isRemoved(touched, key)) return untouch(touched, key);
    return {...touched, texts: {...touched.texts, [key]: text}};
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
    if (isRemoved(draft, key)) return draft;
    const touched = touch(draft, read, key);
    return touched === null ? draft : {...touched, removed: [...touched.removed, key]};
}

/**
 * 恢复一个删掉的旧块：删之前改过字的话，改的字还在。它是并掉的（`mergeUp`）而对方的文字还以并过去的那一段结尾时，把那一段
 * 从对方拿回来，不让同一段字留在两块里；对方之后又改过、对不上了就不动它。
 */
export function restoreBlock(draft: TextDraft, read: TextRead, key: string): TextDraft {
    if (!isRemoved(draft, key)) return draft;
    let next: TextDraft = {...draft, removed: draft.removed.filter((item) => item !== key)};
    const from = own(draft.merged, key);
    if (from !== undefined && next.order.includes(from.into)) {
        const joined = textOf(next, read, from.into);
        const tail = from.text.replace(/^\s+/u, "");
        if (joined === tail) next = setText(next, read, from.into, "");
        else if (joined.endsWith(`\n\n${tail}`)) next = setText(next, read, from.into, joined.slice(0, -`\n\n${tail}`.length));
    }
    const text = own(next.texts, key);
    return text !== undefined && text !== own(next.base, key) ? tidy(next) : untouch(next, key);
}

/** 这一块前面最近的、没删掉的块。 */
export function previousKey(draft: TextDraft, key: string): string | null {
    for (let index = draft.order.indexOf(key) - 1; index >= 0; index -= 1) {
        if (!isRemoved(draft, draft.order[index]!)) return draft.order[index]!;
    }
    return null;
}

const markMoved = (draft: TextDraft, id: string): TextDraft => (own(draft.base, id) === undefined ? draft : {...draft, moved: [...new Set([...(draft.moved ?? []), id])]});

/** 从 `offset` 处拆开：前半留在原块，后半成新的一块；切口两边的空行不留。 */
export function splitAt(draft: TextDraft, read: TextRead, key: string, offset: number): {readonly draft: TextDraft; readonly key: string} {
    const text = textOf(draft, read, key);
    const first = text.slice(0, offset).replace(/\s+$/u, "");
    const second = text.slice(offset).replace(/^\s+/u, "");
    const edited = setText(draft, read, key, first);
    // 旧块拆出去的后半进了初值里的新块：这一块之后写回的地方变了的话，前后两半就不在一处了。
    return addAfter(isNewKey(key) ? edited : markMoved(edited, key), key, second);
}

/** 并到上一块：文字接在上一块后面、中间空一行，这一块删掉。没有上一块时原样返回。 */
export function mergeUp(draft: TextDraft, read: TextRead, key: string): {readonly draft: TextDraft; readonly into: string} | null {
    const into = previousKey(draft, key);
    if (into === null) return null;
    const [head, tail] = [textOf(draft, read, into), textOf(draft, read, key)];
    const joined = blank(head) ? tail : blank(tail) ? head : `${head.replace(/\s+$/u, "")}\n\n${tail.replace(/^\s+/u, "")}`;
    let next = setText(draft, read, into, joined);
    // 新块并进旧块只是给旧块加字（新块还没有发布过，谈不上换地方）；两块都是旧块才算换过文字。
    if (!isNewKey(key) && !isNewKey(into)) next = markMoved(next, into);
    next = removeBlock(next, read, key);
    if (!isNewKey(key) && isRemoved(next, key)) next = {...next, merged: {...next.merged, [key]: {into, text: tail}}};
    return {draft: next, into};
}

/** 一个动作做不了的原因。 */
export type Blocked =
    /** 剧情变更碰过这一块（改过、加出来、删过，或有剧情加出来的块挂在它后面）：只能改字。 */
    | {readonly kind: "story"; readonly changes: readonly string[]}
    /** 这一块不能这样改（内核给的 `write` 是 `none`）。 */
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
export function allowed(draft: TextDraft, read: TextRead): {readonly first: Blocked | null; readonly blocks: ReadonlyMap<string, BlockAllowed>} {
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
    const blocks = new Map<string, BlockAllowed>();
    for (const key of draft.order) {
        if (isRemoved(draft, key)) {
            const gone: Blocked = {kind: "removed"};
            blocks.set(key, {edit: gone, remove: gone, split: gone, mergeUp: gone, addAfter: slot(key)});
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
        blocks.set(key, {edit: edit(key), remove: free(key), split: free(key) ?? slot(key), mergeUp: merge, addAfter: slot(key)});
    }
    return {first: slot(null), blocks};
}

/** 重读以后要作者定的事。`structural` 为真是这一块与别的块换过文字（拆过、并过）：选完以后要作者再看一眼，不自动提交。 */
export type Conflict =
    /** 作者动过的块别处也改了。`mine` 为 null 是作者要删它。 */
    | {readonly kind: "changed"; readonly key: string; readonly mine: string | null; readonly theirs: string; readonly structural?: true}
    /** 作者改过的块被别处删了。 */
    | {readonly kind: "gone"; readonly key: string; readonly mine: string; readonly structural?: true}
    /** 作者要删的块现在删不了了（别处的剧情碰了它），或改的字现在发不了了（`remove` 为假）。只能照现在的来。 */
    | {readonly kind: "locked"; readonly key: string; readonly remove: boolean; readonly reason: Blocked; readonly structural?: true}
    /**
     * 作者改了字的块，改字写回的地方换了（原来写进初值，现在这个位置上的值是一条剧情变更给的，或反过来）。`manual` 为真是这一块
     * 还与别的块换过文字：照发会让两半落在两处，没有能自动做的选择，要作者回去整理。
     */
    | {readonly kind: "rerouted"; readonly key: string; readonly mine: string; readonly theirs: string; readonly manual: boolean; readonly structural?: true};

/**
 * 把稿对到新读的块上（author-ui 输出 44）。没动过的块照新读的来；动过的块与新读的一致就留着，对不上的列成冲突、稿里原样
 * 留着等作者选（`resolve`）。两边改成一样的、两边都删了，当作已经一致，不问。别处在同一处加了剧情块时，我的新块排到它们后面
 * （内核里改设定的块就排在那里）。
 */
export function rebase(draft: TextDraft, read: TextRead): {readonly draft: TextDraft; readonly conflicts: readonly Conflict[]} {
    let next = draft;
    const conflicts: Conflict[] = [];
    for (const id of Object.keys(draft.base)) {
        const info = blockOf(read, id);
        const removing = draft.removed.includes(id);
        const base = own(draft.base, id)!;
        const mine = own(draft.texts, id) ?? base;
        const edited = mine !== base;
        const structural = draft.moved?.includes(id) === true || own(draft.merged, id) !== undefined ? {structural: true as const} : {};
        const recorded = own(draft.routes, id);
        if (info === undefined) {
            if (removing || !edited) next = untouch(next, id);
            else conflicts.push({kind: "gone", key: id, mine, ...structural});
        } else if (removing) {
            const reason = freeProblem(info);
            if (info.source !== base) conflicts.push({kind: "changed", key: id, mine: null, theirs: info.source, ...structural});
            else if (reason !== null) conflicts.push({kind: "locked", key: id, remove: true, reason, ...structural});
        } else if (recorded !== undefined && recorded !== routeOf(info)) {
            // 写回的地方换了：先问这个，原文变没变都一样要作者看。
            if (info.write === "none") conflicts.push({kind: "locked", key: id, remove: false, reason: {kind: "carried"}, ...structural});
            else conflicts.push({kind: "rerouted", key: id, mine, theirs: info.source, manual: draft.moved?.includes(id) === true, ...structural});
        } else if (info.source !== base) {
            if (mine === info.source) next = untouch(next, id);
            else conflicts.push({kind: "changed", key: id, mine, theirs: info.source, ...structural});
        }
    }
    // 块序：旧块照新读的顺序；新块（与等着选的、已经不在的块）跟着稿里它前面最近的那个还在的键，并越过紧跟其后的剧情加出来的块。
    const kept = new Set(read.blocks.map((block) => block.id));
    const storyAdded = new Set(read.blocks.filter((block) => block.init === undefined).map((block) => block.id));
    const pendingGone = new Set(conflicts.filter((conflict) => conflict.kind === "gone").map((conflict) => conflict.key));
    const order = read.blocks.map((block) => block.id);
    let last: string | null = null;
    for (const key of draft.order) {
        if (kept.has(key)) {
            last = key;
            continue;
        }
        if (!isNewKey(key) && !pendingGone.has(key)) continue;
        let at = last === null ? 0 : order.indexOf(last) + 1;
        // 稿里它前面是旧块（或它在最前）：别处挂在同一处的剧情块排在它前面。前面是我自己的新块时已经越过了。
        if (last === null || kept.has(last)) while (at < order.length && storyAdded.has(order[at]!)) at += 1;
        order.splice(at, 0, key);
        last = key;
    }
    return {draft: tidy({...next, order}), conflicts};
}

/** 作者对一条冲突的选择：`mine` 以我的为准，`theirs` 照现在的；被删了的块另有 `keep`（当作新加的一块留着）与 `drop`。 */
export type Choice = "mine" | "theirs" | "keep" | "drop";

/** 照作者的选择改稿；选了以后再 `rebase` 这一条不再出现。给了这条冲突没有的选项、或它要作者手工整理时原样返回。 */
export function resolve(draft: TextDraft, read: TextRead, conflict: Conflict, choice: Choice): TextDraft {
    const key = conflict.key;
    const info = blockOf(read, key);
    if (conflict.kind === "changed") {
        // 以我的为准：把“读到的原文”换成现在的，我的文字（或删除）照留。
        if (choice === "mine") return {...draft, base: {...draft.base, [key]: conflict.theirs}};
        return choice === "theirs" ? untouch(draft, key) : draft;
    }
    if (conflict.kind === "gone") {
        if (choice === "drop" || choice === "theirs") return {...untouch(draft, key), order: draft.order.filter((item) => item !== key)};
        if (choice !== "keep") return draft;
        const placed = addAfter(draft, key, conflict.mine);
        return {...untouch(placed.draft, key), order: placed.draft.order.filter((item) => item !== key)};
    }
    if (conflict.kind === "rerouted") {
        if (conflict.manual || info === undefined) return draft;
        // 以我的为准：认下现在写回的地方（与现在的原文）。
        if (choice === "mine") return {...draft, base: {...draft.base, [key]: conflict.theirs}, routes: {...draft.routes, [key]: routeOf(info)}};
        return choice === "theirs" ? untouch(draft, key) : draft;
    }
    if (choice !== "theirs") return draft;
    // 现在做不了：撤掉删除（删之前改的字还在），或撤掉对它的改动。
    return conflict.remove ? restoreBlock(draft, read, key) : untouch(draft, key);
}

/** 编成的一批操作。 */
export interface Compiled {
    readonly ops: readonly EntryOp[];
    /** 与 `ops` 一一对应：这一项是稿里的哪个键（失败带序号时对回哪一块）。 */
    readonly keys: readonly string[];
    /** 编不进去的块与原因（新块所在的位置放不了、清空了一个不能删的块）；非空时不能提交。 */
    readonly problems: ReadonlyMap<string, Blocked>;
    readonly tooMany: boolean;
}

/**
 * 把稿编成一批写入操作（author-ui 输出 44）。稿要先 `rebase` 到这次读取上、冲突都选过。顺序是改字、加块、删块：加块要用的
 * 锚点可能正是这一批要删的块。清空的旧块按删掉算，空的新块不发。净变化是零时 `ops` 为空，调用方不发请求。
 */
export function compile(draft: TextDraft, read: TextRead, entry: string): Compiled {
    const sets: {op: EntryOp; key: string}[] = [];
    const adds: {op: EntryOp; key: string}[] = [];
    const removes: {op: EntryOp; key: string}[] = [];
    const problems = new Map<string, Blocked>();
    const at = (id: string) => ({entry, path: `text[${id}]`});
    const remove = (id: string): void => {
        const info = blockOf(read, id);
        const reason: Blocked | null = info === undefined ? {kind: "gone"} : freeProblem(info);
        if (reason !== null) problems.set(id, reason);
        else removes.push({op: {op: "removeBlock", at: at(id)}, key: id});
    };
    for (const key of draft.order) {
        if (isNewKey(key)) {
            const text = own(draft.texts, key) ?? "";
            if (blank(text)) continue;
            const slot = slotAfter(draft, read, key);
            if ("kind" in slot) problems.set(key, slot);
            else adds.push({op: {op: "addBlock", entry, source: text, after: slot.after}, key});
            continue;
        }
        const source = own(draft.base, key);
        if (source === undefined) continue;
        const text = own(draft.texts, key) ?? source;
        if (isRemoved(draft, key) || blank(text)) remove(key);
        else if (text !== source) sets.push({op: {op: "set", at: at(key), value: text, read: source}, key});
    }
    const all = [...sets, ...adds, ...removes];
    return {ops: all.map((item) => item.op), keys: all.map((item) => item.key), problems, tooMany: all.length > SUBMIT_OPS_MAX};
}
