/**
 * 主文字的稿（text-draft.ts；docs/specs/canon/author-ui.md 输出 39、44）：哪一块能做什么、块的操作、世界变了以后把稿对到新读的
 * 块上、编成一批操作。读取用手写的 `textBlocks` 结果（形状与内核给的一样，样子取自内核用例 `text-blocks.test.ts` 里“初值 A、B、C，
 * 第 2 章换掉 B、在 A 后面加 X，第 3 章在 X 后面加 Y”那个世界）；编出来的操作发给真实内核以后读回对不对，在登记的测试里。
 */

import {describe, expect, it} from "bun:test";

import type {TextBlockInfo} from "@notnotype/nb-canon/schema";

import {addAfter, allowed, changedCount, compile, emptyDraft, hasChanges, isNewKey, mergeUp, rebase, removeBlock, resolve, restoreBlock, setText, splitAt, SUBMIT_OPS_MAX, textOf} from "./text-draft";
import type {BlockAllowed, TextDraft, TextRead} from "./text-draft";

const AT = {kind: "chapter", chapter: "ch3", edge: "end", line: "main"} as const;
const read = (blocks: readonly TextBlockInfo[], version = 1): TextRead => ({version, inputDigest: `d${String(version)}`, at: AT, blocks});
const free = (id: string, source: string, init: number): TextBlockInfo => ({id, source, write: "init", fixed: [], anchor: id, init});
/** 初值里的块，现在这个位置上的值是一条剧情变更给的。 */
const replaced = (id: string, source: string, init: number, change = "c5"): TextBlockInfo => ({id, source, write: "change", change, fixed: [change], anchor: id, init});

/** 第 3 章末尾：A（有剧情块挂在后面）、X 与 Y（剧情加出来的）、B′（剧情换过）、C（没人碰过）。 */
const LAYERED = read([
    {id: "b1", source: "A", write: "init", fixed: ["c2"], anchor: "b1", init: 0},
    {id: "b4", source: "X", write: "change", change: "c2", fixed: ["c2", "c3"], anchor: "b1"},
    {id: "b5", source: "Y", write: "change", change: "c3", fixed: ["c3"], anchor: "b1"},
    replaced("b2", "B′", 1, "c1"),
    free("b3", "C", 2),
]);
/** 三块都没被碰过。 */
const PLAIN = read([free("b1", "甲", 0), free("b2", "乙", 1), free("b3", "丙", 2)]);

const kinds = (block: BlockAllowed | undefined): Record<string, string | null> => Object.fromEntries(Object.entries(block ?? {}).map(([action, blocked]) => [action, (blocked as {kind: string} | null)?.kind ?? null]));
const can = (draft: TextDraft, from: TextRead, key: string) => allowed(draft, from).blocks.get(key)!;

