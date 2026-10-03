import {createError, getQuery, getRouterParam} from "h3";
import {useWorkflowDemoService} from "nbook/server/agent/workflow/workflow-demo-service";

/** 正式 workflow 面：run 快照 + 增量事件（?after=游标）。
 * 返回收窄为 unknown（F6：RunView 含递归 JsonValue，进类型化路由表会 TS2589 爆栈），
 * 前端用 WorkflowDemoRunState 断言。工具触发与用户触发的 run 都从这里轮询。 */
export default defineEventHandler(async (event): Promise<unknown> => {
    const runId = getRouterParam(event, "runId");
    if (!runId) throw createError({statusCode: 400, message: "runId 必填"});
    const after = Number(getQuery(event).after ?? 0);
    try {
        return await useWorkflowDemoService().runState(runId, Number.isFinite(after) ? after : 0);
    } catch (error) {
        throw createError({statusCode: 404, message: error instanceof Error ? error.message : String(error)});
    }
});
