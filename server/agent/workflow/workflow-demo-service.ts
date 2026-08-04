import {AsyncLocalStorage} from "node:async_hooks";
import {useAgentHarness} from "nbook/server/agent/http";
import {consola} from "consola";
import {MockAgentPort, WorkflowRunner, createMemoryWorkspace, skeletonMermaid} from "nbook/server/vendor/nb-workflow/index";
import type {ActivityRecord, AgentInvokeUsage, JsonValue, PendingAsk, RunView, SessionId, WorkflowDefinition, WorkflowEvent, WorkspacePort} from "nbook/server/vendor/nb-workflow/index";
import {NeuroWorkflowSessionPort} from "nbook/server/agent/workflow/workflow-session-port";
import {HarnessAgentPort, RoutingAgentPort} from "nbook/server/agent/workflow/workflow-agent-port";
import {
    DEMO_BOOK, DEMO_BOOK_PATH, DEMO_SCENARIOS, demoKnobs, registerDemoResponders,
} from "nbook/server/agent/workflow/workflow-demo-scenarios";
import {buildRunVm, collectSessionNaming} from "nbook/server/agent/workflow/workflow-run-vm";
import type {LiveCardVm, ParticipantVm, PhaseVm, RunningNowVm, SessionNaming, TimedEvent, TimelineLaneVm} from "nbook/server/agent/workflow/workflow-run-vm";
import {storedMessageText} from "nbook/server/agent/messages/stored-message-presentation";
import type {SessionSnapshot} from "nbook/server/agent/session/types";
import {assertVisibleModel} from "nbook/server/agent/harness/agent-visible-models";
import type {EffectiveConfig} from "nbook/server/config/types";
import {startReadyProjectOperation} from "nbook/server/workspace-files/project-session";
import type {ReadyProjectSessionRef} from "nbook/server/workspace-files/project-session-types";

/** 带绝对游标的事件缓冲（条目附服务端接收时刻，时间线视图用；超限丢最旧，seq 不回退） */
class EventBuffer {
    private events: TimedEvent[] = [];
    private baseSeq = 0;

    push(event: WorkflowEvent): void {
        this.events.push({event, at: Date.now()});
        if (this.events.length > 4000) {
            const drop = this.events.length - 4000;
            this.events.splice(0, drop);
            this.baseSeq += drop;
        }
    }

    /** 取 absolute seq > after 的事件 */
    after(after: number): {events: TimedEvent[]; nextCursor: number} {
        const start = Math.max(0, after - this.baseSeq);
        return {events: this.events.slice(start), nextCursor: this.baseSeq + this.events.length};
    }

    all(): TimedEvent[] {
        return this.events;
    }
}

type RunSettleWaiter = {
    resolve: (view: RunView) => void;
    reject: (error: Error) => void;
    signal?: AbortSignal;
    onAbort?: () => void;
    /** resume 后 run 回到 running 时同步 Job 状态，但继续等待下一次 settle。 */
    onRunning?: () => void;
};

export type WorkflowDemoRunState = {
    view: RunView;
    /** completed/failed 终态元数据；running/waiting 时缺省，避免轮询重复读取 session 仓库。 */
    summary?: WorkflowRunSummary;
    events: WorkflowEvent[];
    nextCursor: number;
    /** activityKey → 人话标签 */
    labels: Record<string, string>;
    /** phase 进度视图模型（前端自行画步进条） */
    phases: PhaseVm[];
    /** session 序列图（mermaid sequenceDiagram） */
    flowMermaid: string;
    /** 人话版动态 trace（mermaid graph） */
    traceMermaid: string;
    /** 参与者（含中文名与 tag） */
    participants: ParticipantVm[];
    /** 当前正在运行的 activity（前端高亮脉冲用） */
    runningNow: RunningNowVm[];
    /** 泳道时间线 */
    timeline: TimelineLaneVm[];
    /** Agent 直播卡片 */
    live: LiveCardVm[];
    /** 实时生长关系图（mermaid graph LR） */
    relationMermaid: string;
    /** 声明状态机图（未声明为 null） */
    machineMermaid: string | null;
};

