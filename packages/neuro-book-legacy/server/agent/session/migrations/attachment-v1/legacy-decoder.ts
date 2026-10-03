import {createHash} from "node:crypto";
import {basename} from "node:path";
import {canonicalImageMime, imageMimeType} from "nbook/server/agent/attachments/agent-attachment-codec";
import {parseFollowUpQueue, parseStoredMessage} from "nbook/server/agent/messages/stored-message-codec";
import {migrateSessionUserIdentityText} from "nbook/server/agent/session/session-user-identity-migration";
import type {AttachmentRef} from "nbook/shared/dto/agent-attachment.dto";
import type {AttachmentSessionPlan, DecodedAttachment} from "nbook/server/agent/session/migrations/attachment-v1/types";

const ATTACHMENT_ID_PATTERN = /^sha256:[0-9a-f]{64}$/;
const FOLLOW_UP_QUEUE_KEY = "agent.followUpQueue";

type JsonNode = null | boolean | number | string | JsonNode[] | JsonObject;
type JsonObject = {[key: string]: JsonNode};

/**
 * 解析并迁移一个历史 JSONL。该 decoder 只位于 scripts 目录，runtime 不导入旧格式。
 */
export function decodeLegacySession(input: {sourcePath: string; text: string}): AttachmentSessionPlan {
    const trailingNewline = input.text.endsWith("\n");
    const lines = input.text.split(/\r?\n/).filter((line, index, values) => line.length > 0 || index < values.length - 1);
    if (lines.length === 0) {
        throw new Error(`${input.sourcePath}: session JSONL 为空`);
    }

    const attachments = new Map<string, DecodedAttachment>();
    const referenced = new Map<string, AttachmentRef>();
    let images = 0;
    let bytes = 0;
    let changed = false;
    let sessionId: number | null = numericSessionId(input.sourcePath);
    const records = lines.map((line, index) => {
        let parsed: JsonNode;
        try {
            // JSON.parse 是一次性迁移工具的外部不可信边界；后续只通过 JsonNode 守卫访问。
            parsed = JSON.parse(line) as JsonNode;
        } catch (error) {
            throw new Error(`${input.sourcePath}:${String(index + 1)} JSON 无法解析：${errorMessage(error)}`);
        }
        if (!isObject(parsed)) {
            throw new Error(`${input.sourcePath}:${String(index + 1)} record 必须是对象`);
        }
        if (parsed.kind === "header") {
            const metadata = objectValue(parsed.metadata);
            if (typeof metadata?.sessionId === "number" && Number.isSafeInteger(metadata.sessionId)) {
                sessionId = metadata.sessionId;
            }
        }
        let result: ReturnType<typeof migrateRecord>;
        try {
            result = migrateRecord(parsed, attachments, referenced);
        } catch (error) {
            throw new Error(`${input.sourcePath}:${String(index + 1)} ${errorMessage(error)}`);
        }
        images += result.images;
        bytes += result.bytes;
        changed ||= result.changed;
        return result.record;
    });

    const attachmentTargetText = changed
        ? `${records.map((record) => JSON.stringify(record)).join("\n")}${trailingNewline ? "\n" : ""}`
        : input.text;
    const identityMigration = migrateSessionUserIdentityText(attachmentTargetText);
    changed ||= identityMigration.changed;
    const targetText = identityMigration.text;
    const targetRecords = targetText.split(/\r?\n/u).filter(Boolean).map((line) => {
        const record = JSON.parse(line) as JsonNode;
        if (!isObject(record)) {
            throw new Error(`${input.sourcePath}: 迁移后 record 必须是对象`);
        }
        return record;
    });
    validateStoredRecords(targetRecords, input.sourcePath);
    return {
        sessionId,
        sourcePath: input.sourcePath,
        sourceText: input.text,
        targetText,
        sourceHash: sha256(input.text),
        targetHash: sha256(targetText),
        images,
        bytes,
        changed,
        attachments: [...attachments.values()],
        referencedAttachments: [...referenced.values()],
    };
}

/** 收集 session 中已经引用的 Attachment，供 full scan/hydration readiness 校验。 */
export function collectStoredAttachmentRefs(text: string, sourcePath: string): AttachmentRef[] {
    return decodeLegacySession({sourcePath, text}).referencedAttachments;
}

