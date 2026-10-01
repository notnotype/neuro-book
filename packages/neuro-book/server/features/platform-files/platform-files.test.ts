/**
 * platform.files 的行为验证：真实临时根、真实文件系统、真实子作用域。
 *
 * 覆盖 Spec 的验收场景 1–8：持久读回、越界与非法输入拒绝、授予隔离、变更订阅、协作锁、
 * 取消、关闭顺序、外部修改并发。测试只断言可观察合同（内容、错误 code、事件、结果状态），
 * 不镜像实现、不 pin 文案。
 */

import {lstat, mkdir, mkdtemp, readFile, rm, rmdir, stat as fsStat, symlink, writeFile as fsWriteFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {afterEach, describe, expect, it} from "vitest";

import {createRuntimeInstance} from "nbook/runtime/lifecycle/lifecycle";
import type {CloseResult, ReleaseDependency, Scope} from "nbook/runtime/lifecycle/lifecycle";
import {createPluginHost} from "nbook/runtime/plugins/plugins";
import type {PluginDefinition} from "nbook/runtime/plugins/plugins";
import {createServiceAssembly, defineServiceKey} from "nbook/runtime/services/services";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";

import {PlatformFilesError, platformFilesKey} from "./contracts";
import type {
    GrantSpec,
    PlatformFiles,
    PlatformFilesErrorCode,
    RootGrant,
    RootOperation,
    WatchEvent,
} from "./contracts";
import {createPlatformFilesPlugin} from "./plugin";
import {PlatformFilesService} from "./service";

const TEST_ROOT_ID = "state";
const CONSUMER_PLUGIN_ID = "test-consumer";

const readGrantKey = defineServiceKey<RootGrant>("nbook.platform-files/read");
const readWriteGrantKey = defineServiceKey<RootGrant>("nbook.platform-files/read-write");
const adminGrantKey = defineServiceKey<RootGrant>("nbook.platform-files/admin");

const ROOTS: string[] = [];

async function createTempRoot(prefix = "nbook-platform-files-"): Promise<string> {
    const root = await mkdtemp(path.join(tmpdir(), prefix));
    ROOTS.push(root);
    return root;
}

/** Windows 上句柄释放与删除偶发 EPERM，做有界重试。 */
async function removeWithRetry(target: string): Promise<void> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
            await rm(target, {recursive: true, force: true});
            return;
        } catch (error) {
            if (attempt === 4) {
                throw error;
            }
            await delay(50);
        }
    }
}

/** 真实临时根上的重试退避与超时守卫；不用于断言时序。 */
function delay(ms: number): Promise<void> {
    const {promise, resolve} = Promise.withResolvers<void>();
    setTimeout(resolve, ms);
    return promise;
}

/** 有界等待：只用于真实文件系统事件的超时守卫，超时即失败并指出等待对象。 */
async function withTimeout<T>(pending: Promise<T>, ms: number, label: string): Promise<T> {
    const timeout = Promise.withResolvers<never>();
    const handle = setTimeout(() => timeout.reject(new Error(`等待超时：${label}`)), ms);
    try {
        return await Promise.race([pending, timeout.promise]);
    } finally {
        clearTimeout(handle);
    }
}

afterEach(async () => {
    for (const root of ROOTS.splice(0)) {
        await removeWithRetry(root);
    }
});

async function expectCode(run: () => Promise<unknown>, code: PlatformFilesErrorCode): Promise<void> {
    let thrown: unknown = null;
    try {
        await run();
    } catch (error) {
        thrown = error;
    }
    expect(thrown).toBeInstanceOf(PlatformFilesError);
    if (!(thrown instanceof PlatformFilesError)) {
        throw new Error(`期望 ${code}，但调用没有抛出 PlatformFilesError`);
    }
    expect(thrown.code).toBe(code);
}

async function exists(target: string): Promise<boolean> {
    try {
        await lstat(target);
        return true;
    } catch {
        return false;
    }
}

interface ResolvedGrant {
    readonly grant: RootGrant;
    readonly dependency: ReleaseDependency;
}

interface ConsumerBox {
    files: PlatformFiles | null;
    grants: Record<string, ResolvedGrant>;
    scope: Scope | null;
}

