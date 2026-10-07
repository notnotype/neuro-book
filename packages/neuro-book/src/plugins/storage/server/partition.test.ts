/**
 * 分区库：真实临时目录上的 SQLite（docs/specs/storage/persistence.md 场景 4、5、6 的分区一侧）。两个进程写同一个
 * 库用真实 Bun 子进程（`testing/partition-writer.ts`），按行与它们对话；子进程在用例失败时也由 afterEach 结束。
 */

import {Database} from "bun:sqlite";
import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {Type} from "typebox";

import {defineRecord} from "nbook/shared/storage";
import type {RecordDescriptor} from "nbook/shared/storage";

import {createPartition, ORIGINALS_MAX_COUNT} from "./partition";
import type {Partition, RecordAddress} from "./partition";

const WRITER = join(import.meta.dir, "testing", "partition-writer.ts");

const notes = defineRecord({key: "notes", scope: "user", locality: "shared", version: 1, schema: Type.Object({text: Type.String()}, {additionalProperties: false}), maxBytes: 64});
const race = defineRecord({key: "race", scope: "user", locality: "shared", version: 1, schema: Type.Object({pid: Type.Integer()}, {additionalProperties: false})});

let tmp = "";
let counter = 0;
const opened: Partition[] = [];
const children: Array<ReturnType<typeof Bun.spawn>> = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-storage", "partition");
});

