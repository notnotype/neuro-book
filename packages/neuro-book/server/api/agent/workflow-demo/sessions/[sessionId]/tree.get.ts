import {createError} from "h3";
import {useWorkflowDemoService} from "nbook/server/agent/workflow/workflow-demo-service";
import {isAgentSessionLifecycleHttpError, requireAgentSessionId, withAgentSessionHttpError} from "nbook/server/agent/http";

/** Workflow demo：参与者 session 的真实树投影（直接读 JSONL 仓库） */
export default defineEventHandler(async (event) => {
    const sessionId = requireAgentSessionId(event);
    try {
        return await withAgentSessionHttpError(
            sessionId,
            () => useWorkflowDemoService().sessionTree(sessionId),
        );
    } catch (error) {
        if (isAgentSessionLifecycleHttpError(error)) {
            throw error;
        }
        throw createError({statusCode: 404, message: error instanceof Error ? error.message : String(error)});
    }
});
