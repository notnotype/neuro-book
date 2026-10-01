import {testHostPath} from "@notnotype/neuro-book-test-support/test-path";
import {randomUUID} from "node:crypto";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";
import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vitest";
import {AttachmentStore} from "nbook/server/agent/attachments/attachment-store";
import type {AttachmentBlobAdapter} from "nbook/server/agent/attachments/types";
import {NeuroAgentHarness} from "nbook/server/agent/harness/neuro-agent-harness";
import {AgentProfileCatalog} from "nbook/server/agent/profiles/catalog";
import {JsonlSessionRepository} from "nbook/server/agent/session/session-repo";
import type {SessionEntryDraft} from "nbook/server/agent/session/types";
import {resolveProfileArtifactPathContext} from "nbook/server/agent/profiles/profile-artifact-compiler";
import {createRasterTestFixtures, jpegWithDimensions} from "nbook/server/agent/test-utils/raster-fixtures";
import type {AttachmentRef} from "nbook/shared/dto/agent-attachment.dto";
import {absoluteFsPath, type AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {closeAllProjects,
    closeProject,
    openProject,
    resetProjectSessionsForTest} from "nbook/server/runtime/product-project";
import {projectWorkspaceRef} from "nbook/server/workspace-files/project-identity";
import {
    projectModuleToken,
    replaceProjectModulesForTest,
    type ProjectModule,
    type ProjectModuleHandle,
} from "nbook/server/workspace-files/project-module";
import {setWorkspaceRuntimeRootContextForTest} from "nbook/server/workspace-files/workspace-runtime-root";

let png: Buffer;
let oversizedJpeg: Buffer;

beforeAll(async () => {
    const fixtures = await createRasterTestFixtures();
    png = fixtures.png;
    oversizedJpeg = jpegWithDimensions(fixtures.jpeg, 8_193, 8_192);
});

describe("NeuroAgentHarness session attachment locator", () => {
    let root: AbsoluteFsPath;
    let repo: JsonlSessionRepository;
    let harness: NeuroAgentHarness;
    let attachmentAdapter: AttachmentBlobAdapter;

    beforeEach(() => {
        resetProjectSessionsForTest();
        root = absoluteFsPath(testHostPath("session-attachment-test", randomUUID()));
        setWorkspaceRuntimeRootContextForTest({workspaceRoot: root});
        repo = new JsonlSessionRepository(root);
        attachmentAdapter = memoryAttachmentAdapter();
        harness = new NeuroAgentHarness({
            repo,
            profiles: new AgentProfileCatalog(
                join(root, "system-profiles"),
                undefined,
                undefined,
                undefined,
                (profileRoot, rootLabel) => resolveProfileArtifactPathContext(profileRoot, rootLabel, root),
                {install: "workspace/.nbook/agent/profiles"},
            ),
            enableSessionSummarizer: false,
            attachmentStore: new AttachmentStore(attachmentAdapter),
        });
    });

    afterEach(async () => {
        await harness.drainBackgroundTasks();
        await harness.dispose();
        await closeAllProjects().catch(() => undefined);
        resetProjectSessionsForTest();
        await rm(root, {recursive: true, force: true});
    });

    it("解析 projector 实际公开的 durable user attachment locator", async () => {
        const session = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
        });
        const attachment = attachmentRef("a", "image/png", 8);
        const entry = await repo.appendEntry(session.metadata.sessionId, {
            type: "message",
            origin: "prompt",
            clientMessageId: randomUUID(),
            intent: "normal",
            message: {
                role: "user",
                content: [
                    {type: "text", text: "参考图"},
                    {type: "attachment", attachment, name: "参考图.png"},
                ],
                timestamp: 100,
            },
        } as unknown as SessionEntryDraft);

        await expect(harness.resolveSessionAttachment(session.metadata.sessionId, entry.id, 1)).resolves.toEqual({
            ref: attachment,
            name: "参考图.png",
            read: expect.any(Function),
        });
    });

    it("附件 locator lookup 不构造完整 SessionSnapshot", async () => {
        const session = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
        });
        const attachment = attachmentRef("d", "image/png", 8);
        const entry = await repo.appendEntry(session.metadata.sessionId, {
            type: "message",
            origin: "prompt",
            clientMessageId: randomUUID(),
            intent: "normal",
            message: {
                role: "user",
                content: [{type: "attachment", attachment}],
                timestamp: 100,
            },
        } as unknown as SessionEntryDraft);
        const readSession = vi.spyOn(repo, "readSession").mockRejectedValue(new Error("full snapshot lookup is forbidden"));

        await expect(harness.resolveSessionAttachment(session.metadata.sessionId, entry.id, 0)).resolves.toMatchObject({ref: attachment});
        expect(readSession).not.toHaveBeenCalled();
    });

    it("Project session attachment 复用 Project open gate", async () => {
        const projectRoot = "attachment-project";
        const projectDirectory = join(root, projectRoot);
        await mkdir(projectDirectory, {recursive: true});
        const session = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
            currentProjectRoot: "attachment-project",
        });
        const attachment = attachmentRef("e", "image/png", 8);
        const entry = await repo.appendEntry(session.metadata.sessionId, {
            type: "message",
            origin: "prompt",
            clientMessageId: randomUUID(),
            intent: "normal",
            message: {
                role: "user",
                content: [{type: "attachment", attachment}],
                timestamp: 100,
            },
        } as unknown as SessionEntryDraft);

        await expect(harness.resolveSessionAttachment(session.metadata.sessionId, entry.id, 0))
            .rejects.toMatchObject({code: "PROJECT_NOT_OPEN", projectRoot});
        await openProject(projectWorkspaceRef(projectRoot), {kind: "agent", sessionId: session.metadata.sessionId}, root);
        await expect(harness.resolveSessionAttachment(session.metadata.sessionId, entry.id, 0))
            .resolves.toMatchObject({ref: attachment});
        await closeProject(projectWorkspaceRef(projectRoot), "shutdown");
    });

    it("解析 projector 实际公开的 durable tool result attachment locator", async () => {
        const session = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
        });
        const attachment = attachmentRef("b", "image/webp", 12);
        const entry = await repo.appendEntry(session.metadata.sessionId, {
            type: "message",
            origin: "ingest",
            message: {
                role: "toolResult",
                toolCallId: "read-image",
                toolName: "read",
                content: [
                    {type: "text", text: "Read image file [image/webp]"},
                    {type: "attachment", attachment, name: "scene.webp"},
                ],
                isError: false,
                timestamp: 101,
            },
        } as unknown as SessionEntryDraft);

        await expect(harness.resolveSessionAttachment(session.metadata.sessionId, entry.id, 1)).resolves.toEqual({
            ref: attachment,
            name: "scene.webp",
            read: expect.any(Function),
        });
    });

    it("允许 custom_message locator，但拒绝仅存在于 follow-up queue custom state 的 attachment", async () => {
        const session = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
        });
        const attachment = attachmentRef("c", "image/png", 8);
        const customMessage = await repo.appendEntry(session.metadata.sessionId, {
            type: "custom_message",
            visibleToModel: true,
            message: {
                role: "user",
                content: [{type: "attachment", attachment, name: "internal.png"}],
                timestamp: 102,
            },
        } as unknown as SessionEntryDraft);
        const followUpQueue = await repo.appendEntry(session.metadata.sessionId, {
            type: "custom",
            key: "agent.followup_queue",
            value: {
                items: [{
                    id: "followup-1",
                    kind: "followup",
                    createdAt: 103,
                    message: {
                        text: "内部队列",
                        attachments: [{type: "attachment", attachment, name: "queued.png"}],
                    },
                }],
            },
        });

        await expect(harness.resolveSessionAttachment(session.metadata.sessionId, customMessage.id, 0))
            .resolves.toEqual({ref: attachment, name: "internal.png", read: expect.any(Function)});
        await expect(harness.resolveSessionAttachment(session.metadata.sessionId, followUpQueue.id, 0))
            .rejects.toThrow("Attachment locator 不存在或已失效");
    });

    it("附件目录扫描全部分支和 batch，按 ID 去重、计数、搜索并分页", async () => {
        const session = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
        });
        const first = attachmentRef("1", "image/png", 8);
        const second = attachmentRef("2", "image/webp", 12);
        await repo.appendEntry(session.metadata.sessionId, {
            type: "message",
            origin: "prompt",
            clientMessageId: randomUUID(),
            intent: "normal",
            parentId: null,
            timestamp: 100,
            message: {
                role: "user",
                content: [{type: "attachment", attachment: first, name: "old-name.png"}],
                timestamp: 100,
            },
        });
        await repo.appendEntry(session.metadata.sessionId, {
            type: "custom_message",
            visibleToModel: true,
            parentId: null,
            timestamp: 200,
            message: {
                role: "toolResult",
                toolCallId: "catalog-read",
                toolName: "read",
                content: [{type: "attachment", attachment: second, name: "scene.webp"}],
                isError: false,
                timestamp: 200,
            },
        });
        const batch = await repo.appendEntries(session.metadata.sessionId, [
            {
                type: "session_attachment",
                origin: "projection",
                attachment: first,
                name: "new-name.png",
                source: "upload",
                parentId: null,
                timestamp: 300,
            },
            {
                type: "message",
                origin: "ingest",
                parentId: null,
                timestamp: 250,
                message: {
                    role: "toolResult",
                    toolCallId: "catalog-read-again",
                    toolName: "read",
                    content: [{type: "attachment", attachment: second}],
                    isError: false,
                    timestamp: 250,
                },
            },
        ]);

        const firstPage = await harness.listSessionAttachments(session.metadata.sessionId, {offset: 0, limit: 1});
        expect(firstPage).toMatchObject({total: 2, offset: 0, limit: 1, hasMore: true, nextOffset: 1});
        expect(firstPage.items[0]).toMatchObject({
            attachment: {attachmentId: first.id, name: "new-name.png"},
            locator: {entryId: batch[0]?.id, contentIndex: 0},
            firstSeenAt: 100,
            lastSeenAt: 300,
            referenceCount: 2,
        });

        const searched = await harness.listSessionAttachments(session.metadata.sessionId, {
            search: "WEBP",
            offset: 0,
            limit: 40,
        });
        expect(searched.items).toEqual([expect.objectContaining({
            attachment: expect.objectContaining({attachmentId: second.id, name: "scene.webp"}),
            referenceCount: 2,
        })]);
    });

    it("批量 resolve 保持请求顺序，空输入短路，任一越权 ID 使整体失败", async () => {
        const session = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
        });
        const first = attachmentRef("3", "image/png", 8);
        const second = attachmentRef("4", "image/webp", 12);
        await repo.appendEntries(session.metadata.sessionId, [
            {
                type: "session_attachment",
                origin: "projection",
                attachment: first,
                source: "upload",
            },
            {
                type: "session_attachment",
                origin: "projection",
                attachment: second,
                source: "file_snapshot",
            },
        ]);

        const resolved = await harness.resolveSessionAttachments(session.metadata.sessionId, [second.id, first.id]);
        expect(resolved.map((item) => item.attachment.attachmentId)).toEqual([second.id, first.id]);
        await expect(harness.resolveSessionAttachments(session.metadata.sessionId, [])).resolves.toEqual([]);
        await expect(harness.resolveSessionAttachments(session.metadata.sessionId, [
            first.id,
            attachmentRef("5", "image/png", 8).id,
        ])).rejects.toMatchObject({code: "invalid_reference"});
    });

    it("外部追加 JSONL 后按文件签名重建热索引", async () => {
        const session = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
        });
        const first = attachmentRef("6", "image/png", 8);
        const second = attachmentRef("7", "image/webp", 12);
        await repo.appendEntry(session.metadata.sessionId, {
            type: "session_attachment",
            origin: "projection",
            attachment: first,
            source: "upload",
        });
        await expect(harness.listSessionAttachments(session.metadata.sessionId, {offset: 0, limit: 40}))
            .resolves.toMatchObject({total: 1});

        await repo.appendEntry(session.metadata.sessionId, {
            type: "session_attachment",
            origin: "projection",
            attachment: second,
            source: "file_snapshot",
        });

        const rebuilt = await harness.listSessionAttachments(session.metadata.sessionId, {offset: 0, limit: 40});
        expect(rebuilt.total).toBe(2);
        expect(rebuilt.items.map((item) => item.attachment.attachmentId)).toEqual(expect.arrayContaining([first.id, second.id]));
    });

    it("冷索引构建期间的 after-write 增量不会丢失", async () => {
        const session = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
        });
        const first = attachmentRef("8", "image/png", 8);
        const second = attachmentRef("9", "image/webp", 12);
        await repo.appendEntry(session.metadata.sessionId, {
            type: "session_attachment",
            origin: "projection",
            attachment: first,
            source: "upload",
        });
        const scanEntries = repo.scanEntries.bind(repo);
        let releaseScan = (): void => {};
        const scanGate = new Promise<void>((resolveGate) => {
            releaseScan = resolveGate;
        });
        let confirmScanBlocked = (): void => {};
        const scanBlocked = new Promise<void>((resolveBlocked) => {
            confirmScanBlocked = resolveBlocked;
        });
        vi.spyOn(repo, "scanEntries").mockImplementation(async (...args) => {
            const metadata = await scanEntries(...args);
            confirmScanBlocked();
            await scanGate;
            return metadata;
        });

        const listing = harness.listSessionAttachments(session.metadata.sessionId, {offset: 0, limit: 40});
        await scanBlocked;
        const appended = await repo.appendEntry(session.metadata.sessionId, {
            type: "session_attachment",
            origin: "projection",
            attachment: second,
            source: "file_snapshot",
        });
        await harness.sessionAttachments.onEntriesWritten({
            sessionId: session.metadata.sessionId,
            cause: "test.concurrent-attachment-write",
            entries: [appended],
        });
        releaseScan();

        await expect(listing).resolves.toMatchObject({total: 2});
    });

    it("同一 Attachment ID 出现冲突 metadata 时目录 fail closed", async () => {
        const session = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
        });
        const attachment = attachmentRef("f", "image/png", 8);
        await repo.appendEntry(session.metadata.sessionId, {
            type: "session_attachment",
            origin: "projection",
            attachment,
            source: "upload",
        });
        await repo.appendEntry(session.metadata.sessionId, {
            type: "session_attachment",
            origin: "projection",
            attachment: {...attachment, bytes: 9},
            source: "file_snapshot",
        });

        await expect(harness.listSessionAttachments(session.metadata.sessionId, {offset: 0, limit: 40}))
            .rejects.toMatchObject({code: "corrupt"});
    });

    it("上传登记不移动 active leaf，也不进入模型上下文或 Session Tree", async () => {
        const session = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
        });
        const prompt = await repo.appendEntry(session.metadata.sessionId, {
            type: "message",
            origin: "prompt",
            clientMessageId: randomUUID(),
            intent: "normal",
            message: {
                role: "user",
                content: [{type: "text", text: "保留当前分支"}],
                timestamp: 100,
            },
        });
        const before = await repo.readSession(session.metadata.sessionId);

        const uploaded = await harness.uploadSessionAttachment(session.metadata.sessionId, {
            bytes: png,
            mimeType: "image/png",
            name: "projection.png",
        });
        const after = await repo.readSession(session.metadata.sessionId);

        expect(before.leafId).toBe(prompt.id);
        expect(after.leafId).toBe(before.leafId);
        expect(repo.reduce(after).messages).toEqual(repo.reduce(before).messages);
        expect(repo.tree(after).some((node) => node.id === uploaded.locator.entryId)).toBe(false);
        expect(after.entries.find((entry) => entry.id === uploaded.locator.entryId)).toMatchObject({
            type: "session_attachment",
            origin: "projection",
            source: "upload",
        });
    });

    it("附件处理完成前 Session 被归档时最终门禁拒绝登记", async () => {
        const session = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
        });
        const originalSaveImage = harness.attachmentCodec.saveImage.bind(harness.attachmentCodec);
        let releaseSave = (): void => {};
        const saveGate = new Promise<void>((resolveGate) => {
            releaseSave = resolveGate;
        });
        let confirmSaveBlocked = (): void => {};
        const saveBlocked = new Promise<void>((resolveBlocked) => {
            confirmSaveBlocked = resolveBlocked;
        });
        vi.spyOn(harness.attachmentCodec, "saveImage").mockImplementation(async (input) => {
            confirmSaveBlocked();
            await saveGate;
            return originalSaveImage(input);
        });

        const upload = harness.uploadSessionAttachment(session.metadata.sessionId, {
            bytes: png,
            mimeType: "image/png",
            name: "late.png",
        });
        await saveBlocked;
        await harness.runCommand(session.metadata.sessionId, {command: "archive", reason: "concurrent archive"});
        releaseSave();

        await expect(upload).rejects.toMatchObject({
            code: "invalid_input",
            message: "当前 Session 已归档，不能登记附件。",
        });
        const snapshot = await repo.readSession(session.metadata.sessionId);
        expect(snapshot.entries.some((entry) => entry.type === "session_attachment")).toBe(false);
    });

    it("Project、Workspace Root .nbook 与绝对路径快照都生成稳定副本，并拒绝 Attachment Store 自引用", async () => {
        const projectRoot = "snapshot-project";
        const projectAddress = `workspace/${projectRoot}`;
        const projectFile = join(root, "snapshot-project", "images", "cover.png");
        const nbookFile = join(root, ".nbook", "assets", "global.png");
        const absoluteFile = join(root, "outside", "absolute.png");
        await mkdir(join(root, "snapshot-project", "images"), {recursive: true});
        await mkdir(join(root, ".nbook", "assets"), {recursive: true});
        await mkdir(join(root, "outside"), {recursive: true});
        const original = png;
        await writeFile(projectFile, original);
        await writeFile(nbookFile, original);
        await writeFile(absoluteFile, original);
        const session = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
            currentProjectRoot: "snapshot-project",
        });

        await expect(harness.snapshotSessionAttachment(session.metadata.sessionId, {
            sourcePath: `${projectAddress}/images/cover.png`,
        })).rejects.toMatchObject({code: "PROJECT_NOT_OPEN", projectRoot});

        await openProject(projectWorkspaceRef(projectRoot), {kind: "agent", sessionId: session.metadata.sessionId}, root);
        try {
            const projectSnapshot = await harness.snapshotSessionAttachment(session.metadata.sessionId, {
                sourcePath: `${projectAddress}/images/cover.png`,
                name: "project.png",
            });
            await writeFile(projectFile, Uint8Array.from([...original, 2]));
            const resolved = await harness.resolveSessionAttachment(
                session.metadata.sessionId,
                projectSnapshot.locator.entryId,
                projectSnapshot.locator.contentIndex,
            );
            const snapshottedBytes = await resolved.read();
            expect(Buffer.from(snapshottedBytes)).toEqual(original);

            await expect(harness.snapshotSessionAttachment(session.metadata.sessionId, {
                sourcePath: "workspace/.nbook/assets/global.png",
            })).resolves.toMatchObject({attachment: {mimeType: "image/png"}});
            await expect(harness.snapshotSessionAttachment(session.metadata.sessionId, {
                sourcePath: absoluteFile,
            })).resolves.toMatchObject({attachment: {mimeType: "image/png"}});

            const hash = projectSnapshot.attachment.attachmentId.slice("sha256:".length);
            const attachmentStoreFile = join(repo.attachmentsRoot, "sha256", hash.slice(0, 2), hash.slice(2));
            await mkdir(dirname(attachmentStoreFile), {recursive: true});
            await writeFile(attachmentStoreFile, original);
            await expect(harness.snapshotSessionAttachment(session.metadata.sessionId, {
                sourcePath: attachmentStoreFile,
            })).rejects.toMatchObject({code: "invalid_input"});
        } finally {
            await closeProject(projectWorkspaceRef(projectRoot), "shutdown");
        }
    });

    it("快照图片在 Store 写入前拒绝超过 64 MP 的源图", async () => {
        const sourceFile = join(root, "outside", "pixel-bomb.jpg");
        await mkdir(join(root, "outside"), {recursive: true});
        await writeFile(sourceFile, oversizedJpeg);
        const session = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
        });
        const put = vi.spyOn(attachmentAdapter, "put");

        await expect(harness.snapshotSessionAttachment(session.metadata.sessionId, {
            sourcePath: sourceFile,
        })).rejects.toMatchObject({code: "limit_exceeded"});
        expect(put).not.toHaveBeenCalled();
    });

    it("跨 Project 快照持有源 Project generation，close 等待读取后才能重开", async () => {
        const ownerProjectRoot = "snapshot-owner";
        const targetProjectRoot = "snapshot-target";
        const targetProjectAddress = `workspace/${targetProjectRoot}`;
        const targetProjectDirectory = join(root, targetProjectRoot);
        const sourceFile = join(targetProjectDirectory, "images", "cover.png");
        await mkdir(join(root, "snapshot-owner"), {recursive: true});
        await mkdir(join(targetProjectDirectory, "images"), {recursive: true});
        await writeFile(sourceFile, png);

        const targetModuleCloseStarted = createDeferred();
        const restoreModules = replaceProjectModulesForTest(projectModulesWithCloseProbe(
            "snapshot-target",
            targetModuleCloseStarted.resolve,
        ));
        const session = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
            currentProjectRoot: "snapshot-owner",
        });
        const readStarted = createDeferred();
        const releaseRead = createDeferred();
        const reader = harness["attachmentSnapshotReader"];
        const originalRead = reader.read.bind(reader);
        vi.spyOn(reader, "read").mockImplementation(async (path) => {
            readStarted.resolve();
            await releaseRead.promise;
            return originalRead(path);
        });

        let snapshotting: ReturnType<NeuroAgentHarness["snapshotSessionAttachment"]> | null = null;
        let closing: Promise<void> | null = null;
        try {
            await openProject(projectWorkspaceRef(ownerProjectRoot), {kind: "agent", sessionId: session.metadata.sessionId}, root);
            const targetReady = await openProject(projectWorkspaceRef(targetProjectRoot), {
                kind: "job",
                source: "cross-project-attachment-snapshot",
            }, root);
            snapshotting = harness.snapshotSessionAttachment(session.metadata.sessionId, {
                sourcePath: `${targetProjectAddress}/images/cover.png`,
                name: "target-cover.png",
            });
            await readStarted.promise;

            closing = closeProject(projectWorkspaceRef(targetProjectRoot), "shutdown");
            const closeProgress = await Promise.race([
                targetModuleCloseStarted.promise.then(() => "module-close" as const),
                new Promise<"read-blocked">((resolveBlocked) => {
                    setTimeout(() => resolveBlocked("read-blocked"), 25);
                }),
            ]);
            expect(closeProgress).toBe("read-blocked");

            releaseRead.resolve();
            await expect(snapshotting).resolves.toMatchObject({attachment: {mimeType: "image/png"}});
            await closing;
            await targetModuleCloseStarted.promise;

            const reopened = await openProject(projectWorkspaceRef(targetProjectRoot), {
                kind: "job",
                source: "cross-project-attachment-snapshot-reopen",
            }, root);
            expect(reopened.generation).not.toBe(targetReady.generation);
            expect(reader.read).toHaveBeenCalledTimes(1);
        } finally {
            releaseRead.resolve();
            await snapshotting?.catch(() => undefined);
            await closing?.catch(() => undefined);
            await closeProject(projectWorkspaceRef(targetProjectRoot), "shutdown").catch(() => undefined);
            await closeProject(projectWorkspaceRef(ownerProjectRoot), "shutdown").catch(() => undefined);
            restoreModules();
        }
    });

    it("相同 Workspace Root 的其他 Session 不能仅凭哈希伪造附件授权", async () => {
        const owner = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
        });
        const attacker = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
        });
        const uploaded = await harness.uploadSessionAttachment(owner.metadata.sessionId, {
            bytes: png,
            mimeType: "image/png",
            name: "private.png",
        });

        await expect(harness.sessionAttachments.resolve(attacker.metadata.sessionId, [uploaded.attachment.attachmentId]))
            .rejects.toMatchObject({code: "invalid_reference"});
    });
});

