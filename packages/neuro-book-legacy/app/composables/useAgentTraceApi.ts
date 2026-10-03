import type {AgentTraceBucketListDto, AgentTraceClearResultDto, AgentTraceIndexListDto, AgentTraceRecentListDto, AgentTraceRecordDto} from "nbook/shared/dto/agent-trace.dto";

/**
 * Pi 请求 trace 查看器 HTTP API。对应 /api/agent/traces/**（只读 + 清空 bucket）。
 */
export function useAgentTraceApi() {
    const listBuckets = () => {
        return $fetch<AgentTraceBucketListDto>("/api/agent/traces");
    };

    const listRecent = (limit?: number) => {
        return $fetch<AgentTraceRecentListDto>("/api/agent/traces/recent", limit ? {query: {limit}} : undefined);
    };

    const listIndex = (bucket: string) => {
        return $fetch<AgentTraceIndexListDto>(`/api/agent/traces/${bucket}`);
    };

    const getRecord = (bucket: string, id: string) => {
        return $fetch<AgentTraceRecordDto>(`/api/agent/traces/${bucket}/${id}`);
    };

    const clearBucket = (bucket: string) => {
        return $fetch<AgentTraceClearResultDto>(`/api/agent/traces/${bucket}`, {method: "DELETE"});
    };

    return {
        clearBucket,
        listBuckets,
        listIndex,
        listRecent,
        getRecord,
    };
}
