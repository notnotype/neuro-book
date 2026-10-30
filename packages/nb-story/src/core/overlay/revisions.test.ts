/**
 * 图的修订的公开方法（docs/specs/story/revisions.md 的方法表、输出 1 到 10、15、16、失败码 R1 到 R5）：
 * 临时书库里导入样例书，经 createStoryApi 调用。样例书有三条候选身份说法：s21-2、s27-6（后文已确认）、s30-13（一直待确认）。
 */

import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {readdir, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {openTestBook, type TestBook} from "../../../testing/api";
import {createStoryApi} from "../api";

let book: TestBook;
const AT = {chapter: 30, paragraph: 61};

beforeAll(async () => {
    book = await openTestBook("revisions");
});
afterAll(async () => {
    await book.close();
});

async function reset(): Promise<void> {
    const list = await book.ok("revisions.list", {at: {chapter: 100}});
    for (const item of list.items) if (item.undoable) await book.ok("revisions.undo", {revision: item.id});
}
const pendingIds = async (at = AT) => (await book.ok("revisions.list", {at, state: "pending"})).items.map(item => item.id);
const nodes = async () => (await book.ok("entities.list", {at: AT, limit: 500})).total;

describe("待确认列表与计数", () => {
    test("按阅读位置列出候选；book.info 的计数与列表一致；晚于阅读位置的不列", async () => {
        expect(await pendingIds()).toEqual(["st:s30-13"]);
        const list = await book.ok("revisions.list", {at: AT});
        expect(list.counts).toEqual({pending: 1, adopted: 0, rejected: 0, closed: 2, stale: 0});
        expect((await book.ok("book.info", {at: AT})).revisions).toEqual({pending: 1, stale: 0});
        expect(await pendingIds({chapter: 30, paragraph: 60})).toEqual([]);
        expect((await book.ok("book.info", {at: {chapter: 30, paragraph: 60}})).revisions).toEqual({pending: 0, stale: 0});
    });

    test("按对象筛（人物卡用）：只留涉及它的项，项带依据原文与涉及的对象；计数仍是全书的", async () => {
        const mine = await book.ok("revisions.list", {at: AT, entity: "e30-1"});
        expect(mine.items.map(item => item.id)).toEqual(["st:s30-13"]);
        expect(mine.items[0]).toMatchObject({entities: [{id: "e30-1"}, {id: "e10-1"}], evidence: "30.61"});
        expect(mine.items[0]!.entities.every(entity => entity.label.length > 0)).toBe(true);
        expect(mine.items[0]!.quote.length).toBeGreaterThan(0);
        expect(mine.counts.closed).toBe(2);
        expect((await book.ok("revisions.list", {at: AT, entity: "e3-2"})).items).toEqual([]);
    });

    test("依据段：对象在阅读位置之前出现的段，按位置从近到远，只含称呼出现的段", async () => {
        const page = await book.ok("revisions.evidence", {at: {chapter: 10, paragraph: 1}, entity: "e3-2", limit: 5});
        expect(page.items.length).toBeGreaterThan(0);
        const positions = page.items.map(item => item.ref.split(".").map(Number));
        expect(positions.every(([chapter]) => chapter! <= 10)).toBe(true);
        expect(positions).toEqual([...positions].sort((a, b) => b[0]! - a[0]! || b[1]! - a[1]!));
        expect(page.items.every(item => item.names.length > 0 && item.text.length > 0)).toBe(true);
    });
});

describe("确认、驳回与撤销", () => {
    test("确认：列在已处理，之后两个对象合成一个点；撤销后回到待确认、点数还原", async () => {
        const before = await nodes();
        const written = await book.ok("revisions.confirm", {statement: "s30-13"});
        expect(written.revision).toMatchObject({state: "adopted", op: "identity.confirm", source: "extraction", by: "user", undoable: true});
        expect(await pendingIds()).toEqual([]);
        expect(await nodes()).toBe(before - 1);
        const undone = await book.ok("revisions.undo", {revision: written.revision.id});
        expect(undone.revision).toMatchObject({id: "st:s30-13", state: "pending"});
        expect(await pendingIds()).toEqual(["st:s30-13"]);
        expect(await nodes()).toBe(before);
    });

    test("驳回：说法在记录里消失、列在已驳回；再确认时取代驳回，先前的决定留在历史里", async () => {
        const rejected = await book.ok("revisions.reject", {statement: "s30-13"});
        expect(rejected.revision.state).toBe("rejected");
        const statements = await book.ok("entity.statements", {at: AT, entity: "e30-1", limit: 500});
        expect(statements.items.some(item => item.id === "s30-13")).toBe(false);
        const confirmed = await book.ok("revisions.confirm", {statement: "s30-13"});
        expect(confirmed.revision.state).toBe("adopted");
        const list = await book.ok("revisions.list", {at: AT});
        expect(list.counts).toMatchObject({adopted: 1, rejected: 0, pending: 0});
        await reset();
    });

    test("驳回确定的身份说法（issue 266）：这条连线消失、列在已驳回、不进待确认；两个对象之间还有别的连线时要把它们都驳回才拆开；撤销还原", async () => {
        const card = async () => (await book.ok("entity.card", {at: AT, entity: "e1-1"})).identities;
        const before = await nodes();
        expect((await card()).find(item => item.id === "e6-2")?.statement).toBe("s6-25");
        expect(await pendingIds()).toEqual(["st:s30-13"]);

        // e1-1 与 e6-2 在阅读位置之前有两条确定的说法（s6-25、s8-11）：驳回一条后连线换成另一条，两个对象还在同一身份里
        const first = await book.ok("revisions.reject", {statement: "s6-25"});
        expect(first.revision).toMatchObject({state: "rejected", op: "identity.reject", undoable: true});
        expect((await card()).find(item => item.id === "e6-2")?.statement).toBe("s8-11");
        expect(await nodes()).toBe(before);
        expect(await pendingIds()).toEqual(["st:s30-13"]);
        const listed = await book.ok("revisions.list", {at: AT});
        expect(listed.items.find(item => item.id === first.revision.id)).toMatchObject({state: "rejected", op: "identity.reject"});
        expect(listed.counts).toMatchObject({rejected: 1, pending: 1, closed: 2});

        // 两条都驳回才拆开；候选 s21-2 原本因这些确定的说法算“后文已确认”，现在重新待确认
        const second = await book.ok("revisions.reject", {statement: "s8-11"});
        expect((await card()).map(item => item.id)).not.toContain("e6-2");
        expect(await nodes()).toBe(before + 1);
        expect(await pendingIds()).toEqual(["st:s21-2", "st:s30-13"]);

        await book.ok("revisions.undo", {revision: second.revision.id});
        await book.ok("revisions.undo", {revision: first.revision.id});
        expect((await card()).find(item => item.id === "e6-2")?.statement).toBe("s6-25");
        expect(await nodes()).toBe(before);
        expect(await pendingIds()).toEqual(["st:s30-13"]);
        await reset();
    });

    test("已处理（state=processed）是已采纳、已驳回、后文已确认三类；记录与同一身份里带“候选”“你确认的”标记", async () => {
        const markOf = async () => (await book.ok("entity.statements", {at: AT, entity: "e30-1", limit: 500})).items.find(item => item.id === "s30-13")?.mark;
        expect(await markOf()).toBe("candidate");
        await book.ok("revisions.confirm", {statement: "s30-13"});
        expect(await markOf()).toBe("confirmed");
        const processed = await book.ok("revisions.list", {at: AT, state: "processed"});
        expect(processed.items.map(item => item.state).sort()).toEqual(["adopted", "closed", "closed"]);
        const card = await book.ok("entity.card", {at: AT, entity: "e30-1"});
        expect(card.identities.map(item => item.mark).filter(Boolean)).toEqual(["confirmed"]);
        await reset();
        const link = await book.ok("revisions.link", {a: "e3-2", b: "e1-1", evidence: "10.1", certainty: "certain"});
        const added = await book.ok("entity.statements", {at: {chapter: 10, paragraph: 1}, entity: "e3-2", limit: 500});
        expect(added.items.find(item => item.text === link.revision.summary)?.mark).toBe("added");
        await reset();
    });

    test("同一个决定再做一次是空操作：版本不变", async () => {
        const first = await book.ok("revisions.confirm", {statement: "s30-13"});
        const again = await book.ok("revisions.confirm", {statement: "s30-13"});
        expect(again.revision.id).toBe(first.revision.id);
        expect(again.version).toBe(first.version);
        await reset();
    });

    test("同一个决定再做一次，返回的是原来那条决定，不是文件里最后一条修订；撤销用户自己的修订，返回的仍是完整的那一项", async () => {
        const first = await book.ok("revisions.confirm", {statement: "s30-13"});
        const link = await book.ok("revisions.link", {a: "e3-2", b: "e1-1", evidence: "10.1", certainty: "certain"});
        const again = await book.ok("revisions.confirm", {statement: "s30-13"});
        expect(again.revision.id).toBe(first.revision.id);
        expect(again.revision.summary).toBe(first.revision.summary);
        const undone = await book.ok("revisions.undo", {revision: link.revision.id});
        expect(undone.revision).toMatchObject({id: link.revision.id, state: "withdrawn", op: "identity.link", summary: link.revision.summary, undoable: false});
        expect(undone.revision.entities.map(entity => entity.id)).toEqual(["e3-2", "e1-1"]);
        expect(undone.revision.quote.length).toBeGreaterThan(0);
        await reset();
    });

    test("挪称呼：同一个称呼挪给同一个对象第二次是 revision_conflict（什么都不会变）", async () => {
        await book.ok("revisions.moveName", {text: "狐狐", from: "e1-1", to: "e3-2", evidence: "30.1"});
        expect(await book.fail("revisions.moveName", {text: "狐狐", from: "e1-1", to: "e3-2", evidence: "30.1"})).toBe("revision_conflict");
        await reset();
    });

    test("失败码：不是候选、没有这条说法、撤销了又撤销、没有这条修订、待确认项没有可撤销的", async () => {
        expect(await book.fail("revisions.confirm", {statement: "s8-11"})).toBe("revision_not_candidate");
        expect(await book.fail("revisions.reject", {statement: "s1-3"})).toBe("revision_not_candidate");
        expect(await book.fail("revisions.confirm", {statement: "s999-1"})).toBe("revision_target_not_found");
        const done = await book.ok("revisions.confirm", {statement: "s30-13"});
        await book.ok("revisions.undo", {revision: done.revision.id});
        expect(await book.fail("revisions.undo", {revision: done.revision.id})).toBe("revision_conflict");
        expect(await book.fail("revisions.undo", {revision: "r999"})).toBe("revision_not_found");
        expect(await book.fail("revisions.undo", {revision: "st:s30-13"})).toBe("revision_conflict");
    });
});

describe("手动连接、改种类、挪称呼", () => {
    test("连接：新说法按依据位置可见，依据之前看不到；列在已处理、可撤销", async () => {
        const written = await book.ok("revisions.link", {a: "e3-2", b: "e1-1", evidence: "10.1", certainty: "certain"});
        expect(written.revision).toMatchObject({op: "identity.link", state: "adopted", source: "user", evidence: "10.1"});
        expect(written.revision.summary).toMatch(/就是/u);
        const early = await book.ok("entity.statements", {at: {chapter: 9, paragraph: 50}, entity: "e3-2", limit: 500});
        expect(early.items.some(item => item.text === written.revision.summary)).toBe(false);
        const late = await book.ok("entity.statements", {at: {chapter: 10, paragraph: 1}, entity: "e3-2", limit: 500});
        expect(late.items.some(item => item.text === written.revision.summary)).toBe(true);
        await reset();
    });

    test("改种类：依据位置之前仍是马甲，之后是人物；种类没变是 revision_conflict", async () => {
        const kindOf = async (chapter: number, paragraph: number) => (await book.ok("entities.list", {at: {chapter, paragraph}, query: "风信子", limit: 5})).items.find(item => item.entities.includes("e3-2"))?.kind;
        // 第 4 章起风信子与南小风合成一个点（读者视角），所以在第 3 章里看这个对象。
        expect(await kindOf(3, 25)).toBe("persona");
        const written = await book.ok("revisions.kind", {entity: "e3-2", kind: "person", evidence: "3.20"});
        expect(written.revision.summary).toContain("人物");
        expect(await kindOf(3, 19)).toBe("persona");
        expect(await kindOf(3, 25)).toBe("person");
        expect(await book.fail("revisions.kind", {entity: "e3-2", kind: "person", evidence: "3.30"})).toBe("revision_conflict");
        await reset();
        expect(await kindOf(3, 25)).toBe("persona");
    });

    test("挪称呼与连接的失败码：同一个对象、依据不是已抽取的段、对象在依据之前还没出现、称呼不在 from 名下、名字对应不止一个", async () => {
        expect(await book.fail("revisions.link", {a: "e3-2", b: "e3-2", evidence: "10.1", certainty: "certain"})).toBe("revision_conflict");
        expect(await book.fail("revisions.link", {a: "e3-2", b: "e1-1", evidence: "999.1", certainty: "certain"})).toBe("evidence_invalid");
        expect(await book.fail("revisions.link", {a: "e3-2", b: "e1-1", evidence: "10", certainty: "certain"})).toBe("evidence_invalid");
        expect(await book.fail("revisions.link", {a: "e3-2", b: "e30-1", evidence: "10.1", certainty: "certain"})).toBe("revision_target_not_found");
        expect(await book.fail("revisions.moveName", {text: "不存在的称呼", from: "e1-1", to: "e3-2", evidence: "50.1"})).toBe("revision_target_not_found");
        expect(await book.fail("revisions.moveName", {text: "狐狐", from: "e1-1", to: "e1-1", evidence: "50.1"})).toBe("revision_conflict");
    });

    test("挪称呼：之后的出现指向 to，之前不变；撤销后还原", async () => {
        const before = await book.ok("entity.card", {at: {chapter: 40}, entity: "e3-2"});
        const written = await book.ok("revisions.moveName", {text: "狐狐", from: "e1-1", to: "e3-2", evidence: "30.1"});
        expect(written.revision.summary).toContain("狐狐");
        const after = await book.ok("entity.card", {at: {chapter: 40}, entity: "e3-2"});
        expect(after.names.some(name => name.text === "狐狐")).toBe(true);
        expect(before.names.some(name => name.text === "狐狐")).toBe(false);
        await book.ok("revisions.undo", {revision: written.revision.id});
        expect((await book.ok("entity.card", {at: {chapter: 40}, entity: "e3-2"})).names.some(name => name.text === "狐狐")).toBe(false);
    });
});

describe("版本、游标、持久", () => {
    test("写入让分页游标失效（cursor_invalid）；从第一页重取即可", async () => {
        const first = await book.ok("revisions.list", {at: {chapter: 100}, limit: 1});
        expect(first.next).not.toBeNull();
        const written = await book.ok("revisions.confirm", {statement: "s30-13"});
        expect(await book.fail("revisions.list", {at: {chapter: 100}, limit: 1, cursor: first.next!})).toBe("cursor_invalid");
        await book.ok("revisions.undo", {revision: written.revision.id});
    });

    test("另一个调用方（另一个 createStoryApi，相当于另一个进程）读到同样的修订；两次并发写入都保留", async () => {
        const other = createStoryApi({library: book.library});
        await Promise.all([book.ok("revisions.confirm", {statement: "s30-13"}), book.ok("revisions.link", {a: "e3-2", b: "e1-1", evidence: "10.1", certainty: "candidate"})]);
        const seen = await other.call("revisions.list", {at: {chapter: 100}});
        if (!seen.ok) throw new Error(seen.error.message);
        expect(seen.value.counts).toMatchObject({adopted: 2});
        await reset();
    });

    test("修订文件：损坏的最高版本跳过并回退，下一次写入换掉它；别的一代遗留的文件不会被读到", async () => {
        await book.ok("revisions.confirm", {statement: "s30-13"});
        const dir = join(book.library, "fox");
        const names = async () => (await readdir(dir)).filter(name => name.startsWith("revisions-")).sort();
        const version = Math.max(...(await names()).map(file => Number(/(\d+)/u.exec(file)![1])));
        await writeFile(join(dir, `revisions-${version + 1}.json`), "{坏的");
        expect((await book.ok("revisions.list", {at: AT})).counts.adopted).toBe(1);
        await writeFile(join(dir, `revisions-${version + 7}.json`), JSON.stringify({format: 1, generation: "别的一代", version: version + 7, items: []}));
        expect((await book.ok("revisions.list", {at: AT})).counts.adopted).toBe(1);
        const written = await book.ok("revisions.undo", {revision: (await book.ok("revisions.list", {at: AT, state: "adopted"})).items[0]!.id});
        expect(written.version).toBe(version + 1);
        await reset();
    });

    test("修订文件的格式版本不认识：读照常（按没有修订），写得到 unsupported_format，文件不动", async () => {
        const dir = join(book.library, "fox");
        const unknown = join(dir, "revisions-900.json");
        await writeFile(unknown, JSON.stringify({format: 2, generation: "x", version: 900, items: []}));
        expect((await book.ok("book.info", {})).revisions).toEqual({pending: 1, stale: 0});
        expect(await book.fail("revisions.confirm", {statement: "s30-13"})).toBe("unsupported_format");
        expect(JSON.parse(await readFile(unknown, "utf8")).format).toBe(2);
        await rm(unknown);
    });

    test("删书后同 id 重新导入：没有旧修订", async () => {
        await book.ok("revisions.confirm", {statement: "s30-13"});
        await book.ok("book.remove", {book: "fox"});
        const imported = await book.api.call("book.import", {file: join(book.root, "sample-100ch.json"), title: "again", id: "fox"});
        expect(imported.ok).toBe(true);
        expect((await book.ok("revisions.list", {at: AT})).counts.adopted).toBe(0);
        expect(await pendingIds()).toEqual(["st:s30-13"]);
    });
});