const DEFAULT_GRANTS: ReadonlyArray<GrantSpec> = [
    {key: readGrantKey, root: TEST_ROOT_ID, operations: ["read"]},
    {key: readWriteGrantKey, root: TEST_ROOT_ID, operations: ["read", "write"]},
    {key: adminGrantKey, root: TEST_ROOT_ID, operations: ["read", "write", "delete"]},
];

/** 受信消费者：只在清单里声明依赖的键可解析，静态依赖图即签发边界。 */
function consumerPlugin(box: ConsumerBox, grants: ReadonlyArray<GrantSpec>, names: ReadonlyArray<string>): PluginDefinition {
    const named = names.map((name, index) => ({name, key: grants[index]!.key}));
    return {
        id: CONSUMER_PLUGIN_ID,
        entries: [
            {
                id: "main",
                location: "server",
                dependencies: [{key: platformFilesKey}, ...named.map((entry) => ({key: entry.key}))],
                activate: async (context) => {
                    box.files = context.services.require(platformFilesKey);
                    box.scope = context.scope;
                    for (const entry of named) {
                        const resolved = await context.services.resolve(entry.key);
                        if (resolved.status !== "resolved") {
                            throw new Error(`授予 ${entry.key.name} 未解析`);
                        }
                        box.grants[entry.name] = {grant: resolved.instance, dependency: resolved.binding.dependency};
                    }
                    return {services: []};
                },
            },
        ],
    };
}

interface Harness {
    readonly root: Scope;
    readonly files: PlatformFiles;
    readonly grants: ConsumerBox["grants"];
    readonly consumerScope: Scope;
    close(): Promise<CloseResult>;
}

async function startHarness(
    rootPath: string,
    options: {readonly grants?: ReadonlyArray<GrantSpec>; readonly names?: ReadonlyArray<string>; readonly maxOperations?: ReadonlyArray<RootOperation>} = {},
): Promise<Harness> {
    const grants = options.grants ?? DEFAULT_GRANTS;
    const names = options.names ?? ["read", "write", "admin"];
    const box: ConsumerBox = {files: null, grants: {}, scope: null};
    const instance = createRuntimeInstance({location: "server", instanceId: `platform-files-${randomUUID()}`});
    const assembly = createServiceAssembly(instance, {keys: [platformFilesKey, ...grants.map((grant) => grant.key)]});
    const host = createPluginHost(instance, assembly, {receivers: []});
    const definition = createPlatformFilesPlugin({
        roots: [{id: TEST_ROOT_ID, path: rootPath, maxOperations: options.maxOperations ?? ["read", "write", "delete"]}],
        grants,
    });
    expect(host.register(definition, {scope: instance.root}).status).toBe("accepted");
    expect(host.register(consumerPlugin(box, grants, names), {scope: instance.root}).status).toBe("accepted");
    instance.root.open();
    const activation = await host.activate({plugin: CONSUMER_PLUGIN_ID, entry: "main"});
    expect(activation.status).toBe("activated");
    if (box.files === null || box.scope === null) {
        throw new Error("消费者未取得平台文件服务");
    }
    return {
        root: instance.root,
        files: box.files,
        grants: box.grants,
        consumerScope: box.scope,
        close: () => instance.root.close(),
    };
}

function grantOf(harness: Harness, name: string): ResolvedGrant {
    const resolved = harness.grants[name];
    if (resolved === undefined) {
        throw new Error(`未解析的授予：${name}`);
    }
    return resolved;
}

