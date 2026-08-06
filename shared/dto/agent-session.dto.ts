import {z} from "zod";
import type {JsonValue, Usage} from "nbook/server/agent/messages/types";
import type {SessionTreeNode} from "nbook/server/agent/session/types";
import type {VariablePatchAck, VariablePatchRequest} from "nbook/server/agent/variables/types";
import {ThinkingLevelSchema} from "nbook/shared/dto/app-settings.dto";
import type {AgentChatEntryDto, AgentUserInputFormDto, PublicToolArgsDto, PublicToolResultDto} from "nbook/shared/dto/agent-public-event.dto";
import {PublicToolCallIdSchema} from "nbook/shared/agent/public-tool-identity";
import type {AttachmentId} from "nbook/shared/dto/agent-attachment.dto";
import {ProjectRootDtoSchema} from "nbook/shared/dto/project.dto";

const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
]));

export const AgentSessionIdSchema = z.number().int().positive();
export const AgentClientMessageIdSchema = z.string().uuid();
export const AgentAttachmentIdSchema = z.string()
    .regex(/^sha256:[0-9a-f]{64}$/u, "Attachment ID 格式非法")
    .transform((value): AttachmentId => value as AttachmentId);

/**
 * Agent 工作模式（Task 90）。
 * - normal：无特殊约束，可读可写。
 * - discuss：只读讨论导向，写文件工具挂起审批。
 * - plan：只读计划导向，写文件工具挂起审批（计划目录内 .md 豁免）。
 */
export const AgentModeSchema = z.enum(["normal", "discuss", "plan"]);

export type AgentMode = z.infer<typeof AgentModeSchema>;

/**
 * 判断模式是否为只读模式（discuss / plan 共有约束：写文件工具需审批）。
 */
export function isReadonlyMode(mode: AgentMode): boolean {
    return mode === "discuss" || mode === "plan";
}

export const AgentUserMessageInputDtoSchema = z.object({
    text: z.string(),
}).strict();

export const AgentResolutionDtoSchema = z.discriminatedUnion("kind", [
    z.object({
        kind: z.literal("tool_approval"),
        toolCallId: PublicToolCallIdSchema,
        approved: z.boolean(),
        resultText: z.string().optional(),
        data: JsonValueSchema.optional(),
        answers: z.array(z.object({
            questionIndex: z.number().int().nonnegative(),
            text: z.string().optional(),
            selectedOptionIndex: z.number().int().min(-1).optional(),
            note: z.string().optional(),
            ignored: z.boolean().optional(),
        })).optional(),
    }),
    z.object({
        kind: z.literal("user_input"),
        toolCallId: PublicToolCallIdSchema,
        /** Task 63: Low-Code Form 提交数据（存在时优先于 answers）。 */
        data: JsonValueSchema.optional(),
        answers: z.array(z.object({
            questionIndex: z.number().int().nonnegative(),
            text: z.string().optional(),
            selectedOptionIndex: z.number().int().min(-1).optional(),
            note: z.string().optional(),
            ignored: z.boolean().optional(),
        })).optional(),
    }).refine((value) => value.data !== undefined || value.answers !== undefined, {
        message: "user_input resolution 必须提供 data 或 answers",
    }),
]);

export type AgentResolutionDto = z.infer<typeof AgentResolutionDtoSchema>;

export const AgentCreateSessionRequestDtoSchema = z.object({
    profileKey: z.string().trim().min(1, "profileKey 不能为空"),
    initial: JsonValueSchema.optional(),
    currentProjectRoot: ProjectRootDtoSchema.optional(),
    parentSessionId: AgentSessionIdSchema.optional(),
}).strict();

