/**
 * 主文字的稿（text-draft.ts；docs/specs/canon/author-ui.md 输出 39、44）：哪一块能做什么、块的操作、世界变了以后把稿对到新读的
 * 块上、编成一批操作。读取用手写的 `textBlocks` 结果（形状与内核给的一样，样子取自内核用例 `text-blocks.test.ts` 里“初值 A、B、C，
 * 第 2 章换掉 B、在 A 后面加 X，第 3 章在 X 后面加 Y”那个世界）；编出来的操作发给真实内核以后读回对不对，在登记的测试里。
 */

import {describe, expect, it} from "bun:test";

import type {TextBlockInfo} from "@notnotype/nb-canon/schema";

import {addAfter, allowed, changedCount, compile, emptyDraft, hasChanges, isNewKey, mergeUp, rebase, removeBlock, resolve, restoreBlock, setText, splitAt, SUBMIT_OPS_MAX, textOf} from "./text-draft";
import type {TextDraft, TextRead} from "./text-draft";

const AT = {kind: "chapter", chapter: "ch3", edge: "end", line: "main"} as const;
const read = (blocks: readonly TextBlockInfo[], version = 1): TextRead => ({version, inputDigest: `d${String(version)}`, at: AT, blocks});
const free = (id: string, source: string, init: number): TextBlockInfo => ({id, source, write: "init", fixed: [], anchor: id, init});

/** 第 3 章末尾：A（有剧情块挂在后面）、X 与 Y（剧情加出来的）、B′（剧情换过）、C（没人碰过）。 */
const LAYERED = read([
    {id: "b1", source: "A", write: "init", fixed: ["c2"], anchor: "b1", init: 0},
    {id: "b4", source: "X", write: "change", change: "c2", fixed: ["c2", "c3"], anchor: "b1"},
    {id: "b5", source: "Y", write: "change", change: "c3", fixed: ["c3"], anchor: "b1"},
    {id: "b2", source: "B′", write: "change", change: "c1", fixed: ["c1"], anchor: "b2", init: 1},
    {id: "b3", source: "C", write: "init", fixed: [], anchor: "b3", init: 2},
]);
/** 三块都没被碰过。 */
const PLAIN = read([free("b1", "甲", 0), free("b2", "乙", 1), free("b3", "丙", 2)]);

const kinds = (value: Readonly<Record<string, {readonly kind: string} | null>>): Record<string, string | null> => Object.fromEntries(Object.entries(value).map(([key, blocked]) => [key, blocked?.kind ?? null]));

describe("author-ui 输出 39：哪一块能做什么", () => {
    it("被剧情碰过的块只能改字；没被碰过的初值块能删、能拆；新块不能插在剧情加出来的块前面", () => {
        const can = allowed(emptyDraft(LAYERED), LAYERED);
        expect(Object.fromEntries(Object.entries(can.blocks).map(([key, block]) => [key, kinds(block as never)]))).toEqual({
            // A：有块挂在它后面，不能删、不能拆；它后面紧挨着 X，放不了新块。
            b1: {edit: null, remove: "story", split: "story", mergeUp: "story", addAfter: "before-story"},
            b4: {edit: null, remove: "story", split: "story", mergeUp: "story", addAfter: "before-story"},
            // Y 后面是初值里的 B′：能放。
            b5: {edit: null, remove: "story", split: "story", mergeUp: "story", addAfter: null},
            b2: {edit: null, remove: "story", split: "story", mergeUp: "story", addAfter: null},
            // C 自己能删能拆，但上一块 B′ 被剧情换过，并不进去。
            b3: {edit: null, remove: null, split: null, mergeUp: "story", addAfter: null},
        });
        expect(can.first).toBeNull();
        expect(can.blocks.b1!.remove).toEqual({kind: "story", changes: ["c2"]});
    });

    it("最前面是剧情加出来的块时，最前放不了；从别的线带过来的块不能改", () => {
        const head = read([{id: "b9", source: "X", write: "change", change: "c1", fixed: ["c1"], anchor: null}, free("b1", "甲", 0), {id: "b7", source: "带来的", write: "none", fixed: []}]);
        const can = allowed(emptyDraft(head), head);
        expect(can.first).toEqual({kind: "before-story"});
        expect(can.blocks.b9!.addAfter).toBeNull();
        expect(kinds(can.blocks.b7 as never)).toEqual({edit: "carried", remove: "carried", split: "carried", mergeUp: "carried", addAfter: "carried"});
        // 甲后面紧挨着的那块不在初值里：放不了。
        expect(can.blocks.b1!.addAfter).toEqual({kind: "before-story"});
    });

    it("并到上一块：两块都没被碰过、在初值里相邻才行；第一块没有上一块；新块随便并", () => {
        expect(kinds(Object.fromEntries(Object.entries(allowed(emptyDraft(PLAIN), PLAIN).blocks).map(([key, block]) => [key, block.mergeUp])))).toEqual({b1: "first", b2: null, b3: null});
        // 初值里 b1 与 b3 之间还有一块（这个位置上被剧情删了，看不到）：不相邻。
        const gap = read([free("b1", "甲", 0), free("b3", "丙", 2)]);
        expect(allowed(emptyDraft(gap), gap).blocks.b3!.mergeUp).toEqual({kind: "not-adjacent"});
        // 新块并进被剧情换过的块：等于改那一块的字，可以。
        const added = addAfter(emptyDraft(LAYERED), "b2");
        expect(allowed(added.draft, LAYERED).blocks[added.key]).toEqual({edit: null, remove: null, split: null, mergeUp: null, addAfter: null});
    });
});