/** 创建语义清晰的 content-addressed attachment fixture。 */
function attachmentRef(hashCharacter: string, mimeType: string, bytes: number): AttachmentRef {
    return {
        id: `sha256:${hashCharacter.repeat(64)}`,
        mimeType,
        bytes,
    };
}

/** 创建只在当前用例内存活的 Attachment Adapter。 */
function memoryAttachmentAdapter(): AttachmentBlobAdapter {
    const values = new Map<string, Uint8Array>();
    return {
        async put(key, bytes) {
            values.set(key, bytes.slice());
        },
        async get(key) {
            return values.get(key)?.slice() ?? null;
        },
    };
}

/** 创建可控异步门禁，稳定排列 snapshot read 与 Project close。 */
function createDeferred(): {promise: Promise<void>; resolve: () => void} {
    let resolve!: () => void;
    const promise = new Promise<void>((nextResolve) => {
        resolve = nextResolve;
    });
    return {promise, resolve};
}

/** 构造最小 required Module，并在目标 generation 真正开始关闭资源时发出探针。 */
function projectModulesWithCloseProbe(projectRoot: string, onClose: () => void): ProjectModule[] {
    return (["database", "history", "file-index"] as const).map((name): ProjectModule => ({
        token: projectModuleToken<ProjectModuleHandle>(name, "required"),
        start(context) {
            const probesTarget = context.prepared.workspace.ref.projectRoot === projectRoot;
            return {
                ready: Promise.resolve(),
                async close(): Promise<void> {
                    if (probesTarget) {
                        onClose();
                    }
                },
            };
        },
    }));
}
