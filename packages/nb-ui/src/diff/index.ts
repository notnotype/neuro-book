/**
 * 把改前改后的两段文字算成可显示的行：先按行比，改了的一对行再按字比（中文一段就是一行，只标整行看不出改了哪儿）。
 * 给 DiffView 用，别的包经 `@notnotype/nb-ui/diff` 拿同一份结果。
 *
 * 按字比会很慢（两段各 3000 字完全不同的 `diffChars` 要 7.5 秒），这里算在浏览器主线程上，所以三道上限：
 * 一对行两侧长度和超过 2000 字不按字比；编辑距离超过较短一侧的 20% 放弃（已经不像改写了）；累计预算用完之后的都只标到行。
 */

import {diffChars, diffLines} from "diff";

export type DiffPiece = {
    text: string;
    /** 这段是改动。 */
    mark: boolean;
    /** 没变、离标记很远、默认收起的文字：`text` 仍是全文，值是它的字数。 */
    folded?: number;
};

export type DiffRow = {
    kind: "same" | "add" | "del" | "change";
    left: DiffPiece[] | null;
    right: DiffPiece[] | null;
    /** 从 0 数的行号。 */
    leftLine: number | null;
    rightLine: number | null;
    /** 属于第几块改动；`same` 为 null。 */
    hunk: number | null;
};

export type DiffHunk = {
    index: number;
    /** 从 0 数、右开的行范围，可以直接拿去切 `split("\n")` 的结果。纯新增时前一个范围为空，反之亦然。 */
    beforeRange: [number, number];
    afterRange: [number, number];
};

export type DiffResult = {
    rows: DiffRow[];
    hunks: DiffHunk[];
    stat: {added: number; removed: number};
};

/** `foldRows` 的结果：连续显示的一段行，或一段收起的没变的行。`start` 是第一行在 `rows` 里的下标。 */
export type DiffRowGroup =
    | {type: "rows"; start: number; rows: DiffRow[]}
    | {type: "fold"; start: number; rows: DiffRow[]};

const CHAR_DIFF_MAX_LENGTH = 2000;
const CHAR_DIFF_MIN_EDITS = 50;
const CHAR_DIFF_EDIT_RATIO = 0.2;
const DEFAULT_BUDGET_MS = 150;
/** 行数很多又几乎全不一样时按行比也会慢；超时当作整段替换。少量改动的编辑距离小，碰不到它。 */
const LINE_DIFF_TIMEOUT_MS = 300;
const FOLD_KEEP_CHARS = 40;
/** 收起的字数太少时不收：点开比直接读还费事。 */
const FOLD_MIN_CHARS = 12;

function splitLines(value: string): string[] {
    return (value.endsWith("\n") ? value.slice(0, -1) : value).split("\n");
}

/** 没变的文字只留标记两边各 40 字，中间收起。按码位切，不把一个字劈成两半。 */
function foldUnchanged(text: string, hasMarkBefore: boolean, hasMarkAfter: boolean): DiffPiece[] {
    if (text.length <= FOLD_KEEP_CHARS) return [{text, mark: false}];
    const chars = Array.from(text);
    const head = hasMarkBefore ? FOLD_KEEP_CHARS : 0;
    const tail = hasMarkAfter ? FOLD_KEEP_CHARS : 0;
    const foldedCount = chars.length - head - tail;
    if (foldedCount < FOLD_MIN_CHARS) return [{text, mark: false}];
    const pieces: DiffPiece[] = [];
    if (head > 0) pieces.push({text: chars.slice(0, head).join(""), mark: false});
    pieces.push({text: chars.slice(head, chars.length - tail).join(""), mark: false, folded: foldedCount});
    if (tail > 0) pieces.push({text: chars.slice(chars.length - tail).join(""), mark: false});
    return pieces;
}

function foldPieces(pieces: DiffPiece[]): DiffPiece[] {
    return pieces.flatMap((piece, index) => piece.mark
        ? [piece]
        : foldUnchanged(piece.text, pieces[index - 1]?.mark === true, pieces[index + 1]?.mark === true));
}

/** 一对改了的行。放弃按字比时整行标记。 */
function changedPieces(before: string, after: string, remainingMs: number): {left: DiffPiece[]; right: DiffPiece[]} {
    const whole = {left: [{text: before, mark: true}], right: [{text: after, mark: true}]};
    if (remainingMs <= 0 || before.length + after.length > CHAR_DIFF_MAX_LENGTH) return whole;
    const maxEditLength = Math.max(CHAR_DIFF_MIN_EDITS, Math.floor(Math.min(before.length, after.length) * CHAR_DIFF_EDIT_RATIO));
    const changes = diffChars(before, after, {maxEditLength, timeout: remainingMs});
    if (changes === undefined) return whole;
    const left: DiffPiece[] = [];
    const right: DiffPiece[] = [];
    for (const change of changes) {
        if (change.added !== true) left.push({text: change.value, mark: change.removed === true});
        if (change.removed !== true) right.push({text: change.value, mark: change.added === true});
    }
    return {left: foldPieces(left), right: foldPieces(right)};
}

