import {z} from "zod";
import {isProjectCoverPath} from "nbook/shared/project-cover";

const WINDOWS_DEVICE_NAME_PATTERN = /^(?:con|prn|aux|nul|com[1-9\u00B9\u00B2\u00B3]|lpt[1-9\u00B9\u00B2\u00B3])(?:\..*)?$/iu;
const PROJECT_MANIFEST_RECOVERY_FILE_PATTERN = /^project-manifest-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.yaml$/iu;

/**
 * HTTP 控制面公开的 Project root。
 *
 * 这里只接受 Workspace Root 下的单段目录名；`workspace/<name>` 属于旧 Project Path，
 * 不能继续穿过新的 DTO 边界。Lifecycle 仍负责物理目录与平台 identity 校验。
 */
export const ProjectRootDtoSchema = z.string()
    .min(1, "projectRoot 不能为空")
    .max(255, "projectRoot 过长")
    .refine((value) => !value.includes("/") && !value.includes("\\"), "projectRoot 必须是一级目录名")
    .refine((value) => value !== "." && value !== "..", "projectRoot 不能使用相对路径段")
    .refine((value) => value.toLocaleLowerCase("en-US") !== ".nbook", "projectRoot 使用了保留目录名")
    .refine((value) => !/[<>:"|?*\u0000-\u001F\u007F]/u.test(value), "projectRoot 包含跨平台文件名不允许的字符")
    .refine((value) => !/[. ]$/u.test(value), "projectRoot 不能以点或空格结尾")
    .refine((value) => !WINDOWS_DEVICE_NAME_PATTERN.test(value), "projectRoot 不能使用 Windows 保留设备名");

const ProjectRevisionDtoSchema = z.number().int().positive();

/**
 * 服务端运行期为一次精确 ready 代次签发的公开标识。
 *
 * 不透明、可跨 HTTP 传播；由服务端核验，客户端不能自行构造或改写代次。
 */
export const ProjectReadyIdDtoSchema = z.string().min(1).max(128);

/** Project Workspace 内可携带的封面图片相对路径。 */
export const ProjectCoverPathDtoSchema = z.string()
    .min(1)
    .max(512)
    .refine(isProjectCoverPath, "cover 必须是 Project Workspace 内的 PNG、JPEG 或 WebP 相对路径");

/** 最终 Project 列表、详情与 mutation 共同返回的轻量 manifest metadata。 */
export const ProjectMetadataDtoSchema = z.object({
    projectRoot: ProjectRootDtoSchema,
    kind: z.literal("novel"),
    title: z.string(),
    summary: z.string(),
    /** project.yaml 中显式配置的 Project Workspace 相对封面路径。 */
    cover: ProjectCoverPathDtoSchema.optional(),
    /** 仅表示 project.yaml 的修改时间；缺失时不输出该字段。 */
    manifestUpdatedAt: z.string().datetime({offset: true}).optional(),
}).strict();

/** 可以由用户显式打开并静默 ensure 的一级物理目录。 */
export const ProjectCandidateDtoSchema = z.object({
    projectRoot: ProjectRootDtoSchema,
}).strict();

/** GET /api/projects 的完整轻量 snapshot。 */
export const ProjectListResponseDtoSchema = z.object({
    revision: ProjectRevisionDtoSchema,
    projects: z.array(ProjectMetadataDtoSchema),
}).strict();

/** GET /api/projects/candidates 的同代候选投影。 */
export const ProjectCandidatesResponseDtoSchema = z.object({
    revision: ProjectRevisionDtoSchema,
    candidates: z.array(ProjectCandidateDtoSchema),
}).strict();

/** POST /api/projects 按标题创建 Project；projectRoot 由服务端稳定派生。 */
export const ProjectCreateRequestDtoSchema = z.object({
    title: z.string().trim().min(1, "title 不能为空").max(120, "title 过长"),
    summary: z.string().trim().max(2_000, "summary 过长").optional(),
}).strict();

/** create 与 metadata update 都只返回已发布的轻量 Project 事实。 */
export const ProjectMutationResponseDtoSchema = z.object({
    revision: ProjectRevisionDtoSchema,
    project: ProjectMetadataDtoSchema,
}).strict();

export const ProjectCreateResponseDtoSchema = ProjectMutationResponseDtoSchema;

/** PATCH /api/projects/item 原子更新 NeuroBook 拥有的 manifest metadata。 */
export const ProjectUpdateRequestDtoSchema = z.object({
    title: z.string().trim().min(1, "title 不能为空").max(120, "title 过长").optional(),
    /** 空字符串表示显式清空 summary。 */
    summary: z.string().trim().max(2_000, "summary 过长").optional(),
}).strict().refine(
    (value) => value.title !== undefined || value.summary !== undefined,
    {message: "至少需要 title 或 summary 之一"},
);

export const ProjectUpdateResponseDtoSchema = ProjectMutationResponseDtoSchema;

/** POST /api/projects/open 的结构化 Project identity。 */
export const ProjectOpenRequestDtoSchema = z.object({
    projectRoot: ProjectRootDtoSchema,
}).strict();

const ProjectOpenBaseShape = {
    revision: ProjectRevisionDtoSchema,
    project: ProjectMetadataDtoSchema,
    /** 本次 open 发布的精确 ready 代次标识；presence 必须回报同一个值。 */
    publicId: ProjectReadyIdDtoSchema,
};

/**
 * open 返回最终 Project publication；manifest 被修复时同时提供一次性恢复提示依据。
 * recoveryPath 是 Workspace Root-relative 地址，不是绝对文件系统路径。
 */
export const ProjectOpenResponseDtoSchema = z.discriminatedUnion("change", [
    z.object({
        ...ProjectOpenBaseShape,
        change: z.enum(["none", "created"]),
    }).strict(),
    z.object({
        ...ProjectOpenBaseShape,
        change: z.enum(["normalized", "recovered"]),
        recoveryPath: z.string().min(1),
    }).strict(),
]).superRefine((value, context) => {
    if (value.change !== "normalized" && value.change !== "recovered") {
        return;
    }
    const segments = value.recoveryPath.split("/");
    if (
        segments.length !== 4
        || segments[0] !== value.project.projectRoot
        || segments[1] !== ".nbook"
        || segments[2] !== "recovery"
        || !PROJECT_MANIFEST_RECOVERY_FILE_PATTERN.test(segments[3] ?? "")
    ) {
        context.addIssue({
            code: "custom",
            path: ["recoveryPath"],
            message: "recoveryPath 必须是当前 Project 的 manifest recovery 相对路径",
        });
    }
});

/** GET /api/projects/presence 首帧：服务端接受 presence 时回报与 open 相同的精确 ready 标识。 */
export const ProjectPresenceReadyEventDtoSchema = z.object({
    type: z.literal("presence_ready"),
    projectRoot: ProjectRootDtoSchema,
    publicId: ProjectReadyIdDtoSchema,
}).strict();

/** presence SSE 周期心跳；不携带代次，不能用于判定 ready。 */
export const ProjectPresenceHeartbeatEventDtoSchema = z.object({
    type: z.literal("heartbeat"),
}).strict();

/** presence SSE 的稳定事件合同；服务端推送与前端解析共用同一 schema 事实。 */
export type ProjectPresenceEventDto =
    | z.infer<typeof ProjectPresenceReadyEventDtoSchema>
    | z.infer<typeof ProjectPresenceHeartbeatEventDtoSchema>;

/** 显式关闭当前进程内的 ProjectSession；close 不等同于 delete。 */
export const ProjectCloseRequestDtoSchema = z.object({
    projectRoot: ProjectRootDtoSchema,
}).strict();

export const ProjectCloseResponseDtoSchema = z.object({
    success: z.literal(true),
    projectRoot: ProjectRootDtoSchema,
}).strict();

/** DELETE /api/projects/item 的结构化目标。 */
export const ProjectDeleteRequestDtoSchema = z.object({
    projectRoot: ProjectRootDtoSchema,
}).strict();

/** delete 成功后返回已发布的 absence revision。 */
export const ProjectDeleteResponseDtoSchema = z.object({
    revision: ProjectRevisionDtoSchema,
    projectRoot: ProjectRootDtoSchema,
}).strict();

export type ProjectRootDto = z.infer<typeof ProjectRootDtoSchema>;
export type ProjectMetadataDto = z.infer<typeof ProjectMetadataDtoSchema>;
export type ProjectCandidateDto = z.infer<typeof ProjectCandidateDtoSchema>;
export type ProjectListResponseDto = z.infer<typeof ProjectListResponseDtoSchema>;
export type ProjectCandidatesResponseDto = z.infer<typeof ProjectCandidatesResponseDtoSchema>;
export type ProjectMutationResponseDto = z.infer<typeof ProjectMutationResponseDtoSchema>;
export type ProjectCreateRequestDto = z.infer<typeof ProjectCreateRequestDtoSchema>;
export type ProjectCreateResponseDto = z.infer<typeof ProjectCreateResponseDtoSchema>;
export type ProjectUpdateRequestDto = z.infer<typeof ProjectUpdateRequestDtoSchema>;
export type ProjectUpdateResponseDto = z.infer<typeof ProjectUpdateResponseDtoSchema>;
export type ProjectOpenRequestDto = z.infer<typeof ProjectOpenRequestDtoSchema>;
export type ProjectOpenResponseDto = z.infer<typeof ProjectOpenResponseDtoSchema>;
export type ProjectCloseRequestDto = z.infer<typeof ProjectCloseRequestDtoSchema>;
export type ProjectCloseResponseDto = z.infer<typeof ProjectCloseResponseDtoSchema>;
export type ProjectDeleteRequestDto = z.infer<typeof ProjectDeleteRequestDtoSchema>;
export type ProjectDeleteResponseDto = z.infer<typeof ProjectDeleteResponseDtoSchema>;
