import {effectScope, nextTick, ref} from "vue";
import {beforeEach, describe, expect, it, vi} from "vitest";
import type {AgentSessionAttachmentItemDto} from "nbook/shared/dto/agent-session.dto";
import type {PlainImageNodeAttrs} from "nbook/app/utils/plain-reference-text";
import type {ComposerImageNode} from "nbook/app/components/novel-ide/agent/composer-image-transaction";
import {
    useComposerImageTransaction,
    type ComposerImageEditorPort,
} from "nbook/app/components/novel-ide/agent/useComposerImageTransaction";

const mocks = vi.hoisted(() => ({
    upload: vi.fn<(sessionId: number, file: File, signal?: AbortSignal) => Promise<AgentSessionAttachmentItemDto>>(),
    snapshot: vi.fn<(sessionId: number, input: {sourcePath: string; name?: string}, signal?: AbortSignal) => Promise<AgentSessionAttachmentItemDto>>(),
    resolve: vi.fn<(sessionId: number, attachmentIds: string[]) => Promise<{items: AgentSessionAttachmentItemDto[]}>>(),
    list: vi.fn(async () => ({items: [], total: 0, offset: 0, limit: 20, hasMore: false})),
    error: vi.fn(),
    warning: vi.fn(),
}));

vi.mock("nbook/app/composables/useAgentSessionApi", () => ({
    useAgentSessionApi: () => ({
        uploadSessionAttachment: mocks.upload,
        snapshotSessionAttachment: mocks.snapshot,
        resolveSessionAttachments: mocks.resolve,
        getSessionAttachments: mocks.list,
    }),
}));
vi.mock("nbook/app/composables/useNotification", () => ({
    useNotification: () => ({error: mocks.error, warning: mocks.warning}),
}));

beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolve.mockResolvedValue({items: []});
});

