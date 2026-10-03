import {createError, getRouterParam} from "h3";
import {useAgentHarness} from "nbook/server/agent/http";
import {isValidTraceBucket} from "nbook/server/agent/observability/pi-trace-reader";
import type {AgentTraceClearResultDto} from "nbook/shared/dto/agent-trace.dto";

/**
 * 清空某 bucket 的全部 Pi 请求 trace。必须走 harness 持有的唯一 recorder 实例的串行写
 * 队列（避免与在途写入竞态），不得在 route 里另建 recorder。
 */
export default defineEventHandler(async (event): Promise<AgentTraceClearResultDto> => {
    const bucket = getRouterParam(event, "bucket") ?? "";
    if (!isValidTraceBucket(bucket)) {
        throw createError({statusCode: 400, message: "trace bucket 必须是 sessionId 或 _system"});
    }
    await useAgentHarness().piTraceRecorder.clearBucket(bucket);
    return {ok: true};
});