function migrateRecord(
    record: JsonObject,
    attachments: Map<string, DecodedAttachment>,
    referenced: Map<string, AttachmentRef>,
): {record: JsonObject; images: number; bytes: number; changed: boolean} {
    let images = 0;
    let bytes = 0;
    let changed = false;
    for (const entry of recordEntries(record)) {
        if (entry.type === "message" || entry.type === "custom_message") {
            const message = objectValue(entry.message);
            if (message) {
                const result = migrateMessageContent(message, attachments, referenced);
                images += result.images;
                bytes += result.bytes;
                changed ||= result.changed;
            }
        }
        if (entry.type === "custom" && entry.key === FOLLOW_UP_QUEUE_KEY) {
            const result = migrateFollowUpQueue(entry.value, attachments, referenced);
            images += result.images;
            bytes += result.bytes;
            changed ||= result.changed;
        }
    }
    return {record, images, bytes, changed};
}

function migrateMessageContent(
    message: JsonObject,
    attachments: Map<string, DecodedAttachment>,
    referenced: Map<string, AttachmentRef>,
): {images: number; bytes: number; changed: boolean} {
    if (!Array.isArray(message.content)) {
        return {images: 0, bytes: 0, changed: false};
    }
    let images = 0;
    let bytes = 0;
    let changed = false;
    message.content = message.content.map((block) => {
        const object = objectValue(block);
        if (!object) {
            return block;
        }
        if (object.type === "attachment") {
            rememberStoredAttachment(object, referenced);
            return block;
        }
        if (object.type !== "image" || typeof object.data !== "string") {
            return block;
        }
        const decoded = decodeImage(object.data, typeof object.mimeType === "string" ? object.mimeType : undefined);
        attachments.set(decoded.ref.id, decoded);
        referenced.set(decoded.ref.id, decoded.ref);
        images += 1;
        bytes += decoded.bytes.byteLength;
        changed = true;
        return storedBlock(decoded.ref, typeof object.name === "string" ? object.name : undefined);
    });
    return {images, bytes, changed};
}

function migrateFollowUpQueue(
    value: JsonNode | undefined,
    attachments: Map<string, DecodedAttachment>,
    referenced: Map<string, AttachmentRef>,
): {images: number; bytes: number; changed: boolean} {
    const queue = objectValue(value);
    if (!queue || !Array.isArray(queue.items)) {
        return {images: 0, bytes: 0, changed: false};
    }
    let images = 0;
    let bytes = 0;
    let changed = false;
    for (const itemValue of queue.items) {
        const item = objectValue(itemValue);
        const message = objectValue(item?.message);
        if (!message) {
            continue;
        }
        const existing = Array.isArray(message.attachments) ? message.attachments : [];
        for (const block of existing) {
            const object = objectValue(block);
            if (object?.type === "attachment") {
                rememberStoredAttachment(object, referenced);
            }
        }
        if (!Array.isArray(message.images) || message.images.length === 0) {
            continue;
        }
        const migrated = message.images.map((imageValue) => {
            const image = objectValue(imageValue);
            if (!image || typeof image.data !== "string") {
                throw new Error("follow-up queue 包含无法识别的旧图片");
            }
            const decoded = decodeImage(image.data, typeof image.mimeType === "string" ? image.mimeType : undefined);
            attachments.set(decoded.ref.id, decoded);
            referenced.set(decoded.ref.id, decoded.ref);
            images += 1;
            bytes += decoded.bytes.byteLength;
            return storedBlock(decoded.ref, typeof image.name === "string" ? image.name : undefined);
        });
        message.attachments = [...existing, ...migrated];
        delete message.images;
        changed = true;
    }
    return {images, bytes, changed};
}

function decodeImage(data: string, declaredMime?: string): DecodedAttachment {
    const trimmed = data.trim();
    const parsed = splitImageData(trimmed);
    const encoded = parsed.encoded;
    if (!isStrictBase64(encoded)) {
        throw new Error("旧图片 base64 格式无效");
    }
    const dataUrlMime = parsed.mimeType;
    const declared = declaredMime ? canonicalImageMime(declaredMime) : null;
    const fromUrl = dataUrlMime ? canonicalImageMime(dataUrlMime) : null;
    if ((declaredMime && !declared) || (dataUrlMime && !fromUrl) || (declared && fromUrl && declared !== fromUrl)) {
        throw new Error("旧图片 MIME 声明无效或互相冲突");
    }
    const bytes = Buffer.from(encoded, "base64");
    const detected = imageMimeType(bytes);
    if (!detected || (declared && declared !== detected) || (fromUrl && fromUrl !== detected)) {
        throw new Error("旧图片 MIME 与文件魔数不一致");
    }
    const hash = sha256(bytes);
    return {
        ref: {
            id: `sha256:${hash}`,
            mimeType: detected,
            bytes: bytes.byteLength,
        },
        bytes,
    };
}

