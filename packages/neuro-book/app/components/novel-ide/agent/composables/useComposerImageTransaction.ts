import {computed, onScopeDispose, ref, watch} from "vue";
import type {AgentSessionAttachmentItemDto} from "nbook/shared/dto/agent-session.dto";
import type {
    AgentTriggerMenuContext,
    AgentTriggerMenuItem,
    AgentTriggerMenuState,
} from "nbook/app/components/novel-ide/agent/trigger-menu";
import type {PlainImageNodeAttrs} from "nbook/app/utils/plain-reference-text";
import {
    composerImageUsage,
    pendingImageIds,
    type ComposerImageNode,
} from "nbook/app/components/novel-ide/agent/composer-image-transaction";
import {useAgentSessionApi} from "nbook/app/composables/useAgentSessionApi";
import {useNotification} from "nbook/app/composables/useNotification";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import {AGENT_IMAGE_POLICY} from "nbook/shared/agent/agent-image-policy";
import {attachmentIdFromMarkdownTarget, parseAgentImageMarkdown} from "nbook/shared/agent/agent-image-markdown";
import {completeProjectFileAddress} from "nbook/app/components/novel-ide/agent/agent-composer-reference";
import {canonicalImageMime, isUnspecifiedImageMime} from "nbook/shared/media/raster-image";

/** 图片 transaction 操作的最小编辑器端口；主 Composer 与历史编辑器共用。 */
export type ComposerImageEditorPort = {
    insertImage(image: PlainImageNodeAttrs, position?: number): void;
    insertPendingImages(items: Array<{uploadId: string; name: string}>, position?: number): void;
    replacePendingImage(uploadId: string, image: PlainImageNodeAttrs): void;
    failPendingImage(uploadId: string, error: string): void;
    startPendingImage(uploadId: string): void;
    removePendingImage(uploadId: string): void;
    hydrateImages(items: readonly PlainImageNodeAttrs[]): void;
};

type PendingImageRequest = {
    id: string;
    sessionId: number;
    generation: number;
    name: string;
    kind: "upload" | "snapshot";
    file?: File;
    sourcePath?: string;
    status: "queued" | "uploading" | "failed" | "completed";
    controller?: AbortController;
    result?: AgentSessionAttachmentItemDto;
};

export type ComposerImageTransactionOptions = {
    editor: () => ComposerImageEditorPort | null;
    sessionId: () => number | null;
    value: () => string;
    sessionAttachments: () => readonly AgentSessionAttachmentItemDto[];
    canRegister: () => boolean;
    canInsert: () => boolean;
    blockedReason: () => string;
    /** 非图片 Attachment 从其它入口传入时显示的本地化提示。 */
    unsupportedAttachmentMessage: () => string;
    projectRoot: () => string | null;
    onAttachmentRegistered?: (item: AgentSessionAttachmentItemDto) => void;
};

/**
 * 管理 Composer 图片上传生命周期。
 *
 * 编辑器文档是图片存在性和顺序的唯一真相；registry 仅保存 File、请求、结果与失败状态。
 */
