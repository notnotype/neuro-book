import {getQuery} from "h3";
import {useAgentHarness} from "nbook/server/agent/http";
import {PiTraceReader} from "nbook/server/agent/observability/pi-trace-reader";
import type {AgentTraceRecentListDto} from "nbook/shared/dto/agent-trace.dto";

/**
 * 跨所有 bucket 聚合最近的 Pi 请求 trace（按 ts 倒序）。?limit= 默认 50，钳制 1..200。
 * 静态段 `recent` 稳定优先于同级参数路由 `[bucket]`（radix3 静态路由表优先）。
 */
export default defineEventHandler(async (event): Promise<AgentTraceRecentListDto> => {
    const rawLimit = Number(getQuery(event).limit);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 200) : 50;
    const reader = new PiTraceReader({tracesRoot: useAgentHarness().repo.tracesRoot});
    return {entries: await reader.listRecent(limit)};
});
