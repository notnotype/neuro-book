/**
 * 统计记录的写入与停止（docs/specs/runtime/projects.md 输出第 16 条“持久化”“停止”，验收 17）。
 *
 * - 写入协议：真实的 Storage（user 分区是真实临时目录上的 SQLite）。两个写者是服务端实例里与窗口里以 `nbook.projects`
 *   身份拿到的 Storage 服务，写同一条记录；窗口的链路可以扣住回复、断线重连，制造真实的“结果未知”。时间用场地的手动时钟。
 * - 停止：真实项目子进程（`projectHarness`），里面是产品的 `nbook.projects` 项目入口，服务端装真实的 Storage；服务端的
 *   测试插件以服务端插件的身份经 `{project}` 目标问 `nbook.projects/stats`。子进程里的时钟是系统时钟。
 */

import {Database} from "bun:sqlite";
import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {mkdir, readdir, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import type {DiagnosticInput} from "@notnotype/nb-runtime/diagnostics";
import {createDiagnosticsPlugin, createDiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import type {ActivationContext, PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {createConsoleExporterFactory, createConsoleFallback} from "nbook/plugins/diagnostics/web/console-exporter";
import {createLinkTap} from "nbook/plugins/files/testing/tap";
import type {LinkTap} from "nbook/plugins/files/testing/tap";
import {settingsWorld} from "nbook/plugins/settings/testing/world";
import type {SettingsWorld, WorldWindow} from "nbook/plugins/settings/testing/world";
import {ORIGINALS_MAX_COUNT} from "nbook/plugins/storage/backend/partition";
import {createPartition} from "nbook/plugins/storage/backend/partition";
import {storageBackendPlugin} from "nbook/plugins/storage/backend/plugin";
import {storageKey} from "nbook/plugins/storage/shared/contracts";
import {storageBrowserPlugin} from "nbook/plugins/storage/web/plugin";
import {alive, GRACE_MS, killSpawnedProjects, leaseOf, projectHarness, revoked} from "nbook/server/testing/projects";
import type {ProjectHarness, ProjectHarnessPaths} from "nbook/server/testing/projects";
import type {RecordSnapshot, StorageService} from "nbook/shared/storage";

import {descriptor} from "./plugin";
import {createStatsWriter, WRITE_INTERVAL_MS} from "./project/stats-writer";
import type {StatsWriter} from "./project/stats-writer";
import {projectStatsRemoteContract} from "./shared/contracts";
import type {ProjectStatsSnapshot} from "./shared/contracts";
import {PROJECT_STATS_RECORD} from "./shared/stats-record";

let tmp = "";
let counter = 0;
const closers: Array<() => Promise<void>> = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-projects", "stats-writer");
});

afterEach(async () => {
    killSpawnedProjects();
    for (const close of closers.splice(0).reverse()) await close();
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

/** 记录的资源 id：项目 id。 */
const PROJECT = "0b6f0c56-7f0e-4b8e-9d3c-5a2f4f1e2d3c";

function snapshot(computedAt: string, words: number): ProjectStatsSnapshot {
    return {computedAt, words, files: 1, unreadable: 0, today: {date: "2026-10-10", baseline: 0}, last: null};
}

/** 以 `nbook.projects` 的身份拿 Storage 服务的测试插件：服务端与浏览器各一个入口，各实例只激活本位置的。 */
function storageCapture(into: Map<string, StorageService>): PluginDefinition {
    return {
        id: descriptor.id,
        entries: (["server", "browser"] as const).map((location) => ({
            id: location,
            location,
            activationEvents: ["onStartup"],
            dependencies: [{key: storageKey}],
            activate: (context: ActivationContext) => {
                into.set(location, context.services.require(storageKey));
                return {};
            },
        })),
    };
}

interface WriterWorld {
    readonly world: SettingsWorld;
    readonly root: string;
    readonly hub: StorageService;
    readonly window: StorageService;
    readonly link: WorldWindow;
    readonly tap: LinkTap;
}

/** 服务端（拥有 user 分区）与一个不绑定项目的窗口，窗口的链路经 `tap` 观察与扣住。 */
async function writerWorld(): Promise<WriterWorld> {
    counter += 1;
    const root = join(tmp, `case-${String(counter)}`);
    const seen = new Map<string, StorageService>();
    const world = await settingsWorld(root, [storageBackendPlugin, storageCapture(seen)]);
    closers.push(async () => {
        const results = await world.close();
        await rm(root, {recursive: true, force: true});
        for (const result of results) expect(result).toMatchObject({status: "closed"});
    });
    const tap = createLinkTap();
    const link = await world.window("w", [storageBrowserPlugin, storageCapture(seen)], {bound: false, wrapLink: tap.wrap});
    return {world, root, hub: seen.get("server")!, window: seen.get("browser")!, link, tap};
}

interface Writing {
    readonly writer: StatsWriter;
    readonly records: Array<Omit<DiagnosticInput, "source">>;
    /** 下一次写入要写的快照。 */
    set(value: ProjectStatsSnapshot | null): void;
}

function writerOn(w: WriterWorld, storage: StorageService): Writing {
    let current: ProjectStatsSnapshot | null = null;
    const records: Array<Omit<DiagnosticInput, "source">> = [];
    const writer = createStatsWriter({
        clock: w.world.clock,
        open: () => storage.open(PROJECT_STATS_RECORD, PROJECT),
        snapshot: () => current,
        record: (input) => records.push(input),
    });
    return {writer, records, set: (value) => (current = value)};
}

async function stored(storage: StorageService, resource = PROJECT): Promise<RecordSnapshot<ProjectStatsSnapshot>> {
    const opened = await storage.open(PROJECT_STATS_RECORD, resource);
    if (!opened.ok) throw new Error(`${opened.code}：${opened.detail}`);
    return opened.handle.read();
}

const events = (writing: Writing): string[] => writing.records.map((record) => record.event);

describe("Spec projects 输出 16、验收 17：写入协议（真实 Storage）", () => {
    it("两个写者冲突时，computedAt 较新的胜出：较旧的一方重读后放弃，较新的一方以读到的 revision 重写", async () => {
        const w = await writerWorld();
        const server = writerOn(w, w.hub);
        const browser = writerOn(w, w.window);
        expect(await server.writer.load()).toBeNull();
        expect(await browser.writer.load()).toBeNull();

        server.set(snapshot("2026-10-10T10:00:02.000Z", 200));
        server.writer.changed();
        const first = await waitUntil("服务端一侧写成", async () => {
            const read = await stored(w.hub);
            return read.status === "ok" ? read : null;
        });
        expect(first.value.words).toBe(200);

        // 窗口一侧还以为没有记录，写一份更旧的：冲突、重读、放弃。
        browser.set(snapshot("2026-10-10T10:00:01.000Z", 100));
        browser.writer.changed();
        await waitUntil("较旧的一方放弃", () => events(browser).includes("projects.stats.superseded"));
        expect(await stored(w.hub)).toEqual(first);

        // 下一轮它算出了更新的：以重读到的 revision 写成。
        browser.set(snapshot("2026-10-10T10:00:03.000Z", 300));
        w.world.clock.advance(WRITE_INTERVAL_MS);
        browser.writer.changed();
        await waitUntil("较新的一方写成", async () => {
            const read = await stored(w.hub);
            return read.status === "ok" && read.value.words === 300;
        });

        // 服务端一侧拿着旧 revision 写一份比它旧的：冲突、重读、放弃，记录不变。
        server.set(snapshot("2026-10-10T10:00:02.500Z", 250));
        server.writer.changed();
        await waitUntil("服务端一侧放弃", () => events(server).includes("projects.stats.superseded"));
        expect(await stored(w.hub)).toMatchObject({status: "ok", value: {words: 300}});
    });

    it("变化后最多每 30 秒写一次，到点时写最新的快照", async () => {
        const w = await writerWorld();
        const server = writerOn(w, w.hub);
        await server.writer.load();
        server.set(snapshot("2026-10-10T10:00:00.000Z", 1));
        server.writer.changed();
        const first = await waitUntil("第一次写入", async () => {
            const read = await stored(w.hub);
            return read.status === "ok" ? read : null;
        });

        server.set(snapshot("2026-10-10T10:00:01.000Z", 2));
        server.writer.changed();
        server.set(snapshot("2026-10-10T10:00:02.000Z", 3));
        server.writer.changed();
        w.world.clock.advance(WRITE_INTERVAL_MS - 1);
        expect(await stored(w.hub)).toEqual(first);
        w.world.clock.advance(1);
        await waitUntil("间隔到点后写入", async () => {
            const read = await stored(w.hub);
            return read.status === "ok" && read.value.words === 3;
        });
    });

    it("写请求发出后断线（结果未知）：下一轮重读核对，已经落盘就不再写；别人写了更晚的就放弃", async () => {
        const w = await writerWorld();
        const isSave = (request: {readonly contract: string; readonly method: string}): boolean => request.contract === "nbook.storage/user" && request.method === "save";
        const browser = writerOn(w, w.window);
        await browser.writer.load();
        const held = w.tap.hold(isSave);
        const mine = snapshot("2026-10-10T10:00:01.000Z", 100);
        browser.set(mine);
        browser.writer.changed();
        await held.arrived;
        const landed = await stored(w.hub);
        expect(landed).toMatchObject({status: "ok", value: mine});
        w.link.disconnect();
        // 结果未知后立即重读：链路断着读不出，留到下一轮。
        await waitUntil("重读失败", () => events(browser).includes("projects.stats.read-failed"));
        // 扣着的回复属于已断的链路；放掉它，免得重连后的请求编号与它相同被一并扣住。
        held.release();
        expect(await w.link.reconnect()).toMatchObject({ok: true});

        w.world.clock.advance(WRITE_INTERVAL_MS);
        await browser.writer.finish(mine);
        expect(await stored(w.hub)).toEqual(landed);
        expect(w.tap.requests.filter(isSave)).toHaveLength(1);

        // 另一次：结果未知期间服务端一侧写了更晚的快照，重读后放弃。
        const other = writerOn(w, w.window);
        await other.writer.load();
        const second = w.tap.hold(isSave);
        const older = snapshot("2026-10-10T10:00:02.000Z", 200);
        other.set(older);
        other.writer.changed();
        await second.arrived;
        w.link.disconnect();
        await waitUntil("重读失败", () => events(other).includes("projects.stats.read-failed"));
        second.release();
        const server = writerOn(w, w.hub);
        await server.writer.load();
        server.set(snapshot("2026-10-10T10:00:09.000Z", 900));
        server.writer.changed();
        await waitUntil("服务端一侧写成", async () => {
            const read = await stored(w.hub);
            return read.status === "ok" && read.value.words === 900;
        });
        expect(await w.link.reconnect()).toMatchObject({ok: true});
        w.world.clock.advance(WRITE_INTERVAL_MS);
        await other.writer.finish(older);
        expect(events(other)).toContain("projects.stats.superseded");
        expect(await stored(w.hub)).toMatchObject({status: "ok", value: {words: 900}});
    });

    it("写请求交给链路后没送达就断线（结果未知、其实没写成）：重读到没有记录，以读到的 revision 重写", async () => {
        const w = await writerWorld();
        const browser = writerOn(w, w.window);
        await browser.writer.load();
        const held = w.tap.holdSend((frame) => frame.type === "request" && frame.contract === "nbook.storage/user" && frame.method === "save");
        const mine = snapshot("2026-10-10T10:00:01.000Z", 100);
        browser.set(mine);
        browser.writer.changed();
        await held.arrived;
        w.link.disconnect();
        await waitUntil("重读失败", () => events(browser).includes("projects.stats.read-failed"));
        expect(await stored(w.hub)).toMatchObject({status: "missing"});
        expect(await w.link.reconnect()).toMatchObject({ok: true});

        w.world.clock.advance(WRITE_INTERVAL_MS);
        await browser.writer.finish(mine);
        expect(await stored(w.hub)).toMatchObject({status: "ok", value: mine});
    });

    it("坏记录（不能解析、版本不同）被条件 reset 覆盖，原件进原件区并记诊断；原件区满时放弃并记诊断", async () => {
        const w = await writerWorld();
        const path = join(w.root, "state", "storage", "user.sqlite");
        // 先经 Storage 打开一次：库在第一次使用时建好。
        await stored(w.hub, "broken");
        const raw = (resource: string, value: string, version: number, revision: number): void => {
            const db = new Database(path);
            db.query("INSERT INTO records (owner, key, resource, client, revision, version, value, updated_at) VALUES (?1, ?2, ?3, '', ?4, ?5, ?6, 0) ON CONFLICT (owner, key, resource, client) DO UPDATE SET revision = excluded.revision, version = excluded.version, value = excluded.value")
                .run(descriptor.id, PROJECT_STATS_RECORD.key, resource, revision, version, value);
            db.close();
        };
        const writeTo = (resource: string): Writing => {
            let current: ProjectStatsSnapshot | null = null;
            const records: Array<Omit<DiagnosticInput, "source">> = [];
            const writer = createStatsWriter({clock: w.world.clock, open: () => w.hub.open(PROJECT_STATS_RECORD, resource), snapshot: () => current, record: (input) => records.push(input)});
            return {writer, records, set: (value) => (current = value)};
        };

        raw("broken", "{broken", 1, 900);
        raw("future", JSON.stringify(snapshot("2026-10-10T10:00:00.000Z", 5)), 2, 901);
        for (const resource of ["broken", "future"]) {
            const writing = writeTo(resource);
            expect(await writing.writer.load()).toBeNull();
            expect(events(writing)).toContain("projects.stats.record-damaged");
            await writing.writer.finish(snapshot("2026-10-10T10:00:01.000Z", 1));
            expect(events(writing)).toContain("projects.stats.record-reset");
            expect(await stored(w.hub, resource)).toMatchObject({status: "ok", value: {words: 1}});
        }
        const db = new Database(path);
        expect(db.query("SELECT resource, revision, version, value FROM originals ORDER BY id").all()).toEqual([
            {resource: "broken", revision: 900, version: 1, value: "{broken"},
            {resource: "future", revision: 901, version: 2, value: JSON.stringify(snapshot("2026-10-10T10:00:00.000Z", 5))},
        ]);
        for (let index = 2; index < ORIGINALS_MAX_COUNT; index += 1) {
            db.query("INSERT INTO originals (owner, key, resource, client, revision, version, value, bytes, saved_at) VALUES ('x.other', 'k', '', '', ?1, 1, 'x', 1, 0)").run(index);
        }
        db.close();

        raw("full", "{broken", 1, 902);
        const full = writeTo("full");
        await full.writer.load();
        await full.writer.finish(snapshot("2026-10-10T10:00:01.000Z", 1));
        expect(events(full)).toContain("projects.stats.originals-full");
        expect(await stored(w.hub, "full")).toMatchObject({status: "corrupt", revision: "902"});
    });
});

/** 服务端的测试插件：把 `context.remote` 交给测试，以服务端插件的身份调用 `{project}` 目标。 */
function serverRemote(): {readonly plugin: PluginDefinition; readonly remote: () => ActivationContext["remote"]} {
    let remote: ActivationContext["remote"] | null = null;
    return {
        plugin: {id: "test.stats-reader", entries: [{id: "server", location: "server", activationEvents: ["onStartup"], activate: (context) => {
            remote = context.remote;
            return {};
        }}]},
        remote: () => {
            if (remote === null) throw new Error("测试插件还没激活");
            return remote;
        },
    };
}

function silentDiagnostics(): PluginDefinition {
    const silent = {error: () => undefined};
    return createDiagnosticsPlugin({location: "server", store: createDiagnosticsStore({identity: {location: "server", instanceId: "hub"}}), exporter: createConsoleExporterFactory(silent), fallback: createConsoleFallback(silent)});
}

/** 服务端以 `nbook.projects` 的身份读 user 分区里的统计记录（服务端实例已停时直接开库读）。 */
function storedOnDisk(h: ProjectHarness): RecordSnapshot<ProjectStatsSnapshot> {
    const partition = createPartition({path: join(h.stateRoot, "storage", "user.sqlite")});
    try {
        const registered = partition.register(descriptor.id, PROJECT_STATS_RECORD.descriptor);
        if (!registered.ok) throw new Error(registered.detail);
        return partition.read({owner: descriptor.id, key: PROJECT_STATS_RECORD.key, resource: h.project.id, client: ""}, PROJECT_STATS_RECORD.descriptor) as RecordSnapshot<ProjectStatsSnapshot>;
    } finally {
        partition.close();
    }
}

/** 子进程里写进它自己日志的诊断事件名。 */
async function projectEvents(h: ProjectHarness): Promise<string[]> {
    const directory = join(h.stateRoot, "logs", "projects", h.project.name);
    const names = (await readdir(directory)).filter((name) => name.endsWith(".jsonl"));
    const lines = (await Promise.all(names.map((name) => readFile(join(directory, name), "utf8")))).flatMap((text) => text.split("\n").filter(Boolean));
    return lines.map((line) => (JSON.parse(line) as {event: string}).event);
}

describe("Spec projects 输出 16、17，验收 17：项目实例里的统计入口（真实项目子进程）", () => {
    /** 服务端装诊断、真实 Storage 与读统计的测试插件；`prepare` 在服务端起来之前预置项目目录与记录。 */
    async function started(prepare: (paths: ProjectHarnessPaths) => Promise<void>) {
        const reader = serverRemote();
        const h = await projectHarness(tmp, {plugins: [silentDiagnostics(), storageBackendPlugin, reader.plugin], prepare});
        closers.push(async () => {
            await h.parent.stop();
        });
        return {h, stats: reader.remote().use(projectStatsRemoteContract).at({project: h.project.id})};
    }

    it("打开即统计：current() 从 counting 到 complete 并写下记录；写文件后字数与最近编辑随之变化；停止时写最后一次，重开后沿用", async () => {
        const {h, stats} = await started(async (paths) => {
            await writeFile(join(paths.project.path, "a.md"), "天地玄黄");
        });
        const lease = leaseOf(await h.manager.acquire("book", "test"));
        await h.ready(1);
        const complete = await waitUntil("首次统计完成", async () => {
            const current = await stats.current({});
            return current.ok && current.value.status === "complete" ? current.value.snapshot : null;
        });
        expect(complete).toMatchObject({words: 4, files: 1, unreadable: 0, last: null});
        // 首扫完成时距上次写入早已超过间隔，立即写一次。
        await waitUntil("首扫后写入记录", () => storedOnDisk(h).status === "ok");

        await writeFile(join(h.project.path, "a.md"), "天地玄黄\n\n宇宙洪荒");
        const edited = await waitUntil("外部修改结算", async () => {
            const current = await stats.current({});
            return current.ok && current.value.snapshot?.words === 8 ? current.value.snapshot : null;
        });
        expect(edited.last).toMatchObject({address: "project://a.md", label: "a", excerpt: "宇宙洪荒"});
        // 距首扫后的写入不到 30 秒：记录还是旧的。
        expect(storedOnDisk(h)).toMatchObject({status: "ok", value: {words: 4}});

        lease.release();
        h.clock.advance(GRACE_MS);
        await revoked(lease);
        expect(storedOnDisk(h)).toMatchObject({status: "ok", value: {words: 8, last: {address: "project://a.md", excerpt: "宇宙洪荒"}}});

        const again = leaseOf(await h.manager.acquire("book", "test"));
        await h.ready(2);
        const reopened = await stats.current({});
        expect(reopened.ok && reopened.value.snapshot).toMatchObject({words: 8, last: {address: "project://a.md"}});
        again.release();
    }, 30_000);

    it("整轮扫描没完成就停止：不写，记录保持原样；首扫前 current() 给的是记录里的快照", async () => {
        const old = {...snapshot("2026-10-01T08:00:00.000Z", 1), last: {address: "project://卷一/第1章.md", label: "第1章", at: "2026-10-01T07:59:00.000Z", excerpt: "旧"}};
        const {h, stats} = await started(async (paths) => {
            // 足够多的文件让首扫跨过停止。
            for (let volume = 1; volume <= 10; volume += 1) {
                await mkdir(join(paths.project.path, `卷${String(volume)}`));
                for (let chapter = 1; chapter <= 150; chapter += 1) await writeFile(join(paths.project.path, `卷${String(volume)}`, `第${String(chapter)}章.md`), "字".repeat(3000));
            }
            const partition = createPartition({path: join(paths.stateRoot, "storage", "user.sqlite")});
            try {
                partition.register(descriptor.id, PROJECT_STATS_RECORD.descriptor);
                partition.write({owner: descriptor.id, key: PROJECT_STATS_RECORD.key, resource: paths.project.id, client: ""}, PROJECT_STATS_RECORD.descriptor, {kind: "save", value: old, expect: null});
            } finally {
                partition.close();
            }
        });
        const before = storedOnDisk(h);
        const lease = leaseOf(await h.manager.acquire("book", "test"));
        const pid = await h.ready(1);
        expect(await stats.current({})).toEqual({ok: true, value: {status: "counting", snapshot: old}});

        lease.release();
        h.clock.advance(GRACE_MS);
        await revoked(lease);
        expect(alive(pid)).toBe(false);
        expect(storedOnDisk(h)).toEqual(before);
        expect(await projectEvents(h)).toContain("projects.stats.final-skipped");
    }, 30_000);
});
