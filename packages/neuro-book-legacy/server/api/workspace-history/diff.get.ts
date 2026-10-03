import {createError, getQuery} from "h3";
import {z} from "zod";
import {ProjectRootDtoSchema} from "nbook/shared/dto/project.dto";
import {withProjectHandlesOperation} from "nbook/server/workspace-files/project-open-guard";
import {LOCAL_USER_ID} from "nbook/server/workspace-history/project-history";
import {toWorkspaceHistoryInboxGroupDto} from "nbook/server/workspace-history/history-dto";
import {matchWorkspaceHistoryInboxGroup} from "nbook/server/workspace-history/history-inbox";
import {readWorkspaceHistoryDiff, type WorkspaceHistoryDiffMode} from "nbook/server/workspace-history/history-diff";
import type {WorkspaceHistoryDiffDto} from "nbook/shared/dto/workspace-history.dto";

/**
 * 按当前用户 inbox path 读取安全 diff。
 * path 既是授权边界也是敏感内容策略输入，不再接受可绕过路径策略的裸 snapshot hash。
 */
export default defineEventHandler(async (event): Promise<WorkspaceHistoryDiffDto> => {
    const query = z.object({
        projectRoot: ProjectRootDtoSchema,
        path: z.string().trim().min(1, "path 不能为空"),
        revision: z.coerce.number().int().positive("revision 必须是正整数"),
        mode: z.enum(["inline", "full"]),
    }).parse(getQuery(event));
    const relativePath = query.path;
    const mode: WorkspaceHistoryDiffMode = query.mode;
    return withProjectHandlesOperation(query.projectRoot, async (projectHandles) => {
        await projectHandles.history.waitForWarmup();
        const history = await projectHandles.history.history;
        if (!history) {
            return {status: "unavailable", reason: "history_disabled"};
        }
        const match = matchWorkspaceHistoryInboxGroup(await history.inbox(LOCAL_USER_ID), relativePath, query.revision);
        if (match.kind === "missing") {
            throw createError({statusCode: 404, message: "待审文件不存在或已被接受"});
        }
        if (match.kind === "stale") {
            throw createError({statusCode: 412, message: "文件已发生新变化，请刷新后重新审查"});
        }
        return readWorkspaceHistoryDiff({history, group: toWorkspaceHistoryInboxGroupDto(match.group), mode});
    });
});
