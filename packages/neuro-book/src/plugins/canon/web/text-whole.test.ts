/**
 * 主文字当一整篇来改（text-whole.ts；docs/specs/canon/author-ui.md 输出 39、44）：整篇怎样编成对块的操作、哪些条目不能整篇改、
 * 世界变了以后要不要问作者。读取用手写的 `textBlocks` 结果（形状与内核给的一样）；编出来的操作发给真实内核以后读回对不对，
 * 在登记的测试里（`text-drafts-link.test.ts`）。
 */

import {describe, expect, it} from "bun:test";

import type {TextBlockInfo} from "@notnotype/nb-canon/schema";

import {compile, emptyDraft, hasChanges, removeBlock, setText, splitAt, SUBMIT_OPS_MAX} from "./text-draft";
import type {TextDraft, TextRead} from "./text-draft";
import {joinBlocks, realign, resolveWhole, setWhole, toWhole, wholeProblem} from "./text-whole";

const AT = {kind: "chapter", chapter: "ch3", edge: "end", line: "main"} as const;
const read = (blocks: readonly TextBlockInfo[], version = 1): TextRead => ({version, inputDigest: `d${String(version)}`, at: AT, blocks});
const free = (id: string, source: string, init: number): TextBlockInfo => ({id, source, write: "init", fixed: [], anchor: id, init});
/** 初值里的块，现在这个位置上的值是一条剧情变更给的。 */
const replaced = (id: string, source: string, init: number, change = "c5"): TextBlockInfo => ({id, source, write: "change", change, fixed: [change], anchor: id, init});

const ONE = read([free("b1", "甲", 0)]);
const THREE = read([free("b1", "甲", 0), free("b2", "乙", 1), free("b3", "丙", 2)]);
const NONE = read([]);

/** 一份稿编出来的操作，写成“动作 块 文字”。 */
const ops = (draft: TextDraft, from: TextRead): string[] => compile(draft, from, "e1").ops.map((op) => (op.op === "set" ? `set ${op.at.path} ${String(op.value)}` : op.op === "addBlock" ? `add ${String(op.after)} ${op.source}` : op.op === "removeBlock" ? `remove ${op.at.path}` : op.op));
const edited = (from: TextRead, text: string): TextDraft => setWhole(emptyDraft(from), from, text);

describe("author-ui 输出 39：整篇与块", () => {
    it("读到的各块用一个空行连成整篇", () => {
        expect([joinBlocks(THREE), joinBlocks(ONE), joinBlocks(NONE)]).toEqual(["甲\n\n乙\n\n丙", "甲", ""]);
    });

    it.each<[string, TextRead, string, string[]]>([
        ["一块的条目改了字：改这一块", ONE, "甲改", ["set text[b1] 甲改"]],
        ["多块的条目改了字：整篇写进第一块，其余的块删掉", THREE, "甲\n\n乙改\n\n丙", ["set text[b1] 甲\n\n乙改\n\n丙", "remove text[b2]", "remove text[b3]"]],
        ["没有块的条目：在最前加一块", NONE, "新写的", ["add null 新写的"]],
        ["整篇清空：全部的块删掉", THREE, "  \n", ["remove text[b1]", "remove text[b2]", "remove text[b3]"]],
        ["没有块、也没写字：不发", NONE, "", []],
    ])("%s", (_name, from, text, expected) => {
        expect(ops(edited(from, text), from)).toEqual(expected);
    });

    it("改回读到的样子就不算有未提交的内容，多块的条目也不会因此被并成一块", () => {
        const back = setWhole(edited(THREE, "甲\n\n乙改\n\n丙"), THREE, "甲\n\n乙\n\n丙");
        expect([hasChanges(back), ops(back, THREE)]).toEqual([false, []]);
        expect(hasChanges(edited(THREE, "改"))).toBe(true);
    });

    it("没有主文字的条目里只打了空白：没有要发的，也不算有未提交的内容", () => {
        const spaces = edited(NONE, "  \n");
        expect([hasChanges(spaces), ops(spaces, NONE)]).toEqual([false, []]);
    });

    it.each<[string, TextRead, NonNullable<ReturnType<typeof wholeProblem>>["kind"] | null]>([
        ["都是没被碰过的初值块：能改", THREE, null],
        ["没有块：能改", NONE, null],
        ["有一块在这个位置上的值是剧情变更给的：不能", read([free("b1", "甲", 0), replaced("b2", "乙′", 1)]), "story"],
        ["有剧情加出来的块挂在某一块后面：不能", read([{...free("b1", "甲", 0), fixed: ["c2"]}, {id: "b4", source: "X", write: "change", change: "c2", fixed: ["c2"], anchor: "b1"} satisfies TextBlockInfo]), "story"],
        ["块数超过一次写入的上限：不能", read(Array.from({length: SUBMIT_OPS_MAX + 1}, (_item, index) => free(`b${String(index + 1)}`, "字", index))), "too-many"],
        ["块数正好是上限：能改", read(Array.from({length: SUBMIT_OPS_MAX}, (_item, index) => free(`b${String(index + 1)}`, "字", index))), null],
    ])("哪些条目能整篇改：%s", (_name, from, expected) => {
        expect(wholeProblem(from)?.kind ?? null).toBe(expected);
    });
});

