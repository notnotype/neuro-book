

/**
 * 公开字符串预览。preview 是唯一公开正文；bytes 表示原始 UTF-8 大小。
 */
export type PublicTextPreviewDto = {
    preview: string;
    bytes: number;
    omitted: boolean;
};

/**
 * 未知工具值的有界结构预览。
 */
export type PublicValuePreviewDto =
    | {kind: "null"}
    | {kind: "boolean"; value: boolean}
    | {kind: "number"; value: number}
    | {kind: "string"; preview: string; bytes: number; omitted: boolean}
    | {kind: "array"; items: PublicValuePreviewDto[]; omittedItems: number}
    | {kind: "object"; entries: Array<{key: string; value: PublicValuePreviewDto}>; omittedEntries: number}
    | {kind: "unsupported"; valueType: string};

export type PublicWriteToolArgsDto = {
    kind: "write";
    path?: string;
    contentPreview: string;
    contentBytes: number;
    contentOmitted: boolean;
};

export type PublicEditToolArgsDto = {
    kind: "edit";
    path?: string;
    edits: Array<{
        oldTextPreview: string;
        oldTextBytes: number;
        oldTextOmitted: boolean;
        newTextPreview: string;
        newTextBytes: number;
        newTextOmitted: boolean;
    }>;
    omittedEdits: number;
};

export type PublicApplyPatchToolArgsDto = {
    kind: "apply_patch";
    patchPreview: string;
    patchBytes: number;
    patchOmitted: boolean;
    touchedFiles: string[];
    touchedFilesOmitted: boolean;
};

export type PublicGenericToolArgsDto = {
    kind: "generic";
    value: PublicValuePreviewDto;
};

/**
 * 公开工具参数。专用工具使用领域字段；未知工具只能进入有界 generic preview。
 */
export type PublicToolArgsDto =
    | PublicWriteToolArgsDto
    | PublicEditToolArgsDto
    | PublicApplyPatchToolArgsDto
    | PublicGenericToolArgsDto;

/** Attachment 的公开描述；公开边界不携带 blob data。 */
export type PublicAttachmentDto = {
    attachmentId: AttachmentId;
    mimeType: string;
    bytes: number;
    /** 同一 blob 在当前消息中的展示文件名；不存在表示来源没有提供名称。 */
    name?: string;
    dataOmitted: true;
};

/** durable Chat Flow attachment 的稳定定位信息。 */
export type AgentChatAttachmentDto = {
    /** attachment block 在所属 stored message content 中的原始索引。 */
    contentIndex: number;
    attachment: PublicAttachmentDto;
};

/** user Chat Flow 按 stored contentIndex 保序的公开内容块。 */
export type AgentChatContentBlockDto =
    | {
        type: "text";
        contentIndex: number;
        content: PublicTextPreviewDto;
    }
    | ({type: "attachment"} & AgentChatAttachmentDto);

/**
 * user entry 全部文本的聚合描述。
 *
 * preview 只存在于 ordered blocks，避免同一段正文跨字段重复占用公开事件预算。
 */
export type AgentChatTextSummaryDto = {
    bytes: number;
    omitted: boolean;
};

export type PublicToolContentDto =
    | {
        type: "text";
        contentIndex: number;
        textPreview: string;
        textBytes: number;
        textOmitted: boolean;
    }
    | {
        type: "image";
        contentIndex: number;
        mimeType: string;
        dataBytes: number;
        dataOmitted: true;
    }
    | {
        type: "attachment";
        contentIndex: number;
        attachment: PublicAttachmentDto;
    };

export type PublicToolResultDetailsDto =
    | {
        kind: "file_change";
        diffPreview: string;
        diffBytes: number;
        diffOmitted: boolean;
        firstChangedLine?: number;
        files: string[];
        filesOmitted: boolean;
    }
    | {
        kind: "read";
        path?: string;
        startLine?: number;
        endLine?: number;
        totalLines?: number;
        nextOffset?: number;
    }
    | {
        kind: "bash";
        truncated: boolean;
        truncatedBy?: "bytes" | "lines";
        totalLines?: number;
        totalBytes?: number;
        fullOutput?: {
            /** available/partial时存在；reclaimed不伪造locator。 */
            locator?: string;
            state: "available" | "partial" | "reclaimed";
        };
    }
    | {
        kind: "request_user_input";
        answers: Array<{
            questionIndex?: number;
            text?: string;
            /** 原始回答正文未完整公开时为 true。 */
            textOmitted?: boolean;
            selectedOptionIndex?: number;
            note?: string;
            /** 原始补充说明未完整公开时为 true。 */
            noteOmitted?: boolean;
            ignored?: boolean;
        }>;
        omittedAnswers: number;
    }
    | {
        kind: "switch_mode";
        approved?: boolean;
        pending?: boolean;
        targetMode?: string;
    }
    | {
        kind: "task";
        value: PublicValuePreviewDto;
    }
    | {
        kind: "agent";
        sessionId?: number;
        profileKey?: string;
        status?: string;
        value: PublicValuePreviewDto;
    }
    | {
        kind: "generic";
        value: PublicValuePreviewDto;
    };

