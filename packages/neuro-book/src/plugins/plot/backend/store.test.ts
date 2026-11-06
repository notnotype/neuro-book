/**
 * 落盘的表（docs/specs/plot/checks.md 输入与边界）：用真实的分区库（SQLite）与真实的门面，不起插件宿主。重开一份 store 就是重启。
 */

import {afterAll, afterEach, beforeAll, describe, expect, test} from "bun:test";
import {Database} from "bun:sqlite";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {Type} from "typebox";

import {createPartitionOwner} from "nbook/plugins/storage/backend/owner";
import {createPartition, ORIGINALS_MAX_COUNT} from "nbook/plugins/storage/backend/partition";
import {createStorageFacade} from "nbook/plugins/storage/shared/facade";

import {PLOT_DATA_VERSION, PlotStore, type ChapterTable} from "./store";

const Note = Type.Object({chapter: Type.String(), tone: Type.String()}, {additionalProperties: false});
type Note = {chapter: string; tone: string};

let root = "";
let closers: (() => void | Promise<void>)[] = [];
beforeAll(async () => {
    root = await createTestTmpRoot("neuro-book-plot-store", "unit");
});
afterEach(async () => {
    for (const close of closers) await close();
    closers = [];
});
afterAll(async () => {
    if (root !== "") await rm(root, {recursive: true, force: true});
});

const consumer = {plugin: "nbook.plot", instanceId: "project-1", entry: "project", client: null, location: "project"} as never;

/** 开一份 store，读回。 */
async function open(name: string, shape = 1): Promise<{store: PlotStore; notes: ChapterTable<Note>; warnings: string[]; close: () => void}> {
    const warnings: string[] = [];
    const owner = createPartitionOwner(createPartition({path: join(root, name, "project.sqlite")}), "project", () => undefined);
    const facade = createStorageFacade(consumer, {user: () => ({ok: false, code: "no-project", detail: "测试不用"}), project: () => owner.route(consumer)});
    let closed = false;
    const close = () => {
        if (!closed) owner.close();
        closed = true;
    };
    closers.push(close);
    const store = new PlotStore(facade.service, (event, detail) => warnings.push(`${event} ${detail}`));
    const notes = store.table<Note>({key: "plot-note", shape, schema: Note});
    const failed = await store.load();
    if (failed !== null) throw new Error(JSON.stringify(failed));
    return {store, notes, warnings, close};
}

const put = <T>(store: PlotStore, table: ChapterTable<T>, chapter: string, value: T | null) => store.queued(() => store.write(table, chapter, value));

