import {mkdir, readFile, readdir, rm, writeFile} from "node:fs/promises";
import {afterEach, describe, expect, it} from "vitest";
import {STORAGE_ACTION_BODY_LIMIT_BYTES} from "nbook/shared/storage/action";
import {defineStorageState, type DefinedStorageState} from "nbook/shared/storage/definition";
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

const definitions: readonly DefinedStorageState<unknown>[] = [layoutV1, note];

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

type StorageErrorBody = {readonly data?: {readonly code?: string; readonly reason?: string; readonly committed?: boolean}};
type Credential = {readonly revision: string | null; readonly partitionGeneration: number};
/** 修复凭据绑定原始内容，与条件凭据分开。 */
type RepairCredential = {readonly partitionGeneration: number; readonly contentFingerprint: string};
type ReadBody = {readonly result?: {
    readonly kind?: string;
    readonly value?: unknown;
    readonly schemaVersion?: number;
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

async function readState(host: StorageActionHostFixture, contextId: string, options: {readonly resource?: string} = {}): Promise<ReadBody> {
    const response = await host.act(contextId, {
        kind: "read",
        owner: LAYOUT_OWNER,
        key: "layout",
        ...options,
    });
    expect(response.status).toBe(200);
    return await response.json() as ReadBody;
}

describe("user 值动作 HTTP 合同", () => {
    it("未注册状态被拒绝且不创建任何记录", async () => {
        const host = await createHost({definitions});
        const contextId = await host.issue();

        const response = await host.act(contextId, {kind: "read", owner: "test.other", key: "layout"});
        await expectFailure(response, 500, "STORAGE_STATE_UNREGISTERED");

        // 未注册动作不能通过地址推导出分区；隔离根里只有身份域与锁目录。
        expect((await readdir(host.root)).sort()).toEqual([".locks", "identity.json"]);
    });

    it("请求体与动作形状不合法时在触碰记录前拒绝", async () => {
        const host = await createHost({definitions});
        const contextId = await host.issue();

        const unknownAction = await host.act(contextId, {kind: "purge", owner: LAYOUT_OWNER, key: "layout"});
        await expectFailure(unknownAction, 400, "STORAGE_REQUEST_INVALID");

        // 客户端不能借额外字段提交 scope、locality、主体或磁盘路径。
        const forged = await host.act(contextId, {
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

        const oversized = await host.act(contextId, {
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
            body: {kind: "read", owner: LAYOUT_OWNER, key: "layout"},
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

        const saved = await host.act(forSubjectA, {
            kind: "save",
            owner: LAYOUT_OWNER,
            key: "layout",
            expected: {revision: null, partitionGeneration: 1},
            value: {width: 100, height: 200},
        });
        expect(saved.status).toBe(200);

        const otherSubject = await host.act(forSubjectB, {kind: "read", owner: LAYOUT_OWNER, key: "layout"}, subjectBOptions);
        await expect(otherSubject.json()).resolves.toMatchObject({result: {kind: "missing"}});

        const otherClient = await host.issue(STORAGE_TEST_CLIENT_B, STORAGE_TEST_SUBJECT);
        const perClient = await host.act(otherClient, {kind: "read", owner: LAYOUT_OWNER, key: "layout"}, {credential: STORAGE_TEST_CLIENT_B});
        await expect(perClient.json()).resolves.toMatchObject({result: {kind: "missing"}});

        const own = await readState(host, forSubjectA);
        expect(own.result).toMatchObject({kind: "value", value: {width: 100, height: 200}});

        const ownPath = await host.recordPath({owner: LAYOUT_OWNER, key: "layout"});
        const otherPath = await host.recordPath({owner: LAYOUT_OWNER, key: "layout", clientCredential: STORAGE_TEST_CLIENT_B, subject: "user:8"});
        expect(ownPath).not.toBe(otherPath);
        expect(await readFile(ownPath, "utf8")).toContain("100");
    });

    it("缺失读取不创建记录，保存后重读并在新运行期恢复", async () => {
        const host = await createHost({definitions});
        const contextId = await host.issue();
        const recordPath = await host.recordPath({owner: LAYOUT_OWNER, key: "layout"});

        const missing = await readState(host, contextId);
        expect(missing.result).toMatchObject({kind: "missing"});
        // 默认显示不落盘：读取缺失状态不能创建值记录。
        await expect(readFile(recordPath, "utf8")).rejects.toMatchObject({code: "ENOENT"});

        const saved = await host.act(contextId, {
            kind: "save",
            owner: LAYOUT_OWNER,
            key: "layout",
            expected: {revision: null, partitionGeneration: 1},
            value: {width: 640, height: 480},
        });
        expect(saved.status).toBe(200);
        expect((await saved.json() as WriteBody).credential?.revision).toMatch(/^[0-9a-f-]{36}$/u);
        expect(JSON.parse(await readFile(recordPath, "utf8"))).toMatchObject({state: "value", value: {width: 640, height: 480}});
        expect((await readState(host, contextId)).result).toMatchObject({kind: "value", value: {width: 640, height: 480}});

        // 新运行期：旧标识失效，同一客户端凭证仍定位到原 local 分区并读到已确认值。
        await host.configure();
        await expectFailure(await host.act(contextId, {kind: "read", owner: LAYOUT_OWNER, key: "layout"}), 403, "STORAGE_CONTEXT_INVALID");
        const resumed = await host.issue();
        expect((await readState(host, resumed)).result).toMatchObject({kind: "value", value: {width: 640, height: 480}});
    });

    it("同一旧 revision 的并发保存只有一个成功", async () => {
        const host = await createHost({definitions});
        const contextId = await host.issue();
        await host.act(contextId, {
            kind: "save",
            owner: LAYOUT_OWNER,
            key: "layout",
            expected: {revision: null, partitionGeneration: 1},
            value: {width: 1, height: 1},
        });
        const current = (await readState(host, contextId)).result?.credential;
        expect(current).toBeDefined();

        const [first, second] = await Promise.all([
            host.act(contextId, {kind: "save", owner: LAYOUT_OWNER, key: "layout", expected: current, value: {width: 2, height: 2}}),
            host.act(contextId, {kind: "save", owner: LAYOUT_OWNER, key: "layout", expected: current, value: {width: 3, height: 3}}),
        ]);
        const statuses = [first.status, second.status].sort((left, right) => left - right);
        expect(statuses).toEqual([200, 409]);
        const conflict = first.status === 409 ? first : second;
        await expect(conflict.json()).resolves.toMatchObject({data: {code: "STORAGE_REVISION_CONFLICT"}});

        const winner = first.status === 200 ? first : second;
        expect((await winner.json() as WriteBody).credential?.revision).not.toBe(current?.revision);
        const after = (await readState(host, contextId)).result;
        expect([{width: 2, height: 2}, {width: 3, height: 3}]).toContainEqual(after?.value);
    });

    it("删除形成墓碑，删除前的凭据不能复活记录", async () => {
        const host = await createHost({definitions});
        const contextId = await host.issue();
        await host.act(contextId, {
            kind: "save",
            owner: LAYOUT_OWNER,
            key: "layout",
            expected: {revision: null, partitionGeneration: 1},
            value: {width: 10, height: 20},
        });
        const beforeDelete = (await readState(host, contextId)).result?.credential;
        expect(beforeDelete).toBeDefined();

        const removed = await host.act(contextId, {kind: "remove", owner: LAYOUT_OWNER, key: "layout", expected: beforeDelete});
        expect(removed.status).toBe(200);
        const tombstone = (await readState(host, contextId)).result;
        expect(tombstone?.kind).toBe("deleted");
        expect(tombstone?.credential?.revision).not.toBe(beforeDelete?.revision);

        const revived = await host.act(contextId, {
            kind: "save",
            owner: LAYOUT_OWNER,
            key: "layout",
            expected: beforeDelete,
            value: {width: 11, height: 21},
        });
        await expectFailure(revived, 409, "STORAGE_REVISION_CONFLICT");
        expect((await readState(host, contextId)).result?.kind).toBe("deleted");

        const recreated = await host.act(contextId, {
            kind: "save",
            owner: LAYOUT_OWNER,
            key: "layout",
            expected: tombstone?.credential,
            value: {width: 30, height: 40},
        });
        expect(recreated.status).toBe(200);
        expect((await readState(host, contextId)).result).toMatchObject({kind: "value", value: {width: 30, height: 40}});
    });

    it("损坏记录禁止普通保存，显式修复保留原件并让旧修复凭据失效", async () => {
        const host = await createHost({definitions});
        const contextId = await host.issue();
        const recordPath = await host.recordPath({owner: LAYOUT_OWNER, key: "layout"});
        await host.act(contextId, {
            kind: "save",
            owner: LAYOUT_OWNER,
            key: "layout",
            expected: {revision: null, partitionGeneration: 1},
            value: {width: 1, height: 2},
        });
        const brokenContent = "private-diagnostic-marker";
        await writeFile(recordPath, brokenContent, "utf8");

        const corrupted = (await readState(host, contextId)).result;
        expect(corrupted?.kind).toBe("corrupt");
        expect(corrupted?.repair).toBeDefined();
        expect(JSON.stringify(corrupted)).not.toContain(brokenContent);

        const plainSave = await host.act(contextId, {
            kind: "save",
            owner: LAYOUT_OWNER,
            key: "layout",
            expected: {revision: null, partitionGeneration: corrupted?.repair?.partitionGeneration ?? 1},
            value: {width: 5, height: 6},
        });
        await expectFailure(plainSave, 409, "STORAGE_WRITE_BLOCKED");
        expect(await readFile(recordPath, "utf8")).toBe(brokenContent);

        const repaired = await host.act(contextId, {
            kind: "repair",
            owner: LAYOUT_OWNER,
            key: "layout",
            expected: corrupted?.repair,
            value: {width: 7, height: 8},
        });
        expect(repaired.status).toBe(200);
        expect((await readState(host, contextId)).result).toMatchObject({kind: "value", value: {width: 7, height: 8}});

        const repeated = await host.act(contextId, {
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
        await host.act(contextId, {
            kind: "save",
            owner: LAYOUT_OWNER,
            key: "layout",
            expected: {revision: null, partitionGeneration: 1},
            value: {width: 12, height: 24},
        });

        await host.configure({definitions: [layoutV2]});
        const reloaded = await host.issue();
        const legacy = (await readState(host, reloaded)).result;
        expect(legacy).toMatchObject({kind: "legacy-value", schemaVersion: 1, value: {width: 12, height: 24}});

        const blocked = await host.act(reloaded, {
            kind: "save",
            owner: LAYOUT_OWNER,
            key: "layout",
            expected: legacy?.credential,
            value: {width: 13, height: 25, theme: "manual"},
        });
        await expectFailure(blocked, 409, "STORAGE_WRITE_BLOCKED");

        const migrated = await host.act(reloaded, {
            kind: "migrate",
            owner: LAYOUT_OWNER,
            key: "layout",
            expected: legacy?.credential,
        });
        expect(migrated.status).toBe(200);
        expect((await readState(host, reloaded)).result).toMatchObject({
            kind: "value",
            schemaVersion: 2,
            value: {width: 12, height: 24, theme: "migrated"},
        });
    });

    it("回收选定的墓碑并让回收前的条件凭据失效", async () => {
        const host = await createHost({definitions});
        const contextId = await host.issue();
        const credentials: Credential[] = [];
        for (const resource of ["first", "second"]) {
            const saved = await host.act(contextId, {
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
            const removed = await host.act(contextId, {
                kind: "remove",
                owner: NOTE_OWNER,
                key: "note",
                resource,
                expected: credentials[index],
            });
            expect(removed.status).toBe(200);
        }

        const reclaimed = await host.act(contextId, {
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

        const missing = await host.act(contextId, {kind: "read", owner: NOTE_OWNER, key: "note", resource: "first"});
        await expect(missing.json()).resolves.toMatchObject({result: {kind: "missing", credential: {partitionGeneration: 2}}});

        const stale = await host.act(contextId, {
            kind: "save",
            owner: NOTE_OWNER,
            key: "note",
            resource: "first",
            expected: credentials[0],
            value: {text: "revived"},
        });
        await expectFailure(stale, 409, "STORAGE_CREDENTIAL_STALE");
        expect(await readdir(partition.recordsDirectory)).toEqual([]);
    });

    it("读取 I/O 失败与缺失区分，响应不包含内部路径", async () => {
        const host = await createHost({definitions});
        const contextId = await host.issue();
        const recordPath = await host.recordPath({owner: LAYOUT_OWNER, key: "layout"});
        await mkdir(recordPath, {recursive: true});

        const failed = await host.act(contextId, {kind: "read", owner: LAYOUT_OWNER, key: "layout"});
        const body = await expectFailure(failed, 500, "STORAGE_IO_FAILURE");
        expect(body.data?.code).toBe("STORAGE_IO_FAILURE");
        const text = JSON.stringify(body);
        expect(text).not.toContain(host.root);
        expect(text).not.toContain(STORAGE_TEST_CLIENT_A);
        await rm(recordPath, {recursive: true, force: true});
        expect((await readState(host, contextId)).result?.kind).toBe("missing");
    });
});