describe("根内真实 I/O（验收 1）", () => {
    it("写入后由新实例与新句柄读回同一字节，关闭不删除文件", async () => {
        const rootPath = await createTempRoot();
        const first = await startHarness(rootPath);
        await first.files.writeFile(grantOf(first, "write").grant, "notes/a.txt", "第一行\n");
        expect(new TextDecoder().decode(await first.files.readFile(grantOf(first, "read").grant, "notes/a.txt"))).toBe("第一行\n");
        expect(await first.files.readText(grantOf(first, "read").grant, "notes/a.txt")).toBe("第一行\n");
        expect(await first.files.stat(grantOf(first, "read").grant, "notes/a.txt")).toMatchObject({kind: "file"});
        expect((await first.close()).status).toBe("closed");
        expect(await readFile(path.join(rootPath, "notes", "a.txt"), "utf8")).toBe("第一行\n");

        const second = await startHarness(rootPath);
        expect(await second.files.readText(grantOf(second, "read").grant, "notes/a.txt")).toBe("第一行\n");
        await second.files.appendFile(grantOf(second, "write").grant, "notes/a.txt", "第二行\n", {flush: true});
        expect(await second.files.readText(grantOf(second, "read").grant, "notes/a.txt")).toBe("第一行\n第二行\n");
        await second.files.mkdir(grantOf(second, "write").grant, "notes/nested/deep");
        await second.files.replaceFile(grantOf(second, "write").grant, "notes/nested/deep/b.txt", "内容", {durable: true});
        expect(await second.files.readText(grantOf(second, "read").grant, "notes/nested/deep/b.txt")).toBe("内容");
        expect((await second.close()).status).toBe("closed");
    });
    it("排他创建拒绝预检后被占用的文件与目录，不覆盖已有字节", async () => {
        const rootPath = await createTempRoot();
        const harness = await startHarness(rootPath);
        try {
            const grant = grantOf(harness, "write").grant;
            await fsWriteFile(path.join(rootPath, "occupied.md"), "other writer");
            await expectCode(() => harness.files.createFile(grant, "occupied.md", "mine"), "already-exists");
            expect(await readFile(path.join(rootPath, "occupied.md"), "utf8")).toBe("other writer");

            await harness.files.createFile(grant, "new.md", "new bytes");
            expect(await readFile(path.join(rootPath, "new.md"), "utf8")).toBe("new bytes");
            await mkdir(path.join(rootPath, "occupied"));
            await expectCode(() => harness.files.createDirectory(grant, "occupied"), "already-exists");
            await harness.files.createDirectory(grant, "empty");
            expect((await fsStat(path.join(rootPath, "empty"))).isDirectory()).toBe(true);
            await expectCode(() => harness.files.createFile(grantOf(harness, "read").grant, "not-allowed.md", "x"), "permission-denied");
            await expectCode(() => harness.files.createDirectory(grantOf(harness, "read").grant, "not-allowed"), "permission-denied");
            await expectCode(() => harness.files.createFile(grant, "../outside.md", "x"), "invalid-path");
            await expectCode(() => harness.files.createDirectory(grant, "../outside"), "invalid-path");
            await expectCode(() => harness.files.createFile(grant, "missing/child.md", "x"), "io-failed");
            expect(await exists(path.join(rootPath, "missing"))).toBe(false);
        } finally {
            expect((await harness.close()).status).toBe("closed");
        }
    });
    it("两个写者竞争同一目标仅一个成功，后续目标冲突不触及已有文件", async () => {
        const rootPath = await createTempRoot();
        const first = await startHarness(rootPath);
        const second = await startHarness(rootPath);
        try {
            const a = first.files.createFile(grantOf(first, "write").grant, "race.md", "A");
            const b = second.files.createFile(grantOf(second, "write").grant, "race.md", "B");
            const outcomes = await Promise.allSettled([a, b]);
            expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
            const rejected = outcomes.find((outcome) => outcome.status === "rejected");
            expect(rejected?.status === "rejected" && rejected.reason instanceof PlatformFilesError && rejected.reason.code).toBe("already-exists");
            expect(["A", "B"]).toContain(await readFile(path.join(rootPath, "race.md"), "utf8"));

            await first.files.createDirectory(grantOf(first, "write").grant, "partial");
            await fsWriteFile(path.join(rootPath, "partial", "b.md"), "external");
            await first.files.createFile(grantOf(first, "write").grant, "partial/a.md", "copied");
            await expectCode(() => first.files.createFile(grantOf(first, "write").grant, "partial/b.md", "mine"), "already-exists");
            expect(await readFile(path.join(rootPath, "partial", "a.md"), "utf8")).toBe("copied");
            expect(await readFile(path.join(rootPath, "partial", "b.md"), "utf8")).toBe("external");
        } finally {
            expect((await first.close()).status).toBe("closed");
            expect((await second.close()).status).toBe("closed");
        }
    });

    it("目录项操作只作用于目录项自身：移动、非递归删除与列表", async () => {
        const rootPath = await createTempRoot();
        const harness = await startHarness(rootPath);
        const admin = grantOf(harness, "admin").grant;
        await harness.files.writeFile(grantOf(harness, "write").grant, "tree/one.txt", "one");
        await harness.files.mkdir(admin, "tree/sub");
        await harness.files.rename(admin, "tree/one.txt", "tree/sub/moved.txt");
        expect(await exists(path.join(rootPath, "tree", "one.txt"))).toBe(false);
        expect(await harness.files.readText(grantOf(harness, "read").grant, "tree/sub/moved.txt")).toBe("one");
        const entries = await harness.files.list(grantOf(harness, "read").grant, "tree");
        expect(entries.map((entry) => entry.relativePath).sort()).toEqual(["tree/sub"]);
        await expectCode(() => harness.files.remove(admin, "tree", {}), "io-failed");
        await harness.files.remove(admin, "tree/sub/moved.txt");
        await harness.files.remove(admin, "tree/sub");
        expect(await exists(path.join(rootPath, "tree"))).toBe(true);
        await harness.files.remove(admin, "tree");
        expect(await exists(path.join(rootPath, "tree"))).toBe(false);
        expect((await harness.close()).status).toBe("closed");
    });
});