describe("落盘的表", () => {
    test("重启后读回：内容、先后无关的数据版本都相同；内容没变版本不变；删到空回到 1", async () => {
        const a = await open("restart");
        expect(a.store.dataVersion).toBe(PLOT_DATA_VERSION);
        expect(a.notes.empty).toBe(true);
        expect(await put(a.store, a.notes, "第二章/甲", {chapter: "第二章/甲", tone: "冷"})).toEqual({ok: true});
        expect(await put(a.store, a.notes, "ch1", {chapter: "ch1", tone: "暖"})).toEqual({ok: true});
        const version = a.store.dataVersion;
        expect(version).not.toBe(PLOT_DATA_VERSION);
        await put(a.store, a.notes, "ch1", {chapter: "ch1", tone: "暖"});
        expect(a.store.dataVersion).toBe(version);
        a.close();

        const b = await open("restart");
        expect(b.store.dataVersion).toBe(version);
        expect(b.notes.all().map((note) => note.chapter)).toEqual(["ch1", "第二章/甲"]);
        expect(b.notes.get("第二章/甲")?.tone).toBe("冷");
        await put(b.store, b.notes, "ch1", null);
        await put(b.store, b.notes, "第二章/甲", null);
        expect(b.store.dataVersion).toBe(PLOT_DATA_VERSION);
        b.close();

        const c = await open("restart");
        expect(c.store.dataVersion).toBe(PLOT_DATA_VERSION);
        // 删过再写：删除标记的 revision 不是 null，要带上它才写得进去。
        expect(await put(c.store, c.notes, "ch1", {chapter: "ch1", tone: "又写"})).toEqual({ok: true});
    });

    test("排进队列的比较：两个带同一份版本的并发写入恰好一个成功", async () => {
        const {store, notes} = await open("base");
        const attempt = (tone: string, base: string) => store.queued(async () => {
            if (notes.version !== base) return "conflict";
            await store.write(notes, "ch1", {chapter: "ch1", tone});
            return "written";
        });
        const base = notes.version;
        expect((await Promise.all([attempt("甲", base), attempt("乙", base)])).sort()).toEqual(["conflict", "written"]);
        expect(notes.get("ch1")?.tone).toBe("甲");
    });

    test("两张表同时写新章也不撞清单：都写得进去，重启后都读得回来", async () => {
        const a = await open("list");
        const others = a.store.table<Note>({key: "plot-other", shape: 1, schema: Note});
        const results = await Promise.all(Array.from({length: 20}, (_, index) => {
            const chapter = `ch${String(index)}`;
            return put(a.store, index % 2 === 0 ? a.notes : others, chapter, {chapter, tone: "冷"});
        }));
        expect(results.every((result) => result.ok)).toBe(true);
        a.close();
        const b = await open("list");
        expect(b.notes.all().length).toBe(10);
    });

    test("形状不认识的按没有（读回来不报坏），下一次保存正常覆盖，不占原件区：比原件区上限多的章都写得进去", async () => {
        const a = await open("shape", 1);
        const chapters = Array.from({length: ORIGINALS_MAX_COUNT + 5}, (_, index) => `ch${String(index)}`);
        for (const chapter of chapters) await put(a.store, a.notes, chapter, {chapter, tone: "旧"});
        a.close();
        const b = await open("shape", 2);
        expect(b.notes.empty).toBe(true);
        expect(b.warnings).toEqual([]);
        for (const chapter of chapters) expect(await put(b.store, b.notes, chapter, {chapter, tone: "新"})).toEqual({ok: true});
        b.close();
        const c = await open("shape", 2);
        expect(c.notes.all().length).toBe(chapters.length);
        expect(c.notes.get("ch0")?.tone).toBe("新");
    });

    test("值不合 schema 的按没有；库里坏掉的记录写一条诊断、按没有，下一次写用 reset 换掉", async () => {
        const a = await open("corrupt");
        await put(a.store, a.notes, "ch1", {chapter: "ch1", tone: "冷"});
        await put(a.store, a.notes, "ch2", {chapter: "ch2", tone: "暖"});
        a.close();
        const path = join(root, "corrupt", "project.sqlite");
        const database = new Database(path);
        const rows = database.query("SELECT rowid AS id, value FROM records WHERE key = 'plot-note'").all() as {id: number; value: string}[];
        expect(rows.length).toBe(2);
        // ch1 的值换成外层不合 schema 的（分区按定义读出 corrupt）；ch2 外层合、内层不合（表按没有算，不写诊断）。
        for (const row of rows) {
            const parsed = JSON.parse(row.value) as {chapter: string; shape: number; value: unknown};
            database.run("UPDATE records SET value = ? WHERE rowid = ?", [parsed.chapter === "ch1" ? "{\"不合\":true}" : JSON.stringify({...parsed, value: {chapter: "ch2", tone: 1}}), row.id]);
        }
        database.close();
        const b = await open("corrupt");
        expect(b.notes.empty).toBe(true);
        expect(b.warnings.length).toBe(1);
        expect(b.warnings[0]).toContain("plot.store.broken plot-note ch1");
        expect(await put(b.store, b.notes, "ch1", {chapter: "ch1", tone: "换掉"})).toEqual({ok: true});
        expect(await put(b.store, b.notes, "ch2", {chapter: "ch2", tone: "换掉"})).toEqual({ok: true});
        b.close();
        const c = await open("corrupt");
        expect(c.notes.all().map((note) => note.tone)).toEqual(["换掉", "换掉"]);
        expect(c.warnings).toEqual([]);
    });

    test("读取失败（不是缺失）交回失败，不当成没有", async () => {
        const a = await open("read-failure");
        await put(a.store, a.notes, "ch1", {chapter: "ch1", tone: "冷"});
        a.close();
        const owner = createPartitionOwner(createPartition({path: join(root, "read-failure", "project.sqlite")}), "project", () => undefined);
        const facade = createStorageFacade(consumer, {user: () => ({ok: false, code: "no-project", detail: "测试不用"}), project: () => owner.route(consumer)});
        owner.close();
        const store = new PlotStore(facade.service, () => undefined);
        store.table<Note>({key: "plot-note", shape: 1, schema: Note});
        expect(await store.load()).toMatchObject({ok: false});
    });

    test("别处写过同一条记录：这次 conflict，下一次重读 revision 就写得进去，不永远卡住", async () => {
        const a = await open("conflict");
        await put(a.store, a.notes, "ch1", {chapter: "ch1", tone: "冷"});
        a.close();
        const path = join(root, "conflict", "project.sqlite");
        const reader = await open("conflict");
        const database = new Database(path);
        database.run("UPDATE records SET revision = revision + 100 WHERE key = 'plot-note'");
        database.close();
        expect(await put(reader.store, reader.notes, "ch1", {chapter: "ch1", tone: "暖"})).toMatchObject({ok: false, code: "conflict"});
        expect(await put(reader.store, reader.notes, "ch1", {chapter: "ch1", tone: "暖"})).toEqual({ok: true});
        expect(reader.notes.get("ch1")?.tone).toBe("暖");
    });

    test("写不进去的（超过上限）交回存储的失败码，内存不变", async () => {
        const {store, notes} = await open("large");
        const big = {chapter: "ch1", tone: "字".repeat(400_000)};
        expect(await put(store, notes, "ch1", big)).toMatchObject({ok: false, code: "too-large"});
        expect(notes.get("ch1")).toBeUndefined();
        expect(await put(store, notes, "ch1", {chapter: "ch1", tone: "短"})).toEqual({ok: true});
    });
});