export function useComposerImageTransaction(options: ComposerImageTransactionOptions) {
    const agentApi = useAgentSessionApi();
    const notification = useNotification();
    const transactions = ref<PendingImageRequest[]>([]);
    const imageDocument = ref<ComposerImageNode[]>(readStableImages(options.value()));
    const resolvedItems = ref<AgentSessionAttachmentItemDto[]>([]);
    const metadataError = ref("");
    const generation = ref(0);
    const attachmentMenuItems = ref<AgentSessionAttachmentItemDto[]>([]);
    const attachmentMenuRevision = ref(0);
    let metadataRequestId = 0;
    let metadataRequestKey = "";
    let metadataFailureKey = "";
    let attachmentMenuRequestId = 0;
    let attachmentMenuRequestKey = "";
    let attachmentMenuLoadedKey = "";

    const stableImages = computed(() => imageDocument.value
        .filter((node): node is Extract<ComposerImageNode, {kind: "stable"}> => node.kind === "stable"));
    const pendingImages = computed(() => imageDocument.value
        .filter((node): node is Extract<ComposerImageNode, {kind: "pending"}> => node.kind === "pending"));
    const pendingBytes = computed(() => new Map(transactions.value.flatMap((record) => record.file
        ? [[record.id, record.file.size] as const]
        : [])));
    const usage = computed(() => composerImageUsage(imageDocument.value, pendingBytes.value));
    const failed = computed(() => pendingImages.value.some((node) => node.status === "failed"));
    const canRegister = computed(() => Boolean(options.sessionId() && options.canRegister()));
    const canInsert = computed(() => Boolean(options.sessionId() && options.canInsert()));
    const budgetError = computed(() => {
        if (usage.value.count > AGENT_IMAGE_POLICY.maxInputImages) {
            return `单条消息最多引用 ${String(AGENT_IMAGE_POLICY.maxInputImages)} 张图片。`;
        }
        if (usage.value.totalBytes > AGENT_IMAGE_POLICY.maxInputBytes) {
            return "单条消息引用的图片合计不能超过 32 MiB。";
        }
        return "";
    });
    const menuRefreshKey = computed(() => [
        options.sessionId() ?? 0,
        options.sessionAttachments().length,
        options.sessionAttachments()[0]?.lastSeenAt ?? 0,
        attachmentMenuRevision.value,
    ].join(":"));

    /** 文件选择、粘贴和拖拽统一插入有序 pending 节点。 */
    function queueFiles(payload: {files: File[]; position?: number}): void {
        const sessionId = options.sessionId();
        if (!canRegister.value || !sessionId || payload.files.length === 0) {
            notifyBlocked();
            return;
        }
        const files = payload.files.filter((file) => (
            isUnspecifiedImageMime(file.type) || canonicalImageMime(file.type) !== null
        ));
        if (files.length !== payload.files.length) {
            notification.warning("仅支持 PNG、JPEG、GIF 和 WebP 图片。", {title: "图片格式不支持"});
            return;
        }
        if (usage.value.count + files.length > AGENT_IMAGE_POLICY.maxInputImages) {
            notification.warning(`单条消息最多引用 ${String(AGENT_IMAGE_POLICY.maxInputImages)} 张图片。`, {title: "图片数量超限"});
            return;
        }
        if (files.some((file) => file.size > AGENT_IMAGE_POLICY.maxImageBytes)) {
            notification.warning("单张图片不能超过 16 MiB。", {title: "图片过大"});
            return;
        }
        const totalBytes = files.reduce((total, file) => total + file.size, usage.value.totalBytes);
        if (totalBytes > AGENT_IMAGE_POLICY.maxInputBytes) {
            notification.warning("本次选择的图片合计不能超过 32 MiB。", {title: "图片总量超限"});
            return;
        }
        const records = files.map((file): PendingImageRequest => ({
            id: globalThis.crypto.randomUUID(),
            sessionId,
            generation: generation.value,
            name: file.name || "图片",
            kind: "upload",
            file,
            status: "queued",
        }));
        transactions.value = [...transactions.value, ...records];
        options.editor()?.insertPendingImages(records.map((record) => ({uploadId: record.id, name: record.name})), payload.position);
        pump();
    }

    /** Project File Address 或绝对路径图片先插入 pending 节点，再创建稳定快照。 */
    function queueSnapshot(sourcePath: string, name: string, position?: number): void {
        const sessionId = options.sessionId();
        if (!canRegister.value || !sessionId) {
            notifyBlocked();
            return;
        }
        if (usage.value.count >= AGENT_IMAGE_POLICY.maxInputImages) {
            notification.warning(`单条消息最多引用 ${String(AGENT_IMAGE_POLICY.maxInputImages)} 张图片。`, {title: "图片数量超限"});
            return;
        }
        const record: PendingImageRequest = {
            id: globalThis.crypto.randomUUID(),
            sessionId,
            generation: generation.value,
            name,
            kind: "snapshot",
            sourcePath,
            status: "queued",
        };
        transactions.value = [...transactions.value, record];
        options.editor()?.insertPendingImages([{uploadId: record.id, name}], position);
        pump();
    }

    /** Session 面板重新插入稳定附件，不产生新的登记 entry。 */
    function insertAttachment(item: AgentSessionAttachmentItemDto, position?: number): void {
        if (!canonicalImageMime(item.attachment.mimeType)) {
            notification.warning(options.unsupportedAttachmentMessage());
            return;
        }
        if (!canInsert.value) {
            notifyBlocked();
            return;
        }
        if (usage.value.count >= AGENT_IMAGE_POLICY.maxInputImages) {
            notification.warning(`单条消息最多引用 ${String(AGENT_IMAGE_POLICY.maxInputImages)} 张图片。`, {title: "图片数量超限"});
            return;
        }
        if (usage.value.totalBytes + item.attachment.bytes > AGENT_IMAGE_POLICY.maxInputBytes) {
            notification.warning("单条消息引用的图片合计不能超过 32 MiB。", {title: "图片总量超限"});
            return;
        }
        remember(item);
        options.editor()?.insertImage(attachmentAttrs(item), position);
    }

    /** TipTap 文档变化后同步节点存在性、Undo 恢复和 metadata hydration。 */
    function applyDocument(nodes: ComposerImageNode[]): void {
        imageDocument.value = nodes;
        const present = pendingImageIds(nodes);
        for (const record of transactions.value) {
            if (record.generation !== generation.value) {
                continue;
            }
            if (!present.has(record.id)) {
                if (record.status === "uploading") {
                    record.status = "queued";
                    record.controller?.abort();
                    record.controller = undefined;
                }
                continue;
            }
            if (record.status === "completed" && record.result) {
                options.editor()?.replacePendingImage(record.id, attachmentAttrs(record.result, record.name));
            }
        }
        for (const node of nodes) {
            if (node.kind === "pending"
                && !transactions.value.some((record) => record.generation === generation.value && record.id === node.uploadId)) {
                options.editor()?.failPendingImage(node.uploadId, "临时图片上下文已失效，请移除后重新上传");
            }
        }
        hydrateKnown();
        void resolveMetadata(nodes);
        pump();
    }

    /** 失败节点重新进入最多两个并发请求的队列。 */
    function retry(uploadId: string): void {
        const record = transactions.value.find((current) => current.id === uploadId);
        if (!record || record.status !== "failed" || options.sessionId() !== record.sessionId) {
            return;
        }
        record.status = "queued";
        options.editor()?.startPendingImage(uploadId);
        pump();
    }

    /** 删除 pending 节点会中止请求；保留 File/完成结果供同代次 Undo 恢复。 */
    function remove(uploadId: string): void {
        const record = transactions.value.find((current) => current.id === uploadId);
        record?.controller?.abort();
        if (record && record.status !== "completed") {
            record.status = "queued";
            record.controller = undefined;
        }
        options.editor()?.removePendingImage(uploadId);
        pump();
    }

    /** 以统一 Session Attachment 与 Project 图片语义扩展 `@` 引用菜单。 */
    function decorateMenu(context: AgentTriggerMenuContext, state: AgentTriggerMenuState): AgentTriggerMenuState {
        if (context.kind !== "reference-root") {
            return state;
        }
        const query = context.query.trim().toLocaleLowerCase("zh-CN");
        const key = attachmentSearchKey(context.query);
        requestAttachmentMenu(context.query, key);
        const seen = new Set<string>();
        const sessionItems = [
            ...options.sessionAttachments(),
            ...(attachmentMenuLoadedKey === key ? attachmentMenuItems.value : []),
        ]
            .filter((item) => !query || [item.attachment.name, item.attachment.mimeType, item.attachment.attachmentId]
                .some((value) => value?.toLocaleLowerCase("zh-CN").includes(query)))
            .filter((item) => {
                if (seen.has(item.attachment.attachmentId)) return false;
                seen.add(item.attachment.attachmentId);
                return true;
            })
            .slice(0, 20)
            .map((item): AgentTriggerMenuItem => ({
                id: `session-attachment:${item.attachment.attachmentId}`,
                label: item.attachment.name || item.attachment.attachmentId.slice(0, 18),
                description: `${item.attachment.mimeType} · ${formatBytes(item.attachment.bytes)}`,
                iconClass: "i-lucide-image",
                hint: "Session",
                disabled: !canInsert.value,
                action: ({position}) => insertAttachment(item, position),
            }));
        const absolutePath = absoluteImageQuery(context.query);
        const absoluteItems: AgentTriggerMenuItem[] = absolutePath ? [{
            id: `absolute-image:${absolutePath}`,
            label: imageName(absolutePath),
            description: "快照绝对路径图片到当前 Session",
            iconClass: "i-lucide-camera",
            disabled: !canRegister.value,
            action: ({position}) => queueSnapshot(absolutePath, imageName(absolutePath), position),
        }] : [];
        const workspaceSections = state.sections
            .map((section) => ({...section, items: section.items.map(normalizeReferenceItem)}))
            .filter((section) => section.items.length > 0
                && (section.id !== "empty-reference" || (sessionItems.length === 0 && absoluteItems.length === 0)));
        return {
            ...state,
            sections: [
                ...(absoluteItems.length > 0 ? [{id: "absolute-image", title: "绝对路径图片", items: absoluteItems}] : []),
                ...(sessionItems.length > 0 ? [{id: "session-attachments", title: "Session 附件", items: sessionItems}] : []),
                ...workspaceSections,
            ],
        };
    }

    /** 取消当前代次全部请求，并让编辑器按新 generation 重建。 */
    function reset(): void {
        generation.value += 1;
        metadataRequestId += 1;
        metadataRequestKey = "";
        metadataFailureKey = "";
        metadataError.value = "";
        transactions.value.forEach((record) => record.controller?.abort());
        transactions.value = [];
        imageDocument.value = readStableImages(options.value());
        resolvedItems.value = [];
        resetAttachmentMenu();
    }

    /** 明确提示 paste/drop/按钮为什么不可用。 */
    function notifyBlocked(): void {
        notification.warning(options.blockedReason() || "当前 Session 不能上传或插入图片。", {title: "图片操作不可用"});
    }

    /** 最多启动两个仍存在于文档中的 pending 请求。 */
    function pump(): void {
        const present = pendingImageIds(imageDocument.value);
        const activeCount = transactions.value.filter((record) => record.status === "uploading").length;
        transactions.value
            .filter((record) => record.generation === generation.value
                && record.status === "queued"
                && present.has(record.id))
            .slice(0, Math.max(0, 2 - activeCount))
            .forEach((record) => {
                record.status = "uploading";
                void run(record);
            });
    }

    /** 执行单个 upload/snapshot，并只按 transaction ID 原位替换节点。 */
    async function run(record: PendingImageRequest): Promise<void> {
        const controller = new AbortController();
        record.controller = controller;
        try {
            const item = record.kind === "upload" && record.file
                ? await agentApi.uploadSessionAttachment(record.sessionId, record.file, controller.signal)
                : record.kind === "snapshot" && record.sourcePath
                    ? await agentApi.snapshotSessionAttachment(record.sessionId, {
                        sourcePath: record.sourcePath,
                        name: record.name,
                    }, controller.signal)
                    : null;
            if (!item
                || controller.signal.aborted
                || record.generation !== generation.value
                || options.sessionId() !== record.sessionId
                || !transactions.value.some((current) => current.id === record.id)) {
                return;
            }
            record.status = "completed";
            record.result = item;
            remember(item);
            if (pendingImageIds(imageDocument.value).has(record.id)) {
                options.editor()?.replacePendingImage(record.id, attachmentAttrs(item, record.name));
            }
            options.onAttachmentRegistered?.(item);
        } catch (error) {
            if (controller.signal.aborted || record.generation !== generation.value) {
                return;
            }
            record.status = "failed";
            const message = resolveApiErrorMessage(error, "图片上传失败");
            options.editor()?.failPendingImage(record.id, message);
            notification.error(message, {title: record.kind === "snapshot" ? "图片快照失败" : "图片上传失败"});
        } finally {
            if (record.controller === controller) {
                record.controller = undefined;
            }
            pump();
        }
    }

    /** 草稿与历史 Markdown 中的稳定 ID 一次批量补齐 canonical metadata。 */
    async function resolveMetadata(nodes: readonly ComposerImageNode[]): Promise<void> {
        const sessionId = options.sessionId();
        if (!sessionId) return;
        const knownIds = new Set([...options.sessionAttachments(), ...resolvedItems.value]
            .map((item) => item.attachment.attachmentId));
        const ids = [...new Set(nodes.flatMap((node) => {
            if (node.kind !== "stable" || node.bytes !== undefined) return [];
            const id = attachmentIdFromMarkdownTarget(node.target);
            return id && !knownIds.has(id) ? [id] : [];
        }))].slice(0, AGENT_IMAGE_POLICY.maxInputImages);
        if (ids.length === 0) {
            metadataFailureKey = "";
            metadataError.value = "";
            return;
        }
        const key = `${String(sessionId)}:${String(generation.value)}:${ids.join(",")}`;
        if (key === metadataRequestKey || key === metadataFailureKey) return;
        metadataRequestKey = key;
        metadataError.value = "";
        const requestId = ++metadataRequestId;
        try {
            const resolved = await agentApi.resolveSessionAttachments(sessionId, ids);
            if (requestId !== metadataRequestId || sessionId !== options.sessionId() || key !== metadataRequestKey) return;
            resolvedItems.value = mergeItems(resolvedItems.value, resolved.items);
            metadataFailureKey = "";
            hydrateKnown();
        } catch (error) {
            if (requestId === metadataRequestId && sessionId === options.sessionId() && key === metadataRequestKey) {
                metadataFailureKey = key;
                metadataError.value = resolveApiErrorMessage(error, "校验 Session 图片失败");
                notification.error(metadataError.value, {title: "图片引用无效"});
            }
        } finally {
            if (requestId === metadataRequestId && key === metadataRequestKey) {
                metadataRequestKey = "";
            }
        }
    }

    /** 用户显式重试当前文档的 canonical metadata 批量解析。 */
    function retryMetadata(): void {
        metadataFailureKey = "";
        metadataError.value = "";
        void resolveMetadata(imageDocument.value);
    }

    /** 用已知 canonical metadata 补齐编辑器稳定图片 attrs。 */
    function hydrateKnown(): void {
        options.editor()?.hydrateImages(mergeItems(options.sessionAttachments(), resolvedItems.value).map((item) => attachmentAttrs(item)));
    }

    /** 保存本控制器刚解析或登记的附件。 */
    function remember(item: AgentSessionAttachmentItemDto): void {
        resolvedItems.value = mergeItems(resolvedItems.value, [item]);
    }

    /** `@` 菜单按 query 拉取当前 Session 全分支附件。 */
    function requestAttachmentMenu(query: string, key: string): void {
        const sessionId = options.sessionId();
        if (!sessionId || key === attachmentMenuRequestKey || key === attachmentMenuLoadedKey) return;
        const requestId = ++attachmentMenuRequestId;
        attachmentMenuRequestKey = key;
        void agentApi.getSessionAttachments(sessionId, {search: query.trim() || undefined, offset: 0, limit: 20})
            .then((page) => {
                if (requestId !== attachmentMenuRequestId || options.sessionId() !== sessionId) return;
                attachmentMenuItems.value = page.items;
                attachmentMenuLoadedKey = key;
                attachmentMenuRevision.value += 1;
            })
            .catch(() => {
                if (requestId !== attachmentMenuRequestId || options.sessionId() !== sessionId) return;
                attachmentMenuItems.value = [];
                attachmentMenuLoadedKey = key;
                attachmentMenuRevision.value += 1;
            })
            .finally(() => {
                if (requestId === attachmentMenuRequestId) attachmentMenuRequestKey = "";
            });
    }

    /** Project 图片引用改为 snapshot action；非图片仍只规范化 Project File Address。 */
    function normalizeReferenceItem(item: AgentTriggerMenuItem): AgentTriggerMenuItem {
        if (!item.workspaceReference) return item;
        const target = completeProjectFileAddress(item.workspaceReference.target, options.projectRoot());
        if (!isImagePath(target)) return {...item, workspaceReference: {...item.workspaceReference, target}};
        const {workspaceReference: _workspaceReference, ...rest} = item;
        return {
            ...rest,
            action: ({position}) => queueSnapshot(target, item.label, position),
            disabled: item.disabled || !canRegister.value,
            iconClass: "i-lucide-camera",
            description: item.description ? `${item.description} · 插入时创建稳定快照` : "插入时创建稳定快照",
        };
    }

    /** 清除 `@` 附件菜单缓存。 */
    function resetAttachmentMenu(): void {
        attachmentMenuRequestId += 1;
        attachmentMenuRequestKey = "";
        attachmentMenuLoadedKey = "";
        attachmentMenuItems.value = [];
        attachmentMenuRevision.value += 1;
    }

    /** 生成带 Session 边界的附件菜单搜索缓存键。 */
    function attachmentSearchKey(query: string): string {
        return `${String(options.sessionId() ?? 0)}:${query.trim().toLocaleLowerCase("zh-CN")}`;
    }

    watch(() => options.sessionId(), reset);
    watch(() => options.sessionAttachments(), hydrateKnown, {deep: true});
    onScopeDispose(reset);

    return {
        generation,
        imageDocument,
        stableImages,
        pendingImages,
        usage,
        failed,
        metadataError,
        budgetError,
        canRegister,
        canInsert,
        menuRefreshKey,
        queueFiles,
        queueSnapshot,
        insertAttachment,
        applyDocument,
        retry,
        retryMetadata,
        remove,
        decorateMenu,
        reset,
        notifyBlocked,
        resolvedItems,
    };
}