describe("author-ui 输出 39、45：块的操作与“有没有未提交的内容”", () => {
    it("改字再改回原样就不算动过；删掉可以恢复，删之前改的字还在", () => {
        const start = emptyDraft(PLAIN);
        const edited = setText(start, PLAIN, "b2", "乙改");
        expect([hasChanges(start), hasChanges(edited), changedCount(edited), textOf(edited, PLAIN, "b2")]).toEqual([false, true, 1, "乙改"]);
        expect(setText(edited, PLAIN, "b2", "乙")).toEqual(start);
        const removed = removeBlock(edited, PLAIN, "b2");
        expect([removed.removed, allowed(removed, PLAIN).blocks.b2!.edit]).toEqual([["b2"], {kind: "removed"}]);
        expect(restoreBlock(removed, "b2")).toEqual(edited);
        // 没改过字就删、再恢复：回到没动过。
        expect(restoreBlock(removeBlock(start, PLAIN, "b2"), "b2")).toEqual(start);
    });

    it("从光标处拆开：前半留在原块，后半成新的一块，切口两边的空行不留；并到上一块中间空一行", () => {
        const source = read([free("b1", "第一段。\n\n第二段。", 0), free("b2", "乙", 1)]);
        const split = splitAt(emptyDraft(source), source, "b1", "第一段。\n".length);
        expect(split.draft.order).toEqual(["b1", split.key, "b2"]);
        expect([isNewKey(split.key), textOf(split.draft, source, "b1"), textOf(split.draft, source, split.key)]).toEqual([true, "第一段。", "第二段。"]);
        // 再并回去：文字回到原样，新块没了，等于没动过。
        const merged = mergeUp(split.draft, source, split.key);
        expect(merged?.into).toBe("b1");
        expect(merged?.draft).toEqual(emptyDraft(source));

        const joined = mergeUp(emptyDraft(source), source, "b2")!;
        expect([textOf(joined.draft, source, "b1"), joined.draft.removed]).toEqual(["第一段。\n\n第二段。\n\n乙", ["b2"]]);
        expect(mergeUp(emptyDraft(source), source, "b1")).toBeNull();
    });
});

