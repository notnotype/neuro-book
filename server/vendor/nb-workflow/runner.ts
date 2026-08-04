import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { fingerprint } from "./fingerprint";
import type { AgentInvokeOutcome, WorkflowPorts, WorkspacePort } from "./ports";
import type {
    ActivityRecord, AskSpec, ChartOp, EntryId, InvokeOptions, InvokeResult, JsonValue, PendingAsk,
    ProgressState, RunStatus, RunView, SessionHandle, SessionId, Wf, WorkflowDefinition,
} from "./types";

/** ask 无应答时抛出的挂起信号：run 转 waiting，落盘退内存（spike 中即留在 RunRecord） */
export class SuspendSignal extends Error {
    constructor() {
        super("workflow 挂起等待人类应答");
        this.name = "SuspendSignal";
    }
}

/** cancel(runId) 请求后，Run signal 先取消 Agent activity，activity 边界再归约为 cancelled。 */
export class WorkflowCancelledError extends Error {
    constructor() {
        super("workflow run 被取消");
        this.name = "WorkflowCancelledError";
    }
}

/** 分支上下文：并发分支各持独立路径，seq 按路径计数，与完成顺序无关 */
const branchContext = new AsyncLocalStorage<{ path: string }>();

type RunRecord = {
    runId: string;
    def: WorkflowDefinition;
    args: JsonValue;
    callerSessionId: SessionId | null;
    /** 运行时取消请求：Agent activity 通过 signal 尽快收口，当前 execute 结束时归约为 cancelled。 */
    abortRequested?: boolean;
    /** Run 级取消信号：所有并发 Agent activity 共享，由 cancel(runId) 触发。 */
    abortController: AbortController;
    /** 外部调用方 signal 的解绑函数；waiting 期间保留，终态时释放。 */
    removeExternalAbort?: () => void;
    /** run 级默认模型：agents.create 未显式指定 model 时使用（"provider/model" key） */
    defaultModel: string | null;
    /** run 级 workspace 端口：覆盖 RunEnv.workspace（面 B 场景按发起方 workspace 注入） */
    workspace: WorkspacePort | null;
    status: RunStatus;
    result?: JsonValue;
    error?: string;
    /** key -> record；journal 跨执行持久，重放按它命中 */
    journal: Map<string, ActivityRecord>;
    pendingAsks: PendingAsk[];
    logs: string[];
    progress: ProgressState | null;
};

/** 单次执行（首跑或 resume 重放）内的易变状态；每次 execute 重建 */
class ExecutionState {
    /** 路径 -> 下一个 seq；重放时脚本确定性保证计数一致 */
    counters = new Map<string, number>();
    /** 路径 -> 首个不匹配 seq；该 seq 起本路径后缀失效转真跑 */
    dirtyFrom = new Map<string, number>();
    /** 本 run 创建且 ephemeral 的 session，run 成功后归档 */
    ephemeral = new Set<SessionId>();

    nextSeq(path: string): number {
        const seq = this.counters.get(path) ?? 0;
        this.counters.set(path, seq + 1);
        return seq;
    }
}

/** 执行运行时：Activity 包装器 + 锁 + 挂起登记，供 wf 面与 Handle 共用 */
class Runtime {
    constructor(
        readonly run: RunRecord,
        readonly exec: ExecutionState,
        readonly ports: WorkflowPorts,
        readonly env: RunEnv,
    ) {}

    path(): string {
        return branchContext.getStore()?.path ?? "root";
    }

    /** 当前 Run 的取消信号；AgentPort 用它精确取消本 Run 拥有的 invocation。 */
    get signal(): AbortSignal {
        return this.run.abortController.signal;
    }

    /** activity 提交前后的统一取消门禁。 */
    private assertRunning(): void {
        if (this.run.abortRequested || this.signal.aborted) throw new WorkflowCancelledError();
    }

