import {createHash} from "node:crypto";
import {appendFile, mkdir, readFile, stat, truncate, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {afterEach, beforeEach, describe, expect, test} from "bun:test";
import {createTestTmpRoot, removeMarkedTmpRoot, TMP_MARKER_FILE} from "@notnotype/neuro-book-test-support/tmp";

import {buildRegistry, type Entry, type WriteRequest} from "../src/index";
import {nodeFiles, WorldService, LEASE_MS, type LogFiles, type ServiceEvent, type ServicePorts} from "../src/node/index";
import {faultyFiles, memoryLock, type Faults} from "./fixtures/faulty-files";
import {PANEL, PERSON} from "./fixtures/world";

let root = "";
let services: WorldService[] = [];
beforeEach(async () => {
    root = await createTestTmpRoot("nb-canon-service");
});
afterEach(async () => {
    for (const service of services) await service.stop();
    services = [];
    await removeMarkedTmpRoot(root, join(root, TMP_MARKER_FILE));
});

const lock = memoryLock();
const registry = buildRegistry([PANEL, PERSON]);
const chapters = ["ch1", "ch2", "ch3"];

function ports(clock: {now: number}, extra: Partial<ServicePorts> = {}, files: LogFiles = nodeFiles): ServicePorts {
    return {
        files,
        lock,
        logDir: join(root, ".nbook", "world", "log"),
        sideDir: join(root, ".nbook", "world"),
        cachePath: join(root, ".nbook", "cache", "reductions.jsonl"),
        chapterText: () => "",
        digest: (text) => createHash("sha256").update(text).digest("hex"),
        clock: () => clock.now,
        now: () => new Date(clock.now).toISOString(),
        ...extra,
    };
}

async function open(clock = {now: 0}, extra: Partial<ServicePorts> = {}, files?: LogFiles): Promise<WorldService> {
    const service = await WorldService.open(ports(clock, extra, files), {chapters, registry});
    if ("code" in service) throw new Error(service.code);
    services.push(service);
    return service;
}

/** 追加写停在落盘之前，等测试放行：用来观察发布进行中的读取与排队。其余操作就是真实的 `nodeFiles`。 */
function pausedAppend(): {files: LogFiles; reached: Promise<void>; release: () => void} {
    let arrive = () => {};
    let release = () => {};
    const reached = new Promise<void>((resolve) => {
        arrive = resolve;
    });
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    return {
        files: {...nodeFiles, async append(path, bytes) {
            arrive();
            await gate;
            await nodeFiles.append(path, bytes);
        }},
        reached,
        release,
    };
}

const segment = () => join(root, ".nbook", "world", "log", "000001.jsonl");
const latest = {kind: "chapter", chapter: "ch3", edge: "end"} as const;

let sequence = 0;
function entryRequest(name: string, baseVersion: number, extra: Partial<WriteRequest> = {}): WriteRequest {
    const id = `tmp:${name}`;
    const entry: Entry = {id, type: "人物", parent: null, folder: "", order: 0, init: {name, aliases: [], summary: "", text: [], data: {character: {type: PERSON.id, version: 1, enabled: true, fields: {外观: null, 状态: null, 态度: "冷淡"}}}}};
    return {requestId: `req-${String(++sequence)}`, by: {kind: "author"}, what: "edit", title: name, baseVersion, puts: [{ref: {kind: "entry", id}, after: entry}], ...extra};
}

/** 在某一章给 e1 的“态度”（语义档）记一笔：读到它要归纳。 */
function noteRequest(baseVersion: number, chapter = "ch1", value = "软了一点"): WriteRequest {
    return {requestId: `note-${String(++sequence)}`, by: {kind: "author"}, what: "edit", title: "事件", baseVersion, puts: [{ref: {kind: "change", id: "tmp:c"}, after: {id: "tmp:c", kind: "written", text: value, at: {kind: "chapter", chapter, key: 0}, told: [], involves: ["e1"], lines: [], links: [], patches: [{op: "note", at: {entry: "e1", path: "character.态度"}, value}], status: "active", by: {kind: "author"}}}]};
}

describe("canon.project 输出 1、4、6、9 与场景 1：打开、章序、写入与重开", () => {
    test("打开空世界后章序与记下的不同，发布一次章序调整；写入落盘后才发 changed，收到后读到新版本；重开逐字相同", async () => {
        const service = await open();
        expect(service.status()).toMatchObject({version: 1, state: "writable"});
        const events: ServiceEvent[] = [];
        service.subscribe((event) => {
            events.push(event);
            if (event.kind === "changed") expect(service.status().version).toBe(event.version);
        });
        const result = await service.publish(entryRequest("星瑕", 1));
        expect(result.ok).toBe(true);
        expect(events).toEqual([{kind: "changed", version: 2, revision: "r2", by: {kind: "author"}, what: "edit", title: "星瑕"}]);
        const log = await readFile(join(root, ".nbook", "world", "log", "000001.jsonl"), "utf8");
        expect(log.trim().split("\n").map((line) => JSON.parse(line).version)).toEqual([1, 2]);
        const reopened = await open();
        expect(reopened.status().version).toBe(2);
        expect(reopened.entry("e1", {kind: "chapter", chapter: "ch3", edge: "end"}, "actual")).toEqual(service.entry("e1", {kind: "chapter", chapter: "ch3", edge: "end"}, "actual"));
    });

    test("活页夹清单坏了：不改章序，写诊断 binder-invalid（输出 23）", async () => {
        const service = await open();
        await service.setChapters("invalid");
        expect(service.world.options.order.ids).toEqual(chapters);
        expect(service.status().diagnostics).toContainEqual({code: "binder-invalid"});
    });

    test("章序调整是系统写入：独占期间照样发布；世界只读时只按新章序计算，写诊断", async () => {
        const service = await open();
        service.acquireExclusive("记账");
        await service.setChapters(["ch2", "ch1", "ch3"]);
        expect(service.world.revisions.at(-1)).toMatchObject({version: 2, what: "reorder"});

        await appendFile(segment(), "这一行坏了\n");
        const broken = await open();
        expect(broken.status().state).toBe("read-only");
        await broken.setChapters(["ch3", "ch2", "ch1"]);
        expect(broken.world.options.order.ids).toEqual(["ch3", "ch2", "ch1"]);
        expect(broken.status().version).toBe(2);
        expect(broken.status().diagnostics).toContainEqual({code: "reorder-not-recorded", reason: "world-read-only"});
    });
});

describe("canon.project 输出 5、6：读的是某一个版本，写入排队", () => {
    test("发布落盘前读到的是之前的版本；两次基于同一版本、改不同对象的发布依次成功，版本连续", async () => {
        await open();
        const paused = pausedAppend();
        const service = await open({now: 0}, {}, paused.files);
        const first = service.publish(entryRequest("甲", 1));
        const second = service.publish(entryRequest("乙", 1));
        await paused.reached;
        expect(service.status().version).toBe(1);
        expect(service.lookup(["甲"], latest)).toMatchObject({version: 1, found: {甲: []}});
        paused.release();
        const results = await Promise.all([first, second]);
        expect(results.map((result) => result.ok && result.revision.version)).toEqual([2, 3]);
        expect(service.lookup(["甲", "乙"], latest)).toMatchObject({version: 3, found: {甲: ["e1"], 乙: ["e2"]}});
    });
});

describe("canon.project 输出 10、场景 5：独占写入", () => {
    test("独占期间别人的写入得到 busy，持令牌的写入续期；释放后可写", async () => {
        const clock = {now: 1000};
        const service = await open(clock);
        const lease = service.acquireExclusive("第 5 章记账");
        if ("code" in lease) throw new Error("busy");
        expect(service.acquireExclusive("别的")).toEqual({code: "busy", holder: "第 5 章记账", since: 1000});
        expect(service.lookup(["星瑕"], latest)).toMatchObject({version: 1, found: {星瑕: []}});
        expect(await service.publish(entryRequest("星瑕", 1))).toEqual({ok: false, failure: {code: "busy", holder: "第 5 章记账", since: 1000}});
        clock.now += 50_000;
        expect((await service.publish(entryRequest("白灵", 1), lease.token)).ok).toBe(true);
        clock.now += 50_000;
        expect(service.status().exclusive).toEqual({label: "第 5 章记账", since: 1000});
        service.releaseExclusive(lease.token);
        expect((await service.publish(entryRequest("星瑕", 2))).ok).toBe(true);
    });

    test("强行解除、到期没续、释放都结束独占（持有者断开由插件经释放结束）；之后旧令牌得到 exclusive-lost", async () => {
        const clock = {now: 0};
        const service = await open(clock);
        const events: ServiceEvent[] = [];
        service.subscribe((event) => events.push(event));
        const first = service.acquireExclusive("记账") as {token: string};
        service.breakExclusive();
        expect(await service.publish(entryRequest("星瑕", 1), first.token)).toEqual({ok: false, failure: {code: "exclusive-lost"}});
        const second = service.acquireExclusive("记账") as {token: string};
        clock.now += LEASE_MS;
        expect(service.renewExclusive(second.token)).toEqual({code: "exclusive-lost"});
        const third = service.acquireExclusive("记账") as {token: string};
        service.releaseExclusive(third.token);
        expect(service.status().exclusive).toBeNull();
        expect(service.renewExclusive(third.token)).toEqual({code: "exclusive-lost"});
        expect(events.filter((event) => event.kind === "exclusive").map((event) => (event as {holder: string | null}).holder)).toEqual(["记账", null, "记账", null, "记账", null]);
    });
});

describe("canon.project 输出 7、16、场景 7：结局与写入失败", () => {
    test("按请求 id 查结局；再发同一个请求得到同一次修订，日志里只有一行", async () => {
        const service = await open();
        const request = entryRequest("星瑕", 1);
        const first = await service.publish(request);
        const again = await service.publish({...request, baseVersion: 2});
        expect(first.ok && again.ok && first.revision.id === again.revision.id).toBe(true);
        expect(service.outcome(request.requestId)).toEqual({published: true, revision: "r2", version: 2});
        expect(service.outcome("没有")).toEqual({published: false});
        const log = await readFile(join(root, ".nbook", "world", "log", "000001.jsonl"), "utf8");
        expect(log.trim().split("\n")).toHaveLength(2);
    });

    test.each<[string, Faults, "write-failed" | "write-unknown"]>([
        ["确定没写进去：世界不变，可以再写", {failAppend: {partial: 0}}, "write-failed"],
        ["写进一半、截不回：结局不确定，转只读", {failAppend: {partial: 5}, failTruncate: true}, "write-unknown"],
    ])("%s", async (_name, faults, code) => {
        // 先用正常的文件建好日志（章序已记下），出错的实例打开时就不用再写，注入的失败落在下面这次发布上。
        await open();
        const broken = await open({now: 0}, {}, faultyFiles(faults));
        const result = await broken.publish(entryRequest("星瑕", 1));
        expect(result.ok === false && result.failure.code).toBe(code);
        expect(broken.status().version).toBe(1);
        if (code === "write-unknown") {
            expect(broken.status().state).toBe("read-only");
            expect(broken.outcome("whatever")).toEqual({code: "write-unknown"});
        } else expect((await broken.publish(entryRequest("星瑕", 1))).ok).toBe(true);
    });
});

describe("canon.project 输出 8、17：两个实例写同一份日志", () => {
    test("另一个实例写过后，本实例先读进它的行再发布；版本连续，基于旧版本改同一对象报冲突", async () => {
        const a = await open();
        const b = await open();
        const seen: number[] = [];
        b.subscribe((event) => event.kind === "changed" && seen.push(event.version));
        expect((await a.publish(entryRequest("星瑕", 1))).ok).toBe(true);
        const fromB = await b.publish(entryRequest("星瑾", 1));
        expect(fromB.ok && fromB.revision.version).toBe(3);
        expect(seen).toEqual([2, 3]);
        await a.externalChanged();
        expect(a.status().version).toBe(3);
        const target = a.world.data.entries.get("e1")!;
        expect((await a.publish({requestId: "edit-a", by: {kind: "author"}, what: "edit", title: "改", baseVersion: 3, puts: [{ref: {kind: "entry", id: "e1"}, after: {...target, folder: "A"}}]})).ok).toBe(true);
        const stale = await b.publish({requestId: "edit-b", by: {kind: "author"}, what: "edit", title: "改", baseVersion: 3, puts: [{ref: {kind: "entry", id: "e1"}, after: {...target, folder: "B"}}]});
        expect(stale.ok === false && stale.failure.code).toBe("version-conflict");
    });
});

describe("canon.project 输出 17：别的进程写的行", () => {
    test("别的进程写到一半停住：只读进以换行结尾的行，不截文件", async () => {
        const writer = await open();
        const reader = await open();
        await writer.publish(entryRequest("星瑕", 1));
        await appendFile(segment(), '{"format":1,"version":3');
        const size = (await stat(segment())).size;
        await reader.externalChanged();
        expect(reader.status()).toMatchObject({version: 2, state: "writable"});
        expect((await stat(segment())).size).toBe(size);
    });

    test("日志比记下的短：视为被外部改动，转只读并写诊断", async () => {
        const writer = await open();
        const reader = await open();
        await writer.publish(entryRequest("星瑕", 1));
        await truncate(segment(), 10);
        await reader.externalChanged();
        expect(reader.status().state).toBe("read-only");
        expect(reader.status().diagnostics).toContainEqual(expect.objectContaining({code: "external-change"}));
        expect(await reader.publish(entryRequest("星瑾", 1))).toMatchObject({ok: false, failure: {code: "world-read-only"}});
    });
});

describe("canon.project 输出 11、12、15、19：补归纳、游标与停止", () => {
    test("语义档先是未归纳，补算后发 reduced、读到归纳；缓存落盘，重开后直接命中", async () => {
        // 小模型的回答由测试放行，才能先看到“未归纳”的显示。
        const reduced: string[] = [];
        let release = () => {};
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const reducer = {version: "m1", reduce: async (input: {anchor: string | null; events: readonly string[]}) => {
            reduced.push(input.events.join("/"));
            await gate;
            return `归纳：${input.anchor ?? "未知"}`;
        }};
        const service = await open({now: 0}, {reducer});
        await service.publish(entryRequest("星瑾", 1));
        await service.publish(noteRequest(2));
        const events: ServiceEvent[] = [];
        service.subscribe((event) => events.push(event));
        const attitude = (from: WorldService) => {
            const read = from.entry("e1", {kind: "chapter", chapter: "ch1", edge: "end"}, "actual");
            return read === "chapter-not-found" ? read : read?.view?.namespaces.character?.fields.态度;
        };
        expect(attitude(service)).toEqual({value: "冷淡；之后：软了一点", notReduced: true, unreduced: {anchor: "冷淡", events: 1}});
        release();
        await service.idle();
        expect(events).toContainEqual({kind: "reduced"});
        expect(attitude(service)).toEqual({value: "归纳：冷淡"});
        const reopened = await open({now: 0}, {reducer});
        expect(attitude(reopened)).toEqual({value: "归纳：冷淡"});
        await reopened.idle();
        expect(reduced).toHaveLength(1);
    });

    test("发布后排上最新一章末尾缺的归纳，不等有人读", async () => {
        // 场景：已经写到第 3 章，回头改第 1 章的记账。发布只在第 1 章末尾核对影响；最新一章末尾的事件更多，
        // 那里的归纳要靠发布后另排。
        const inputs: string[] = [];
        const reducer = {version: "m1", reduce: async (input: {anchor: string | null; events: readonly string[]}) => {
            inputs.push(`${input.anchor ?? ""}|${input.events.join("/")}`);
            return "归纳";
        }};
        const service = await open({now: 0}, {reducer});
        await service.publish(entryRequest("星瑾", 1));
        await service.publish(noteRequest(2, "ch1", "软了一点"));
        await service.publish(noteRequest(3, "ch2", "叫了一声哥"));
        await service.idle();
        const target = service.world.data.entries.get("e1")!;
        const warmer = {...target, init: {...target.init, data: {character: {...target.init.data.character!, fields: {...target.init.data.character!.fields, 态度: "热情"}}}}};
        await service.publish({requestId: "rewrite-ch1", by: {kind: "author"}, what: "edit", title: "改第 1 章", baseVersion: 4, chapter: "ch1", puts: [{ref: {kind: "entry", id: "e1"}, after: warmer}]});
        await service.idle();
        expect(inputs).toContain("热情|软了一点/叫了一声哥");
        const read = service.entry("e1", latest, "actual");
        expect(read !== "chapter-not-found" && read?.view?.namespaces.character?.fields.态度).toEqual({value: "归纳"});
    });

    test("小模型失败写诊断，值保持未归纳；下次读到再排，补上后读到归纳", async () => {
        let fail = true;
        const reducer = {version: "m1", reduce: async () => {
            if (fail) throw new Error("模型超时");
            return "归纳";
        }};
        const service = await open({now: 0}, {reducer});
        await service.publish(entryRequest("星瑾", 1));
        await service.publish(noteRequest(2));
        await service.idle();
        expect(service.status().diagnostics).toContainEqual({code: "reduce-failed", message: "模型超时"});
        fail = false;
        const before = service.entry("e1", latest, "actual");
        expect(before !== "chapter-not-found" && before?.view?.namespaces.character?.fields.态度).toMatchObject({notReduced: true});
        await service.idle();
        const after = service.entry("e1", latest, "actual");
        expect(after !== "chapter-not-found" && after?.view?.namespaces.character?.fields.态度).toEqual({value: "归纳"});
    });

    test("归纳缓存里的坏行跳过并写诊断", async () => {
        await mkdir(join(root, ".nbook", "cache"), {recursive: true});
        await writeFile(join(root, ".nbook", "cache", "reductions.jsonl"), `坏行\n${JSON.stringify({key: "k", text: "t"})}\n`);
        const service = await open();
        expect(service.status().diagnostics).toContainEqual({code: "reduction-cache-bad-line", line: 1});
    });

    test("游标记着版本，世界前进后再用得到 cursor-stale", async () => {
        const service = await open();
        for (const name of ["甲", "乙", "丙"]) await service.publish(entryRequest(name, service.status().version));
        const first = service.tree(null, undefined, 2);
        if (first === "cursor-stale" || first.cursor === undefined) throw new Error("no cursor");
        expect(first.items.map((item) => item.name)).toEqual(["甲", "乙"]);
        await service.publish(entryRequest("丁", service.status().version));
        expect(service.tree(null, first.cursor, 2)).toBe("cursor-stale");
    });

    test("停止：正在落盘的那次做完，排着的得到 stopping，独占结束", async () => {
        await open();
        const paused = pausedAppend();
        const service = await open({now: 0}, {}, paused.files);
        const lease = service.acquireExclusive("记账") as {token: string};
        const inFlight = service.publish(entryRequest("甲", 1), lease.token);
        const queued = service.publish(entryRequest("乙", 1), lease.token);
        await paused.reached;
        const stopped = service.stop();
        paused.release();
        await stopped;
        expect((await inFlight).ok).toBe(true);
        expect(await queued).toEqual({ok: false, failure: {code: "stopping"}});
        expect(service.status().exclusive).toBeNull();
        expect(await service.publish(entryRequest("丙", 2))).toEqual({ok: false, failure: {code: "stopping"}});
    });
});

describe("canon.project：审查补的边界（输出 6、10、11、16、19、23 与方法表）", () => {
    test("打开时活页夹清单就是坏的：按日志里记下的章序计算，不发布章序调整，写诊断（输出 23）", async () => {
        const first = await open();
        await first.publish(entryRequest("星瑕", 1));
        const reopened = await WorldService.open(ports({now: 0}), {chapters: "invalid", registry});
        if ("code" in reopened) throw new Error(reopened.code);
        services.push(reopened);
        expect(reopened.status().version).toBe(2);
        expect(reopened.world.options.order.ids).toEqual(chapters);
        expect(reopened.status().diagnostics).toContainEqual({code: "binder-invalid"});
    });

    test("发布等待落盘时换了 Component 登记：落盘后的世界用新登记（输出 6）", async () => {
        await open();
        const paused = pausedAppend();
        const service = await open({now: 0}, {}, paused.files);
        const publishing = service.publish(entryRequest("星瑕", 1));
        await paused.reached;
        const swapped = service.setRegistries({registry: buildRegistry([PANEL])});
        paused.release();
        expect((await publishing).ok).toBe(true);
        await swapped;
        expect(service.world.options.registry.digest).toBe(buildRegistry([PANEL]).digest);
    });

    test("归纳写进缓存失败：不当作已补上，下次读到再排（输出 11）", async () => {
        let failCache = true;
        const files: LogFiles = {...nodeFiles, async append(path, bytes) {
            if (failCache && path.endsWith("reductions.jsonl")) {
                failCache = false;
                throw new Error("EIO: cache");
            }
            await nodeFiles.append(path, bytes);
        }};
        let calls = 0;
        const reducer = {version: "m1", reduce: async () => {
            calls += 1;
            return "归纳";
        }};
        const service = await open({now: 0}, {reducer}, files);
        await service.publish(entryRequest("星瑾", 1));
        await service.publish(noteRequest(2));
        await service.idle();
        expect(service.status().diagnostics).toContainEqual({code: "reduce-failed", message: "EIO: cache"});
        const read = () => {
            const view = service.entry("e1", latest, "actual");
            return view === "chapter-not-found" ? view : view?.view?.namespaces.character?.fields.态度;
        };
        // 失败的那次没留在内存里：同一次发布后排的那次读到它时又排了一次，这次写进了缓存。
        await service.idle();
        expect(read()).toEqual({value: "归纳"});
        expect(calls).toBe(2);
        expect(await readFile(join(root, ".nbook", "cache", "reductions.jsonl"), "utf8")).toContain("归纳");
    });

    test("独占到期时主动结束、发事件，不等下一次调用；续期过的按新的到期时间（输出 10）", async () => {
        const clock = {now: 0};
        const timers: Array<{at: number; run: () => void; cleared: boolean}> = [];
        const timer = {
            set: (ms: number, run: () => void) => {
                const handle = {at: clock.now + ms, run, cleared: false};
                timers.push(handle);
                return handle;
            },
            clear: (handle: unknown) => {
                (handle as {cleared: boolean}).cleared = true;
            },
        };
        const advance = (ms: number) => {
            clock.now += ms;
            for (const handle of timers.filter((item) => !item.cleared && item.at <= clock.now)) {
                handle.cleared = true;
                handle.run();
            }
        };
        const service = await open(clock, {timer});
        const events: ServiceEvent[] = [];
        service.subscribe((event) => events.push(event));
        const lease = service.acquireExclusive("记账") as {token: string};
        advance(50_000);
        service.renewExclusive(lease.token);
        advance(LEASE_MS - 50_000);
        expect(events.filter((event) => event.kind === "exclusive")).toEqual([{kind: "exclusive", holder: "记账"}]);
        advance(50_000);
        expect(events.filter((event) => event.kind === "exclusive")).toEqual([{kind: "exclusive", holder: "记账"}, {kind: "exclusive", holder: null}]);
    });

    test("决策按游标分页（方法表）；改动记录按条目筛选时，自由文字里写到条目 id 不算（方法表）", async () => {
        const service = await open();
        const decisions: WriteRequest["puts"] = ["甲", "乙", "丙"].map((text, index) => ({ref: {kind: "decision", id: `tmp:d${String(index)}`}, after: {id: `tmp:d${String(index)}`, text, status: "pending", about: [], hints: []}}));
        expect((await service.publish({requestId: "decisions", by: {kind: "author"}, what: "edit", title: "决策", baseVersion: 1, puts: decisions})).ok).toBe(true);
        const first = service.decisions({}, undefined, 2);
        if (first === "cursor-stale" || first.cursor === undefined) throw new Error("no cursor");
        expect(first.items.map((item) => item.decision.text)).toEqual(["甲", "乙"]);
        const second = service.decisions({}, first.cursor, 2);
        expect(second !== "cursor-stale" && second.items.map((item) => item.decision.text)).toEqual(["丙"]);

        expect((await service.publish(entryRequest("星瑕", 2))).ok).toBe(true);
        const mention = {requestId: "mention", by: {kind: "author"}, what: "edit", title: "e1", baseVersion: 3, puts: [{ref: {kind: "change", id: "tmp:c"}, after: {id: "tmp:c", kind: "written", text: "e1", at: {kind: "chapter", chapter: "ch1", key: 0}, told: [], involves: [], lines: [], links: [], patches: [], status: "active", by: {kind: "author"}}}]} as WriteRequest;
        expect((await service.publish(mention)).ok).toBe(true);
        const filtered = service.revisions({entry: "e1"});
        expect(filtered !== "cursor-stale" && filtered.items.map((item) => item.title)).toEqual(["星瑕"]);
    });
});

describe("canon.project 方法表 object：按 id 读存下来的对象", () => {
    test("读到的是存下来的原样，可以直接改了再写；没有时为 null", async () => {
        const service = await open();
        await service.publish(entryRequest("星瑕", 1));
        const read = service.object({kind: "entry", id: "e1"});
        expect(read).toMatchObject({version: 2, object: {id: "e1", init: {name: "星瑕"}}});
        const entry = read.object as Entry;
        expect((await service.publish({requestId: "rename", by: {kind: "author"}, what: "edit", title: "改名", baseVersion: read.version, puts: [{ref: {kind: "entry", id: "e1"}, after: {...entry, init: {...entry.init, aliases: ["瑕"]}}}]})).ok).toBe(true);
        expect(service.object({kind: "check", id: "k9"})).toMatchObject({version: 3, object: null});
    });
});

describe("canon.model 输出 36、canon.project 输出 19、25：正文快照、读取输入与游标", () => {
    const tellRequest = (quote: string, baseVersion: number): WriteRequest => ({requestId: `tell-${String(++sequence)}`, by: {kind: "author"}, what: "edit", title: "讲述", baseVersion, puts: [{ref: {kind: "change", id: "tmp:c"}, after: {id: "tmp:c", kind: "written", text: quote, at: {kind: "chapter", chapter: "ch1", key: 0}, told: [{source: "chapter", chapter: "ch1", quote}], involves: [], lines: [], links: [], patches: [], status: "active", by: {kind: "author"}}}]});

    test("宿主改了正文、通知以后，原句按新正文校验；版本不变，正文快照与读取输入的摘要变了，发 textChanged", async () => {
        const texts = new Map([["ch1", "她走进雨里。"]]);
        const service = await open({now: 0}, {chapterText: (chapter) => texts.get(chapter)});
        const events: ServiceEvent[] = [];
        service.subscribe((event) => events.push(event));
        const before = service.status();
        texts.set("ch1", "她撑开了伞。");
        expect((await service.publish(tellRequest("她撑开了伞", before.version))).ok).toBe(false);
        service.textChanged("ch1");
        const after = service.status();
        expect(after.version).toBe(before.version);
        expect(after.textDigest).not.toBe(before.textDigest);
        expect(after.inputDigest).not.toBe(before.inputDigest);
        expect(events).toContainEqual({kind: "textChanged", chapter: "ch1"});
        expect((await service.publish(tellRequest("她撑开了伞", after.version))).ok).toBe(true);
    });

    test("正文变了，版本没变，翻页的旧游标也得到 cursor-stale", async () => {
        const texts = new Map([["ch1", "第一稿"]]);
        const service = await open({now: 0}, {chapterText: (chapter) => texts.get(chapter)});
        for (const [index, name] of ["甲", "乙", "丙"].entries()) expect((await service.publish(entryRequest(name, 1 + index))).ok).toBe(true);
        const first = service.tree(null, undefined, 2);
        if (first === "cursor-stale" || first.cursor === undefined) throw new Error("no cursor");
        texts.set("ch1", "第二稿");
        service.textChanged("ch1");
        expect(service.tree(null, first.cursor, 2)).toBe("cursor-stale");
    });

    test("游标记着读取参数：换了筛选或方法接着翻得到 cursor-stale；只换条数照常接着翻", async () => {
        const service = await open();
        const changes: WriteRequest["puts"] = ["ch1", "ch1", "ch2", "ch2"].map((chapter, index) => ({ref: {kind: "change", id: `tmp:c${String(index)}`}, after: {id: `tmp:c${String(index)}`, kind: "written", text: `第 ${String(index)} 条`, at: {kind: "chapter", chapter, key: index}, told: [], involves: [], lines: [], links: [], patches: [], status: "active", by: {kind: "author"}}}));
        expect((await service.publish({requestId: "four", by: {kind: "author"}, what: "edit", title: "四条", baseVersion: 1, puts: changes})).ok).toBe(true);
        const first = service.changes({chapter: "ch1"}, undefined, 1);
        if (first === "cursor-stale" || first.cursor === undefined) throw new Error("no cursor");
        expect(service.changes({chapter: "ch2"}, first.cursor, 1)).toBe("cursor-stale");
        expect(service.tellings({}, first.cursor, 1)).toBe("cursor-stale");
        const rest = service.changes({chapter: "ch1"}, first.cursor, 5);
        expect(rest !== "cursor-stale" && rest.items.map((item) => item.change.text)).toEqual(["第 1 条"]);
    });

    test("同一份读取输入两次读取，戳逐字相同；重开后同样的日志与正文得到同样的戳", async () => {
        const texts = new Map([["ch1", "她走进雨里。"]]);
        const service = await open({now: 0}, {chapterText: (chapter) => texts.get(chapter)});
        expect((await service.publish(entryRequest("星瑕", 1))).ok).toBe(true);
        const stamp = (from: WorldService) => {
            const read = from.object({kind: "entry", id: "e1"});
            return {version: read.version, textDigest: read.textDigest, inputDigest: read.inputDigest};
        };
        expect(stamp(service)).toEqual(stamp(service));
        const first = stamp(service);
        await service.stop();
        const reopened = await open({now: 0}, {chapterText: (chapter) => texts.get(chapter)});
        expect(stamp(reopened)).toEqual(first);
    });
});
