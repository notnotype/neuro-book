import type {AgentSessionListQueryDto} from "nbook/shared/dto/agent-session.dto";

export type AgentSessionListRequest = {
    id: number;
    generation: number;
    append: boolean;
    signature: string;
    pageKey?: string;
    shouldFetch: boolean;
};

/**
 * 生成 session 列表查询签名。offset 不属于签名，load-more 需要和第一页共享同一组筛选条件。
 */
export function sessionListQuerySignature(query: AgentSessionListQueryDto): string {
    return JSON.stringify({
        scope: query.scope ?? "all",
        projectRoot: query.projectRoot ?? "",
        includeArchived: query.includeArchived === true,
        includeSystem: query.includeSystem === true,
        profileKey: query.profileKey ?? "",
        profileGroup: query.profileGroup ?? "",
        status: query.status ?? "",
        relation: query.relation ?? "",
        search: query.search?.trim() ?? "",
        limit: query.limit ?? null,
    });
}

/**
 * 保护 Agent session 列表分页请求，避免旧搜索、旧筛选和旧加载更多响应覆盖当前列表。
 */
export class AgentSessionListRequestGuard {
    private generation = 0;
    private nextRequestId = 0;
    private latestReplaceRequestId = 0;
    private activeSignature = "";
    private readonly runningRequestIds = new Set<number>();
    private readonly pendingAppendPageKeys = new Set<string>();
    private readonly appliedAppendPageKeys = new Set<string>();

    /**
     * 登记一次即将发起的查询。
     */
    begin(query: AgentSessionListQueryDto): AgentSessionListRequest {
        const append = (query.offset ?? 0) > 0;
        const signature = sessionListQuerySignature(query);
        const pageKey = append ? `${signature}::${query.offset ?? 0}` : undefined;
        const request = {
            id: this.nextRequestId + 1,
            generation: this.generation,
            append,
            signature,
            ...(pageKey ? {pageKey} : {}),
            shouldFetch: !append
                || (signature === this.activeSignature
                    && !this.pendingAppendPageKeys.has(pageKey ?? "")
                    && !this.appliedAppendPageKeys.has(pageKey ?? "")),
        };
        this.nextRequestId = request.id;
        if (!append) {
            this.latestReplaceRequestId = request.id;
            this.activeSignature = signature;
            this.pendingAppendPageKeys.clear();
            this.appliedAppendPageKeys.clear();
        } else if (request.shouldFetch && pageKey) {
            this.pendingAppendPageKeys.add(pageKey);
        }
        return request;
    }

    /**
     * 标记请求进入网络阶段。
     */
    start(request: AgentSessionListRequest): void {
        if (request.generation === this.generation) {
            this.runningRequestIds.add(request.id);
        }
    }

    /**
     * 标记请求结束，并返回当前是否仍有列表请求在途。
     */
    finish(request?: AgentSessionListRequest): boolean {
        if (!request || request.generation !== this.generation) {
            return this.runningRequestIds.size > 0;
        }
        if (request?.pageKey) {
            this.pendingAppendPageKeys.delete(request.pageKey);
        }
        this.runningRequestIds.delete(request.id);
        return this.runningRequestIds.size > 0;
    }

    /**
     * 判断响应是否仍可应用到当前列表。
     */
    accepts(request: AgentSessionListRequest): boolean {
        if (request.generation !== this.generation) {
            return false;
        }
        if (request.append) {
            const pageKey = request.pageKey;
            if (!pageKey) {
                return false;
            }
            return request.signature === this.activeSignature
                && this.pendingAppendPageKeys.has(pageKey);
        }
        return request.id === this.latestReplaceRequestId
            && request.signature === this.activeSignature;
    }

    /**
     * 记录已成功应用的追加页，避免同一页被重复追加。
     */
    markApplied(request: AgentSessionListRequest): void {
        if (request.pageKey) {
            this.appliedAppendPageKeys.add(request.pageKey);
            this.pendingAppendPageKeys.delete(request.pageKey);
        }
    }

    /** Project scope 重置时使全部旧列表请求和旧 finally 立即失效。 */
    invalidate(): void {
        this.generation += 1;
        this.latestReplaceRequestId = 0;
        this.activeSignature = "";
        this.runningRequestIds.clear();
        this.pendingAppendPageKeys.clear();
        this.appliedAppendPageKeys.clear();
    }
}