/** workflow 触达的 session 与 token 汇总；工具返回和正式 GET 共用同一真相源。 */
export type WorkflowUsage = Omit<AgentInvokeUsage, "cost">;

export type WorkflowRunSummary = {
    sessions: {sessionId: number; profileKey: string; title: string; tokens: WorkflowUsage | null}[];
    usage: WorkflowUsage;
};

/** 正式Workflow启动结果；terminal只在最终Run终态settle，waiting不属于释放边界。 */
export type WorkflowRunStart = {
    runId: string;
    done: Promise<RunView>;
    terminal: Promise<void>;
};

/** 正式run在admission冻结的宿主上下文；等待与resume期间保持不变。 */
type WorkflowRunContext = Readonly<{
    config: EffectiveConfig;
    project: ReadyProjectSessionRef | null;
}>;

type WorkflowRunTerminal = Readonly<{
    promise: Promise<void>;
    resolve: () => void;
}>;

/** 建立只负责Run最终终态的单次完成信号。 */
function createRunTerminal(): WorkflowRunTerminal {
    let settle = (): void => undefined;
    const promise = new Promise<void>((resolve) => {
        settle = resolve;
    });
    let settled = false;
    return Object.freeze({
        promise,
        resolve: () => {
            if (settled) return;
            settled = true;
            settle();
        },
    });
}

/** 新建可累加的完整用量桶；可选明细只有 provider 实际上报后才出现。 */
function emptyUsage(): AgentInvokeUsage {
    return {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 0,
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0},
    };
}

/** 将一次 invocation 的完整 token/cost 观测累加到 run 或 session 桶。 */
function addUsage(target: AgentInvokeUsage, source: AgentInvokeUsage): void {
    target.inputTokens += source.inputTokens;
    target.outputTokens += source.outputTokens;
    target.cacheReadTokens += source.cacheReadTokens;
    target.cacheWriteTokens += source.cacheWriteTokens;
    target.totalTokens += source.totalTokens;
    target.cost.input += source.cost.input;
    target.cost.output += source.cost.output;
    target.cost.cacheRead += source.cost.cacheRead;
    target.cost.cacheWrite += source.cost.cacheWrite;
    target.cost.total += source.cost.total;
    if (source.cacheWrite1hTokens !== undefined) {
        target.cacheWrite1hTokens = (target.cacheWrite1hTokens ?? 0) + source.cacheWrite1hTokens;
    }
    if (source.reasoningTokens !== undefined) {
        target.reasoningTokens = (target.reasoningTokens ?? 0) + source.reasoningTokens;
    }
}

/** Workflow 公共边界只投影 token 明细；价格属于普通 Session 内部 usage。 */
function projectUsage(usage: AgentInvokeUsage): WorkflowUsage {
    const {cost: _cost, ...tokens} = usage;
    return tokens;
}

/** 公开 Run 只移除 invocation usage.cost，不触碰普通结果中的同名字段。 */
function projectActivityRecord(record: ActivityRecord): ActivityRecord {
    if (record.kind !== "agents.invoke" || !record.result || typeof record.result !== "object" || Array.isArray(record.result)) {
        return record;
    }
    const result = record.result as {[key: string]: JsonValue};
    const usage = result.usage;
    if (!usage || typeof usage !== "object" || Array.isArray(usage)) return record;
    const usageRecord = usage as {[key: string]: JsonValue};
    if (!("cost" in usageRecord)) return record;
    const {cost: _cost, ...publicUsage} = usageRecord;
    return {
        ...record,
        result: {
            ...result,
            usage: publicUsage,
        },
    };
}

/** Workflow events 与 journal 共用 invocation usage 公开投影。 */
function projectWorkflowEvent(event: WorkflowEvent): WorkflowEvent {
    return event.type === "activity"
        ? {...event, record: projectActivityRecord(event.record)}
        : event;
}

/** Run HTTP/API 公共边界；内部 runner view 与 summary 仍保留完整 cost。 */
function projectRunView(view: RunView): RunView {
    return {
        ...view,
        journal: view.journal.map(projectActivityRecord),
    };
}