export const AgentInvokeRequestDtoSchema = z.object({
    mode: z.enum(["prompt", "continue", "steer", "followup"]),
    clientMessageId: AgentClientMessageIdSchema.optional(),
    message: AgentUserMessageInputDtoSchema.optional(),
    input: JsonValueSchema.optional(),
    title: z.string().trim().min(1).optional(),
    resolution: AgentResolutionDtoSchema.optional(),
    resolutions: z.array(AgentResolutionDtoSchema).optional(),
    clientState: z.lazy(() => ClientVariablesDtoSchema).optional(),
    caller: z.never().optional(),
    block: z.boolean().optional(),
}).strict().superRefine((value, ctx) => {
    if ((value.mode === "prompt" || value.mode === "steer" || value.mode === "followup") && !value.message && value.input === undefined) {
        ctx.addIssue({
            code: "custom",
            path: ["message"],
            message: `${value.mode} 模式必须提供 message 或 input`,
        });
    }
    if (value.mode === "continue" && (value.message || value.input !== undefined)) {
        ctx.addIssue({
            code: "custom",
            path: ["message"],
            message: "continue 模式不能提供 message 或 input",
        });
    }
    const createsUserInput = value.mode === "prompt" || value.mode === "steer" || value.mode === "followup";
    if (createsUserInput && value.clientMessageId === undefined) {
        ctx.addIssue({
            code: "custom",
            path: ["clientMessageId"],
            message: `${value.mode} 模式必须提供 clientMessageId`,
        });
    }
    if (value.mode === "continue" && value.clientMessageId !== undefined) {
        ctx.addIssue({
            code: "custom",
            path: ["clientMessageId"],
            message: "continue 模式不能提供 clientMessageId",
        });
    }
    if (value.resolution && value.resolutions) {
        ctx.addIssue({
            code: "custom",
            path: ["resolution"],
            message: "不能同时提供 resolution 和 resolutions",
        });
    }
});

export const AgentSessionListQueryDtoSchema = z.object({
    scope: z.enum(["all", "workspace-root", "project"]).optional(),
    projectRoot: ProjectRootDtoSchema.optional(),
    recovery: z.literal("required").optional(),
    includeArchived: z.coerce.boolean().optional(),
    includeSystem: z.coerce.boolean().optional(),
    profileKey: z.string().trim().min(1).optional(),
    profileGroup: z.enum(["all", "leader"]).optional(),
    status: z.enum(["all", "active", "running", "waiting", "idle", "interrupted", "archived"]).optional(),
    relation: z.enum(["all", "top", "child"]).optional(),
    search: z.string().trim().optional(),
    offset: z.coerce.number().int().min(0).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
}).strict().superRefine((value, ctx) => {
    if (value.scope === "project" && value.projectRoot === undefined) {
        ctx.addIssue({code: "custom", path: ["projectRoot"], message: "scope=project 时必须提供 projectRoot"});
    }
    if (value.scope !== "project" && value.projectRoot !== undefined) {
        ctx.addIssue({code: "custom", path: ["projectRoot"], message: "projectRoot 只允许与 scope=project 一起使用"});
    }
    if (value.recovery === "required" && value.scope !== "all") {
        ctx.addIssue({code: "custom", path: ["recovery"], message: "recovery=required 只允许与 scope=all 一起使用"});
    }
});

/** 重新绑定或清除 Session Current Project。 */
export const AgentCurrentProjectRequestDtoSchema = z.object({
    projectRoot: ProjectRootDtoSchema.nullable(),
}).strict();

export const AgentSessionEventsQueryDtoSchema = z.object({
    after: z.coerce.number().int().nonnegative().optional(),
    eventEpoch: z.string().trim().min(1).optional(),
});

export const AgentSessionAttachmentListQueryDtoSchema = z.object({
    search: z.string().trim().max(200).optional(),
    offset: z.coerce.number().int().min(0).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(40),
}).strict();

export const AgentSessionAttachmentSnapshotRequestDtoSchema = z.object({
    sourcePath: z.string().trim().min(1).max(4096),
    name: z.string().max(255).optional(),
}).strict();

export const AgentSessionAttachmentResolveRequestDtoSchema = z.object({
    attachmentIds: z.array(AgentAttachmentIdSchema).min(1).max(8),
}).strict().superRefine((value, ctx) => {
    if (new Set(value.attachmentIds).size !== value.attachmentIds.length) {
        ctx.addIssue({
            code: "custom",
            path: ["attachmentIds"],
            message: "attachmentIds 不允许重复",
        });
    }
});

