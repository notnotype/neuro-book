import {mkdir, readFile, readdir, rm, writeFile} from "node:fs/promises";
import {lock as acquireFileLock} from "proper-lockfile";
import {afterEach, describe, expect, it} from "vitest";
import {STORAGE_ACTION_BODY_LIMIT_BYTES} from "nbook/shared/storage/action";
import type {StoragePartitionBinding} from "nbook/shared/storage/contract";
import {defineStorageState, type DefinedStorageState} from "nbook/shared/storage/definition";
import type {StorageLockAdapter} from "nbook/server/storage/partition-lock";
import {
    createStorageActionHost,
    STORAGE_TEST_CLIENT_A,
    STORAGE_TEST_CLIENT_B,
    STORAGE_TEST_SUBJECT,
    type StorageActionHostFixture,
} from "nbook/server/storage/fixtures/storage-action-host";

type LayoutState = {readonly width: number; readonly height: number};
type LayoutStateV2 = LayoutState & {readonly theme: string};
type NoteState = {readonly text: string};

const LAYOUT_OWNER = "test.layout";
const NOTE_OWNER = "test.note";

const layoutV1: DefinedStorageState<LayoutState> = defineStorageState<LayoutState>({
    owner: LAYOUT_OWNER,
    key: "layout",
    scope: "user",
    locality: "local",
    records: "single",
    schemaVersion: 1,
    defaultValue: {width: 320, height: 240},
    validate: isLayoutState,
});

const layoutV2: DefinedStorageState<LayoutStateV2> = defineStorageState<LayoutStateV2>({
    owner: LAYOUT_OWNER,
    key: "layout",
    scope: "user",
    locality: "local",
    records: "single",
    schemaVersion: 2,
    defaultValue: {width: 320, height: 240, theme: "default"},
    validate: isLayoutStateV2,
    migrate: (value) => isLayoutState(value)
        ? {width: value.width, height: value.height, theme: "migrated"}
        : {width: 320, height: 240, theme: "migrated"},
});

const note: DefinedStorageState<NoteState> = defineStorageState<NoteState>({
    owner: NOTE_OWNER,
    key: "note",
    scope: "user",
    locality: "local",
    records: "identified",
    schemaVersion: 1,
    defaultValue: {text: ""},
    validate: isNoteState,
    limits: {maxRecords: 3, maxPartitionBytes: 4096},
});

/** 与 note 同 owner 的 shared 键：两者落在不同分区，可以各自持锁。 */
const sharedNote: DefinedStorageState<NoteState> = defineStorageState<NoteState>({
    owner: NOTE_OWNER,
    key: "shared-note",
    scope: "user",
    locality: "shared",
    records: "identified",
    schemaVersion: 1,
    defaultValue: {text: ""},
    validate: isNoteState,
});

const definitions: readonly DefinedStorageState<unknown>[] = [layoutV1, note, sharedNote];

function isLayoutState(value: unknown): value is LayoutState {
    return typeof value === "object" && value !== null
        && typeof (value as LayoutState).width === "number"
        && typeof (value as LayoutState).height === "number";
}

function isLayoutStateV2(value: unknown): value is LayoutStateV2 {
    return isLayoutState(value) && typeof (value as LayoutStateV2).theme === "string";
}

function isNoteState(value: unknown): value is NoteState {
    return typeof value === "object" && value !== null && typeof (value as NoteState).text === "string";
}

type StorageErrorBody = {readonly data?: {readonly code?: string; readonly reason?: string; readonly committed?: boolean; readonly message?: string}};
type Credential = {readonly revision: string | null; readonly partitionGeneration: number};
/** 修复凭据绑定原始内容，与条件凭据分开。 */
type RepairCredential = {readonly partitionGeneration: number; readonly contentFingerprint: string};
type ReadBody = {readonly result?: {
    readonly kind?: string;
    readonly value?: unknown;
    readonly schemaVersion?: number;
    readonly wrapperVersion?: number | null;
    readonly diagnosis?: string;
    readonly credential?: Credential;
    readonly repair?: RepairCredential;
}};
type WriteBody = {readonly credential?: Credential};

const hosts: StorageActionHostFixture[] = [];

afterEach(async () => {
    await Promise.all(hosts.splice(0).map(async (host) => host.close()));
});

