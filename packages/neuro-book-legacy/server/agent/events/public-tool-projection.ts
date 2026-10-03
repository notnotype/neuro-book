import {
    LIVE_TOOL_PREVIEW_BYTES,
    PUBLIC_EDIT_MAX_ITEMS,
    PUBLIC_PATCH_MAX_FILES,
    PUBLIC_PATCH_PATHS_BYTES,
    PUBLIC_PATH_MAX_BYTES,
    PUBLIC_TOOL_ARGS_TEXT_BYTES,
    PUBLIC_TOOL_RESULT_CONTENT_BYTES,
    PUBLIC_TOOL_RESULT_DETAILS_BYTES,
    PUBLIC_TOOL_RESULT_MAX_BLOCKS,
    PUBLIC_TOOL_NAME_BYTES,
    PUBLIC_VALUE_MAX_DEPTH,
    PUBLIC_VALUE_MAX_ENTRIES,
    PUBLIC_VALUE_MAX_ITEMS,
    PUBLIC_VALUE_MAX_NODES,
} from "nbook/server/agent/events/public-event-policy";
import type {
    PublicAttachmentDto,
    PublicTextPreviewDto,
    PublicToolArgsDto,
    PublicToolContentDto,
    PublicToolResultDetailsDto,
    PublicToolResultDto,
    PublicValuePreviewDto,
} from "nbook/shared/dto/agent-public-event.dto";

/**
 * 对工具参数做中央公开投影。unknown 只存在于不可信工具输入边界。
 */
export function projectPublicToolArgs(
    toolName: string,
    args: unknown,
    budget: ValuePreviewBudget = createPublicProjectionBudget(PUBLIC_TOOL_ARGS_TEXT_BYTES),
): PublicToolArgsDto {
    if (toolName === "write") {
        const record = objectValue(args);
        const content = typeof record?.content === "string" ? record.content : "";
        const path = typeof record?.path === "string" ? budgetText(record.path, budget, PUBLIC_PATH_MAX_BYTES) : undefined;
        const preview = budgetText(content, budget, LIVE_TOOL_PREVIEW_BYTES);
        return {
            kind: "write",
            ...(path ? {path: path.preview} : {}),
            contentPreview: preview.preview,
            contentBytes: preview.bytes,
            contentOmitted: preview.omitted,
        };
    }
    if (toolName === "edit") {
        const record = objectValue(args);
        const edits = Array.isArray(record?.edits)
            ? record.edits.slice(0, PUBLIC_EDIT_MAX_ITEMS)
            : [];
        const path = typeof record?.path === "string" ? budgetText(record.path, budget, PUBLIC_PATH_MAX_BYTES) : undefined;
        const previewBytes = Math.max(1, Math.floor(Math.min(LIVE_TOOL_PREVIEW_BYTES, budget.remainingTextBytes) / Math.max(2, edits.length * 2)));
        return {
            kind: "edit",
            ...(path ? {path: path.preview} : {}),
            edits: edits.map((edit) => {
                const item = objectValue(edit);
                const oldText = typeof item?.oldText === "string" ? item.oldText : "";
                const newText = typeof item?.newText === "string" ? item.newText : "";
                const oldPreview = budgetText(oldText, budget, previewBytes);
                const newPreview = budgetText(newText, budget, previewBytes);
                return {
                    oldTextPreview: oldPreview.preview,
                    oldTextBytes: oldPreview.bytes,
                    oldTextOmitted: oldPreview.omitted,
                    newTextPreview: newPreview.preview,
                    newTextBytes: newPreview.bytes,
                    newTextOmitted: newPreview.omitted,
                };
            }),
            omittedEdits: Math.max(0, (Array.isArray(record?.edits) ? record.edits.length : 0) - edits.length),
        };
    }
    if (toolName === "apply_patch") {
        const record = objectValue(args);
        const patch = typeof record?.patch === "string" ? record.patch : "";
        const preview = budgetText(patch, budget, LIVE_TOOL_PREVIEW_BYTES);
        const touchedFiles = patchTouchedFiles(patch, budget);
        return {
            kind: "apply_patch",
            patchPreview: preview.preview,
            patchBytes: preview.bytes,
            patchOmitted: preview.omitted,
            touchedFiles: touchedFiles.files,
            touchedFilesOmitted: touchedFiles.omitted,
        };
    }
    return {
        kind: "generic",
        value: valuePreviewInternal(args, budget, 0, new WeakSet<object>()),
    };
}

