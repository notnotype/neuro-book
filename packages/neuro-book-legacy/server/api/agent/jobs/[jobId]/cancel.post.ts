import {createError, getRouterParam} from "h3";
import {useAgentHarness} from "nbook/server/agent/http";

/** 请求取消后台任务；最终 cancelled 状态在底层执行链完成有界收口后确认。 */
export default defineEventHandler(async (event) => {
    const jobId = getRouterParam(event, "jobId");
    if (!jobId) throw createError({statusCode: 400, message: "jobId 必填"});
    try {
        const harness = useAgentHarness();
        await harness.jobs.recoverInterrupted();
        return {job: await harness.jobs.cancel(jobId)};
    } catch (error) {
        throw createError({statusCode: 400, message: error instanceof Error ? error.message : String(error)});
    }
});