/** 在调用内核 resume 前一次性校验全部答案，保证非法请求不会部分写入 journal。 */
function validateResumeAnswers(asks: PendingAsk[], answers: JsonValue): asserts answers is {[key: string]: JsonValue} {
    if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
        throw new Error("workflow 应答必须是对象");
    }
    const expected = new Set(asks.map((ask) => ask.key));
    for (const key of Object.keys(answers)) {
        if (!expected.has(key)) throw new Error(`未知 ask 应答: ${key}`);
    }
    for (const ask of asks) {
        if (!Object.prototype.hasOwnProperty.call(answers, ask.key)) {
            throw new Error(`缺少 ask 应答: ${ask.spec.title}`);
        }
        const answer = answers[ask.key];
        if (ask.spec.kind === "approve") {
            if (typeof answer !== "boolean") throw new Error(`ask ${ask.spec.title} 必须回答 true 或 false`);
            continue;
        }
        if (ask.spec.kind === "text") {
            if (typeof answer !== "string" || answer.trim().length === 0) {
                throw new Error(`ask ${ask.spec.title} 必须填写非空文本`);
            }
            continue;
        }
        const optionIds = new Set((ask.spec.options ?? []).map((option) => option.id));
        if (ask.spec.multi) {
            if (!Array.isArray(answer) || answer.length === 0 || answer.some((value) => typeof value !== "string" || !optionIds.has(value))) {
                throw new Error(`ask ${ask.spec.title} 必须选择声明的一个或多个选项`);
            }
        } else if (typeof answer !== "string" || !optionIds.has(answer)) {
            throw new Error(`ask ${ask.spec.title} 必须选择声明的选项`);
        }
    }
}

export type WorkflowDemoScenarioDto = {
    key: string;
    title: string;
    description: string;
    real: boolean;
    needsCaller: boolean;
    argsHint: {name: string; label: string; defaultValue: string}[];
    skeletonMermaid: string | null;
    cfgMermaid: string;
    /** workflow 运行时源码（转译后 JS，展示用） */
    code: string;
};

/**
 * Workflow demo 服务：nb-workflow 内核 × NeuroBook 真实 session 层的组装点（Task 110 初步接入）。
 * run 状态与事件常驻内存（正式接入时由 run-as-session 持久化取代）。
 */
class WorkflowDemoService {
    private sessions: NeuroWorkflowSessionPort;
    private mock: MockAgentPort;
    private runner: WorkflowRunner;
    private buffers = new Map<string, EventBuffer>();
    /** begin() 首个 status 可能同步发出；启动期间暂存，拿到 runId 后再归档。 */
    private startupBuffer: EventBuffer | null = null;
    /** 进行中的 activity（activity_started 后、activity 前），trace/时间线画进行中样式 */
    private running = new Map<string, Map<string, {path: string; seq: number; kind: string; fingerprint: string; startedAt: number}>>();
    private scenarioDtos: WorkflowDemoScenarioDto[] | null = null;
    /** runId -> scenarioKey（demo run 列表展示用） */
    private runScenario = new Map<string, string>();
    /** runId -> 通用 run 信息（正式/演示统一：phase 声明进观测 VM） */
    private runInfo = new Map<string, {workflowKey: string; phases?: {key: string; title: string}[]}>();
    /** 等待某 run 下一次 settle（一次 execute 结束：waiting/completed/failed）的回调（后台 job 跟踪 ask 恢复用） */
    private settleWaiters = new Map<string, RunSettleWaiter[]>();
    /** sessionId -> profileKey 缓存（open/caller 进来的 session 命名补查） */
    private profileKeyCache = new Map<number, string>();
    /** runId -> admission冻结的Config与Project generation。 */
    private runContexts = new Map<string, WorkflowRunContext>();
    /** 当前 runner 执行链的冻结宿主上下文；vendor SessionPort 不携带 runId。 */
    private readonly runContextStorage = new AsyncLocalStorage<WorkflowRunContext>();
    /** runId -> 最终终态信号；waiting/resume期间必须保留。 */
    private runTerminals = new Map<string, WorkflowRunTerminal>();

