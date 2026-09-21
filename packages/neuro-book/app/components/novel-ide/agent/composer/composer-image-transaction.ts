/** Composer TipTap 文档中的稳定图片投影。 */
export type ComposerStableImage = {
    kind: "stable";
    index: number;
    label: string;
    target: string;
    attachmentId?: string;
    mimeType?: string;
    bytes?: number;
    name?: string;
    locatorEntryId?: string;
    locatorContentIndex?: number;
};

/** Composer TipTap 文档中的临时上传节点投影。 */
export type ComposerPendingImage = {
    kind: "pending";
    index: number;
    uploadId: string;
    name: string;
    status: "uploading" | "failed";
    error?: string;
};

/** 编辑器文档是图片存在性与顺序的唯一真相。 */
export type ComposerImageNode = ComposerStableImage | ComposerPendingImage;

export type ComposerImageUsage = {
    count: number;
    totalBytes: number;
    unresolvedStable: number;
    pendingWithoutFile: number;
};

/** 按当前文档计算图片数量和字节；重复节点按实际 block 重复计费。 */
export function composerImageUsage(
    nodes: readonly ComposerImageNode[],
    pendingBytes: ReadonlyMap<string, number>,
): ComposerImageUsage {
    let totalBytes = 0;
    let unresolvedStable = 0;
    let pendingWithoutFile = 0;
    for (const node of nodes) {
        if (node.kind === "stable") {
            if (typeof node.bytes === "number" && Number.isFinite(node.bytes) && node.bytes >= 0) {
                totalBytes += node.bytes;
            } else {
                unresolvedStable += 1;
            }
            continue;
        }
        const bytes = pendingBytes.get(node.uploadId);
        if (bytes === undefined) {
            pendingWithoutFile += 1;
        } else {
            totalBytes += bytes;
        }
    }
    return {
        count: nodes.length,
        totalBytes,
        unresolvedStable,
        pendingWithoutFile,
    };
}

/** 当前仍存在于文档中的 pending transaction ID。 */
export function pendingImageIds(nodes: readonly ComposerImageNode[]): Set<string> {
    return new Set(nodes.flatMap((node) => node.kind === "pending" ? [node.uploadId] : []));
}

/** 存在 pending 图片、未解决 metadata、metadataError 或超预算时阻止发送。 */
export function isComposerImageSubmissionBlocked(input: {
    pendingCount: number;
    unresolvedStable: number;
    metadataError: boolean;
    budgetError: boolean;
}): boolean {
    return input.pendingCount > 0
        || input.unresolvedStable > 0
        || input.metadataError
        || input.budgetError;
}