describe("越界与非法输入拒绝（验收 2）", () => {
    it("拒绝 `..`、绝对路径、UNC、盘符、空串与 NUL，且根外无创建", async () => {
        const rootPath = await createTempRoot();
        const outside = await createTempRoot("nbook-platform-files-outside-");
        const harness = await startHarness(rootPath);
        const admin = grantOf(harness, "admin").grant;
        for (const address of ["../escaped.txt", "sub/../../escaped.txt", path.join(rootPath, "abs.txt"), "\\\\server\\share\\x.txt", "//server/share/x.txt", "C:\\windows\\x.txt", "c:/x.txt", "", "  ", "a\0b.txt"]) {
            await expectCode(() => harness.files.writeFile(admin, address, "x"), "invalid-path");
        }
        expect(await exists(path.join(path.dirname(rootPath), "escaped.txt"))).toBe(false);
        expect(await exists(path.join(outside, "x.txt"))).toBe(false);
        expect((await harness.close()).status).toBe("closed");
    });

    it("根内指向根外的链接在读、写、stat 与列表全部拒绝，删除只删除链接本身", async (context) => {
        const rootPath = await createTempRoot();
        const outside = await createTempRoot("nbook-platform-files-outside-");
        await fsWriteFile(path.join(outside, "secret.txt"), "outside-content");
        const linkPath = path.join(rootPath, "escape-link");
        try {
            await symlink(outside, linkPath, process.platform === "win32" ? "junction" : "dir");
        } catch (error) {
            context.skip(`当前环境无法创建目录链接：${String(error)}`);
            return;
        }
        const harness = await startHarness(rootPath);
        const admin = grantOf(harness, "admin").grant;
        await expectCode(() => harness.files.readText(admin, "escape-link/secret.txt"), "outside-root");
        await expectCode(() => harness.files.writeFile(admin, "escape-link/created.txt", "x"), "outside-root");
        await expectCode(() => harness.files.stat(admin, "escape-link"), "outside-root");
        await expectCode(() => harness.files.list(admin, "escape-link"), "outside-root");
        await expectCode(() => harness.files.mkdir(admin, "escape-link/newdir"), "outside-root");
        expect(await exists(path.join(outside, "created.txt"))).toBe(false);
        expect(await exists(path.join(outside, "newdir"))).toBe(false);

        await harness.files.remove(admin, "escape-link");
        expect(await exists(linkPath)).toBe(false);
        expect(await readFile(path.join(outside, "secret.txt"), "utf8")).toBe("outside-content");
        expect((await fsStat(outside)).isDirectory()).toBe(true);
        expect((await harness.close()).status).toBe("closed");
    });

    it("根内链接在解析后仍位于根内时可用，目录项操作不跟随目标链接", async (context) => {
        const rootPath = await createTempRoot();
        await mkdir(path.join(rootPath, "target"));
        await fsWriteFile(path.join(rootPath, "target", "inside.txt"), "inside-content");
        const linkPath = path.join(rootPath, "inside-link");
        try {
            await symlink(path.join(rootPath, "target"), linkPath, process.platform === "win32" ? "junction" : "dir");
        } catch (error) {
            context.skip(`当前环境无法创建目录链接：${String(error)}`);
            return;
        }
        const harness = await startHarness(rootPath);
        const admin = grantOf(harness, "admin").grant;
        expect(await harness.files.readText(admin, "inside-link/inside.txt")).toBe("inside-content");
        await harness.files.remove(admin, "inside-link");
        expect(await exists(linkPath)).toBe(false);
        expect(await readFile(path.join(rootPath, "target", "inside.txt"), "utf8")).toBe("inside-content");
        expect((await harness.close()).status).toBe("closed");
    });
});

