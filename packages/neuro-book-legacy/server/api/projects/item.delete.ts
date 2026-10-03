import {createError} from "h3";
import {consola} from "consola";
import {useAgentHarness} from "nbook/server/agent/http";
import {closeProject, deleteProject, projectOccupancy} from "nbook/server/runtime/product-project";
import {
    isProjectLifecycleLockReleaseFailedError,
    isProjectLifecycleTransactionError,
} from "nbook/server/workspace-files/project-lifecycle";
import {throwProjectHttpError} from "nbook/server/api/projects/project-http-error";
import {requireProjectRefQuery} from "nbook/server/api/projects/project-control-plane";
import type {ProjectDeleteResponseDto} from "nbook/shared/dto/project.dto";

/**
 * 删除 Project Workspace 目录。
 */
export default defineEventHandler(async (event): Promise<ProjectDeleteResponseDto> => {
    const ref = requireProjectRefQuery(event);
    // 占用检查（Task 94 D12，审查后收敛）：仅当有 agent 运行中时拒绝删除——agent 是自主方，
    // 不应把它正在写的项目从脚下删掉。用户自己的 presence 窗口不阻止删除（本地单用户，发起删除者
    // 即在场者，删当前打开的书是正常操作；删除会 close 会话，前端 presence SSE 自然断开）。
    const occupancy = projectOccupancy(ref);
    if (occupancy && occupancy.agentActive) {
        throw createError({
            statusCode: 409,
            message: "项目有 agent 正在运行，请先停止 agent 后再删除",
            data: {code: "PROJECT_IN_USE", projectRoot: ref.projectRoot, ...occupancy},
        });
    }
    try {
        await closeProject(ref, "delete");
        let result: ProjectDeleteResponseDto;
        try {
            result = await deleteProject(ref);
        } catch (error) {
            if (isCommittedDeleteFailure(error)) {
                await archiveDeletedProject(ref.projectRoot);
            }
            throw error;
        }
        await archiveDeletedProject(ref.projectRoot);
        return result;
    } catch (error) {
        throwProjectHttpError(error);
    }
});

/** 判断删除失败是否已经发布 Project absence，只在该状态下归档旧 Session。 */
function isCommittedDeleteFailure(error: unknown): boolean {
    return (isProjectLifecycleTransactionError(error) || isProjectLifecycleLockReleaseFailedError(error))
        && error.operation === "delete"
        && error.committed === true;
}

/** Project 删除已经提交后 best-effort 归档历史 Session，不反向改变删除结果。 */
async function archiveDeletedProject(projectRoot: string): Promise<void> {
    try {
        await useAgentHarness().archiveSessionsByProjectRoot(projectRoot, "project.deleted");
    } catch (error) {
        consola.warn({projectRoot, error}, "删除 Project 后归档 Agent sessions 失败");
    }
}