    /**
     * Activity 核心：ActivityKey = (路径, 序号, kind, 参数指纹)。
     * 全匹配 → 返回记录值；不匹配 → 本路径从该 seq 起后缀失效，转真实执行。
     * spike 只记成功：错误不落 journal，重跑时重执行（发现 F4）。
     */
    async activity<T extends JsonValue>(kind: string, params: JsonValue, fn: () => Promise<T>): Promise<T> {
        this.assertRunning();
        const path = this.path();
        const seq = this.exec.nextSeq(path);
        const key = `${path}#${seq}`;
        const fp = fingerprint(params);
        const dirty = this.exec.dirtyFrom.get(path);
        const cached = this.run.journal.get(key);
        if (cached && (dirty === undefined || seq < dirty)) {
            if (cached.kind === kind && cached.fingerprint === fp) {
                this.env.onEvent?.({ type: "activity", runId: this.run.runId, record: cached, cached: true });
                return cached.result as T;
            }
            this.exec.dirtyFrom.set(path, seq);
            this.run.journal.delete(key);
        }
        this.env.onEvent?.({ type: "activity_started", runId: this.run.runId, key, path, seq, kind, fingerprint: fp });
        const result = await fn();
        // cancel 与 activity 完成竞争时，迟到成功不得进入 journal。
        this.assertRunning();
        const record: ActivityRecord = { key, path, seq, kind, fingerprint: fp, result };
        this.run.journal.set(key, record);
        this.env.onEvent?.({ type: "activity", runId: this.run.runId, record, cached: false });
        return result;
    }

    /** ask 专用：命中 journal 直接返回应答；miss 则登记 pending 并抛挂起信号 */
    async askActivity(spec: AskSpec): Promise<JsonValue> {
        const path = this.path();
        const seq = this.exec.nextSeq(path);
        const key = `${path}#${seq}`;
        const fp = fingerprint(spec as unknown as JsonValue);
        const cached = this.run.journal.get(key);
        if (cached && cached.kind === "ask" && cached.fingerprint === fp) {
            this.env.onEvent?.({ type: "activity", runId: this.run.runId, record: cached, cached: true });
            return cached.result;
        }
        const pending: PendingAsk = { key, path, seq, fingerprint: fp, spec };
        this.run.pendingAsks.push(pending);
        this.env.onEvent?.({ type: "ask_pending", runId: this.run.runId, ask: pending });
        throw new SuspendSignal();
    }

    /** run 持锁到结束/挂起；重放命中的 open/acquire/create 也要重新加锁（锁是运行时态，不进 journal） */
    async lock(sessionId: SessionId): Promise<void> {
        await this.ports.sessions.lock(sessionId, this.run.runId);
    }
}

/**
 * SessionHandle：持显式游标。append/invoke 锚定游标而非全局 active leaf，
 * 这样挂起期间用户直接对话移动了 active leaf，重放也不会错位（发现 F2）。
 */
class Handle implements SessionHandle {
    private cursor: EntryId | null;

    constructor(private rt: Runtime, readonly id: SessionId, initialLeaf: EntryId | null) {
        this.cursor = initialLeaf;
    }

    leaf(): EntryId | null {
        return this.cursor;
    }

    async transcript(opts?: { tail?: number }): Promise<import("./types").SessionEntry[]> {
        const full = await this.rt.activity("sessions.transcript", { id: this.id, cursor: this.cursor, tail: opts?.tail ?? null },
            async () => await this.rt.ports.sessions.transcript(this.id, this.cursor) as unknown as JsonValue);
        const list = full as unknown as import("./types").SessionEntry[];
        return opts?.tail ? list.slice(-opts.tail) : list;
    }

    async checkout(entryId: EntryId): Promise<void> {
        await this.rt.activity("sessions.checkout", { id: this.id, entryId }, async () => {
            await this.rt.ports.sessions.setActiveLeaf(this.id, entryId);
            return null;
        });
        this.cursor = entryId;
    }

