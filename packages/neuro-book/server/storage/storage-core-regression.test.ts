import {mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile} from "node:fs/promises";
import path from "node:path";
import {lock as acquireFileLock} from "proper-lockfile";
import {testHostPath} from "@notnotype/neuro-book-test-support/test-path";
import {afterEach, describe, expect, it, vi} from "vitest";
import {defineStorageState, StorageStateRegistry} from "nbook/shared/storage/definition";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {StorageService, type StorageServiceOptions} from "nbook/server/storage/storage-service";
import {storagePartitionPaths} from "nbook/server/storage/storage-address";

const state = defineStorageState({
    owner: "test.owner", key: "grid", scope: "user", records: "identified", schemaVersion: 1,
    defaultValue: {width: 1}, validate: (value: unknown): value is {width: number} =>
        typeof value === "object" && value !== null && "width" in value && typeof value.width === "number",
});
const roots: string[] = [];
const services: StorageService[] = [];
afterEach(async () => {
    await Promise.all(services.splice(0).map((service) => service.close()));
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    return {promise, resolve};
}

async function fixture(options: Omit<StorageServiceOptions, "registry"> = {}) {
    const scratch = await mkdtemp(testHostPath("storage-regression-"));
    roots.push(scratch);
    const root = absoluteFsPath(path.join(scratch, "storage"));
    await mkdir(root);
    const registry = new StorageStateRegistry();
    registry.register(state);
    const service = new StorageService({registry, ...options});
    services.push(service);
    const context = {scope: "user" as const, storageRoot: root, identityDomain: "domain", subject: "user", clientId: "client"};
    const partition = storagePartitionPaths({...context, locality: "local", owner: state.owner});
    const input = {owner: state.owner, context};
    return {scratch, root, registry, service, context, partition, input, open: () => service.openHandle(input)};
}

describe("Storage 核心边界回归", () => {
    it("回收也撤销尚未读过任何记录的旧句柄", async () => {
        const f = await fixture();
        const cold = await f.open();
        const maintainer = await f.open();
        await maintainer.remove(state, {resource: "one", expected: {revision: null, partitionGeneration: 1}});
        await maintainer.reclaim(state, {targets: [{resource: "one"}]});
        await expect(cold.read(state, {resource: "two"})).rejects.toMatchObject({code: "STORAGE_CREDENTIAL_STALE"});
        await expect(maintainer.read(state, {resource: "two"})).rejects.toMatchObject({code: "STORAGE_CREDENTIAL_STALE"});
    });

    it("排队保存捕获原值、资源和凭据，同记录按接纳顺序提交", async () => {
        const f = await fixture();
        const handle = await f.open();
        const input = {resource: "one", expected: {revision: null as string | null, partitionGeneration: 1}, value: {width: 7}};
        const first = handle.save(state, input);
        const second = handle.save(state, {...input, value: {width: 8}});
        input.value.width = 99;
        input.expected.partitionGeneration = 99;
        input.resource = "two";
        const results = await Promise.allSettled([first, second]);
        expect(results[0].status).toBe("fulfilled");
        expect(results[1]).toMatchObject({status: "rejected", reason: {code: "STORAGE_REVISION_CONFLICT"}});
        await expect(handle.read(state, {resource: "one"})).resolves.toMatchObject({kind: "value", value: {width: 7}});
        await expect(handle.read(state, {resource: "two"})).resolves.toMatchObject({kind: "missing"});
    });

    it("两次服务关闭都等待已接纳请求释放锁", async () => {
        const started = deferred();
        const gate = deferred();
        const f = await fixture({lockAdapter: {acquire: async (file, options) => {
            const release = await acquireFileLock(file, options);
            return async () => { started.resolve(); await gate.promise; await release(); };
        }}});
        const handle = await f.open();
        const saving = handle.save(state, {resource: "one", expected: {revision: null, partitionGeneration: 1}, value: {width: 2}});
        await started.promise;
        let settled = 0;
        const closing = f.service.close().then(() => { settled += 1; });
        const again = f.service.close().then(() => { settled += 1; });
        await new Promise<void>((done) => setImmediate(done));
        expect(settled).toBe(0);
        gate.resolve();
        await Promise.all([saving, closing, again]);
        expect(settled).toBe(2);
    });

    it("异步打开与服务关闭竞争时不给迟到可用句柄", async () => {
        const f = await fixture();
        const opening = f.open();
        const result = Promise.allSettled([opening]);
        await f.service.close();
        expect(await result).toMatchObject([{status: "rejected", reason: {code: "STORAGE_SERVICE_CLOSED"}}]);
    });

    it("独立服务写入能自动被观察，回收使同分区其它资源订阅失效", async () => {
        const f = await fixture();
        const peer = new StorageService({registry: f.registry});
        services.push(peer);
        const reader = await f.open();
        const writer = await peer.openHandle(f.input);
        const onUpdate = vi.fn();
        const onError = vi.fn();
        await reader.subscribe(state, {resource: "one", onUpdate, onError});
        await writer.save(state, {resource: "one", expected: {revision: null, partitionGeneration: 1}, value: {width: 8}});
        await vi.waitFor(() => expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({value: {width: 8}})), {timeout: 2000});
        await writer.remove(state, {resource: "two", expected: {revision: null, partitionGeneration: 1}});
        await writer.reclaim(state, {targets: [{resource: "two"}]});
        await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({code: "STORAGE_CREDENTIAL_STALE"})), {timeout: 2000});
    });

    it("存储根同路径重建后旧句柄不能重建分区", async () => {
        const f = await fixture();
        const handle = await f.open();
        await handle.read(state, {resource: "one"});
        await rename(f.root, path.join(f.scratch, "old-storage"));
        await mkdir(f.root);
        await expect(handle.save(state, {resource: "one", expected: {revision: null, partitionGeneration: 1}, value: {width: 2}}))
            .rejects.toMatchObject({code: "STORAGE_IO_FAILURE"});
        expect(await readdir(f.root)).toEqual([]);
    });

    it("同根内的另一个 owner 也不能成为目录联接目标", async () => {
        const f = await fixture();
        const handle = await f.open();
        const other = path.join(path.dirname(f.partition.directory), "other.owner");
        await mkdir(path.join(other, "records"), {recursive: true});
        const original = "other owner data";
        await writeFile(path.join(other, "records", "grid~one.json"), original);
        await symlink(other, f.partition.directory, "junction");
        await expect(handle.read(state, {resource: "one"})).rejects.toMatchObject({code: "STORAGE_PATH_ESCAPE"});
        await expect(handle.save(state, {resource: "one", expected: {revision: null, partitionGeneration: 1}, value: {width: 2}}))
            .rejects.toMatchObject({code: "STORAGE_PATH_ESCAPE"});
        expect(await readFile(path.join(other, "records", "grid~one.json"), "utf8")).toBe(original);
    });

    it("修复目标替换遇到 ENOSPC 后，原地址仍然损坏且原件可诊断", async () => {
        const f = await fixture({fileOptions: {replace: {replace: async (source, target) => {
            if (target.endsWith("grid~one.json")) throw Object.assign(new Error("no space"), {code: "ENOSPC"});
            await rename(source, target);
        }}}});
        await mkdir(f.partition.recordsDirectory, {recursive: true});
        const target = path.join(f.partition.recordsDirectory, "grid~one.json");
        const original = "{broken json";
        await writeFile(target, original);
        const handle = await f.open();
        const corrupt = await handle.read(state, {resource: "one"});
        if (corrupt.kind !== "corrupt") throw new Error("expected corrupt");
        await expect(handle.repair(state, {resource: "one", expected: corrupt.repair, value: {width: 2}}))
            .rejects.toMatchObject({code: "STORAGE_IO_FAILURE", operation: "replace"});
        expect(await readFile(target, "utf8")).toBe(original);
        await expect(handle.read(state, {resource: "one"})).resolves.toEqual(corrupt);
        const originals = await readdir(f.partition.quarantineDirectory);
        expect(originals).toHaveLength(1);
        expect(await readFile(path.join(f.partition.quarantineDirectory, originals[0]!), "utf8")).toBe(original);
    });

    it("代次解析失败也释放已取得的锁", async () => {
        const f = await fixture();
        const handle = await f.open();
        await mkdir(f.partition.directory, {recursive: true});
        await writeFile(f.partition.metaPath, "{broken");
        await expect(handle.save(state, {resource: "one", expected: {revision: null, partitionGeneration: 1}, value: {width: 2}}))
            .rejects.toMatchObject({code: "STORAGE_PARTITION_INVALID"});
        await expect(readdir(f.partition.lockPath)).rejects.toMatchObject({code: "ENOENT"});
        await writeFile(f.partition.metaPath, JSON.stringify({schema: "nbook.storage-partition/v1", generation: 1}));
        await expect(handle.save(state, {resource: "one", expected: {revision: null, partitionGeneration: 1}, value: {width: 2}}))
            .resolves.toMatchObject({revision: expect.any(String)});
    });

    it("重复删除没有提交新记录，释放失败不能假报 committed", async () => {
        let failRelease = false;
        const f = await fixture({lockAdapter: {acquire: async (file, options) => {
            const release = await acquireFileLock(file, options);
            return async () => { await release(); if (failRelease) throw new Error("release acknowledgement lost"); };
        }}});
        const handle = await f.open();
        const deleted = await handle.remove(state, {resource: "one", expected: {revision: null, partitionGeneration: 1}});
        failRelease = true;
        await expect(handle.remove(state, {resource: "one", expected: deleted}))
            .rejects.toMatchObject({code: "STORAGE_LOCK_UNAVAILABLE", committed: false});
    });

    it("替换已经提交后锁失效，如实报告 committed 并可重读新值", async () => {
        let compromise: ((error: Error) => void) | undefined;
        const f = await fixture({
            lockAdapter: {acquire: async (file, options) => {
                compromise = options.onCompromised;
                return acquireFileLock(file, options);
            }},
            fileOptions: {replace: {replace: async (source, target) => {
                await rename(source, target);
                if (target.endsWith("grid~one.json")) compromise?.(new Error("heartbeat lost"));
            }}},
        });
        const handle = await f.open();
        await expect(handle.save(state, {resource: "one", expected: {revision: null, partitionGeneration: 1}, value: {width: 4}}))
            .rejects.toMatchObject({code: "STORAGE_LOCK_UNAVAILABLE", committed: true});
        await expect(handle.read(state, {resource: "one"})).resolves.toMatchObject({kind: "value", value: {width: 4}});
    });

    it("替换重试前发现锁失效就停止，保留旧文件", async () => {
        let failing = false;
        let attempts = 0;
        let compromise: ((error: Error) => void) | undefined;
        const f = await fixture({
            lockAdapter: {acquire: async (file, options) => {
                compromise = options.onCompromised;
                return acquireFileLock(file, options);
            }},
            fileOptions: {retryDelaysMs: [0], replace: {replace: async (source, target) => {
                if (failing && target.endsWith("grid~one.json")) {
                    attempts += 1;
                    compromise?.(new Error("heartbeat lost"));
                    throw Object.assign(new Error("busy"), {code: "EBUSY"});
                }
                await rename(source, target);
            }}},
        });
        const handle = await f.open();
        const saved = await handle.save(state, {resource: "one", expected: {revision: null, partitionGeneration: 1}, value: {width: 4}});
        failing = true;
        await expect(handle.save(state, {resource: "one", expected: saved, value: {width: 5}}))
            .rejects.toMatchObject({code: "STORAGE_LOCK_UNAVAILABLE", committed: false});
        expect(attempts).toBe(1);
        await expect(handle.read(state, {resource: "one"})).resolves.toMatchObject({kind: "value", value: {width: 4}});
    });

    it("分区代次达到安全整数上限时拒绝回收，不删墓碑", async () => {
        const f = await fixture();
        const handle = await f.open();
        await handle.remove(state, {resource: "one", expected: {revision: null, partitionGeneration: 1}});
        await writeFile(f.partition.metaPath, JSON.stringify({schema: "nbook.storage-partition/v1", generation: Number.MAX_SAFE_INTEGER}));
        const fresh = await f.open();
        await expect(fresh.reclaim(state, {targets: [{resource: "one"}]})).rejects.toMatchObject({code: "STORAGE_PARTITION_INVALID"});
        await expect(fresh.read(state, {resource: "one"})).resolves.toMatchObject({kind: "deleted"});
    });
});