/**
 * 对工具结果做中央公开投影，图片 data 永远不跨公开边界。
 */
export function projectPublicToolResult(_toolName: string, result: unknown): PublicToolResultDto {
    const record = objectValue(result);
    const rawContent = Array.isArray(record?.content) ? record.content : [];
    let remainingPreviewBytes = PUBLIC_TOOL_RESULT_CONTENT_BYTES;
    const detailsBudget: ValuePreviewBudget = {
        remainingTextBytes: PUBLIC_TOOL_RESULT_DETAILS_BYTES,
        remainingNodes: PUBLIC_VALUE_MAX_NODES,
    };
    const content = rawContent
        .slice(0, PUBLIC_TOOL_RESULT_MAX_BLOCKS)
        .map((block, contentIndex) => {
            const projected = projectToolContent(block, contentIndex, remainingPreviewBytes);
            if (projected?.type === "text") {
                remainingPreviewBytes = Math.max(0, remainingPreviewBytes - Buffer.byteLength(projected.textPreview, "utf8"));
            }
            return projected;
        })
        .filter((item): item is PublicToolContentDto => item !== null);
    return {
        content,
        omittedContentBlocks: Math.max(0, rawContent.length - PUBLIC_TOOL_RESULT_MAX_BLOCKS),
        ...(record && "details" in record && record.details !== undefined
            ? {details: projectResultDetails(_toolName, record.details, detailsBudget)}
            : {}),
    };
}

/**
 * 判断公开工具参数是否已经省略原文。
 */
export function publicToolArgsOmitted(args: PublicToolArgsDto): boolean {
    if (args.kind === "write") {
        return args.contentOmitted;
    }
    if (args.kind === "edit") {
        return args.omittedEdits > 0 || args.edits.some((edit) => edit.oldTextOmitted || edit.newTextOmitted);
    }
    if (args.kind === "apply_patch") {
        return args.patchOmitted || args.touchedFilesOmitted;
    }
    return valuePreviewOmitted(args.value);
}

/**
 * 按 UTF-8 字节数截取公开预览，避免多字节字符被截成无效序列。
 */
export function textPreview(value: string, maxBytes: number): PublicTextPreviewDto {
    const bytes = Buffer.byteLength(value, "utf8");
    if (bytes <= maxBytes) {
        return {
            preview: value,
            bytes,
            omitted: false,
        };
    }
    let low = 0;
    let high = Math.min(value.length, Math.max(0, maxBytes));
    while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (Buffer.byteLength(value.slice(0, middle), "utf8") <= maxBytes) {
            low = middle;
        } else {
            high = middle - 1;
        }
    }
    let preview = value.slice(0, low);
    const lastCodeUnit = preview.charCodeAt(preview.length - 1);
    if (lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff) {
        preview = preview.slice(0, -1);
    }
    return {
        preview,
        bytes,
        omitted: true,
    };
}

/** 将工具名称投影为所有公开工具卡共用的有界文本。 */
export function projectPublicToolName(value: string): string {
    return textPreview(value, PUBLIC_TOOL_NAME_BYTES).preview;
}

/**
 * 在遍历时限制深度与集合大小；不会先 stringify 整个未知对象。
 */
export function valuePreview(value: unknown): PublicValuePreviewDto {
    return valuePreviewInternal(value, {
        remainingTextBytes: LIVE_TOOL_PREVIEW_BYTES,
        remainingNodes: PUBLIC_VALUE_MAX_NODES,
    }, 0, new WeakSet<object>());
}

/** 使用调用方共享预算投影未知公开值。 */
export function valuePreviewWithBudget(value: unknown, budget: PublicProjectionBudget): PublicValuePreviewDto {
    return valuePreviewInternal(value, budget, 0, new WeakSet<object>());
}

export type PublicProjectionBudget = {
    remainingTextBytes: number;
    remainingNodes: number;
};

type ValuePreviewBudget = PublicProjectionBudget;

/** 创建一个只在单次公开投影内使用的共享预算。 */
export function createPublicProjectionBudget(textBytes: number, nodes = PUBLIC_VALUE_MAX_NODES): PublicProjectionBudget {
    return {remainingTextBytes: Math.max(0, textBytes), remainingNodes: Math.max(0, nodes)};
}