describe("Composer image transaction", () => {
    it("最多两个请求并发，响应乱序不改变文档图片顺序", async () => {
        const pending = new Map<string, Deferred<AgentSessionAttachmentItemDto>>();
        mocks.upload.mockImplementation(async (_sessionId, file) => {
            const request = deferred<AgentSessionAttachmentItemDto>();
            pending.set(file.name, request);
            return request.promise;
        });
        const harness = createHarness();

        harness.controller.queueFiles({files: [imageFile("first.png"), imageFile("second.png"), imageFile("third.png")]});
        expect(mocks.upload.mock.calls.map((call) => call[1].name)).toEqual(["first.png", "second.png"]);
        expect(harness.editor.document.map((node) => node.kind === "pending" ? node.name : node.label))
            .toEqual(["first.png", "second.png", "third.png"]);

        pending.get("second.png")?.resolve(attachment("b", "second.png"));
        await flushPromises();
        expect(mocks.upload.mock.calls.map((call) => call[1].name)).toEqual(["first.png", "second.png", "third.png"]);
        pending.get("first.png")?.resolve(attachment("a", "first.png"));
        pending.get("third.png")?.resolve(attachment("c", "third.png"));
        await flushPromises();

        expect(harness.editor.document.map((node) => node.kind === "stable" ? node.label : node.name))
            .toEqual(["first.png", "second.png", "third.png"]);
        harness.dispose();
    });

    it("删除会中止请求，同代次 Undo 可用原 File 重新上传，迟到响应不会覆盖新请求", async () => {
        const first = deferred<AgentSessionAttachmentItemDto>();
        const second = deferred<AgentSessionAttachmentItemDto>();
        mocks.upload
            .mockImplementationOnce(async () => first.promise)
            .mockImplementationOnce(async () => second.promise);
        const harness = createHarness();
        harness.controller.queueFiles({files: [imageFile("undo.png")]});
        const pendingNode = harness.editor.document[0];
        if (!pendingNode || pendingNode.kind !== "pending") throw new Error("测试缺少 pending 图片");
        const firstSignal = mocks.upload.mock.calls[0]?.[2];

        harness.controller.remove(pendingNode.uploadId);
        expect(firstSignal?.aborted).toBe(true);
        harness.editor.document = [{...pendingNode, status: "uploading"}];
        harness.controller.applyDocument(harness.editor.document);
        await flushPromises();
        expect(mocks.upload).toHaveBeenCalledTimes(2);

        first.resolve(attachment("d", "late.png"));
        await flushPromises();
        expect(harness.editor.document[0]?.kind).toBe("pending");
        second.resolve(attachment("e", "undo.png"));
        await flushPromises();
        expect(harness.editor.document[0]).toMatchObject({kind: "stable", label: "undo.png"});
        harness.dispose();
    });

    it("Session generation 切换后中止请求并忽略迟到响应", async () => {
        const request = deferred<AgentSessionAttachmentItemDto>();
        mocks.upload.mockImplementation(async () => request.promise);
        const harness = createHarness();
        harness.controller.queueFiles({files: [imageFile("old.png")]});
        const signal = mocks.upload.mock.calls[0]?.[2];

        harness.sessionId.value = 2;
        await nextTick();
        expect(signal?.aborted).toBe(true);
        request.resolve(attachment("f", "old.png"));
        await flushPromises();

        expect(harness.registered).toEqual([]);
        expect(harness.editor.document.some((node) => node.kind === "stable")).toBe(false);
        harness.dispose();
    });

    it("稳定 Markdown 通过一次 batch resolve 补齐 metadata，重复节点按实际 block 计费", async () => {
        const item = attachment("9", "same.png", 128);
        mocks.resolve.mockResolvedValue({items: [item]});
        const harness = createHarness(`前![一](${item.target})![二](${item.target})后`);
        const nodes: ComposerImageNode[] = [
            {kind: "stable", index: 0, label: "一", target: item.target},
            {kind: "stable", index: 1, label: "二", target: item.target},
        ];

        harness.editor.document = nodes;
        harness.controller.applyDocument(nodes);
        await flushPromises();

        expect(mocks.resolve).toHaveBeenCalledWith(1, [item.attachment.attachmentId]);
        expect(harness.editor.hydrated).toEqual([expect.objectContaining({attachmentId: item.attachment.attachmentId, bytes: 128})]);
        expect(harness.controller.usage.value).toMatchObject({count: 2, totalBytes: 256, unresolvedStable: 0});
        harness.dispose();
    });

    it("metadata 失败后停止自动重试，并允许用户显式重新校验", async () => {
        const item = attachment("8", "retry.png", 64);
        mocks.resolve
            .mockRejectedValueOnce(new Error("temporary failure"))
            .mockResolvedValueOnce({items: [item]});
        const harness = createHarness(`![图](${item.target})`);
        const nodes: ComposerImageNode[] = [{kind: "stable", index: 0, label: "图", target: item.target}];

        harness.editor.document = nodes;
        harness.controller.applyDocument(nodes);
        await flushPromises();
        expect(harness.controller.metadataError.value).toContain("temporary failure");
        expect(mocks.resolve).toHaveBeenCalledTimes(1);

        harness.controller.applyDocument(nodes);
        await flushPromises();
        expect(mocks.resolve).toHaveBeenCalledTimes(1);

        harness.controller.retryMetadata();
        await flushPromises();
        expect(mocks.resolve).toHaveBeenCalledTimes(2);
        expect(harness.controller.metadataError.value).toBe("");
        expect(harness.editor.hydrated).toEqual([expect.objectContaining({attachmentId: item.attachment.attachmentId})]);
        harness.dispose();
    });

    it("非图片 Attachment 不能绕过面板插入 Composer 图片节点", () => {
        const harness = createHarness();
        const textAttachment: AgentSessionAttachmentItemDto = {
            ...attachment("7", "notes.html"),
            attachment: {
                ...attachment("7", "notes.html").attachment,
                mimeType: "text/html",
            },
        };

        harness.controller.insertAttachment(textAttachment);

        expect(harness.editor.document).toEqual([]);
        expect(mocks.warning).toHaveBeenCalledTimes(1);
        harness.dispose();
    });

    it("允许浏览器未声明 MIME 的文件进入服务端裁决，但拒绝具体非图片 MIME", () => {
        mocks.upload.mockImplementation(async (_sessionId, file) => attachment("6", file.name));
        const harness = createHarness();
        const unspecified = new File([new Uint8Array(8)], "unknown.png", {type: ""});
        const transportPlaceholder = new File([new Uint8Array(8)], "placeholder.png", {type: "application/octet-stream"});
        const text = new File([new Uint8Array(8)], "notes.txt", {type: "text/plain"});

        harness.controller.queueFiles({files: [unspecified, transportPlaceholder]});
        expect(mocks.upload.mock.calls.map((call) => call[1].name)).toEqual(["unknown.png", "placeholder.png"]);

        harness.controller.queueFiles({files: [text]});
        expect(mocks.upload).toHaveBeenCalledTimes(2);
        expect(mocks.warning).toHaveBeenCalledTimes(1);
        harness.dispose();
    });
});