    constructor() {
        const harness = useAgentHarness();
        this.sessions = new NeuroWorkflowSessionPort(harness.repo, async (init) => {
            const runContext = this.runContextStorage.getStore();
            if (!runContext) {
                throw new Error("正式workflow participant创建缺少run上下文。");
            }
            // 所有 workflow participant 模型（含脚本内显式 create.model）都在宿主边界校验，
            // 不能只相信顶层 run_workflow.model 已校验，否则内联脚本可绕过 visibleModels。
            if (init.model) {
                assertVisibleModel(runContext.config, init.model);
            }
            const created = await harness.createAgent({
                profileKey: init.profileKey,
                initial: init.initial ?? undefined,
                parentSessionId: init.parentSessionId,
                title: init.title,
                kind: init.kind,
                tags: init.tags,
                currentProjectRoot: runContext.project?.workspace.ref.projectRoot,
            });
            // 模型指定（Task 111）：workflow 创建的 session 落 model_change entry，后续 invoke 全部用该模型
            if (init.model) {
                await harness.runCommand(created.sessionId, {command: "model", modelKey: init.model});
            }
            return created.sessionId;
        });
        this.mock = new MockAgentPort(this.sessions);
        registerDemoResponders(this.mock);
        const agents = new RoutingAgentPort(this.mock, new HarnessAgentPort(harness), this.sessions, false);
        this.runner = new WorkflowRunner({sessions: this.sessions, agents}, {
            workspace: createMemoryWorkspace({[DEMO_BOOK_PATH]: DEMO_BOOK}),
            onEvent: (event) => this.onEvent(event),
        });
    }

    private onEvent(event: WorkflowEvent): void {
        const buffer = this.buffers.get(event.runId) ?? this.startupBuffer;
        buffer?.push(event);
        if (event.type === "status" && event.status === "running") {
            for (const waiter of this.settleWaiters.get(event.runId) ?? []) waiter.onRunning?.();
        }
        if (event.type === "status" && event.status !== "running") {
            const waiters = this.settleWaiters.get(event.runId);
            if (waiters) {
                this.settleWaiters.delete(event.runId);
                const view = this.runner.view(event.runId);
                for (const waiter of waiters) {
                    if (waiter.signal && waiter.onAbort) waiter.signal.removeEventListener("abort", waiter.onAbort);
                    waiter.resolve(view);
                }
            }
        }
        if (event.type === "status" && (event.status === "completed" || event.status === "failed" || event.status === "cancelled")) {
            this.runContexts.delete(event.runId);
            const terminal = this.runTerminals.get(event.runId);
            this.runTerminals.delete(event.runId);
            terminal?.resolve();
        }
        const running = this.running.get(event.runId);
        if (!running) return;
        if (event.type === "activity_started") running.set(event.key, {path: event.path, seq: event.seq, kind: event.kind, fingerprint: event.fingerprint, startedAt: Date.now()});
        if (event.type === "activity") running.delete(event.record.key);
        if (event.type === "status" && event.status !== "running") running.clear();
    }

    /** 场景列表（骨架 + CFG + 源码惰性计算并缓存；CFG 依赖 typescript 包，走动态 import） */
    async listScenarios(): Promise<WorkflowDemoScenarioDto[]> {
        if (this.scenarioDtos) return this.scenarioDtos;
        const {extractCfg} = await import("nbook/server/vendor/nb-workflow/projection/cfg");
        this.scenarioDtos = Object.entries(DEMO_SCENARIOS).map(([key, scenario]) => ({
            key,
            title: scenario.title,
            description: scenario.description,
            real: scenario.real,
            needsCaller: scenario.needsCaller,
            argsHint: scenario.argsHint,
            skeletonMermaid: scenario.def.phases ? skeletonMermaid(scenario.def) : null,
            cfgMermaid: extractCfg(scenario.def.run.toString()).mermaid,
            code: scenario.def.run.toString(),
        }));
        return this.scenarioDtos;
    }

