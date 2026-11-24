/**
 * 主文字当一整篇来改（docs/specs/canon/author-ui.md 输出 39、44）：第一版界面不分节，作者改的是各块连起来的整篇，提交时写进
 * 第一块、其余的块删掉。建在 `text-draft.ts` 上，同样是纯函数。
 *
 * 稿里只有 `whole` 是真相。块一级的字段（`texts`、`removed`、`order`）每次按当时读到的块从它重新编出来（`wholeDraft`），不
 * 经 `rebase`：按块对的话，别处新加的块不在稿里、不算冲突，会被悄悄留在作者的整篇后面一起发出去。这里拿读到的整篇与开始
 * 编辑时的比（`realign`），别处加了块、删了块、改了字都看得出来。
 */

import {addAfter, allowed, emptyDraft, isRemoved, removeBlock, setText, SUBMIT_OPS_MAX, textOf} from "./text-draft";
import type {Blocked, TextDraft, TextRead} from "./text-draft";

export type WholeText = NonNullable<TextDraft["whole"]>;

/** 这次读到的块不能整篇改的原因：有被剧情变更碰过的块（`Blocked`），或块数超过一次写入的上限。 */
export type WholeProblem = Blocked | {readonly kind: "too-many"; readonly count: number};

/**
 * 重读以后要作者定的事：读到的整篇与开始编辑时不同、与作者的也不同。`locked` 非空是现在这些块不能整篇改了，只能照现在
 * 的来。
 */
export interface WholeConflict {
    readonly kind: "whole";
    readonly mine: string;
    readonly theirs: string;
    readonly locked?: WholeProblem;
}

const SEPARATOR = "\n\n";

/** 读到的各块连成的整篇。 */
export const joinBlocks = (read: TextRead): string => read.blocks.map((block) => block.source).join(SEPARATOR);

/**
 * 这些块能不能整篇改：整篇写进第一块、其余删掉，所以每一块都得是没被剧情变更碰过的初值块（与删块同一个判断），没有块时
 * 最前面要放得进新块；一块对应一项操作，块数不能超过一次写入的上限。
 */
export function wholeProblem(read: TextRead): WholeProblem | null {
    if (read.blocks.length > SUBMIT_OPS_MAX) return {kind: "too-many", count: read.blocks.length};
    const rules = allowed(emptyDraft(read), read);
    if (read.blocks.length === 0) return rules.first;
    for (const block of read.blocks) {
        const blocked = rules.blocks.get(block.id)?.remove ?? null;
        if (blocked !== null) return blocked;
    }
    return null;
}

/** 位置与冻结着的请求不随重新编稿变。 */
const carried = (from: TextDraft, whole: WholeText): Pick<TextDraft, "at" | "whole" | "pending"> => ({at: from.at, whole, ...(from.pending === undefined ? {} : {pending: from.pending})});

/**
 * 按这次读到的块重新编出稿：整篇与读到的相同时没有改动；否则第一块改成整篇、其余删掉，没有块时在最前加一块，整篇是空白
 * 时全部删掉。调用方先确认这些块能整篇改（`wholeProblem`）。
 */
export function wholeDraft(from: TextDraft, read: TextRead, whole: WholeText): TextDraft {
    let draft = emptyDraft(read);
    if (whole.text !== joinBlocks(read)) {
        const [first, ...rest] = read.blocks;
        if (whole.text.trim() === "") for (const block of read.blocks) draft = removeBlock(draft, read, block.id);
        else if (first === undefined) draft = addAfter(draft, null, whole.text).draft;
        else {
            draft = setText(draft, read, first.id, whole.text);
            for (const block of rest) draft = removeBlock(draft, read, block.id);
        }
    }
    return {...draft, ...carried(from, whole)};
}

/** 作者把整篇改成 `text`。稿还没有 `whole`（刚开始编辑）时，开始时的整篇就是这次读到的。 */
export function setWhole(draft: TextDraft, read: TextRead, text: string): TextDraft {
    return wholeDraft(draft, read, {base: draft.whole?.base ?? joinBlocks(read), text});
}

/**
 * 按块改出来的旧稿（没有 `whole`）换算成整篇：各块现在的文字连起来。它开始时读到的整篇已经查不到，取这次读到的：换算
 * 之前别处的改动不再问。
 */
export function toWhole(draft: TextDraft, read: TextRead): TextDraft {
    const text = draft.order.filter((key) => !isRemoved(draft, key)).map((key) => textOf(draft, read, key)).filter((block) => block.trim() !== "").join(SEPARATOR);
    return wholeDraft(draft, read, {base: joinBlocks(read), text});
}

/**
 * 把整篇的稿对到新读的块上（author-ui 输出 44）。作者没改过就跟着读到的走；两边改成一样的不问；读到的整篇与开始时相同
 * 就照新读到的块重新编；不同就问一次，稿留着作者的整篇等他选（`resolveWhole`）。
 */
export function realign(draft: TextDraft, read: TextRead): {readonly draft: TextDraft; readonly conflicts: readonly WholeConflict[]} {
    const theirs = joinBlocks(read);
    const whole = draft.whole ?? {base: theirs, text: theirs};
    if (whole.text === whole.base || whole.text === theirs) return {draft: wholeDraft(draft, read, {base: theirs, text: theirs}), conflicts: []};
    const locked = wholeProblem(read);
    // 不能整篇改的块上不编操作：块一级是空的，作者的字留在 `whole` 里（`hasChanges` 看的是它）。
    if (locked !== null) return {draft: {...emptyDraft(read), ...carried(draft, whole)}, conflicts: [{kind: "whole", mine: whole.text, theirs, locked}]};
    const next = wholeDraft(draft, read, whole);
    return {draft: next, conflicts: theirs === whole.base ? [] : [{kind: "whole", mine: whole.text, theirs}]};
}

/**
 * 作者选完：`mine` 认下别处的版本、以自己的为准（之后别处再改还会再问）；`theirs` 放弃自己的改动。不能整篇改的那一种只有
 * `theirs`。
 */
export function resolveWhole(draft: TextDraft, read: TextRead, conflict: WholeConflict, choice: "mine" | "theirs"): TextDraft {
    if (choice === "theirs" || conflict.locked !== undefined || draft.whole === undefined) return wholeDraft(draft, read, {base: conflict.theirs, text: conflict.theirs});
    return wholeDraft(draft, read, {base: conflict.theirs, text: draft.whole.text});
}
