import {Agent, type AgentEvent, type AgentTool, type StreamFn} from "@oh-my-pi/pi-agent-core";
import {streamSimple, type Effort, type Model} from "@oh-my-pi/pi-ai";
import {EditStore} from "@oh-my-pi/pi-natives";
import {renderProfile, type ProfileNode, type ProfileRenderMessage} from "@notnotype/nb-profile";
import type {SessionEntry, SessionEntryInput, SessionLog} from "@notnotype/nb-session";
import {applyBaseUrlOverride, createEnvApiKeyResolver, resolveModel} from "./model.js";
import {createPluginHost, type HarnessPlugin} from "./plugins.js";
import {createEditTool} from "./tools/edit.js";
import {createReadTool} from "./tools/read.js";

export interface HarnessOptions {
    /** `Model` 实例或 `"provider/modelId"`（后者查 OMP 目录）。 */
    readonly model: Model | string;
    readonly cwd: string;
    readonly sessionLog: SessionLog;
    readonly node: ProfileNode;
    readonly plugins?: readonly HarnessPlugin[];
    readonly streamFn?: StreamFn;
    readonly apiKey?: (model: Model) => string | undefined;
    readonly thinkingLevel?: Effort;
    readonly readMaxLines?: number;
    readonly readMaxBytes?: number;
}

export interface HarnessTurnResult {
    readonly text: string;
    readonly entries: readonly SessionEntry[];
}

export interface Harness {
    readonly sessionId: string;
    readonly tools: readonly AgentTool[];
    turn(input: string, options?: {readonly signal?: AbortSignal}): Promise<HarnessTurnResult>;
    subscribe(listener: (event: AgentEvent) => void): () => void;
    use(plugin: HarnessPlugin): void;
    close(): Promise<void>;
}

function partText(part: unknown): string {
    if (typeof part === "object" && part !== null && (part as {type?: string}).type === "text") {
        const text = (part as {text?: unknown}).text;
        return typeof text === "string" ? text : "";
    }
    return "";
}

/** 从 agent 消息里取纯文本（assistant/user 的 text 分片、tool 结果文本）。 */
function messageText(message: unknown): string {
    const content = (message as {content?: unknown} | null | undefined)?.content;
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content.map(partText).join("");
}

function resultText(result: unknown): string {
    const text = messageText(result);
    if (text !== "") return text;
    try {
        return JSON.stringify(result) ?? String(result);
    } catch {
        return String(result);
    }
}

function safeJson(value: unknown): string {
    try {
        return JSON.stringify(value) ?? "";
    } catch {
        return String(value);
    }
}

function toRenderMessage(entry: SessionEntry): ProfileRenderMessage {
    switch (entry.kind) {
        case "message":
            return {role: entry.role === "assistant" ? "assistant" : "user", text: entry.text};
        case "tool_call":
            return {role: "tool", text: entry.argsJson, callId: entry.callId};
        case "tool_result":
            return {role: "tool", text: entry.text, callId: entry.callId};
        default:
            return {role: "user", text: ""};
    }
}

function lastAssistantText(entries: readonly SessionEntry[]): string {
    for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index];
        if (entry.kind === "message" && entry.role === "assistant") return entry.text;
    }
    return "";
}

/** 创建 harness：装配模型、工具、插件与会话日志；返回可用的会话句柄。 */
export async function createHarness(options: HarnessOptions): Promise<Harness> {
    const host = createPluginHost();
    for (const plugin of options.plugins ?? []) {
        host.register(plugin);
    }

    const model = applyBaseUrlOverride(typeof options.model === "string" ? resolveModel(options.model) : options.model);
    const editStore = new EditStore();

    const builtinTools = (): readonly AgentTool[] => [
        createReadTool({
            cwd: options.cwd,
            formats: host.readFormats(),
            store: editStore,
            ...(options.readMaxLines === undefined ? {} : {maxLines: options.readMaxLines}),
            ...(options.readMaxBytes === undefined ? {} : {maxBytes: options.readMaxBytes}),
        }),
        createEditTool({cwd: options.cwd, store: editStore, mode: "hashline"}),
    ];
    const agent = new Agent({
        initialState: {model, systemPrompt: [], tools: [...builtinTools(), ...host.tools()]},
        streamFn: options.streamFn ?? (streamSimple as StreamFn),
        getApiKey: options.apiKey ?? createEnvApiKeyResolver(),
    });
    if (options.thinkingLevel !== undefined) {
        agent.setThinkingLevel(options.thinkingLevel);
    }

    const listeners = new Set<(event: AgentEvent) => void>();
    let writeChain: Promise<void> = Promise.resolve();
    let writeError: unknown = null;

    const enqueue = (inputs: readonly SessionEntryInput[]): void => {
        if (inputs.length === 0) return;
        writeChain = writeChain.then(async () => {
            if (writeError !== null) return;
            try {
                await options.sessionLog.append(inputs);
            } catch (error) {
                writeError = error;
            }
        });
    };

    const drain = async (): Promise<void> => {
        await writeChain;
        if (writeError !== null) throw writeError;
    };

    const unsubscribe = agent.subscribe((event) => {
        for (const listener of [...listeners]) {
            listener(event);
        }
        switch (event.type) {
            case "message_end":
                if ((event.message as {role?: string}).role === "assistant") {
                    enqueue([{kind: "message", role: "assistant", text: messageText(event.message)}]);
                }
                return;
            case "tool_execution_start":
                enqueue([{kind: "tool_call", callId: event.toolCallId, toolName: event.toolName, argsJson: safeJson(event.args)}]);
                return;
            case "tool_execution_end":
                enqueue([{kind: "tool_result", callId: event.toolCallId, isError: event.isError === true, text: resultText(event.result)}]);
                return;
            default:
                return;
        }
    });

    return {
        sessionId: options.sessionLog.sessionId,
        get tools(): readonly AgentTool[] {
            return [...builtinTools(), ...host.tools()];
        },
        async turn(input, turnOptions) {
            const previous = await options.sessionLog.tail();
            const beforeSeq = previous?.seq ?? 0;

            const history = await options.sessionLog.read();
            const rendered = renderProfile(options.node, {messages: history.map(toRenderMessage)});
            agent.setSystemPrompt([...rendered.systemPrompt]);

            await options.sessionLog.append([{kind: "message", role: "user", text: input}]);
            const signal = turnOptions?.signal;
            const abortAgent = (): void => {
                agent.abort(signal?.reason);
            };
            signal?.addEventListener("abort", abortAgent, {once: true});
            try {
                await agent.prompt(input);
            } finally {
                signal?.removeEventListener("abort", abortAgent);
            }
            await drain();

            const entries = await options.sessionLog.read({sinceSeq: beforeSeq});
            return {text: lastAssistantText(entries), entries};
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        use(plugin) {
            host.register(plugin);
            agent.setTools([...builtinTools(), ...host.tools()]);
        },
        async close() {
            unsubscribe();
            listeners.clear();
            agent.abort();
            await writeChain;
        },
    } satisfies Harness;
}
