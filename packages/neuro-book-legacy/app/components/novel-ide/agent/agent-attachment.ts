import type {AgentChatAttachmentDto, PublicAttachmentDto} from "nbook/shared/dto/agent-public-event.dto";

/** Chat Flow 可展示的附件定位信息。contentIndex 必须保持 stored content 的原始索引。 */
export type AgentAttachmentDisplay = {
    /** 消息中的保序位置；durable 消息同时也是默认读取 locator。 */
    contentIndex: number;
    attachment: PublicAttachmentDto;
    /** 乐观消息可复用 session_attachment 登记 entry 读取图片。 */
    locator?: {
        entryId: string;
        contentIndex: number;
    };
};

export type AgentAttachmentPreset = "attachment-chat" | "attachment-grid";

export type AgentAttachmentUrlResolver = (input: {
    sessionId: number | null;
    entryId: string | null;
    contentIndex: number;
    preset?: AgentAttachmentPreset;
    retry: number;
}) => string | null;

/** 将 durable entry 的附件 locator 转成受 session/entry/content index 约束的读取地址。 */
export const agentAttachmentUrl = (
    sessionId: number | null | undefined,
    entryId: string | null | undefined,
    contentIndex: number,
    preset?: AgentAttachmentPreset,
): string | null => {
    if (
        sessionId === null
        || sessionId === undefined
        || !Number.isSafeInteger(sessionId)
        || !entryId
        || !Number.isSafeInteger(contentIndex)
        || contentIndex < 0
    ) {
        return null;
    }
    const base = `/api/agent/sessions/${encodeURIComponent(String(sessionId))}/entries/${encodeURIComponent(entryId)}/attachments/${String(contentIndex)}`;
    return preset ? `${base}?${new URLSearchParams({preset}).toString()}` : base;
};

/** 复制公开附件 locator，避免前端在消息状态中保留服务端 DTO 的可变引用。 */
export const copyAgentAttachments = (attachments: AgentChatAttachmentDto[] | undefined): AgentAttachmentDisplay[] => {
    return (attachments ?? []).map((item) => ({
        contentIndex: item.contentIndex,
        attachment: {...item.attachment},
    }));
};