    async append(msg: { role: "user" | "assistant"; message?: string; input?: JsonValue }): Promise<EntryId> {
        const parent = this.cursor;
        const id = await this.rt.activity("sessions.append",
            { id: this.id, role: msg.role, message: msg.message ?? null, input: msg.input ?? null },
            async () => await this.rt.ports.sessions.append(this.id, parent, {
                role: msg.role, message: msg.message, input: msg.input, origin: "workflow",
            }));
        this.cursor = id;
        return id;
    }

    async invoke(opts: InvokeOptions): Promise<InvokeResult> {
        const parent = this.cursor;
        const out = await this.rt.activity("agents.invoke",
            { id: this.id, mode: opts.mode ?? "prompt", message: opts.message ?? null, input: opts.input ?? null },
            async () => await this.rt.ports.agents.invoke(this.id, parent, {...opts, signal: this.rt.signal}) as unknown as JsonValue,
        ) as unknown as AgentInvokeOutcome;
        this.cursor = out.newLeaf;
        return { status: out.status, result: { message: out.message, data: out.data } };
    }

    async excursion<T>(at: EntryId | "leaf", fn: (branch: SessionHandle) => Promise<T>): Promise<T> {
        const origin = this.cursor;
        if (at !== "leaf") await this.checkout(at);
        try {
            return await fn(this);
        } finally {
            // 异常（含挂起）也恢复原位，旁支留在树上可追溯
            if (origin !== null) await this.checkout(origin);
        }
    }
}

/**
 * 运行时事件流：接入 NeuroBook 后对应 session-event-hub / SSE 公开投影的前置形态。
 * activity 事件带 cached 标记：replay 命中 = true（前端可用快闪表现"缓存命中"）。
 */
export type WorkflowEvent =
    | { type: "status"; runId: string; status: RunStatus }
    /** 真实执行开始（缓存命中不发）：前端据此渲染"进行中"节点，并发在图上可见；fingerprint 供观测层解参数打标签 */
    | { type: "activity_started"; runId: string; key: string; path: string; seq: number; kind: string; fingerprint: string }
    | { type: "activity"; runId: string; record: ActivityRecord; cached: boolean }
    | { type: "ask_pending"; runId: string; ask: PendingAsk }
    | { type: "log"; runId: string; message: string }
    | { type: "progress"; runId: string; state: ProgressState }
    /** 状态图观测（wf.chart）：声明与 token 移动，前端据此渲染并发状态图 */
    | { type: "chart"; runId: string; op: ChartOp };

export type RunEnv = {
    /** wf.workspace.read 的数据源；未提供时 read 抛错 */
    workspace?: WorkspacePort;
    /** 运行时事件订阅（SSE 前置形态） */
    onEvent?: (event: WorkflowEvent) => void;
};

