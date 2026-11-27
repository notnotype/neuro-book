/**
 * 主文字的块（docs/specs/canon/revisions.md 输出 25 的“主文字的块”、project.md 的 `textBlocks`）：加块放在哪、同一处几项的先后，
 * 删块的拒收，校验细项的序号，以及按块给出“能怎么改”的读取与写入实际的行为是不是同一回事。都经真实的 `WorldService`、写队列与
 * 分段日志。
 */

import {readdir, readFile} from "node:fs/promises";
import {join} from "node:path";

import {describe, expect, test} from "bun:test";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {buildRegistry, type EntryOp, type Patch, type Placement, type ReadPosition, type TextBlockInfo, type WriteRequest} from "../src/index";
import {openTestService} from "./fixtures/service";

const CHAPTERS = ["ch1", "ch2", "ch3"];
const author = {kind: "author"} as const;
let sequence = 0;
const id = () => `req-${String(++sequence)}`;
const end = (chapter: string): ReadPosition => ({kind: "chapter", chapter, edge: "end"});
const start = (chapter: string): ReadPosition => ({kind: "chapter", chapter, edge: "start"});

type Service = Awaited<ReturnType<typeof openTestService>>;

/** 一个世界与里面的一个条目（主文字按 `text` 各是一块，编号 b1 起）。 */
async function open(label: string, text: readonly string[]) {
    const root = await createTestTmpRoot("nb-canon-text-blocks", label);
    const world = await openTestService(root, {texts: new Map(CHAPTERS.map((chapter) => [chapter, ""])), chapters: CHAPTERS, registry: buildRegistry([])});
    const seeded = await world.editEntries({requestId: id(), by: author, what: "edit", title: "开局", ops: [{op: "create", id: "tmp:e", entry: {name: "条目", kind: "设定", text: [...text]}}]});
    if (!seeded.ok) throw new Error(JSON.stringify(seeded.failure));
    const entry = seeded.ids["tmp:e"]!;
    const input = (intent: "creative" | "story", position: ReadPosition, ops: EntryOp[]) => ({requestId: id(), by: author, what: "edit" as const, title: "改", baseVersion: world.status().version, position, intent, ops});
    return {
        root,
        world,
        entry,
        at: (block: string) => ({entry, path: `text[${block}]`}),
        edit: (intent: "creative" | "story", position: ReadPosition, ops: EntryOp[]) => world.editEntries(input(intent, position, ops)),
        preview: (intent: "creative" | "story", position: ReadPosition, ops: EntryOp[]) => world.previewEntries(input(intent, position, ops)),
        /** 这个位置上各块的 `[编号, 原文]`。 */
        text: (position: ReadPosition) => {
            const read = world.entry(entry, position, "actual");
            if (typeof read === "string" || read.view === null) throw new Error("读不到条目");
            return read.view.text.map((block) => [block.id, block.source]);
        },
        blocks: (position: ReadPosition): readonly TextBlockInfo[] => {
            const read = world.textBlocks(entry, position);
            if (read === null || typeof read === "string") throw new Error(`读不到块：${String(read)}`);
            return read.blocks;
        },
        /** 直接发布一条剧情变更（待定的、计划的、前史的经一次改几处写不出来）。 */
        change: async (at: Placement, patches: Patch[], extra: Record<string, unknown> = {}): Promise<string> => {
            const tmp = `tmp:c${String(++sequence)}`;
            const result = await world.publish({requestId: id(), by: author, what: "edit", title: "记", baseVersion: world.status().version, puts: [{ref: {kind: "change", id: tmp}, after: {id: tmp, kind: "written", text: "记", at, told: [], involves: [entry], lines: [], links: [], patches, status: "active", by: author, ...extra}}]} as WriteRequest);
            if (!result.ok) throw new Error(JSON.stringify(result.failure));
            return result.ids[tmp]!;
        },
    };
}

function ok<T extends {ok: boolean}>(result: T): Extract<T, {ok: true}> {
    if (!result.ok) throw new Error(JSON.stringify((result as {failure?: unknown}).failure));
    return result as Extract<T, {ok: true}>;
}

