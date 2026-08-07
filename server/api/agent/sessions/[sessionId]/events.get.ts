import {getQuery} from "h3";
import {requireAgentSessionId, subscribeAgentSessionEvents} from "nbook/server/agent/http";
import {writeAgentEventStream} from "nbook/server/agent/events/agent-sse-writer";
import {AgentSessionEventsQueryDtoSchema} from "nbook/shared/dto/agent-session.dto";
import {readProductShutdownSignal, type ProductHttpShutdownEvent} from "nbook/server/runtime/shutdown/product-http-lifecycle";

/**
 * 订阅 Agent session event envelope。snapshot 才是恢复真相，事件只做增量同步。
 */
export default defineEventHandler(async (event) => {
    const sessionId = requireAgentSessionId(event);
    const query = AgentSessionEventsQueryDtoSchema.parse(getQuery(event));
    const subscription = subscribeAgentSessionEvents(sessionId, {
        eventEpoch: query.eventEpoch,
        after: query.after,
    });
    await writeAgentEventStream(
        event.node.res,
        subscription,
        {shutdownSignal: readProductShutdownSignal(event as unknown as ProductHttpShutdownEvent)},
    );
});