    /** 启动一次 run：立即返回 runId，执行在后台进行，前端轮询 runState。speedFactor 调演示节奏（mock sleep 倍率） */
    async startRun(scenarioKey: string, args: JsonValue, speedFactor?: number): Promise<{runId: string}> {
        const scenario = DEMO_SCENARIOS[scenarioKey];
        if (!scenario) throw new Error(`未知场景: ${scenarioKey}`);
        if (speedFactor !== undefined && speedFactor > 0 && speedFactor <= 20) demoKnobs.speedFactor = speedFactor;
        const callerSessionId = scenario.needsCaller ? await this.ensureSidecarCaller() : undefined;
        const buffer = new EventBuffer();
        this.startupBuffer = buffer;
        let started: {runId: string; done: Promise<RunView>};
        try {
            started = this.runner.begin(scenario.def, args, {callerSessionId});
        } finally {
            this.startupBuffer = null;
        }
        const {runId, done} = started!;
        this.buffers.set(runId, buffer);
        this.runScenario.set(runId, scenarioKey);
        this.runInfo.set(runId, {workflowKey: scenario.def.key, phases: scenario.def.phases});
        this.running.set(runId, new Map());
        done.catch((error) => consola.error({runId, error}, "workflow demo run 执行异常"));
        return {runId};
    }

    /**
     * 正式入口（Task 111）：运行 catalog / 内联 workflow。
     * model 是 run 级默认模型（调用方已按可见清单校验）；workspace 是按发起方 Project Workspace 建的只读端口。
     * 返回 done 供 run_workflow 工具同步等待；HTTP 触发方忽略 done 走轮询。
     */
    startWorkflowRun(opts: {
        def: WorkflowDefinition;
        args: JsonValue;
        callerSessionId?: SessionId;
        model?: string;
        workspace?: WorkspacePort;
        config: EffectiveConfig;
        project: ReadyProjectSessionRef | null;
        /** 阻塞工具调用的父 invocation signal；后台 Job 仍通过 cancelRun 传播。 */
        signal?: AbortSignal;
    }): WorkflowRunStart {
        /** begin 可能同步进入 workflow；用 async context 让 participant 创建拿到冻结宿主上下文。 */
        const begin = (signal?: AbortSignal): WorkflowRunStart => {
            const buffer = new EventBuffer();
            const runContext = Object.freeze({
                config: opts.config,
                project: opts.project,
            });
            this.startupBuffer = buffer;
            let started: {runId: string; done: Promise<RunView>};
            try {
                started = this.runContextStorage.run(runContext, () => this.runner.begin(opts.def, opts.args, {
                        callerSessionId: opts.callerSessionId,
                        defaultModel: opts.model,
                        workspace: opts.workspace,
                        signal,
                    }));
            } finally {
                this.startupBuffer = null;
            }
            const {runId, done} = started!;
            const terminal = createRunTerminal();
            const current = this.runner.view(runId);
            if (current.status === "completed" || current.status === "failed" || current.status === "cancelled") {
                terminal.resolve();
            } else {
                this.runTerminals.set(runId, terminal);
                this.runContexts.set(runId, runContext);
            }
            this.buffers.set(runId, buffer);
            this.runInfo.set(runId, {workflowKey: opts.def.key, phases: opts.def.phases});
            this.running.set(runId, new Map());
            done.catch((error) => consola.error({runId, error}, "workflow run 执行异常"));
            return {runId, done, terminal: terminal.promise};
        };

        if (!opts.project) {
            return begin(opts.signal);
        }
        return startReadyProjectOperation(opts.project, (generationSignal) => {
            const signal = opts.signal
                ? AbortSignal.any([generationSignal, opts.signal])
                : generationSignal;
            const started = begin(signal);
            return {result: started, completion: started.terminal};
        });
    }

