import {createError, getQuery} from "h3";
import {useAgentHarness} from "nbook/server/agent/http";
import {writeAgentEventStream} from "nbook/server/agent/events/agent-sse-writer";
import {AgentJobEventsQueryDtoSchema} from "nbook/shared/dto/agent-job.dto";

/** 订阅无过滤的全局 Job 事件流；HTTP 快照是恢复真相。 */
export default defineEventHandler(async (event) => {
    const parsed = AgentJobEventsQueryDtoSchema.safeParse(getQuery(event));
    if (!parsed.success) {
        throw createError({
            statusCode: 400,
            message: "Agent Job 事件游标无效",
            data: {code: "INVALID_AGENT_JOB_EVENTS_QUERY", issues: parsed.error.issues},
        });
    }
    const query = parsed.data;
    const harness = useAgentHarness();
    await harness.jobs.recoverInterrupted();
    const subscription = harness.jobs.subscribeEvents({
        eventEpoch: query.eventEpoch,
        after: query.after,
    });
    await writeAgentEventStream(event.node.res, subscription);
});
