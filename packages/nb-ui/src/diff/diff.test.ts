import {describe, expect, it} from "vitest";

import {diffRows, foldRows, hunkTexts} from "./index";
import type {DiffPiece} from "./index";

const textOf = (pieces: DiffPiece[] | null) => pieces?.map((piece) => piece.text).join("") ?? null;
const marked = (pieces: DiffPiece[] | null) => pieces?.filter((piece) => piece.mark).map((piece) => piece.text) ?? [];

describe("diffRows", () => {
    it("改了的一对行标到字：只标改动的字，别的字留着", () => {
        const {rows, stat} = diffRows("雨越下越大。\n他没有回头。\n灯灭了。", "雨越下越大。\n他回头了。\n灯灭了。");
        expect(rows.map((row) => row.kind)).toEqual(["same", "change", "same"]);
        expect(textOf(rows[1]!.left)).toBe("他没有回头。");
        expect(textOf(rows[1]!.right)).toBe("他回头了。");
        expect(marked(rows[1]!.left).join("")).toBe("没有");
        expect(marked(rows[1]!.right).join("")).toBe("了");
        expect(stat).toEqual({added: 1, removed: 1});
    });

    it("多出来的行是新增，少了的行是删除；行号各数各的", () => {
        const {rows, stat} = diffRows("甲\n乙\n", "甲\n丙\n丁\n戊\n");
        expect(rows.map((row) => row.kind)).toEqual(["same", "change", "add", "add"]);
        expect(rows.map((row) => [row.leftLine, row.rightLine])).toEqual([[0, 0], [1, 1], [null, 2], [null, 3]]);
        expect(stat).toEqual({added: 3, removed: 1});
        const removed = diffRows("甲\n乙\n丙\n", "甲\n");
        expect(removed.rows.map((row) => row.kind)).toEqual(["same", "del", "del"]);
        expect(removed.stat).toEqual({added: 0, removed: 2});
    });

    it("新建与清空：一侧是空的", () => {
        expect(diffRows("", "第一行\n第二行\n").rows.map((row) => row.kind)).toEqual(["add", "add"]);
        expect(diffRows("第一行\n", "").rows.map((row) => row.kind)).toEqual(["del"]);
        const empty = diffRows("", "");
        expect(empty.hunks).toEqual([]);
        expect(empty.stat).toEqual({added: 0, removed: 0});
    });

    it("只差文件末尾的换行不算改动", () => {
        const {hunks, stat} = diffRows("甲\n乙", "甲\n乙\n");
        expect(hunks).toEqual([]);
        expect(stat).toEqual({added: 0, removed: 0});
    });

    it("隔着没变的行是两块；范围能直接切原文，文字能取回来", () => {
        const before = "甲\n乙\n丙\n丁\n戊";
        const after = "甲\n乙乙\n丙\n丁\n新\n戊";
        const {rows, hunks} = diffRows(before, after);
        expect(hunks).toEqual([
            {index: 0, beforeRange: [1, 2], afterRange: [1, 2]},
            {index: 1, beforeRange: [4, 4], afterRange: [4, 5]},
        ]);
        expect(after.split("\n").slice(...hunks[1]!.afterRange)).toEqual(["新"]);
        expect(hunkTexts(rows, 0)).toEqual({beforeText: "乙", afterText: "乙乙"});
        expect(hunkTexts(rows, 1)).toEqual({beforeText: "", afterText: "新"});
    });

    it("一行之内离标记很远的没变文字收起，全文还在；近处的留着", () => {
        const head = "前".repeat(300);
        const tail = "后".repeat(300);
        const {rows} = diffRows(`${head}旧${tail}`, `${head}新${tail}`);
        const left = rows[0]!.left!;
        expect(textOf(left)).toBe(`${head}旧${tail}`);
        expect(left.map((piece) => [piece.mark, piece.folded, piece.text.length])).toEqual([
            [false, 260, 260],
            [false, undefined, 40],
            [true, undefined, 1],
            [false, undefined, 40],
            [false, 260, 260],
        ]);
    });

    it("两处标记之间：两边各留 40 字，放不下就不收", () => {
        const middle = (length: number) => "中".repeat(length);
        const far = diffRows(`旧${middle(200)}旧`, `新${middle(200)}新`).rows[0]!.left!;
        expect(far.find((piece) => piece.folded !== undefined)?.folded).toBe(120);
        const near = diffRows(`旧${middle(85)}旧`, `新${middle(85)}新`).rows[0]!.left!;
        expect(near.some((piece) => piece.folded !== undefined)).toBe(false);
    });

    it("按码位收起，不把一个字劈成两半", () => {
        const emoji = "😀".repeat(100);
        const {rows} = diffRows(`旧${emoji}`, `新${emoji}`);
        const pieces = rows[0]!.left!;
        expect(pieces.find((piece) => piece.folded !== undefined)?.folded).toBe(60);
        for (const piece of pieces) expect(piece.text.isWellFormed()).toBe(true);
    });

    it("很大的改动只标到行：两侧长度和超过 2000 字，或者差太多", () => {
        const long = diffRows(`${"甲".repeat(1100)}旧`, `${"甲".repeat(1100)}新`).rows[0]!;
        expect(long.left).toEqual([{text: `${"甲".repeat(1100)}旧`, mark: true}]);
        const unlike = diffRows("甲乙丙丁".repeat(100), "子丑寅卯".repeat(100)).rows[0]!;
        expect(unlike.kind).toBe("change");
        expect(unlike.left).toEqual([{text: "甲乙丙丁".repeat(100), mark: true}]);
    });

    it("编辑距离超过较短一侧的 20% 就放弃：不留一堆碎标记", () => {
        // 一半的字相同且交错：不设上限时能算出来，但满行都是碎片，读不了。
        const before = Array.from({length: 500}, (_, index) => `甲${String.fromCodePoint(0x4e00 + index)}`).join("");
        const after = Array.from({length: 500}, (_, index) => `甲${String.fromCodePoint(0x5e00 + index)}`).join("");
        expect(diffRows(before, after).rows[0]!.left).toEqual([{text: before, mark: true}]);
        // 改得少的照样标到字。
        const edited = `${before.slice(0, 500)}改${before.slice(501)}`;
        expect(diffRows(before, edited).rows[0]!.left!.length).toBeGreaterThan(1);
    });

    it("预算用完之后的都只标到行", () => {
        const {rows} = diffRows("甲旧\n乙旧", "甲新\n乙新", {budgetMs: 0});
        expect(rows.map((row) => marked(row.left))).toEqual([["甲旧"], ["乙旧"]]);
    });

    it("3000 字对 3000 字完全不同：一下子算完，不卡主线程", () => {
        const pick = (seed: number, length: number) => Array.from({length}, (_, index) => String.fromCodePoint(0x4e00 + ((index * seed) % 5000))).join("");
        const started = performance.now();
        const {rows} = diffRows(pick(7, 3000), pick(11, 3000));
        expect(rows).toHaveLength(1);
        // 上限 2000 字本来就不按字比；这里再试一对刚好在上限内的，靠编辑距离的上限收住。
        diffRows(pick(7, 990), pick(11, 990));
        expect(performance.now() - started).toBeLessThan(500);
    });

    it("几千行几乎全不一样：退回整段替换，不卡住", () => {
        const lines = (prefix: string) => Array.from({length: 8000}, (_, index) => `${prefix}${index}`).join("\n");
        const started = performance.now();
        const {stat} = diffRows(lines("甲"), lines("乙"));
        expect(stat).toEqual({added: 8000, removed: 8000});
        expect(performance.now() - started).toBeLessThan(2000);
    });
});

