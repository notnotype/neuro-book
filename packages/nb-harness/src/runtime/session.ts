/**
 * 会话句柄（docs/specs/harness/runtime.md 输出 1–16）：一个会话一个 OMP `Agent`，外面加状态机、排队、写入顺序、审批等待与恢复、事件。
 *
 * 几条先后关系，读代码前先知道：
 * - 受理（accept.ts）不写任何条目；受理通过后第一条写入是 `invocation start`，写完才把 `{invocationId, done}` 交给调用方。
 * - 本次输入、提醒与 Profile 状态在循环开始前写；助手消息与工具结果在 OMP `message_end` 时写；插话消息在 OMP 送出它时写。
 *   所有写入经 `write()` 串成一条链，顺序与发生顺序一致；审批钩子在读“含这个工具调用的助手条目”之前先等这条链。
 * - 终态条目写入 → 自动压缩 → 状态回到 idle 并发 status → `done` 完成 → 处理追加队列。
 * - `close()` 遇到等待用户的调用：不再写任何条目（下次打开按输出 13 恢复），只让 OMP 的循环停下来。
 */

import {Agent, Tokenizer} from "@oh-my-pi/pi-agent-core";
import type {AgentEvent, AgentMessage, AgentTool} from "@oh-my-pi/pi-agent-core";
import type {Model} from "@oh-my-pi/pi-catalog";
import {isContextOverflow} from "@oh-my-pi/pi-ai/error";
import type {AssistantMessage, Message, ToolResultMessage} from "@oh-my-pi/pi-ai";
import {compactSession, shouldCompact} from "../compaction/compaction";
import type {Compacted, CompactionSettings} from "../compaction/compaction";
import type {Diagnostic, PreparedProfile, PromptContext, ProfileState} from "../profile/profile";
import {buildModelContext, planRecovery, sessionSettings, sessionStatus, withoutUndefined} from "../session/session";
import type {DistributiveOmit, EntryInput, InteractionData, InvocationPhase, JsonValue, SessionEntry, SessionLog, SessionStatus as ReplayedStatus} from "../session/session";
import {createStaticToolSource, decideApproval, DEFAULT_TOOL_RESULT_BUDGET, describeTool, judgeWithModel, toAgentTool} from "../tools/tools";
import type {AdapterHooks, ApprovalMode, ApprovalOutcome, ApprovalRequest, ToolDescriptor, ToolResultBudget} from "../tools/tools";
import {accept, check} from "./accept";
import type {Accepted, Checked} from "./accept";
import type {ApprovalAnswer, AgentSession, InteractionAnswer, Invocation, InvocationError, InvocationResult, InvocationStep, Preview, PreviewOptions, PromptOptions, ResolvedDeps, RuntimeEvent, RuntimeResult, SessionStatus, UserInput} from "./types";

const LLM_ROLES = new Set(["user", "developer", "assistant", "toolResult"]);
/** OMP 缺省的 convertToLlm 会丢掉 developer 消息（session 的实测），运行时自己保留四种角色。 */
const keepAllRoles = (messages: AgentMessage[]): Message[] => messages.filter((message): message is Message => LLM_ROLES.has(message.role));
const DEFAULT_MAX_TURNS = 50;
type Emitted = DistributiveOmit<RuntimeEvent, "seq" | "sessionId">;

/** 种子与提醒都是用户或开发者消息（Profile 的合同），内容只有文本与图片块。 */
function plainContent(message: Message): string | (Extract<Message, {role: "user"}>["content"] extends infer C ? C : never) {
    if (message.role === "assistant") throw new Error("种子与提醒不能是助手消息");
    return message.content as Extract<Message, {role: "user"}>["content"];
}

type Pending = {interactionId: string; invocationId: string; settle(outcome: ApprovalOutcome): void};
/** 最近一次受理取定的模型与压缩设置：status.context 按它算用量与阈值。 */
type LastContext = {model: Model; window: number; settings: CompactionSettings};
type Mode = {kind: "prompt"; input: UserInput} | {kind: "continue"} | {kind: "resume"; invocationId: string};
type Current = {
    invocationId: string;
    accepted: Accepted;
    prepared: PreparedProfile | null;
    entries: SessionEntry[];
    turns: number;
    limitHit: boolean;
    /** 这次调用的中止控制器：prepare 与数据源、审批等待之外的尾段（自动压缩）都看它；Agent 自己的循环由 Agent.abort 停。 */
    control: AbortController;
    /** 循环中途发现的、要以 failed 收口的失败（例如 model-call 数据源刷新失败）。 */
    failure: InvocationError | null;
    settleDone(result: InvocationResult): void;
    done: Promise<InvocationResult>;
    next(): Promise<InvocationStep>;
    /** 等待点未到时挂起的 `next()`：再调用共用它，不另订阅（Spec 输出 6）。 */
    pendingNext: Promise<InvocationStep> | null;
};

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));
/** OMP 的消息对象带着值为 undefined 的可选字段（details、providerMetadata 等），会话只收能被 JSON 如实表示的值。 */
const jsonMessage = (message: AgentMessage): Message => withoutUndefined(message as Message);
const isAssistant = (message: AgentMessage | undefined): message is AssistantMessage => message !== undefined && message.role === "assistant";
const hasToolCall = (message: AssistantMessage): boolean => message.content.some((block) => block.type === "toolCall");

function userInputMessage(input: UserInput, timestamp: number): Message {
    return {role: "user", content: typeof input.content === "string" ? input.content : input.content.map((block) => ({...block})), timestamp};
}

/** 有状态节点的最新状态：最后一条本 Profile 的 profile-state 条目。 */
function latestProfileState(entries: readonly SessionEntry[], profileId: string): ProfileState {
    for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index]!;
        if (entry.type === "custom" && entry.customType === "harness/profile-state") {
            const data = entry.data as {profileId: string; state: ProfileState};
            if (data.profileId === profileId) return data.state;
        }
    }
    return {};
}

const countTurns = (entries: readonly SessionEntry[]): number =>
    entries.filter((entry) => entry.type === "message" && entry.message.role === "user" && entry.message.attribution !== "agent" && entry.message.synthetic !== true).length;

function lastProfileId(entries: readonly SessionEntry[]): string | undefined {
    for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index]!;
        if (entry.type === "custom" && entry.customType === "harness/invocation") {
            const detail = (entry.data as {detail?: {profileId?: unknown}}).detail;
            if (typeof detail?.profileId === "string") return detail.profileId;
        }
    }
    return undefined;
}