    /**
     * run 摘要（Task 111 返回契约）：从 journal 汇总触达的 session 与 token 用量。
     * - agents.create/acquire 记录给出 sessionId + profileKey（解析参数指纹）；
     * - agents.invoke 记录的 result.usage 累计 per-session 与总量（mock/无模型轮为空不计）。
     */
    async runSummary(runId: string): Promise<WorkflowRunSummary> {
        const view = this.runner.view(runId);
        const profileKeys = new Map<number, string>();
        const perSession = new Map<number, AgentInvokeUsage>();
        const total = emptyUsage();
        for (const record of view.journal) {
            // fingerprint 是键排序的规范化 JSON（vendor fingerprint.ts），可安全解析回参数
            const params = JSON.parse(record.fingerprint) as {[key: string]: JsonValue} | null;
            if ((record.kind === "agents.create" || record.kind === "agents.acquire") && record.result && typeof record.result === "object") {
                const sessionId = (record.result as {sessionId?: number}).sessionId;
                const profileKey = typeof params?.profileKey === "string" ? params.profileKey : "";
                if (typeof sessionId === "number") profileKeys.set(sessionId, profileKey);
            }
            if (record.kind === "sessions.open" && typeof params?.id === "number") {
                profileKeys.set(params.id, profileKeys.get(params.id) ?? "");
            }
            if (record.kind === "agents.invoke" && record.result && typeof record.result === "object") {
                const sessionId = typeof params?.id === "number" ? params.id : null;
                const usage = (record.result as {usage?: AgentInvokeUsage | null}).usage;
                if (sessionId === null || !usage) continue;
                const bucket = perSession.get(sessionId) ?? emptyUsage();
                addUsage(bucket, usage);
                perSession.set(sessionId, bucket);
                addUsage(total, usage);
            }
        }
        const harness = useAgentHarness();
        const sessionIds = new Set<number>([...profileKeys.keys(), ...perSession.keys()]);
        const sessions: WorkflowRunSummary["sessions"] = [];
        for (const sessionId of sessionIds) {
            let profileKey = profileKeys.get(sessionId) ?? "";
            let title = "";
            try {
                const snapshot = await harness.repo.readSession(sessionId);
                profileKey = profileKey || snapshot.metadata.profileKey;
                title = harness.repo.reduce(snapshot).title ?? snapshot.metadata.title ?? "";
            } catch {
                // session 可能已删除：保留 journal 里的信息
            }
            const tokens = perSession.get(sessionId);
            sessions.push({sessionId, profileKey, title, tokens: tokens ? projectUsage(tokens) : null});
        }
        sessions.sort((a, b) => a.sessionId - b.sessionId);
        return {sessions, usage: projectUsage(total)};
    }

    /** 应答 pending ask 续跑（后台执行） */
    resume(runId: string, answers: JsonValue): void {
        const view = this.runner.view(runId);
        if (view.status !== "waiting") throw new Error(`run ${runId} 非 waiting 状态`);
        validateResumeAnswers(view.pendingAsks, answers);
        const context = this.runContexts.get(runId);
        const resume = () => this.runner.resume(runId, answers);
        const execution = context ? this.runContextStorage.run(context, resume) : resume();
        execution.catch((error) => consola.error({runId, error}, "workflow demo resume 异常"));
    }

    /**
     * 等待 run 的下一次 settle（一次 execute 结束）。终态直接返回；waiting/running 等下一个 status 事件。
     * 后台 workflow job 用它跟踪「ask 挂起 → 用户应答 resume → 继续跑」的循环。
     */
    waitForRunSettled(runId: string, signal?: AbortSignal, onRunning?: () => void): Promise<RunView> {
        const view = this.runner.view(runId);
        if (view.status === "completed" || view.status === "failed" || view.status === "cancelled") return Promise.resolve(view);
        if (signal?.aborted) {
            const error = new Error(`等待 workflow ${runId} settle 已取消`);
            error.name = "AbortError";
            return Promise.reject(error);
        }
        return new Promise((resolve, reject) => {
            const waiter: RunSettleWaiter = {resolve, reject, signal, onRunning};
            if (signal) {
                waiter.onAbort = () => {
                    const waiters = this.settleWaiters.get(runId);
                    if (waiters) {
                        const remaining = waiters.filter((candidate) => candidate !== waiter);
                        if (remaining.length > 0) this.settleWaiters.set(runId, remaining);
                        else this.settleWaiters.delete(runId);
                    }
                    const error = new Error(`等待 workflow ${runId} settle 已取消`);
                    error.name = "AbortError";
                    reject(error);
                };
                signal.addEventListener("abort", waiter.onAbort, {once: true});
            }
            const waiters = this.settleWaiters.get(runId) ?? [];
            waiters.push(waiter);
            this.settleWaiters.set(runId, waiters);
        });
    }

    /** 请求取消：waiting 立即终态；running 会把 Run signal 传播到当前 Agent activity。 */
    cancelRun(runId: string): void {
        this.runner.cancel(runId);
    }

