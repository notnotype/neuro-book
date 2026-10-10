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

import {Agent} from "@oh-my-pi/pi-agent-core";
import type {AgentEvent, AgentMessage, AgentTool} from "@oh-my-pi/pi-agent-core";
import {isContextOverflow} from "@oh-my-pi/pi-ai/error";
import type {AssistantMessage, Message, ToolResultMessage} from "@oh-my-pi/pi-ai";
import {compactSession, shouldCompact} from "../compaction/compaction";
import type {Compacted} from "../compaction/compaction";
import type {PreparedProfile, PromptContext, ProfileState} from "../profile/profile";
import {buildModelContext, planRecovery, sessionSettings, sessionStatus, withoutUndefined} from "../session/session";
import type {DistributiveOmit, EntryInput, InteractionData, InvocationPhase, JsonValue, SessionEntry, SessionLog} from "../session/session";
import {createStaticToolSource, decideApproval, describeTool, judgeWithModel, toAgentTool} from "../tools/tools";
import type {AdapterHooks, ApprovalMode, ApprovalOutcome, ApprovalRequest, ToolDescriptor} from "../tools/tools";
import {accept} from "./accept";
import type {Accepted} from "./accept";
import type {AgentSession, InteractionAnswer, Invocation, InvocationResult, PromptOptions, RuntimeDeps, RuntimeEvent, RuntimeResult, SessionStatus, UserInput} from "./types";

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
type Mode = {kind: "prompt"; input: UserInput} | {kind: "continue"} | {kind: "resume"; invocationId: string};
type Current = {
    invocationId: string;
    accepted: Accepted;
    prepared: PreparedProfile | null;
    entries: SessionEntry[];
    turns: number;
    limitHit: boolean;
    settleDone(result: InvocationResult): void;
    done: Promise<InvocationResult>;
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
    readonly #deps: RuntimeDeps;
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
    #writes: Promise<unknown> = Promise.resolve();
    #invocationStart = 0;
    #logError = "";
    #closed = false;
    #suppressWrites = false;
    #releaseLog: () => void;

    constructor(deps: RuntimeDeps, log: SessionLog, profileId: string | undefined) {
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

    get status(): SessionStatus {
        const replayed = sessionStatus(this.log.entries);
        return {
            phase: this.#phase,
            ...(this.#current === null ? (replayed.invocationId === undefined ? {} : {invocationId: replayed.invocationId}) : {invocationId: this.#current.invocationId}),
            pending: replayed.pending,
            queue: {steer: this.#steered.size, followUp: this.#followUps.length},
            ...(this.#profileId === undefined ? {} : {profileId: this.#profileId}),
            ...(this.#lastModel === undefined ? {} : {model: this.#lastModel}),
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
                this.#suppressWrites = true;
                this.#logError = `${result.code}：${result.detail}`;
                this.#agent.abort();
                return {ok: false, code: "log-failed", detail: this.#logError};
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
            return {ok: true, value: {invocationId: this.#current.invocationId, done: this.#current.done}};
        }
        if (options.profileId !== undefined) this.#profileId = options.profileId;
        if (this.#profileId === undefined) return {ok: false, code: "unknown-profile", detail: "会话没有 Profile"};
        const accepted = await accept(this.#deps, {log: this.log, profileId: this.#profileId, ...(this.#sessionMode === undefined ? {} : {sessionMode: this.#sessionMode})}, {
            input, needsInput: true, ...(options.model === undefined ? {} : {model: options.model}), ...(options.signal === undefined ? {} : {signal: options.signal}),
        });
        if (!accepted.ok) return accepted;
        return this.#start(accepted.value, {kind: "prompt", input}, options.signal);
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
        const accepted = await accept(this.#deps, {log: this.log, profileId: this.#profileId, ...(this.#sessionMode === undefined ? {} : {sessionMode: this.#sessionMode})}, {
            needsInput: false, ...(options.signal === undefined ? {} : {signal: options.signal}),
        });
        if (!accepted.ok) return accepted;
        return this.#start(accepted.value, {kind: "continue"}, options.signal);
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
            // 恢复出来的等待状态：没有运行中的循环，把待处理的审批写成拒绝、补中断结果、收口
            this.#setPhase("aborting");
            void this.#abortRecovered();
            return {ok: true, value: undefined};
        }
        this.#setPhase("aborting");
        void this.#settlePending({aborted: true}, "aborted");
        this.#agent.abort();
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
        const current: Current = {invocationId, accepted, prepared: null, entries: [], turns: 0, limitHit: false, settleDone: resolve, done: promise};
        this.#current = current;
        this.#lastModel = accepted.modelRef;
        this.#phase = "running";
        if (mode.kind !== "resume") {
            const started = await this.#writeInvocation(invocationId, "start", {
                profileId: accepted.profile.id, model: accepted.modelRef, tools: accepted.tools.map((tool) => tool.id), reason: mode.kind,
            });
            if (!started.ok) {
                this.#current = null;
                this.#phase = "idle";
                return started;
            }
        }
        this.#emit({type: "status", status: this.status});
        signal?.addEventListener("abort", () => void this.abort(), {once: true});
        void this.#execute(current, mode).then((result) => this.#finish(current, result));
        return {ok: true, value: {invocationId, done: promise}};
    }

    async #execute(current: Current, mode: Mode): Promise<InvocationResult> {
        const {accepted, invocationId} = current;
        const fail = (kind: "profile" | "log", message: string): InvocationResult => ({status: "failed", error: {kind, message}, entries: current.entries});
        const context: PromptContext = {
            session: {id: this.id, createdAt: this.log.header.createdAt, ...(sessionSettings(this.log.entries).title === undefined ? {} : {title: sessionSettings(this.log.entries).title!})},
            turn: countTurns(this.log.entries) + (mode.kind === "prompt" ? 1 : 0),
            now: new Date(this.#now()),
            fields: accepted.profile.fields,
        };
        const prepared = await this.#deps.host.prepare(accepted.profile, {context});
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

        // 装配 Agent：历史从日志回放；本次的消息交给 prompt；工具带审批钩子
        this.#agent.replaceMessages(replayed);
        this.#agent.setSystemPrompt(host.renderSystem(prepared.value).systemPrompt);
        this.#agent.setModel(accepted.model);
        this.#agent.setTools(accepted.tools.map((descriptor) => toAgentTool(descriptor, this.#hooks(current))));
        this.#invocationStart = invocationStart;

        const release = this.#agent.subscribe((event) => this.#onAgentEvent(current, event));
        try {
            if (mode.kind === "prompt") await this.#agent.prompt(forAgent);
            else await this.#agent.continue();
        } catch (error) {
            release();
            if (this.#suppressWrites) return this.#classify(current);
            await this.#writeInvocation(invocationId, "error", {kind: "model", message: errorText(error)});
            return {status: "failed", error: {kind: "model", message: errorText(error)}, entries: current.entries};
        }
        release();
        await this.#writes;
        return this.#classify(current);
    }

    /** 每次模型调用前：刷新 model-call 数据源，按 Profile 渲染请求；系统提示词可能随之变化。 */
    async #transformContext(messages: AgentMessage[]): Promise<AgentMessage[]> {
        const current = this.#current;
        if (current === null || current.prepared === null) return messages;
        const refreshed = await this.#deps.host.refresh(current.prepared, {});
        if (refreshed.ok) current.prepared = refreshed.value;
        const out = this.#deps.host.renderRequest(current.prepared, {history: keepAllRoles(messages), invocationStart: this.#invocationStart});
        this.#agent.setSystemPrompt(out.systemPrompt);
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

    // ---- 审批 ----

    #hooks(current: Current): AdapterHooks {
        return {
            source: {list: () => [], get: (id) => this.#deps.tools.map((source) => source.get(id)).find((definition) => definition !== undefined)},
            session: {id: this.id},
            ...(this.#deps.interceptor === undefined ? {} : {interceptor: this.#deps.interceptor}),
            approve: (request) => this.#approve(current, request),
            report: () => undefined,
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
        return this.#waitForUser(current, interactionId, request.signal);
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
        const replayed = sessionStatus(this.log.entries);
        const pending = replayed.pending.find((item) => item.interactionId === answer.interactionId);
        if (pending === undefined) {
            const answered = this.log.entries.some((entry) => entry.type === "custom" && entry.customType === "harness/interaction" && (entry.data as InteractionData).interactionId === answer.interactionId);
            return {ok: false, code: answered ? "already-answered" : "unknown-interaction", detail: `事项 ${answer.interactionId}`};
        }
        const response: NonNullable<InteractionData["response"]> = {decision: answer.decision, scope: answer.scope ?? "once", decidedBy: "user", ...(answer.note === undefined ? {} : {note: answer.note})};
        if (this.#current !== null) {
            const outcome: ApprovalOutcome = answer.decision === "approve" ? {approved: true} : {approved: false, reason: answer.note ?? "用户拒绝"};
            await this.#settleOne(answer.interactionId, outcome, response);
            return {ok: true, value: undefined};
        }
        return this.#resumeAfterRestart(replayed.invocationId!, answer.interactionId, pending.request, response);
    }

    /** 输出 13：进程重启后的应答——运行时自己执行（或拒绝）这个调用、写结果，该批齐了再让模型继续。 */
    async #resumeAfterRestart(invocationId: string, interactionId: string, request: {assistantEntryId: string; toolCallId: string; toolName: string}, response: NonNullable<InteractionData["response"]>): Promise<RuntimeResult<void>> {
        const written = await this.#writeInteraction(invocationId, {interactionId, kind: "approval", phase: "response", response});
        if (!written.ok) return written;
        const result = response.decision === "reject"
            ? toolResultMessage(request.toolCallId, request.toolName, `denied: ${response.note ?? "用户拒绝"}`, true, this.#now())
            : await this.#executeRecovered(request);
        const wroteResult = await this.#write([{type: "message", message: result}]);
        if (!wroteResult.ok) return wroteResult;
        if (sessionStatus(this.log.entries).pending.length > 0) return {ok: true, value: undefined};
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

    async #executeRecovered(request: {assistantEntryId: string; toolCallId: string; toolName: string}): Promise<ToolResultMessage> {
        const entry = this.log.entries.find((item) => item.id === request.assistantEntryId);
        const call = entry?.type === "message" && entry.message.role === "assistant"
            ? entry.message.content.find((block): block is Extract<typeof block, {type: "toolCall"}> => block.type === "toolCall" && block.id === request.toolCallId)
            : undefined;
        const found = this.#descriptorFor(request.toolName);
        if (call === undefined || found === null) return toolResultMessage(request.toolCallId, request.toolName, `tool-unavailable: 工具 ${request.toolName} 此刻不可用`, true, this.#now());
        const result = await found.tool.execute(request.toolCallId, call.arguments, undefined, undefined);
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
        if (this.#profileId === undefined) return {ok: false, code: "unknown-profile", detail: "会话没有 Profile"};
        const accepted = await accept(this.#deps, {log: this.log, profileId: this.#profileId}, {needsInput: false});
        if (!accepted.ok) return accepted;
        const context: PromptContext = {session: {id: this.id, createdAt: this.log.header.createdAt}, turn: countTurns(this.log.entries), now: new Date(this.#now()), fields: accepted.value.profile.fields};
        const prepared = await this.#deps.host.prepare(accepted.value.profile, {context});
        if (!prepared.ok) return {ok: false, code: "invalid-profile", detail: `${prepared.code}: ${prepared.detail}`};
        return this.#compactWith(accepted.value, prepared.value, options.signal);
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

    async #autoCompact(current: Current): Promise<void> {
        const {accepted, prepared} = current;
        if (prepared === null) return;
        const decision = shouldCompact({entries: this.log.entries, contextWindow: accepted.model.contextWindow ?? 0, settings: accepted.compaction});
        if (!decision.compact) return;
        await this.#compactWith(accepted, prepared);
    }

    // ---- 工具来源与描述（恢复执行用） ----

    #descriptorFor(toolName: string): {descriptor: ToolDescriptor; tool: AgentTool} | null {
        const definition = this.#deps.tools.map((source) => source.get(toolName)).find((item) => item !== undefined);
        if (definition === undefined) return null;
        const descriptor = describeTool(definition);
        const hooks: AdapterHooks = {source: createStaticToolSource([definition]), session: {id: this.id}, approve: async () => ({approved: true}), ...(this.#deps.interceptor === undefined ? {} : {interceptor: this.#deps.interceptor})};
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
