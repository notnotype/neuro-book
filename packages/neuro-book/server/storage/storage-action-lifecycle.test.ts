import {access, mkdir, readFile, readdir, realpath, rename} from "node:fs/promises";
import {lock as acquireFileLock} from "proper-lockfile";
import {afterEach, describe, expect, it, vi} from "vitest";
import {defineStorageState, type DefinedStorageState} from "nbook/shared/storage/definition";
import {disposeStorageHost} from "nbook/server/storage/host";
import {
    createStorageActionHost,
    STORAGE_CONTEXT_PATH,
    type StorageActionHostFixture,
} from "nbook/server/storage/fixtures/storage-action-host";
import type {StorageHandle, StorageHandleInput, StorageService} from "nbook/server/storage/storage-service";
import type {StorageLockAdapter} from "nbook/server/storage/partition-lock";

type LayoutState = {readonly width: number; readonly height: number};
type NoteState = {readonly text: string};

const LAYOUT_OWNER = "test.lifecycle";
const NOTE_OWNER = "test.lifecycle-note";

const layout: DefinedStorageState<LayoutState> = defineStorageState<LayoutState>({
    owner: LAYOUT_OWNER,
    key: "layout",
    scope: "user",
    locality: "local",
    records: "single",
    schemaVersion: 1,
    defaultValue: {width: 320, height: 240},
    validate: (value): value is LayoutState => typeof value === "object" && value !== null
        && typeof (value as LayoutState).width === "number"
        && typeof (value as LayoutState).height === "number",
});

const note: DefinedStorageState<NoteState> = defineStorageState<NoteState>({
    owner: NOTE_OWNER,
    key: "note",
    scope: "user",
    locality: "local",
    records: "identified",
    schemaVersion: 1,
    defaultValue: {text: ""},
    validate: (value): value is NoteState => typeof value === "object" && value !== null
        && typeof (value as NoteState).text === "string",
});

const definitions: readonly DefinedStorageState<unknown>[] = [layout, note];

const hosts: StorageActionHostFixture[] = [];

afterEach(async () => {
    await Promise.all(hosts.splice(0).map(async (host) => host.close()));
});

async function createHost(options?: Parameters<typeof createStorageActionHost>[0]): Promise<StorageActionHostFixture> {
    const host = await createStorageActionHost(options);
    hosts.push(host);
    return host;
}

async function expectFailure(response: Response, status: number, code: string): Promise<{readonly data?: {readonly code?: string; readonly reason?: string; readonly committed?: boolean}}> {
    expect(response.status, `期望 ${String(status)}，实际 ${String(response.status)}`).toBe(status);
    const body = await response.json() as {data?: {code?: string; reason?: string; committed?: boolean}};
    expect(body.data?.code).toBe(code);
    return body;
}

const save = (width: number, height: number) => ({
    kind: "save",
    owner: LAYOUT_OWNER,
    key: "layout",
    expected: {revision: null, partitionGeneration: 1},
    value: {width, height},
});

/** 在真实分区锁之前插入闸门：请求通过身份与句柄阶段，但尚未产生任何文件副作用。 */
function gatedLockAdapter(): {readonly adapter: StorageLockAdapter; readonly entered: Promise<void>; readonly open: () => void} {
    const entered = Promise.withResolvers<void>();
    const gate = Promise.withResolvers<void>();
    return {
        entered: entered.promise,
        open: () => { gate.resolve(); },
        adapter: {
            acquire: async (file, options) => {
                entered.resolve();
                await gate.promise;
                return await acquireFileLock(file, options);
            },
        },
    };
}

