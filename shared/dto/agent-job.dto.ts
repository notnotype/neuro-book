import {z} from "zod";

export type JsonValue = null | boolean | number | string | JsonValue[] | {[key: string]: JsonValue};

const AgentJobJsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(AgentJobJsonValueSchema),
    z.record(z.string(), AgentJobJsonValueSchema),
]));

export const AgentJobKindSchema = z.enum(["workflow", "invoke_agent", "bash"]);
export const AgentJobStatusSchema = z.enum(["running", "waiting", "completed", "failed", "cancelled", "interrupted"]);
export const AgentJobDeliveryStatusSchema = z.enum(["not_required", "pending", "accepted", "failed"]);

export const AgentJobSnapshotSchema = z.object({
    jobId: z.string(),
    kind: AgentJobKindSchema,
    title: z.string(),
    ownerSessionId: z.number().int().nullable(),
    originToolCallId: z.string().optional(),
    status: AgentJobStatusSchema,
    createdAt: z.number(),
    endedAt: z.number().optional(),
    ref: AgentJobJsonValueSchema,
    preview: z.string().optional(),
    error: z.string().optional(),
    /** 执行终态之外的结果回流状态；无 owner 或显式 none 时为 not_required。 */
    deliveryStatus: AgentJobDeliveryStatusSchema,
    deliveryError: z.string().optional(),
});

export const AgentJobDetailSchema = AgentJobSnapshotSchema.extend({
    result: AgentJobJsonValueSchema.optional(),
    /** kind-specific detail；Workflow 由服务端 provider 填充 run/pendingAsks/sessions/usage。 */
    detail: AgentJobJsonValueSchema.optional(),
});

export const AgentJobEventCursorSchema = z.object({
    eventEpoch: z.string().min(1),
    after: z.number().int().nonnegative(),
});

/** 后台任务启动回执；游标精确指向该 Job 的首次 running 事件。 */
export const AgentJobStartDtoSchema = z.object({
    jobId: z.string().min(1),
    jobEventCursor: AgentJobEventCursorSchema,
}).strict();

const PositiveIntegerQuerySchema = z.union([
    z.string().regex(/^[1-9]\d*$/u),
    z.number().int().positive(),
]).transform(Number).pipe(z.number().int().positive());

const NonnegativeIntegerQuerySchema = z.union([
    z.string().regex(/^(?:0|[1-9]\d*)$/u),
    z.number().int().nonnegative(),
]).transform(Number).pipe(z.number().int().nonnegative());

/** GET /api/agent/jobs 的严格过滤参数。 */
export const AgentJobListQueryDtoSchema = z.object({
    ownerSessionId: PositiveIntegerQuerySchema.optional(),
    status: AgentJobStatusSchema.optional(),
}).strict();

export const AgentJobEventsQueryDtoSchema = z.object({
    eventEpoch: z.string().trim().min(1),
    after: NonnegativeIntegerQuerySchema,
}).strict();

export type AgentJobKind = z.infer<typeof AgentJobKindSchema>;
export type AgentJobStatus = z.infer<typeof AgentJobStatusSchema>;
export type AgentJobDeliveryStatus = z.infer<typeof AgentJobDeliveryStatusSchema>;
export type AgentJobSnapshot = z.infer<typeof AgentJobSnapshotSchema>;
export type AgentJobDetail = z.infer<typeof AgentJobDetailSchema>;
export type AgentJobEventCursor = z.infer<typeof AgentJobEventCursorSchema>;
export type AgentJobStartDto = z.infer<typeof AgentJobStartDtoSchema>;
export type AgentJobListQueryDto = z.infer<typeof AgentJobListQueryDtoSchema>;
export type AgentJobEventsQueryDto = z.infer<typeof AgentJobEventsQueryDtoSchema>;

export type AgentJobStreamEvent =
    | {type: "connected"; eventEpoch: string; latestSeq: number}
    | {type: "snapshot_required"; reason: string}
    | {type: "job_upserted"; job: AgentJobSnapshot}
    | {type: "jobs_removed"; jobIds: string[]};

export type AgentJobEventDto = {
    eventEpoch: string;
    seq: number;
    event: AgentJobStreamEvent;
};

export type AgentJobListResponseDto = {
    jobs: AgentJobSnapshot[];
    eventCursor: AgentJobEventCursor;
};