/**
 * Agent session 查询视图。空 query 与 recovery 等价；其它视图必须严格携带
 * 自己需要的参数，避免 cursor/include 等组合扩散到各个调用者。
 */
export const AgentSessionQueryDtoSchema = z.union([
    z.object({view: z.literal("recovery")}).strict(),
    z.object({view: z.literal("history"), cursor: z.string().trim().min(1).max(2048)}).strict(),
    z.object({view: z.literal("systemPrompt")}).strict(),
    z.object({}).strict(),
]);

export const AgentCommandRequestDtoSchema = z.discriminatedUnion("command", [
    z.object({command: z.literal("new")}),
    z.object({command: z.literal("archive"), reason: z.string().optional()}),
    z.object({command: z.literal("restore")}),
    z.object({command: z.literal("compact"), instructions: z.string().optional()}),
    z.object({command: z.literal("mode"), mode: AgentModeSchema}),
    z.object({command: z.literal("model"), modelKey: z.string().trim().min(1).nullable()}),
    z.object({command: z.literal("thinking"), thinkingLevel: ThinkingLevelSchema.nullable()}),
    z.object({command: z.literal("rename"), title: z.string().trim().min(1)}),
    z.object({command: z.literal("summarize")}),
    z.object({command: z.literal("retry"), entryId: z.string().trim().min(1).optional()}),
    z.object({command: z.literal("fork"), entryId: z.string().trim().min(1).optional()}),
    z.object({
        command: z.literal("tree"),
        targetEntryId: z.string().trim().min(1),
        position: z.enum(["at", "before"]).default("at"),
    }),
]);

export const AgentTreeRequestDtoSchema = z.union([
    z.object({
        position: z.literal("empty"),
    }),
    z.object({
        targetEntryId: z.string().trim().min(1),
        position: z.enum(["at", "before"]).default("at"),
        next: z.object({
            type: z.literal("invoke"),
            mode: z.enum(["prompt", "continue"]),
            clientMessageId: AgentClientMessageIdSchema.optional(),
            message: AgentUserMessageInputDtoSchema.optional(),
            clientState: z.lazy(() => ClientVariablesDtoSchema).optional(),
        }).strict().superRefine((value, ctx) => {
            if (value.mode === "prompt" && value.clientMessageId === undefined) {
                ctx.addIssue({
                    code: "custom",
                    path: ["clientMessageId"],
                    message: "Tree prompt 必须提供 clientMessageId",
                });
            }
            if (value.mode === "prompt" && value.message === undefined) {
                ctx.addIssue({
                    code: "custom",
                    path: ["message"],
                    message: "Tree prompt 必须提供 message",
                });
            }
            if (value.mode === "continue" && value.clientMessageId !== undefined) {
                ctx.addIssue({
                    code: "custom",
                    path: ["clientMessageId"],
                    message: "Tree continue 不能提供 clientMessageId",
                });
            }
            if (value.mode === "continue" && value.message !== undefined) {
                ctx.addIssue({
                    code: "custom",
                    path: ["message"],
                    message: "Tree continue 不能提供 message",
                });
            }
        }).optional(),
    }),
]);

export const AgentAbortRequestDtoSchema = z.object({
    reason: z.string().optional(),
    clearQueue: z.boolean().optional(),
});

export const ClientVariablePatchAckDtoSchema = z.object({
    namespace: z.literal("client"),
    path: z.string().trim().min(1),
    operations: z.array(z.any()),
    appliedValue: JsonValueSchema.optional(),
    error: z.string().optional(),
    invocationId: z.string().optional(),
    toolCallId: PublicToolCallIdSchema.optional(),
});