describe("值动作的访问与句柄生命周期", () => {
    it("释放访问后动作以 403 拒绝，重复释放幂等", async () => {
        const host = await createHost({definitions});
        const contextId = await host.issue();
        const release = {method: "DELETE", contextId, credential: host.clientCredential};

        await expect((await host.request(STORAGE_CONTEXT_PATH, release)).json()).resolves.toEqual({released: true});
        await expect((await host.request(STORAGE_CONTEXT_PATH, release)).json()).resolves.toEqual({released: false});
        await expectFailure(await host.act(contextId, {...save(1, 1)}), 403, "STORAGE_CONTEXT_INVALID");
        expect((await readdir(host.root)).sort()).toEqual([".locks", "identity.json"]);
    });

    it("等锁期间释放访问：真实副作用前停写，不留下部分记录", async () => {
        const gate = gatedLockAdapter();
        const host = await createHost({definitions, lockAdapter: gate.adapter});
        const contextId = await host.issue();

        const pending = host.act(contextId, save(50, 60));
        await gate.entered;
        await host.request(STORAGE_CONTEXT_PATH, {method: "DELETE", contextId, credential: host.clientCredential});
        gate.open();

        const failure = await expectFailure(await pending, 403, "STORAGE_CONTEXT_INVALID");
        expect(failure.data?.reason).toBe("unknown-context");
        // 分区元数据、记录目录与记录文件都没有被创建：停写发生在第一次真实副作用之前。
        expect((await readdir(host.root)).sort()).toEqual([".locks", "identity.json"]);
    });

    it("空闲到期后停写：自然过期不能让已接纳的写入继续落盘", async () => {
        const gate = gatedLockAdapter();
        // 只伪造时钟：到期判定走 Date.now()，而锁与网络保持真实计时。
        vi.useFakeTimers({toFake: ["Date"]});
        try {
            const host = await createHost({definitions, lockAdapter: gate.adapter, accessContextIdleMs: 40});
            const contextId = await host.issue();

            const pending = host.act(contextId, save(70, 80));
            await gate.entered;
            vi.setSystemTime(Date.now() + 1_000);
            gate.open();

            await expectFailure(await pending, 403, "STORAGE_CONTEXT_INVALID");
            expect((await readdir(host.root)).sort()).toEqual([".locks", "identity.json"]);
        } finally {
            vi.useRealTimers();
        }
    });

    it("核验与打开之间替换存储根：拒绝本次动作且不写入新目录", async () => {
        const host = await createHost({
            definitions,
            openHandle: async (input: StorageHandleInput, service: StorageService): Promise<StorageHandle> => {
                await rename(host.root, `${host.root}-replaced`);
                await mkdir(host.root);
                return await service.openHandle(input);
            },
        });
        const contextId = await host.issue();

        const failure = await expectFailure(await host.act(contextId, save(90, 100)), 403, "STORAGE_CONTEXT_INVALID");
        expect(failure.data?.reason).toBe("claims-mismatch");
        expect(await readdir(host.root)).toEqual([]);
    });

    it("核验后根被移走：普通读取失败，不重建缺失目录", async () => {
        const host = await createHost({
            definitions,
            openHandle: async (input, service) => {
                await rename(host.root, `${host.root}-moved`);
                return await service.openHandle(input);
            },
        });
        const contextId = await host.issue();
        await expectFailure(await host.act(contextId, {kind: "read", owner: LAYOUT_OWNER, key: "layout"}), 500, "STORAGE_IO_FAILURE");
        await expect(access(host.root)).rejects.toMatchObject({code: "ENOENT"});
        expect(await readdir(`${host.root}-moved`)).toContain("identity.json");
    });

    it("已提交但锁释放未确认：失败如实报告 committed，事实仍可重读", async () => {
        const lockAdapter: StorageLockAdapter = {
            acquire: async (file, options) => {
                const release = await acquireFileLock(file, options);
                return async () => {
                    await release();
                    throw new Error("测试注入的锁释放失败");
                };
            },
        };
        const host = await createHost({definitions, lockAdapter});
        const contextId = await host.issue();

        const failure = await expectFailure(await host.act(contextId, save(110, 120)), 503, "STORAGE_LOCK_UNAVAILABLE");
        expect(failure.data?.committed).toBe(true);
        // 已提交不能被伪装成“未保存”：磁盘上是完整的新值，后续读取也能看到。
        expect(await readFile(await host.recordPath({owner: LAYOUT_OWNER, key: "layout"}), "utf8")).toContain('"width":110');
        const read = await host.act(contextId, {kind: "read", owner: LAYOUT_OWNER, key: "layout"});
        await expect(read.json()).resolves.toMatchObject({result: {kind: "value", value: {width: 110, height: 120}}});
    });

    it("替换重试期间释放访问：重试前重新检查授权，不落盘也不留临时文件", async () => {
        let replacements = 0;
        const host = await createHost({
            definitions,
            fileOptions: {
                replace: {
                    replace: async (source, target) => {
                        replacements += 1;
                        if (replacements === 1) {
                            // 第一次替换被占用错误打断；撤销发生在这个窗口内。
                            await host.request(STORAGE_CONTEXT_PATH, {method: "DELETE", contextId, credential: host.clientCredential});
                            throw Object.assign(new Error("测试注入的占用错误"), {code: "EBUSY"});
                        }
                        await rename(source, target);
                    },
                },
            },
        });
        const contextId = await host.issue();

        await expectFailure(await host.act(contextId, save(150, 160)), 403, "STORAGE_CONTEXT_INVALID");
        expect(replacements).toBe(1);
        // 重试前停写：分区目录里既没有分区元数据，也没有本次写入的临时文件。
        const partition = await host.partition({owner: LAYOUT_OWNER});
        await expect(readdir(partition.directory)).resolves.toEqual([]);
    });

    it("同上下文同 owner 的并发请求收敛到同一个句柄", async () => {
        let opens = 0;
        const gate = gatedLockAdapter();
        const host = await createHost({
            definitions,
            lockAdapter: gate.adapter,
            openHandle: async (input, service) => {
                opens += 1;
                return await service.openHandle(input);
            },
        });
        const contextId = await host.issue();

        const saving = host.act(contextId, save(130, 140));
        await gate.entered;
        // 保存仍持锁等待时，同一访问的读取必须复用同一个句柄，而不是再打开一份。
        const reading = await host.act(contextId, {kind: "read", owner: LAYOUT_OWNER, key: "layout"});
        await expect(reading.json()).resolves.toMatchObject({result: {kind: "missing"}});
        expect(opens).toBe(1);

        gate.open();
        expect((await saving).status).toBe(200);
        expect(opens).toBe(1);
    });

    it("慢打开结束后重新检查访问：打开期间释放的访问不能读到状态", async () => {
        const opened = Promise.withResolvers<void>();
        const gate = Promise.withResolvers<void>();
        const host = await createHost({
            definitions,
            openHandle: async (input, service) => {
                // 句柄已经建立，但在动作拿到它之前停住：撤销发生在这段等待里。
                const handle = await service.openHandle(input);
                opened.resolve();
                await gate.promise;
                return handle;
            },
        });
        const contextId = await host.issue();

        const reading = host.act(contextId, {kind: "read", owner: LAYOUT_OWNER, key: "layout"});
        await opened.promise;
        await host.request(STORAGE_CONTEXT_PATH, {method: "DELETE", contextId, credential: host.clientCredential});
        gate.resolve();

        // 读取没有文件副作用，但已失效的访问同样不能读到状态：取得句柄后还要再核验一次。
        const failure = await expectFailure(await reading, 403, "STORAGE_CONTEXT_INVALID");
        expect(failure.data?.reason).toBe("unknown-context");
    });

    it("回收已持久化新代次后授权失效：非锁失败也如实报告 committed", async () => {
        let metaPath: string | null = null;
        const host = await createHost({
            definitions,
            fileOptions: {
                replace: {
                    replace: async (source, target) => {
                        await rename(source, target);
                        if (target === metaPath) {
                            // 新分区代次已经落盘；撤销发生在这个已提交事实之后。
                            await host.request(STORAGE_CONTEXT_PATH, {method: "DELETE", contextId, credential: host.clientCredential});
                        }
                    },
                },
            },
        });
        const contextId = await host.issue();
        const saved = await host.act(contextId, {
            kind: "save",
            owner: NOTE_OWNER,
            key: "note",
            resource: "first",
            expected: {revision: null, partitionGeneration: 1},
            value: {text: "first"},
        });
        expect(saved.status).toBe(200);
        const savedCredential = (await saved.json() as {credential: {revision: string; partitionGeneration: number}}).credential;
        const removed = await host.act(contextId, {
            kind: "remove",
            owner: NOTE_OWNER,
            key: "note",
            resource: "first",
            expected: savedCredential,
        });
        expect(removed.status).toBe(200);
        const partition = await host.partition({owner: NOTE_OWNER});
        // 句柄持有的是规范化后的真实路径：比较前先解析，避免同一目录的不同拼写被当成两个地址。
        metaPath = await realpath(partition.metaPath);

        const failure = await expectFailure(await host.act(contextId, {
            kind: "reclaim",
            owner: NOTE_OWNER,
            key: "note",
            targets: [{resource: "first"}],
        }), 403, "STORAGE_CONTEXT_INVALID");
        // 新代次已经写进磁盘：这次失败不能报成“没有写入”。
        expect(failure.data?.committed).toBe(true);

        const resumed = await host.issue();
        await expect((await host.act(resumed, {kind: "read", owner: NOTE_OWNER, key: "note", resource: "first"})).json())
            .resolves.toMatchObject({result: {kind: "deleted", credential: {partitionGeneration: 2}}});
    });

    it("关闭排空打开中的请求并拒绝后续动作", async () => {
        const entered = Promise.withResolvers<void>();
        const gate = Promise.withResolvers<void>();
        const host = await createHost({
            definitions,
            openHandle: async (input, service) => {
                entered.resolve();
                await gate.promise;
                return await service.openHandle(input);
            },
        });
        const contextId = await host.issue();

        const pending = host.act(contextId, {kind: "read", owner: LAYOUT_OWNER, key: "layout"});
        await entered.promise;
        const closed = disposeStorageHost();
        gate.resolve();

        await expectFailure(await pending, 503, "STORAGE_SERVICE_CLOSED");
        await closed;
        await expectFailure(
            await host.act(contextId, {kind: "read", owner: LAYOUT_OWNER, key: "layout"}),
            503,
            "STORAGE_SERVICE_CLOSED",
        );
    });
});