export function diffRows(before: string, after: string, options: {budgetMs?: number} = {}): DiffResult {
    const deadline = performance.now() + (options.budgetMs ?? DEFAULT_BUDGET_MS);
    // 只差文件末尾有没有换行时不算改动：否则最后一行会显示成一对看不出差别的改动行。
    const parts = diffLines(before, after, {ignoreNewlineAtEof: true, timeout: LINE_DIFF_TIMEOUT_MS})
        ?? [{value: before, removed: true, added: false, count: 0}, {value: after, removed: false, added: true, count: 0}];

    const rows: DiffRow[] = [];
    const hunks: DiffHunk[] = [];
    const stat = {added: 0, removed: 0};
    let leftLine = 0;
    let rightLine = 0;

    const pushChanged = (row: Omit<DiffRow, "hunk" | "leftLine" | "rightLine">) => {
        const previous = rows.at(-1);
        // 连续的改动行是一块；中间隔了没变的行就是新的一块。
        if (previous === undefined || previous.hunk === null) hunks.push({index: hunks.length, beforeRange: [leftLine, leftLine], afterRange: [rightLine, rightLine]});
        const hunk = hunks.at(-1)!;
        rows.push({...row, leftLine: row.left === null ? null : leftLine, rightLine: row.right === null ? null : rightLine, hunk: hunk.index});
        if (row.left !== null) {
            leftLine += 1;
            stat.removed += 1;
            hunk.beforeRange[1] = leftLine;
        }
        if (row.right !== null) {
            rightLine += 1;
            stat.added += 1;
            hunk.afterRange[1] = rightLine;
        }
    };

    for (let index = 0; index < parts.length; index += 1) {
        const part = parts[index]!;
        const next = parts[index + 1];
        if (part.removed === true && next?.added === true) {
            const olds = splitLines(part.value);
            const news = splitLines(next.value);
            for (let row = 0; row < Math.max(olds.length, news.length); row += 1) {
                const oldLine = olds[row];
                const newLine = news[row];
                if (oldLine !== undefined && newLine !== undefined) {
                    pushChanged({kind: "change", ...changedPieces(oldLine, newLine, deadline - performance.now())});
                } else if (oldLine !== undefined) {
                    pushChanged({kind: "del", left: [{text: oldLine, mark: true}], right: null});
                } else {
                    pushChanged({kind: "add", left: null, right: [{text: newLine!, mark: true}]});
                }
            }
            index += 1;
        } else if (part.removed === true) {
            for (const line of splitLines(part.value)) pushChanged({kind: "del", left: [{text: line, mark: true}], right: null});
        } else if (part.added === true) {
            for (const line of splitLines(part.value)) pushChanged({kind: "add", left: null, right: [{text: line, mark: true}]});
        } else {
            for (const line of splitLines(part.value)) {
                rows.push({kind: "same", left: [{text: line, mark: false}], right: [{text: line, mark: false}], leftLine, rightLine, hunk: null});
                leftLine += 1;
                rightLine += 1;
            }
        }
    }
    return {rows, hunks, stat};
}

/** 把没变的连续行收起，改动上下各留 `context` 行。收起的行数少于 2 时直接显示：一个“展开 1 行”比那一行还占地方。 */
export function foldRows(rows: readonly DiffRow[], context = 2): DiffRowGroup[] {
    const visible = rows.map(() => false);
    rows.forEach((row, index) => {
        if (row.kind === "same") return;
        for (let near = Math.max(0, index - context); near <= Math.min(rows.length - 1, index + context); near += 1) visible[near] = true;
    });
    const groups: DiffRowGroup[] = [];
    let start = 0;
    while (start < rows.length) {
        let end = start;
        while (end < rows.length && visible[end] === visible[start]) end += 1;
        const slice = rows.slice(start, end);
        // 一处改动都没有时不收：什么都看不到不算预览。
        const fold = visible[start] === false && slice.length >= 2 && slice.length < rows.length;
        const previous = groups.at(-1);
        if (!fold && previous?.type === "rows") previous.rows.push(...slice);
        else groups.push({type: fold ? "fold" : "rows", start, rows: slice});
        start = end;
    }
    return groups;
}

/** 一块改动的改前、改后全文，给“只采纳这一块”这类动作用。 */
export function hunkTexts(rows: readonly DiffRow[], hunk: number): {beforeText: string; afterText: string} {
    const join = (side: "left" | "right") => rows
        .filter((row) => row.hunk === hunk && row[side] !== null)
        .map((row) => row[side]!.map((piece) => piece.text).join(""))
        .join("\n");
    return {beforeText: join("left"), afterText: join("right")};
}