export type AgentCreateSessionRequestDto = z.infer<typeof AgentCreateSessionRequestDtoSchema>;
export type AgentCurrentProjectRequestDto = z.infer<typeof AgentCurrentProjectRequestDtoSchema>;
export type AgentUserMessageInputDto = z.infer<typeof AgentUserMessageInputDtoSchema>;
export type AgentInvokeRequestDto = z.infer<typeof AgentInvokeRequestDtoSchema>;
export type AgentSessionListQueryDto = z.infer<typeof AgentSessionListQueryDtoSchema>;
export type AgentSessionEventsQueryDto = z.infer<typeof AgentSessionEventsQueryDtoSchema>;
export type AgentSessionAttachmentListQueryDto = z.infer<typeof AgentSessionAttachmentListQueryDtoSchema>;
export type AgentSessionAttachmentSnapshotRequestDto = z.infer<typeof AgentSessionAttachmentSnapshotRequestDtoSchema>;
export type AgentSessionAttachmentResolveRequestDto = z.infer<typeof AgentSessionAttachmentResolveRequestDtoSchema>;
export type AgentSessionQueryDto = z.infer<typeof AgentSessionQueryDtoSchema>;
export type AgentCommandRequestDto = z.infer<typeof AgentCommandRequestDtoSchema>;
export type AgentTreeRequestDto = z.infer<typeof AgentTreeRequestDtoSchema>;
export type AgentAbortRequestDto = z.infer<typeof AgentAbortRequestDtoSchema>;
export type ClientVariablePatchAckDto = z.infer<typeof ClientVariablePatchAckDtoSchema> & VariablePatchAck;

export const AgentSkillCatalogItemDtoSchema = z.object({
    name: z.string().trim().min(1, "skill.name 不能为空"),
    description: z.string().trim().min(1, "skill.description 不能为空"),
});

export const ClientVariablesDtoSchema = z.object({
    ide: z.record(z.string(), JsonValueSchema).optional(),
    studio: z.record(z.string(), JsonValueSchema).optional(),
}).catchall(JsonValueSchema.optional());

export type AgentSkillCatalogItemDto = z.infer<typeof AgentSkillCatalogItemDtoSchema>;
export type ClientVariablesDto = z.infer<typeof ClientVariablesDtoSchema>;
export type ClientStateSnapshotDto = ClientVariablesDto;

export type AgentSessionStatus = "idle" | "running" | "waiting" | "archived" | "interrupted";
export type AgentSessionProfileAvailability = "loaded" | "missing" | "unloadable";

export type AgentEventCursorDto = {
    eventEpoch: string;
    /** 前端已经处理到的事件序号；订阅 SSE 时使用 after=该值。 */
    after: number;
};

export type AgentSessionContextUsageDto = {
    /** 当前 active context 的 token 估算值。 */
    usedTokens: number;
    /** 当前模型 context window；为空表示模型未声明窗口。 */
    limitTokens: number | null;
    /** usedTokens / limitTokens 的百分比；limitTokens 为空时为空。 */
    percent: number | null;
    estimated: true;
};

export type AgentSessionSummaryDto = {
    sessionId: number;
    profileKey: string;
    /**
     * 当前 session 引用的 profile 是否仍可用于后续运行。
     * 为空只会出现在仓储层原始摘要；HTTP runtime 投影会始终填充。
     */
    profileAvailability?: AgentSessionProfileAvailability;
    /** profile 不可继续运行时的用户可读原因；profile 可用时为空。 */
    profileIssueMessage?: string;
    currentProjectRoot?: string;
    migrationReview?: {
        status: "required";
        reason: "current_project_unresolved";
    };
    parentSessionId?: number;
    systemRole?: "summarizer";
    /** 公开 API 的有界展示标题；完整值保留在 session durable truth。 */
    title?: string;
    /** 公开 API 的有界展示摘要；完整值保留在 session durable truth。 */
    summary?: string;
    status: AgentSessionStatus;
    updatedAt: number;
    archived: boolean;
    lastMessagePreview?: string;
    usage?: Usage;
    /** 仓储层原始摘要可以为空；HTTP runtime 投影必须填充。 */
    interaction?: AgentSessionInteractionDto;
};

