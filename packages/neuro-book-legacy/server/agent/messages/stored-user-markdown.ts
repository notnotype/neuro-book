import type {JsonValue} from "nbook/server/agent/messages/types";
import type {
    StoredAgentUserMessageInput,
    StoredContent,
    StoredUserMessage,
} from "nbook/server/agent/messages/stored-types";
import {attachmentMarkdownTarget, serializeAgentImageMarkdown} from "nbook/shared/agent/agent-image-markdown";

const USER_STEER_PREFIX = "<user_steer>\n";
const USER_STEER_SUFFIX = "\n</user_steer>";

/** 保留 stored contentIndex 的用户可见内容块。 */
export type IndexedStoredUserContent = {
    contentIndex: number;
    block: StoredContent;
};

/** 将 admission 后的有序正文重建为 Composer 使用的 Markdown。 */
export function storedInputMarkdown(input: StoredAgentUserMessageInput | undefined): string | undefined {
    return input ? serializeStoredContent(input.content) : undefined;
}

/** 将 durable 用户消息按原 contentIndex 顺序重建为完整 Markdown。 */
export function storedUserMessageMarkdown(message: StoredUserMessage, intent: "normal" | "steer"): string {
    return visibleStoredUserContent(message, intent).blocks
        .map(({block}) => serializeStoredBlock(block))
        .join("");
}

/** payload 始终追加在当前有序正文末尾，图片位置不会被重新分组。 */
export function appendInvocationPayload(content: readonly StoredContent[], payload: JsonValue | undefined): StoredContent[] {
    const result = content.map(copyStoredContent);
    if (payload === undefined) {
        return result;
    }
    const payloadText = `<payload>\n${JSON.stringify(payload, null, 2)}\n</payload>`;
    result.push({
        type: "text",
        text: `${result.length > 0 ? "\n\n" : ""}${payloadText}`,
    });
    return result;
}

/** steer 用首尾文本 envelope 包裹有序正文，不移动中间 attachment。 */
export function wrapStoredSteerContent(content: readonly StoredContent[]): StoredContent[] {
    return [
        {type: "text", text: USER_STEER_PREFIX},
        ...content.map(copyStoredContent),
        {type: "text", text: USER_STEER_SUFFIX},
    ];
}

/**
 * 返回公开/复制使用的用户可见 blocks。
 *
 * 只移除首尾 envelope 文本，保留中间 block 的原 contentIndex。旧字符串与正文
 * intent 猜测只存在于一次性 Session migration，不进入 runtime。
 */
export function visibleStoredUserContent(message: StoredUserMessage, intent: "normal" | "steer"): {
    blocks: IndexedStoredUserContent[];
} {
    const indexed = message.content.map((block, contentIndex) => ({
        contentIndex,
        block: copyStoredContent(block),
    }));
    const first = indexed[0];
    const last = indexed.at(-1);
    if (intent !== "steer") {
        return {blocks: indexed};
    }
    if (first?.block.type !== "text"
        || last?.block.type !== "text"
        || !first.block.text.startsWith(USER_STEER_PREFIX)
        || !last.block.text.endsWith(USER_STEER_SUFFIX)) {
        throw new Error("Steer 用户消息缺少 Provider envelope");
    }

    first.block.text = first.block.text.slice(USER_STEER_PREFIX.length);
    last.block.text = last.block.text.slice(0, -USER_STEER_SUFFIX.length);
    return {
        blocks: indexed.filter(({block}) => block.type !== "text" || block.text.length > 0),
    };
}

/** 将有序 stored blocks 序列化为 Markdown，不自动插入分隔符。 */
export function serializeStoredContent(content: readonly StoredContent[]): string {
    return content.map(serializeStoredBlock).join("");
}

function serializeStoredBlock(block: StoredContent): string {
    if (block.type === "text") {
        return block.text;
    }
    return serializeAgentImageMarkdown(
        block.name?.trim() || "图片",
        attachmentMarkdownTarget(block.attachment.id),
    );
}

function copyStoredContent(block: StoredContent): StoredContent {
    if (block.type === "text") {
        return {
            type: "text",
            text: block.text,
            ...(block.textSignature === undefined ? {} : {textSignature: block.textSignature}),
        };
    }
    return {
        type: "attachment",
        attachment: {...block.attachment},
        ...(block.name === undefined ? {} : {name: block.name}),
    };
}
