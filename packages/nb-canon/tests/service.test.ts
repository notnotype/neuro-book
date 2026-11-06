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
        // 日志没读全：内存里没有这个请求不等于没发布（输出 16）。
        expect(reader.outcome("没记录的请求")).toEqual({code: "write-unknown"});
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
            return typeof read === "string" ? read : read?.view?.namespaces.character?.fields.态度;
        };
        expect(attitude(service)).toEqual({label: "现在的态度", value: "冷淡；之后：软了一点", notReduced: true, unreduced: {anchor: "冷淡", events: 1}});
        release();
        await service.idle();
        expect(events).toContainEqual({kind: "reduced"});
        expect(attitude(service)).toEqual({label: "现在的态度", value: "归纳：冷淡"});
        const reopened = await open({now: 0}, {reducer});
        expect(attitude(reopened)).toEqual({label: "现在的态度", value: "归纳：冷淡"});
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
        expect(typeof read !== "string" && read?.view?.namespaces.character?.fields.态度).toEqual({label: "现在的态度", value: "归纳"});
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
        expect(typeof before !== "string" && before?.view?.namespaces.character?.fields.态度).toMatchObject({notReduced: true});
        await service.idle();
        const after = service.entry("e1", latest, "actual");
        expect(typeof after !== "string" && after?.view?.namespaces.character?.fields.态度).toEqual({label: "现在的态度", value: "归纳"});
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
        if (typeof first === "string" || first.cursor === undefined) throw new Error("no cursor");
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
            return typeof view === "string" ? view : view?.view?.namespaces.character?.fields.态度;
        };
        // 失败的那次没留在内存里：同一次发布后排的那次读到它时又排了一次，这次写进了缓存。
        await service.idle();
        expect(read()).toEqual({label: "现在的态度", value: "归纳"});
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
        if (typeof first === "string" || first.cursor === undefined) throw new Error("no cursor");
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
        // 读取视图读到的是正文快照：改过的正文与它的摘要；没有这一章时是 undefined 与 null。
        const {view} = service.snapshot();
        expect(view.chapterText("ch1")).toBe(texts.get("ch1"));
        expect(view.chapterTextDigest("ch1")).toBe(createHash("sha256").update(texts.get("ch1")!).digest("hex"));
        expect(view.chapterText("no-such")).toBeUndefined();
        expect(view.chapterTextDigest("no-such")).toBeNull();
        // 登记与历法那一部分的摘要：正文变了它不变（判断“依赖变没变”时不被正文带着变）。
        const declarations = view.declarationsDigest();
        texts.set("ch1", "又一稿");
        service.textChanged("ch1");
        expect(service.snapshot().view.declarationsDigest()).toBe(declarations);
        texts.set("ch1", "她撑开了伞。");
        service.textChanged("ch1");
        expect((await service.publish(tellRequest("她撑开了伞", after.version))).ok).toBe(true);
    });

    test("正文变了，版本没变，翻页的旧游标也得到 cursor-stale", async () => {
        const texts = new Map([["ch1", "第一稿"]]);
        const service = await open({now: 0}, {chapterText: (chapter) => texts.get(chapter)});
        for (const [index, name] of ["甲", "乙", "丙"].entries()) expect((await service.publish(entryRequest(name, 1 + index))).ok).toBe(true);
        const first = service.tree(null, undefined, 2);
        if (typeof first === "string" || first.cursor === undefined) throw new Error("no cursor");
        texts.set("ch1", "第二稿");
        service.textChanged("ch1");
        expect(service.tree(null, first.cursor, 2)).toBe("cursor-stale");
    });

    test("游标记着读取参数：换了筛选或方法接着翻得到 cursor-stale；只换条数照常接着翻", async () => {
        const service = await open();
        const changes: WriteRequest["puts"] = ["ch1", "ch1", "ch2", "ch2"].map((chapter, index) => ({ref: {kind: "change", id: `tmp:c${String(index)}`}, after: {id: `tmp:c${String(index)}`, kind: "written", text: `第 ${String(index)} 条`, at: {kind: "chapter", chapter, key: index}, told: [], involves: [], lines: [], links: [], patches: [], status: "active", by: {kind: "author"}}}));
        expect((await service.publish({requestId: "four", by: {kind: "author"}, what: "edit", title: "四条", baseVersion: 1, puts: changes})).ok).toBe(true);
        const first = service.changes({chapter: "ch1"}, undefined, 1);
        if (typeof first === "string" || first.cursor === undefined) throw new Error("no cursor");
        expect(service.changes({chapter: "ch2"}, first.cursor, 1)).toBe("cursor-stale");
        expect(service.tellings({}, first.cursor, 1)).toBe("cursor-stale");
        const rest = service.changes({chapter: "ch1"}, first.cursor, 5);
        expect(typeof rest !== "string" && rest.items.map((item) => item.change.text)).toEqual(["第 1 条"]);
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

describe("canon.project 方法表 status：重算量与耗时", () => {
    test("打开后有打开的一份；发布后有发布的一份", async () => {
        const service = await open();
        const opened = service.status().work;
        expect(opened.open).toEqual({recomputed: expect.any(Number), ms: expect.any(Number)});
        expect(opened.open!.ms).toBeGreaterThanOrEqual(0);
        expect((await service.publish(entryRequest("星瑕", 1))).ok).toBe(true);
        expect(service.status().work.publish).toEqual({recomputed: expect.any(Number), ms: expect.any(Number)});
        // 发布一条会套上的变更：这次要算它，重算量不是 0。
        const change = {id: "tmp:c", kind: "written", text: "变", at: {kind: "chapter", chapter: "ch1", key: 1}, told: [], involves: [], lines: [], links: [], patches: [{op: "set", at: {entry: "e1", path: "entry.summary"}, value: "新"}], status: "active", by: {kind: "author"}};
        const published = await service.publish({requestId: "work-change", by: {kind: "author"}, what: "edit", title: "变", baseVersion: service.status().version, puts: [{ref: {kind: "change", id: "tmp:c"}, after: change as never}]});
        expect(published.ok).toBe(true);
        expect(service.status().work.publish!.recomputed).toBeGreaterThan(0);
    });
});

describe("canon.project 输出 5、16、17：结局与读进别的进程的行", () => {
    test("读进别的进程的几行：第一条 changed 里读到的已是读全了的世界", async () => {
        const writer = await open();
        const reader = await open();
        const versions: number[] = [];
        reader.subscribe((event) => {
            if (event.kind === "changed") versions.push(reader.status().version);
        });
        expect((await writer.publish(entryRequest("星瑕", 1))).ok).toBe(true);
        expect((await writer.publish(entryRequest("星瑾", 2))).ok).toBe(true);
        await reader.externalChanged();
        expect(versions).toEqual([3, 3]);
    });
});

describe("canon.model 输出 14：按名字找条目", () => {
    test("尚未出场的条目不在结果里，出场以后才找得到；别名同样；删除的条目不返回", async () => {
        const service = await open();
        const request = entryRequest("白灵", 1);
        const entry = request.puts[0]!.after as Entry;
        const appearing: Entry = {...entry, init: {...entry.init, aliases: ["小白"]}, appears: {kind: "chapter", chapter: "ch3", key: 0}};
        expect((await service.publish({...request, puts: [{ref: request.puts[0]!.ref, after: appearing}]})).ok).toBe(true);
        const at = (chapter: string, edge: "start" | "end") => service.lookup(["白灵", "小白"], {kind: "chapter", chapter, edge});
        expect(at("ch2", "end")).toMatchObject({found: {白灵: [], 小白: []}});
        expect(at("ch3", "start")).toMatchObject({found: {白灵: [], 小白: []}});
        expect(at("ch3", "end")).toMatchObject({found: {白灵: ["e1"], 小白: ["e1"]}});

        const stored = service.object({kind: "entry", id: "e1"}).object as Entry;
        expect((await service.publish({requestId: "delete", by: {kind: "author"}, what: "edit", title: "删除", baseVersion: 2, puts: [{ref: {kind: "entry", id: "e1"}, after: {...stored, deleted: true}}]})).ok).toBe(true);
        expect(at("ch3", "end")).toMatchObject({found: {白灵: [], 小白: []}});
    });
});

describe("canon.model 输出 23：父条目被删除以后的条目树", () => {
    test("子条目照常存在，仍在原父条目下面，父条目在树里显示为已删除", async () => {
        const service = await open();
        expect((await service.publish(entryRequest("父", 1))).ok).toBe(true);
        const child = entryRequest("子", 2);
        const childEntry = child.puts[0]!.after as Entry;
        expect((await service.publish({...child, puts: [{ref: child.puts[0]!.ref, after: {...childEntry, parent: "e1"}}]})).ok).toBe(true);
        const parent = service.object({kind: "entry", id: "e1"}).object as Entry;
        expect((await service.publish({requestId: "delete-parent", by: {kind: "author"}, what: "edit", title: "删除父条目", baseVersion: 3, puts: [{ref: {kind: "entry", id: "e1"}, after: {...parent, deleted: true}}]})).ok).toBe(true);

        const roots = service.tree(null);
        const below = service.tree("e1");
        expect(roots !== "cursor-stale" && roots.items).toEqual([expect.objectContaining({id: "e1", name: "父", deleted: true, hasChildren: true})]);
        expect(below !== "cursor-stale" && below.items).toEqual([expect.objectContaining({id: "e2", name: "子", deleted: false})]);
    });
});

describe("canon.model 输出 17、正文建议的状态：写入、读取、状态只由修订改变", () => {
    const suggestion = (status: "open" | "applied" | "declined", extra: Record<string, unknown> = {}) => ({
        id: "tmp:s", cause: "r2", target: {kind: "chapter" as const, chapter: "ch2"}, group: "称呼", before: "她叫他先生", after: "她叫他哥哥" as string | null, reason: "星瑾改口了", judgment: "ask" as const, found: "agent" as const, status, ...extra,
    });
    const suggest = (baseVersion: number, put: WriteRequest["puts"][number]): WriteRequest => ({requestId: `suggest-${String(++sequence)}`, by: {kind: "agent", session: "改稿"}, what: "suggest", title: "称呼要改", baseVersion, puts: [put]});
    const itemsOf = (service: WorldService, status?: "open" | "applied" | "declined") => {
        const page = service.suggestions(status);
        if (page === "cursor-stale") throw new Error("cursor-stale");
        return page.items;
    };
    const openCount = (service: WorldService) => {
        const page = service.pending();
        if (typeof page === "string") throw new Error(page);
        return page.suggestionsOpen;
    };

    test("写进去得到 s 开头的号；读取原样给出，按状态筛；待处理页数着未处理的条数", async () => {
        const service = await open();
        expect((await service.publish(entryRequest("星瑕", 1))).ok).toBe(true);
        const written = await service.publish(suggest(2, {ref: {kind: "suggestion", id: "tmp:s"}, after: suggestion("open") as never}));
        expect(written.ok && written.ids).toEqual({"tmp:s": "s1"});
        // “建议不改”：after 为空。
        expect((await service.publish(suggest(3, {ref: {kind: "suggestion", id: "tmp:t"}, after: suggestion("open", {id: "tmp:t", after: null, judgment: "notThisOne", found: "linked"}) as never}))).ok).toBe(true);

        expect(itemsOf(service).map((item) => item.id)).toEqual(["s1", "s2"]);
        expect(itemsOf(service)[0]).toEqual({...suggestion("open"), id: "s1"});
        expect(itemsOf(service)[1]).toMatchObject({id: "s2", after: null, judgment: "notThisOne", found: "linked"});
        expect(itemsOf(service, "open")).toHaveLength(2);
        expect(itemsOf(service, "applied")).toEqual([]);
        expect(openCount(service)).toBe(2);
    });

    test("状态由修订改变：采纳与不采纳各进自己的筛选，不再算未处理；还原那次修订，状态回到未处理", async () => {
        const service = await open();
        expect((await service.publish(entryRequest("星瑕", 1))).ok).toBe(true);
        expect((await service.publish(suggest(2, {ref: {kind: "suggestion", id: "tmp:s"}, after: suggestion("open") as never}))).ok).toBe(true);
        expect((await service.publish(suggest(3, {ref: {kind: "suggestion", id: "tmp:t"}, after: suggestion("open", {id: "tmp:t"}) as never}))).ok).toBe(true);

        const applied = await service.publish({...suggest(4, {ref: {kind: "suggestion", id: "s1"}, after: {...suggestion("applied"), id: "s1"} as never}), by: {kind: "author"}, what: "resolve"});
        expect(applied.ok).toBe(true);
        expect((await service.publish({...suggest(5, {ref: {kind: "suggestion", id: "s2"}, after: {...suggestion("declined"), id: "s2"} as never}), by: {kind: "author"}, what: "resolve"})).ok).toBe(true);
        expect(itemsOf(service, "applied").map((item) => item.id)).toEqual(["s1"]);
        expect(itemsOf(service, "declined").map((item) => item.id)).toEqual(["s2"]);
        expect(itemsOf(service, "open")).toEqual([]);
        expect(openCount(service)).toBe(0);

        if (!applied.ok) throw new Error("not applied");
        const undone = await service.revert(applied.revision.id, false, {requestId: "undo-apply", by: {kind: "author"}});
        expect(undone.ok).toBe(true);
        expect(itemsOf(service, "open").map((item) => item.id)).toEqual(["s1"]);
        expect(openCount(service)).toBe(1);
    });
});

describe("canon.revisions 输出 14：改动记录按章、按写入者筛，并给出能不能还原", () => {
    const itemsOf = (service: WorldService, filter: Parameters<WorldService["revisions"]>[0] = {}) => {
        const page = service.revisions(filter);
        if (page === "cursor-stale") throw new Error("cursor-stale");
        return page.items;
    };

    test("按章、按写入者筛；不能还原的给原因（有依赖、章序调整），能还原的标可以", async () => {
        const service = await open();
        expect((await service.publish(entryRequest("星瑕", 1))).ok).toBe(true);
        expect((await service.publish({...noteRequest(2, "ch1", "软了一点"), chapter: "ch1"})).ok).toBe(true);
        expect((await service.publish({...noteRequest(3, "ch2", "叫了一声哥"), chapter: "ch2", by: {kind: "agent", session: "记账"}})).ok).toBe(true);

        expect(itemsOf(service).map((item) => item.version)).toEqual([4, 3, 2, 1]);
        expect(itemsOf(service, {chapter: "ch1"}).map((item) => item.version)).toEqual([3]);
        expect(itemsOf(service, {chapter: "ch2"}).map((item) => item.version)).toEqual([4]);
        expect(itemsOf(service, {by: "agent"}).map((item) => item.version)).toEqual([4]);
        expect(itemsOf(service, {by: "system"}).map((item) => item.version)).toEqual([1]);
        expect(itemsOf(service, {by: "author"}).map((item) => item.version)).toEqual([3, 2]);

        const byVersion = new Map(itemsOf(service).map((item) => [item.version, item]));
        // 星瑕是第 2 版新建的，后面两次修订都在它身上记了事件，所以还原它得连同依赖一起。
        expect(byVersion.get(2)!.revertable).toEqual({ok: false, reason: "has-dependents", dependents: [byVersion.get(3)!.id, byVersion.get(4)!.id]});
        expect(byVersion.get(4)!.revertable).toEqual({ok: true});
        expect(byVersion.get(1)!.revertable).toEqual({ok: false, reason: "not-revertable"});
    });
});

describe("canon.components 输出 18：改动记录按条目筛选，指向这个条目的引用也算", () => {
    test("新写的剧情变更涉及这个条目（引用）：出现在这个条目下；自由文字里写到条目 id 的不算", async () => {
        const service = await open();
        expect((await service.publish(entryRequest("星瑕", 1))).ok).toBe(true);
        expect((await service.publish(entryRequest("星瑾", 2))).ok).toBe(true);
        const change = (text: string, involves: string[]): WriteRequest => ({requestId: `involve-${String(++sequence)}`, by: {kind: "author"}, what: "edit", title: text, baseVersion: 0, puts: [{ref: {kind: "change", id: "tmp:c"}, after: {id: "tmp:c", kind: "written", text, at: {kind: "chapter", chapter: "ch1", key: 0}, told: [], involves, lines: [], links: [], patches: [], status: "active", by: {kind: "author"}}}]});
        expect((await service.publish({...change("涉及星瑕", ["e1"]), baseVersion: 3})).ok).toBe(true);
        expect((await service.publish({...change("e1", []), baseVersion: 4})).ok).toBe(true);
        const filtered = service.revisions({entry: "e1"});
        expect(filtered !== "cursor-stale" && filtered.items.map((item) => item.title)).toEqual(["涉及星瑕", "星瑕"]);
    });
});

describe("canon.model 边界与兼容、canon.revisions 边界与兼容：未知的字段原样保留", () => {
    test("对象里未知的字段（顶层与初值里）不报错、不丢弃：写入、读取、重开以后都在，计算照常", async () => {
        const service = await open();
        const request = entryRequest("星瑕", 1);
        const entry = request.puts[0]!.after as Entry;
        const future = {...entry, 将来的字段: {层级: [1, 2]}, init: {...entry.init, 将来的初值项: "x"}};
        expect((await service.publish({...request, puts: [{ref: request.puts[0]!.ref, after: future as Entry}]})).ok).toBe(true);
        const change = {id: "tmp:c", kind: "written", text: "有未知字段的变更", at: {kind: "chapter", chapter: "ch1", key: 0}, told: [], involves: ["e1"], lines: [], links: [], patches: [{op: "set", at: {entry: "e1", path: "character.状态"}, value: "出门", 补丁上的未知项: true}], status: "active", by: {kind: "author"}, 将来的字段: "y"};
        expect((await service.publish({requestId: "future-change", by: {kind: "author"}, what: "edit", title: "变更", baseVersion: 2, puts: [{ref: {kind: "change", id: "tmp:c"}, after: change as never}]})).ok).toBe(true);
        const decision = {id: "tmp:d", text: "要定的事", status: "pending", about: [], hints: [], 将来的字段: [1]};
        expect((await service.publish({requestId: "future-decision", by: {kind: "author"}, what: "edit", title: "决策", baseVersion: 3, puts: [{ref: {kind: "decision", id: "tmp:d"}, after: decision as never}]})).ok).toBe(true);

        const check = async (opened: WorldService) => {
            expect(opened.object({kind: "entry", id: "e1"}).object).toMatchObject({将来的字段: {层级: [1, 2]}, init: {将来的初值项: "x"}});
            expect(opened.object({kind: "change", id: "c1"}).object).toMatchObject({将来的字段: "y", patches: [{补丁上的未知项: true}]});
            expect(opened.object({kind: "decision", id: "d1"}).object).toMatchObject({将来的字段: [1]});
            const read = opened.entry("e1", latest, "actual");
            expect(read).not.toBeNull();
            expect(read).not.toBe("chapter-not-found");
            expect(read).not.toBe("line-not-found");
            const view = typeof read === "object" && read !== null ? read.view : null;
            expect(view?.namespaces.character!.fields.状态).toEqual({value: "出门"});
        };
        await check(service);
        await check(await open());
    });

    test("修订里未知的字段（更新的版本写的）原样保留：重开以后修订里还在，世界可写，之后的修订照常追加", async () => {
        const first = await open();
        expect((await first.publish(entryRequest("星瑕", 1))).ok).toBe(true);
        await first.stop();
        const lines = (await readFile(segment(), "utf8")).trim().split("\n");
        const tail = JSON.parse(lines.at(-1)!) as Record<string, unknown>;
        await writeFile(segment(), `${[...lines.slice(0, -1), JSON.stringify({...tail, 将来的字段: {版本: 9}})].join("\n")}\n`);

        const reopened = await open();
        expect(reopened.status()).toMatchObject({version: 2, state: "writable"});
        expect(reopened.world.revisions.at(-1)).toMatchObject({version: 2, 将来的字段: {版本: 9}});
        expect((await reopened.publish(entryRequest("星瑾", 2))).ok).toBe(true);
        expect((await open()).status().version).toBe(3);
    });
});

describe("canon.project 输出 7、8（补）：写盘结局不确定与重号", () => {
    test("写完以后发现尾部多了别的进程的行（重号）：转只读并写诊断 duplicate-version，这次请求报 world-read-only", async () => {
        await open();
        // 真实追加之后，在同一次持锁期间再并进一行：模拟锁被判残留、别的进程同时写入。
        const racing: LogFiles = {...nodeFiles, async append(path, bytes) {
            await nodeFiles.append(path, bytes);
            await appendFile(path, '{"format":1,"version":2}\n');
        }};
        const service = await open({now: 0}, {}, racing);
        const result = await service.publish(entryRequest("星瑕", 1));
        expect(result).toMatchObject({ok: false, failure: {code: "world-read-only", reason: "duplicate-version"}});
        expect(service.status().state).toBe("read-only");
        expect(service.status().diagnostics).toContainEqual({code: "duplicate-version"});
        expect(await service.publish(entryRequest("星瑾", 1))).toMatchObject({ok: false, failure: {code: "world-read-only"}});
    });

    test("写盘结局不确定，重开项目以后：日志里有这次的请求 id 就是已发布，没有就是没发布", async () => {
        await open();
        // 整行写进去了、报告却失败，又截不回：真实结局是已发布。
        const landed = await open({now: 0}, {}, faultyFiles({failAppend: {partial: 1e9}, failTruncate: true}));
        const first = entryRequest("星瑕", 1);
        expect(await landed.publish(first)).toMatchObject({ok: false, failure: {code: "write-unknown"}});
        expect(landed.outcome(first.requestId)).toEqual({code: "write-unknown"});
        const reopened = await open();
        expect(reopened.outcome(first.requestId)).toMatchObject({published: true, version: 2});
        // 只写进一半、截不回：日志里的半行不算数，重开以后没有这次的请求 id。
        const torn = await open({now: 0}, {}, faultyFiles({failAppend: {partial: 20}, failTruncate: true}));
        const second = entryRequest("星瑾", 2);
        expect(await torn.publish(second)).toMatchObject({ok: false, failure: {code: "write-unknown"}});
        const again = await open();
        expect(again.outcome(second.requestId)).toEqual({published: false});
    });
});