function failure(result: {ok: boolean; failure?: unknown}): {code: string; op?: number; problems?: Array<{code: string; path?: string; op?: number; reason?: string}>} {
    if (result.ok) throw new Error("本该拒收");
    return result.failure as never;
}

/** 日志里已经有几行（一行一次修订）。 */
async function logLines(root: string): Promise<number> {
    const dir = join(root, ".nbook", "world", "log");
    const files = (await readdir(dir)).filter((file) => file.endsWith(".jsonl"));
    const lines = await Promise.all(files.map(async (file) => (await readFile(join(dir, file), "utf8")).split("\n").filter((line) => line.trim() !== "").length));
    return lines.reduce((sum, count) => sum + count, 0);
}

describe("canon.revisions 输出 25：主文字的块", () => {
    test("改设定加块：after 写 null 放在最前，不写放在最后；同一处的几项按写的先后排", async () => {
        const scene = await open("creative-order", ["A", "B"]);
        try {
            ok(await scene.edit("creative", end("ch3"), [
                {op: "addBlock", entry: scene.entry, source: "头一", after: null},
                {op: "addBlock", entry: scene.entry, source: "头二", after: null},
                {op: "addBlock", entry: scene.entry, source: "甲", after: "b1"},
                {op: "addBlock", entry: scene.entry, source: "乙", after: "b1"},
                {op: "addBlock", entry: scene.entry, source: "尾一"},
                {op: "addBlock", entry: scene.entry, source: "尾二"},
            ]));
            expect(scene.text(end("ch3")).map(([, source]) => source)).toEqual(["头一", "头二", "A", "甲", "乙", "B", "尾一", "尾二"]);
            // 初值里就是这个顺序：更早的位置读到的一样。
            expect(scene.text({kind: "initial"}).map(([, source]) => source)).toEqual(["头一", "头二", "A", "甲", "乙", "B", "尾一", "尾二"]);
        } finally {
            await scene.world.stop();
        }
    });

    test("剧情变化加块：after 写 null 放在最前，不写放在这个位置上最后一块之后；同一处的几项按写的先后排", async () => {
        const scene = await open("story-order", ["A", "B"]);
        try {
            ok(await scene.edit("story", end("ch2"), [
                {op: "addBlock", entry: scene.entry, source: "头一", after: null},
                {op: "addBlock", entry: scene.entry, source: "头二", after: null},
                {op: "addBlock", entry: scene.entry, source: "甲", after: "b1"},
                {op: "addBlock", entry: scene.entry, source: "乙", after: "b1"},
                {op: "addBlock", entry: scene.entry, source: "尾一"},
                {op: "addBlock", entry: scene.entry, source: "尾二"},
            ]));
            expect(scene.text(end("ch2")).map(([, source]) => source)).toEqual(["头一", "头二", "A", "甲", "乙", "B", "尾一", "尾二"]);
            // 这是第 2 章的剧情：之前的位置没有这些块。
            expect(scene.text(end("ch1")).map(([, source]) => source)).toEqual(["A", "B"]);
        } finally {
            await scene.world.stop();
        }
    });

    test("不写 after 的与写了的混在一批里：两种意图排出来的顺序相同", async () => {
        for (const intent of ["creative", "story"] as const) {
            const scene = await open(`mixed-${intent}`, ["A", "B"]);
            try {
                // 甲放最后；乙挂在 B（此刻的最后一块）后面，所以在甲前面；丙再放最后；丁挂在 A 后面。
                ok(await scene.edit(intent, end("ch2"), [
                    {op: "addBlock", entry: scene.entry, source: "甲"},
                    {op: "addBlock", entry: scene.entry, source: "乙", after: "b2"},
                    {op: "addBlock", entry: scene.entry, source: "丙"},
                    {op: "addBlock", entry: scene.entry, source: "丁", after: "b1"},
                ]));
                expect({intent, text: scene.text(end("ch2")).map(([, source]) => source)}).toEqual({intent, text: ["A", "丁", "B", "乙", "甲", "丙"]});
            } finally {
                await scene.world.stop();
            }
        }
        for (const intent of ["creative", "story"] as const) {
            const scene = await open(`mixed-2-${intent}`, ["A", "B"]);
            try {
                // 先挂在最后一块后面、再不写：后一项在它后面。
                ok(await scene.edit(intent, end("ch2"), [{op: "addBlock", entry: scene.entry, source: "甲", after: "b2"}, {op: "addBlock", entry: scene.entry, source: "乙"}]));
                expect({intent, text: scene.text(end("ch2")).map(([, source]) => source)}).toEqual({intent, text: ["A", "B", "甲", "乙"]});
            } finally {
                await scene.world.stop();
            }
        }
    });

    test("改设定删初值的块：有剧情加出来的块挂在它后面时拒收，世界与日志不动；那条变更撤销以后可以删", async () => {
        const scene = await open("remove-anchor", ["A", "B"]);
        try {
            const added = ok(await scene.edit("story", end("ch2"), [{op: "addBlock", entry: scene.entry, source: "X", after: "b1"}]));
            const change = added.ids["tmp:edit"]!;
            expect(scene.text(end("ch3"))).toEqual([["b1", "A"], ["b3", "X"], ["b2", "B"]]);
            const [version, lines] = [scene.world.status().version, await logLines(scene.root)];
            const refused = failure(await scene.edit("creative", end("ch3"), [{op: "removeBlock", at: scene.at("b1")}]));
            expect(refused.problems?.[0]).toMatchObject({code: "element-from-change", path: "ops[0]", reason: change});
            expect([scene.world.status().version, await logLines(scene.root)]).toEqual([version, lines]);
            expect(scene.text(end("ch3"))).toEqual([["b1", "A"], ["b3", "X"], ["b2", "B"]]);
            // 没有东西挂在 B 后面：照常能删，剧情加出来的块不受影响。
            ok(await scene.edit("creative", end("ch3"), [{op: "removeBlock", at: scene.at("b2")}]));
            expect(scene.text(end("ch3"))).toEqual([["b1", "A"], ["b3", "X"]]);
        } finally {
            await scene.world.stop();
        }
    });

    test("别的世界线上的变更碰过的块同样不能删：初值是各条线共用的", async () => {
        const scene = await open("other-line", ["A", "B", "C"]);
        try {
            // 第 1 章的一条变更作切口，从它分出子线；子线的第 2 章把 X 挂在 A 后面、把 B 整块换掉。
            const cut = await scene.change({kind: "chapter", chapter: "ch1", key: 0}, []);
            const forked = await scene.world.publish({requestId: id(), by: author, what: "edit", title: "分叉", baseVersion: scene.world.status().version, puts: [{ref: {kind: "change", id: "tmp:fork"}, after: {id: "tmp:fork", kind: "written", text: "分叉", at: {kind: "chapter", chapter: "ch2", key: 0}, told: [], involves: [], lines: [], links: [], patches: [], status: "active", by: author, nature: "fork", fork: {line: "tmp:line", name: "支线", parent: "main", cut, type: "branch"}}}]} as WriteRequest);
            if (!forked.ok) throw new Error(JSON.stringify(forked.failure));
            const line = forked.ids["tmp:line"]!;
            const branch = await scene.change({kind: "chapter", chapter: "ch2", key: 5, line}, [{op: "addBlock", at: scene.at("b9"), value: {after: "b1", source: "X"}}, {op: "replaceBlock", at: scene.at("b2"), value: "B′"}]);
            const onBranch: ReadPosition = {kind: "chapter", chapter: "ch3", edge: "end", line};
            expect(scene.text(onBranch).map(([, source]) => source)).toEqual(["A", "X", "B′", "C"]);
            // 主线上读不到那条变更，A 与 B 的原文也没变；但它们被子线的变更碰过。
            const main: ReadPosition = {kind: "chapter", chapter: "ch3", edge: "end", line: "main"};
            expect(scene.blocks(main).map((block) => [block.source, block.write, block.fixed])).toEqual([["A", "init", [branch]], ["B", "init", [branch]], ["C", "init", []]]);
            for (const block of ["b1", "b2"]) {
                const refused = failure(await scene.edit("creative", main, [{op: "removeBlock", at: scene.at(block)}]));
                expect(refused.problems?.[0]).toMatchObject({code: "element-from-change", reason: branch});
            }
            expect(scene.text(onBranch).map(([, source]) => source)).toEqual(["A", "X", "B′", "C"]);
            ok(await scene.edit("creative", main, [{op: "removeBlock", at: scene.at("b3")}]));
            expect(scene.text(onBranch).map(([, source]) => source)).toEqual(["A", "X", "B′"]);
        } finally {
            await scene.world.stop();
        }
    });

    test("还原加了一块的那次改设定：后面有剧情加出来的块挂在它后面时报有依赖，不让那一块连带消失", async () => {
        const scene = await open("revert-anchor", ["A"]);
        try {
            const added = ok(await scene.edit("creative", end("ch3"), [{op: "addBlock", entry: scene.entry, source: "B"}]));
            const story = ok(await scene.edit("story", end("ch2"), [{op: "addBlock", entry: scene.entry, source: "X"}]));
            expect(scene.text(end("ch3"))).toEqual([["b1", "A"], ["b2", "B"], ["b3", "X"]]);
            const refused = await scene.world.revert(added.revision.id, false, {requestId: id(), by: author, title: "还原"});
            expect(refused.ok === false && refused.failure).toMatchObject({code: "has-dependents"});
            expect(JSON.stringify(refused.ok === false ? refused.failure : null)).toContain(story.revision.id);
            expect(scene.text(end("ch3"))).toEqual([["b1", "A"], ["b2", "B"], ["b3", "X"]]);
            // 连同后面的一起还原：两块都没了，不留下套不上的变更。
            const both = await scene.world.revert(added.revision.id, true, {requestId: id(), by: author, title: "一起还原"});
            expect(both.ok).toBe(true);
            expect(scene.text(end("ch3"))).toEqual([["b1", "A"]]);
        } finally {
            await scene.world.stop();
        }
    });

    test("已删除的条目上加块、删块：拒收并带是第几项，世界不动", async () => {
        const scene = await open("deleted", ["A", "B"]);
        try {
            ok(await scene.edit("creative", end("ch3"), [{op: "delete", entry: scene.entry}]));
            const version = scene.world.status().version;
            for (const intent of ["creative", "story"] as const) {
                expect(failure(await scene.edit(intent, end("ch3"), [{op: "removeBlock", at: scene.at("b2")}]))).toMatchObject({code: "field-unavailable", op: 0});
                expect(failure(await scene.edit(intent, end("ch3"), [{op: "addBlock", entry: scene.entry, source: "Z"}]))).toMatchObject({code: "field-unavailable", op: 0});
            }
            expect(scene.world.status().version).toBe(version);
            // 恢复以后块都还在。
            ok(await scene.edit("creative", end("ch3"), [{op: "restore", entry: scene.entry}]));
            expect(scene.text(end("ch3"))).toEqual([["b1", "A"], ["b2", "B"]]);
        } finally {
            await scene.world.stop();
        }
    });

    test("块的原文没过校验：细项带是第几项（加进初值、写回旧变更的补丁、新记的剧情变化），整批不发布", async () => {
        const scene = await open("locate", ["A", "B"]);
        try {
            ok(await scene.edit("story", end("ch2"), [{op: "addBlock", entry: scene.entry, source: "X", after: "b1"}]));
            const [version, lines] = [scene.world.status().version, await logLines(scene.root)];
            const bad = "没写完的 <V of=\"panel.a\" 标签";
            // 第 0 项合法，第 1 项加进初值的块不合法。
            const intoInit = failure(await scene.edit("creative", end("ch3"), [{op: "set", at: scene.at("b2"), value: "B 改"}, {op: "addBlock", entry: scene.entry, source: bad, after: "b2"}]));
            expect(intoInit.code).toBe("validation-failed");
            expect(intoInit.problems?.map((problem) => problem.op)).toEqual([1]);
            // 第 1 项改的是第 2 章那条变更加出来的块：写回它的补丁。
            const intoPatch = failure(await scene.edit("creative", end("ch3"), [{op: "set", at: scene.at("b2"), value: "B 改"}, {op: "set", at: scene.at("b3"), value: bad}]));
            expect(intoPatch.problems?.map((problem) => problem.op)).toEqual([1]);
            // 剧情变化：两项合成一条新变更的两个补丁，第 1 个不合法。
            const intoStory = failure(await scene.edit("story", end("ch3"), [{op: "set", at: scene.at("b2"), value: "B 在第 3 章"}, {op: "addBlock", entry: scene.entry, source: bad}]));
            expect(intoStory.problems?.map((problem) => problem.op)).toEqual([1]);
            expect([scene.world.status().version, await logLines(scene.root)]).toEqual([version, lines]);
        } finally {
            await scene.world.stop();
        }
    });
});

