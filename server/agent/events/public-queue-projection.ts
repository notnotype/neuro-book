import type {JsonValue} from "nbook/server/agent/messages/types";
import type {StoredAgentUserMessageInput} from "nbook/server/agent/messages/stored-types";
import type {AgentInvokeCaller, AgentMessageIdentity} from "nbook/server/agent/harness/invocation-caller";
import type {AgentQueuedMessageDto, AgentQueuedMessageListDto} from "nbook/shared/dto/agent-session.dto";
import {
    budgetText,
    createPublicProjectionBudget,
    type PublicProjectionBudget,
    valuePreviewWithBudget,
} from "nbook/server/agent/events/public-tool-projection";

const PUBLIC_QUEUE_ITEMS = 64;
const PUBLIC_QUEUE_TEXT_BYTES = 64 * 1024;
const PUBLIC_QUEUE_ITEM_BYTES = 8 * 1024;
const PUBLIC_QUEUE_IMAGES = 8;

/** Harness 内部队列真相；图片和 payload 只在执行路径中使用。 */
export type AgentQueuedInvocationTruth = {
    id: string;
    clientMessageId: string;
    kind: "steer" | "followup";
    message?: StoredAgentUserMessageInput;
    input?: JsonValue;
    /** 仅供后续 invocation 执行；公共 queue DTO 不暴露运行时模型覆盖。 */
    modelKey?: string;
    /** 内部保留原始调用方；公共 queue DTO 不暴露该字段。 */
    caller?: AgentInvokeCaller;
    /** 内部 durable message 身份；公共 queue DTO 不暴露该字段。 */
    messageIdentity?: AgentMessageIdentity;
    createdAt: number;
};

/** 投影单个 queue delta event。 */
export function projectQueuedMessage(
    item: AgentQueuedInvocationTruth,
    budget: PublicProjectionBudget = createPublicProjectionBudget(PUBLIC_QUEUE_ITEM_BYTES),
): AgentQueuedMessageDto {
    const content = item.message?.content ?? [];
    const text = content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("");
    const images = content.filter((block) => block.type === "attachment");
    return {
        id: item.id,
        clientMessageId: item.clientMessageId,
        kind: item.kind,
        ...(text ? {text: budgetText(text, budget, 2 * 1024)} : {}),
        images: images.slice(0, PUBLIC_QUEUE_IMAGES).map((image) => ({
            mimeType: budgetText(image.attachment.mimeType, budget, 256).preview || "application/octet-stream",
            dataBytes: image.attachment.bytes,
            dataOmitted: true as const,
        })),
        omittedImages: Math.max(0, images.length - PUBLIC_QUEUE_IMAGES),
        ...(item.input === undefined ? {} : {input: valuePreviewWithBudget(item.input, budget)}),
        createdAt: item.createdAt,
    };
}

/** recovery 只公开最早 64 项，并让全部 item 共用 64 KiB 文本预算。 */
export function projectQueuedMessages(items: AgentQueuedInvocationTruth[]): AgentQueuedMessageListDto {
    const visible = items.slice(0, PUBLIC_QUEUE_ITEMS);
    const budget = createPublicProjectionBudget(PUBLIC_QUEUE_TEXT_BYTES);
    return {
        items: visible.map((item) => projectQueuedMessage(item, budget)),
        omittedItems: Math.max(0, items.length - visible.length),
    };
}