afterEach(() => {
    for (const partition of opened.splice(0)) partition.close();
    for (const child of children.splice(0)) child.kill("SIGKILL");
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

function freshPath(): string {
    counter += 1;
    return join(tmp, `case-${String(counter)}`, "storage", "user.sqlite");
}

function partitionAt(path: string, options: {readonly busyTimeoutMs?: number} = {}): Partition {
    const partition = createPartition({path, ...options});
    opened.push(partition);
    return partition;
}

const at = (owner: string, key = notes.key, client = ""): RecordAddress => ({owner, key, resource: "", client});

/** 成功写入得到的 revision；revision 对调用方不透明，测试只拿它做下一次的 `expect`，不假定具体取值。 */
function revisionOf(result: ReturnType<Partition["write"]>): string {
    if (!result.ok) throw new Error(`期望写入成功，得到 ${result.code}：${result.detail}`);
    return result.revision;
}

/** 直接改库里的一行：模拟坏数据与旧版本的记录。 */
function rawWrite(path: string, address: RecordAddress, value: string | null, version: number, revision = 900): void {
    const db = new Database(path);
    db.query("INSERT INTO records (owner, key, resource, client, revision, version, value, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0) ON CONFLICT (owner, key, resource, client) DO UPDATE SET revision = excluded.revision, version = excluded.version, value = excluded.value")
        .run(address.owner, address.key, address.resource, address.client, revision, version, value);
    db.close();
}

/** 起一个写同一个库的子进程，返回按行读它输出的函数；`send` 写最后一条指令并关闭它的标准输入（两种模式都只收一条指令）。 */
function spawnWriter(args: ReadonlyArray<string>): {readonly next: () => Promise<string>; send(line: string): void; readonly exited: Promise<number>} {
    const child = Bun.spawn([process.execPath, WRITER, ...args], {stdin: "pipe", stdout: "pipe", stderr: "inherit", cwd: join(import.meta.dir, "..", "..", "..", "..")});
    children.push(child);
    const reader = child.stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    return {
        next: async () => {
            for (;;) {
                const index = buffer.indexOf("\n");
                if (index >= 0) {
                    const line = buffer.slice(0, index);
                    buffer = buffer.slice(index + 1);
                    return line;
                }
                const chunk = await reader.read();
                if (chunk.done) throw new Error(`子进程 ${args.join(" ")} 已结束，没有更多输出`);
                buffer += decoder.decode(chunk.value, {stream: true});
            }
        },
        send: (line) => {
            void child.stdin.write(`${line}\n`);
            void child.stdin.end();
        },
        exited: child.exited,
    };
}

describe("Spec storage.persistence 场景 4：条件保存", () => {
    it("从未写过以 null 保存；同一 revision 的第二次保存为 conflict；revision 单调递增", () => {
        const partition = partitionAt(freshPath());
        expect(partition.read(at("app.a"), notes.descriptor)).toEqual({status: "missing", revision: null});

        const first = revisionOf(partition.write(at("app.a"), notes.descriptor, {kind: "save", value: {text: "一"}, expect: null}));
        expect(partition.write(at("app.a"), notes.descriptor, {kind: "save", value: {text: "抢"}, expect: null})).toMatchObject({ok: false, code: "conflict"});
        const second = revisionOf(partition.write(at("app.a"), notes.descriptor, {kind: "save", value: {text: "二"}, expect: first}));
        expect(second).not.toBe(first);
        expect(partition.write(at("app.a"), notes.descriptor, {kind: "save", value: {text: "旧"}, expect: first})).toMatchObject({ok: false, code: "conflict"});
        expect(partition.read(at("app.a"), notes.descriptor)).toEqual({status: "ok", value: {text: "二"}, revision: second});
    });

    it("删除留下带新 revision 的删除标记：持有旧 revision 或 null 的保存不能复活，带删除标记的 revision 可以", () => {
        const partition = partitionAt(freshPath());
        const written = revisionOf(partition.write(at("app.a"), notes.descriptor, {kind: "save", value: {text: "一"}, expect: null}));
        const removed = revisionOf(partition.write(at("app.a"), notes.descriptor, {kind: "remove", expect: written}));
        expect(removed).not.toBe(written);
        expect(partition.read(at("app.a"), notes.descriptor)).toEqual({status: "missing", revision: removed});

        expect(partition.write(at("app.a"), notes.descriptor, {kind: "save", value: {text: "复活"}, expect: written})).toMatchObject({ok: false, code: "conflict"});
        expect(partition.write(at("app.a"), notes.descriptor, {kind: "save", value: {text: "复活"}, expect: null})).toMatchObject({ok: false, code: "conflict"});
        expect(partition.write(at("app.a"), notes.descriptor, {kind: "save", value: {text: "新"}, expect: removed})).toMatchObject({ok: true});
        expect(partition.read(at("app.a"), notes.descriptor)).toMatchObject({status: "ok", value: {text: "新"}});
    });

    it("owner 与客户端分区各自独立；关掉再打开值都在，新的 revision 不与用过的重复", () => {
        const path = freshPath();
        const partition = partitionAt(path);
        const a = revisionOf(partition.write(at("app.a"), notes.descriptor, {kind: "save", value: {text: "a"}, expect: null}));
        const b = revisionOf(partition.write(at("app.b"), notes.descriptor, {kind: "save", value: {text: "b"}, expect: null}));
        const a1 = revisionOf(partition.write(at("app.a", notes.key, "profile-1"), notes.descriptor, {kind: "save", value: {text: "a1"}, expect: null}));
        partition.close();

        const reopened = partitionAt(path);
        expect(reopened.read(at("app.a"), notes.descriptor)).toEqual({status: "ok", value: {text: "a"}, revision: a});
        expect(reopened.read(at("app.b"), notes.descriptor)).toEqual({status: "ok", value: {text: "b"}, revision: b});
        expect(reopened.read(at("app.a", notes.key, "profile-1"), notes.descriptor)).toEqual({status: "ok", value: {text: "a1"}, revision: a1});
        expect(reopened.read(at("app.a", notes.key, "profile-2"), notes.descriptor)).toEqual({status: "missing", revision: null});
        const a2 = revisionOf(reopened.write(at("app.a"), notes.descriptor, {kind: "save", value: {text: "a2"}, expect: a}));
        expect([a, b, a1]).not.toContain(a2);
    });

    it("两个进程同时以 null 保存同一条记录：恰好一个成功，另一个是 conflict", async () => {
        const path = freshPath();
        partitionAt(path).read(at("app.a", race.key), race.descriptor);
        // 第三个进程先占住写锁，两个写入方都排在锁上；放开后它们真正争用，后拿到锁的读到新 revision。
        const holder = spawnWriter(["hold", path]);
        expect(await holder.next()).toBe("locked");
        const writers = [spawnWriter(["race", path, "app.a"]), spawnWriter(["race", path, "app.a"])];
        for (const writer of writers) expect(await writer.next()).toBe("ready");
        for (const writer of writers) writer.send("go");
        for (const writer of writers) expect(await writer.next()).toBe("attempting");

        holder.send("release");
        expect(await holder.next()).toBe("released");
        const results = await Promise.all(writers.map(async (writer) => JSON.parse(await writer.next()) as {ok: boolean; code?: string; revision?: string}));
        for (const writer of writers) expect(await writer.exited).toBe(0);

        expect(results.filter((result) => result.ok)).toHaveLength(1);
        expect(results.filter((result) => !result.ok).map((result) => result.code)).toEqual(["conflict"]);
        const winner = results.find((result) => result.ok);
        expect(partitionAt(path).read(at("app.a", race.key), race.descriptor)).toMatchObject({status: "ok", revision: winner?.revision});
    });

    it("别的进程持有库锁超过等待上限：保存为 busy，记录不变；锁释放后照常写入", async () => {
        const path = freshPath();
        const partition = partitionAt(path, {busyTimeoutMs: 50});
        const first = revisionOf(partition.write(at("app.a"), notes.descriptor, {kind: "save", value: {text: "一"}, expect: null}));
        const holder = spawnWriter(["hold", path]);
        expect(await holder.next()).toBe("locked");

        expect(partition.write(at("app.a"), notes.descriptor, {kind: "save", value: {text: "二"}, expect: first})).toMatchObject({ok: false, code: "busy"});

        holder.send("release");
        expect(await holder.next()).toBe("released");
        expect(await holder.exited).toBe(0);
        expect(partition.write(at("app.a"), notes.descriptor, {kind: "save", value: {text: "二"}, expect: first})).toMatchObject({ok: true});
    });
});

describe("Spec storage.persistence 场景 5：读取分类、保护与重置", () => {
    it("坏 JSON 与 schema 不符为 corrupt，版本不同为 unsupported-version；普通保存与删除为 protected", () => {
        const path = freshPath();
        const partition = partitionAt(path);
        partition.read(at("app.a"), notes.descriptor);
        rawWrite(path, at("app.a", "notes"), "{broken", 1, 10);
        rawWrite(path, at("app.b", "notes"), JSON.stringify({text: 42}), 1, 11);
        rawWrite(path, at("app.c", "notes"), JSON.stringify({text: "未来"}), 2, 12);

        expect(partition.read(at("app.a"), notes.descriptor)).toMatchObject({status: "corrupt", revision: "10"});
        expect(partition.read(at("app.b"), notes.descriptor)).toMatchObject({status: "corrupt", revision: "11"});
        expect(partition.read(at("app.c"), notes.descriptor)).toMatchObject({status: "unsupported-version", revision: "12"});
        expect(partition.write(at("app.a"), notes.descriptor, {kind: "save", value: {text: "x"}, expect: "10"})).toMatchObject({ok: false, code: "protected"});
        expect(partition.write(at("app.c"), notes.descriptor, {kind: "remove", expect: "12"})).toMatchObject({ok: false, code: "protected"});
    });

    it("reset 把原件写进原件区再写入新值；原件区满时拒绝重置、不清旧原件；对正常记录与 save 相同", () => {
        const path = freshPath();
        const partition = partitionAt(path);
        partition.read(at("app.a"), notes.descriptor);
        rawWrite(path, at("app.a", "notes"), "{broken", 1, 10);

        expect(partition.write(at("app.a"), notes.descriptor, {kind: "reset", value: {text: "修好"}, expect: "10"})).toMatchObject({ok: true});
        expect(partition.read(at("app.a"), notes.descriptor)).toMatchObject({status: "ok", value: {text: "修好"}});
        const db = new Database(path);
        expect(db.query("SELECT owner, key, revision, version, value FROM originals").all()).toEqual([{owner: "app.a", key: "notes", revision: 10, version: 1, value: "{broken"}]);
        for (let index = 1; index < ORIGINALS_MAX_COUNT; index += 1) {
            db.query("INSERT INTO originals (owner, key, resource, client, revision, version, value, bytes, saved_at) VALUES ('app.z', 'notes', '', '', ?1, 1, 'x', 1, 0)").run(index);
        }
        db.close();

        rawWrite(path, at("app.b", "notes"), "{broken", 1, 20);
        expect(partition.write(at("app.b"), notes.descriptor, {kind: "reset", value: {text: "y"}, expect: "20"})).toMatchObject({ok: false, code: "originals-full"});
        expect(partition.read(at("app.b"), notes.descriptor)).toMatchObject({status: "corrupt", revision: "20"});
        const check = new Database(path);
        expect(check.query<{count: number}, []>("SELECT COUNT(*) AS count FROM originals").get()?.count).toBe(ORIGINALS_MAX_COUNT);
        check.close();

        const ok = partition.write(at("app.c"), notes.descriptor, {kind: "reset", value: {text: "新"}, expect: null});
        expect(ok).toMatchObject({ok: true});
    });

    it("库文件不是 SQLite：读为 error(io-error)、写为 io-error，文件不被覆盖", async () => {
        const path = freshPath();
        await mkdir(dirname(path), {recursive: true});
        await writeFile(path, "not a database ".repeat(40));
        const before = await readFile(path, "utf8");
        const partition = partitionAt(path);

        expect(partition.read(at("app.a"), notes.descriptor)).toMatchObject({status: "error", code: "io-error"});
        expect(partition.write(at("app.a"), notes.descriptor, {kind: "save", value: {text: "x"}, expect: null})).toMatchObject({ok: false, code: "io-error"});
        expect(await readFile(path, "utf8")).toBe(before);
    });

    it("库格式版本不认识：操作为 io-error，库不被改写", async () => {
        const path = freshPath();
        partitionAt(path).read(at("app.a"), notes.descriptor);
        const db = new Database(path);
        db.query("UPDATE meta SET value = '2' WHERE name = 'format'").run();
        db.close();
        const before = await readFile(path);

        const partition = partitionAt(path);
        expect(partition.read(at("app.a"), notes.descriptor)).toMatchObject({status: "error", code: "io-error", detail: expect.stringContaining("格式版本 2")});
        expect(Buffer.compare(await readFile(path), before)).toBe(0);
    });
});

describe("Spec storage.persistence 副作用与数据：认库", () => {
    it("别的应用的 SQLite 库、缺格式标记的库：登记与读写都为 io-error，文件不变；空文件当作新库", async () => {
        const foreign = freshPath();
        await mkdir(dirname(foreign), {recursive: true});
        const other = new Database(foreign, {create: true});
        other.run("CREATE TABLE unrelated (id INTEGER PRIMARY KEY, note TEXT)");
        other.query("INSERT INTO unrelated (note) VALUES ('别人的数据')").run();
        other.close();
        const unmarked = freshPath();
        await mkdir(dirname(unmarked), {recursive: true});
        const half = new Database(unmarked, {create: true});
        half.run("CREATE TABLE meta (name TEXT PRIMARY KEY, value TEXT NOT NULL)");
        half.close();

        for (const path of [foreign, unmarked]) {
            const before = await readFile(path);
            const partition = partitionAt(path);
            expect(partition.register("app.a", notes.descriptor)).toMatchObject({ok: false, code: "io-error"});
            expect(partition.read(at("app.a"), notes.descriptor)).toMatchObject({status: "error", code: "io-error"});
            expect(partition.write(at("app.a"), notes.descriptor, {kind: "save", value: {text: "x"}, expect: null})).toMatchObject({ok: false, code: "io-error"});
            partition.close();
            expect(Buffer.compare(await readFile(path), before)).toBe(0);
        }

        const empty = freshPath();
        await mkdir(dirname(empty), {recursive: true});
        await writeFile(empty, "");
        expect(partitionAt(empty).write(at("app.a"), notes.descriptor, {kind: "save", value: {text: "新库"}, expect: null})).toMatchObject({ok: true});
    });
});

describe("Spec storage.persistence 场景 6：描述与值的核对", () => {
    it("同一 owner 同名键的描述不同为 definition-conflict（登记、读、写都是）；别的 owner 不受影响", () => {
        const partition = partitionAt(freshPath());
        const changed: RecordDescriptor = {...notes.descriptor, schema: Type.Object({text: Type.Number()}, {additionalProperties: false})};
        expect(partition.register("app.a", notes.descriptor)).toEqual({ok: true});
        expect(partition.register("app.a", notes.descriptor)).toEqual({ok: true});

        expect(partition.register("app.a", changed)).toMatchObject({ok: false, code: "definition-conflict"});
        expect(partition.read(at("app.a"), changed)).toMatchObject({status: "error", code: "definition-conflict"});
        expect(partition.write(at("app.a"), changed, {kind: "save", value: {text: 1}, expect: null})).toMatchObject({ok: false, code: "definition-conflict"});
        expect(partition.register("app.b", changed)).toEqual({ok: true});
    });

    it("不符合 schema 或无法如实编码为 invalid-value，超过上限为 too-large；都不写入", () => {
        const partition = partitionAt(freshPath());
        expect(partition.write(at("app.a"), notes.descriptor, {kind: "save", value: {text: 1}, expect: null})).toMatchObject({ok: false, code: "invalid-value"});
        expect(partition.write(at("app.a"), notes.descriptor, {kind: "save", value: {text: "x", extra: true}, expect: null})).toMatchObject({ok: false, code: "invalid-value"});
        expect(partition.write(at("app.a"), notes.descriptor, {kind: "save", value: {text: "长".repeat(30)}, expect: null})).toMatchObject({ok: false, code: "too-large"});
        expect(partition.read(at("app.a"), notes.descriptor)).toEqual({status: "missing", revision: null});
    });
});

describe("Spec storage.persistence 输出 7：进程内的变更通知", () => {
    it("先得到当前快照，之后每次成功写入推送新快照；失败的写入不推送；停止后不再推送；监听抛错不影响写入", () => {
        const errors: unknown[] = [];
        const partition = createPartition({path: freshPath(), onListenerError: (error) => errors.push(error)});
        opened.push(partition);
        const seen: unknown[] = [];
        const watcher = partition.watch(at("app.a"), notes.descriptor, (snapshot) => seen.push(snapshot));
        partition.watch(at("app.a"), notes.descriptor, () => {
            throw new Error("监听出错");
        });
        expect(watcher.initial).toEqual({status: "missing", revision: null});

        const first = revisionOf(partition.write(at("app.a"), notes.descriptor, {kind: "save", value: {text: "一"}, expect: null}));
        partition.write(at("app.a"), notes.descriptor, {kind: "save", value: {text: "冲突"}, expect: null});
        partition.write(at("app.b"), notes.descriptor, {kind: "save", value: {text: "别人"}, expect: null});
        const removed = revisionOf(partition.write(at("app.a"), notes.descriptor, {kind: "remove", expect: first}));
        watcher.stop();
        partition.write(at("app.a"), notes.descriptor, {kind: "save", value: {text: "停止后"}, expect: removed});

        expect(seen).toEqual([{status: "ok", value: {text: "一"}, revision: first}, {status: "missing", revision: removed}]);
        expect(errors).toHaveLength(3);
    });

    it("监听里再写同一条记录：每个监听都按写入顺序收到快照；派发途中开始的监听不重复收到它的初始快照", () => {
        const partition = partitionAt(freshPath());
        const seen = {writer: [] as string[], other: [] as string[], late: [] as string[]};
        let late: ReturnType<Partition["watch"]> | null = null;
        const text = (snapshot: {readonly status: string; readonly value?: unknown}): string => (snapshot.status === "ok" ? (snapshot.value as {text: string}).text : snapshot.status);
        partition.watch(at("app.a"), notes.descriptor, (snapshot) => {
            seen.writer.push(text(snapshot));
            if (snapshot.status !== "ok" || late !== null) return;
            partition.write(at("app.a"), notes.descriptor, {kind: "save", value: {text: "二"}, expect: snapshot.revision});
            late = partition.watch(at("app.a"), notes.descriptor, (next) => seen.late.push(text(next)));
        });
        partition.watch(at("app.a"), notes.descriptor, (snapshot) => seen.other.push(text(snapshot)));

        partition.write(at("app.a"), notes.descriptor, {kind: "save", value: {text: "一"}, expect: null});

        expect(seen).toEqual({writer: ["一", "二"], other: ["一", "二"], late: []});
        expect(late!.initial).toMatchObject({status: "ok", value: {text: "二"}});
    });

    it("派发途中停掉排在后面的监听或关闭分区：被停掉的监听收不到这一次写入，之后的也收不到", () => {
        const partition = partitionAt(freshPath());
        const stopped: string[] = [];
        let second: ReturnType<Partition["watch"]> | null = null;
        partition.watch(at("app.a"), notes.descriptor, () => second?.stop());
        second = partition.watch(at("app.a"), notes.descriptor, (snapshot) => stopped.push(snapshot.status));
        const first = revisionOf(partition.write(at("app.a"), notes.descriptor, {kind: "save", value: {text: "一"}, expect: null}));
        partition.write(at("app.a"), notes.descriptor, {kind: "save", value: {text: "二"}, expect: first});

        const closing = partitionAt(freshPath());
        const afterClose: string[] = [];
        closing.watch(at("app.a"), notes.descriptor, () => closing.close());
        closing.watch(at("app.a"), notes.descriptor, (snapshot) => afterClose.push(snapshot.status));
        closing.write(at("app.a"), notes.descriptor, {kind: "save", value: {text: "一"}, expect: null});

        expect({stopped, afterClose}).toEqual({stopped: [], afterClose: []});
    });

    it("关闭后操作为 unavailable", () => {
        const partition = partitionAt(freshPath());
        partition.close();
        expect(partition.read(at("app.a"), notes.descriptor)).toMatchObject({status: "error", code: "unavailable"});
        expect(partition.write(at("app.a"), notes.descriptor, {kind: "save", value: {text: "x"}, expect: null})).toMatchObject({ok: false, code: "unavailable"});
    });
});
