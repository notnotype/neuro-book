import {useAgentHarness} from "nbook/server/agent/http";

/** 清除 durable 已结束后台任务；仍待结果回流的 Job 保留。 */
export default defineEventHandler(async () => {
    const harness = useAgentHarness();
    await harness.jobs.recoverInterrupted();
    return {removed: await harness.jobs.clearFinished()};
});