describe("author-ui 输出 44：世界变了以后把稿对到新读的块上", () => {
    /** 稿：改了 b1、删了 b3、在 b1 后面加了一块。 */
    const mine = (): {draft: TextDraft; key: string} => {
        const added = addAfter(removeBlock(setText(emptyDraft(PLAIN), PLAIN, "b1", "甲改"), PLAIN, "b3"), "b1", "新的");
        return {draft: added.draft, key: added.key};
    };

    it("别处改的是没碰过的块、或加了块：照新读的来，不问；新块跟着它前面那一块", () => {
        const {draft, key} = mine();
        const fresh = read([free("b1", "甲", 0), free("b9", "别处加的", 1), free("b2", "乙（别处改了）", 2), free("b3", "丙", 3)], 2);
        const result = rebase(draft, fresh);
        expect(result.conflicts).toEqual([]);
        expect(result.draft.order).toEqual(["b1", key, "b9", "b2", "b3"]);
        expect([textOf(result.draft, fresh, "b1"), textOf(result.draft, fresh, "b2"), result.draft.removed]).toEqual(["甲改", "乙（别处改了）", ["b3"]]);
        // 别处删了没碰过的块：稿里也没有了。
        const dropped = rebase(draft, read([free("b1", "甲", 0), free("b3", "丙", 1)], 2));
        expect([dropped.conflicts, dropped.draft.order]).toEqual([[], ["b1", key, "b3"]]);
    });

    it("同一块两边都改了：列成冲突；选我的以后读到的原文换成现在的，选现在的就不算我动过", () => {
        const {draft} = mine();
        const fresh = read([free("b1", "甲（别处改了）", 0), free("b2", "乙", 1), free("b3", "丙（别处改了）", 2)], 2);
        const result = rebase(draft, fresh);
        expect(result.conflicts).toEqual([
            {kind: "changed", key: "b1", mine: "甲改", theirs: "甲（别处改了）"},
            {kind: "changed", key: "b3", mine: null, theirs: "丙（别处改了）"},
        ]);
        const chosen = resolve(resolve(result.draft, fresh, result.conflicts[0]!, "mine"), fresh, result.conflicts[1]!, "theirs");
        expect(rebase(chosen, fresh).conflicts).toEqual([]);
        expect([chosen.base, textOf(chosen, fresh, "b1"), chosen.removed, textOf(chosen, fresh, "b3")]).toEqual([{b1: "甲（别处改了）"}, "甲改", [], "丙（别处改了）"]);
    });

    it("两边改成一样的、两边都删了：当作已经一致，不问，也不再算我动过", () => {
        const {draft, key} = mine();
        const fresh = read([free("b1", "甲改", 0), free("b2", "乙", 1)], 2);
        const result = rebase(draft, fresh);
        expect(result.conflicts).toEqual([]);
        expect([result.draft.base, result.draft.removed, result.draft.order]).toEqual([{}, [], ["b1", key, "b2"]]);
    });

    it("我改过的块被别处删了：可以去掉这处改动，或当作新加的一块留着", () => {
        const {draft, key} = mine();
        const fresh = read([free("b2", "乙", 0), free("b3", "丙", 1)], 2);
        const result = rebase(draft, fresh);
        expect(result.conflicts).toEqual([{kind: "gone", key: "b1", mine: "甲改"}]);
        // 等着选的时候它还排在原处，后面跟着我加的那一块。
        expect(result.draft.order).toEqual(["b1", key, "b2", "b3"]);
        const dropped = resolve(result.draft, fresh, result.conflicts[0]!, "drop");
        expect([dropped.order, dropped.base]).toEqual([[key, "b2", "b3"], {b3: "丙"}]);
        const kept = resolve(result.draft, fresh, result.conflicts[0]!, "keep");
        expect(kept.order.length).toBe(4);
        expect([isNewKey(kept.order[0]!), textOf(kept, fresh, kept.order[0]!), kept.order.slice(1), rebase(kept, fresh).conflicts]).toEqual([true, "甲改", [key, "b2", "b3"], []]);
    });

    it("我要删的块别处的剧情碰了：列成冲突，只能撤掉删除", () => {
        const {draft} = mine();
        const fresh = read([free("b1", "甲", 0), free("b2", "乙", 1), {id: "b3", source: "丙", write: "init", fixed: ["c7"], anchor: "b3", init: 2}], 2);
        const result = rebase(draft, fresh);
        expect(result.conflicts).toEqual([{kind: "locked", key: "b3", remove: true, reason: {kind: "story", changes: ["c7"]}}]);
        expect(resolve(result.draft, fresh, result.conflicts[0]!, "mine")).toEqual(result.draft);
        const undone = resolve(result.draft, fresh, result.conflicts[0]!, "theirs");
        expect([undone.removed, rebase(undone, fresh).conflicts]).toEqual([[], []]);
    });

    it("拆过、并过的块后来被剧情碰了：改的字不能照发（换出去的那一半在初值里），列成冲突；只是改字的块不受影响", () => {
        const source = read([free("b1", "前半。\n\n后半。", 0), free("b2", "乙", 1)]);
        const split = splitAt(setText(emptyDraft(source), source, "b2", "乙改"), source, "b1", "前半。".length);
        const touched = (id: string, text: string, init: number): TextBlockInfo => ({id, source: text, write: "change", change: "c5", fixed: ["c5"], anchor: id, init});
        const fresh = read([touched("b1", "前半。\n\n后半。", 0), touched("b2", "乙", 1)], 2);
        const result = rebase(split.draft, fresh);
        expect(result.conflicts).toEqual([{kind: "locked", key: "b1", remove: false, reason: {kind: "story", changes: ["c5"]}}]);
        const undone = resolve(result.draft, fresh, result.conflicts[0]!, "theirs");
        expect([textOf(undone, fresh, "b1"), textOf(undone, fresh, "b2"), rebase(undone, fresh).conflicts]).toEqual(["前半。\n\n后半。", "乙改", []]);
    });
});