describe("author-ui 输出 39：哪一块能做什么", () => {
    it("被剧情碰过的块只能改字；没被碰过的初值块能删、能拆；新块不能插在剧情加出来的块前面", () => {
        const all = allowed(emptyDraft(LAYERED), LAYERED);
        expect(Object.fromEntries([...all.blocks].map(([key, block]) => [key, kinds(block)]))).toEqual({
            // A：有块挂在它后面，不能删、不能拆；它后面紧挨着 X，放不了新块。
            b1: {edit: null, remove: "story", split: "story", mergeUp: "story", addAfter: "before-story"},
            b4: {edit: null, remove: "story", split: "story", mergeUp: "story", addAfter: "before-story"},
            // Y 后面是初值里的 B′：能放。
            b5: {edit: null, remove: "story", split: "story", mergeUp: "story", addAfter: null},
            b2: {edit: null, remove: "story", split: "story", mergeUp: "story", addAfter: null},
            // C 自己能删能拆，但上一块 B′ 被剧情换过，并不进去。
            b3: {edit: null, remove: null, split: null, mergeUp: "story", addAfter: null},
        });
        expect(all.first).toBeNull();
        expect(all.blocks.get("b1")!.remove).toEqual({kind: "story", changes: ["c2"]});
    });

    it("最前面是剧情加出来的块时，最前放不了；内核说不能改的块什么都做不了", () => {
        const head = read([{id: "b9", source: "X", write: "change", change: "c1", fixed: ["c1"], anchor: null}, free("b1", "甲", 0), {id: "b7", source: "不能改的", write: "none", fixed: []}]);
        const all = allowed(emptyDraft(head), head);
        expect(all.first).toEqual({kind: "before-story"});
        expect(all.blocks.get("b9")!.addAfter).toBeNull();
        expect(kinds(all.blocks.get("b7"))).toEqual({edit: "carried", remove: "carried", split: "carried", mergeUp: "carried", addAfter: "carried"});
        // 甲后面紧挨着的那块不在初值里：放不了。
        expect(all.blocks.get("b1")!.addAfter).toEqual({kind: "before-story"});
    });

    it("并到上一块：两块都没被碰过、在初值里相邻才行；第一块没有上一块；新块随便并", () => {
        const all = allowed(emptyDraft(PLAIN), PLAIN);
        expect(["b1", "b2", "b3"].map((key) => all.blocks.get(key)!.mergeUp?.kind ?? null)).toEqual(["first", null, null]);
        // 初值里 b1 与 b3 之间还有一块（这个位置上被剧情删了，看不到）：不相邻。
        const gap = read([free("b1", "甲", 0), free("b3", "丙", 2)]);
        expect(can(emptyDraft(gap), gap, "b3").mergeUp).toEqual({kind: "not-adjacent"});
        // 新块并进被剧情换过的块：等于改那一块的字，可以。
        const added = addAfter(emptyDraft(LAYERED), "b2");
        expect(can(added.draft, LAYERED, added.key)).toEqual({edit: null, remove: null, split: null, mergeUp: null, addAfter: null});
    });

    it("块 id 与对象自带的名字重合（constructor、__proto__、toString）照样当普通的块", () => {
        const odd = read([free("constructor", "甲", 0), free("__proto__", "乙", 1), free("toString", "丙", 2)]);
        let draft = emptyDraft(odd);
        expect([hasChanges(draft), allowed(draft, odd).blocks.size, textOf(draft, odd, "constructor")]).toEqual([false, 3, "甲"]);
        for (const id of ["constructor", "__proto__", "toString"]) draft = setText(draft, odd, id, `${textOf(draft, odd, id)}改`);
        expect([changedCount(draft), rebase(draft, odd).conflicts]).toEqual([3, []]);
        expect(compile(draft, odd, "e1").ops).toEqual([
            {op: "set", at: {entry: "e1", path: "text[constructor]"}, value: "甲改", read: "甲"},
            {op: "set", at: {entry: "e1", path: "text[__proto__]"}, value: "乙改", read: "乙"},
            {op: "set", at: {entry: "e1", path: "text[toString]"}, value: "丙改", read: "丙"},
        ]);
        // 存进记录再读出来（一次 JSON 往返）以后还是这三块。
        expect(compile(JSON.parse(JSON.stringify(draft)) as TextDraft, odd, "e1").ops.length).toBe(3);
        for (const id of ["constructor", "__proto__", "toString"]) draft = setText(draft, odd, id, textOf(emptyDraft(odd), odd, id));
        expect(draft).toEqual(emptyDraft(odd));
    });
});

