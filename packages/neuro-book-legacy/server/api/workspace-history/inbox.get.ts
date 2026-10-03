import {createError, getQuery} from "h3";
import {withProjectHandlesOperation} from "nbook/server/workspace-files/project-open-guard";
import {LOCAL_USER_ID} from "nbook/server/workspace-history/project-history";
import {toWorkspaceHistoryInboxGroupDto} from "nbook/server/workspace-history/history-dto";
import {workspaceHistoryInboxRevision} from "nbook/server/workspace-history/history-inbox";
import type {WorkspaceHistoryInboxDto} from "nbook/shared/dto/workspace-history.dto";

/**
 * 用户收件箱：列出有未接受 agent/system 变更的项目文件分组（userId 服务端固定 local，D10）。
 * history 未启用时返回空列表。
 */
export default defineEventHandler(async (event): Promise<WorkspaceHistoryInboxDto> => {
    const query = getQuery(event);
    if (typeof query.projectRoot !== "string" || !query.projectRoot.trim()) {
        throw createError({statusCode: 400, message: "projectRoot 不能为空"});
    }
    return withProjectHandlesOperation(query.projectRoot, async (projectHandles) => {
        await projectHandles.history.waitForWarmup();
        const history = await projectHandles.history.history;
        if (!history) {
            return {revision: 0, groups: []};
        }
        const groups = await history.inbox(LOCAL_USER_ID);
        return {
            revision: workspaceHistoryInboxRevision(groups),
            groups: groups.map(toWorkspaceHistoryInboxGroupDto),
        };
    });
});
