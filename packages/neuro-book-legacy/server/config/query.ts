import {createError} from "h3";
import {
    ConfigAgentProfileSettingsQueryDtoSchema,
    ConfigEditorSnapshotQueryDtoSchema,
    ConfigWorkspaceQueryDtoSchema,
    type ConfigAgentProfileSettingsQueryDto,
    type ConfigEditorSnapshotQueryDto,
    type ConfigWorkspaceQueryDto,
} from "nbook/shared/dto/config.dto";

/**
 * 校验 config API query，并把 Zod 错误转换为 HTTP 400。
 */
export function validateConfigWorkspaceQuery(query: unknown): ConfigWorkspaceQueryDto {
    const parsed = ConfigWorkspaceQueryDtoSchema.safeParse(query);
    if (!parsed.success) {
        throw createError({
            statusCode: 400,
            message: parsed.error.issues[0]?.message ?? "配置请求参数不合法",
        });
    }
    return parsed.data;
}

/**
 * 校验设置页编辑快照 query。Phase 0 后 editor-snapshot 不再承载 profile settings 大包。
 */
export function validateConfigEditorSnapshotQuery(query: unknown): ConfigEditorSnapshotQueryDto {
    const parsed = ConfigEditorSnapshotQueryDtoSchema.safeParse(query);
    if (!parsed.success) {
        throw createError({
            statusCode: 400,
            message: parsed.error.issues[0]?.message ?? "配置请求参数不合法",
        });
    }
    return parsed.data;
}

/**
 * 校验 Agent Profile settings 专用接口 query。
 */
export function validateConfigAgentProfileSettingsQuery(query: unknown): ConfigAgentProfileSettingsQueryDto {
    const parsed = ConfigAgentProfileSettingsQueryDtoSchema.safeParse(query);
    if (!parsed.success) {
        throw createError({
            statusCode: 400,
            message: parsed.error.issues[0]?.message ?? "配置请求参数不合法",
        });
    }
    return parsed.data;
}