function valuePreviewInternal(
    value: unknown,
    budget: ValuePreviewBudget,
    depth: number,
    seen: WeakSet<object>,
): PublicValuePreviewDto {
    if (budget.remainingNodes <= 0) {
        return {kind: "unsupported", valueType: "max_nodes"};
    }
    budget.remainingNodes -= 1;
    if (value === null) {
        return {kind: "null"};
    }
    if (typeof value === "boolean") {
        return {kind: "boolean", value};
    }
    if (typeof value === "number" && Number.isFinite(value)) {
        return {kind: "number", value};
    }
    if (typeof value === "string") {
        const preview = textPreview(value, Math.min(LIVE_TOOL_PREVIEW_BYTES, budget.remainingTextBytes));
        budget.remainingTextBytes = Math.max(0, budget.remainingTextBytes - Buffer.byteLength(preview.preview, "utf8"));
        return {
            kind: "string",
            preview: preview.preview,
            bytes: preview.bytes,
            omitted: preview.omitted,
        };
    }
    if (typeof value !== "object") {
        return {kind: "unsupported", valueType: typeof value};
    }
    if (seen.has(value)) {
        return {kind: "unsupported", valueType: "circular"};
    }
    if (depth >= PUBLIC_VALUE_MAX_DEPTH) {
        return {kind: "unsupported", valueType: "max_depth"};
    }
    seen.add(value);
    try {
        if (Array.isArray(value)) {
            const visible = value.slice(0, PUBLIC_VALUE_MAX_ITEMS);
            return {
                kind: "array",
                items: visible.map((item) => valuePreviewInternal(item, budget, depth + 1, seen)),
                omittedItems: Math.max(0, value.length - visible.length),
            };
        }
        const visible: Array<[string, unknown]> = [];
        let omittedEntries = 0;
        for (const key in value) {
            if (!Object.prototype.hasOwnProperty.call(value, key)) {
                continue;
            }
            if (visible.length >= PUBLIC_VALUE_MAX_ENTRIES) {
                omittedEntries = 1;
                break;
            }
            visible.push([textPreview(key, 256).preview, (value as Record<string, unknown>)[key]]);
        }
        return {
            kind: "object",
            entries: visible.map(([key, item]) => ({
                key,
                value: valuePreviewInternal(item, budget, depth + 1, seen),
            })),
            omittedEntries,
        };
    } finally {
        seen.delete(value);
    }
}

/**
 * 仅接受普通对象读取；工具参数不是对象时返回 null。
 */