/** 当前用户在 Session 状态下可执行的交互能力。 */
export type AgentSessionInteractionDto = {
    canInvoke: boolean;
    canResolveUserInput: boolean;
    canRegisterAttachment: boolean;
    canInsertAttachment: boolean;
    canMutateHistory: boolean;
    canChangeRuntime: boolean;
    canArchive: boolean;
    canRestore: boolean;
    canAbort: boolean;
};

/** Session 全分支附件目录中的去重条目。 */
export type AgentSessionAttachmentItemDto = {
    attachment: import("nbook/shared/dto/agent-public-event.dto").PublicAttachmentDto;
    /** Composer 使用的稳定 Markdown destination。 */
    target: string;
    locator: {
        entryId: string;
        contentIndex: number;
    };
    firstSeenAt: number;
    lastSeenAt: number;
    referenceCount: number;
};

export type AgentSessionAttachmentPageDto = {
    items: AgentSessionAttachmentItemDto[];
    total: number;
    offset: number;
    limit: number;
    hasMore: boolean;
    nextOffset?: number;
};

export type AgentSessionAttachmentResolveResultDto = {
    /** 与请求 attachmentIds 严格同序。 */
    items: AgentSessionAttachmentItemDto[];
};

/** 历史用户消息按 stored content 顺序重建的完整 Markdown。 */
export type AgentUserMessageContentDto = {
    text: string;
};

export type AgentSessionListPageDto = {
    items: AgentSessionSummaryDto[];
    total: number;
    offset: number;
    limit: number;
    hasMore: boolean;
    nextOffset?: number;
};

export type AgentSessionSummarizerStateDto = {
    running: boolean;
    dirty: boolean;
    /** 最近一次构建出的 Agent Dialogue Content token 估算。为空表示尚未运行过。 */
    lastDialogueContentTokens?: number;
    /** 最近一次成功摘要的完成时间。为空表示尚未成功写回过。 */
    lastRunAt?: number;
    /** 最近一次后台摘要错误的有界公开预览。为空表示当前没有可展示错误。 */
    lastError?: string;
};

export type AgentSessionProfileGroup = "all" | "leader";
export type AgentSessionStatusFilter = "all" | "active" | "running" | "waiting" | "idle" | "interrupted" | "archived";
export type AgentSessionRelationFilter = "all" | "top" | "child";

/** 当前有效关联的 Agent session；历史 detach 状态不会进入该 DTO。 */
export type AgentLinkedSessionDto = AgentSessionSummaryDto;

export type AgentSessionRelationsDto = {
    sessionId: number;
    linkedAgents: AgentLinkedSessionDto[];
    linkedByAgents: AgentLinkedSessionDto[];
    /** 关联目标已不存在时的局部降级数量；主对话仍然可用。 */
    unavailableLinkedAgents?: number;
};

export type AgentPendingUserInputDto = {
    assistantMessageId?: string;
    toolCallId: string;
    toolName: string;
    args?: PublicToolArgsDto;
    /** live state 省略了不可安全截断的交互规格；调用方应复用 runtime event 详情或拉 recovery。 */
    detailsOmitted?: true;
    planFilePath?: string;
    /** 仅 recovery 返回完整计划正文；live state 不携带。 */
    planContent?: string;
    planContentBytes?: number;
    /** Low-Code Form 规格，从 tool.user-input-required 事件复制；存在时优先于 args.form。 */
    formSpec?: {
        form: AgentUserInputFormDto;
        layout?: "dialog" | "inline" | "fullscreen";
        prompt?: string;
    };
};

/** @deprecated 使用 AgentPendingUserInputDto */
export type AgentPendingApprovalDto = AgentPendingUserInputDto;

export type AgentQueuedMessageDto = {
    id: string;
    clientMessageId: string;
    kind: "steer" | "followup";
    text?: import("nbook/shared/dto/agent-public-event.dto").PublicTextPreviewDto;
    images: Array<{mimeType: string; dataBytes: number; dataOmitted: true}>;
    omittedImages: number;
    input?: import("nbook/shared/dto/agent-public-event.dto").PublicValuePreviewDto;
    createdAt: number;
};

