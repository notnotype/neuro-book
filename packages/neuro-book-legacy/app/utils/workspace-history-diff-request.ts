export type WorkspaceHistoryDiffRequestMode = "inline" | "full";

export type WorkspaceHistoryDiffRequestIdentity = {
    projectRoot: string;
    path: string;
    revision: number;
    mode: WorkspaceHistoryDiffRequestMode;
};

export type WorkspaceHistoryDiffRequestState<Result> = {
    loading: boolean;
    error: string | null;
    result: Result | null;
};

export type WorkspaceHistoryDiffRequest = {
    key: string;
    generation: number;
    controller: AbortController;
};

/**
 * 生成 diff 缓存与请求身份键。Project、原始相对路径、group revision 和模式缺一不可。
 */
export function workspaceHistoryDiffRequestKey(identity: WorkspaceHistoryDiffRequestIdentity): string {
    return JSON.stringify([identity.projectRoot, identity.path, identity.revision, identity.mode]);
}

/**
 * 管理 Workspace History diff 的版本化请求与逐文件展示状态。
 * invalidate 后旧项目、旧 revision 和旧刷新代次的响应均无法写回。
 */
export class WorkspaceHistoryDiffRequestGuard<Result> {
    private generation = 0;
    private readonly active = new Map<string, WorkspaceHistoryDiffRequest>();
    private readonly states = new Map<string, WorkspaceHistoryDiffRequestState<Result>>();

    /** 发起一次请求；同版本键的旧请求会先中止。 */
    begin(identity: WorkspaceHistoryDiffRequestIdentity): WorkspaceHistoryDiffRequest {
        const key = workspaceHistoryDiffRequestKey(identity);
        this.active.get(key)?.controller.abort();
        const request: WorkspaceHistoryDiffRequest = {
            key,
            generation: this.generation,
            controller: new AbortController(),
        };
        this.active.set(key, request);
        this.states.set(key, {loading: true, error: null, result: null});
        return request;
    }

    /** 返回指定版本键的独立展示状态。 */
    state(identity: WorkspaceHistoryDiffRequestIdentity): WorkspaceHistoryDiffRequestState<Result> {
        return this.states.get(workspaceHistoryDiffRequestKey(identity)) ?? {loading: false, error: null, result: null};
    }

    /** 当前缓存已有结果时无需重复发请求。 */
    cached(identity: WorkspaceHistoryDiffRequestIdentity): Result | null {
        return this.states.get(workspaceHistoryDiffRequestKey(identity))?.result ?? null;
    }

    /** 只允许当前代次、当前版本键的最新请求写回。 */
    accepts(request: WorkspaceHistoryDiffRequest): boolean {
        return request.generation === this.generation
            && !request.controller.signal.aborted
            && this.active.get(request.key) === request;
    }

    /** 成功写回一个版本键的结果。 */
    resolve(request: WorkspaceHistoryDiffRequest, result: Result): boolean {
        if (!this.accepts(request)) {
            return false;
        }
        this.states.set(request.key, {loading: false, error: null, result});
        this.active.delete(request.key);
        return true;
    }

    /** 失败只影响对应版本键，不污染并发文件。 */
    reject(request: WorkspaceHistoryDiffRequest, error: string): boolean {
        if (!this.accepts(request)) {
            return false;
        }
        this.states.set(request.key, {loading: false, error, result: null});
        this.active.delete(request.key);
        return true;
    }

    /** 中止全部在途请求并清空缓存；用于项目切换、Inbox 刷新和组件卸载。 */
    invalidate(): void {
        this.generation += 1;
        for (const request of this.active.values()) {
            request.controller.abort();
        }
        this.active.clear();
        this.states.clear();
    }
}