describe("canon.project 的 textBlocks：主文字的块能怎么改", () => {
    /** 初值 A、B、C；第 2 章把 B 整块换掉、在 A 后面加 X；第 3 章在 X 后面加 Y。第 3 章末尾是 A、X、Y、B′、C。 */
    async function layered(label: string) {
        const scene = await open(label, ["A", "B", "C"]);
        const replaced = ok(await scene.edit("story", end("ch2"), [{op: "set", at: scene.at("b2"), value: "B′"}])).ids["tmp:edit"]!;
        const addedX = ok(await scene.edit("story", end("ch2"), [{op: "addBlock", entry: scene.entry, source: "X", after: "b1"}])).ids["tmp:edit"]!;
        const addedY = ok(await scene.edit("story", end("ch3"), [{op: "addBlock", entry: scene.entry, source: "Y", after: "b4"}])).ids["tmp:edit"]!;
        return {...scene, replaced, addedX, addedY};
    }

    test("每块给出：改字写到哪、碰过它的变更、放在它后面该写的锚点、在初值里是第几块", async () => {
        const scene = await layered("facts");
        try {
            expect(scene.blocks(end("ch3"))).toEqual([
                {id: "b1", source: "A", write: "init", fixed: [scene.addedX], anchor: "b1", init: 0},
                {id: "b4", source: "X", write: "change", change: scene.addedX, fixed: [scene.addedX, scene.addedY], anchor: "b1"},
                {id: "b5", source: "Y", write: "change", change: scene.addedY, fixed: [scene.addedY], anchor: "b1"},
                {id: "b2", source: "B′", write: "change", change: scene.replaced, fixed: [scene.replaced], anchor: "b2", init: 1},
                {id: "b3", source: "C", write: "init", fixed: [], anchor: "b3", init: 2},
            ]);
            // 第 1 章开头这些剧情还没发生：改 B 的字写进初值，但碰过它的变更照样列出来（删它那条变更就套不上）。
            expect(scene.blocks(start("ch1"))).toEqual([
                {id: "b1", source: "A", write: "init", fixed: [scene.addedX], anchor: "b1", init: 0},
                {id: "b2", source: "B", write: "init", fixed: [scene.replaced], anchor: "b2", init: 1},
                {id: "b3", source: "C", write: "init", fixed: [], anchor: "b3", init: 2},
            ]);
            // 读取戳与解析后的位置（写明线）随块一起给。
            const read = scene.world.textBlocks(scene.entry, end("ch3"));
            expect(read).toMatchObject({version: scene.world.status().version, at: {kind: "chapter", chapter: "ch3", edge: "end", line: "main"}});
            expect(typeof (read as {inputDigest?: unknown}).inputDigest).toBe("string");
        } finally {
            await scene.world.stop();
        }
    });

    test("write 就是改设定的 set 实际写回的地方", async () => {
        const scene = await layered("write");
        try {
            for (const position of [end("ch3"), start("ch1")]) {
                for (const block of scene.blocks(position)) {
                    const route = ok(scene.preview("creative", position, [{op: "set", at: scene.at(block.id), value: `${block.source}（改）`, read: block.source}])).routes[0];
                    expect({id: block.id, route}).toEqual({id: block.id, route: block.write === "init" ? {kind: "init"} : {kind: "patch", change: block.change ?? "", patch: 0}});
                }
            }
        } finally {
            await scene.world.stop();
        }
    });

    test("anchor 写进 addBlock：读回新块紧跟在那一块后面；剧情加出来的块前面放不进去，写它前面那块的锚点会排到它们后面", async () => {
        const scene = await layered("anchor");
        try {
            const blocks = scene.blocks(end("ch3"));
            const sources = () => scene.text(end("ch3")).map(([, source]) => source);
            // Y 后面是初值里的 B′：这一处表达得出来，用 Y 的锚点（追到 A）。
            ok(await scene.edit("creative", end("ch3"), [{op: "addBlock", entry: scene.entry, source: "新一", after: blocks[2]!.anchor!}]));
            expect(sources()).toEqual(["A", "X", "Y", "新一", "B′", "C"]);
            // A 与 X 之间表达不出来：A 的锚点也是它自己，同一个请求，新块同样排在 X、Y 之后。
            ok(await scene.edit("creative", end("ch3"), [{op: "addBlock", entry: scene.entry, source: "新二", after: blocks[0]!.anchor!}]));
            expect(sources()).toEqual(["A", "X", "Y", "新二", "新一", "B′", "C"]);
            ok(await scene.edit("creative", end("ch3"), [{op: "addBlock", entry: scene.entry, source: "新三", after: blocks[3]!.anchor!}, {op: "addBlock", entry: scene.entry, source: "新四", after: blocks[4]!.anchor!}]));
            expect(sources()).toEqual(["A", "X", "Y", "新二", "新一", "B′", "新三", "C", "新四"]);
        } finally {
            await scene.world.stop();
        }
    });

    test("主文字是空的时候剧情加出来的块：锚点是最前（null），改设定加在最前的块排在它后面", async () => {
        const scene = await open("head", []);
        try {
            ok(await scene.edit("story", end("ch2"), [{op: "addBlock", entry: scene.entry, source: "X"}]));
            const [x] = scene.blocks(end("ch3"));
            expect(x).toMatchObject({source: "X", write: "change", anchor: null});
            expect(x).not.toHaveProperty("init");
            ok(await scene.edit("creative", end("ch3"), [{op: "addBlock", entry: scene.entry, source: "设定", after: null}]));
            expect(scene.text(end("ch3")).map(([, source]) => source)).toEqual(["X", "设定"]);
        } finally {
            await scene.world.stop();
        }
    });

    const TOUCHES: ReadonlyArray<{readonly name: string; readonly at: Placement; readonly extra?: Record<string, unknown>; readonly removable: boolean}> = [
        {name: "后面的章整块换过它", at: {kind: "chapter", chapter: "ch3", key: 0}, removable: false},
        {name: "待定的变更换过它", at: {kind: "chapter", chapter: "ch3", key: 0}, extra: {status: "held", held: {reason: "unsure", note: "候选"}}, removable: false},
        {name: "计划换过它", at: {kind: "chapter", chapter: "ch3", key: 0}, extra: {kind: "plan"}, removable: false},
        {name: "前史换过它", at: {kind: "prehistory", order: 0}, removable: false},
        {name: "撤销了的变更换过它", at: {kind: "chapter", chapter: "ch3", key: 0}, extra: {status: "undone", undone: {reason: "写错了"}}, removable: true},
    ];
    for (const touch of TOUCHES) {
        test(`fixed 为空、块在初值里，当且仅当改设定删它发布得出去：${touch.name}`, async () => {
            const scene = await open(`fixed-${String(TOUCHES.indexOf(touch))}`, ["A", "B"]);
            try {
                await scene.change(touch.at, [{op: "replaceBlock", at: scene.at("b1"), value: "A′"}], touch.extra);
                // 在第 1 章开头读：这些变更都在它后面（或不算数），读到的原文还是初值。
                const blocks = scene.blocks(start("ch1"));
                expect(blocks.map((block) => [block.id, block.fixed.length === 0])).toEqual([["b1", touch.removable], ["b2", true]]);
                for (const block of blocks) {
                    const removed = scene.preview("creative", start("ch1"), [{op: "removeBlock", at: scene.at(block.id)}]);
                    expect({id: block.id, removed: removed.ok}).toEqual({id: block.id, removed: block.fixed.length === 0 && block.init !== undefined});
                    if (!removed.ok) expect(failure(removed).problems?.[0]?.code).toBe("element-from-change");
                }
            } finally {
                await scene.world.stop();
            }
        });
    }

    test("剧情加出来的块不在初值里：fixed 列出加它的变更，改设定删它被拒", async () => {
        const scene = await layered("story-added");
        try {
            for (const block of scene.blocks(end("ch3"))) {
                const removed = scene.preview("creative", end("ch3"), [{op: "removeBlock", at: scene.at(block.id)}]);
                expect({id: block.id, removed: removed.ok}).toEqual({id: block.id, removed: block.fixed.length === 0 && block.init !== undefined});
            }
        } finally {
            await scene.world.stop();
        }
    });

    test("带读取戳的写入：之间别处有任何写入就拒收、日志不动；重读后的戳通过；同一个请求原样重发拿回第一次的结果；被拒收的请求晚到仍被拒", async () => {
        const scene = await open("stamp", ["A", "B"]);
        try {
            const other = ok(await scene.world.editEntries({requestId: id(), by: author, what: "edit", title: "别的条目", ops: [{op: "create", id: "tmp:o", entry: {name: "别的", kind: "设定", text: ["O"]}}]})).ids["tmp:o"]!;
            const read = scene.world.textBlocks(scene.entry, end("ch3"));
            if (read === null || typeof read === "string") throw new Error("读不到块");
            const request = (requestId: string, from: typeof read) => ({requestId, by: author, what: "edit" as const, title: "改第一块", baseVersion: from.version, readStamp: {version: from.version, input: from.inputDigest}, position: from.at, intent: "creative" as const, ops: [{op: "set" as const, at: scene.at("b1"), value: "A 改", read: "A"}]});
            // 别处改了不相干的条目：按对象判的版本冲突拦不住（这次只写条目 e1），读取戳拦得住。
            ok(await scene.world.editEntries({requestId: id(), by: author, what: "edit", title: "改别的", baseVersion: scene.world.status().version, position: end("ch3"), ops: [{op: "set", at: {entry: other, path: "text[b1]"}, value: "O 改"}]}));
            const [version, lines] = [scene.world.status().version, await logLines(scene.root)];
            expect(failure(await scene.world.editEntries(request("first", read)))).toMatchObject({code: "stale-read", inputChanged: false, revisions: [{title: "改别的"}]});
            expect([scene.world.status().version, await logLines(scene.root), scene.text(end("ch3"))]).toEqual([version, lines, [["b1", "A"], ["b2", "B"]]]);

            const fresh = scene.world.textBlocks(scene.entry, end("ch3"));
            if (fresh === null || typeof fresh === "string") throw new Error("读不到块");
            const done = ok(await scene.world.editEntries(request("second", fresh)));
            expect([done.revision.version, scene.text(end("ch3"))]).toEqual([version + 1, [["b1", "A 改"], ["b2", "B"]]]);
            // 原样重发：先判请求 id，不因为世界已经前进而被读取戳拦下，也不多出一条修订。
            const again = ok(await scene.world.editEntries(request("second", fresh)));
            expect([again.repeated, again.revision.id, await logLines(scene.root)]).toEqual([true, done.revision.id, lines + 1]);
            // 被拒收的那个请求晚到（同一个 id、同一个戳）：仍被拒，不会补发布。
            expect(failure(await scene.world.editEntries(request("first", read))).code).toBe("stale-read");
            expect(await logLines(scene.root)).toBe(lines + 1);
        } finally {
            await scene.world.stop();
        }
    });

    test("两条线上各有一块同号的块、挂在不同的地方：读哪条线，锚点就沿那条线上加它的变更追；照着它加的块落在那条线的那一块后面", async () => {
        const scene = await open("anchor-lines", ["A", "B", "C"]);
        try {
            // 第 1 章定一个分叉点，第 2 章从它分出一条支线。之后两条线各经底层发布加一块 b9：支线挂在 A 后面，主线挂在 B 后面。
            const cut = await scene.change({kind: "chapter", chapter: "ch1", key: 0}, []);
            await scene.change({kind: "chapter", chapter: "ch2", key: 0}, [], {nature: "fork", fork: {line: "tmp:line", name: "支线", parent: "main", cut, type: "branch"}});
            const line = scene.world.lines().lines.find((item) => item.id !== "main")!.id;
            const onBranch = await scene.change({kind: "chapter", chapter: "ch2", key: 5, line}, [{op: "addBlock", at: scene.at("b9"), value: {after: "b1", source: "支线 X"}}]);
            const onMain = await scene.change({kind: "chapter", chapter: "ch2", key: 5}, [{op: "addBlock", at: scene.at("b9"), value: {after: "b2", source: "主线 X"}}]);
            const branchEnd: ReadPosition = {...end("ch3"), line};
            const b9 = (position: ReadPosition) => scene.blocks(position).find((block) => block.id === "b9");
            expect(b9(branchEnd)).toMatchObject({source: "支线 X", write: "change", change: onBranch, anchor: "b1"});
            expect(b9(end("ch3"))).toMatchObject({source: "主线 X", write: "change", change: onMain, anchor: "b2"});

            // 作者在支线上把一块新的设定放在“支线 X”后面：照读到的锚点写，支线上它紧跟在支线 X 的那一处，不跑到 B 后面去。
            ok(await scene.edit("creative", branchEnd, [{op: "addBlock", entry: scene.entry, source: "跟在 X 后面", after: b9(branchEnd)!.anchor!}]));
            expect(scene.text(branchEnd).map(([, source]) => source)).toEqual(["A", "支线 X", "跟在 X 后面", "B", "C"]);
        } finally {
            await scene.world.stop();
        }
    });

    test("同一条变更里先加、删掉、再加同一个编号的块：锚点取现在在的那一份", async () => {
        const scene = await open("re-add", ["A", "B", "C"]);
        try {
            await scene.change({kind: "chapter", chapter: "ch2", key: 5}, [
                {op: "addBlock", at: scene.at("b9"), value: {after: "b1", source: "第一次"}},
                {op: "removeBlock", at: scene.at("b9"), value: null},
                {op: "addBlock", at: scene.at("b9"), value: {after: "b2", source: "第二次"}},
            ]);
            expect(scene.text(end("ch3")).map(([, source]) => source)).toEqual(["A", "B", "第二次", "C"]);
            expect(scene.blocks(end("ch3")).find((block) => block.id === "b9")).toMatchObject({source: "第二次", anchor: "b2"});
        } finally {
            await scene.world.stop();
        }
    });

    test("剧情里一块接一块往后补了 150 块：每块的锚点都追到初值的那一块，一次读取不随块数平方变慢", async () => {
        const scene = await open("anchor-chain", ["A", "B"]);
        try {
            const count = 150;
            // 第 2 章里一条条变更各加一块：x0 挂在 B 后面，x1 挂在 x0 后面……每块的锚点是上一块，链长 150。
            for (let index = 0; index < count; index += 1) {
                await scene.change({kind: "chapter", chapter: "ch2", key: 5 + index}, [{op: "addBlock", at: scene.at(`x${String(index)}`), value: {after: index === 0 ? "b2" : `x${String(index - 1)}`, source: `第 ${String(index + 1)} 段`}}]);
            }
            const started = performance.now();
            const blocks = scene.blocks(end("ch3"));
            const elapsed = performance.now() - started;
            expect(blocks.map((block) => block.id)).toEqual(["b1", "b2", ...Array.from({length: count}, (_, index) => `x${String(index)}`)]);
            expect(blocks.slice(2).filter((block) => block.anchor !== "b2" || block.write !== "change")).toEqual([]);
            // 每块读一次来历时不到 0.1 秒；逐块沿链重读（平方次）在这个规模上是 4 秒多（去掉两处记忆实测）。界线放在两者之间。
            expect(elapsed).toBeLessThan(1500);
        } finally {
            await scene.world.stop();
        }
    }, 30_000);

    test("条目不存在或已删除为 null；位置的章不在是 chapter-not-found", async () => {
        const scene = await open("missing", ["A"]);
        try {
            expect(scene.world.textBlocks("e999", end("ch3"))).toBeNull();
            expect(scene.world.textBlocks(scene.entry, end("ch9"))).toBe("chapter-not-found");
            expect(scene.world.textBlocks(scene.entry, {kind: "chapter", chapter: "ch3", edge: "end", line: "l999"})).toBe("line-not-found");
            ok(await scene.edit("creative", end("ch3"), [{op: "delete", entry: scene.entry}]));
            expect(scene.world.textBlocks(scene.entry, end("ch3"))).toBeNull();
        } finally {
            await scene.world.stop();
        }
    });
});