/**
 * 工具执行和 durable toolResult 共用的公开结果投影。
 */
export type PublicToolResultDto = {
    content: PublicToolContentDto[];
    omittedContentBlocks: number;
    details?: PublicToolResultDetailsDto;
};

export type AgentChatUserEntryDto = {
    id: string;
    /** 前端提交与 durable entry 的稳定关联 ID。 */
    clientMessageId: string;
    timestamp: number;
    type: "user";
    /** 唯一正文来源；按 stored contentIndex 保序。 */
    blocks: AgentChatContentBlockDto[];
    /** 因 block 数量上限或非法公开结构而未投影的 block 数量。 */
    omittedBlocks: number;
    /** 全部文本的 UTF-8 大小和省略状态；正文 preview 由 text blocks 提供。 */
    textSummary: AgentChatTextSummaryDto;
    intent: "normal" | "steer";
};

export type AgentChatAssistantEntryDto = {
    id: string;
    timestamp: number;
    type: "assistant";
    invocationId?: string;
    content: PublicTextPreviewDto;
    thinking: PublicTextPreviewDto;
    error?: PublicTextPreviewDto;
    status: "done" | "partial" | "interrupted" | "error";
    model: string;
    usage: Usage;
    toolCalls: Array<{
        id: string;
        index: number;
        name: string;
        args: PublicToolArgsDto;
    }>;
    omittedToolCalls: number;
};

export type AgentChatToolResultEntryDto = {
    id: string;
    timestamp: number;
    type: "tool_result";
    toolCallId: string;
    toolName: string;
    result: PublicToolResultDto;
    isError: boolean;
};

export type AgentChatSystemEntryDto = {
    id: string;
    timestamp: number;
    type: "system";
    source: "custom" | "reminder" | "compaction" | "branch_summary";
    label: string;
    content: PublicTextPreviewDto;
};

export type AgentChatInvocationErrorEntryDto = {
    id: string;
    timestamp: number;
    type: "invocation_error";
    invocationId: string;
    message: PublicTextPreviewDto;
    phase: string;
    retryable?: boolean;
    code?: string;
};

/**
 * Chat Flow 的逐 entry 公开真相。它不包含 Session Tree/账本内部字段。
 */
export type AgentChatEntryDto =
    | AgentChatUserEntryDto
    | AgentChatAssistantEntryDto
    | AgentChatToolResultEntryDto
    | AgentChatSystemEntryDto
    | AgentChatInvocationErrorEntryDto;

/**
 * 账本 entry 会渲染成哪一种 Chat Flow 气泡。
 *
 * 从 `AgentChatEntryDto` 派生，不额外定义一套并行词汇：判据的唯一实现是
 * `server/agent/events/public-chat-entry-projection.ts` 的 `chatEntryKind()`。
 * 注意 `tool_result` 会并入所属 assistant 气泡，没有独立气泡与工具条。
 */
export type ChatEntryKind = AgentChatEntryDto["type"];
import type {Usage} from "@earendil-works/pi-ai";
import type {AttachmentId} from "nbook/shared/dto/agent-attachment.dto";
import type {LowCodeFieldDto, LowCodeJsonObject} from "nbook/shared/dto/low-code-form.dto";

export type AgentUserInputFieldDto = Omit<LowCodeFieldDto, "component" | "resource"> & {
    component: Exclude<LowCodeFieldDto["component"], "resource-preset">;
};

/** Agent waiting 只允许轻量、可直接公开的 Low-Code 表单。 */
export type AgentUserInputFormDto = {
    defaults: LowCodeJsonObject;
    fields: AgentUserInputFieldDto[];
};
