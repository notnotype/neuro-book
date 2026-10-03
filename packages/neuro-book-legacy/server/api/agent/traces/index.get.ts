import {useAgentHarness} from "nbook/server/agent/http";
import {PiTraceReader} from "nbook/server/agent/observability/pi-trace-reader";
import type {AgentTraceBucketListDto} from "nbook/shared/dto/agent-trace.dto";

/**
 * 列出有 Pi 请求 trace 的 bucket（sessionId 或 _system），按最新记录时间倒序。
 */
export default defineEventHandler(async (): Promise<AgentTraceBucketListDto> => {
    const reader = new PiTraceReader({tracesRoot: useAgentHarness().repo.tracesRoot});
    return {buckets: await reader.listBuckets()};
});