/** 组装 V1 收敛面的 wf 根对象 */
function createWf(rt: Runtime, args: JsonValue): Wf {
    const openHandle = async (sessionId: SessionId): Promise<SessionHandle> => {
        const out = await rt.activity("sessions.open", { id: sessionId },
            async () => ({ leafId: await rt.ports.sessions.activeLeaf(sessionId) })) as { leafId: EntryId | null };
        await rt.lock(sessionId);
        return new Handle(rt, sessionId, out.leafId);
    };

    return {
        args,
        agents: {
            profile: (profileKey) => rt.activity("agents.profile", { profileKey }, async () => rt.ports.agents.profileInfo(profileKey)),
            create: async (profileKey, opts = {}) => {
                const model = opts.model ?? rt.run.defaultModel ?? null;
                const out = await rt.activity("agents.create",
                    { profileKey, initial: opts.initial ?? null, tags: opts.tags ?? [], parent: opts.parent?.id ?? null, ephemeral: opts.ephemeral ?? false, model },
                    async () => {
                        const meta = await rt.ports.sessions.createSession({
                            profileKey, kind: "chat", tags: opts.tags ?? [], parentSessionId: opts.parent?.id, initial: opts.initial, model: model ?? undefined,
                        });
                        return { sessionId: meta.sessionId };
                    }) as { sessionId: SessionId };
                if (opts.ephemeral) rt.exec.ephemeral.add(out.sessionId);
                await rt.lock(out.sessionId);
                return new Handle(rt, out.sessionId, null);
            },
            acquire: async ({ profileKey, tag, parent }) => {
                const out = await rt.activity("agents.acquire", { profileKey, tag },
                    async () => {
                        const found = await rt.ports.sessions.findByTag(profileKey, tag);
                        if (found) return { sessionId: found.sessionId, leafId: await rt.ports.sessions.activeLeaf(found.sessionId), created: false };
                        const meta = await rt.ports.sessions.createSession({ profileKey, kind: "chat", tags: [tag], parentSessionId: parent?.id });
                        return { sessionId: meta.sessionId, leafId: null, created: true };
                    }) as { sessionId: SessionId; leafId: EntryId | null };
                await rt.lock(out.sessionId);
                return new Handle(rt, out.sessionId, out.leafId);
            },
            invoke: async (sessionId, opts) => (await openHandle(sessionId)).invoke(opts),
        },
        sessions: { open: openHandle },
        all: async (thunks) => {
            // 每个 thunk 一条子路径，避免同路径并发争抢 seq
            const mapSeq = rt.exec.nextSeq(rt.path());
            const parent = rt.path();
            return await collectBranches(thunks.map((thunk, i) => () =>
                branchContext.run({ path: `${parent}/${mapSeq}:${i}` }, thunk)), thunks.length);
        },
        map: async (items, fn, opts = {}) => {
            const mapSeq = rt.exec.nextSeq(rt.path());
            const parent = rt.path();
            const thunks = items.map((item, i) => () =>
                branchContext.run({ path: `${parent}/${mapSeq}:${i}` }, () => fn(item, i)));
            return await collectBranches(thunks, opts.concurrency ?? 4);
        },
        ask: (spec) => rt.askActivity(spec),
        log: (message) => {
            rt.run.logs.push(message);
            rt.env.onEvent?.({ type: "log", runId: rt.run.runId, message });
        },
        progress: (state) => {
            rt.run.progress = { ...rt.run.progress, ...state };
            rt.env.onEvent?.({ type: "progress", runId: rt.run.runId, state: rt.run.progress });
        },
        chart: (() => {
            const emit = (op: ChartOp) => rt.env.onEvent?.({ type: "chart", runId: rt.run.runId, op });
            return {
                node: (key: string, title?: string) => emit({ op: "node", key, title }),
                edge: (from: string, to: string, label?: string) => emit({ op: "edge", from, to, label }),
                enter: (key: string, opts: { token?: string; sessionId?: SessionId } = {}) =>
                    emit({ op: "enter", key, token: opts.token ?? "main", sessionId: opts.sessionId }),
                leave: (key: string, opts: { token?: string } = {}) => emit({ op: "leave", key, token: opts.token ?? "main" }),
                move: (from: string, to: string, opts: { token?: string; sessionId?: SessionId; label?: string } = {}) =>
                    emit({ op: "move", from, to, token: opts.token ?? "main", sessionId: opts.sessionId, label: opts.label }),
            };
        })(),
        workspace: {
            read: (path) => rt.activity("workspace.read", { path }, async () => {
                const workspace = rt.run.workspace ?? rt.env.workspace;
                if (!workspace) throw new Error("本环境未提供 workspace 端口");
                return await workspace.read(path);
            }),
        },
        caller: async () => {
            if (rt.run.callerSessionId === null) throw new Error("本 run 无 caller（面 A 触发）");
            return await openHandle(rt.run.callerSessionId);
        },
    };
}

/**
 * 并发收集：挂起的分支不阻止兄弟分支完成（它们的结果照常进 journal），
 * 全部落定后若有挂起统一上抛；业务错误 fail-fast（不再取新任务，已开始的跑完）。
 */