export class SessionHandle implements AgentSession {
    readonly id: string;
    readonly log: SessionLog;
    readonly #deps: ResolvedDeps;
    readonly #agent: Agent;
    readonly #listeners = new Set<(event: RuntimeEvent) => void>();
    readonly #pending = new Map<string, Pending>();
    /** 交给 OMP `steer` 的消息对象：OMP 送出时（message_end）才写进日志，靠对象身份认出来。 */
    readonly #steered = new Set<AgentMessage>();
    readonly #followUps: UserInput[] = [];
    #profileId: string | undefined;
    #phase: SessionStatus["phase"] = "idle";
    #current: Current | null = null;
    #seq = 0;
    #sessionMode: ApprovalMode | undefined;
    #lastModel: string | undefined;
    #lastContext: LastContext | null = null;
    /**
     * `status` 的两份缓存，都以日志的条目数组为键：日志每次追加换一个新的冻结数组，引用相同就是没有新条目，
     * 不必重新回放（Spec 输出 5）；用量还要看最近一次受理的模型与设置的身份。
     */
    #replayCache: {entries: readonly SessionEntry[]; status: ReplayedStatus} | null = null;
    #contextCache: {entries: readonly SessionEntry[]; last: LastContext; value: NonNullable<SessionStatus["context"]>} | null = null;
    #writes: Promise<unknown> = Promise.resolve();
    #invocationStart = 0;
    #logError = "";
    /** 受理（含手动压缩）期间会话被占用：phase 还是 idle，但第二个操作要被拒绝，否则两次受理会争同一个 Agent 与日志。 */
    #reserved: "prompt" | "continue" | "compact" | null = null;
    /** 正在应答的事项：两次 resolve 同时到达时，第二次在任何 await 之前就被挡成 already-answered。 */
    readonly #answering = new Set<string>();
    /** 恢复执行（进程重启后 resolve 触发的工具执行与继续）的所有权；abort 经它中止，迟到的完成不再写入。 */
    #recovery: AbortController | null = null;
    #closed = false;
    #suppressWrites = false;
    #releaseLog: () => void;