async function createHost(options?: Parameters<typeof createStorageActionHost>[0]): Promise<StorageActionHostFixture> {
    const host = await createStorageActionHost(options);
    hosts.push(host);
    return host;
}

/** 断言 HTTP 失败合同的稳定 code 与状态码；同时证明响应里没有内部路径或凭证。 */
async function expectFailure(response: Response, status: number, code: string): Promise<StorageErrorBody> {
    expect(response.status, `期望 ${String(status)}，实际 ${String(response.status)}`).toBe(status);
    const text = await response.text();
    const body = JSON.parse(text) as StorageErrorBody;
    expect(body.data?.code).toBe(code);
    expect(text).not.toContain(".nbook");
    return body;
}

/**
 * 一次已取得分区代次绑定的访问：值动作必须原样携带 `bind` 返回的绑定与本次消费的定义版本。
 *
 * 测试用它模拟前端句柄：句柄持有绑定，同时明确自己消费哪一版定义。
 * 绑定或版本语义本身的用例直接调用 `host.act` 传具体值。
 */
type Access = {
    readonly contextId: string;
    readonly binding: StoragePartitionBinding;
    readonly schemaVersion: number;
    readonly credential?: string;
    readonly subject?: string;
};

async function bindAccess(
    host: StorageActionHostFixture,
    contextId: string,
    definition: DefinedStorageState<unknown>,
    options: {readonly credential?: string; readonly subject?: string} = {},
): Promise<Access> {
    return {
        ...options,
        schemaVersion: definition.schemaVersion,
        contextId,
        binding: await host.bind(contextId, definition.owner, options),
    };
}

async function act(host: StorageActionHostFixture, access: Access, action: Record<string, unknown>): Promise<Response> {
    return await host.act(
        access.contextId,
        {...action, schemaVersion: access.schemaVersion, binding: access.binding},
        {credential: access.credential, subject: access.subject},
    );
}

async function readState(host: StorageActionHostFixture, access: Access, options: {readonly resource?: string} = {}): Promise<ReadBody> {
    const response = await act(host, access, {
        kind: "read",
        owner: LAYOUT_OWNER,
        key: "layout",
        ...options,
    });
    expect(response.status).toBe(200);
    return await response.json() as ReadBody;
}

/**
 * 在真实分区锁之前插入一次闸门：让一个请求停住并继续持有它的句柄，其余请求正常进行。
 *
 * 闸门要显式启用：调用方先完成准备动作，再让下一个取得分区锁的请求挂起。
 */
function lockGate(): {
    readonly arm: () => void;
    readonly entered: Promise<void>;
    readonly open: () => void;
    readonly adapter: StorageLockAdapter;
} {
    const entered = Promise.withResolvers<void>();
    const gate = Promise.withResolvers<void>();
    let armed = false;
    return {
        arm: () => { armed = true; },
        entered: entered.promise,
        open: () => { gate.resolve(); },
        adapter: {
            acquire: async (file, options) => {
                if (armed) {
                    armed = false;
                    entered.resolve();
                    await gate.promise;
                }
                return await acquireFileLock(file, options);
            },
        },
    };
}