describe("author-ui 输出 44：编成一批操作", () => {
    it("顺序是改字、加块、删块；改字带读到的原文；新块的 after 是它前面最近的旧块的锚点，同一处的几块按顺序", () => {
        let draft = setText(emptyDraft(LAYERED), LAYERED, "b2", "B″");
        const afterY = addAfter(draft, "b5", "跟在 Y 后面");
        const second = addAfter(afterY.draft, afterY.key, "再跟一块");
        const tail = addAfter(second.draft, "b3", "文末");
        draft = removeBlock(tail.draft, LAYERED, "b3");
        const compiled = compile(draft, LAYERED, "e1");
        expect(compiled.ops).toEqual([
            {op: "set", at: {entry: "e1", path: "text[b2]"}, value: "B″", read: "B′"},
            // Y 是剧情加出来的：锚点追到初值里的 A。
            {op: "addBlock", entry: "e1", source: "跟在 Y 后面", after: "b1"},
            {op: "addBlock", entry: "e1", source: "再跟一块", after: "b1"},
            // 锚点正是这一批要删的块：所以加在删之前。
            {op: "addBlock", entry: "e1", source: "文末", after: "b3"},
            {op: "removeBlock", at: {entry: "e1", path: "text[b3]"}},
        ]);
        expect(compiled.keys).toEqual(["b2", afterY.key, second.key, tail.key, "b3"]);
        expect([compiled.problems, compiled.tooMany]).toEqual([{}, false]);
    });

    it("最前的新块 after 是 null；空的新块不发；清空的旧块按删掉算", () => {
        const head = addAfter(emptyDraft(PLAIN), null, "开头");
        const empty = addAfter(head.draft, "b1", "  \n");
        const compiled = compile(setText(empty.draft, PLAIN, "b3", ""), PLAIN, "e1");
        expect(compiled.ops).toEqual([{op: "addBlock", entry: "e1", source: "开头", after: null}, {op: "removeBlock", at: {entry: "e1", path: "text[b3]"}}]);
    });

    it("放不进去的新块、清空了不能删的块：列在 problems 里，不编进操作", () => {
        const blockedSlot = addAfter(emptyDraft(LAYERED), "b1", "想插在 A 与 X 之间");
        const compiled = compile(setText(blockedSlot.draft, LAYERED, "b2", ""), LAYERED, "e1");
        expect(compiled.ops).toEqual([]);
        expect(compiled.problems).toEqual({[blockedSlot.key]: {kind: "before-story"}, b2: {kind: "story", changes: ["c1"]}});
    });

    it("净变化是零时没有操作；超过一次能发的项数时标出来，操作照样编全", () => {
        expect(compile(emptyDraft(PLAIN), PLAIN, "e1").ops).toEqual([]);
        expect(compile(addAfter(emptyDraft(PLAIN), "b1").draft, PLAIN, "e1").ops).toEqual([]);
        const many = read(Array.from({length: SUBMIT_OPS_MAX}, (_, index) => free(`b${String(index + 1)}`, `第 ${String(index + 1)} 块`, index)));
        let draft = emptyDraft(many);
        for (const block of many.blocks) draft = setText(draft, many, block.id, `${block.source}（改）`);
        expect([compile(draft, many, "e1").ops.length, compile(draft, many, "e1").tooMany]).toEqual([SUBMIT_OPS_MAX, false]);
        // 再拆一块：多一项加块，超了。
        const over = compile(splitAt(draft, many, "b1", 2).draft, many, "e1");
        expect([over.ops.length, over.tooMany]).toEqual([SUBMIT_OPS_MAX + 1, true]);
    });
});
