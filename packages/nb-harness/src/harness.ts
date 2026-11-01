/**
 * 只经 Profile 运行的会话（docs/specs/agent/harness.md）。
 *
 * 一次 `turn()` 里几件事的先后（读懂这个文件要先知道它）：
 * 1. 占用会话（重叠的调用在任何副作用之前报 `session_busy`），解析密钥，把本轮用户消息写进日志，再交给
 *    `agent.prompt`；它的 `message_end` 按对象身份跳过，所以恰写一次。
 * 2. 每次请求模型前，OMP 先调 `transformContext(循环自己的上下文)`，再把转换好的 provider 上下文交给
 *    `transformProviderContext`。送模型的内容只在 `transformContext` 里渲染一次：先等循环上下文里的每条工具
 *    结果都写进日志（OMP 的循环把事件推进流里就往下走，订阅者异步收到，上一批最后几条结果的 `message_end`
 *    可能还没投递），再用已落盘的原样消息渲染 Profile，交回消息、暂存系统提示词；`transformProviderContext`
 *    换上同一次渲染的系统提示词。系统提示词与消息因此出自同一份历史（输出 7、8），Agent 内部的调度历史不动。
 *    一条消息写不进日志（写失败、不能序列化）时会话坏掉：它永远进不了历史，之后的运行都以 local 失败，不等它。
 * 3. 模型消息与工具结果在 `message_end` 时按到达顺序排进写队列（原样消息，助手消息后跟一条用量）。
 * 4. 收尾工具：`beforeToolCall` 拦下混在一批里的；`afterToolCall` 只记“候选”并用 OMP 的 terminal reason
 *    停止循环。OMP 的顺序是 execute → afterToolCall → tool_execution_end → 工具结果的 message_end，所以
 *    候选要等它的工具结果写进日志才结算为 finished（输出 16），钩子里不能等这次写入。
 */

import {Agent, TERMINAL_TOOL_RESULT_ABORT_REASON, type AgentEvent, type AgentMessage, type StreamFn} from "@oh-my-pi/pi-agent-core";
import {streamSimple, type AssistantMessage, type Effort} from "@oh-my-pi/pi-ai";
import {isProfileDefinition, ProfileError, type ProfileDefinition} from "@notnotype/nb-profile";
import type {JsonValue, SessionEntry, SessionEntryInput, SessionLog} from "@notnotype/nb-session";
import {renderContext} from "./context.js";
import {HarnessError} from "./errors.js";
import {createFinishWatch, type FinishWatch} from "./finish-watch.js";
import type {ThinkingEffort} from "./models/catalog.js";
import {MissingModelKeyError, type ResolvedModel} from "./model.js";
import {mergeAdjacentUserMessages} from "./merge-user-messages.js";
import {redactEventMessages} from "./redact.js";
import {classifyProviderError, usageEntry, UsageMeter, type RunError, type StopReason, type TurnResult} from "./run-result.js";
import {bridgeTools} from "./tools/bridge.js";
import {declarationJson, resolveEffectiveTools, restoreEffectiveTools, type ToolPolicy} from "./tools/effective.js";
import {frozenCopy, type RegisteredTool, type ToolRegistry} from "./tools/registry.js";

export interface HarnessOptions {
    readonly profile: ProfileDefinition;
    /** 新会话必须给；恢复会话（日志以快照开头）不给。 */
    readonly initial?: unknown;
    readonly registry: ToolRegistry;
    readonly policy?: ToolPolicy;
    readonly model: ResolvedModel;
    readonly sessionLog: SessionLog;
    /** 不写就不发推理参数。模型不支持的档由 OMP 拒绝；宿主先用 `clampEffort` 夹好。 */
    readonly thinkingLevel?: ThinkingEffort;
    /** 替换模型输出（测试用）；provider 层仍走 OMP 的 `streamSimple`。 */
    readonly streamFn?: StreamFn;
}

export interface Harness {
    readonly sessionId: string;
    /** 这个会话的生效工具集（工具 id）。 */
    readonly tools: readonly string[];
    turn(input: string, options?: {readonly signal?: AbortSignal}): Promise<TurnResult>;
    subscribe(listener: (event: AgentEvent) => void): () => void;
    close(): Promise<void>;
}