function objectValue(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

/**
 * 投影单个工具 content block。
 */
function projectToolContent(value: unknown, contentIndex: number, previewBytes: number): PublicToolContentDto | null {
    const block = objectValue(value);
    if (block?.type === "text" && typeof block.text === "string") {
        const preview = textPreview(block.text, Math.max(0, previewBytes));
        return {
            type: "text",
            contentIndex,
            textPreview: preview.preview,
            textBytes: preview.bytes,
            textOmitted: preview.omitted,
        };
    }
    if (block?.type === "image" && typeof block.data === "string") {
        return {
            type: "image",
            contentIndex,
            mimeType: typeof block.mimeType === "string"
                ? textPreview(block.mimeType, 256).preview
                : "application/octet-stream",
            dataBytes: base64DecodedBytes(block.data),
            dataOmitted: true,
        };
    }
    if (block?.type === "attachment") {
        const attachment = projectPublicAttachment(block.attachment, block.name);
        return attachment ? {type: "attachment", contentIndex, attachment} : null;
    }
    return null;
}

/**
 * 将 stored AttachmentRef 投影为公开 metadata；无效引用不会跨公开边界。
 */
export function projectPublicAttachment(value: unknown, name?: unknown): PublicAttachmentDto | null {
    const attachment = objectValue(value);
    if (
        typeof attachment?.id !== "string"
        || !/^sha256:[0-9a-f]{64}$/.test(attachment.id)
        || typeof attachment.mimeType !== "string"
        || attachment.mimeType.length === 0
        || !Number.isSafeInteger(attachment.bytes)
        || Number(attachment.bytes) < 0
    ) {
        return null;
    }
    const publicName = typeof name === "string" && name.length > 0
        ? textPreview(name, 1024).preview
        : undefined;
    return {
        attachmentId: attachment.id as PublicAttachmentDto["attachmentId"],
        mimeType: textPreview(attachment.mimeType, 256).preview,
        bytes: Number(attachment.bytes),
        ...(publicName ? {name: publicName} : {}),
        dataOmitted: true,
    };
}

/** 工具卡已知 details 走强类型投影；其他工具只能进入有界 generic preview。 */
function projectResultDetails(toolName: string, value: unknown, budget: ValuePreviewBudget): PublicToolResultDetailsDto {
    const details = objectValue(value);
    if (toolName === "request_user_input" && details && Array.isArray(details.answers)) {
        const answers = details.answers.slice(0, 32).flatMap((answer) => {
            const item = objectValue(answer);
            if (!item) return [];
            const text = typeof item.text === "string" ? budgetText(item.text, budget) : undefined;
            const note = typeof item.note === "string" ? budgetText(item.note, budget) : undefined;
            return [{
                ...(finiteInteger(item.questionIndex) === undefined ? {} : {questionIndex: finiteInteger(item.questionIndex)}),
                ...(text ? {text: text.preview, ...(text.omitted ? {textOmitted: true} : {})} : {}),
                ...(finiteInteger(item.selectedOptionIndex) === undefined ? {} : {selectedOptionIndex: finiteInteger(item.selectedOptionIndex)}),
                ...(note ? {note: note.preview, ...(note.omitted ? {noteOmitted: true} : {})} : {}),
                ...(typeof item.ignored === "boolean" ? {ignored: item.ignored} : {}),
            }];
        });
        return {
            kind: "request_user_input",
            answers,
            omittedAnswers: Math.max(0, details.answers.length - answers.length),
        };
    }
    if (toolName === "switch_mode" && details) {
        return {
            kind: "switch_mode",
            ...(typeof details.approved === "boolean" ? {approved: details.approved} : {}),
            ...(typeof details.pending === "boolean" ? {pending: details.pending} : {}),
            ...(typeof details.targetMode === "string" ? {targetMode: budgetText(details.targetMode, budget, 128).preview} : {}),
        };
    }
    if (toolName === "task_create" || toolName === "task_set_status") {
        return {kind: "task", value: valuePreviewInternal(value, budget, 0, new WeakSet<object>())};
    }
    if (toolName === "create_agent" || toolName === "invoke_agent" || toolName === "get_agent" || toolName === "get_session" || toolName === "detach_agent") {
        return {
            kind: "agent",
            ...(finiteInteger(details?.sessionId) === undefined ? {} : {sessionId: finiteInteger(details?.sessionId)}),
            ...(typeof details?.profileKey === "string" ? {profileKey: budgetText(details.profileKey, budget, 256).preview} : {}),
            ...(typeof details?.status === "string" ? {status: budgetText(details.status, budget, 128).preview} : {}),
            value: valuePreviewInternal(value, budget, 0, new WeakSet<object>()),
        };
    }
    if ((toolName === "edit" || toolName === "apply_patch") && typeof details?.diff === "string") {
        const rawFiles = Array.isArray(details.files) ? details.files : [];
        const files = rawFiles.slice(0, PUBLIC_PATCH_MAX_FILES).flatMap((item) => {
            if (typeof item === "string") {
                return [budgetText(item, budget, PUBLIC_PATH_MAX_BYTES).preview];
            }
            const record = objectValue(item);
            return typeof record?.path === "string"
                ? [budgetText(record.path, budget, PUBLIC_PATH_MAX_BYTES).preview]
                : [];
        });
        const diff = budgetText(details.diff, budget);
        return {
            kind: "file_change",
            diffPreview: diff.preview,
            diffBytes: diff.bytes,
            diffOmitted: diff.omitted,
            ...(finiteInteger(details.firstChangedLine) !== undefined ? {firstChangedLine: finiteInteger(details.firstChangedLine)} : {}),
            files,
            filesOmitted: rawFiles.length > PUBLIC_PATCH_MAX_FILES,
        };
    }
    if (toolName === "read" && details) {
        return {
            kind: "read",
            ...(typeof details.path === "string" ? {path: budgetText(details.path, budget, PUBLIC_PATH_MAX_BYTES).preview} : {}),
            ...(finiteInteger(details.startLine) !== undefined ? {startLine: finiteInteger(details.startLine)} : {}),
            ...(finiteInteger(details.endLine) !== undefined ? {endLine: finiteInteger(details.endLine)} : {}),
            ...(finiteInteger(details.totalLines) !== undefined ? {totalLines: finiteInteger(details.totalLines)} : {}),
            ...(finiteInteger(details.nextOffset) !== undefined ? {nextOffset: finiteInteger(details.nextOffset)} : {}),
        };
    }
    if (toolName === "bash" && details) {
        const truncation = objectValue(details.truncation);
        const fullOutput = objectValue(details.fullOutput);
        const fullOutputState = fullOutput?.state === "available"
            || fullOutput?.state === "partial"
            || fullOutput?.state === "reclaimed"
            ? fullOutput.state
            : undefined;
        const truncatedBy = truncation?.truncatedBy === "bytes" || truncation?.truncatedBy === "lines"
            ? truncation.truncatedBy
            : undefined;
        return {
            kind: "bash",
            truncated: truncation?.truncated === true,
            ...(truncatedBy ? {truncatedBy} : {}),
            ...(finiteInteger(truncation?.totalLines) !== undefined ? {totalLines: finiteInteger(truncation?.totalLines)} : {}),
            ...(finiteInteger(truncation?.totalBytes) !== undefined ? {totalBytes: finiteInteger(truncation?.totalBytes)} : {}),
            ...(fullOutputState ? {
                fullOutput: {
                    state: fullOutputState,
                    ...(fullOutputState !== "reclaimed" && typeof fullOutput?.locator === "string"
                        ? {locator: budgetText(fullOutput.locator, budget, PUBLIC_PATH_MAX_BYTES).preview}
                        : {}),
                },
            } : {}),
        };
    }
    return {
        kind: "generic",
        value: valuePreviewInternal(value, budget, 0, new WeakSet<object>()),
    };
}

/** 从共享 details 预算中提取一段 UTF-8 安全的文本预览。 */
export function budgetText(value: string, budget: PublicProjectionBudget, maxBytes = budget.remainingTextBytes): PublicTextPreviewDto {
    const preview = textPreview(value, Math.max(0, Math.min(maxBytes, budget.remainingTextBytes)));
    budget.remainingTextBytes = Math.max(0, budget.remainingTextBytes - Buffer.byteLength(preview.preview, "utf8"));
    return preview;
}

function finiteInteger(value: unknown): number | undefined {
    return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
}

/**
 * 只根据 base64 字符数计算解码后字节数，避免为公开投影再分配完整二进制 Buffer。
 */
function base64DecodedBytes(value: string): number {
    const length = value.length;
    if (length === 0) {
        return 0;
    }
    const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
    return Math.max(0, Math.floor(length * 3 / 4) - padding);
}

/**
 * 判断未知结构预览是否省略了任何内容。
 */
function valuePreviewOmitted(value: PublicValuePreviewDto): boolean {
    if (value.kind === "string") {
        return value.omitted;
    }
    if (value.kind === "array") {
        return value.omittedItems > 0 || value.items.some(valuePreviewOmitted);
    }
    if (value.kind === "object") {
        return value.omittedEntries > 0 || value.entries.some((entry) => valuePreviewOmitted(entry.value));
    }
    return value.kind === "unsupported";
}

/**
 * 从 Codex patch header 提取有界文件路径列表。
 */
function patchTouchedFiles(patch: string, parentBudget: PublicProjectionBudget): {files: string[]; omitted: boolean} {
    const files: string[] = [];
    const budget = createPublicProjectionBudget(Math.min(PUBLIC_PATCH_PATHS_BYTES, parentBudget.remainingTextBytes));
    const pattern = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm;
    let match: RegExpExecArray | null;
    let omitted = false;
    while ((match = pattern.exec(patch)) !== null) {
        if (files.length >= PUBLIC_PATCH_MAX_FILES) {
            omitted = true;
            break;
        }
        const path = budgetText(match[1]?.trim() ?? "", budget, PUBLIC_PATH_MAX_BYTES);
        if (path.preview && !files.includes(path.preview)) {
            files.push(path.preview);
        }
        if (path.omitted || budget.remainingTextBytes === 0) {
            omitted = true;
            if (budget.remainingTextBytes === 0) break;
        }
    }
    parentBudget.remainingTextBytes = Math.max(0, parentBudget.remainingTextBytes - (Math.min(PUBLIC_PATCH_PATHS_BYTES, parentBudget.remainingTextBytes) - budget.remainingTextBytes));
    return {files, omitted};
}
