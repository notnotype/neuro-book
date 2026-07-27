import {z} from "zod";

/**
 * ComfyUI 生图集成的 wire 契约。
 *
 * 覆盖：连接检查、提示词蒸馏、生图任务生命周期与 SSE 事件、
 * 自定义工作流（API 格式 JSON + 注入点 mapping）以及 RP 正文插图写回。
 */

/** 工作流内单个注入点：API JSON 顶层节点 id + inputs 下的字段名。 */
export const ComfyUiNodeFieldRefDtoSchema = z.object({
    nodeId: z.string().trim().min(1),
    field: z.string().trim().min(1),
});

/**
 * 工作流参数注入点 mapping。某项为 null 表示该参数不注入、使用工作流自带值；
 * positive 为 null 时任务提交会被拒绝（无法注入提示词的生图没有意义）。
 */
export const ComfyUiWorkflowMappingDtoSchema = z.object({
    positive: ComfyUiNodeFieldRefDtoSchema.nullable(),
    negative: ComfyUiNodeFieldRefDtoSchema.nullable(),
    width: ComfyUiNodeFieldRefDtoSchema.nullable(),
    height: ComfyUiNodeFieldRefDtoSchema.nullable(),
    seed: ComfyUiNodeFieldRefDtoSchema.nullable(),
    steps: ComfyUiNodeFieldRefDtoSchema.nullable(),
    cfg: ComfyUiNodeFieldRefDtoSchema.nullable(),
});

/** 连接检查请求。baseURL 缺省时使用已保存的全局配置值。 */
export const ComfyUiCheckRequestDtoSchema = z.object({
    baseURL: z.string().trim().max(500).optional(),
});

/** 连接检查响应，形状与 provider-check 保持一致。 */
export const ComfyUiCheckResponseDtoSchema = z.object({
    success: z.boolean(),
    /** 请求耗时；连接失败时为 null。 */
    latencyMs: z.number().int().nonnegative().nullable(),
    message: z.string().min(1),
});

/** 提示词蒸馏请求：中文（或任意语言）小说文字 → 英文 Anima 风格提示词。 */
export const ComfyUiDistillRequestDtoSchema = z.object({
    text: z.string().trim().min(1).max(8000),
    /** 可选风格提示（如“黄昏、雪景、俯视构图”），拼进蒸馏指令。 */
    styleHint: z.string().trim().max(500).optional(),
});

export const ComfyUiDistillResponseDtoSchema = z.object({
    /** 已拼接质量前缀的完整正向提示词。 */
    positive: z.string().min(1),
    /** 配置的默认负向提示词。 */
    negative: z.string(),
    /** 实际使用的模型 key（providerId/modelId），用于 UI 展示。 */
    modelKey: z.string().min(1),
});

export const ComfyUiJobStatusDtoSchema = z.enum([
    "pending",
    "running",
    "downloading",
    "completed",
    "failed",
    "cancelled",
]);

/** 创建生图任务请求。seed 为 null 时服务端生成随机种子并回显。 */
export const ComfyUiCreateJobRequestDtoSchema = z.object({
    positive: z.string().trim().min(1).max(4000),
    negative: z.string().trim().max(4000).default(""),
    width: z.number().int().min(64).max(4096),
    height: z.number().int().min(64).max(4096),
    steps: z.number().int().min(1).max(150),
    cfg: z.number().min(0).max(30),
    seed: z.number().int().nonnegative().nullable().default(null),
    /** null = 内置 txt2img 模板；否则为已导入工作流 id。 */
    workflowId: z.string().trim().min(1).nullable().default(null),
});

/** 任务产出的单张图片，path 为 project root 相对路径（如 assets/illustrations/xxx.png）。 */
export const ComfyUiJobImageDtoSchema = z.object({
    path: z.string().min(1),
});

export const ComfyUiJobDtoSchema = z.object({
    jobId: z.string().min(1),
    projectPath: z.string().min(1),
    status: ComfyUiJobStatusDtoSchema,
    /** 0-1 采样进度；未开始或不可知时为 null。 */
    progress: z.number().min(0).max(1).nullable(),
    /** 当前执行节点的 class_type，用于进度展示；空闲时为 null。 */
    progressNode: z.string().nullable(),
    /** ComfyUI 返回的 prompt_id；提交前为 null。 */
    promptId: z.string().nullable(),
    params: ComfyUiCreateJobRequestDtoSchema,
    /** 实际使用的种子（请求 seed 为 null 时为服务端随机值）。 */
    resolvedSeed: z.number().int().nonnegative(),
    images: z.array(ComfyUiJobImageDtoSchema),
    /** 失败原因；非 failed 状态为 null。 */
    error: z.string().nullable(),
    createdAt: z.number(),
    updatedAt: z.number(),
});

