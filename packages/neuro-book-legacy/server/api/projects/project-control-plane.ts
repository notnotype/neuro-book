import {createError, getQuery, type H3Event} from "h3";
import {z} from "zod";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {
    ProjectReadyIdDtoSchema,
    ProjectRootDtoSchema,
    type ProjectMetadataDto,
} from "nbook/shared/dto/project.dto";
import {projectWorkspaceRef, type ProjectWorkspaceRef} from "nbook/server/workspace-files/project-identity";
import type {ProjectListEntry} from "nbook/server/workspace-files/project-lifecycle";

const ProjectRootBodySchema = z.object({projectRoot: ProjectRootDtoSchema});

/** presence 必须同时带上 open 发布的精确 ready 标识；只给 projectRoot 不允许取得当前代次。 */
const ProjectReadyQuerySchema = z.object({
    projectRoot: ProjectRootDtoSchema,
    publicId: ProjectReadyIdDtoSchema,
}).strict();

/**
 * Project 控制面的唯一 identity 入口。
 *
 * 公开合同只接受单段 `projectRoot`；这里同时完成 schema 校验与结构化收窄，
 * 之后的调用链一律传 `ProjectWorkspaceRef`，不再出现裸字符串。
 */
export function requireProjectRefQuery(event: H3Event): ProjectWorkspaceRef {
    const parsed = ProjectRootBodySchema.safeParse(getQuery(event));
    if (!parsed.success) {
        throw createError({
            statusCode: 400,
            message: parsed.error.issues[0]?.message ?? "projectRoot 不合法",
            data: {code: "INVALID_PROJECT_ROOT"},
        });
    }
    return projectWorkspaceRef(parsed.data.projectRoot);
}

/** 读取 presence 的结构化 identity 与 open 发布的精确 ready 标识。 */
export function requireProjectReadyQuery(event: H3Event): {
    readonly ref: ProjectWorkspaceRef;
    readonly publicId: string;
} {
    const parsed = ProjectReadyQuerySchema.safeParse(getQuery(event));
    if (!parsed.success) {
        throw createError({
            statusCode: 400,
            message: parsed.error.issues[0]?.message ?? "Project ready 查询不合法",
            data: {code: "INVALID_PROJECT_READY_QUERY"},
        });
    }
    return {ref: projectWorkspaceRef(parsed.data.projectRoot), publicId: parsed.data.publicId};
}

/** 从请求体读取结构化 Project identity。 */
export async function requireProjectRefBody(event: H3Event): Promise<ProjectWorkspaceRef> {
    const body = await validateBody(event, ProjectRootBodySchema);
    return projectWorkspaceRef(body.projectRoot);
}

/** Lifecycle 列表项投影为最终轻量 DTO；不携带任何内容统计。 */
export function toProjectMetadataDto(entry: ProjectListEntry): ProjectMetadataDto {
    return {
        projectRoot: entry.projectRoot,
        kind: entry.kind,
        title: entry.title,
        summary: entry.summary,
        ...(entry.cover === undefined ? {} : {cover: entry.cover}),
        ...(entry.manifestUpdatedAt === undefined ? {} : {manifestUpdatedAt: entry.manifestUpdatedAt}),
    };
}