    /** 重放恢复；styleMode 提供时先改"脚本参数"（演示局部失效） */
    rerun(runId: string, styleMode?: string): void {
        if (!this.runScenario.has(runId)) {
            throw new Error(`正式workflow run不支持rerun：${runId}`);
        }
        const view = this.runner.view(runId);
        if (view.status === "running") throw new Error(`run ${runId} 正在执行中`);
        if (styleMode) demoKnobs.styleMode = styleMode;
        this.runner.rerun(runId).catch((error) => consola.error({runId, error}, "workflow demo rerun 异常"));
    }

    /** run 快照 + 增量事件 + 观测 VM（人话标签 / phase 进度 / 各可视化投影） */
    async runState(runId: string, after: number): Promise<WorkflowDemoRunState> {
        const view = this.runner.view(runId);
        const buffer = this.buffers.get(runId);
        const {events, nextCursor} = buffer ? buffer.after(after) : {events: [] as TimedEvent[], nextCursor: 0};
        // 本次执行段：自最近一次 status:running 起（resume/rerun 后重放事件也在段内）
        const all = buffer?.all() ?? [];
        const lastStart = all.map((t, i) => (t.event.type === "status" && t.event.status === "running" ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
        const currentExec = all.slice(lastStart + 1);
        const running = this.running.get(runId) ?? new Map<string, {path: string; seq: number; kind: string; fingerprint: string; startedAt: number}>();
        const sessions = collectSessionNaming(view.journal);
        await this.fillProfileKeys(sessions);
        const info = this.runInfo.get(runId);
        const vm = buildRunVm({view, events: currentExec, running, phases: info?.phases, sessions});
        const summary = view.status === "completed" || view.status === "failed" || view.status === "cancelled"
            ? await this.runSummary(runId)
            : undefined;
        const publicView = projectRunView(view);
        return {
            view: publicView,
            ...(summary ? {summary} : {}),
            events: events.map((t) => projectWorkflowEvent(t.event)),
            nextCursor,
            ...vm,
        };
    }

    /** open/caller 进来的 session 没有 create/acquire 记录，从真实仓补查 profileKey（带缓存） */
    private async fillProfileKeys(sessions: Map<number, SessionNaming>): Promise<void> {
        const harness = useAgentHarness();
        for (const [sessionId, naming] of sessions) {
            if (naming.profileKey) continue;
            let cached = this.profileKeyCache.get(sessionId);
            if (!cached) {
                try {
                    cached = (await harness.repo.readSession(sessionId)).metadata.profileKey;
                    this.profileKeyCache.set(sessionId, cached);
                } catch {
                    continue;
                }
            }
            naming.profileKey = cached;
        }
    }

    /** 所有 run 概览（runId + 场景 + 状态） */
    listRuns(): {runId: string; scenarioKey: string; status: string}[] {
        return this.runner.list().map((view) => ({
            runId: view.runId,
            scenarioKey: this.runScenario.get(view.runId) ?? this.runInfo.get(view.runId)?.workflowKey ?? "?",
            status: view.status,
        })).reverse();
    }

    /** 参与者 session 的真实树投影（直接读 JSONL 仓库） */
    async sessionTree(sessionId: number): Promise<{sessionId: number; profileKey: string; kind: string; tags: string[]; archived: boolean; title?: string; mermaid: string; entryCount: number}> {
        const harness = useAgentHarness();
        const snapshot = await harness.repo.readSession(sessionId);
        const context = harness.repo.reduce(snapshot);
        return {
            sessionId,
            profileKey: snapshot.metadata.profileKey,
            kind: snapshot.metadata.kind ?? "chat",
            tags: snapshot.metadata.tags ?? [],
            archived: context.archived,
            title: context.title ?? snapshot.metadata.title,
            mermaid: sessionTreeMermaid(snapshot),
            entryCount: snapshot.entries.length,
        };
    }

    /** RP 轮间直聊（mock profile 专用；真实 profile 请走正常聊天 UI） */
    async directChat(sessionId: number, message: string): Promise<{reply: string}> {
        const meta = await this.sessions.meta(sessionId);
        if (!meta.profileKey.startsWith("workflow.demo.")) {
            throw new Error("直聊入口只支持 demo mock session；真实 session 请用正常聊天界面");
        }
        await this.sessions.lock(sessionId, "direct");
        try {
            const userLeaf = await this.sessions.append(sessionId, await this.sessions.activeLeaf(sessionId), {
                role: "user", message, origin: "direct",
            });
            const resp = await this.mock.respondAt(sessionId, userLeaf, {mode: "prompt", message});
            await this.sessions.append(sessionId, userLeaf, {
                role: "assistant", message: resp.message, data: resp.data, origin: "direct",
            });
            return {reply: resp.message};
        } finally {
            await this.sessions.releaseAll("direct");
        }
    }

    /** sidecar 场景的 caller：按 tag 找持久 demo actor session，没有则建并预置一轮历史 */
    private async ensureSidecarCaller(): Promise<SessionId> {
        const profileKey = "workflow.demo.simulator-actor";
        const tag = "workflow.demo:sidecar-caller";
        const found = await this.sessions.findByTag(profileKey, tag);
        if (found) return found.sessionId;
        const meta = await this.sessions.createSession({profileKey, kind: "chat", tags: [tag], title: "sidecar demo caller"});
        const e1 = await this.sessions.append(meta.sessionId, null, {role: "user", message: "回合一输入：走进酒馆", origin: "direct"});
        await this.sessions.append(meta.sessionId, e1, {role: "assistant", message: "回合一回应：我找了个角落坐下", origin: "direct"});
        return meta.sessionId;
    }
}

/** mermaid 标签净化：引号换单引号、折叠空白、截断（投影铁律：进图文本必须过净化层） */
const sanitize = (s: string) => s.replace(/\s+/g, " ").replaceAll('"', "'").slice(0, 24);

/** 真实 session 树 → mermaid：非 leaf entry 全画，origin 着色，active leaf 标记 */
function sessionTreeMermaid(snapshot: SessionSnapshot): string {
    const entries = snapshot.entries.filter((e) => e.type !== "leaf").slice(0, 120);
    const idOf = new Map(entries.map((e, i) => [e.id, `n${i}`]));
    const lines: string[] = [];
    for (const entry of entries) {
        const nodeId = idOf.get(entry.id);
        let label: string;
        let cls = "meta";
        if (entry.type === "message") {
            const role = entry.message.role;
            const icon = role === "user" ? "🧑" : role === "assistant" ? "🤖" : "🔧";
            label = `${icon} ${sanitize(storedMessageText(entry.message)) || "(空)"}`;
            cls = entry.origin === "workflow" ? "workflow" : entry.origin === "prompt" || entry.origin === "manual" ? "direct" : "harness";
        } else {
            label = `⚙ ${entry.type}`;
        }
        const leafMark = entry.id === snapshot.leafId ? " ◀ leaf" : "";
        lines.push(`    ${nodeId}["${label}${leafMark}"]:::${cls}`);
    }
    const edges: string[] = [];
    for (const entry of entries) {
        if (entry.parentId === null) continue;
        const parentNode = idOf.get(entry.parentId);
        if (parentNode) edges.push(`    ${parentNode} --> ${idOf.get(entry.id)}`);
    }
    return [
        "graph TD",
        ...lines,
        ...edges,
        "    classDef workflow fill:#16202e,stroke:#3d5a99,color:#a9c4ff",
        "    classDef direct fill:#2a2313,stroke:#8a6d1e,color:#ffd479",
        "    classDef harness fill:#14261a,stroke:#2ea043,color:#7ee787",
        "    classDef meta fill:#1d1d24,stroke:#4a4a58,color:#9aa3b5",
    ].join("\n");
}

type GlobalWithService = typeof globalThis & {workflowDemoService?: WorkflowDemoService};

/** 单例（依赖 useAgentHarness 单例；随 Nitro 进程存续） */
export function useWorkflowDemoService(): WorkflowDemoService {
    const g = globalThis as GlobalWithService;
    if (!g.workflowDemoService) g.workflowDemoService = new WorkflowDemoService();
    return g.workflowDemoService;
}
