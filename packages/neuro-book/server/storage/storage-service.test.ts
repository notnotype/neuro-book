import {access, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, symlink, utimes, writeFile} from "node:fs/promises";
import path from "node:path";
import {lock as acquireFileLock} from "proper-lockfile";
import {testHostPath} from "@notnotype/neuro-book-test-support/test-path";
import {afterEach, describe, expect, it} from "vitest";
import type {StorageCredential, StorageLocality, StorageReadResult, StorageScope} from "nbook/shared/storage/contract";
import {defineStorageState, StorageStateRegistry, type DefinedStorageState} from "nbook/shared/storage/definition";
import {absoluteFsPath, type AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {storagePartitionPaths, type StoragePartitionPaths} from "nbook/server/storage/storage-address";
import {STORAGE_LOCK_STALE_MS, type StorageLockAdapter} from "nbook/server/storage/partition-lock";
import {serializeStorageRecord} from "nbook/server/storage/record-codec";
import {writeStorageRecordFile, type StorageReplaceAdapter} from "nbook/server/storage/record-file";
import {ensureStorageIdentityDomain} from "nbook/server/storage/identity-domain";
import type {StoragePartitionStoreOptions} from "nbook/server/storage/partition-store";
import {
    StorageHandle,
    StorageService,
} from "nbook/server/storage/storage-service";

type LayoutState = {
    readonly width: number;
    readonly height: number;
};

type NoteState = {
    readonly text: string;
};

type ViewState = {
    readonly view: string;
};

const ROOT_OWNER = "test.workspace";
const VIEW_OWNER = "test.views";

const layoutDefinition: DefinedStorageState<LayoutState> = defineStorageState({
    owner: ROOT_OWNER,
    key: "layout",
    scope: "user",
    locality: "local",
    records: "single",
    schemaVersion: 1,
    defaultValue: {width: 320, height: 240},
    validate: isLayoutState,
});

const sharedLayoutDefinition: DefinedStorageState<LayoutState> = defineStorageState({
    owner: ROOT_OWNER,
    key: "shared-layout",
    scope: "user",
    locality: "shared",
    records: "single",
    schemaVersion: 1,
    defaultValue: {width: 320, height: 240},
    validate: isLayoutState,
});

const noteDefinition: DefinedStorageState<NoteState> = defineStorageState({
    owner: VIEW_OWNER,
    key: "note",
    scope: "user",
    locality: "local",
    records: "identified",
    schemaVersion: 1,
    defaultValue: {text: ""},
    validate: isNoteState,
    limits: {maxRecords: 3, maxPartitionBytes: 2048},
});

const viewDefinition: DefinedStorageState<ViewState> = defineStorageState({
    owner: VIEW_OWNER,
    key: "view",
    scope: "user",
    locality: "local",
    records: "identified",
    schemaVersion: 1,
    defaultValue: {view: "default"},
    validate: isViewState,
    limits: {maxRecords: 3, maxPartitionBytes: 2048},
});

function isLayoutState(value: unknown): value is LayoutState {
    return typeof value === "object" && value !== null
        && typeof (value as LayoutState).width === "number"
        && typeof (value as LayoutState).height === "number";
}

function isNoteState(value: unknown): value is NoteState {
    return typeof value === "object" && value !== null && typeof (value as NoteState).text === "string";
}

function isViewState(value: unknown): value is ViewState {
    return typeof value === "object" && value !== null && typeof (value as ViewState).view === "string";
}

function testRegistry(): StorageStateRegistry {
    const registry = new StorageStateRegistry();
    registry.register(layoutDefinition);
    registry.register(sharedLayoutDefinition);
    registry.register(noteDefinition);
    registry.register(viewDefinition);
    return registry;
}

/** 收集订阅通知；等待条件由通知本身唤醒，不用轮询计时。 */
class SubscriptionUpdates<T> {
    readonly snapshots: StorageReadResult<T>[] = [];
    private readonly waiters = new Set<() => void>();

    readonly listener = (snapshot: StorageReadResult<T>): void => {
        this.snapshots.push(snapshot);
        for (const waiter of [...this.waiters]) {
            waiter();
        }
    };

    /** 等待直到条件成立；通知异常导致的永久等待由测试超时暴露。 */
    async waitFor(predicate: () => boolean): Promise<void> {
        while (!predicate()) {
            await new Promise<void>((resolve) => {
                this.waiters.add(resolve);
            });
        }
    }
}

const roots: string[] = [];
const services: StorageService[] = [];

afterEach(async () => {
    await Promise.all(services.splice(0).map((service) => service.close()));
    await Promise.all(roots.splice(0).map(async (root) => rm(root, {recursive: true, force: true})));
});

type TestOpenOptions = {
    readonly subject?: string;
    readonly clientId?: string;
    readonly identityDomain?: string;
    readonly owner?: string;
};

type StorageTestContext = {
    readonly root: AbsoluteFsPath;
    readonly identityDomain: string;
    readonly service: StorageService;
    readonly registry: StorageStateRegistry;
    open(options?: TestOpenOptions): Promise<StorageHandle>;
};

type TestContextOptions = {
    readonly registry?: StorageStateRegistry;
    readonly fileOptions?: StoragePartitionStoreOptions;
    readonly lockAdapter?: StorageLockAdapter;
    readonly reuseRoot?: AbsoluteFsPath;
};

async function createStorageContext(prefix: string, options: TestContextOptions = {}): Promise<StorageTestContext> {
    let root = options.reuseRoot;
    if (root === undefined) {
        const scratch = await mkdtemp(testHostPath(prefix));
        roots.push(scratch);
        root = absoluteFsPath(path.join(scratch, "storage"));
    }
    const {identityDomain} = await ensureStorageIdentityDomain(root);
    const registry = options.registry ?? testRegistry();
    const service = new StorageService({
        registry,
        lockAdapter: options.lockAdapter,
        fileOptions: options.fileOptions,
    });
    services.push(service);
    return {
        root,
        identityDomain,
        service,
        registry,
        open: async (openOptions: TestOpenOptions = {}) => service.openHandle({
            owner: openOptions.owner ?? ROOT_OWNER,
            context: {
                scope: "user",
                storageRoot: root,
                identityDomain: openOptions.identityDomain ?? identityDomain,
                subject: openOptions.subject ?? "user-a",
                clientId: openOptions.clientId ?? "client-1",
            },
        }),
    };
}

type PartitionQuery = {
    readonly subject?: string;
    readonly clientId?: string;
    readonly locality?: StorageLocality;
    readonly scope?: StorageScope;
    readonly owner?: string;
    readonly identityDomain?: string;
};

async function partitionOf(context: StorageTestContext, query: PartitionQuery = {}): Promise<StoragePartitionPaths> {
    const root = absoluteFsPath(await realpath(context.root));
    return storagePartitionPaths({
        storageRoot: root,
        identityDomain: query.identityDomain ?? context.identityDomain,
        subject: query.subject ?? "user-a",
        locality: query.locality ?? "local",
        clientId: query.clientId ?? "client-1",
        owner: query.owner ?? ROOT_OWNER,
    });
}

function recordPathOf(partition: StoragePartitionPaths, fileName: string): AbsoluteFsPath {
    return absoluteFsPath(path.join(partition.recordsDirectory, fileName));
}

function valueCredential(credential: {readonly revision: string | null; readonly partitionGeneration: number}): {
    readonly revision: string;
    readonly partitionGeneration: number;
} {
    if (credential.revision === null) {
        throw new Error("需要已存在的 revision");
    }
    return {revision: credential.revision, partitionGeneration: credential.partitionGeneration};
}

/** 缺失读取的条件凭据；非 missing 分类立即失败，避免用错凭据继续写。 */
function missingCredential<T>(result: StorageReadResult<T>): StorageCredential {
    if (result.kind !== "missing") {
        throw new Error(`需要 missing 读取结果，实际 ${result.kind}`);
    }
    return result.credential;
}

describe("StorageService 归属与隔离", () => {
    it("两个主体、两个客户端与两个身份域分别读写同名键", async () => {
        const context = await createStorageContext("nbook-storage-isolation-");
        const first = await context.open({subject: "user-a", clientId: "client-1"});
        const secondSubject = await context.open({subject: "user-b", clientId: "client-1"});
        const secondClient = await context.open({subject: "user-a", clientId: "client-2"});

        const initial = await first.read(layoutDefinition);
        expect(initial).toMatchObject({kind: "missing", credential: {revision: null, partitionGeneration: 1}});
        const saved = await first.save(layoutDefinition, {
            expected: missingCredential(initial),
            value: {width: 400, height: 200},
        });

        await expect(first.read(layoutDefinition)).resolves.toMatchObject({
            kind: "value",
            value: {width: 400, height: 200},
            credential: {revision: saved.revision},
        });
        await expect(secondSubject.read(layoutDefinition)).resolves.toMatchObject({kind: "missing"});
        await expect(secondClient.read(layoutDefinition)).resolves.toMatchObject({kind: "missing"});

        const otherDomainContext = await createStorageContext("nbook-storage-domain-");
        expect(otherDomainContext.identityDomain).not.toBe(context.identityDomain);
        const otherDomain = await otherDomainContext.open({subject: "user-a", clientId: "client-1"});
        await expect(otherDomain.read(layoutDefinition)).resolves.toMatchObject({kind: "missing"});

        const sharedInitial = await first.read(sharedLayoutDefinition);
        await first.save(sharedLayoutDefinition, {
            expected: missingCredential(sharedInitial),
            value: {width: 111, height: 222},
        });
        await expect(secondClient.read(sharedLayoutDefinition)).resolves.toMatchObject({
            kind: "value",
            value: {width: 111, height: 222},
        });
        await expect(secondSubject.read(sharedLayoutDefinition)).resolves.toMatchObject({kind: "missing"});
    });

    it("缺失读取不创建默认值文件或分区目录", async () => {
        const context = await createStorageContext("nbook-storage-missing-");
        const handle = await context.open();

        await expect(handle.read(layoutDefinition)).resolves.toMatchObject({kind: "missing"});
        const partition = await partitionOf(context);
        await expect(access(partition.directory)).rejects.toMatchObject({code: "ENOENT"});
        await expect(access(partition.recordsDirectory)).rejects.toMatchObject({code: "ENOENT"});
    });

    it("缺少客户端上下文、owner 或 scope 不匹配时拒绝访问", async () => {
        const context = await createStorageContext("nbook-storage-context-");
        const noClient = await context.service.openHandle({
            owner: ROOT_OWNER,
            context: {scope: "user", storageRoot: context.root, identityDomain: context.identityDomain, subject: "user-a"},
        });
        await expect(noClient.read(layoutDefinition)).rejects.toMatchObject({
            code: "STORAGE_CONTEXT_INVALID",
            reason: "client",
        });
        await expect(noClient.read(sharedLayoutDefinition)).resolves.toMatchObject({kind: "missing"});

        const handle = await context.open();
        await expect(handle.read(noteDefinition)).rejects.toMatchObject({
            code: "STORAGE_CONTEXT_INVALID",
            reason: "owner",
        });

        const projectService = new StorageService({registry: context.registry});
        const projectHandle = await projectService.openHandle({
            owner: ROOT_OWNER,
            context: {
                scope: "project",
                storageRoot: context.root,
                identityDomain: context.identityDomain,
                subject: "user-a",
                clientId: "client-1",
            },
        });
        await expect(projectHandle.read(layoutDefinition)).rejects.toMatchObject({
            code: "STORAGE_CONTEXT_INVALID",
            reason: "scope",
        });
    });
});

describe("条件保存、删除与恢复", () => {
    it("显式重置缺失记录会拒绝删除之前的缺失凭据", async () => {
        const context = await createStorageContext("nbook-storage-reset-missing-");
        const handle = await context.open();
        const missing = await handle.read(layoutDefinition);
        if (missing.kind !== "missing") throw new Error("expected missing");
        const deleted = await handle.remove(layoutDefinition, {expected: missing.credential});
        expect(deleted.revision).not.toBeNull();
        await expect(handle.save(layoutDefinition, {expected: missing.credential, value: {width: 1, height: 2}}))
            .rejects.toMatchObject({code: "STORAGE_REVISION_CONFLICT"});
        await context.service.close();
    });

    it("条件保存按 revision 串行成功，过期 revision 返回冲突并保留最新值", async () => {
        const context = await createStorageContext("nbook-storage-cas-");
        const handle = await context.open();

        const missing = await handle.read(layoutDefinition);
        const first = await handle.save(layoutDefinition, {
            expected: missingCredential(missing),
            value: {width: 1, height: 1},
        });
        await expect(handle.save(layoutDefinition, {expected: missingCredential(missing), value: {width: 2, height: 2}}))
            .rejects.toMatchObject({
                code: "STORAGE_REVISION_CONFLICT",
                expectedRevision: null,
                observedRevision: first.revision,
            });

        const second = await handle.save(layoutDefinition, {
            expected: valueCredential(first),
            value: {width: 2, height: 2},
        });
        expect(second.revision).not.toBe(first.revision);
        await expect(handle.read(layoutDefinition)).resolves.toMatchObject({
            kind: "value",
            value: {width: 2, height: 2},
            credential: {revision: second.revision},
        });
    });

    it("条件删除形成墓碑，旧 revision 不能复活已删除的值", async () => {
        const context = await createStorageContext("nbook-storage-delete-");
        const handle = await context.open();
        const missing = await handle.read(layoutDefinition);
        const saved = await handle.save(layoutDefinition, {
            expected: missingCredential(missing),
            value: {width: 500, height: 300},
        });

        const tombstone = await handle.remove(layoutDefinition, {expected: valueCredential(saved)});
        expect(tombstone.revision).not.toBe(saved.revision);
        await expect(handle.read(layoutDefinition)).resolves.toMatchObject({
            kind: "deleted",
            credential: {revision: tombstone.revision},
        });
        await expect(handle.save(layoutDefinition, {expected: saved, value: {width: 1, height: 1}}))
            .rejects.toMatchObject({code: "STORAGE_REVISION_CONFLICT"});
        await expect(handle.read(layoutDefinition)).resolves.toMatchObject({kind: "deleted"});

        await expect(handle.remove(layoutDefinition, {expected: valueCredential(tombstone)}))
            .resolves.toMatchObject({revision: tombstone.revision});
    });

    it("保存成功后可重启恢复，新句柄重新读取最新当前值", async () => {
        const context = await createStorageContext("nbook-storage-restart-");
        const handle = await context.open();
        const missing = await handle.read(layoutDefinition);
        await handle.save(layoutDefinition, {expected: missingCredential(missing), value: {width: 640, height: 480}});
        await handle.release();

        const restarted = await createStorageContext("nbook-storage-restart-", {
            reuseRoot: context.root,
            registry: context.registry,
        });
        const reopened = await restarted.open();
        await expect(reopened.read(layoutDefinition)).resolves.toMatchObject({
            kind: "value",
            value: {width: 640, height: 480},
            schemaVersion: 1,
        });
    });

    it("值未通过注册校验或超出单条上限时在写入前拒绝", async () => {
        const context = await createStorageContext("nbook-storage-value-");
        const handle = await context.open();
        const viewHandle = await context.open({owner: VIEW_OWNER});
        const missing = await handle.read(layoutDefinition);

        await expect(handle.save(layoutDefinition, {
            expected: missingCredential(missing),
            value: {width: Number.NaN, height: 1},
        })).rejects.toMatchObject({code: "STORAGE_VALUE_INVALID"});
        await expect(handle.save(layoutDefinition, {
            expected: missingCredential(missing),
            value: {width: "320", height: 1} as unknown as LayoutState,
        })).rejects.toMatchObject({code: "STORAGE_VALUE_INVALID", reason: "validate"});
        await expect(viewHandle.save(noteDefinition, {
            resource: "note-1",
            expected: {revision: null, partitionGeneration: 1},
            value: {text: "x".repeat(64 * 1024)},
        })).rejects.toMatchObject({code: "STORAGE_VALUE_TOO_LARGE"});
        await expect(handle.read(layoutDefinition)).resolves.toMatchObject({kind: "missing"});
    });
});

describe("损坏、未知版本与显式修复", () => {
    it("单个坏键不影响同分区其它记录的读取", async () => {
        const context = await createStorageContext("nbook-storage-corrupt-");
        const handle = await context.open({owner: VIEW_OWNER});
        await handle.save(viewDefinition, {
            resource: "grid-a",
            expected: {revision: null, partitionGeneration: 1},
            value: {view: "a"},
        });
        const partition = await partitionOf(context, {owner: VIEW_OWNER});
        await writeStorageRecordFile({target: recordPathOf(partition, "view~grid-b.json"), content: "{broken\n"});

        await expect(handle.read(viewDefinition, {resource: "grid-b"})).resolves.toMatchObject({
            kind: "corrupt",
            repair: {partitionGeneration: 1, contentFingerprint: expect.stringMatching(/^sha256:/u)},
        });
        await expect(handle.read(viewDefinition, {resource: "grid-a"})).resolves.toMatchObject({
            kind: "value",
            value: {view: "a"},
        });
        await expect(handle.save(viewDefinition, {
            resource: "grid-b",
            expected: {revision: null, partitionGeneration: 1},
            value: {view: "b"},
        })).rejects.toMatchObject({code: "STORAGE_WRITE_BLOCKED", reason: "corrupt"});
    });

    it("更高 schemaVersion 与更高封装版本都禁止普通保存", async () => {
        const context = await createStorageContext("nbook-storage-version-");
        const handle = await context.open({owner: VIEW_OWNER});
        const partition = await partitionOf(context, {owner: VIEW_OWNER});
        await writeStorageRecordFile({
            target: recordPathOf(partition, "view~future.json"),
            content: serializeStorageRecord({
                kind: "value",
                revision: "0f8fad5b-d9cb-469f-a165-70867728950e",
                schemaVersion: 7,
                value: {view: "future"},
            }),
        });
        await writeStorageRecordFile({
            target: recordPathOf(partition, "view~newer-wrapper.json"),
            content: `${JSON.stringify({
                wrapper: 2,
                revision: "0f8fad5b-d9cb-469f-a165-70867728951e",
                state: "value",
                schemaVersion: 1,
                value: {view: "wrapper"},
            })}\n`,
        });

        await expect(handle.read(viewDefinition, {resource: "future"})).resolves.toMatchObject({
            kind: "unsupported-version",
            wrapperVersion: null,
            schemaVersion: 7,
        });
        await expect(handle.read(viewDefinition, {resource: "newer-wrapper"})).resolves.toMatchObject({
            kind: "unsupported-version",
            wrapperVersion: 2,
        });
        for (const resource of ["future", "newer-wrapper"]) {
            await expect(handle.save(viewDefinition, {
                resource,
                expected: {revision: null, partitionGeneration: 1},
                value: {view: "overwrite"},
            })).rejects.toMatchObject({code: "STORAGE_WRITE_BLOCKED", reason: "unsupported-version"});
        }
    });

    it("显式修复先隔离原件再替换，凭据必须绑定原内容", async () => {
        const context = await createStorageContext("nbook-storage-repair-");
        const handle = await context.open({owner: VIEW_OWNER});
        const partition = await partitionOf(context, {owner: VIEW_OWNER});
        const original = `${JSON.stringify({
            wrapper: 2,
            revision: "0f8fad5b-d9cb-469f-a165-70867728952e",
            state: "value",
            schemaVersion: 1,
            value: {view: "future-wrapper"},
        })}\n`;
        const target = recordPathOf(partition, "view~repair.json");
        await writeStorageRecordFile({target, content: original});

        const broken = await handle.read(viewDefinition, {resource: "repair"});
        if (broken.kind !== "unsupported-version") {
            throw new Error(`需要 unsupported-version 读取结果，实际 ${broken.kind}`);
        }
        await expect(handle.repair(viewDefinition, {
            resource: "repair",
            expected: {...broken.repair, contentFingerprint: "sha256:0"},
            value: {view: "reset"},
        })).rejects.toMatchObject({code: "STORAGE_REPAIR_CONFLICT"});

        await writeStorageRecordFile({target, content: `${original} `});
        await expect(handle.repair(viewDefinition, {
            resource: "repair",
            expected: broken.repair,
            value: {view: "reset"},
        })).rejects.toMatchObject({code: "STORAGE_REPAIR_CONFLICT"});

        const reloaded = await handle.read(viewDefinition, {resource: "repair"});
        if (reloaded.kind !== "unsupported-version") {
            throw new Error(`需要 unsupported-version 读取结果，实际 ${reloaded.kind}`);
        }
        await expect(handle.repair(viewDefinition, {
            resource: "repair",
            expected: reloaded.repair,
            value: {view: "reset"},
        })).resolves.toMatchObject({revision: expect.any(String)});
        await expect(handle.read(viewDefinition, {resource: "repair"})).resolves.toMatchObject({
            kind: "value",
            value: {view: "reset"},
        });

        const quarantined = await readdir(partition.quarantineDirectory);
        expect(quarantined).toHaveLength(1);
        expect(await readFile(path.join(partition.quarantineDirectory, quarantined[0]!), "utf8")).toBe(`${original} `);

        // 后续显式修复仍保留前一份诊断原件；达到保留上限时应拒绝继续修复。
        await writeStorageRecordFile({target, content: original});
        const damagedAgain = await handle.read(viewDefinition, {resource: "repair"});
        if (damagedAgain.kind !== "unsupported-version") {
            throw new Error(`需要 unsupported-version 读取结果，实际 ${damagedAgain.kind}`);
        }
        await handle.repair(viewDefinition, {
            resource: "repair",
            expected: damagedAgain.repair,
            value: {view: "reset-again"},
        });
        const quarantinedAgain = await readdir(partition.quarantineDirectory);
        expect(quarantinedAgain).toHaveLength(2);
        expect(await Promise.all(quarantinedAgain.map((name) => readFile(path.join(partition.quarantineDirectory, name), "utf8"))))
            .toEqual(expect.arrayContaining([original, `${original} `]));
    });

    it("旧 schemaVersion 读取为待迁移值，不按当前规则拒绝", async () => {
        const legacyDefinition = defineStorageState<LayoutState>({
            owner: ROOT_OWNER,
            key: "legacy-layout",
            scope: "user",
            locality: "local",
            records: "single",
            schemaVersion: 2,
            defaultValue: {width: 320, height: 240},
            validate: isLayoutState,
        });
        const registry = new StorageStateRegistry();
        registry.register(legacyDefinition);
        const context = await createStorageContext("nbook-storage-legacy-", {registry});
        const handle = await context.open();
        const partition = await partitionOf(context);
        await writeStorageRecordFile({
            target: recordPathOf(partition, "legacy-layout.json"),
            content: serializeStorageRecord({
                kind: "value",
                revision: "0f8fad5b-d9cb-469f-a165-70867728953e",
                schemaVersion: 1,
                value: {width: "旧格式"},
            }),
        });

        const legacy = await handle.read(legacyDefinition);
        if (legacy.kind !== "legacy-value") {
            throw new Error(`需要 legacy-value 读取结果，实际 ${legacy.kind}`);
        }
        expect(legacy).toMatchObject({schemaVersion: 1, value: {width: "旧格式"}});
        await expect(handle.save(legacyDefinition, {
            expected: legacy.credential,
            value: {width: 100, height: 200},
        })).rejects.toMatchObject({code: "STORAGE_WRITE_BLOCKED"});
        await expect(handle.migrate(legacyDefinition, {
            expected: legacy.credential,
            value: {width: 100, height: 200},
        })).resolves.toMatchObject({revision: expect.any(String)});
        await expect(handle.read(legacyDefinition)).resolves.toMatchObject({
            kind: "value",
            schemaVersion: 2,
            value: {width: 100, height: 200},
        });
    });
});

describe("容量与并发", () => {
    it("删除标记计入条数，删除与回收后仍可写入", async () => {
        const context = await createStorageContext("nbook-storage-quota-records-");
        const handle = await context.open({owner: VIEW_OWNER});
        for (const resource of ["grid-a", "grid-b", "grid-c"]) {
            await handle.save(viewDefinition, {
                resource,
                expected: {revision: null, partitionGeneration: 1},
                value: {view: resource},
            });
        }
        await expect(handle.save(viewDefinition, {
            resource: "grid-d",
            expected: {revision: null, partitionGeneration: 1},
            value: {view: "grid-d"},
        })).rejects.toMatchObject({code: "STORAGE_QUOTA_EXCEEDED", limit: "records", max: 3});

        const gridA = await handle.read(viewDefinition, {resource: "grid-a"});
        if (gridA.kind !== "value") {
            throw new Error(`需要 value 读取结果，实际 ${gridA.kind}`);
        }
        await handle.remove(viewDefinition, {resource: "grid-a", expected: gridA.credential});
        await expect(handle.save(viewDefinition, {
            resource: "grid-d",
            expected: {revision: null, partitionGeneration: 1},
            value: {view: "grid-d"},
        })).rejects.toMatchObject({code: "STORAGE_QUOTA_EXCEEDED", limit: "records"});

        const reclaimed = await handle.reclaim(viewDefinition, {targets: [{resource: "grid-a"}]});
        expect(reclaimed).toMatchObject({
            partitionGeneration: 2,
            outcomes: [{address: {resource: "grid-a"}, outcome: "reclaimed"}],
        });
        const fresh = await context.open({owner: VIEW_OWNER});
        await expect(fresh.save(viewDefinition, {
            resource: "grid-d",
            expected: {revision: null, partitionGeneration: 2},
            value: {view: "grid-d"},
        })).resolves.toMatchObject({partitionGeneration: 2});
    });

    it("分区字节上限拒绝增长写入但允许减少占用", async () => {
        const context = await createStorageContext("nbook-storage-quota-bytes-");
        const handle = await context.open({owner: VIEW_OWNER});
        const large = {text: "x".repeat(1000)};
        await handle.save(noteDefinition, {
            resource: "note-1",
            expected: {revision: null, partitionGeneration: 1},
            value: large,
        });
        await expect(handle.save(noteDefinition, {
            resource: "note-2",
            expected: {revision: null, partitionGeneration: 1},
            value: large,
        })).rejects.toMatchObject({code: "STORAGE_QUOTA_EXCEEDED", limit: "bytes", max: 2048});

        const note = await handle.read(noteDefinition, {resource: "note-1"});
        if (note.kind !== "value") {
            throw new Error(`需要 value 读取结果，实际 ${note.kind}`);
        }
        await expect(handle.save(noteDefinition, {
            resource: "note-1",
            expected: note.credential,
            value: {text: "short"},
        })).resolves.toMatchObject({revision: expect.any(String)});
    });

    it("不同键并发保存仍然共用同一容量检查，不能同时越过上限", async () => {
        const context = await createStorageContext("nbook-storage-quota-concurrent-");
        const handle = await context.open({owner: VIEW_OWNER});
        const results = await Promise.allSettled(["grid-0", "grid-1", "grid-2", "grid-3", "grid-4"].map(
            async (resource) => handle.save(viewDefinition, {
                resource,
                expected: {revision: null, partitionGeneration: 1},
                value: {view: resource},
            }),
        ));

        const accepted = results.filter((result) => result.status === "fulfilled");
        const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
        expect(accepted).toHaveLength(3);
        expect(rejected.map((result) => result.reason.code)).toEqual([
            "STORAGE_QUOTA_EXCEEDED",
            "STORAGE_QUOTA_EXCEEDED",
        ]);
        const partition = await partitionOf(context, {owner: VIEW_OWNER});
        const files = (await readdir(partition.recordsDirectory)).filter((name) => name.endsWith(".json"));
        expect(files).toHaveLength(3);
    });
});

describe("墓碑回收与代次", () => {
    it("回收释放墓碑容量并使回收前的条件凭据失效", async () => {
        const context = await createStorageContext("nbook-storage-reclaim-");
        const handle = await context.open({owner: VIEW_OWNER});
        const saved = await handle.save(viewDefinition, {
            resource: "grid-a",
            expected: {revision: null, partitionGeneration: 1},
            value: {view: "grid-a"},
        });
        const tombstone = await handle.remove(viewDefinition, {resource: "grid-a", expected: saved});
        await handle.save(viewDefinition, {
            resource: "grid-b",
            expected: {revision: null, partitionGeneration: 1},
            value: {view: "grid-b"},
        });

        const reclaimed = await handle.reclaim(viewDefinition, {targets: [{resource: "grid-a"}, {resource: "grid-b"}]});
        expect(reclaimed.outcomes).toEqual([
            {address: {resource: "grid-a"}, outcome: "reclaimed"},
            {address: {resource: "grid-b"}, outcome: "retained", reason: "live"},
        ]);
        const partition = await partitionOf(context, {owner: VIEW_OWNER});
        await expect(access(recordPathOf(partition, "view~grid-a.json"))).rejects.toMatchObject({code: "ENOENT"});
        await expect(handle.read(viewDefinition, {resource: "grid-a"})).rejects.toMatchObject({code: "STORAGE_CREDENTIAL_STALE"});
        const fresh = await context.open({owner: VIEW_OWNER});
        await expect(fresh.read(viewDefinition, {resource: "grid-a"})).resolves.toMatchObject({
            kind: "missing",
            credential: {revision: null, partitionGeneration: 2},
        });
        await expect(fresh.read(viewDefinition, {resource: "grid-b"})).resolves.toMatchObject({
            kind: "value",
            value: {view: "grid-b"},
        });
        await expect(fresh.save(viewDefinition, {
            resource: "grid-a",
            expected: valueCredential(tombstone),
            value: {view: "resurrected"},
        })).rejects.toMatchObject({code: "STORAGE_CREDENTIAL_STALE"});
        await expect(fresh.read(viewDefinition, {resource: "grid-a"})).resolves.toMatchObject({kind: "missing"});
    });

    it("回收前的旧句柄失效，需重新初始化后才能继续写入", async () => {
        const context = await createStorageContext("nbook-storage-reclaim-handle-");
        const stale = await context.open({owner: VIEW_OWNER});
        const saved = await stale.save(viewDefinition, {
            resource: "grid-a",
            expected: {revision: null, partitionGeneration: 1},
            value: {view: "grid-a"},
        });
        await stale.remove(viewDefinition, {resource: "grid-a", expected: saved});

        const maintainer = await context.open({owner: VIEW_OWNER});
        await maintainer.reclaim(viewDefinition, {targets: [{resource: "grid-a"}]});

        await expect(stale.read(viewDefinition, {resource: "grid-a"})).rejects.toMatchObject({
            code: "STORAGE_CREDENTIAL_STALE",
            scope: "handle",
            expectedGeneration: 1,
            currentGeneration: 2,
        });
        const fresh = await context.open({owner: VIEW_OWNER});
        await expect(fresh.read(viewDefinition, {resource: "grid-a"})).resolves.toMatchObject({
            kind: "missing",
            credential: {partitionGeneration: 2},
        });
    });

    it("代次提升后中断回收可由重试继续释放墓碑", async () => {
        const context = await createStorageContext("nbook-storage-reclaim-interrupt-");
        const handle = await context.open({owner: VIEW_OWNER});
        const saved = await handle.save(viewDefinition, {
            resource: "grid-a",
            expected: {revision: null, partitionGeneration: 1},
            value: {view: "grid-a"},
        });
        await handle.remove(viewDefinition, {resource: "grid-a", expected: saved});

        // 模拟“已持久化新代次、尚未删除墓碑”的中断现场。
        const partition = await partitionOf(context, {owner: VIEW_OWNER});
        await writeStorageRecordFile({
            target: partition.metaPath,
            content: `${JSON.stringify({schema: "nbook.storage-partition/v1", generation: 9})}\n`,
        });
        const retried = await context.open({owner: VIEW_OWNER});
        await expect(retried.reclaim(viewDefinition, {targets: [{resource: "grid-a"}]})).resolves.toMatchObject({
            partitionGeneration: 10,
            outcomes: [{address: {resource: "grid-a"}, outcome: "reclaimed"}],
        });
        await expect(access(recordPathOf(partition, "view~grid-a.json"))).rejects.toMatchObject({code: "ENOENT"});
    });
});

describe("订阅与生命周期", () => {
    it("订阅返回初始快照并持续报告最新状态，允许合并中间值", async () => {
        const context = await createStorageContext("nbook-storage-subscribe-");
        const handle = await context.open();
        const updates = new SubscriptionUpdates<LayoutState>();
        const subscription = await handle.subscribe(layoutDefinition, {onUpdate: updates.listener});
        expect(subscription.snapshot.kind).toBe("missing");

        const missing = subscription.snapshot;
        if (missing.kind !== "missing") {
            throw new Error(`需要 missing 读取结果，实际 ${missing.kind}`);
        }
        const first = await handle.save(layoutDefinition, {
            expected: missing.credential,
            value: {width: 1, height: 1},
        });
        const second = await handle.save(layoutDefinition, {
            expected: valueCredential(first),
            value: {width: 2, height: 2},
        });
        await updates.waitFor(() => updates.snapshots.some(
            (snapshot) => snapshot.kind === "value" && snapshot.credential.revision === second.revision,
        ));

        expect(updates.snapshots.every((snapshot) => snapshot.kind === "value")).toBe(true);
        expect(updates.snapshots.at(-1)).toMatchObject({
            kind: "value",
            value: {width: 2, height: 2},
            credential: {revision: second.revision},
        });
        await subscription.close();
    });

    it("refresh 观察进程外写入，监听器异常不影响已提交结果", async () => {
        const context = await createStorageContext("nbook-storage-refresh-");
        const handle = await context.open();
        const partition = await partitionOf(context);
        const reported: unknown[] = [];
        const subscription = await handle.subscribe(layoutDefinition, {
            onUpdate: () => {
                throw new Error("订阅者处理失败");
            },
            onError: (error) => reported.push(error),
        });

        await writeStorageRecordFile({
            target: recordPathOf(partition, "layout.json"),
            content: serializeStorageRecord({
                kind: "value",
                revision: "0f8fad5b-d9cb-469f-a165-70867728954e",
                schemaVersion: 1,
                value: {width: 900, height: 600},
            }),
        });
        await expect(subscription.refresh()).resolves.toMatchObject({
            kind: "value",
            value: {width: 900, height: 600},
        });
        expect(reported).toHaveLength(1);
        expect(reported[0]).toBeInstanceOf(Error);

        const current = await handle.read(layoutDefinition);
        if (current.kind !== "value") {
            throw new Error(`需要 value 读取结果，实际 ${current.kind}`);
        }
        await expect(handle.save(layoutDefinition, {
            expected: current.credential,
            value: {width: 901, height: 601},
        })).resolves.toMatchObject({revision: expect.any(String)});
        await subscription.close();
    });

    it("释放句柄时拒绝新操作并等待已接纳请求收口", async () => {
        const gate = Promise.withResolvers<void>();
        const lockAdapter: StorageLockAdapter = {
            acquire: async (file, options) => {
                const release = await acquireFileLock(file, options);
                return async () => {
                    // 闸门替代真实耗时：让保存停在已接纳状态，验证释放必须等它收口。
                    await gate.promise;
                    await release();
                };
            },
        };
        const context = await createStorageContext("nbook-storage-drain-", {lockAdapter});
        const handle = await context.open();
        const missing = await handle.read(layoutDefinition);

        const saving = handle.save(layoutDefinition, {expected: missingCredential(missing), value: {width: 5, height: 6}});
        let released = false;
        const releasing = handle.release().then(() => {
            released = true;
        });
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(released).toBe(false);

        gate.resolve();
        await releasing;
        await expect(saving).resolves.toMatchObject({revision: expect.any(String)});
        await expect(handle.read(layoutDefinition)).rejects.toMatchObject({code: "STORAGE_HANDLE_CLOSED"});

        const reopened = await context.open();
        await expect(reopened.read(layoutDefinition)).resolves.toMatchObject({
            kind: "value",
            value: {width: 5, height: 6},
        });
    });

    it("释放句柄后拒绝新操作并停止订阅，服务关闭拒绝新句柄", async () => {
        const context = await createStorageContext("nbook-storage-release-");
        const handle = await context.open();
        const updates = new SubscriptionUpdates<LayoutState>();
        await handle.subscribe(layoutDefinition, {onUpdate: updates.listener});
        await handle.release();

        await expect(handle.read(layoutDefinition)).rejects.toMatchObject({code: "STORAGE_HANDLE_CLOSED", reason: "released"});
        await expect(handle.save(layoutDefinition, {
            expected: {revision: null, partitionGeneration: 1},
            value: {width: 1, height: 1},
        })).rejects.toMatchObject({code: "STORAGE_HANDLE_CLOSED"});
        await handle.release();
        expect(updates.snapshots).toEqual([]);

        const stillOpen = await context.open();
        await context.service.close();
        await expect(context.open()).rejects.toMatchObject({code: "STORAGE_SERVICE_CLOSED"});
        await expect(stillOpen.read(layoutDefinition)).rejects.toMatchObject({
            code: "STORAGE_HANDLE_CLOSED",
            reason: "service-closed",
        });
    });

    it("不能创建存储根时报告 I/O 失败而不是缺失", async () => {
        const scratch = await mkdtemp(testHostPath("nbook-storage-io-"));
        roots.push(scratch);
        const filePath = path.join(scratch, "not-a-directory");
        await writeFile(filePath, "occupied\n", "utf8");
        const service = new StorageService({registry: testRegistry()});

        await expect(service.openHandle({
            owner: ROOT_OWNER,
            context: {
                scope: "user",
                storageRoot: absoluteFsPath(path.join(filePath, "storage")),
                identityDomain: "3f0c9a1e-6d2b-4b0e-9f4a-2c1d8e7b5a90",
                subject: "user-a",
                clientId: "client-1",
            },
        })).rejects.toMatchObject({code: "STORAGE_IO_FAILURE", operation: "mkdir"});
    });
});

describe("分区锁失败语义", () => {
    it("锁竞争失败报告可重试的占用错误且不写入", async () => {
        const context = await createStorageContext("nbook-storage-lock-contended-", {
            lockAdapter: {
                acquire: async () => {
                    const error = new Error("ELOCKED: 分区锁被占用") as NodeJS.ErrnoException;
                    error.code = "ELOCKED";
                    throw error;
                },
            },
        });
        const handle = await context.open();
        const missing = await handle.read(layoutDefinition);

        await expect(handle.save(layoutDefinition, {expected: missingCredential(missing), value: {width: 1, height: 1}}))
            .rejects.toMatchObject({code: "STORAGE_LOCK_UNAVAILABLE", reason: "contended", committed: false});
        await expect(handle.read(layoutDefinition)).resolves.toMatchObject({kind: "missing"});
    });

    it("锁被判失效后停止写入", async () => {
        const context = await createStorageContext("nbook-storage-lock-compromised-", {
            lockAdapter: {
                acquire: async (file, options) => {
                    options.onCompromised(new Error("分区锁已被其他进程接管"));
                    return acquireFileLock(file, options);
                },
            },
        });
        const handle = await context.open();
        const missing = await handle.read(layoutDefinition);

        await expect(handle.save(layoutDefinition, {expected: missingCredential(missing), value: {width: 1, height: 1}}))
            .rejects.toMatchObject({code: "STORAGE_LOCK_UNAVAILABLE", reason: "compromised", committed: false});
        await expect(handle.read(layoutDefinition)).resolves.toMatchObject({kind: "missing"});
    });

    it("崩溃残留的过期分区锁按 stale 协议接管后继续写入", async () => {
        const context = await createStorageContext("nbook-storage-lock-stale-");
        const handle = await context.open();
        const partition = await partitionOf(context);
        await mkdir(partition.lockPath, {recursive: true});
        const staleAt = new Date(Date.now() - STORAGE_LOCK_STALE_MS - 5_000);
        await utimes(partition.lockPath, staleAt, staleAt);

        const missing = await handle.read(layoutDefinition);
        await expect(handle.save(layoutDefinition, {expected: missingCredential(missing), value: {width: 2, height: 3}}))
            .resolves.toMatchObject({revision: expect.any(String)});
        await expect(access(partition.lockPath)).rejects.toMatchObject({code: "ENOENT"});
    });

    it("释放未确认时如实报告已提交状态，不撤销已保存的值", async () => {
        let failRelease = false;
        const context = await createStorageContext("nbook-storage-lock-release-", {
            lockAdapter: {
                acquire: async (file, options) => {
                    const release = await acquireFileLock(file, options);
                    return async () => {
                        if (failRelease) {
                            await release();
                            throw new Error("release 失败");
                        }
                        await release();
                    };
                },
            },
        });
        const handle = await context.open();
        const missing = await handle.read(layoutDefinition);
        const saved = await handle.save(layoutDefinition, {expected: missingCredential(missing), value: {width: 4, height: 4}});

        failRelease = true;
        await expect(handle.save(layoutDefinition, {
            expected: valueCredential(saved),
            value: {width: 5, height: 5},
        })).rejects.toMatchObject({code: "STORAGE_LOCK_UNAVAILABLE", reason: "release", committed: true});

        failRelease = false;
        await expect(handle.read(layoutDefinition)).resolves.toMatchObject({
            kind: "value",
            value: {width: 5, height: 5},
        });
    });
});

describe("路径边界与原子替换", () => {
    it("资源标识必须是不含分隔符的安全逻辑标识", async () => {
        const context = await createStorageContext("nbook-storage-address-");
        const viewHandle = await context.open({owner: VIEW_OWNER});
        const handle = await context.open();
        for (const resource of ["../escape", "a/b", "..", "con", ""]) {
            await expect(viewHandle.read(viewDefinition, {resource})).rejects.toMatchObject({
                code: "STORAGE_ADDRESS_INVALID",
            });
        }
        await expect(viewHandle.read(viewDefinition)).rejects.toMatchObject({
            code: "STORAGE_ADDRESS_INVALID",
            reason: "resource-required",
        });
        await expect(handle.read(layoutDefinition, {resource: "grid"})).rejects.toMatchObject({
            code: "STORAGE_ADDRESS_INVALID",
            reason: "resource",
        });
    });

    it("分区目录被目录联接指到根外时拒绝读写", async () => {
        const context = await createStorageContext("nbook-storage-escape-");
        const handle = await context.open();
        const missing = await handle.read(layoutDefinition);
        const partition = await partitionOf(context);
        const outside = await mkdtemp(testHostPath("nbook-storage-outside-"));
        roots.push(outside);
        await rm(partition.directory, {recursive: true, force: true});
        await mkdir(path.dirname(partition.directory), {recursive: true});
        await symlink(outside, partition.directory, "junction");

        await expect(handle.read(layoutDefinition)).rejects.toMatchObject({code: "STORAGE_PATH_ESCAPE"});
        await expect(handle.save(layoutDefinition, {
            expected: missingCredential(missing),
            value: {width: 1, height: 1},
        })).rejects.toMatchObject({code: "STORAGE_PATH_ESCAPE"});
        expect(await readdir(outside)).toEqual([]);
    });

    it("记录路径不是普通文件时报告读取失败，不伪造修复凭据", async () => {
        const context = await createStorageContext("nbook-storage-unreadable-");
        const handle = await context.open();
        const partition = await partitionOf(context);
        await mkdir(recordPathOf(partition, "layout.json"), {recursive: true});

        await expect(handle.read(layoutDefinition)).rejects.toMatchObject({code: "STORAGE_IO_FAILURE", operation: "read"});
        await expect(handle.save(layoutDefinition, {
            expected: {revision: null, partitionGeneration: 1},
            value: {width: 1, height: 1},
        })).rejects.toMatchObject({code: "STORAGE_IO_FAILURE", operation: "read"});
    });

    it("替换占用错误有界重试后成功", async () => {
        let failuresRemaining = 0;
        let attempts = 0;
        const adapter: StorageReplaceAdapter = {
            replace: async (source, target) => {
                attempts += 1;
                if (failuresRemaining > 0) {
                    failuresRemaining -= 1;
                    const error = new Error("EPERM: 替换目标被占用") as NodeJS.ErrnoException;
                    error.code = "EPERM";
                    throw error;
                }
                await rename(source, target);
            },
        };
        const context = await createStorageContext("nbook-storage-replace-retry-", {fileOptions: {replace: adapter}});
        const handle = await context.open();
        const missing = await handle.read(layoutDefinition);
        const saved = await handle.save(layoutDefinition, {expected: missingCredential(missing), value: {width: 1, height: 1}});

        attempts = 0;
        failuresRemaining = 2;
        await expect(handle.save(layoutDefinition, {
            expected: valueCredential(saved),
            value: {width: 12, height: 34},
        })).resolves.toMatchObject({revision: expect.any(String)});
        expect(attempts).toBe(3);
        await expect(handle.read(layoutDefinition)).resolves.toMatchObject({
            kind: "value",
            value: {width: 12, height: 34},
        });
    });

    it("替换持续失败时保留有效原件并清理临时文件", async () => {
        let failing = false;
        const adapter: StorageReplaceAdapter = {
            replace: async (source, target) => {
                if (failing) {
                    const error = new Error("EPERM: 替换目标被占用") as NodeJS.ErrnoException;
                    error.code = "EPERM";
                    throw error;
                }
                await rename(source, target);
            },
        };
        const context = await createStorageContext("nbook-storage-replace-failure-", {fileOptions: {replace: adapter}});
        const handle = await context.open();
        const missing = await handle.read(layoutDefinition);
        const saved = await handle.save(layoutDefinition, {expected: missingCredential(missing), value: {width: 7, height: 8}});
        const partition = await partitionOf(context);
        const before = (await readdir(partition.recordsDirectory)).sort();

        failing = true;
        await expect(handle.save(layoutDefinition, {
            expected: valueCredential(saved),
            value: {width: 9, height: 10},
        })).rejects.toMatchObject({code: "STORAGE_IO_FAILURE", operation: "replace"});
        failing = false;

        await expect(handle.read(layoutDefinition)).resolves.toMatchObject({
            kind: "value",
            value: {width: 7, height: 8},
            credential: {revision: saved.revision},
        });
        expect((await readdir(partition.recordsDirectory)).sort()).toEqual(before);
    });

    it("并发写入期间读取只会看到完整旧记录或完整新记录", async () => {
        const context = await createStorageContext("nbook-storage-torn-");
        const handle = await context.open();
        const missing = await handle.read(layoutDefinition);
        const observed: string[] = [];
        let reading = true;

        const reader = (async () => {
            while (reading) {
                const result = await handle.read(layoutDefinition);
                observed.push(result.kind === "value"
                    ? `${String(result.value.width)}x${String(result.value.height)}`
                    : result.kind);
            }
        })();
        // 读取循环的失败在测试内收口，不在清理阶段变成无人处理的 rejection。
        const readerOutcome = reader.then(() => null, (error: unknown) => error);

        let credential = missingCredential(missing);
        for (let index = 0; index < 20; index += 1) {
            credential = await handle.save(layoutDefinition, {
                expected: credential,
                value: {width: index, height: index * 2},
            });
        }
        reading = false;
        expect(await readerOutcome).toBeNull();

        expect(observed).toContain("missing");
        expect(observed.every((entry) => entry === "missing" || /^\d+x\d+$/u.test(entry))).toBe(true);
        await expect(handle.read(layoutDefinition)).resolves.toMatchObject({
            kind: "value",
            value: {width: 19, height: 38},
        });
    });
});
