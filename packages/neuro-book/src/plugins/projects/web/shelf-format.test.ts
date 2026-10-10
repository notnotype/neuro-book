/** 书架的显示规则（shelf-format.ts）：字数与时间的写法、书脊厚度、排序与继续写作的选择。 */

import {describe, expect, it} from "bun:test";

import type {ShelfItem, ShelfStats} from "../shared/shelf";
import {continueTarget, formatToday, formatWhen, formatWords, SPINE_HEIGHTS, SPINE_WIDTH, spineHeight, spineWidth, sortShelf} from "./shelf-format";

function item(id: string, title: string | null, stats: Partial<ShelfStats> = {}): ShelfItem {
    return {
        id, name: id, title, description: null, color: null, path: `/books/${id}`, state: "stopped",
        stats: {freshness: "stale", computedAt: null, words: 0, files: 0, today: null, last: null, ...stats},
    };
}

const at = (iso: string) => ({address: "project://a.md", label: "a", at: iso, excerpt: ""});

describe("字数", () => {
    it("中文一万以下写全数，一万以上写万字并留一位小数；英文以一千为界", () => {
        expect(formatWords(8240, "zh-CN")).toBe("8,240 字");
        expect(formatWords(10_000, "zh-CN")).toBe("1 万字");
        expect(formatWords(286_400, "zh-CN")).toBe("28.6 万字");
        expect(formatWords(840, "en-US")).toBe("840 words");
        expect(formatWords(21_500, "en-US")).toBe("21.5k words");
    });

    it("今天净增为负时带负号，不写成 0", () => {
        expect(formatToday(1240, "zh-CN")).toBe("今天 1,240 字");
        expect(formatToday(-320, "zh-CN")).toBe("今天 −320 字");
        expect(formatToday(0, "en-US")).toBe("0 today");
    });
});

describe("时间", () => {
    const now = "2026-10-10T16:30:00";
    it("今天与昨天带时分，今年只写月日，更早带年份", () => {
        expect(formatWhen("2026-10-10T09:05:00", now, "zh-CN")).toBe("今天 09:05");
        expect(formatWhen("2026-10-09T21:40:00", now, "zh-CN")).toBe("昨天 21:40");
        expect(formatWhen("2026-09-21T10:00:00", now, "zh-CN")).toBe("9月21日");
        expect(formatWhen("2025-12-30T23:30:00", now, "zh-CN")).toBe("2025年12月30日");
        expect(formatWhen("2026-10-09T21:40:00", now, "en-US")).toBe("Yesterday 21:40");
    });

    it("跨月的“昨天”按日历算", () => {
        expect(formatWhen("2026-09-30T23:00:00", "2026-10-01T08:00:00", "zh-CN")).toBe("昨天 23:00");
    });
});

describe("书脊", () => {
    it("厚度随字数单调增长，夹在上下限之间", () => {
        expect(spineWidth(0)).toBe(SPINE_WIDTH.min);
        expect(spineWidth(50_000_000)).toBe(SPINE_WIDTH.max);
        const widths = [0, 1000, 10_000, 100_000, 1_000_000].map(spineWidth);
        expect(widths).toEqual([...widths].sort((a, b) => a - b));
        expect(new Set(widths).size).toBe(widths.length);
    });

    it("高度只取几档之一，同一个 id 总是同一档", () => {
        for (const id of ["a", "b", "8f0c2d4e-1a2b-4c3d-8e9f-0a1b2c3d4e5f"]) {
            expect(SPINE_HEIGHTS).toContain(spineHeight(id) as (typeof SPINE_HEIGHTS)[number]);
            expect(spineHeight(id)).toBe(spineHeight(id));
        }
    });
});

describe("排序与继续写作", () => {
    const books = [
        item("b", "北方", {words: 300, last: at("2026-10-08T10:00:00Z")}),
        item("a", "长夜", {words: 900, last: at("2026-10-10T10:00:00Z")}),
        item("c", null, {words: 300}),
        item("d", "雾中", {words: 100, last: at("2026-09-01T10:00:00Z")}),
    ];

    it("最近编辑在前，没有编辑记录的排在最后", () => {
        expect(sortShelf(books, "recent", "zh-CN").map((book) => book.id)).toEqual(["a", "b", "d", "c"]);
    });

    it("字数多的在前，相同时按显示名（没有书名时用短名）", () => {
        expect(sortShelf(books, "words", "zh-CN").map((book) => book.id)).toEqual(["a", "b", "c", "d"]);
    });

    it("按书名排序与输入顺序无关", () => {
        const forward = sortShelf(books, "title", "zh-CN").map((book) => book.id);
        expect(sortShelf([...books].reverse(), "title", "zh-CN").map((book) => book.id)).toEqual(forward);
    });

    it("继续写作选最近编辑的那一部；都没有编辑记录时没有", () => {
        expect(continueTarget(books)?.id).toBe("a");
        expect(continueTarget([item("x", "空")])).toBeNull();
    });
});