/** 全局任务 SSE 事件：建连即推全量 snapshot，之后按 job 粒度增量推送。 */
export const ComfyUiJobEventDtoSchema = z.discriminatedUnion("type", [
    z.object({type: z.literal("jobs_snapshot"), jobs: z.array(ComfyUiJobDtoSchema)}),
    z.object({type: z.literal("job_update"), job: ComfyUiJobDtoSchema}),
    z.object({type: z.literal("heartbeat")}),
]);

/** 工作流列表条目（内置模板 + 用户导入）。 */
export const ComfyUiWorkflowSummaryDtoSchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    builtin: z.boolean(),
    mapping: ComfyUiWorkflowMappingDtoSchema,
    /** 自动识别注入点时的告警（识别不全、结构异常等）。 */
    issues: z.array(z.string()),
    /** 内置模板为 null。 */
    updatedAt: z.number().nullable(),
});

/** 导入工作流请求：workflow 是 ComfyUI「导出 API」得到的原始 JSON。 */
export const ComfyUiImportWorkflowRequestDtoSchema = z.object({
    name: z.string().trim().min(1).max(100),
    workflow: z.record(z.string(), z.unknown()),
});

export const ComfyUiUpdateWorkflowRequestDtoSchema = z.object({
    name: z.string().trim().min(1).max(100).optional(),
    mapping: ComfyUiWorkflowMappingDtoSchema.optional(),
});

/** RP 正文插图写回：在指定 tick 的 prose.md 中锚点文字所在段落之后插入图片行。 */
export const RpInsertIllustrationRequestDtoSchema = z.object({
    /** rp/ticks 下的目录名，如 000002-xxx。 */
    tickDir: z.string().trim().min(1).max(200),
    /** 选中文字（截断后），用于在源码中定位插入位置。 */
    anchorText: z.string().trim().min(1).max(500),
    /** 锚点文字在该 tick 渲染文本中第 N 次出现（0-based），解决重复文本歧义。 */
    occurrence: z.number().int().nonnegative().default(0),
    /** project root 相对图片路径。 */
    imagePath: z.string().trim().min(1).max(500),
    alt: z.string().trim().max(200).default(""),
    /** 锚点找不到时的行为：none = 返回 409 由前端确认；append = 追加到该 tick 末尾。 */
    fallback: z.enum(["none", "append"]).default("none"),
});

export const RpInsertIllustrationResponseDtoSchema = z.object({
    /** appended 表示走了 fallback 追加。 */
    mode: z.enum(["anchored", "appended"]),
});

export type ComfyUiNodeFieldRefDto = z.infer<typeof ComfyUiNodeFieldRefDtoSchema>;
export type ComfyUiWorkflowMappingDto = z.infer<typeof ComfyUiWorkflowMappingDtoSchema>;
export type ComfyUiCheckRequestDto = z.infer<typeof ComfyUiCheckRequestDtoSchema>;
export type ComfyUiCheckResponseDto = z.infer<typeof ComfyUiCheckResponseDtoSchema>;
export type ComfyUiDistillRequestDto = z.infer<typeof ComfyUiDistillRequestDtoSchema>;
export type ComfyUiDistillResponseDto = z.infer<typeof ComfyUiDistillResponseDtoSchema>;
export type ComfyUiJobStatusDto = z.infer<typeof ComfyUiJobStatusDtoSchema>;
export type ComfyUiCreateJobRequestDto = z.infer<typeof ComfyUiCreateJobRequestDtoSchema>;
export type ComfyUiJobImageDto = z.infer<typeof ComfyUiJobImageDtoSchema>;
export type ComfyUiJobDto = z.infer<typeof ComfyUiJobDtoSchema>;
export type ComfyUiJobEventDto = z.infer<typeof ComfyUiJobEventDtoSchema>;
export type ComfyUiWorkflowSummaryDto = z.infer<typeof ComfyUiWorkflowSummaryDtoSchema>;
export type ComfyUiImportWorkflowRequestDto = z.infer<typeof ComfyUiImportWorkflowRequestDtoSchema>;
export type ComfyUiUpdateWorkflowRequestDto = z.infer<typeof ComfyUiUpdateWorkflowRequestDtoSchema>;
export type RpInsertIllustrationRequestDto = z.infer<typeof RpInsertIllustrationRequestDtoSchema>;
export type RpInsertIllustrationResponseDto = z.infer<typeof RpInsertIllustrationResponseDtoSchema>;