export type AgentFollowUpQueueItemDto = AgentQueuedMessageDto;

export type AgentFollowUpQueueStateDto = {
    status: "ready" | "paused";
    pausedBy?: {
        invocationId: string;
        itemId?: string;
        reason: "error" | "aborted" | "interrupted" | "admission_error";
        message?: string;
    };
    items: AgentFollowUpQueueItemDto[];
    omittedItems: number;
};

export type AgentQueuedMessageListDto = {
    items: AgentQueuedMessageDto[];
    omittedItems: number;
};

export type AgentQueueSummaryDto = {count: number};
export type AgentFollowUpQueueSummaryDto = AgentQueueSummaryDto & Pick<AgentFollowUpQueueStateDto, "status" | "pausedBy">;

export type AgentActiveInvocationDto = {
    invocationId: string;
    sessionId: number;
    status: "running" | "waiting" | "aborting";
    mode: "prompt" | "continue" | "compact";
    startedAt: number;
};

/** 公开 session shell 只暴露模型选择身份，不暴露 baseUrl、headers、compat 或价格 metadata。 */
export type AgentSessionModelRefDto = {
    providerConfigId: string;
    modelId: string;
};

export type AgentSessionLiveStateDto = {
    summary: AgentSessionSummaryDto;
    /** 后台标题/摘要维护状态。为空表示当前 session 未启用或尚无摘要状态。 */
    summarizer?: AgentSessionSummarizerStateDto;
    activeLeafId: string | null;
    /** 显式 active path 重定位版本;变化时前端应拉 snapshot 重建消息投影。 */
    activePathRevision: string | null;
    pendingUserInputs: AgentPendingUserInputDto[];
    steerQueue: AgentQueueSummaryDto;
    followUpQueue: AgentFollowUpQueueSummaryDto;
    activeInvocation: AgentActiveInvocationDto | null;
    model: AgentSessionModelRefDto | null;
    /** 当前 session 的显式 thinking 覆盖；null 表示跟随 Agent Profile。 */
    thinkingLevel: z.infer<typeof ThinkingLevelSchema> | null;
    /** 当前新 run 实际会传给 PI 的 thinking level。 */
    effectiveThinkingLevel: z.infer<typeof ThinkingLevelSchema>;
    agentMode: AgentMode;
    contextUsage?: AgentSessionContextUsageDto;
};

export type AgentInvocationErrorPhaseDto = "prepare" | "pre_loop" | "model" | "tool" | "ingest" | "compaction" | "settleRun" | "unknown";

export type AgentInvocationErrorInfoDto = {
    message: string;
    phase: AgentInvocationErrorPhaseDto;
    retryable?: boolean;
    code?: string;
};

export type AgentInvocationAcceptanceDto =
    | {state: "none"}
    | {state: "not_accepted"; clientMessageId: string}
    | {state: "queued"; clientMessageId: string; queueItemId: string}
    | {state: "persisted"; clientMessageId: string; entryId: string};

/** 阻塞 invocation HTTP 返回；内部 run/caller/callback 不进入公开 DTO。 */
export type InvokeAgentResult = {
    sessionId: number;
    invocationId: string;
    status: "completed" | "waiting" | "error";
    acceptance: AgentInvocationAcceptanceDto;
    /** Durable assistant 正文的有界公开预览；完整内容通过 session history 读取。 */
    finalMessage?: string;
    /** finalMessage 对应原始正文的 UTF-8 字节数。 */
    finalMessageBytes?: number;
    /** true 表示 finalMessage 只是公开预览。 */
    finalMessageOmitted?: boolean;
    reportResult?: {
        result: string;
        /** report_result.result 的原始 UTF-8 字节数。 */
        resultBytes: number;
        /** true 表示 result 只是公开预览。 */
        resultOmitted: boolean;
        success?: boolean;
        /** true 表示内部存在结构化结果，但 HTTP DTO 不携带该结果。 */
        dataOmitted?: true;
    };
    error?: string;
    errorPhase?: AgentInvocationErrorPhaseDto;
    errorInfo?: AgentInvocationErrorInfoDto;
    /**
     * true 表示这次运行是被取消的（用户点停止、父级撤销、宽限期强制收尾），不是失败。
     *
     * `status` 仍是 `"error"`：调用方默认按异常终止处理（不继续 workflow、不当成功），
     * 但面向用户的展示必须走「已停止」而不是报错——`error` 里是 provider/内部英文技术文本，
     * 只用于日志与诊断，弹给用户就成了界面上的英文报错（Task 139）。
     */
    aborted?: boolean;
    usage?: Usage;
    elapsedMs?: number;
    queuedItem?: AgentQueuedMessageDto;
};