async function collectBranches<T>(thunks: (() => Promise<T>)[], concurrency: number): Promise<T[]> {
    const results = new Array<T>(thunks.length);
    const errors: unknown[] = [];
    let suspended = false;
    let next = 0;
    const worker = async () => {
        while (errors.length === 0) {
            const i = next++;
            const thunk = thunks[i];
            if (thunk === undefined) return;
            try {
                results[i] = await thunk();
            } catch (error) {
                if (error instanceof SuspendSignal) suspended = true;
                else errors.push(error);
            }
        }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, thunks.length)) }, worker));
    if (errors.length > 0) throw errors[0];
    if (suspended) throw new SuspendSignal();
    return results;
}

/** workflow 运行器：start / resume / rerun；run 状态与 journal 常驻内存（spike） */
export class WorkflowRunner {
    private runs = new Map<string, RunRecord>();
    /** 正在执行中的 run：防止同一 run 并发 execute（begin 后 rerun / 重复 resume） */
    private inFlight = new Set<string>();

    constructor(private ports: WorkflowPorts, private env: RunEnv = {}) {}

    /**
     * 非阻塞启动：同步分配 runId 立即返回，执行在后台进行。
     * done 不会 reject（失败也归约为 status:"failed" 的 RunView）。
     */
    /** begin/start 的启动选项（面 B/工具触发时由宿主注入） */
    begin(def: WorkflowDefinition<never, never> | WorkflowDefinition, args: JsonValue, opts?: { callerSessionId?: SessionId; defaultModel?: string; workspace?: WorkspacePort; signal?: AbortSignal }): { runId: string; done: Promise<RunView> } {
        const abortController = new AbortController();
        const run: RunRecord = {
            // Run ID 必须跨 runner 重建保持唯一，不能依赖进程内递增计数器。
            runId: `run_${randomUUID()}`,
            def: def as WorkflowDefinition,
            args,
            callerSessionId: opts?.callerSessionId ?? null,
            abortController,
            defaultModel: opts?.defaultModel ?? null,
            workspace: opts?.workspace ?? null,
            status: "running",
            journal: new Map(),
            pendingAsks: [],
            logs: [],
            progress: null,
        };
        this.runs.set(run.runId, run);
        if (opts?.signal) {
            const onAbort = () => {
                this.cancel(run.runId);
            };
            if (opts.signal.aborted) {
                run.abortRequested = true;
                abortController.abort(opts.signal.reason);
            } else {
                opts.signal.addEventListener("abort", onAbort, {once: true});
                run.removeExternalAbort = () => opts.signal?.removeEventListener("abort", onAbort);
            }
        }
        return { runId: run.runId, done: this.execute(run) };
    }

    /** 面 A（无 caller）/ 面 B（callerSessionId = 发起 agent 的 session） */
    async start(def: WorkflowDefinition<never, never> | WorkflowDefinition, args: JsonValue, opts?: { callerSessionId?: SessionId; defaultModel?: string; workspace?: WorkspacePort; signal?: AbortSignal }): Promise<RunView> {
        return await this.begin(def, args, opts).done;
    }

    /** 应答 pending ask 后重放续跑；answers 按 ask key 对号。cancelled/终态不可恢复。 */
    async resume(runId: string, answers: Record<string, JsonValue>): Promise<RunView> {
        const run = this.record(runId);
        if (run.status !== "waiting") throw new Error(`run ${runId} 非 waiting 状态，当前为 ${run.status}`);
        for (const ask of run.pendingAsks) {
            const answer = answers[ask.key];
            if (answer === undefined) throw new Error(`缺少 ask 应答: ${ask.key}（${ask.spec.title}）`);
            run.journal.set(ask.key, { key: ask.key, path: ask.path, seq: ask.seq, kind: "ask", fingerprint: ask.fingerprint, result: answer });
        }
        return await this.execute(run);
    }