    constructor(deps: ResolvedDeps, log: SessionLog, profileId: string | undefined) {
        this.#deps = deps;
        this.log = log;
        this.id = log.header.id;
        this.#profileId = profileId ?? lastProfileId(log.entries);
        this.#agent = new Agent({
            initialState: {systemPrompt: [], tools: []},
            convertToLlm: keepAllRoles,
            steeringMode: "all",
            followUpMode: "all",
            ...(deps.model?.stream === undefined ? {} : {streamFn: deps.model.stream}),
            getApiKey: () => this.#current?.accepted.apiKey,
            transformContext: (messages) => this.#transformContext(messages),
        });
        this.#releaseLog = log.subscribe((event) => this.#emit({type: "entry", logSeq: event.seq, entry: event.entry}), {afterSeq: log.entries.length}).release;
        this.#phase = sessionStatus(log.entries).phase === "waiting" ? "waiting-user" : "idle";
    }

    // ---- 状态与事件 ----

    #replayed(): ReplayedStatus {
        const entries = this.log.entries;
        if (this.#replayCache === null || this.#replayCache.entries !== entries) {
            // 缓存会交给多个调用方：冻结，免得一处改了 pending 大家都看到（request 本来就是冻结的日志数据）
            const status = sessionStatus(entries);
            for (const item of status.pending) Object.freeze(item);
            Object.freeze(status.pending);
            this.#replayCache = {entries, status: Object.freeze(status)};
        }
        return this.#replayCache.status;
    }

    get status(): SessionStatus {
        const replayed = this.#replayed();
        return {
            phase: this.#phase,
            ...(this.#current === null ? (replayed.invocationId === undefined ? {} : {invocationId: replayed.invocationId}) : {invocationId: this.#current.invocationId}),
            pending: replayed.pending,
            queue: {steer: this.#steered.size, followUp: this.#followUps.length},
            ...(this.#profileId === undefined ? {} : {profileId: this.#profileId}),
            ...(this.#lastModel === undefined ? {} : {model: this.#lastModel}),
            ...(this.#lastContext === null ? {} : {context: this.#contextUsage(this.#lastContext)}),
        };
    }

    #contextUsage(last: LastContext): NonNullable<SessionStatus["context"]> {
        const entries = this.log.entries;
        if (this.#contextCache !== null && this.#contextCache.entries === entries && this.#contextCache.last === last) return this.#contextCache.value;
        const decision = shouldCompact({entries, contextWindow: last.window, settings: last.settings});
        // 还没有助手消息报告用量：按回放出的上下文估算，界面在第一次回复前也有数可画
        const value: NonNullable<SessionStatus["context"]> = Object.freeze(decision.contextTokens === null
            ? {tokens: new Tokenizer(last.model).countMessages(buildModelContext(entries)), source: "estimated" as const, window: last.window, threshold: decision.thresholdTokens}
            : {tokens: decision.contextTokens, source: "reported" as const, window: last.window, threshold: decision.thresholdTokens});
        this.#contextCache = {entries, last, value};
        return value;
    }

    /** 输出 6 的 `Invocation.next()`：这次调用正在等待用户就立即给事项；否则等它进入等待或结束，先到的那个。 */
    #nextStep(current: Current): () => Promise<InvocationStep> {
        return () => {
            if (this.#current === current && this.#phase === "waiting-user") {
                const {pending} = this.status;
                if (pending.length > 0) return Promise.resolve({kind: "waiting", pending});
            }
            if (current.pendingNext !== null) return current.pendingNext;
            const waiting = new Promise<InvocationStep>((resolve) => {
                const settle = (step: InvocationStep): void => {
                    subscription.release();
                    current.pendingNext = null;
                    resolve(step);
                };
                const subscription = this.subscribe((event) => {
                    if (event.type === "status" && event.status.phase === "waiting-user" && this.#current === current && event.status.pending.length > 0) settle({kind: "waiting", pending: event.status.pending});
                });
                void current.done.then((result) => settle({kind: "done", result}));
            });
            current.pendingNext = waiting;
            return waiting;
        };
    }

    subscribe(listener: (event: RuntimeEvent) => void): {release(): void} {
        if (!this.#closed) this.#listeners.add(listener);
        return {release: () => void this.#listeners.delete(listener)};
    }

    #emit(event: Emitted): void {
        this.#seq += 1;
        const full = {...event, seq: this.#seq, sessionId: this.id} as RuntimeEvent;
        for (const listener of [...this.#listeners]) {
            try {
                listener(full);
            } catch {
                // 监听函数自己的错误只结束它自己的订阅
                this.#listeners.delete(listener);
            }
        }
    }

    #setPhase(phase: SessionStatus["phase"]): void {
        this.#phase = phase;
        this.#emit({type: "status", status: this.status});
    }

    #emitQueue(): void {
        this.#emit({type: "queue", steer: this.#steered.size, followUp: this.#followUps.length});
    }

    // ---- 写入 ----

    /** 所有写入串成一条链；失败让句柄进入关闭态（日志句柄已坏）。close 后的收尾写入被抑制。 */
    #write(inputs: readonly EntryInput[]): Promise<RuntimeResult<readonly SessionEntry[]>> {
        const run = async (): Promise<RuntimeResult<readonly SessionEntry[]>> => {
            if (this.#suppressWrites) return {ok: true, value: []};
            const result = await this.log.append(inputs);
            if (!result.ok) {
                // 条目校验失败是本层的程序错误（例如同一事项写了两次应答），日志还能用；存储失败、句柄已坏或已关才让会话进入关闭态
                if (result.code !== "invalid-entry") {
                    this.#suppressWrites = true;
                    this.#logError = `${result.code}：${result.detail}`;
                    this.#agent.abort();
                }
                return {ok: false, code: "log-failed", detail: `${result.code}：${result.detail}`};
            }
            this.#current?.entries.push(...result.value);
            return result;
        };
        const chained = this.#writes.then(run, run);
        this.#writes = chained;
        return chained;
    }

    #now(): number {
        return (this.#deps.now ?? (() => new Date()))().getTime();
    }

    async #writeInvocation(invocationId: string, phase: InvocationPhase, detail?: JsonValue): Promise<RuntimeResult<readonly SessionEntry[]>> {
        const data = {invocationId, phase, ...(detail === undefined ? {} : {detail})};
        const result = await this.#write([{type: "custom", customType: "harness/invocation", data}]);
        if (result.ok && result.value.length > 0) this.#emit({type: "invocation", invocationId, phase, ...(detail === undefined ? {} : {detail})});
        return result;
    }

    async #writeInteraction(invocationId: string, data: InteractionData): Promise<RuntimeResult<readonly SessionEntry[]>> {
        const result = await this.#write([{type: "custom", customType: "harness/interaction", data}]);
        if (result.ok && result.value.length > 0) this.#emit({type: "interaction", invocationId, interactionId: data.interactionId, phase: data.phase, data});
        return result;
    }

    // ---- 操作矩阵 ----

    async prompt(input: UserInput, options: PromptOptions = {}): Promise<RuntimeResult<Invocation>> {
        if (this.#closed) return {ok: false, code: "closed", detail: "会话句柄已关闭"};
        if (this.#phase === "aborting") return {ok: false, code: "invalid-state", detail: "正在中止"};
        if (this.#phase !== "idle") {
            if (options.streamingBehavior === undefined) return {ok: false, code: "busy", detail: "有进行中的调用；用 streamingBehavior 排队"};
            const queued = options.streamingBehavior === "steer" ? this.steer(input) : this.followup(input);
            if (!queued.ok) return queued;
            if (this.#current === null) return {ok: false, code: "invalid-state", detail: "等待用户的调用不在本进程内运行，先 resolve"};
            return {ok: true, value: {invocationId: this.#current.invocationId, done: this.#current.done, next: this.#current.next}};
        }
        if (this.#reserved !== null) return {ok: false, code: "busy", detail: `会话正在${this.#reserved === "compact" ? "压缩" : "受理另一次调用"}`};
        // 换 Profile 只在受理通过后生效（#start 里记下），受理失败不留痕迹
        const profileId = options.profileId ?? this.#profileId;
        if (profileId === undefined) return {ok: false, code: "unknown-profile", detail: "会话没有 Profile"};
        this.#reserved = "prompt";
        try {
            const accepted = await accept(this.#deps, {log: this.log, profileId, ...(this.#sessionMode === undefined ? {} : {sessionMode: this.#sessionMode})}, {
                input, needsInput: true, ...(options.model === undefined ? {} : {model: options.model}), ...(options.signal === undefined ? {} : {signal: options.signal}),
            });
            if (!accepted.ok) return accepted;
            return await this.#start(accepted.value, {kind: "prompt", input}, options.signal);
        } finally {
            this.#reserved = null;
        }
    }

    async continue(options: {signal?: AbortSignal} = {}): Promise<RuntimeResult<Invocation>> {
        if (this.#closed) return {ok: false, code: "closed", detail: "会话句柄已关闭"};
        if (this.#phase === "running" || this.#phase === "aborting") return {ok: false, code: this.#phase === "running" ? "busy" : "invalid-state", detail: "有进行中的调用"};
        if (this.#phase === "waiting-user") return {ok: false, code: "invalid-state", detail: "正在等待用户，用 resolve"};
        if (this.#profileId === undefined) return {ok: false, code: "unknown-profile", detail: "会话没有 Profile"};
        const tail = buildModelContext(this.log.entries).at(-1);
        const resumable = tail !== undefined && (tail.role === "user" || tail.role === "toolResult");
        // 回放已经去掉了 error 的助手消息，所以“末尾是失败的回复”表现为末尾是它之前的用户消息或工具结果
        if (!resumable) return {ok: false, code: "invalid-state", detail: "末尾不可继续：没有历史，或最后一条已是正常的助手回复"};
        if (this.#reserved !== null) return {ok: false, code: "busy", detail: `会话正在${this.#reserved === "compact" ? "压缩" : "受理另一次调用"}`};
        this.#reserved = "continue";
        try {
            const accepted = await accept(this.#deps, {log: this.log, profileId: this.#profileId, ...(this.#sessionMode === undefined ? {} : {sessionMode: this.#sessionMode})}, {
                needsInput: false, ...(options.signal === undefined ? {} : {signal: options.signal}),
            });
            if (!accepted.ok) return accepted;
            return await this.#start(accepted.value, {kind: "continue"}, options.signal);
        } finally {
            this.#reserved = null;
        }
    }

    steer(input: UserInput): RuntimeResult<void> {
        if (this.#closed) return {ok: false, code: "closed", detail: "会话句柄已关闭"};
        if (this.#phase !== "running" && this.#phase !== "waiting-user") return {ok: false, code: "invalid-state", detail: "没有运行中的调用"};
        if (this.#current === null) return {ok: false, code: "invalid-state", detail: "等待用户的调用不在本进程内运行"};
        const message = userInputMessage(input, this.#now());
        this.#steered.add(message);
        this.#agent.steer(message);
        this.#emitQueue();
        return {ok: true, value: undefined};
    }

    followup(input: UserInput): RuntimeResult<void> {
        if (this.#closed) return {ok: false, code: "closed", detail: "会话句柄已关闭"};
        if (this.#phase !== "running" && this.#phase !== "waiting-user") return {ok: false, code: "invalid-state", detail: "没有运行中的调用"};
        this.#followUps.push(input);
        this.#emitQueue();
        return {ok: true, value: undefined};
    }

    abort(options: {clearQueue?: boolean} = {}): RuntimeResult<void> {
        if (this.#closed) return {ok: false, code: "closed", detail: "会话句柄已关闭"};
        if (this.#phase === "idle" || this.#phase === "aborting") return {ok: true, value: undefined};
        if (options.clearQueue !== false) {
            this.#agent.clearSteeringQueue();
            this.#steered.clear();
            this.#followUps.length = 0;
            this.#emitQueue();
        }
        if (this.#current === null) {
            // 恢复出来的等待状态：没有运行中的循环；中止正在恢复执行的工具，把待处理的审批写成拒绝、补中断结果、收口
            this.#setPhase("aborting");
            this.#recovery?.abort();
            this.#recovery = null;
            void this.#abortRecovered();
            return {ok: true, value: undefined};
        }
        this.#setPhase("aborting");
        void this.#settlePending({aborted: true}, "aborted");
        this.#agent.abort();
        this.#current.control.abort();
        return {ok: true, value: undefined};
    }

    setApprovalMode(mode: ApprovalMode | undefined): void {
        this.#sessionMode = mode;
    }

    async close(): Promise<void> {
        if (this.#closed) return;
        this.#closed = true;
        const current = this.#current;
        if (current !== null) {
            if (this.#phase === "waiting-user") {
                // 等待用户的调用留给下次打开恢复：不再写任何条目，只让循环停下
                this.#suppressWrites = true;
                for (const pending of this.#pending.values()) pending.settle({aborted: true});
                this.#pending.clear();
            }
            this.#agent.abort();
            await current.done;
        }
        this.#releaseLog();
        this.#listeners.clear();
        this.log.close();
    }

    // ---- 一次调用 ----

    async #start(accepted: Accepted, mode: Mode, signal: AbortSignal | undefined): Promise<RuntimeResult<Invocation>> {
        const invocationId = mode.kind === "resume" ? mode.invocationId : crypto.randomUUID();
        const {promise, resolve} = Promise.withResolvers<InvocationResult>();
        const current: Current = {invocationId, accepted, prepared: null, entries: [], turns: 0, limitHit: false, control: new AbortController(), failure: null, settleDone: resolve, done: promise, next: () => Promise.reject(new Error("未初始化")), pendingNext: null};
        current.next = this.#nextStep(current);
        this.#current = current;
        this.#profileId = accepted.profile.id;
        this.#lastModel = accepted.modelRef;
        this.#lastContext = {model: accepted.model, window: accepted.model.contextWindow ?? 0, settings: accepted.compaction};
        this.#phase = "running";
        if (mode.kind !== "resume") {
            const started = await this.#writeInvocation(invocationId, "start", {
                profileId: accepted.profile.id, model: accepted.modelRef, tools: accepted.tools.map((tool) => tool.id), reason: mode.kind,
                ...(accepted.missingTools.length === 0 ? {} : {missingTools: accepted.missingTools}),
            });
            if (!started.ok) {
                this.#current = null;
                this.#phase = "idle";
                return started;
            }
        }
        this.#emit({type: "status", status: this.status});
        // 调用方的信号只属于这次调用：收口时解除监听，迟到的中止不能波及下一次调用
        const onAbort = (): void => {
            if (this.#current === current) void this.abort();
        };
        signal?.addEventListener("abort", onAbort, {once: true});
        void this.#execute(current, mode).then((result) => this.#finish(current, result)).finally(() => signal?.removeEventListener("abort", onAbort));
        return {ok: true, value: {invocationId, done: promise, next: current.next}};
    }

    async #execute(current: Current, mode: Mode): Promise<InvocationResult> {
        const {accepted, invocationId} = current;
        const fail = (kind: "profile" | "log", message: string): InvocationResult => ({status: "failed", error: {kind, message}, entries: current.entries});
        const context = this.#promptContext(this.log.entries, accepted, mode.kind === "prompt" ? 1 : 0);
        const abortedBeforeLoop = async (): Promise<InvocationResult> => {
            await this.#writeInvocation(invocationId, "aborted");
            return {status: "aborted", entries: current.entries};
        };
        const prepared = await this.#deps.host.prepare(accepted.profile, {context, signal: current.control.signal});
        if (current.control.signal.aborted) return abortedBeforeLoop();
        if (!prepared.ok) {
            await this.#writeInvocation(invocationId, "error", {kind: "profile", message: `${prepared.code}: ${prepared.detail}`});
            return fail("profile", `${prepared.code}: ${prepared.detail}`);
        }
        current.prepared = prepared.value;
        const host = this.#deps.host;

        // 种子、输入、提醒、状态：都在循环开始前写
        const forAgent: Message[] = [];
        if (mode.kind === "prompt") {
            if (!this.log.entries.some((entry) => entry.type === "custom_message" && entry.customType === "harness/seed")) {
                const seeds = host.renderSeeds(prepared.value, "new-session");
                const seedEntries: EntryInput[] = seeds.messages.map(({message, once}) => ({
                    type: "custom_message", customType: "harness/seed", content: plainContent(message), display: true,
                    details: {role: message.role as "user" | "developer", ...(once ? {once: true} : {})},
                }));
                if (seedEntries.length > 0) {
                    const written = await this.#write(seedEntries);
                    if (!written.ok) return fail("log", written.detail);
                }
            }
            const settings = sessionSettings(this.log.entries);
            if (settings.model !== accepted.modelRef) {
                const written = await this.#write([{type: "model_change", model: accepted.modelRef, ...(accepted.role === undefined ? {} : {role: accepted.role})}]);
                if (!written.ok) return fail("log", written.detail);
            }
        }
        const before = this.log.entries;
        const replayed = buildModelContext(before);
        // 本次调用的起点：恢复时是这次调用 start 之前的历史在上下文里的长度；新调用时就是现在的上下文长度
        const startIndex = mode.kind === "resume" ? before.findIndex((entry) => entry.type === "custom" && entry.customType === "harness/invocation" && (entry.data as {invocationId: string; phase: string}).invocationId === invocationId && (entry.data as {phase: string}).phase === "start") : -1;
        const invocationStart = startIndex === -1 ? replayed.length : buildModelContext(before.slice(0, startIndex)).length;
        if (mode.kind === "prompt") {
            const appending = host.renderAppending(prepared.value, {input: mode.input, state: latestProfileState(before, accepted.profile.id)});
            const entries: EntryInput[] = [];
            for (const appended of appending.messages) {
                const message: Message = appended.kind === "input" || appended.message.role !== "user" ? appended.message : {...appended.message, attribution: "agent"};
                forAgent.push(message);
                if (appended.kind === "reminder") entries.push({type: "custom_message", customType: "harness/reminder", content: plainContent(message), display: false});
                else entries.push({type: "message", message});
            }
            if (JSON.stringify(appending.state) !== JSON.stringify(latestProfileState(before, accepted.profile.id))) {
                entries.push({type: "custom", customType: "harness/profile-state", data: {profileId: accepted.profile.id, state: appending.state}});
            }
            const written = await this.#write(entries);
            if (!written.ok) return fail("log", written.detail);
        }
        // 准备期间中止：不开始循环
        if (current.control.signal.aborted) return abortedBeforeLoop();

        // 装配 Agent：历史从日志回放；本次的消息交给 prompt；工具带审批钩子
        this.#agent.replaceMessages(replayed);
        this.#agent.setSystemPrompt(host.renderSystem(prepared.value).systemPrompt);
        this.#agent.setModel(accepted.model);
        this.#agent.setTools(accepted.tools.map((descriptor) => toAgentTool(descriptor, this.#hooks(current))));
        this.#invocationStart = invocationStart;

        const release = this.#agent.subscribe((event) => this.#onAgentEvent(current, event));
        // 每次模型调用前：刷新 model-call 数据源并重渲染系统提示词。放在 OMP 的 before-model-call 钩子里，
        // 因为 OMP 在它之后才把 state.systemPrompt 放进本轮上下文；放在 transformContext 里会晚一轮才生效。
        const releaseHook = this.#agent.addBeforeModelCallHook(() => this.#refreshBeforeModelCall(current));
        try {
            if (mode.kind === "prompt") await this.#agent.prompt(forAgent);
            else await this.#agent.continue();
        } catch (error) {
            release();
            releaseHook();
            if (this.#suppressWrites || current.failure !== null) return this.#classify(current);
            await this.#writeInvocation(invocationId, "error", {kind: "model", message: errorText(error)});
            return {status: "failed", error: {kind: "model", message: errorText(error)}, entries: current.entries};
        }
        release();
        releaseHook();
        await this.#writes;
        return this.#classify(current);
    }

    /** 刷新 model-call 数据源并重渲染系统提示词；刷新失败是 Profile 失败：停下循环，由 classify 以 failed/profile 收口。 */
    async #refreshBeforeModelCall(current: Current): Promise<void> {
        if (current.prepared === null || current.failure !== null || current.control.signal.aborted) return;
        const refreshed = await this.#deps.host.refresh(current.prepared, {signal: current.control.signal});
        // 中止引起的取消不是 Profile 的失败，由 classify 按 aborted 收口
        if (!refreshed.ok && (refreshed.code === "cancelled" || current.control.signal.aborted)) return;
        if (!refreshed.ok) {
            current.failure = {kind: "profile", message: `${refreshed.code}: ${refreshed.detail}`};
            this.#agent.abort();
            // 抛出让 OMP 在发请求之前停下（只 abort 的话这一次请求还是会发出去）
            throw new Error(`Profile 刷新失败：${refreshed.code}: ${refreshed.detail}`);
        }
        current.prepared = refreshed.value;
        this.#agent.setSystemPrompt(this.#deps.host.renderSystem(current.prepared).systemPrompt);
    }

    /** 每次模型调用前按 Profile 渲染请求消息（系统提示词已在 before-model-call 钩子里更新）。 */
    async #transformContext(messages: AgentMessage[]): Promise<AgentMessage[]> {
        const current = this.#current;
        if (current === null || current.prepared === null) return messages;
        const out = this.#deps.host.renderRequest(current.prepared, {history: keepAllRoles(messages), invocationStart: this.#invocationStart});
        return out.messages;
    }

    #onAgentEvent(current: Current, event: AgentEvent): void {
        const {invocationId} = current;
        switch (event.type) {
            case "message_update":
                if (isAssistant(event.message)) this.#emit({type: "stream", invocationId, message: event.message});
                return;
            case "message_end": {
                const message = event.message;
                if (message.role === "assistant" || message.role === "toolResult") void this.#write([{type: "message", message: jsonMessage(message)}]);
                else if (this.#steered.has(message)) {
                    this.#steered.delete(message);
                    void this.#write([{type: "message", message: jsonMessage(message)}]);
                    this.#emitQueue();
                }
                return;
            }
            case "tool_execution_start":
                this.#emit({type: "tool", invocationId, toolCallId: event.toolCallId, toolName: event.toolName, stage: "start", args: event.args as JsonValue});
                return;
            case "tool_execution_update":
                this.#emit({type: "tool", invocationId, toolCallId: event.toolCallId, toolName: event.toolName, stage: "update", progress: (event.partialResult as {details?: JsonValue})?.details ?? null});
                return;
            case "tool_execution_end":
                this.#emit({type: "tool", invocationId, toolCallId: event.toolCallId, toolName: event.toolName, stage: "end", ...(event.isError === undefined ? {} : {isError: event.isError})});
                return;
            case "turn_end":
                if (!isAssistant(event.message)) return;
                current.turns += 1;
                if (current.turns >= (this.#deps.limits?.maxTurns ?? DEFAULT_MAX_TURNS) && hasToolCall(event.message)) {
                    current.limitHit = true;
                    this.#agent.abort();
                }
                return;
            default:
                return;
        }
    }

    async #classify(current: Current): Promise<InvocationResult> {
        const {invocationId, accepted} = current;
        const entries = current.entries;
        if (this.#suppressWrites) {
            if (this.#closed && this.#phase === "waiting-user") return {status: "waiting", entries};
            return {status: "failed", error: {kind: "log", message: this.#logError || "日志写入失败"}, entries};
        }
        const last = this.#agent.state.messages.at(-1);
        const lastAssistant = [...this.#agent.state.messages].reverse().find(isAssistant);
        if (current.failure !== null) {
            await this.#writeInvocation(invocationId, "error", {kind: current.failure.kind, message: current.failure.message});
            return {status: "failed", error: current.failure, entries};
        }
        if (current.limitHit) {
            await this.#writeInvocation(invocationId, "error", {kind: "limit", message: `助手回复达到上限 ${this.#deps.limits?.maxTurns ?? DEFAULT_MAX_TURNS} 轮`});
            return {status: "failed", error: {kind: "limit", message: "助手回复达到上限"}, entries};
        }
        if (lastAssistant !== undefined && lastAssistant.stopReason === "aborted" && (last === lastAssistant || this.#phase === "aborting")) {
            await this.#writeInvocation(invocationId, "aborted");
            return {status: "aborted", entries};
        }
        if (lastAssistant !== undefined && lastAssistant.stopReason === "error" && last === lastAssistant) {
            const message = lastAssistant.errorMessage ?? "模型调用失败";
            const overflow = isContextOverflow(lastAssistant, accepted.model.contextWindow ?? undefined);
            await this.#writeInvocation(invocationId, "error", {kind: "model", message, overflow});
            return {status: "failed", error: {kind: "model", message, overflow}, entries};
        }
        await this.#writeInvocation(invocationId, "end");
        return {status: "completed", entries};
    }

    async #finish(current: Current, result: InvocationResult): Promise<void> {
        if (result.status === "completed" && current.prepared !== null && !this.#suppressWrites) await this.#autoCompact(current);
        this.#current = null;
        if (this.#suppressWrites && !this.#closed) {
            // 日志写入失败：句柄随日志进入关闭态
            this.#closed = true;
            this.#releaseLog();
            this.log.close();
        }
        this.#phase = result.status === "waiting" ? "waiting-user" : "idle";
        this.#emit({type: "status", status: this.status});
        current.settleDone({...result, entries: [...current.entries]});
        if (result.status === "completed" && !this.#closed) {
            const next = this.#followUps.shift();
            if (next !== undefined) {
                this.#emitQueue();
                const started = await this.prompt(next);
                if (!started.ok) {
                    this.#followUps.unshift(next);
                    this.#emit({type: "status", status: this.status});
                }
            }
        }
    }

    /** Profile 看到的调用上下文：轮数按用户发出的消息数，`turnDelta` 为本次是否带新输入。 */
    #promptContext(entries: readonly SessionEntry[], accepted: Checked, turnDelta: 0 | 1): PromptContext {
        const settings = sessionSettings(entries);
        return {
            session: {id: this.id, createdAt: this.log.header.createdAt, ...(settings.title === undefined ? {} : {title: settings.title})},
            turn: countTurns(entries) + turnDelta,
            now: new Date(this.#now()),
            fields: accepted.profile.fields,
        };
    }

    /** 输出 17：此刻发起调用模型会收到什么。只读：受理检查不取凭据，渲染结果不写入、不发事件、不改状态。 */
    async preview(input?: UserInput, options: PreviewOptions = {}): Promise<RuntimeResult<Preview>> {
        if (this.#closed) return {ok: false, code: "closed", detail: "会话句柄已关闭"};
        const profileId = options.profileId ?? this.#profileId;
        if (profileId === undefined) return {ok: false, code: "unknown-profile", detail: "会话没有 Profile"};
        const checked = await check(this.#deps, {log: this.log, profileId, ...(this.#sessionMode === undefined ? {} : {sessionMode: this.#sessionMode})}, {
            ...(input === undefined ? {} : {input}), needsInput: input !== undefined, ...(options.model === undefined ? {} : {model: options.model}), ...(options.signal === undefined ? {} : {signal: options.signal}),
        });
        if (!checked.ok) return checked;
        const {profile} = checked.value;
        // 读的是这一刻的日志：之后追加的条目不影响这次预览
        const entries = this.log.entries;
        const host = this.#deps.host;
        // 准备或刷新期间中止与受理前中止同一个码；别的失败才是 Profile 的问题
        const invalid = (failure: {code: string; detail: string; diagnostics: Diagnostic[]}): RuntimeResult<never> => failure.code === "cancelled"
            ? {ok: false, code: "invalid-state", detail: "预览期间中止"}
            : {ok: false, code: "invalid-profile", detail: [`${failure.code}: ${failure.detail}`, ...failure.diagnostics.map((item) => `${item.code} ${item.path}：${item.detail}`)].join("\n")};
        const prepared = await host.prepare(profile, {context: this.#promptContext(entries, checked.value, input === undefined ? 0 : 1), ...(options.signal === undefined ? {} : {signal: options.signal})});
        if (!prepared.ok) return invalid(prepared);
        // 与真跑同一顺序：种子与追加消息按 prepare 的结果渲染（真跑在刷新之前就把它们写进日志），刷新只影响系统提示词与请求消息
        const requested = profile.fields["harness/tools"];
        const diagnostics: Diagnostic[] = checked.value.missingTools.map((id) => ({
            severity: "warning", code: "unknown-tool", path: `fields.harness/tools[${Array.isArray(requested) ? requested.indexOf(id) : -1}]`, detail: `工具来源里没有 ${id}，这个 Profile 在这里看不到它`,
        }));
        const seeded = entries.some((entry) => entry.type === "custom_message" && entry.customType === "harness/seed");
        const seeds: Message[] = [];
        if (!seeded) {
            const output = host.renderSeeds(prepared.value, "new-session");
            // 真跑把种子写成 harness/seed 条目、回放成 attribution: agent 的消息：预览给的是回放后的形状，History 的 last 才数得一样
            seeds.push(...output.messages.map(({message}) => ({...message, attribution: "agent"} as Message)));
            diagnostics.push(...output.diagnostics);
        }
        const appended: Message[] = [];
        if (input !== undefined) {
            const output = host.renderAppending(prepared.value, {input, state: latestProfileState(entries, profile.id)});
            for (const item of output.messages) appended.push(item.kind === "input" || item.message.role !== "user" ? item.message : {...item.message, attribution: "agent"});
            diagnostics.push(...output.diagnostics);
        }
        // 与第一次请求前一致：model-call 数据源刷新一次，系统提示词与请求消息按刷新后的；renderRequest 自带系统提示词与它的诊断，不再单独渲染一次
        const refreshed = await host.refresh(prepared.value, options.signal === undefined ? {} : {signal: options.signal});
        if (!refreshed.ok) return invalid(refreshed);
        const replayed = buildModelContext(entries);
        const request = host.renderRequest(refreshed.value, {history: [...replayed, ...seeds, ...appended], invocationStart: replayed.length + seeds.length});
        diagnostics.push(...request.diagnostics);
        return {ok: true, value: {model: checked.value.modelRef, tools: checked.value.tools.map((tool) => tool.id), system: request.systemPrompt, seeds, appended, request: request.messages, diagnostics}};
    }

    // ---- 审批 ----

    /** 工具结果的预算与溢出去处（harness.tools 输出 9）：全文存到本会话名下，模型按 `artifact://<序号>` 回读。 */
    #resultHooks(): Pick<AdapterHooks, "artifacts" | "budget"> {
        const budget: ToolResultBudget = {...DEFAULT_TOOL_RESULT_BUDGET, ...this.#deps.limits?.toolResult};
        return {
            budget,
            artifacts: {
                save: async (toolName, text) => {
                    const saved = await this.#deps.artifacts.save(this.id, toolName, text);
                    return saved.ok ? saved.value.id : null;
                },
            },
        };
    }

    #hooks(current: Current): AdapterHooks {
        return {
            source: {list: () => [], get: (id) => this.#deps.tools.map((source) => source.get(id)).find((definition) => definition !== undefined)},
            session: {id: this.id},
            ...(this.#deps.interceptor === undefined ? {} : {interceptor: this.#deps.interceptor}),
            approve: (request) => this.#approve(current, request),
            report: () => undefined,
            ...this.#resultHooks(),
        };
    }

    async #approve(current: Current, request: ApprovalRequest): Promise<ApprovalOutcome> {
        const {accepted, invocationId} = current;
        const decision = decideApproval({tool: request.definition, args: request.args, mode: accepted.approvalMode, config: accepted.config.approval.tools, grants: sessionSettings(this.log.entries).approvalGrants});
        if (decision.outcome === "allow") return {approved: true};
        if (decision.outcome === "deny") return {approved: false, reason: decision.reason};
        await this.#writes;
        if (request.signal.aborted) return {aborted: true};
        const assistantEntry = [...current.entries].reverse().find((entry) => entry.type === "message" && entry.message.role === "assistant" && entry.message.content.some((block) => block.type === "toolCall" && block.id === request.toolCallId));
        if (assistantEntry === undefined) return {approved: false, reason: "找不到发出这个调用的助手消息"};
        const interactionId = crypto.randomUUID();
        const written = await this.#writeInteraction(invocationId, {
            interactionId, kind: "approval", phase: "request",
            request: {assistantEntryId: assistantEntry.id, toolCallId: request.toolCallId, toolName: request.toolId, tier: decision.tier},
        });
        if (!written.ok) return {aborted: true};
        if (decision.outcome === "model") {
            const judged = await this.#judge(current, request, decision.tier);
            if (judged !== null) {
                await this.#writeInteraction(invocationId, {interactionId, kind: "approval", phase: "response", response: {decision: judged.approved ? "approve" : "reject", scope: "once", decidedBy: "approver", note: judged.reason}});
                return judged.approved ? {approved: true} : {approved: false, reason: judged.reason};
            }
        }
        // 宿主回调在用户之前：它给不出（null）才落成 pending 事项等 resolve
        const hosted = await this.#askHost(current, request, interactionId, decision.tier);
        if (hosted !== null) {
            await this.#writeInteraction(invocationId, {interactionId, kind: "approval", phase: "response", response: hosted.response});
            return hosted.outcome;
        }
        return this.#waitForUser(current, interactionId, request.signal);
    }

    /** 宿主审批回调（输出 6）：抛出按拒绝——与 OMP 钩子出错即拒绝一致，宁可拒也不放行。 */
    async #askHost(current: Current, request: ApprovalRequest, interactionId: string, tier: "read" | "write" | "exec"): Promise<{outcome: ApprovalOutcome; response: NonNullable<InteractionData["response"]>} | null> {
        const approve = this.#deps.approve;
        if (approve === undefined) return null;
        const {accepted, invocationId} = current;
        let answer: ApprovalAnswer | null;
        try {
            answer = await approve({
                sessionId: this.id, invocationId, interactionId, toolName: request.toolId, toolCallId: request.toolCallId, args: request.args as JsonValue, tier,
                profile: {id: accepted.profile.id, name: accepted.profile.name}, signal: request.signal,
            });
        } catch (error) {
            const note = `审批回调出错：${error instanceof Error ? error.message : String(error)}`;
            return {outcome: {approved: false, reason: note}, response: {decision: "reject", scope: "once", decidedBy: "host", note}};
        }
        if (answer === null) return null;
        if (request.signal.aborted) return {outcome: {aborted: true}, response: {decision: "reject", scope: "once", decidedBy: "host", note: "aborted"}};
        const response: NonNullable<InteractionData["response"]> = {decision: answer.decision, scope: answer.scope ?? "once", decidedBy: "host", ...(answer.note === undefined ? {} : {note: answer.note})};
        return {outcome: answer.decision === "approve" ? {approved: true} : {approved: false, reason: answer.note ?? "宿主拒绝"}, response};
    }

    /** 审批模型：角色 approval 解析不到或调用失败都交给用户（escalate → null）。 */
    async #judge(current: Current, request: ApprovalRequest, tier: "read" | "write" | "exec"): Promise<{approved: boolean; reason: string} | null> {
        const selected = this.#deps.models.select({role: "approval"});
        if (!selected.ok) return null;
        const apiKey = await this.#deps.credentials.apiKeyFor(selected.value.model);
        if (apiKey === undefined) return null;
        const recent = keepAllRoles(this.#agent.state.messages).slice(-6);
        const judgement = await judgeWithModel({
            model: selected.value.model, apiKey,
            request: {tool: {id: request.definition.id, description: request.definition.description}, args: request.args as JsonValue, tier, profile: {id: current.accepted.profile.id, name: current.accepted.profile.name}, recent},
            ...(this.#deps.judge?.stream === undefined ? {} : {stream: this.#deps.judge.stream}),
            ...(this.#deps.judge?.timeoutMs === undefined ? {} : {timeoutMs: this.#deps.judge.timeoutMs}),
            signal: request.signal,
        });
        if (judgement.decision === "escalate") return null;
        return {approved: judgement.decision === "allow", reason: judgement.reason};
    }

    async #waitForUser(current: Current, interactionId: string, signal: AbortSignal): Promise<ApprovalOutcome> {
        if (signal.aborted) {
            await this.#writeInteraction(current.invocationId, {interactionId, kind: "approval", phase: "response", response: {decision: "reject", decidedBy: "user", note: "aborted"}});
            return {aborted: true};
        }
        const {promise, resolve} = Promise.withResolvers<ApprovalOutcome>();
        this.#pending.set(interactionId, {interactionId, invocationId: current.invocationId, settle: resolve});
        if (this.#pending.size === 1 && this.#phase === "running") {
            await this.#writeInvocation(current.invocationId, "waiting");
            this.#setPhase("waiting-user");
        }
        const onAbort = (): void => void this.#settleOne(interactionId, {aborted: true}, {decision: "reject", decidedBy: "user", note: "aborted"});
        signal.addEventListener("abort", onAbort, {once: true});
        try {
            return await promise;
        } finally {
            signal.removeEventListener("abort", onAbort);
        }
    }

    async #settleOne(interactionId: string, outcome: ApprovalOutcome, response: NonNullable<InteractionData["response"]>): Promise<boolean> {
        const pending = this.#pending.get(interactionId);
        if (pending === undefined) return false;
        this.#pending.delete(interactionId);
        await this.#writeInteraction(pending.invocationId, {interactionId, kind: "approval", phase: "response", response});
        pending.settle(outcome);
        if (this.#pending.size === 0 && this.#phase === "waiting-user" && this.#current !== null) {
            await this.#writeInvocation(pending.invocationId, "resumed");
            this.#setPhase("running");
        }
        return true;
    }

    async #settlePending(outcome: ApprovalOutcome, note: string): Promise<void> {
        for (const interactionId of [...this.#pending.keys()]) await this.#settleOne(interactionId, outcome, {decision: "reject", decidedBy: "user", note});
    }

    async resolve(answer: InteractionAnswer): Promise<RuntimeResult<void>> {
        if (this.#closed) return {ok: false, code: "closed", detail: "会话句柄已关闭"};
        if (this.#phase !== "waiting-user") return {ok: false, code: "invalid-state", detail: "没有在等待用户"};
        if (this.#answering.has(answer.interactionId)) return {ok: false, code: "already-answered", detail: `事项 ${answer.interactionId} 正在应答`};
        const replayed = sessionStatus(this.log.entries);
        const pending = replayed.pending.find((item) => item.interactionId === answer.interactionId);
        if (pending === undefined) {
            const answered = this.log.entries.some((entry) => entry.type === "custom" && entry.customType === "harness/interaction" && (entry.data as InteractionData).interactionId === answer.interactionId);
            return {ok: false, code: answered ? "already-answered" : "unknown-interaction", detail: `事项 ${answer.interactionId}`};
        }
        const response: NonNullable<InteractionData["response"]> = {decision: answer.decision, scope: answer.scope ?? "once", decidedBy: "user", ...(answer.note === undefined ? {} : {note: answer.note})};
        this.#answering.add(answer.interactionId);
        try {
            if (this.#current !== null) {
                const outcome: ApprovalOutcome = answer.decision === "approve" ? {approved: true} : {approved: false, reason: answer.note ?? "用户拒绝"};
                await this.#settleOne(answer.interactionId, outcome, response);
                return {ok: true, value: undefined};
            }
            return await this.#resumeAfterRestart(replayed.invocationId!, answer.interactionId, pending.request, response);
        } finally {
            this.#answering.delete(answer.interactionId);
        }
    }

    /** 输出 13：进程重启后的应答——运行时自己执行（或拒绝）这个调用、写结果，该批齐了再让模型继续。 */
    async #resumeAfterRestart(invocationId: string, interactionId: string, request: {assistantEntryId: string; toolCallId: string; toolName: string}, response: NonNullable<InteractionData["response"]>): Promise<RuntimeResult<void>> {
        // 恢复执行归一个控制器所有：abort 中止它，中止之后的每一步都不再写入（迟到的工具结果也不写）
        const recovery = this.#recovery ?? new AbortController();
        this.#recovery = recovery;
        const aborted = (): RuntimeResult<never> => ({ok: false, code: "invalid-state", detail: "恢复期间已中止"});
        const written = await this.#writeInteraction(invocationId, {interactionId, kind: "approval", phase: "response", response});
        if (!written.ok) return written;
        if (recovery.signal.aborted) return aborted();
        const result = response.decision === "reject"
            ? toolResultMessage(request.toolCallId, request.toolName, `denied: ${response.note ?? "用户拒绝"}`, true, this.#now())
            : await this.#executeRecovered(request, recovery.signal);
        if (recovery.signal.aborted) return aborted();
        const wroteResult = await this.#write([{type: "message", message: result}]);
        if (!wroteResult.ok) return wroteResult;
        if (sessionStatus(this.log.entries).pending.length > 0) return {ok: true, value: undefined};
        if (recovery.signal.aborted) return aborted();
        this.#recovery = null;
        const resumed = await this.#writeInvocation(invocationId, "resumed");
        if (!resumed.ok) return resumed;
        this.#phase = "running";
        if (this.#profileId === undefined) return {ok: false, code: "unknown-profile", detail: "会话没有 Profile"};
        const accepted = await accept(this.#deps, {log: this.log, profileId: this.#profileId, ...(this.#sessionMode === undefined ? {} : {sessionMode: this.#sessionMode})}, {needsInput: false});
        if (!accepted.ok) {
            await this.#writeInvocation(invocationId, "error", {kind: "model", message: `${accepted.code}: ${accepted.detail}`});
            this.#setPhase("idle");
            return accepted;
        }
        const started = await this.#start(accepted.value, {kind: "resume", invocationId}, undefined);
        return started.ok ? {ok: true, value: undefined} : started;
    }

    async #executeRecovered(request: {assistantEntryId: string; toolCallId: string; toolName: string}, signal: AbortSignal): Promise<ToolResultMessage> {
        const entry = this.log.entries.find((item) => item.id === request.assistantEntryId);
        const call = entry?.type === "message" && entry.message.role === "assistant"
            ? entry.message.content.find((block): block is Extract<typeof block, {type: "toolCall"}> => block.type === "toolCall" && block.id === request.toolCallId)
            : undefined;
        const found = this.#descriptorFor(request.toolName);
        if (call === undefined || found === null) return toolResultMessage(request.toolCallId, request.toolName, `tool-unavailable: 工具 ${request.toolName} 此刻不可用`, true, this.#now());
        const result = await found.tool.execute(request.toolCallId, call.arguments, signal, undefined);
        return {role: "toolResult", toolCallId: request.toolCallId, toolName: request.toolName, content: result.content, isError: result.isError === true, timestamp: this.#now()};
    }

    async #abortRecovered(): Promise<void> {
        const status = sessionStatus(this.log.entries);
        for (const pending of status.pending) {
            await this.#writeInteraction(status.invocationId!, {interactionId: pending.interactionId, kind: "approval", phase: "response", response: {decision: "reject", decidedBy: "user", note: "aborted"}});
            await this.#write([{type: "message", message: toolResultMessage(pending.request.toolCallId, pending.request.toolName, "aborted: 调用已中止", true, this.#now())}]);
        }
        // 这个窗口里其它没有结果的调用照崩溃规则补结果；生命周期由这里写 aborted，不用收口计划里的 interrupted
        await this.#write(planRecovery(this.log.entries).filter((input) => input.type !== "custom"));
        if (status.invocationId !== undefined) await this.#writeInvocation(status.invocationId, "aborted");
        this.#setPhase("idle");
    }

    async compact(options: {signal?: AbortSignal} = {}): Promise<RuntimeResult<Compacted | null>> {
        if (this.#closed) return {ok: false, code: "closed", detail: "会话句柄已关闭"};
        if (this.#phase !== "idle") return {ok: false, code: "busy", detail: "有进行中的调用"};
        if (this.#reserved !== null) return {ok: false, code: "busy", detail: `会话正在${this.#reserved === "compact" ? "压缩" : "受理另一次调用"}`};
        if (this.#profileId === undefined) return {ok: false, code: "unknown-profile", detail: "会话没有 Profile"};
        // 压缩期间会话被占用：第二次压缩与新的调用都 busy，直到写入完成或失败
        this.#reserved = "compact";
        try {
            const accepted = await accept(this.#deps, {log: this.log, profileId: this.#profileId}, {needsInput: false});
            if (!accepted.ok) return accepted;
            // 没有窗口的模型压不了（阈值与 soft 都按它算）：这是配置缺项，不是“没东西可压”
            const window = accepted.value.model.contextWindow;
            if (window === null || !(window > 0)) {
                return {ok: false, code: "compaction-failed", detail: `模型 ${accepted.value.modelRef} 没有 contextWindow：自建服务的模型要在配置里给出 contextWindow（harness.config），压缩阈值与 soft 方法都按它算`};
            }
            const prepared = await this.#deps.host.prepare(accepted.value.profile, {context: this.#promptContext(this.log.entries, accepted.value, 0)});
            if (!prepared.ok) return {ok: false, code: "invalid-profile", detail: `${prepared.code}: ${prepared.detail}`};
            return await this.#compactWith(accepted.value, prepared.value, options.signal);
        } finally {
            this.#reserved = null;
        }
    }

    async #compactWith(accepted: Accepted, prepared: PreparedProfile, signal?: AbortSignal): Promise<RuntimeResult<Compacted | null>> {
        const seeds: EntryInput[] = this.#deps.host.renderSeeds(prepared, "after-compaction").messages.map(({message}) => ({
            type: "custom_message", customType: "harness/seed", content: plainContent(message), display: true, details: {role: message.role as "user" | "developer"},
        }));
        const result = await compactSession({log: this.log, registry: this.#deps.compaction, model: accepted.model, apiKey: accepted.apiKey, settings: accepted.compaction, seeds, ...(signal === undefined ? {} : {signal})});
        if (result.ok) {
            this.#emit({type: "compaction", result: {ok: true, method: result.value.method}});
            return {ok: true, value: result.value};
        }
        if (result.code === "nothing-to-compact") return {ok: true, value: null};
        this.#emit({type: "compaction", result: {ok: false, code: result.code, detail: result.detail}});
        if (result.code === "log-failed") return {ok: false, code: "log-failed", detail: result.detail};
        if (result.code === "cancelled") return {ok: false, code: "invalid-state", detail: "压缩被中止"};
        return {ok: false, code: "compaction-failed", detail: `${result.code}：${result.detail}`};
    }

    /** 自动压缩是调用终态之后的尾段：写入的条目也算本次调用的；abort 取消它但不改变调用已经 completed 的结果（Spec 输出 14）。 */
    async #autoCompact(current: Current): Promise<void> {
        const {accepted, prepared} = current;
        if (prepared === null || current.control.signal.aborted) return;
        const decision = shouldCompact({entries: this.log.entries, contextWindow: accepted.model.contextWindow ?? 0, settings: accepted.compaction});
        if (!decision.compact) return;
        const compacted = await this.#compactWith(accepted, prepared, current.control.signal);
        if (compacted.ok && compacted.value !== null) current.entries.push(...compacted.value.entries);
    }

    // ---- 工具来源与描述（恢复执行用） ----

    #descriptorFor(toolName: string): {descriptor: ToolDescriptor; tool: AgentTool} | null {
        const definition = this.#deps.tools.map((source) => source.get(toolName)).find((item) => item !== undefined);
        if (definition === undefined) return null;
        const descriptor = describeTool(definition);
        const hooks: AdapterHooks = {source: createStaticToolSource([definition]), session: {id: this.id}, approve: async () => ({approved: true}), ...(this.#deps.interceptor === undefined ? {} : {interceptor: this.#deps.interceptor}), ...this.#resultHooks()};
        return {descriptor, tool: toAgentTool(descriptor, hooks)};
    }

}

function toolResultMessage(toolCallId: string, toolName: string, text: string, isError: boolean, timestamp: number): ToolResultMessage {
    return {role: "toolResult", toolCallId, toolName, content: [{type: "text", text}], isError, timestamp};
}

/** 打开已有会话：按需收口（输出 13）。 */
export async function recoverEntries(log: SessionLog): Promise<RuntimeResult<void>> {
    const status = sessionStatus(log.entries);
    if (status.phase === "idle") return {ok: true, value: undefined};
    const plan = planRecovery(log.entries);
    if (plan.length === 0) return {ok: true, value: undefined};
    const written = await log.append(plan);
    if (!written.ok) return {ok: false, code: "log-failed", detail: `${written.code}：${written.detail}`};
    return {ok: true, value: undefined};
}
