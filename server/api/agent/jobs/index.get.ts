import {createError, getQuery} from "h3";
import {useAgentHarness} from "nbook/server/agent/http";
import {AgentJobListQueryDtoSchema} from "nbook/shared/dto/agent-job.dto";

/** 后台任务恢复快照（?ownerSessionId=&status=），游标与列表在同一同步读取中取得。 */
export default defineEventHandler(async (event) => {
    const parsed = AgentJobListQueryDtoSchema.safeParse(getQuery(event));
    if (!parsed.success) {
        throw createError({
            statusCode: 400,
            message: "Agent Job 列表查询参数无效",
            data: {code: "INVALID_AGENT_JOB_LIST_QUERY", issues: parsed.error.issues},
        });
    }
    const harness = useAgentHarness();
    await harness.jobs.recoverInterrupted();
    return harness.jobs.recovery(parsed.data);
});