/** 构造隔离 controller、响应式 Session ID 与同步 TipTap 端口。 */
function createHarness(initialValue = "") {
    const scope = effectScope();
    const sessionId = ref(1);
    const registered: AgentSessionAttachmentItemDto[] = [];
    let controller!: ReturnType<typeof useComposerImageTransaction>;
    const editor = new FakeEditor((nodes) => controller.applyDocument(nodes));
    scope.run(() => {
        controller = useComposerImageTransaction({
            editor: () => editor,
            sessionId: () => sessionId.value,
            value: () => initialValue,
            sessionAttachments: () => [],
            canRegister: () => true,
            canInsert: () => true,
            blockedReason: () => "blocked",
            unsupportedAttachmentMessage: () => "unsupported attachment",
            projectRoot: () => "book",
            onAttachmentRegistered: (item) => registered.push(item),
        });
    });
    return {controller, editor, sessionId, registered, dispose: () => scope.stop()};
}

class FakeEditor implements ComposerImageEditorPort {
    document: ComposerImageNode[] = [];
    hydrated: PlainImageNodeAttrs[] = [];

    constructor(private readonly emitDocument: (nodes: ComposerImageNode[]) => void) {}

    insertImage(image: PlainImageNodeAttrs): void {
        this.document.push(stableNode(image, this.document.length));
        this.emit();
    }

    insertPendingImages(items: Array<{uploadId: string; name: string}>): void {
        this.document.push(...items.map((item, index): ComposerImageNode => ({
            kind: "pending",
            index: this.document.length + index,
            uploadId: item.uploadId,
            name: item.name,
            status: "uploading",
        })));
        this.emit();
    }

    replacePendingImage(uploadId: string, image: PlainImageNodeAttrs): void {
        this.document = this.document.map((node, index) => node.kind === "pending" && node.uploadId === uploadId
            ? stableNode(image, index)
            : {...node, index});
        this.emit();
    }

    failPendingImage(uploadId: string, error: string): void {
        this.document = this.document.map((node) => node.kind === "pending" && node.uploadId === uploadId
            ? {...node, status: "failed", error}
            : node);
        this.emit();
    }

    startPendingImage(uploadId: string): void {
        this.document = this.document.map((node) => node.kind === "pending" && node.uploadId === uploadId
            ? {...node, status: "uploading", error: undefined}
            : node);
        this.emit();
    }

    removePendingImage(uploadId: string): void {
        this.document = this.document
            .filter((node) => node.kind !== "pending" || node.uploadId !== uploadId)
            .map((node, index) => ({...node, index}));
        this.emit();
    }

    hydrateImages(items: readonly PlainImageNodeAttrs[]): void {
        this.hydrated = [...items];
        const before = JSON.stringify(this.document);
        const byTarget = new Map(items.map((item) => [item.target, item]));
        this.document = this.document.map((node, index) => node.kind === "stable" && byTarget.has(node.target)
            ? stableNode(byTarget.get(node.target)!, index)
            : node);
        if (JSON.stringify(this.document) !== before) {
            this.emit();
        }
    }

    /** 模拟 TipTap transaction 同步发布最新图片投影。 */
    private emit(): void {
        this.emitDocument(this.document.map((node) => ({...node})));
    }
}

/** 把稳定 attrs 投影成 controller 文档节点。 */
function stableNode(image: PlainImageNodeAttrs, index: number): ComposerImageNode {
    return {
        kind: "stable",
        index,
        label: image.label,
        target: image.target,
        ...(image.attachmentId ? {attachmentId: image.attachmentId} : {}),
        ...(image.mimeType ? {mimeType: image.mimeType} : {}),
        ...(image.bytes === undefined ? {} : {bytes: image.bytes}),
    };
}

/** 创建不读取二进制内容的浏览器 File fixture。 */
function imageFile(name: string, bytes = 16): File {
    return new File([new Uint8Array(bytes)], name, {type: "image/png"});
}

/** 创建 canonical Session Attachment fixture。 */
function attachment(seed: string, name: string, bytes = 16): AgentSessionAttachmentItemDto {
    const hex = seed.repeat(64).slice(0, 64);
    const attachmentId = `sha256:${hex}` as const;
    return {
        attachment: {attachmentId, mimeType: "image/png", bytes, name, dataOmitted: true},
        target: `workspace/.nbook/agent/attachments/sha256/${hex.slice(0, 2)}/${hex.slice(2)}`,
        locator: {entryId: `entry-${seed}`, contentIndex: 0},
        firstSeenAt: 1,
        lastSeenAt: 1,
        referenceCount: 1,
    };
}

type Deferred<T> = {
    promise: Promise<T>;
    resolve(value: T): void;
};

/** 构造可控制响应顺序的 Promise。 */
function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return {promise, resolve};
}

/** 冲刷 async continuation 与 Vue watcher。 */
async function flushPromises(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await nextTick();
    await Promise.resolve();
}