export type AgentCommandResult =
    | {
        kind: "live_state";
        status: "completed" | "started";
        sessionId: number;
        state: AgentSessionLiveStateDto;
    }
    | {
        kind: "created_session";
        status: "completed";
        sessionId: number;
        createdSession: AgentSessionSummaryDto;
    };

export type AgentTreeResult = {
    status: "completed" | "invoked";
    state: AgentSessionLiveStateDto;
    invocation?: InvokeAgentResult;
};

export type AgentAbortResult = {
    status: "idle" | "aborted";
    sessionId: number;
};

export type AgentAssistantUpdateDto =
    | {type: "text_start"; contentIndex: number}
    | {type: "text_delta"; contentIndex: number; delta: string; deltaBytes: number; deltaOmitted: boolean}
    | {type: "text_end"; contentIndex: number}
    | {type: "thinking_start"; contentIndex: number}
    | {type: "thinking_delta"; contentIndex: number; delta: string; deltaBytes: number; deltaOmitted: boolean}
    | {type: "thinking_end"; contentIndex: number}
    | {
        type: "toolcall_start";
        contentIndex: number;
        toolCallId?: string;
        toolName?: string;
    }
    | {
        type: "toolcall_args";
        contentIndex: number;
        toolCallId?: string;
        toolName?: string;
        args: PublicToolArgsDto;
        streamBytes: number;
        omitted: boolean;
    }
    | {
        type: "toolcall_end";
        contentIndex: number;
    toolCallId: string;
        toolName: string;
        args: PublicToolArgsDto;
    };

export type AgentRuntimeStreamEventDto =
    | {
        type: "agent_start";
    }
    | {
        type: "agent_end";
        status: "completed" | "waiting" | "failed" | "aborted" | "interrupted";
        usage?: Usage;
    }
    | {
        type: "turn_start";
        turnIndex: number;
    }
    | {
        type: "turn_end";
        turnIndex: number;
        status: "completed" | "waiting" | "failed";
    }
    | {
        type: "message_start";
        messageId: string;
        role: "assistant";
        timestamp: number;
        model: string;
    }
    | {
        type: "message_update";
        messageId: string;
        update: AgentAssistantUpdateDto;
    }
    | {
        type: "message_end";
        messageId: string;
        stopReason: "stop" | "length" | "toolUse" | "error" | "aborted";
        usage: Usage;
        responseModel?: string;
        errorMessage?: string;
    }
    | {
        type: "tool_execution_start";
    toolCallId: string;
        toolName: string;
        args: PublicToolArgsDto;
    }
    | {
        type: "tool_execution_update";
    toolCallId: string;
        toolName: string;
        partialResult: PublicToolResultDto;
    }
    | {
        type: "tool_execution_end";
    toolCallId: string;
        toolName: string;
        result: PublicToolResultDto;
        isError: boolean;
    }
    | {
        type: "tool.user-input-required";
    toolCallId: string;
        toolName: string;
        args: PublicToolArgsDto;
        formSpec?: {
            form: AgentUserInputFormDto;
            prompt?: string;
            layout?: "dialog" | "inline" | "fullscreen";
        };
    };