describe("foldRows", () => {
    const rowsOf = (before: string, after: string) => diffRows(before, after).rows;
    const lines = (count: number) => Array.from({length: count}, (_, index) => `第${index}行`);

    it("没变的连续行收起，改动上下留 2 行", () => {
        const before = lines(20);
        const after = [...before];
        after[10] = "改了";
        const groups = foldRows(rowsOf(before.join("\n"), after.join("\n")));
        expect(groups.map((group) => [group.type, group.start, group.rows.length])).toEqual([
            ["fold", 0, 8],
            ["rows", 8, 5],
            ["fold", 13, 7],
        ]);
    });

    it("只收一行时不收，直接显示", () => {
        const before = lines(6);
        const after = [...before];
        after[3] = "改了";
        const groups = foldRows(rowsOf(before.join("\n"), after.join("\n")));
        expect(groups).toHaveLength(1);
        expect(groups[0]!.type).toBe("rows");
        expect(groups[0]!.rows).toHaveLength(6);
    });

    it("一处改动都没有时不收", () => {
        const text = lines(30).join("\n");
        const groups = foldRows(rowsOf(text, text));
        expect(groups.map((group) => group.type)).toEqual(["rows"]);
    });

    it("上下文可以调", () => {
        const before = lines(20);
        const after = [...before];
        after[10] = "改了";
        const groups = foldRows(rowsOf(before.join("\n"), after.join("\n")), 0);
        expect(groups.map((group) => group.rows.length)).toEqual([10, 1, 9]);
    });
});
