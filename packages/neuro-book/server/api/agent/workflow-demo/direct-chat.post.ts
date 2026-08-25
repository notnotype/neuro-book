import {createError, readBody} from "h3";
import {useWorkflowDemoService} from "nbook/server/agent/workflow/workflow-demo-service";
import {isAgentSessionLifecycleHttpError, withAgentSessionHttpError} from "nbook/server/agent/http";

/** Workflow demo：RP 轮间用户直聊（写入真实 session 主线，origin=manual） */
export default defineEventHandler(async (event) => {
    const body = await readBody<{sessionId?: number; message?: string}>(event);
    const sessionId = body?.sessionId;
    if (typeof sessionId !== "number" || !Number.isSafeInteger(sessionId) || sessionId <= 0 || !body?.message) {
        throw createError({statusCode: 400, message: "sessionId 与 message 必填"});
    }
    try {
        return await withAgentSessionHttpError(
            sessionId,
            () => useWorkflowDemoService().directChat(sessionId, body.message as string),
        );
    } catch (error) {
        if (isAgentSessionLifecycleHttpError(error)) {
            throw error;
        }
        throw createError({statusCode: 400, message: error instanceof Error ? error.message : String(error)});
    }
});
