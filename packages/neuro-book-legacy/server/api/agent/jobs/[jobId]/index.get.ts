import {createError, getRouterParam} from "h3";
import {useAgentHarness} from "nbook/server/agent/http";

/** 单个后台任务快照 */
export default defineEventHandler(async (event) => {
    const jobId = getRouterParam(event, "jobId");
    if (!jobId) throw createError({statusCode: 400, message: "jobId 必填"});
    const harness = useAgentHarness();
    await harness.jobs.recoverInterrupted();
    const job = await harness.jobs.get(jobId);
    if (!job) throw createError({statusCode: 404, message: `job ${jobId} 不存在`});
    return {job};
});