describe("授予隔离（验收 3）", () => {
    it("只读授予读成功，写、删除与移动被拒绝且不改变源", async () => {
        const rootPath = await createTempRoot();
        const harness = await startHarness(rootPath);
        const {write, read} = {write: grantOf(harness, "write").grant, read: grantOf(harness, "read").grant};
        await harness.files.writeFile(write, "guarded.txt", "keep");
        expect(await harness.files.readText(read, "guarded.txt")).toBe("keep");
        await expectCode(() => harness.files.writeFile(read, "guarded.txt", "overwritten"), "permission-denied");
        await expectCode(() => harness.files.replaceFile(read, "guarded.txt", "overwritten"), "permission-denied");
        await expectCode(() => harness.files.remove(read, "guarded.txt"), "permission-denied");
        await expectCode(() => harness.files.rename(read, "guarded.txt", "moved.txt"), "permission-denied");
        expect(await readFile(path.join(rootPath, "guarded.txt"), "utf8")).toBe("keep");
        expect(await exists(path.join(rootPath, "moved.txt"))).toBe(false);
        // 只有写权限的授予同样不能移动：任一权限缺失即整体拒绝，源保持不变。
        await expectCode(() => harness.files.rename(write, "guarded.txt", "moved.txt"), "permission-denied");
        expect(await exists(path.join(rootPath, "guarded.txt"))).toBe(true);
        expect(await exists(path.join(rootPath, "moved.txt"))).toBe(false);
        expect((await harness.close()).status).toBe("closed");
    });

    it("伪造授予、其它实例的授予与派生扩大都以稳定错误拒绝", async () => {
        const rootPath = await createTempRoot();
        const first = await startHarness(rootPath);
        const second = await startHarness(rootPath);
        const forged: RootGrant = {
            rootId: TEST_ROOT_ID,
            grantId: "forged",
            operations: ["read", "write", "delete"],
            allows: () => true,
            narrow: () => forged,
        };
        await expectCode(() => first.files.writeFile(forged, "forged.txt", "x"), "grant-revoked");
        await expectCode(() => first.files.readFile(grantOf(second, "read").grant, "forged.txt"), "grant-revoked");
        expect(await exists(path.join(rootPath, "forged.txt"))).toBe(false);
        const read = grantOf(first, "read").grant;
        expect(() => read.narrow(".", ["write"])).toThrowError(PlatformFilesError);
        expect(() => read.narrow("../outside", ["read"])).toThrowError(PlatformFilesError);
        const narrowed = read.narrow("scope", ["read"]);
        await first.files.writeFile(grantOf(first, "write").grant, "scope/inside.txt", "in");
        await first.files.writeFile(grantOf(first, "write").grant, "plain.txt", "out");
        expect(await first.files.readText(narrowed, "scope/inside.txt")).toBe("in");
        await expectCode(() => first.files.readText(narrowed, "plain.txt"), "outside-root");
        await expectCode(() => first.files.writeFile(narrowed, "scope/new.txt", "x"), "permission-denied");
        expect((await first.close()).status).toBe("closed");
        expect((await second.close()).status).toBe("closed");
    });
});

