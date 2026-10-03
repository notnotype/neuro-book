import {createError} from "h3";
import {closeProject, projectOccupancy} from "nbook/server/runtime/product-project";
import {throwProjectHttpError} from "nbook/server/api/projects/project-http-error";
import {requireProjectRefBody} from "nbook/server/api/projects/project-control-plane";
import type {ProjectCloseResponseDto} from "nbook/shared/dto/project.dto";

/**
 * 显式关闭当前 Project 会话。close 不等同于 delete，只释放本进程内的 ProjectSession。
 *
 * 调用方应先断开自己的 presence SSE 再调用本接口；此时仍存在的 userConnections 属于
 * 其他标签页。按已冻结的决定，其他 user presence 或运行中的 agent 存在时返回
 * `PROJECT_IN_USE`，不强制把它们踢掉。
 *
 * Project 本就未打开时按幂等处理返回成功，避免前端在竞态下反复重试。
 */
export default defineEventHandler(async (event): Promise<ProjectCloseResponseDto> => {
    const ref = await requireProjectRefBody(event);
    const occupancy = projectOccupancy(ref);
    if (!occupancy) {
        return {success: true, projectRoot: ref.projectRoot};
    }
    if (occupancy.userConnections > 0 || occupancy.agentActive) {
        throw createError({
            statusCode: 409,
            message: occupancy.agentActive
                ? "项目有 agent 正在运行，请先停止 agent 后再关闭"
                : "项目仍被其他窗口打开，已保持打开状态",
            data: {code: "PROJECT_IN_USE", projectRoot: ref.projectRoot, ...occupancy},
        });
    }
    try {
        await closeProject(ref, "user");
        return {success: true, projectRoot: ref.projectRoot};
    } catch (error) {
        throwProjectHttpError(error);
    }
});
