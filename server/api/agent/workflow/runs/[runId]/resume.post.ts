import {createError, getRouterParam, readBody} from "h3";
import {useWorkflowDemoService} from "nbook/server/agent/workflow/workflow-demo-service";
import type {JsonValue} from "nbook/server/vendor/nb-workflow/index";

/** 正式 workflow 面：应答 pending ask 并续跑（后台执行，前端继续轮询） */
export default defineEventHandler(async (event) => {
    const runId = getRouterParam(event, "runId");
    if (!runId) throw createError({statusCode: 400, message: "runId 必填"});
    const body = await readBody<{answers?: JsonValue}>(event);
    try {
        useWorkflowDemoService().resume(runId, body?.answers ?? {});
        return {ok: true};
    } catch (error) {
        throw createError({statusCode: 400, message: error instanceof Error ? error.message : String(error)});
    }
});