describe("变更订阅（验收 4）", () => {
    it("外部修改收到相对路径事件，重读得到新内容，释放后不再开始排队回调", async () => {
        const rootPath = await createTempRoot();
        await mkdir(path.join(rootPath, "watched"));
        await fsWriteFile(path.join(rootPath, "watched", "x.txt"), "one");
        const harness = await startHarness(rootPath);
        // 句柄作用域是消费者激活作用域的子作用域：子作用域先于激活作用域上的服务借用关闭。
        const watcherScope = harness.consumerScope.createChild("watcher");
        const events: WatchEvent[] = [];
        const gate = Promise.withResolvers<void>();
        let started = 0;
        const handle = await harness.files.watch(grantOf(harness, "read").grant, "watched", {
            scope: watcherScope,
            onEvent: (event) => {
                started += 1;
                events.push(event);
                gate.resolve();
                return started === 1 ? gate.promise : Promise.resolve();
            },
        });
        await fsWriteFile(path.join(rootPath, "watched", "x.txt"), "two");
        await Promise.race([gate.promise, delay(10000)]);
        expect(events.length).toBeGreaterThan(0);
        expect(events[0]).toMatchObject({rootId: TEST_ROOT_ID, path: "watched/x.txt"});
        expect(await harness.files.readText(grantOf(harness, "read").grant, "watched/x.txt")).toBe("two");

        // 排队期间释放：已开始的回调完成，尚未开始的回调不再执行。
        gate.resolve();
        await fsWriteFile(path.join(rootPath, "watched", "y.txt"), "queued");
        const close = handle.close();
        await delay(50);
        const startedAtClose = started;
        await close;
        await delay(400);
        expect(started).toBe(startedAtClose);
        await expect(handle.close()).resolves.toBeUndefined();
        expect((await harness.close()).status).toBe("closed");
    });
});

describe("协作锁（验收 5）", () => {
    it("两个参与者竞争一个占用，释放后可重新获取", async () => {
        const rootPath = await createTempRoot();
        const first = await startHarness(rootPath);
        const second = await startHarness(rootPath);
        await first.files.writeFile(grantOf(first, "write").grant, "locked.txt", "content");
        const scopeA = first.consumerScope.createChild("lock-a");
        const scopeB = second.consumerScope.createChild("lock-b");
        const lockA = await first.files.lock(grantOf(first, "write").grant, "locked.txt", {scope: scopeA, staleMs: 200, updateMs: 100});
        await expect(lockA.check()).resolves.toBe("held");
        await expectCode(
            () => second.files.lock(grantOf(second, "write").grant, "locked.txt", {scope: scopeB}),
            "lock-held",
        );
        await lockA.release();
        await expect(lockA.release()).resolves.toBeUndefined();
        const lockB = await second.files.lock(grantOf(second, "write").grant, "locked.txt", {scope: scopeB, staleMs: 200, updateMs: 100});
        await expect(lockB.check()).resolves.toBe("held");
        await lockB.release();
        await expectCode(() => lockB.check(), "closed");
        expect((await first.close()).status).toBe("closed");
        expect((await second.close()).status).toBe("closed");
    });

    it("外部破坏或接管后 check 报告失效，释放不删除他人的锁目录", async () => {
        const rootPath = await createTempRoot();
        const first = await startHarness(rootPath);
        const second = await startHarness(rootPath);
        await first.files.writeFile(grantOf(first, "write").grant, "taken.txt", "content");
        const scopeA = first.consumerScope.createChild("lock-a");
        const scopeB = second.consumerScope.createChild("lock-b");
        const lockfilePath = path.join(rootPath, "taken.txt.lock");
        const lockA = await first.files.lock(grantOf(first, "write").grant, "taken.txt", {scope: scopeA, staleMs: 2000, updateMs: 1000});
        await expect(lockA.check()).resolves.toBe("held");
        await rmdir(lockfilePath);
        await expect(lockA.check()).resolves.toBe("compromised");
        const lockB = await second.files.lock(grantOf(second, "write").grant, "taken.txt", {scope: scopeB, staleMs: 2000, updateMs: 1000});
        await expect(lockB.check()).resolves.toBe("held");
        await expect(lockA.release()).resolves.toBeUndefined();
        expect(await exists(lockfilePath)).toBe(true);
        await expect(lockA.check()).resolves.toBe("compromised");
        await lockB.release();
        expect(await exists(lockfilePath)).toBe(false);
        expect((await first.close()).status).toBe("closed");
        expect((await second.close()).status).toBe("closed");
    });
});