describe("author-ui 输出 39、45：块的操作与“有没有未提交的内容”", () => {
    it("改字再改回原样就不算动过；删掉可以恢复，删之前改的字还在", () => {
        const start = emptyDraft(PLAIN);
        const edited = setText(start, PLAIN, "b2", "乙改");
        expect([hasChanges(start), hasChanges(edited), changedCount(edited), textOf(edited, PLAIN, "b2")]).toEqual([false, true, 1, "乙改"]);
        expect(setText(edited, PLAIN, "b2", "乙")).toEqual(start);
        const removed = removeBlock(edited, PLAIN, "b2");
        expect([removed.removed, can(removed, PLAIN, "b2").edit]).toEqual([["b2"], {kind: "removed"}]);
        expect(restoreBlock(removed, PLAIN, "b2")).toEqual(edited);
        // 没改过字就删、再恢复：回到没动过。
        expect(restoreBlock(removeBlock(start, PLAIN, "b2"), PLAIN, "b2")).toEqual(start);
    });

    it("从光标处拆开：前半留在原块，后半成新的一块，切口两边的空行不留；再并回去等于没动过", () => {
        const source = read([free("b1", "第一段。\n\n第二段。", 0), free("b2", "乙", 1)]);
        const split = splitAt(emptyDraft(source), source, "b1", "第一段。\n".length);
        expect(split.draft.order).toEqual(["b1", split.key, "b2"]);
        expect([isNewKey(split.key), textOf(split.draft, source, "b1"), textOf(split.draft, source, split.key)]).toEqual([true, "第一段。", "第二段。"]);
        const merged = mergeUp(split.draft, source, split.key);
        expect(merged?.into).toBe("b1");
        expect(merged?.draft).toEqual(emptyDraft(source));
        expect(mergeUp(emptyDraft(source), source, "b1")).toBeNull();
    });

    it("并到上一块中间空一行；恢复并掉的那一块时，并过去的那段字从上一块拿回来，不留在两块里", () => {
        const joined = mergeUp(emptyDraft(PLAIN), PLAIN, "b2")!;
        expect([textOf(joined.draft, PLAIN, "b1"), joined.draft.removed]).toEqual(["甲\n\n乙", ["b2"]]);
        expect(restoreBlock(joined.draft, PLAIN, "b2")).toEqual(emptyDraft(PLAIN));
        // 并了以后上一块又改过、已经不是以那段字结尾了：恢复只撤掉删除，上一块不动。
        const reworked = setText(joined.draft, PLAIN, "b1", "甲与乙揉在一起改过的一段。");
        const restored = restoreBlock(reworked, PLAIN, "b2");
        expect([restored.removed, textOf(restored, PLAIN, "b1"), textOf(restored, PLAIN, "b2")]).toEqual([[], "甲与乙揉在一起改过的一段。", "乙"]);
    });

    it("空的新块不算有未提交的内容；写了字才算", () => {
        const blankBlock = addAfter(emptyDraft(PLAIN), "b1");
        expect([hasChanges(blankBlock.draft), changedCount(blankBlock.draft)]).toEqual([false, 0]);
        const typed = setText(blankBlock.draft, PLAIN, blankBlock.key, "新的");
        expect([hasChanges(typed), changedCount(typed)]).toEqual([true, 1]);
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

    it("别处在同一处加了剧情块：我的新块排到它后面，照样编得进去（内核里改设定的块就排在那里）", () => {
        const first = addAfter(emptyDraft(PLAIN), "b1", "新一");
        const second = addAfter(first.draft, first.key, "新二");
        const head = addAfter(second.draft, null, "开头");
        const fresh = read([{id: "b8", source: "开头的剧情块", write: "change", change: "c8", fixed: ["c8"], anchor: null}, {id: "b1", source: "甲", write: "init", fixed: ["c9"], anchor: "b1", init: 0}, {id: "b9", source: "X", write: "change", change: "c9", fixed: ["c9"], anchor: "b1"}, free("b2", "乙", 1), free("b3", "丙", 2)], 2);
        const result = rebase(head.draft, fresh);
        expect([result.conflicts, result.draft.order]).toEqual([[], ["b8", head.key, "b1", "b9", first.key, second.key, "b2", "b3"]]);
        const compiled = compile(result.draft, fresh, "e1");
        expect([[...compiled.problems], compiled.ops]).toEqual([[], [
            {op: "addBlock", entry: "e1", source: "开头", after: null},
            {op: "addBlock", entry: "e1", source: "新一", after: "b1"},
            {op: "addBlock", entry: "e1", source: "新二", after: "b1"},
        ]]);
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

    it("改了字的块写回的地方换了（别处用同样的字在剧情里换了它）：原文没变也要问；选我的就认下新的地方，选现在的就不改", () => {
        const draft = setText(emptyDraft(PLAIN), PLAIN, "b1", "甲（我的）");
        const fresh = read([replaced("b1", "甲", 0), free("b2", "乙", 1), free("b3", "丙", 2)], 2);
        const result = rebase(draft, fresh);
        expect(result.conflicts).toEqual([{kind: "rerouted", key: "b1", mine: "甲（我的）", theirs: "甲", manual: false}]);
        const accepted = resolve(result.draft, fresh, result.conflicts[0]!, "mine");
        expect([rebase(accepted, fresh).conflicts, compile(accepted, fresh, "e1").ops]).toEqual([[], [{op: "set", at: {entry: "e1", path: "text[b1]"}, value: "甲（我的）", read: "甲"}]]);
        expect(resolve(result.draft, fresh, result.conflicts[0]!, "theirs")).toEqual(emptyDraft(PLAIN));
        // 只是有剧情块挂到它后面（改字还是写进初值）：不问。
        const anchored = read([{id: "b1", source: "甲", write: "init", fixed: ["c9"], anchor: "b1", init: 0}, {id: "b9", source: "X", write: "change", change: "c9", fixed: ["c9"], anchor: "b1"}, free("b2", "乙", 1), free("b3", "丙", 2)], 2);
        expect(rebase(draft, anchored).conflicts).toEqual([]);
    });

    it("拆过、并过的块写回的地方换了：没有能自动做的选择，稿原样留着等作者整理；只是改字的块照常能选", () => {
        const source = read([free("b1", "前半。\n\n后半。", 0), free("b2", "乙", 1), free("b3", "丙", 2)]);
        const split = splitAt(setText(emptyDraft(source), source, "b2", "乙改"), source, "b1", "前半。".length);
        const fresh = read([replaced("b1", "前半。\n\n后半。", 0), replaced("b2", "乙", 1, "c6"), free("b3", "丙", 2)], 2);
        const result = rebase(split.draft, fresh);
        expect(result.conflicts).toEqual([
            {kind: "rerouted", key: "b2", mine: "乙改", theirs: "乙", manual: false},
            {kind: "rerouted", key: "b1", mine: "前半。", theirs: "前半。\n\n后半。", manual: true, structural: true},
        ]);
        for (const choice of ["mine", "theirs", "keep", "drop"] as const) expect(resolve(result.draft, fresh, result.conflicts[1]!, choice)).toEqual(result.draft);
        // 作者回去把拆出来的并回去：这一块回到原样，冲突没有了。
        const tidied = mergeUp(result.draft, fresh, split.key)!.draft;
        expect(rebase(tidied, fresh).conflicts.map((conflict) => conflict.key)).toEqual(["b2"]);

        // 并掉的那一块别处改了：标成与别的块换过文字，选完以后要作者再看一眼。
        const merged = mergeUp(emptyDraft(PLAIN), PLAIN, "b2")!.draft;
        const changed = read([free("b1", "甲", 0), free("b2", "乙（别处改了）", 1), free("b3", "丙", 2)], 2);
        expect(rebase(merged, changed).conflicts).toEqual([{kind: "changed", key: "b2", mine: null, theirs: "乙（别处改了）", structural: true}]);
    });

    it("新块并进被剧情换过的块只是给它加字：不算换过文字，照常提交", () => {
        const added = addAfter(emptyDraft(LAYERED), "b2", "新写的一段。");
        const merged = mergeUp(added.draft, LAYERED, added.key)!;
        expect([merged.into, merged.draft.moved, rebase(merged.draft, LAYERED).conflicts]).toEqual(["b2", undefined, []]);
        expect(compile(merged.draft, LAYERED, "e1").ops).toEqual([{op: "set", at: {entry: "e1", path: "text[b2]"}, value: "B′\n\n新写的一段。", read: "B′"}]);
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
        expect([[...compiled.problems], compiled.tooMany]).toEqual([[], false]);
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
        expect(Object.fromEntries(compiled.problems)).toEqual({[blockedSlot.key]: {kind: "before-story"}, b2: {kind: "story", changes: ["c1"]}});
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