describe("author-ui 输出 44：世界变了以后要不要问", () => {
    const mine = "甲\n\n乙（作者改）\n\n丙";
    const draft = edited(THREE, mine);
    const asked = (from: TextRead, of: TextDraft = draft) => realign(of, from).conflicts.map((conflict) => ({mine: conflict.mine, theirs: conflict.theirs, locked: conflict.locked?.kind ?? null}));

    it("别处没动这篇文字（改的是别的东西）：不问，照新读到的块重新编", () => {
        const later = read(THREE.blocks, 2);
        const aligned = realign(draft, later);
        expect([aligned.conflicts, ops(aligned.draft, later)]).toEqual([[], [`set text[b1] ${mine}`, "remove text[b2]", "remove text[b3]"]]);
    });

    it.each<[string, TextRead]>([
        ["别处改了其中一块的字", read([free("b1", "甲", 0), free("b2", "别处改乙", 1), free("b3", "丙", 2)], 2)],
        ["别处在末尾加了一块", read([...THREE.blocks, free("b4", "别处加的", 3)], 2)],
        ["别处删了一块", read([free("b1", "甲", 0), free("b3", "丙", 2)], 2)],
    ])("%s：问一次，给出两份整篇", (_name, later) => {
        expect(asked(later)).toEqual([{mine, theirs: joinBlocks(later), locked: null}]);
    });

    it("别处加了一块、作者选“我的”：发出去以后世界里只有作者的整篇，别处加的那一块删掉；别处再改一次要再问", () => {
        const later = read([...THREE.blocks, free("b4", "别处加的", 3)], 2);
        const aligned = realign(draft, later);
        const kept = resolveWhole(aligned.draft, later, aligned.conflicts[0]!, "mine");
        expect(ops(kept, later)).toEqual([`set text[b1] ${mine}`, "remove text[b2]", "remove text[b3]", "remove text[b4]"]);
        expect(asked(read(later.blocks, 3), kept)).toEqual([]);
        const again = read([...later.blocks, free("b5", "又加一块", 4)], 4);
        expect(asked(again, kept)).toEqual([{mine, theirs: joinBlocks(again), locked: null}]);
    });

    it("作者选“现在的”：没有未提交的内容了", () => {
        const later = read([free("b1", "别处重写了整篇", 0)], 2);
        const aligned = realign(draft, later);
        const dropped = resolveWhole(aligned.draft, later, aligned.conflicts[0]!, "theirs");
        expect([hasChanges(dropped), ops(dropped, later), dropped.whole]).toEqual([false, [], {base: "别处重写了整篇", text: "别处重写了整篇"}]);
    });

    it("两边改成一样的、或作者其实没改：不问，跟着读到的走", () => {
        const same = read([free("b1", mine, 0)], 2);
        const followed = realign(draft, same);
        expect([followed.conflicts, hasChanges(followed.draft)]).toEqual([[], false]);

        const untouched = setWhole(emptyDraft(THREE), THREE, joinBlocks(THREE));
        const moved = read([free("b1", "别处改甲", 0)], 2);
        const after = realign(untouched, moved);
        expect([after.conflicts, hasChanges(after.draft), after.draft.whole?.text]).toEqual([[], false, "别处改甲"]);
    });

    it("重读发现有一块被剧情改过了：问，只能照现在的来；这期间作者的字还在稿里、不编出操作", () => {
        const later = read([free("b1", "甲", 0), replaced("b2", "乙′", 1), free("b3", "丙", 2)], 2);
        const aligned = realign(draft, later);
        expect(asked(later)).toEqual([{mine, theirs: "甲\n\n乙′\n\n丙", locked: "story"}]);
        expect([hasChanges(aligned.draft), aligned.draft.whole?.text, ops(aligned.draft, later)]).toEqual([true, mine, []]);
        const settled = resolveWhole(aligned.draft, later, aligned.conflicts[0]!, "mine");
        expect([hasChanges(settled), ops(settled, later)]).toEqual([false, []]);
    });

    it("冻结着的请求与开始编辑的位置随稿带着", () => {
        const pending = {requestId: "r1", title: "改", stamp: {version: 1, input: "d1"}, ops: [], keys: []};
        const aligned = realign({...draft, pending}, read(THREE.blocks, 2));
        expect([aligned.draft.pending, aligned.draft.at]).toEqual([pending, AT]);
    });
});

describe("没有整篇字段的稿", () => {
    it("刚开始编辑的空稿换算以后没有改动：条目里有空白的块时也一样", () => {
        const gappy = read([free("b1", "甲", 0), free("b2", "", 1), free("b3", "丙", 2)]);
        const fresh = toWhole(emptyDraft(gappy), gappy);
        expect([fresh.whole, hasChanges(fresh), ops(fresh, gappy)]).toEqual([{base: "甲\n\n\n\n丙", text: "甲\n\n\n\n丙"}, false, []]);
    });

    it("按块改过的旧稿换算以后，它动过的块别处也改了：提交时照样问", () => {
        const old = setText(emptyDraft(THREE), THREE, "b2", "乙（旧稿里改的）");
        const later = read([free("b1", "甲", 0), free("b2", "乙（别处改的）", 1), free("b3", "丙", 2)], 2);
        const aligned = realign(toWhole(old, later), later);
        expect(aligned.conflicts).toEqual([{kind: "whole", mine: "甲\n\n乙（旧稿里改的）\n\n丙", theirs: "甲\n\n乙（别处改的）\n\n丙"}]);
    });
});

describe("按块改出来的旧稿", () => {
    it("换算成整篇：各块现在的文字连起来，删掉的与空的不算；之后照整篇提交", () => {
        let old = setText(emptyDraft(THREE), THREE, "b1", "甲\n\n拆出去的");
        old = splitAt(old, THREE, "b1", "甲".length).draft;
        old = removeBlock(old, THREE, "b2");
        const whole = toWhole(old, THREE);
        expect(whole.whole).toEqual({base: "甲\n\n乙\n\n丙", text: "甲\n\n拆出去的\n\n丙"});
        expect(ops(whole, THREE)).toEqual(["set text[b1] 甲\n\n拆出去的\n\n丙", "remove text[b2]", "remove text[b3]"]);
    });
});