export type AgentSessionControlEvent =
    | {
        type: "connected";
        eventEpoch: string;
        latestSeq: number;
    }
    | {
        type: "snapshot_required";
        reason: string;
    }
    | {
        type: "steer_queued";
        item: AgentQueuedMessageDto;
    }
    | {
        type: "follow_up_queued";
        item: AgentQueuedMessageDto;
    }
    | {
        type: "session_attachments_changed";
    }
    | {
        type: "session_entry";
        entry: AgentChatEntryDto;
    }
    | {
        type: "session_projection_invalidated";
        reason: "linked_agent_changed" | "pending_plan_content_changed";
    }
    | {
        type: "session_state_changed";
        state: AgentSessionLiveStateDto;
    }
    | {
        type: "invocation_aborted";
        /** 有界公开预览；完整原因可保留在内部 invocation lifecycle。 */
        reason?: string;
    }
    | {
        type: "client_variable_patch_requested";
        /** 必须原样送达并获得 ack；Harness 在发布前强制执行 64 KiB 上限。 */
        request: VariablePatchRequest;
    };

export type AgentSessionEventDto =
    | {
        eventEpoch: string;
        seq: number;
        sessionId: number;
        invocationId?: string;
        kind: "runtime";
        event: AgentRuntimeStreamEventDto;
    }
    | {
        eventEpoch: string;
        seq: number;
        sessionId: number;
        invocationId?: string;
        kind: "session";
        event: AgentSessionControlEvent;
    };

/** Agent Chat Flow 的一页 durable history；entries 始终按旧到新排列。 */
export type AgentChatHistoryPageDto = {
    entries: AgentChatEntryDto[];
    /** 为空表示已经到达当前 active path 起点。 */
    previousCursor: string | null;
};

/** 打开、刷新或 SSE recovery 使用的 session 恢复真相。 */
export type AgentSessionRecoveryDto = {
    kind: "recovery";
    eventCursor: AgentEventCursorDto;
    summary: AgentSessionSummaryDto;
    /** 后台展示标题/摘要维护状态；仅面向 UI，不影响 Agent 运行态。 */
    summarizer?: AgentSessionSummarizerStateDto;
    activeLeafId: string | null;
    /** 显式 active path 重定位版本；变化时前端应拉 snapshot 重建消息投影。 */
    activePathRevision: string | null;
    history: AgentChatHistoryPageDto;
    tree: SessionTreeNode[];
    linkedAgents: AgentLinkedSessionDto[];
    linkedByAgents: AgentLinkedSessionDto[];
    /** 关联目标已不存在时的局部降级数量；主对话仍然可用。 */
    unavailableLinkedAgents?: number;
    pendingUserInputs: AgentPendingUserInputDto[];
    steerQueue: AgentQueuedMessageListDto;
    followUpQueue: AgentFollowUpQueueStateDto;
    activeInvocation: AgentActiveInvocationDto | null;
    model: AgentSessionModelRefDto | null;
    /** 当前 session 的显式 thinking 覆盖；null 表示跟随 Agent Profile。 */
    thinkingLevel: z.infer<typeof ThinkingLevelSchema> | null;
    /** 当前新 run 实际会传给 PI 的 thinking level。 */
    effectiveThinkingLevel: z.infer<typeof ThinkingLevelSchema>;
    agentMode: AgentMode;
    contextUsage?: AgentSessionContextUsageDto;
};

/** 向 active path 起点翻页时返回的纯 history 响应。 */
export type AgentSessionHistoryPageDto = {
    kind: "history";
    sessionId: number;
    activePathRevision: string | null;
    history: AgentChatHistoryPageDto;
};

/** 显式查看时才构建的 provider system prompt。 */
export type AgentSessionSystemPromptDto = {
    kind: "systemPrompt";
    sessionId: number;
    systemPrompt: string;
};

export type AgentSessionQueryResultDto =
    | AgentSessionRecoveryDto
    | AgentSessionHistoryPageDto
    | AgentSessionSystemPromptDto;