describe("取消（验收 6）", () => {
    it("开始前已取消的写与删除没有副作用", async () => {
        const rootPath = await createTempRoot();
        const harness = await startHarness(rootPath);
        const admin = grantOf(harness, "admin").grant;
        await harness.files.writeFile(grantOf(harness, "write").grant, "kept.txt", "keep");
        const controller = new AbortController();
        controller.abort();
        await expectCode(() => harness.files.writeFile(admin, "cancelled.txt", "x", {signal: controller.signal}), "cancelled");
        await expectCode(() => harness.files.remove(admin, "kept.txt", {signal: controller.signal}), "cancelled");
        await expectCode(() => harness.files.watch(admin, "kept.txt", {scope: harness.root, onEvent: () => undefined, signal: controller.signal}), "cancelled");
        expect(await exists(path.join(rootPath, "cancelled.txt"))).toBe(false);
        expect(await harness.files.readText(grantOf(harness, "read").grant, "kept.txt")).toBe("keep");
        expect((await harness.close()).status).toBe("closed");
    });

    it("取消与写入竞争时结果明确：完成即成功，未完成即取消或未知", async () => {
        const rootPath = await createTempRoot();
        const harness = await startHarness(rootPath);
        const admin = grantOf(harness, "admin").grant;
        const controller = new AbortController();
        const write = harness.files.writeFile(admin, "racing.txt", "payload", {signal: controller.signal});
        controller.abort();
        let failure: PlatformFilesError | null = null;
        try {
            await write;
        } catch (error) {
            failure = error instanceof PlatformFilesError ? error : null;
            expect(error).toBeInstanceOf(PlatformFilesError);
        }
        if (failure !== null) {
            expect(["cancelled", "outcome-unknown"]).toContain(failure.code);
            // 只有 cancelled 证明没有副作用；outcome-unknown 不对文件是否存在作任何承诺。
            if (failure.code === "cancelled") {
                expect(await exists(path.join(rootPath, "racing.txt"))).toBe(false);
            }
        } else {
            expect(await harness.files.readText(grantOf(harness, "read").grant, "racing.txt")).toBe("payload");
        }
        expect((await harness.close()).status).toBe("closed");
    });
});