describe("user 值动作 HTTP 合同", () => {
    it("未注册状态被拒绝且不创建任何记录", async () => {
        const host = await createHost({definitions});
        const contextId = await host.issue();
        const access = await bindAccess(host, contextId, layoutV1);

        const response = await host.act(contextId, {kind: "read", owner: "test.other", key: "layout", schemaVersion: layoutV1.schemaVersion, binding: access.binding});
        await expectFailure(response, 500, "STORAGE_STATE_UNREGISTERED");

        // 未注册动作不能通过地址推导出分区；隔离根里只有身份域与锁目录。
        expect((await readdir(host.root)).sort()).toEqual([".locks", "identity.json"]);
    });

    it("请求体与动作形状不合法时在触碰记录前拒绝", async () => {
        const host = await createHost({definitions});
        const contextId = await host.issue();
        const access = await bindAccess(host, contextId, layoutV1);

        const unknownAction = await host.act(contextId, {kind: "purge", owner: LAYOUT_OWNER, key: "layout", schemaVersion: layoutV1.schemaVersion, binding: access.binding});
        await expectFailure(unknownAction, 400, "STORAGE_REQUEST_INVALID");

        // 值动作缺少分区代次绑定即被拒绝：不能退回“每次请求采用当前代次”。
        const unbound = await host.act(contextId, {kind: "read", owner: LAYOUT_OWNER, key: "layout", schemaVersion: layoutV1.schemaVersion});
        await expectFailure(unbound, 400, "STORAGE_REQUEST_INVALID");

        // 客户端不能借额外字段提交 scope、locality、主体或磁盘路径。
        const forged = await act(host, access, {
            kind: "save",
            owner: LAYOUT_OWNER,
            key: "layout",
            expected: {revision: null, partitionGeneration: 1},
            value: {width: 1, height: 1},
            scope: "project",
            locality: "shared",
            subject: "user:999",
            storageRoot: "C:\\elsewhere",
        });
        const forgedBody = await expectFailure(forged, 400, "STORAGE_REQUEST_INVALID");
        expect(forgedBody.data?.reason).toBe("action");

        const malformedJson = await host.request("/api/storage/user/action", {contextId, body: "{"});
        await expectFailure(malformedJson, 400, "STORAGE_REQUEST_INVALID");

        const oversized = await act(host, access, {
            kind: "save",
            owner: LAYOUT_OWNER,
            key: "layout",
            expected: {revision: null, partitionGeneration: 1},
            value: {width: 1, height: 1, padding: "x".repeat(STORAGE_ACTION_BODY_LIMIT_BYTES)},
        });
        expect(oversized.status).toBe(413);
        await expect(oversized.json()).resolves.toMatchObject({data: {code: "REQUEST_BODY_TOO_LARGE"}});

        const noCredential = await host.request("/api/storage/user/action", {
            contextId,
            body: {kind: "read", owner: LAYOUT_OWNER, key: "layout", schemaVersion: layoutV1.schemaVersion, binding: access.binding},
            credential: "",
        });
        expect(noCredential.status).toBe(400);

        expect((await readdir(host.root)).sort()).toEqual([".locks", "identity.json"]);
    });

    it("不同主体与不同客户端各自隔离，同名键互不可见", async () => {
        const host = await createHost({definitions});
        const forSubjectA = await host.issue(STORAGE_TEST_CLIENT_A, STORAGE_TEST_SUBJECT);
        const forSubjectB = await host.issue(STORAGE_TEST_CLIENT_B, "user:8");
        const subjectBOptions = {credential: STORAGE_TEST_CLIENT_B, subject: "user:8"};
        const accessA = await bindAccess(host, forSubjectA, layoutV1);
        const accessB = await bindAccess(host, forSubjectB, layoutV1, subjectBOptions);

        const saved = await act(host, accessA, {
            kind: "save",
            owner: LAYOUT_OWNER,
            key: "layout",
            expected: {revision: null, partitionGeneration: 1},
            value: {width: 100, height: 200},
        });
        expect(saved.status).toBe(200);

        const otherSubject = await act(host, accessB, {kind: "read", owner: LAYOUT_OWNER, key: "layout"});
        await expect(otherSubject.json()).resolves.toMatchObject({result: {kind: "missing"}});

        const otherClient = await host.issue(STORAGE_TEST_CLIENT_B, STORAGE_TEST_SUBJECT);
        const accessC = await bindAccess(host, otherClient, layoutV1, {credential: STORAGE_TEST_CLIENT_B});
        const perClient = await act(host, accessC, {kind: "read", owner: LAYOUT_OWNER, key: "layout"});
        await expect(perClient.json()).resolves.toMatchObject({result: {kind: "missing"}});

        const own = await readState(host, accessA);
        expect(own.result).toMatchObject({kind: "value", value: {width: 100, height: 200}});

        const ownPath = await host.recordPath({owner: LAYOUT_OWNER, key: "layout"});
        const otherPath = await host.recordPath({owner: LAYOUT_OWNER, key: "layout", clientCredential: STORAGE_TEST_CLIENT_B, subject: "user:8"});
        expect(ownPath).not.toBe(otherPath);
        expect(await readFile(ownPath, "utf8")).toContain("100");
    });

    it("缺失读取不创建记录，保存后重读并在新运行期恢复", async () => {
        const host = await createHost({definitions});
        const contextId = await host.issue();
        const access = await bindAccess(host, contextId, layoutV1);
        const recordPath = await host.recordPath({owner: LAYOUT_OWNER, key: "layout"});

        const missing = await readState(host, access);
        expect(missing.result).toMatchObject({kind: "missing"});
        // 默认显示不落盘：读取缺失状态不能创建值记录。
        await expect(readFile(recordPath, "utf8")).rejects.toMatchObject({code: "ENOENT"});

        const saved = await act(host, access, {
            kind: "save",
            owner: LAYOUT_OWNER,
            key: "layout",
            expected: {revision: null, partitionGeneration: 1},
            value: {width: 640, height: 480},
        });
        expect(saved.status).toBe(200);
        expect((await saved.json() as WriteBody).credential?.revision).toMatch(/^[0-9a-f-]{36}$/u);
        expect(JSON.parse(await readFile(recordPath, "utf8"))).toMatchObject({state: "value", value: {width: 640, height: 480}});
        expect((await readState(host, access)).result).toMatchObject({kind: "value", value: {width: 640, height: 480}});

        // 新运行期：旧标识失效，同一客户端凭证仍定位到原 local 分区并读到已确认值。
        await host.configure();
        await expectFailure(await act(host, access, {kind: "read", owner: LAYOUT_OWNER, key: "layout"}), 403, "STORAGE_CONTEXT_INVALID");
        const resumed = await host.issue();
        expect((await readState(host, await bindAccess(host, resumed, layoutV1))).result)
            .toMatchObject({kind: "value", value: {width: 640, height: 480}});
    });

    it("同一旧 revision 的并发保存只有一个成功", async () => {
        const host = await createHost({definitions});
        const contextId = await host.issue();
        const access = await bindAccess(host, contextId, layoutV1);
        await act(host, access, {
            kind: "save",
            owner: LAYOUT_OWNER,
            key: "layout",
            expected: {revision: null, partitionGeneration: 1},
            value: {width: 1, height: 1},
        });
        const current = (await readState(host, access)).result?.credential;
        expect(current).toBeDefined();

        const [first, second] = await Promise.all([
            act(host, access, {kind: "save", owner: LAYOUT_OWNER, key: "layout", expected: current, value: {width: 2, height: 2}}),
            act(host, access, {kind: "save", owner: LAYOUT_OWNER, key: "layout", expected: current, value: {width: 3, height: 3}}),
        ]);
        const statuses = [first.status, second.status].sort((left, right) => left - right);
        expect(statuses).toEqual([200, 409]);
        const conflict = first.status === 409 ? first : second;
        await expect(conflict.json()).resolves.toMatchObject({data: {code: "STORAGE_REVISION_CONFLICT"}});

        const winner = first.status === 200 ? first : second;
        expect((await winner.json() as WriteBody).credential?.revision).not.toBe(current?.revision);
        const after = (await readState(host, access)).result;
        expect([{width: 2, height: 2}, {width: 3, height: 3}]).toContainEqual(after?.value);
    });

    it("删除形成墓碑，删除前的凭据不能复活记录", async () => {
        const host = await createHost({definitions});
        const contextId = await host.issue();
        const access = await bindAccess(host, contextId, layoutV1);
        await act(host, access, {
            kind: "save",
            owner: LAYOUT_OWNER,
            key: "layout",
            expected: {revision: null, partitionGeneration: 1},
            value: {width: 10, height: 20},
        });
        const beforeDelete = (await readState(host, access)).result?.credential;
        expect(beforeDelete).toBeDefined();

        const removed = await act(host, access, {kind: "remove", owner: LAYOUT_OWNER, key: "layout", expected: beforeDelete});
        expect(removed.status).toBe(200);
        const tombstone = (await readState(host, access)).result;
        expect(tombstone?.kind).toBe("deleted");
        expect(tombstone?.credential?.revision).not.toBe(beforeDelete?.revision);

        const revived = await act(host, access, {
            kind: "save",
            owner: LAYOUT_OWNER,
            key: "layout",
            expected: beforeDelete,
            value: {width: 11, height: 21},
        });
        await expectFailure(revived, 409, "STORAGE_REVISION_CONFLICT");
        expect((await readState(host, access)).result?.kind).toBe("deleted");

        const recreated = await act(host, access, {
            kind: "save",
            owner: LAYOUT_OWNER,
            key: "layout",
            expected: tombstone?.credential,
            value: {width: 30, height: 40},
        });
        expect(recreated.status).toBe(200);
        expect((await readState(host, access)).result).toMatchObject({kind: "value", value: {width: 30, height: 40}});
    });

    it("损坏记录禁止普通保存，显式修复保留原件并让旧修复凭据失效", async () => {
        const host = await createHost({definitions});
        const contextId = await host.issue();
        const access = await bindAccess(host, contextId, layoutV1);
        const recordPath = await host.recordPath({owner: LAYOUT_OWNER, key: "layout"});
        await act(host, access, {
            kind: "save",
            owner: LAYOUT_OWNER,
            key: "layout",
            expected: {revision: null, partitionGeneration: 1},
            value: {width: 1, height: 2},
        });
        const brokenContent = "private-diagnostic-marker";
        await writeFile(recordPath, brokenContent, "utf8");

        const corrupted = (await readState(host, access)).result;
        expect(corrupted?.kind).toBe("corrupt");
        expect(corrupted?.repair).toBeDefined();
        expect(JSON.stringify(corrupted)).not.toContain(brokenContent);

        const plainSave = await act(host, access, {
            kind: "save",
            owner: LAYOUT_OWNER,
            key: "layout",
            expected: {revision: null, partitionGeneration: corrupted?.repair?.partitionGeneration ?? 1},
            value: {width: 5, height: 6},
        });
        await expectFailure(plainSave, 409, "STORAGE_WRITE_BLOCKED");
        expect(await readFile(recordPath, "utf8")).toBe(brokenContent);

        const repaired = await act(host, access, {
            kind: "repair",
            owner: LAYOUT_OWNER,
            key: "layout",
            expected: corrupted?.repair,
            value: {width: 7, height: 8},
        });
        expect(repaired.status).toBe(200);
        expect((await readState(host, access)).result).toMatchObject({kind: "value", value: {width: 7, height: 8}});

        const repeated = await act(host, access, {
            kind: "repair",
            owner: LAYOUT_OWNER,
            key: "layout",
            expected: corrupted?.repair,
            value: {width: 9, height: 9},
        });
        await expectFailure(repeated, 409, "STORAGE_REPAIR_CONFLICT");

        const partition = await host.partition({owner: LAYOUT_OWNER});
        const quarantined = await readdir(partition.quarantineDirectory);
        expect(quarantined).toHaveLength(1);
        expect(await readFile(`${partition.quarantineDirectory}/${quarantined[0]!}`, "utf8")).toBe(brokenContent);
    });

    it("旧 schemaVersion 只能显式迁移，普通保存被拒绝", async () => {
        const host = await createHost({definitions: [layoutV1]});
        const contextId = await host.issue();
        const access = await bindAccess(host, contextId, layoutV1);
        await act(host, access, {
            kind: "save",
            owner: LAYOUT_OWNER,
            key: "layout",
            expected: {revision: null, partitionGeneration: 1},
            value: {width: 12, height: 24},
        });

        await host.configure({definitions: [layoutV2]});
        const reloaded = await host.issue();
        const reloadedAccess = await bindAccess(host, reloaded, layoutV2);
        const legacy = (await readState(host, reloadedAccess)).result;
        expect(legacy).toMatchObject({kind: "legacy-value", schemaVersion: 1, value: {width: 12, height: 24}});

        const blocked = await act(host, reloadedAccess, {
            kind: "save",
            owner: LAYOUT_OWNER,
            key: "layout",
            expected: legacy?.credential,
            value: {width: 13, height: 25, theme: "manual"},
        });
        await expectFailure(blocked, 409, "STORAGE_WRITE_BLOCKED");

        const migrated = await act(host, reloadedAccess, {
            kind: "migrate",
            owner: LAYOUT_OWNER,
            key: "layout",
            expected: legacy?.credential,
        });
        expect(migrated.status).toBe(200);
        expect((await readState(host, reloadedAccess)).result).toMatchObject({
            kind: "value",
            schemaVersion: 2,
            value: {width: 12, height: 24, theme: "migrated"},
        });
    });

    it("回收选定的墓碑并让回收前的绑定与条件凭据一起失效", async () => {
        const host = await createHost({definitions});
        const contextId = await host.issue();
        const access = await bindAccess(host, contextId, note);
        const credentials: Credential[] = [];
        for (const resource of ["first", "second"]) {
            const saved = await act(host, access, {
                kind: "save",
                owner: NOTE_OWNER,
                key: "note",
                resource,
                expected: {revision: null, partitionGeneration: 1},
                value: {text: resource},
            });
            expect(saved.status).toBe(200);
            credentials.push((await saved.json() as WriteBody).credential!);
        }
        for (const [index, resource] of ["first", "second"].entries()) {
            const removed = await act(host, access, {
                kind: "remove",
                owner: NOTE_OWNER,
                key: "note",
                resource,
                expected: credentials[index],
            });
            expect(removed.status).toBe(200);
        }

        const reclaimed = await act(host, access, {
            kind: "reclaim",
            owner: NOTE_OWNER,
            key: "note",
            targets: [{resource: "first"}, {resource: "second"}],
        });
        expect(reclaimed.status).toBe(200);
        await expect(reclaimed.json()).resolves.toMatchObject({
            result: {
                partitionGeneration: 2,
                outcomes: [{outcome: "reclaimed"}, {outcome: "reclaimed"}],
            },
        });
        const partition = await host.partition({owner: NOTE_OWNER});
        expect(await readdir(partition.recordsDirectory)).toEqual([]);

        // 回收后旧绑定连同尚未读过的键一起失效：同一访问继续用旧绑定读不到新代次。
        await expectFailure(await act(host, access, {kind: "read", owner: NOTE_OWNER, key: "note", resource: "first"}), 409, "STORAGE_CREDENTIAL_STALE");

        const stale = await act(host, access, {
            kind: "save",
            owner: NOTE_OWNER,
            key: "note",
            resource: "first",
            expected: credentials[0],
            value: {text: "revived"},
        });
        await expectFailure(stale, 409, "STORAGE_CREDENTIAL_STALE");

        // 显式重新绑定是调用方的动作；重新绑定后可读到回收后的当前状态。
        const rebound = await bindAccess(host, contextId, note);
        await expect((await act(host, rebound, {kind: "read", owner: NOTE_OWNER, key: "note", resource: "first"})).json())
            .resolves.toMatchObject({result: {kind: "missing", credential: {partitionGeneration: 2}}});
        expect(await readdir(partition.recordsDirectory)).toEqual([]);
    });

    it("自行编造的绑定不能进入分区，也不接受缺少 local 的绑定", async () => {
        const host = await createHost({definitions});
        const contextId = await host.issue();
        const access = await bindAccess(host, contextId, layoutV1);
        await act(host, access, {
            kind: "save",
            owner: LAYOUT_OWNER,
            key: "layout",
            expected: {revision: null, partitionGeneration: 1},
            value: {width: 1, height: 1},
        });

        // 比当前更高的代次无法从任何真实回收得到：句柄按它打开即失败关闭，不会跳过检查读当前记录。
        const forgedHigh = await host.act(contextId, {
            kind: "read",
            owner: LAYOUT_OWNER,
            key: "layout",
            schemaVersion: layoutV1.schemaVersion,
            binding: {local: access.binding.local! + 1, shared: access.binding.shared},
        });
        await expectFailure(forgedHigh, 409, "STORAGE_CREDENTIAL_STALE");

        // 有客户端上下文的访问必须带 local 代次；少传一项就是要求句柄重新采用当前代次。
        const forgedMissing = await host.act(contextId, {
            kind: "read",
            owner: LAYOUT_OWNER,
            key: "layout",
            schemaVersion: layoutV1.schemaVersion,
            binding: {local: null, shared: access.binding.shared},
        });
        await expectFailure(forgedMissing, 403, "STORAGE_CONTEXT_INVALID");

        expect((await readState(host, access)).result).toMatchObject({kind: "value", value: {width: 1, height: 1}});
    });

    it("读取 I/O 失败与缺失区分，响应不包含内部路径", async () => {
        const host = await createHost({definitions});
        const contextId = await host.issue();
        const access = await bindAccess(host, contextId, layoutV1);
        const recordPath = await host.recordPath({owner: LAYOUT_OWNER, key: "layout"});
        await mkdir(recordPath, {recursive: true});

        const failed = await act(host, access, {kind: "read", owner: LAYOUT_OWNER, key: "layout"});
        const body = await expectFailure(failed, 500, "STORAGE_IO_FAILURE");
        expect(body.data?.code).toBe("STORAGE_IO_FAILURE");
        const text = JSON.stringify(body);
        expect(text).not.toContain(host.root);
        expect(text).not.toContain(STORAGE_TEST_CLIENT_A);
        await rm(recordPath, {recursive: true, force: true});
        expect((await readState(host, access)).result?.kind).toBe("missing");
    });

    it("定义版本不一致时拒绝全部非 bind 动作，且不改动记录", async () => {
        const host = await createHost({definitions: [layoutV2]});
        const contextId = await host.issue();
        const access = await bindAccess(host, contextId, layoutV2);
        await act(host, access, {
            kind: "save",
            owner: LAYOUT_OWNER,
            key: "layout",
            expected: {revision: null, partitionGeneration: 1},
            value: {width: 1, height: 2, theme: "server"},
        });
        const recordPath = await host.recordPath({owner: LAYOUT_OWNER, key: "layout"});
        const original = await readFile(recordPath, "utf8");
        const current = (await readState(host, access)).result?.credential;

        // 旧客户端只消费 v1，服务端注册的是 v2：任何非 bind 动作都不能按 v1 解释或覆盖 v2 的值。
        const actions: readonly Record<string, unknown>[] = [
            {kind: "read", owner: LAYOUT_OWNER, key: "layout"},
            {kind: "save", owner: LAYOUT_OWNER, key: "layout", expected: current, value: {width: 9, height: 9}},
            {kind: "remove", owner: LAYOUT_OWNER, key: "layout", expected: current},
            {kind: "migrate", owner: LAYOUT_OWNER, key: "layout", expected: current},
            {kind: "repair", owner: LAYOUT_OWNER, key: "layout", expected: {partitionGeneration: 1, contentFingerprint: "sha256:00"}, value: {width: 9, height: 9, theme: "repaired"}},
            {kind: "reclaim", owner: LAYOUT_OWNER, key: "layout", targets: [{}]},
        ];
        const messages = new Set<string>();
        for (const action of actions) {
            const response = await host.act(contextId, {
                ...action,
                schemaVersion: layoutV1.schemaVersion,
                binding: access.binding,
            });
            const body = await expectFailure(response, 409, "STORAGE_SCHEMA_MISMATCH");
            messages.add(body.data?.message ?? "");
        }
        // 固定公开文案：所有动作给出同一条可展示文本，不泄漏服务端诊断。
        expect(messages.size).toBe(1);
        // 拒绝发生在取得句柄之前：这次旧版本请求没有改动记录，也没有触发回收。
        expect(await readFile(recordPath, "utf8")).toBe(original);
        expect((await readState(host, access)).result).toMatchObject({
            kind: "value",
            value: {width: 1, height: 2, theme: "server"},
            credential: {partitionGeneration: 1},
        });
    });

    it("更高 schemaVersion 的记录给出公开诊断，禁止普通保存且保留原件", async () => {
        const host = await createHost({definitions: [layoutV2]});
        const contextId = await host.issue();
        const access = await bindAccess(host, contextId, layoutV2);
        const recordPath = await host.recordPath({owner: LAYOUT_OWNER, key: "layout"});
        await mkdir((await host.partition({owner: LAYOUT_OWNER})).recordsDirectory, {recursive: true});
        const revision = "00000000-0000-4000-8000-000000000000";
        const original = `${JSON.stringify({
            wrapper: 1,
            revision,
            state: "value",
            schemaVersion: 3,
            value: {width: 1, height: 2, theme: "from-newer-client"},
        })}\n`;
        await writeFile(recordPath, original, "utf8");

        const read = await act(host, access, {kind: "read", owner: LAYOUT_OWNER, key: "layout"});
        expect(read.status).toBe(200);
        const body = await read.json() as ReadBody;
        expect(body.result).toMatchObject({kind: "unsupported-version", schemaVersion: 3, wrapperVersion: null});
        expect(body.result?.diagnosis).toBeDefined();
        // 公开诊断不暴露原始内容；原件保持原样，等待显式修复。
        expect(JSON.stringify(body)).not.toContain("from-newer-client");

        const blocked = await act(host, access, {
            kind: "save",
            owner: LAYOUT_OWNER,
            key: "layout",
            expected: {revision, partitionGeneration: 1},
            value: {width: 9, height: 9, theme: "overwrite"},
        });
        await expectFailure(blocked, 409, "STORAGE_WRITE_BLOCKED");
        expect(await readFile(recordPath, "utf8")).toBe(original);
    });

    it("bind 不复用池内旧句柄：同上下文仍持旧代次句柄时返回分区当前代次", async () => {
        const gate = lockGate();
        const host = await createHost({definitions, lockAdapter: gate.adapter});
        const contextId = await host.issue();
        const access = await bindAccess(host, contextId, note);
        await act(host, access, {
            kind: "save",
            owner: NOTE_OWNER,
            key: "note",
            resource: "first",
            expected: {revision: null, partitionGeneration: 1},
            value: {text: "kept"},
        });

        // 一个 shared 分区的保存停在它自己的分区锁上：它已经打开并继续持有该访问/owner 的句柄，
        // 而那个句柄捕获的是回收前的代次。
        gate.arm();
        const held = act(host, access, {
            kind: "save",
            owner: NOTE_OWNER,
            key: "shared-note",
            resource: "first",
            expected: {revision: null, partitionGeneration: 1},
            value: {text: "held"},
        });
        await gate.entered;

        // 另一个上下文回收 local 分区的墓碑：该分区代次变成 2。
        const other = await bindAccess(host, await host.issue(), note);
        const credential = ((await (await act(host, other, {
            kind: "read",
            owner: NOTE_OWNER,
            key: "note",
            resource: "first",
        })).json()) as ReadBody).result?.credential;
        await act(host, other, {kind: "remove", owner: NOTE_OWNER, key: "note", resource: "first", expected: credential});
        expect((await act(host, other, {kind: "reclaim", owner: NOTE_OWNER, key: "note", targets: [{resource: "first"}]})).status).toBe(200);

        // `bind` 不借那个还持旧代次的句柄：它返回回收后的当前代次。
        const reboundBinding = await host.bind(contextId, NOTE_OWNER);
        expect(reboundBinding).toEqual({local: 2, shared: 1});
        gate.open();
        expect((await held).status).toBe(200);

        await expectFailure(await act(host, access, {kind: "read", owner: NOTE_OWNER, key: "note", resource: "first"}), 409, "STORAGE_CREDENTIAL_STALE");
        // 显式重新绑定是调用方的动作；重新绑定后读到回收后的当前状态。
        await expect((await act(host, {...access, binding: reboundBinding}, {kind: "read", owner: NOTE_OWNER, key: "note", resource: "first"})).json())
            .resolves.toMatchObject({result: {kind: "missing", credential: {partitionGeneration: 2}}});
    });

    it("同上下文不同绑定并发：旧绑定请求不借在途的新代次句柄", async () => {
        const opened = Promise.withResolvers<void>();
        const gate = Promise.withResolvers<void>();
        let armed = false;
        const host = await createHost({
            definitions,
            openHandle: async (input, service) => {
                if (armed && input.binding !== undefined) {
                    armed = false;
                    opened.resolve();
                    await gate.promise;
                }
                return await service.openHandle(input);
            },
        });
        const contextId = await host.issue();
        const access = await bindAccess(host, contextId, note);
        await act(host, access, {
            kind: "save",
            owner: NOTE_OWNER,
            key: "note",
            resource: "first",
            expected: {revision: null, partitionGeneration: 1},
            value: {text: "kept"},
        });
        const other = await bindAccess(host, await host.issue(), note);
        const credential = ((await (await act(host, other, {
            kind: "read",
            owner: NOTE_OWNER,
            key: "note",
            resource: "first",
        })).json()) as ReadBody).result?.credential;
        await act(host, other, {kind: "remove", owner: NOTE_OWNER, key: "note", resource: "first", expected: credential});
        expect((await act(host, other, {kind: "reclaim", owner: NOTE_OWNER, key: "note", targets: [{resource: "first"}]})).status).toBe(200);

        // 同一访问重新绑定到当前代次：这次读取按新代次打开句柄，被闸在打开边界。
        const currentBinding = await host.bind(contextId, NOTE_OWNER);
        expect(currentBinding).toEqual({local: 2, shared: 1});
        armed = true;
        const current = act(host, {...access, binding: currentBinding}, {kind: "read", owner: NOTE_OWNER, key: "note", resource: "first"});
        await opened.promise;
        // 旧绑定的并发请求只能自己按旧代次打开，不能借那个正在打开的新代次句柄。
        const stale = act(host, access, {kind: "read", owner: NOTE_OWNER, key: "note", resource: "first"});
        gate.resolve();

        await expect((await current).json()).resolves.toMatchObject({result: {kind: "missing", credential: {partitionGeneration: 2}}});
        await expectFailure(await stale, 409, "STORAGE_CREDENTIAL_STALE");
    });
});