/** 避免对数 MiB base64 使用整串正则，data URL 只解析短 header。 */
function splitImageData(value: string): {encoded: string; mimeType?: string} {
    if (!value.startsWith("data:")) {
        return {encoded: value};
    }
    const comma = value.indexOf(",");
    if (comma <= "data:".length) {
        return {encoded: ""};
    }
    const header = value.slice("data:".length, comma);
    if (!header.endsWith(";base64") || header.includes(",")) {
        return {encoded: ""};
    }
    return {
        encoded: value.slice(comma + 1),
        mimeType: header.slice(0, -";base64".length),
    };
}

/** 严格校验 base64 字符和尾部 padding，不依赖可能受输入长度限制的 RegExp。 */
function isStrictBase64(value: string): boolean {
    if (!value || value.length % 4 !== 0) {
        return false;
    }
    const firstPadding = value.indexOf("=");
    const contentEnd = firstPadding < 0 ? value.length : firstPadding;
    if (firstPadding >= 0) {
        const padding = value.length - firstPadding;
        if ((padding !== 1 && padding !== 2) || !value.slice(firstPadding).split("").every((char) => char === "=")) {
            return false;
        }
    }
    for (let index = 0; index < contentEnd; index += 1) {
        const code = value.charCodeAt(index);
        const valid = (code >= 0x41 && code <= 0x5a)
            || (code >= 0x61 && code <= 0x7a)
            || (code >= 0x30 && code <= 0x39)
            || code === 0x2b
            || code === 0x2f;
        if (!valid) {
            return false;
        }
    }
    return true;
}

function rememberStoredAttachment(block: JsonObject, refs: Map<string, AttachmentRef>): void {
    const attachment = objectValue(block.attachment);
    if (!attachment
        || typeof attachment.id !== "string"
        || !ATTACHMENT_ID_PATTERN.test(attachment.id)
        || typeof attachment.mimeType !== "string"
        || typeof attachment.bytes !== "number"
        || !Number.isSafeInteger(attachment.bytes)
        || attachment.bytes < 0) {
        throw new Error("Stored Attachment 引用格式无效");
    }
    const ref: AttachmentRef = {
        id: attachment.id as AttachmentRef["id"],
        mimeType: attachment.mimeType,
        bytes: attachment.bytes,
    };
    refs.set(ref.id, ref);
}

function storedBlock(ref: AttachmentRef, name?: string): JsonObject {
    return {
        type: "attachment",
        attachment: {
            id: ref.id,
            mimeType: ref.mimeType,
            bytes: ref.bytes,
        },
        ...(name ? {name} : {}),
    };
}

function recordEntries(record: JsonObject): JsonObject[] {
    if (record.kind === "entry") {
        const entry = objectValue(record.entry);
        return entry ? [entry] : [];
    }
    if (record.kind === "batch" && Array.isArray(record.entries)) {
        return record.entries.flatMap((entry) => {
            const object = objectValue(entry);
            return object ? [object] : [];
        });
    }
    return [];
}

function validateStoredRecords(records: JsonObject[], sourcePath: string): void {
    for (const record of records) {
        for (const entry of recordEntries(record)) {
            if (entry.type === "message" || entry.type === "custom_message") {
                try {
                    parseStoredMessage(entry.message);
                } catch (error) {
                    throw new Error(`${sourcePath}: 迁移后 stored message 无效：${errorMessage(error)}`);
                }
            }
            if (entry.type === "custom" && entry.key === FOLLOW_UP_QUEUE_KEY) {
                try {
                    parseFollowUpQueue(entry.value);
                } catch (error) {
                    throw new Error(`${sourcePath}: 迁移后 follow-up queue 无效：${errorMessage(error)}`);
                }
            }
        }
    }
}

function numericSessionId(path: string): number | null {
    const value = Number(basename(path, ".jsonl"));
    return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function sha256(value: string | Uint8Array): string {
    return createHash("sha256").update(value).digest("hex");
}

function objectValue(value: JsonNode | undefined): JsonObject | null {
    return isObject(value) ? value : null;
}

function isObject(value: JsonNode | undefined): value is JsonObject {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