/** 将 Session Attachment DTO 转成稳定 TipTap 图片 attrs。 */
export function attachmentAttrs(item: AgentSessionAttachmentItemDto, fallbackName = "图片"): PlainImageNodeAttrs {
    return {
        label: item.attachment.name || fallbackName,
        target: item.target,
        attachmentId: item.attachment.attachmentId,
        mimeType: item.attachment.mimeType,
        bytes: item.attachment.bytes,
        ...(item.attachment.name ? {name: item.attachment.name} : {}),
        locatorEntryId: item.locator.entryId,
        locatorContentIndex: item.locator.contentIndex,
    };
}

/** 从外部 Markdown 边界读取稳定图片节点，保留正文中的出现顺序。 */
function readStableImages(value: string): ComposerImageNode[] {
    return parseAgentImageMarkdown(value).flatMap((part, index) => part.type === "image"
        ? [{kind: "stable" as const, index, label: part.label || "图片", target: part.target}]
        : []);
}

/** 按 Attachment ID 合并权威 DTO；新响应覆盖旧 metadata。 */
function mergeItems(current: readonly AgentSessionAttachmentItemDto[], incoming: readonly AgentSessionAttachmentItemDto[]): AgentSessionAttachmentItemDto[] {
    const byId = new Map(current.map((item) => [item.attachment.attachmentId, item]));
    for (const item of incoming) byId.set(item.attachment.attachmentId, item);
    return [...byId.values()];
}

/** 从 `@` 查询中识别可快照的绝对图片路径。 */
function absoluteImageQuery(query: string): string | null {
    const value = query.trim();
    const unwrapped = value.startsWith("<") && value.endsWith(">") ? value.slice(1, -1).trim() : value;
    return /^(?:[A-Za-z]:\/|\/\/|\/)/u.test(unwrapped) && isImagePath(unwrapped) ? unwrapped : null;
}

/** 判断路径后缀是否属于本轮支持的图片类型。 */
function isImagePath(path: string): boolean {
    return /\.(?:png|jpe?g|gif|webp)$/iu.test(path.trim());
}

/** 从 Windows 或 POSIX 路径中提取图片展示名。 */
function imageName(path: string): string {
    return path.replaceAll("\\", "/").split("/").at(-1)?.trim() || "图片";
}

/** 将图片字节数格式化成适合 Composer 提示的单位。 */
function formatBytes(bytes: number): string {
    return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