    /** 崩溃/失败后按既有 journal 重放恢复；用户取消是显式终态，不允许 rerun 绕过。 */
    async rerun(runId: string): Promise<RunView> {
        const run = this.record(runId);
        if (run.status === "cancelled") throw new Error(`run ${runId} 已取消，不能 rerun`);
        return await this.execute(run);
    }

    /**
     * 请求取消 run。running 先 abort 当前 Agent activity，waiting 立即进入 cancelled，
     * 从而不会被之后的 resume API 重新启动。
     */
    cancel(runId: string): void {
        const run = this.record(runId);
        if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") return;
        run.abortRequested = true;
        run.abortController.abort(new WorkflowCancelledError());
        if (run.status === "waiting") {
            run.status = "cancelled";
            run.error = "workflow run 被取消";
            run.pendingAsks = [];
            run.removeExternalAbort?.();
            run.removeExternalAbort = undefined;
            this.env.onEvent?.({type: "status", runId: run.runId, status: run.status});
            return;
        }
    }

    view(runId: string): RunView {
        return toView(this.record(runId));
    }

    /** 所有 run 概览（demo / 调试用） */
    list(): RunView[] {
        return [...this.runs.values()].map(toView);
    }

    private async execute(run: RunRecord): Promise<RunView> {
        if (this.inFlight.has(run.runId)) throw new Error(`run ${run.runId} 正在执行中`);
        this.inFlight.add(run.runId);
        run.status = "running";
        this.env.onEvent?.({ type: "status", runId: run.runId, status: "running" });
        run.pendingAsks = [];
        run.logs = [];
        run.progress = null;
        run.error = undefined;
        const exec = new ExecutionState();
        const rt = new Runtime(run, exec, this.ports, this.env);
        try {
            const result = await branchContext.run({ path: "root" }, () => run.def.run(createWf(rt, run.args), run.args));
            if (run.abortRequested) {
                run.status = "cancelled";
                run.error = "workflow run 被取消";
                run.pendingAsks = [];
            } else {
                run.status = "completed";
                run.result = result as JsonValue;
                for (const sessionId of exec.ephemeral) await this.ports.sessions.archive(sessionId);
            }
        } catch (error) {
            if (error instanceof SuspendSignal) {
                run.status = run.abortRequested ? "cancelled" : "waiting";
                if (run.status === "cancelled") {
                    run.error = "workflow run 被取消";
                    run.pendingAsks = [];
                }
            } else if (error instanceof WorkflowCancelledError || run.abortRequested) {
                run.status = "cancelled";
                run.error = "workflow run 被取消";
                run.pendingAsks = [];
            } else {
                run.status = "failed";
                run.error = error instanceof Error ? error.message : String(error);
                // 失败时清掉并发兄弟分支挂起登记的 ask：run 已不可应答，残留会误导 UI
                run.pendingAsks = [];
            }
        } finally {
            // 结束或挂起都释放锁：挂起可能等很久，不该锁死用户对话
            this.inFlight.delete(run.runId);
            await this.ports.sessions.releaseAll(run.runId);
            this.env.onEvent?.({ type: "status", runId: run.runId, status: run.status });
            if (run.status !== "waiting") {
                run.removeExternalAbort?.();
                run.removeExternalAbort = undefined;
            }
        }
        return toView(run);
    }

    private record(runId: string): RunRecord {
        const run = this.runs.get(runId);
        if (!run) throw new Error(`run ${runId} 不存在`);
        return run;
    }
}

function toView(run: RunRecord): RunView {
    return {
        runId: run.runId,
        workflowKey: run.def.key,
        status: run.status,
        result: run.result,
        error: run.error,
        pendingAsks: [...run.pendingAsks],
        logs: [...run.logs],
        progress: run.progress,
        journal: [...run.journal.values()].sort((a, b) => a.path === b.path ? a.seq - b.seq : a.path.localeCompare(b.path)),
    };
}