describe("关闭顺序（验收 7）", () => {
    it("消费者作用域先释放句柄时提供者关闭成功", async () => {
        const rootPath = await createTempRoot();
        await mkdir(path.join(rootPath, "sub"));
        const harness = await startHarness(rootPath);
        const watcherScope = harness.consumerScope.createChild("watcher");
        await harness.files.watch(grantOf(harness, "read").grant, "sub", {scope: watcherScope, onEvent: () => undefined});
        await expect((await watcherScope.close()).status).toBe("closed");
        expect((await harness.close()).status).toBe("closed");
    });

    it("句柄未释放时关闭报告未完成，释放后显式恢复成功，重复关闭共享同一结果", async () => {
        const rootPath = await createTempRoot();
        await mkdir(path.join(rootPath, "sub"));
        const harness = await startHarness(rootPath);
        // 句柄登记在比提供者更长寿的根作用域上：提供者随子作用域先关闭时句柄仍存活。
        const handle = await harness.files.watch(grantOf(harness, "read").grant, "sub", {
            scope: harness.root,
            onEvent: () => undefined,
        });
        const first = await harness.close();
        const repeated = await harness.close();
        expect(first).toEqual(repeated);
        expect(first.status).toBe("incomplete");
        if (first.status === "incomplete") {
            expect(first.reason).toBe("blocked");
        }
        await expect(handle.close()).resolves.toBeUndefined();
        const recovered = await harness.root.recover();
        expect(recovered.status).toBe("closed");
        await expectCode(() => harness.files.readText(grantOf(harness, "read").grant, "sub"), "closed");
        expect((await harness.close()).status).toBe("closed");
    });

    it("服务自身的关闭门禁：未释放句柄时 close 抛错，释放后成功，重复关闭同一结果", async () => {
        const rootPath = await createTempRoot();
        await mkdir(path.join(rootPath, "sub"));
        const instance = createRuntimeInstance({location: "server", instanceId: `platform-files-${randomUUID()}`});
        const service = new PlatformFilesService({roots: [{id: TEST_ROOT_ID, realPath: absoluteFsPath(rootPath)}]});
        const grant = service.issueGrant(TEST_ROOT_ID, ["read", "write", "delete"]);
        const fileScope = instance.root.createChild("handles");
        const handle = await service.watch(grant, "sub", {scope: fileScope, onEvent: () => undefined});
        await expectCode(() => service.close(), "stopping");
        await expectCode(() => service.writeFile(grant, "sub/after.txt", "x"), "stopping");
        await expectCode(() => service.close(), "stopping");
        await handle.close();
        await expect(service.close()).resolves.toBeUndefined();
        await expect(service.close()).resolves.toBeUndefined();
        await expectCode(() => service.writeFile(grant, "sub/after.txt", "x"), "closed");
        expect(() => grant.narrow(".", ["read"])).toThrowError(PlatformFilesError);
        expect(await exists(path.join(rootPath, "sub", "after.txt"))).toBe(false);
        expect(await exists(path.join(rootPath, "sub"))).toBe(true);
    });

    it("多个授予键共享一个服务实例：收口时无依赖边的键先释放，也不撤销其它键消费者清理路径仍在用的授予", async () => {
        const rootPath = await createTempRoot();
        const instance = createRuntimeInstance({location: "server", instanceId: `platform-files-${randomUUID()}`});
        const assembly = createServiceAssembly(instance, {keys: [platformFilesKey, ...DEFAULT_GRANTS.map((grant) => grant.key)]});
        const host = createPluginHost(instance, assembly, {receivers: []});
        expect(host.register(createPlatformFilesPlugin({roots: [{id: TEST_ROOT_ID, path: rootPath, maxOperations: ["read", "write", "delete"]}], grants: DEFAULT_GRANTS}), {scope: instance.root}).status).toBe("accepted");
        instance.root.open();
        const readerScope = instance.root.createChild("reader");
        readerScope.open();
        const writerScope = instance.root.createChild("writer");
        writerScope.open();
        assembly.declare({id: "reader", location: "server", scope: readerScope, dependencies: [{key: readGrantKey}]});
        assembly.declare({id: "writer", location: "server", scope: instance.root, dependencies: [{key: platformFilesKey}, {key: adminGrantKey}]});
        const read = await assembly.access("reader").resolve(readGrantKey);
        const files = await assembly.access("writer", writerScope).resolve(platformFilesKey);
        const admin = await assembly.access("writer", writerScope).resolve(adminGrantKey);
        if (read.status !== "resolved" || files.status !== "resolved" || admin.status !== "resolved") {
            throw new Error("授予未解析");
        }
        // 写者的清理只依赖自己解析的两个键；只读键的服务代次与它没有依赖边。
        const cleanup: string[] = [];
        writerScope.register({
            kind: "writer-cleanup",
            label: "flush",
            value: null,
            dependsOn: [files.binding.dependency, admin.binding.dependency],
            release: async () => {
                // 让出一个宏任务：只读键的服务代次没有借用者阻挡，会在这之前释放完毕。
                await delay(20);
                await files.instance.writeFile(admin.instance, "cleanup.txt", "flushed");
                cleanup.push("written");
            },
        });
        expect((await instance.root.close()).status).toBe("closed");
        expect(cleanup).toEqual(["written"]);
        expect(await readFile(path.join(rootPath, "cleanup.txt"), "utf8")).toBe("flushed");
        await expectCode(() => files.instance.readText(admin.instance, "cleanup.txt"), "closed");
    });
});

describe("外部修改并发（验收 8）", () => {
    it("并发整文件替换只发布某个完整版本，且不留下临时文件", async () => {
        const rootPath = await createTempRoot();
        const harness = await startHarness(rootPath);
        const write = grantOf(harness, "write").grant;
        const left = "L".repeat(64 * 1024);
        const right = "R".repeat(48 * 1024);
        await Promise.all([
            harness.files.replaceFile(write, "concurrent.txt", left),
            harness.files.replaceFile(write, "concurrent.txt", right),
        ]);
        const content = await readFile(path.join(rootPath, "concurrent.txt"), "utf8");
        expect([left, right]).toContain(content);
        const entries = await harness.files.list(grantOf(harness, "read").grant, ".");
        expect(entries.filter((entry) => entry.name.endsWith(".tmp"))).toEqual([]);
        expect((await harness.close()).status).toBe("closed");
    });
});
