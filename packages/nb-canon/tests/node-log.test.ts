import {chmod, mkdir, readdir, readFile, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {afterEach, beforeEach, describe, expect, test} from "bun:test";
import {createTestTmpRoot, removeMarkedTmpRoot, TMP_MARKER_FILE} from "@notnotype/neuro-book-test-support/tmp";

import type {Revision} from "../src/index";
import {appendReduction, appendRevision, loadReductions, nodeFiles, openLog, readNew, SEGMENT_LIMIT, type LogFiles, type Tail} from "../src/node/index";
import {faultyFiles, memoryLock, type Faults} from "./fixtures/faulty-files";

let root = "";
let dir = "";
let side = "";
beforeEach(async () => {
    root = await createTestTmpRoot("nb-canon-log");
    dir = join(root, "world", "log");
    side = join(root, "world");
});
afterEach(async () => {
    await chmod(dir, 0o755).catch(() => undefined);
    await removeMarkedTmpRoot(root, join(root, TMP_MARKER_FILE));
});

function revision(version: number, padding = 0): Revision {
    return {
        id: `r${String(version)}`, version, requestId: `q${String(version)}`, requestDigest: "d", time: "t", by: {kind: "author"}, what: "edit", title: "x", baseVersion: version - 1, ops: [],
        impact: {pendingResolved: [], pendingAdded: [], values: [], broken: []},
        ...(padding > 0 ? {notes: {pad: "x".repeat(padding)}} : {}),
    };
}

const lock = memoryLock();
const now = () => "2026-11-02T00:00:00.000Z";
const open = (files: LogFiles = nodeFiles) => openLog(files, dir, {lock, sideDir: side, now});

async function write(count: number, files: LogFiles = nodeFiles, padding = 0): Promise<Tail> {
    let tail: Tail = {segment: null, length: 0, version: 0};
    for (let version = 1; version <= count; version += 1) {
        const result = await appendRevision(files, dir, tail, revision(version, padding), lock);
        if (!("tail" in result)) throw new Error(result.code);
        tail = result.tail;
    }
    return tail;
}

describe("文件操作的契约：注入失败的实现在没有注入时与 nodeFiles 相同", () => {
    test.each<[string, () => LogFiles]>([["nodeFiles", () => nodeFiles], ["faultyFiles", () => faultyFiles({})]])("%s：建、追加、读、截断、列目录", async (_name, make) => {
        const files = make();
        await files.mkdirp(dir);
        const path = join(dir, "a.txt");
        expect(await files.size(path)).toBeNull();
        await files.create(path, new TextEncoder().encode("ab"));
        await files.append(path, new TextEncoder().encode("cd"));
        expect(new TextDecoder().decode(await files.read(path))).toBe("abcd");
        await files.truncate(path, 1);
        expect(await files.size(path)).toBe(1);
        expect(await files.list(dir)).toEqual(["a.txt"]);
        expect(await files.list(join(dir, "missing"))).toEqual([]);
        await expect(files.create(path, new Uint8Array())).rejects.toThrow();
    });
});

describe("canon.project 输出 2、3：行格式与分段", () => {
    test("一行一次修订，带 format: 2；段名是第一行的版本号；写满 256 KiB 开新段，打开后重放得到全部修订", async () => {
        await write(12, nodeFiles, 40 * 1024);
        const names = (await readdir(dir)).sort();
        expect(names[0]).toBe("000001.jsonl");
        expect(names.length).toBeGreaterThan(1);
        for (const name of names) expect((await readFile(join(dir, name))).length).toBeLessThan(SEGMENT_LIMIT + 50 * 1024);
        const first = (await readFile(join(dir, "000001.jsonl"), "utf8")).split("\n")[0]!;
        expect(JSON.parse(first)).toMatchObject({format: 2, version: 1});
        const opened = await open();
        expect("revisions" in opened && opened.revisions.map((item) => item.version)).toEqual(Array.from({length: 12}, (_, index) => index + 1));
    });

    test("一行超过 256 KiB 时独占一段；超过 4 MiB 拒收", async () => {
        const tail = await write(1);
        const big = await appendRevision(nodeFiles, dir, tail, revision(2, 300 * 1024), lock);
        expect("tail" in big && big.tail.segment).toBe("000002.jsonl");
        if (!("tail" in big)) return;
        const next = await appendRevision(nodeFiles, dir, big.tail, revision(3), lock);
        expect("tail" in next && next.tail.segment).toBe("000003.jsonl");
        expect(await appendRevision(nodeFiles, dir, big.tail, revision(3, 5 * 1024 * 1024), lock)).toEqual({code: "too-large"});
    });
});

describe("canon.project 输出 4、20、场景 2、3：打开与恢复", () => {
    test("最后一段末尾写了一半：另存、截掉、诊断 torn-tail，照常可写", async () => {
        await write(3);
        await writeFile(join(dir, "000001.jsonl"), `${await readFile(join(dir, "000001.jsonl"), "utf8")}{"format":2,"versi`);
        const opened = await open();
        if (!("revisions" in opened)) throw new Error("locked");
        expect(opened.revisions).toHaveLength(3);
        expect(opened.readOnly).toBeNull();
        const torn = opened.diagnostics.find((item) => item.code === "torn-tail");
        expect(torn).toMatchObject({code: "torn-tail", segment: "000001.jsonl", bytes: 18});
        expect(await readFile((torn as {savedAs: string}).savedAs, "utf8")).toBe('{"format":2,"versi');
        expect("tail" in (await appendRevision(nodeFiles, dir, opened.tail, revision(4), lock))).toBe(true);
    });

    test.each([
        ["中间一行坏了", (text: string) => text.replace('"version":2', '"version":2,}')],
        ["最后一行以换行结尾但坏了", (text: string) => text.replace(/\{[^\n]*"version":3[^\n]*\}\n$/u, "{oops}\n")],
        ["版本不连续", (text: string) => text.replace('"version":2', '"version":7')],
        ["不认识的格式（格式 1 的行也是）", (text: string) => text.replace('{"format":2,"id":"r2"', '{"format":1,"id":"r2"')],
    ])("%s：只读到坏行之前，文件不改写", async (_name, corrupt) => {
        await write(3);
        const path = join(dir, "000001.jsonl");
        const corrupted = corrupt(await readFile(path, "utf8"));
        await writeFile(path, corrupted);
        const opened = await open();
        if (!("revisions" in opened)) throw new Error("locked");
        expect(opened.readOnly).not.toBeNull();
        expect(opened.revisions.length).toBeLessThan(3);
        expect(await readFile(path, "utf8")).toBe(corrupted);
    });

    test("日志目录里不符合命名的文件不读、写诊断", async () => {
        await write(1);
        await writeFile(join(dir, "000001 (conflicted copy).jsonl"), "x");
        const opened = await open();
        expect("diagnostics" in opened && opened.diagnostics).toContainEqual({code: "foreign-file", name: "000001 (conflicted copy).jsonl"});
    });
});

describe("canon.project 输出 7、8、17：写入失败、尾部变化与别的进程的行", () => {
    test.each<[string, Faults, string, number]>([
        ["写之前就失败", {failAppend: {partial: 0}}, "write-failed", 2],
        ["写进一半后失败，截回原来的长度", {failAppend: {partial: 10}}, "write-failed", 2],
        ["写进一半后失败、截也截不回", {failAppend: {partial: 10}, failTruncate: true}, "write-unknown", 2],
    ])("%s", async (_name, faults, code, kept) => {
        const tail = await write(2);
        const result = await appendRevision(faultyFiles(faults), dir, tail, revision(3), lock);
        expect("code" in result && result.code).toBe(code as never);
        const opened = await open();
        if (!("revisions" in opened)) throw new Error("locked");
        if (code === "write-failed") {
            expect(opened.revisions).toHaveLength(kept);
            expect(opened.readOnly).toBeNull();
        }
    });

    test("尾部与记下的不同（别的进程写过）：tail-moved；读进新增的完整行后再写", async () => {
        const mine = await write(2);
        const theirs = await appendRevision(nodeFiles, dir, mine, revision(3), lock);
        if (!("tail" in theirs)) throw new Error("append");
        expect(await appendRevision(nodeFiles, dir, mine, revision(3), lock)).toEqual({code: "tail-moved"});
        const caught = await readNew(nodeFiles, dir, mine, lock);
        expect("revisions" in caught && caught.revisions.map((item) => item.version)).toEqual([3]);
        if (!("tail" in caught)) return;
        expect(caught.tail).toEqual(theirs.tail);
        expect("tail" in (await appendRevision(nodeFiles, dir, caught.tail, revision(4), lock))).toBe(true);
    });

    test("读进别的进程的行时，没写完的半行不读；尾部变短报 external-change", async () => {
        const tail = await write(1);
        await writeFile(join(dir, "000001.jsonl"), `${await readFile(join(dir, "000001.jsonl"), "utf8")}{"format":2,"half`);
        const caught = await readNew(nodeFiles, dir, tail, lock);
        expect("revisions" in caught && caught.revisions).toEqual([]);
        await writeFile(join(dir, "000001.jsonl"), "");
        expect(await readNew(nodeFiles, dir, tail, lock)).toMatchObject({code: "external-change"});
    });

    test.skipIf(process.getuid?.() === 0)("只读权限：开不了新段、追加不进已有段，都是确定的失败", async () => {
        const tail = await write(1);
        await chmod(join(dir, "000001.jsonl"), 0o444);
        expect(await appendRevision(nodeFiles, dir, tail, revision(2), lock)).toMatchObject({code: "write-failed"});
        await chmod(join(dir, "000001.jsonl"), 0o644);
        await chmod(dir, 0o555);
        expect(await appendRevision(nodeFiles, dir, {...tail, length: SEGMENT_LIMIT + tail.length}, revision(2), lock)).toMatchObject({code: "tail-moved"});
    });
});

describe("canon.project 输出 12：归纳缓存", () => {
    test("同一个键取最早的那条有效的；坏行跳过", async () => {
        const path = join(root, "cache", "reductions.jsonl");
        await appendReduction(nodeFiles, path, "k1", "开始缓和");
        await appendReduction(nodeFiles, path, "k1", "后来的");
        await mkdir(join(root, "cache"), {recursive: true});
        await writeFile(path, `${await readFile(path, "utf8")}坏行\n`);
        await appendReduction(nodeFiles, path, "k2", "冷淡");
        const cache = await loadReductions(nodeFiles, path);
        expect([...cache.entries]).toEqual([["k1", "开始缓和"], ["k2", "冷淡"]]);
        expect(cache.badLines).toEqual([3]);
    });
});

describe("canon.project 输出 4、22：打开持锁", () => {
    test("日志完整时打开也要拿锁：锁被别的进程占着就得到 world-locked，不读到一半", async () => {
        await write(3);
        const busy = {acquire: async () => "locked" as const};
        expect(await openLog(nodeFiles, dir, {lock: busy, sideDir: side, now})).toEqual({code: "world-locked"});
        let held = false;
        const watching = {acquire: async () => {
            held = true;
            return {release: async () => void (held = false)};
        }};
        const files: LogFiles = {...nodeFiles, read: async (path) => {
            expect(held).toBe(true);
            return nodeFiles.read(path);
        }};
        const opened = await openLog(files, dir, {lock: watching, sideDir: side, now});
        expect("revisions" in opened && opened.revisions.map((item) => item.version)).toEqual([1, 2, 3]);
        expect(held).toBe(false);
    });
});