/** 一次运行的可变状态；只在它自己的 `turn` 任务里读写。 */
interface Run {
    readonly meter: UsageMeter;
    /** 这次运行写进日志的条目，按写入顺序；结果里的 `entries` 就是它，不再回读日志。 */
    readonly entries: SessionEntry[];
    cancelled: boolean;
    /** harness 自己的步骤出的错（密钥缺失、写日志、渲染、序列化），优先于模型给的错误。 */
    hostError: RunError | null;
    /** 这次运行里最后一次请求的流是否没给结束原因（见 finish-watch.ts）；最后一次请求决定最后一条助手消息。 */
    lastFinish: FinishWatch | null;
    finishCandidate: {readonly callId: string; readonly tool: string; readonly args: unknown} | null;
    finished: {readonly tool: string; readonly args: unknown} | null;
    task: Promise<TurnResult> | null;
}

function toJson(value: unknown): JsonValue {
    return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function authError(error: MissingModelKeyError): RunError {
    return {kind: "auth", status: null, message: error.message};
}

function localError(message: string): RunError {
    return {kind: "local", status: null, message};
}

function wrapProfileError(error: unknown): never {
    if (error instanceof ProfileError) throw new HarnessError(error.code, error.message, {details: error.details});
    throw error;
}

export async function createHarness(options: HarnessOptions): Promise<Harness> {
    const {profile, registry, sessionLog, model} = options;
    if (!isProfileDefinition(profile)) throw new HarnessError("profile_invalid", "profile 不是 defineProfile 的结果");
    const sessionId = sessionLog.sessionId;
    const existing = await sessionLog.read();

    let initial: unknown;
    let tools: RegisteredTool[];
    const history: AgentMessage[] = [];
    if (existing.length === 0) {
        if (options.initial === undefined) throw new HarnessError("invalid_initial", "新会话要给 initial");
        try {
            initial = frozenCopy(toJson(profile.parseInitial(options.initial)));
        } catch (error) {
            wrapProfileError(error);
        }
        tools = resolveEffectiveTools(profile, registry, options.policy);
        await sessionLog.append([
            {kind: "session_snapshot", profile: {key: profile.manifest.key, version: profile.manifest.version}, initial: toJson(initial), tools: tools.map((tool) => declarationJson(tool.declaration))},
        ]);
    } else {
        const [snapshot] = existing;
        if (snapshot?.kind !== "session_snapshot") throw new HarnessError("session_incompatible", "会话日志没有快照（旧格式），不能恢复");
        if (options.initial !== undefined) throw new HarnessError("invalid_initial", "恢复会话时不能再给 initial");
        if (snapshot.profile.key !== profile.manifest.key || snapshot.profile.version !== profile.manifest.version) {
            throw new HarnessError("session_incompatible", `快照的 Profile 是 ${snapshot.profile.key}@${snapshot.profile.version}，现在是 ${profile.manifest.key}@${profile.manifest.version}`, {
                snapshot: snapshot.profile,
                profile: {key: profile.manifest.key, version: profile.manifest.version},
            });
        }
        initial = frozenCopy(snapshot.initial);
        tools = restoreEffectiveTools(snapshot.tools, profile, registry);
        for (const entry of existing) if (entry.kind === "agent_message") history.push(entry.message as unknown as AgentMessage);
    }

    const toolIds = new Set(tools.map((tool) => tool.declaration.id));
    const finishNames = new Map(tools.filter((tool) => tool.declaration.finish).map((tool) => [tool.declaration.name, tool.declaration.id] as const));
    const bridged = bridgeTools(tools, {sessionId, initial}, registry);

    // 写队列：条目按事件到达的顺序串行写入；`history` 只收已写进日志的原样消息，渲染就用它。
    let writes: Promise<void> = Promise.resolve();
    let writeError: unknown = null;
    // 已写进日志的工具结果；transformContext 据此判断循环上下文里的结果是否都已落盘。
    const writtenResults = new Set<string>();
    const recordWritten = (messages: readonly AgentMessage[]): void => {
        for (const message of messages) if (message.role === "toolResult") writtenResults.add((message as {toolCallId: string}).toolCallId);
    };
    recordWritten(history);
    // 会话坏掉的原因：有消息写不进日志，历史从此缺一块，不能再渲染出完整的上下文（见文件头第 2 条）。
    let broken: RunError | null = null;
    // 每写进一批消息、会话坏掉或运行被取消时唤醒一次 transformContext 里的等待。
    let historyChanged = Promise.withResolvers<void>();
    const notifyHistory = (): void => {
        const changed = historyChanged;
        historyChanged = Promise.withResolvers<void>();
        changed.resolve();
    };
    const enqueue = (owner: Run | null, inputs: readonly SessionEntryInput[], onWritten?: () => void, messages: readonly AgentMessage[] = []): Promise<void> => {
        const write = writes.then(async () => {
            if (writeError !== null) throw writeError;
            let stamped: readonly SessionEntry[];
            try {
                stamped = await sessionLog.append(inputs);
            } catch (error) {
                writeError = error;
                broken ??= localError(`写会话日志失败：${String(error)}`);
                notifyHistory();
                throw error;
            }
            owner?.entries.push(...stamped);
            history.push(...messages);
            recordWritten(messages);
            if (messages.length > 0) notifyHistory();
            onWritten?.();
        });
        writes = write.catch(() => undefined);
        return write;
    };
    const drain = async (): Promise<void> => {
        await writes;
        if (writeError !== null) throw writeError;
    };

    let run: Run | null = null;
    let state: "idle" | "running" | "closing" | "closed" = "idle";
    let closing: Promise<void> | null = null;
    // 这一次请求渲染出的系统提示词，transformContext 写、transformProviderContext 读。
    let renderedSystemPrompt: string[] | null = null;
    const persisted = new WeakSet<object>();
    const listeners = new Set<(event: AgentEvent) => void>();

    const baseStream = options.streamFn ?? (streamSimple as StreamFn);
    // 这个会话交给 provider 的密钥，用来遮盖错误正文里的回显。
    const usedKeys = new Set<string>();
    const agent = new Agent({
        initialState: {model: model.model, systemPrompt: [], tools: bridged.agentTools, messages: [...history]},
        sessionId,
        // 每次请求前 OMP 都会取密钥：缺失时在这里记下 auth，否则经 Agent 外层捕获后只剩文字（输出 18）。
        getApiKey: () => {
            try {
                const key = model.apiKey();
                usedKeys.add(key);
                return key;
            } catch (error) {
                if (error instanceof MissingModelKeyError && run !== null && run.hostError === null) run.hostError = authError(error);
                throw error;
            }
        },
        // 计数的 fetch：一次运行里实际发出的 HTTP 请求多于助手消息时，中间有被 provider 丢弃的尝试（输出 11）。
        streamFn: (streamModel, context, streamOptions) => {
            const inner = streamOptions?.fetch ?? fetch;
            const counted = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
                run?.meter.request();
                return inner(input, init);
            }) as typeof fetch;
            const watch = createFinishWatch();
            if (run !== null) run.lastFinish = watch;
            const callerObserver = streamOptions?.onSseEvent;
            return baseStream(streamModel, context, {
                ...streamOptions,
                fetch: counted,
                onSseEvent: (event) => {
                    watch.observe(event);
                    callerObserver?.(event);
                },
            });
        },
        transformContext: async (messages) => {
            const pending = messages.flatMap((message) => (message.role === "toolResult" ? [(message as {toolCallId: string}).toolCallId] : []));
            for (;;) {
                const fail = broken ?? run?.hostError ?? null;
                if (fail !== null) {
                    if (run !== null) run.hostError ??= fail;
                    throw new Error(fail.message);
                }
                // 取消之后这次请求本来就会被中止，不必等齐。
                if (run?.cancelled || pending.every((id) => writtenResults.has(id))) break;
                await historyChanged.promise;
            }
            try {
                const rendered = renderContext(profile, {initial, tools: toolIds, history, model: model.model});
                agent.setSystemPrompt(rendered.systemPrompt);
                renderedSystemPrompt = rendered.systemPrompt;
                // 日志里相邻的用户消息（位置提醒与问题）发请求前合并成一条：有的端点拒绝连续的 user（merge-user-messages.ts）。
                return mergeAdjacentUserMessages(rendered.messages);
            } catch (error) {
                if (run !== null) run.hostError = localError(`渲染 Profile 失败：${String(error)}`);
                throw error;
            }
        },
        transformProviderContext: (context) => (renderedSystemPrompt === null ? context : {...context, systemPrompt: renderedSystemPrompt}),
        beforeToolCall: ({assistantMessage, toolCall}) => {
            if (!finishNames.has(toolCall.name)) return undefined;
            const calls = assistantMessage.content.filter((block) => block.type === "toolCall").length;
            return calls > 1 ? {block: true, reason: "收尾工具要单独调用：这一批里还有别的工具调用，请等它们的结果回来后单独再交"} : undefined;
        },
        afterToolCall: ({toolCall, args, isError}) => {
            const tool = finishNames.get(toolCall.name);
            if (tool === undefined || isError || run === null) return undefined;
            run.finishCandidate = {callId: toolCall.id, tool, args};
            agent.abort(TERMINAL_TOOL_RESULT_ABORT_REASON);
            return undefined;
        },
    });
    if (options.thinkingLevel !== undefined) agent.setThinkingLevel(options.thinkingLevel as Effort);

    agent.addBeforeModelCallHook(() => {
        // 取消可能发生在 prompt 刚开始、Agent 还没有可中止的请求时：在进模型之前补一次中止。
        if (run?.cancelled) agent.abort();
    });

    const unsubscribeAgent = agent.subscribe((event) => {
        // provider 的错误正文可能回显收到的密钥：在交给订阅者、写日志、归类错误之前就地遮盖。改的是 Agent 状态里的
        // 同一个对象，之后 classifyProviderError 读到的也是遮盖后的文字（输出 18）。别的事件里的消息快照与消息列表也
        // 一并遮盖：订阅者会把事件推到网络上（nb-story 的网页问答）。
        redactEventMessages(event, usedKeys);
        for (const listener of [...listeners]) listener(event);
        if (event.type !== "message_end") return;
        const message = event.message;
        if (persisted.has(message)) return;
        persisted.add(message);
        const current = run;
        let serialized: JsonValue;
        try {
            serialized = toJson(message);
        } catch (error) {
            // 不能原样写进日志的消息（例如工具 details 里有循环引用）：这次运行以 local 失败、不再请求模型，
            // 不让日志里留下没有结果的工具调用却报成功。
            broken ??= localError(`消息不能写进会话日志：${String(error)}`);
            if (current !== null && current.hostError === null) current.hostError = broken;
            notifyHistory();
            agent.abort();
            return;
        }
        const inputs: SessionEntryInput[] = [{kind: "agent_message", message: serialized}];
        if (message.role === "assistant") {
            inputs.push(usageEntry(message as AssistantMessage, model.priceKnown));
            current?.meter.add(message as AssistantMessage);
        }
        const isFinishResult = message.role === "toolResult" && current?.finishCandidate?.callId === (message as {toolCallId?: string}).toolCallId;
        // 收尾的结束时刻是它的工具结果写进日志的这一刻：在写入链里结算，之前已取消的不算 finished（输出 16）。
        const settleFinish = (): void => {
            if (isFinishResult && current !== null && !current.cancelled && current.finishCandidate !== null) {
                current.finished = {tool: current.finishCandidate.tool, args: current.finishCandidate.args};
            }
        };
        enqueue(current, inputs, settleFinish, [message]).catch((error: unknown) => {
            if (current !== null && current.hostError === null) current.hostError = localError(`写会话日志失败：${String(error)}`);
        });
    });

    const lastAssistant = (fromIndex: number): AssistantMessage | null => {
        const messages = agent.state.messages;
        for (let index = messages.length - 1; index >= fromIndex; index -= 1) {
            const message = messages[index];
            if (message?.role === "assistant") return message as AssistantMessage;
        }
        return null;
    };

    const execute = async (current: Run, input: string): Promise<TurnResult> => {
        const startIndex = agent.state.messages.length;
        const finishRun = async (stopReason: StopReason, error: RunError | null, text: string): Promise<TurnResult> => {
            let reason = stopReason;
            let finalError = error;
            if (reason === "error" || reason === "aborted") {
                try {
                    await enqueue(current, [{kind: "run_end", stopReason: reason, error: finalError === null ? null : toJson(finalError)}]);
                } catch (writeFailure) {
                    // 结束标记没写进去也要让调用方知道：改报 local，原来的原因留在文字里。
                    const before = finalError === null ? reason : `${finalError.kind}：${finalError.message}`;
                    reason = "error";
                    finalError = localError(`写会话日志失败：${String(writeFailure)}（这次运行原本是 ${before}）`);
                }
            }
            if (current.cancelled || reason === "aborted") current.meter.markIncomplete();
            return {stopReason: reason, text, finish: reason === "finished" ? current.finished : null, error: finalError, usage: current.meter.snapshot(), entries: [...current.entries]};
        };

        // 会话已经坏掉（之前有消息写不进日志）：不再请求模型，每次运行都以同一个 local 错误结束。
        if (broken !== null) return finishRun("error", broken, "");
        try {
            model.apiKey();
        } catch (error) {
            if (error instanceof MissingModelKeyError) return finishRun("error", authError(error), "");
            throw error;
        }
        if (current.cancelled) return finishRun("aborted", null, "");

        const userMessage: AgentMessage = {role: "user", content: input, timestamp: Date.now()};
        persisted.add(userMessage);
        try {
            await enqueue(current, [{kind: "agent_message", message: toJson(userMessage)}], undefined, [userMessage]);
        } catch (error) {
            return finishRun("error", localError(`写会话日志失败：${String(error)}`), "");
        }
        if (current.cancelled) return finishRun("aborted", null, "");

        await agent.prompt(userMessage);
        try {
            await drain();
        } catch (error) {
            if (current.hostError === null) current.hostError = localError(`写会话日志失败：${String(error)}`);
        }

        const last = lastAssistant(startIndex);
        const text = last === null ? "" : last.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
        if (current.finished !== null) return finishRun("finished", null, text);
        if (current.hostError !== null) return finishRun("error", current.hostError, text);
        if (current.cancelled) return finishRun("aborted", null, text);
        if (last === null) return finishRun("error", localError("模型没有返回消息"), "");
        switch (last.stopReason) {
            case "stop":
                // 网关送了 `[DONE]` 却没送结束原因：半句话不能当正常结束，按被截断记。
                return finishRun(current.lastFinish?.missing === true ? "length" : "stop", null, text);
            case "toolUse":
                return finishRun("stop", null, text);
            case "length":
                return finishRun("length", null, text);
            case "aborted":
                return finishRun("aborted", null, text);
            case "error":
                return finishRun("error", classifyProviderError(last), text);
        }
    };

    return {
        sessionId,
        tools: [...toolIds],
        turn(input, turnOptions) {
            if (state === "closing" || state === "closed") return Promise.reject(new HarnessError("session_closed", "会话已关闭"));
            if (state === "running") return Promise.reject(new HarnessError("session_busy", "这个会话正在运行"));
            state = "running";
            const current: Run = {meter: new UsageMeter(model.priceKnown), entries: [], cancelled: false, hostError: null, lastFinish: null, finishCandidate: null, finished: null, task: null};
            run = current;
            const signal = turnOptions?.signal;
            const cancel = (): void => {
                current.cancelled = true;
                notifyHistory();
                agent.abort();
            };
            if (signal?.aborted) current.cancelled = true;
            else signal?.addEventListener("abort", cancel, {once: true});
            current.task = execute(current, input).finally(() => {
                signal?.removeEventListener("abort", cancel);
                renderedSystemPrompt = null;
                run = null;
                if (state === "running") state = "idle";
            });
            return current.task;
        },
        subscribe(listener) {
            if (state === "closing" || state === "closed") throw new HarnessError("session_closed", "会话已关闭");
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        close() {
            if (closing !== null) return closing;
            state = "closing";
            closing = (async () => {
                const current = run;
                if (current !== null) {
                    current.cancelled = true;
                    notifyHistory();
                    agent.abort();
                    await current.task?.catch(() => undefined);
                }
                // 释放、退订、终结状态都要做完，哪一步抛错都不能让会话停在“关闭中”；错误收集起来最后一起报。
                const errors: unknown[] = [];
                try {
                    await writes;
                } finally {
                    errors.push(...bridged.releaseAll());
                    bridged.dispose();
                    unsubscribeAgent();
                    listeners.clear();
                    state = "closed";
                }
                if (errors.length > 0) throw new AggregateError(errors, "关闭会话时释放工具资源出错");
            })();
            return closing;
        },
    };
}
