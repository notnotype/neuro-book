/**
 * 运行时测试的装配：真实的 config、profile、models（真实 SQLite 凭据库）、tools、compaction、session（内存或 JSONL），
 * 只有模型的流经 OMP 的 `streamFn` 脚本化（与 tools 模块的 scripted-agent 同一做法）。不联网、不花钱。
 */

import {mkdir, rm} from "node:fs/promises";
import {join} from "node:path";
import type {StreamFn} from "@oh-my-pi/pi-agent-core";
import {createAssistantMessageEventStream} from "@oh-my-pi/pi-ai";
import type {AssistantMessage, Context, ToolCall, Usage} from "@oh-my-pi/pi-ai";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import Type from "typebox";
import {createCompactionRegistry} from "../../compaction/compaction";
import type {CompactionRegistry} from "../../compaction/compaction";
import {createConfigStore} from "../../config/config";
import {createModelCatalog, openCredentials} from "../../models/models";
import {Appending, createProfileCatalog, createProfileHost, defineProfile, Developer, History, Input, Prompt, Reminder, System, User} from "../../profile/profile";
import type {JsonValue, Profile} from "../../profile/profile";
import {createJsonlSessionStore} from "../../session/jsonl/jsonl";
import {createMemoryArtifactStore, createMemorySessionStore} from "../../session/session";
import type {SessionStore} from "../../session/session";
import {createStaticToolSource, defineTool} from "../../tools/tools";
import type {ToolDefinition, ToolSource} from "../../tools/tools";
import {createRuntime} from "../runtime";
import type {ResolvedDeps, Runtime, RuntimeEvent} from "../runtime";

export type Reply = ({text: string} | {calls: {id: string; name: string; args: Record<string, unknown>}[]} | {error: string}) & {usage?: Partial<Usage>};

const ZERO_USAGE: Usage = {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}};

/** 每次模型请求按顺序取一条脚本；脚本用完后回“done”。记录每次请求的上下文。 */
export function scriptedStream(script: Reply[]): {stream: StreamFn; contexts: Context[]} {
    const queue = [...script];
    const contexts: Context[] = [];
    const stream: StreamFn = (model, context) => {
        contexts.push(context);
        const reply = queue.shift() ?? {text: "done"};
        const usage = {...ZERO_USAGE, ...reply.usage};
        const base = {role: "assistant" as const, api: model.api, provider: model.provider, model: model.id, usage, timestamp: contexts.length};
        const out = createAssistantMessageEventStream();
        if ("error" in reply) {
            const message: AssistantMessage = {...base, content: [], stopReason: "error", errorMessage: reply.error};
            out.push({type: "error", reason: "error", error: message});
            out.end(message);
            return out;
        }
        const content: AssistantMessage["content"] = "text" in reply
            ? [{type: "text", text: reply.text}]
            : reply.calls.map((call): ToolCall => ({type: "toolCall", id: call.id, name: call.name, arguments: call.args}));
        const reason: "stop" | "toolUse" = "text" in reply ? "stop" : "toolUse";
        const message: AssistantMessage = {...base, content, stopReason: reason};
        out.push({type: "start", partial: {...base, content: [], stopReason: reason}});
        if ("text" in reply) {
            // 文字回复按一个增量流出，让 OMP 发 message_update（运行时据此发 stream 事件）
            out.push({type: "text_start", contentIndex: 0, partial: {...base, content: [{type: "text", text: ""}], stopReason: reason}});
            out.push({type: "text_delta", contentIndex: 0, delta: reply.text, partial: message});
            out.push({type: "text_end", contentIndex: 0, content: reply.text, partial: message});
        }
        out.push({type: "done", reason, message});
        out.end(message);
        return out;
    };
    return {stream, contexts};
}

export const echoTool = (): ToolDefinition => defineTool({
    id: "echo", description: "回显", parameters: Type.Object({text: Type.String()}), risk: "read",
    execute: async (args) => ({ok: true, content: `回显：${(args as {text: string}).text}`}),
});
export const noteTool = (): ToolDefinition => defineTool({
    id: "note", description: "记笔记", parameters: Type.Object({text: Type.String()}), risk: "write",
    execute: async (args) => ({ok: true, content: `记下了：${(args as {text: string}).text}`}),
});
export const shellTool = (executed: string[] = []): ToolDefinition => defineTool({
    id: "shell", description: "执行命令", parameters: Type.Object({cmd: Type.String()}), risk: "exec",
    execute: async (args) => {
        executed.push((args as {cmd: string}).cmd);
        return {ok: true, content: `执行了：${(args as {cmd: string}).cmd}`};
    },
});
/** 执行到信号中止才结束。 */
export const waitingTool = (): ToolDefinition => defineTool({
    id: "wait", description: "等到中止", parameters: Type.Object({}), risk: "read",
    execute: (_args, ctx) => new Promise((resolve) => {
        if (ctx.signal.aborted) resolve({ok: false, code: "aborted", message: "已中止"});
        else ctx.signal.addEventListener("abort", () => resolve({ok: false, code: "aborted", message: "已中止"}), {once: true});
    }),
});

export function testProfile(fields: Record<string, JsonValue>, extra: Partial<Pick<Profile, "id">> = {}): Profile {
    return defineProfile({
        id: extra.id ?? "writer", name: "写作助手", description: "测试用", version: 1, fields,
        prompt: () => (
            <Prompt>
                <System>你是写作助手。</System>
                <History>
                    <User once>任务开始</User>
                    <Developer>规则：保持第三人称</Developer>
                </History>
                <Appending>
                    <Input />
                    <Reminder id="style" every={2}>保持第三人称</Reminder>
                </Appending>
            </Prompt>
        ),
    });
}

export type HarnessOptions = {
    script?: Reply[];
    judge?: Reply[];
    tools?: ToolDefinition[];
    sources?: ToolSource[];
    fields?: Record<string, JsonValue>;
    approvalMode?: "always-ask" | "write" | "auto" | "yolo";
    approvalTools?: Record<string, "allow" | "deny" | "ask">;
    approvalRole?: boolean;
    supportsTools?: boolean;
    withKey?: boolean;
    store?: SessionStore | "jsonl";
    compaction?: CompactionRegistry;
    maxTurns?: number;
    profiles?: Profile[];
};

export type Harness = {
    runtime: Runtime;
    deps: ResolvedDeps;
    contexts: Context[];
    judgeContexts: Context[];
    root: string;
    store: SessionStore;
    events: RuntimeEvent[];
    cleanup(): Promise<void>;
};

export async function createHarness(options: HarnessOptions = {}): Promise<Harness> {
    const root = await createTestTmpRoot("nb-harness-runtime", "runtime");
    const config = createConfigStore({
        providers: [{id: "test", api: "openai-completions", baseUrl: "http://127.0.0.1:1", models: [{id: "m", contextWindow: 100_000, maxTokens: 4_000, supportsTools: options.supportsTools ?? true}]}],
        models: {defaultModel: "test/m"},
        roles: {items: options.approvalRole === true ? [{id: "approval", axis: "specialist", name: "审批", description: "", modelKey: "test/m"}] : []},
        approval: {...(options.approvalMode === undefined ? {} : {mode: options.approvalMode}), tools: options.approvalTools ?? {}},
    });
    if (!config.ok) throw new Error(JSON.stringify(config.problems));
    const credentials = await openCredentials({sqlitePath: join(root, "auth.sqlite")});
    if (!credentials.ok) throw new Error(credentials.detail);
    if (options.withKey !== false) await credentials.value.setApiKey("test", "k");
    const tools = options.tools ?? [echoTool(), noteTool(), shellTool()];
    const fields: Record<string, JsonValue> = {"harness/tools": tools.map((tool) => tool.id), ...options.fields};
    const profiles = options.profiles ?? [testProfile(fields)];
    const catalog = createProfileCatalog([{source: "test", profiles}]);
    const {stream, contexts} = scriptedStream(options.script ?? []);
    const judge = scriptedStream(options.judge ?? []);
    if (options.store === "jsonl") await mkdir(join(root, "sessions"), {recursive: true});
    const store = options.store === "jsonl" ? createJsonlSessionStore({root: join(root, "sessions")}) : options.store ?? createMemorySessionStore();
    const deps: ResolvedDeps = {
        config: config.value, profiles: catalog, host: createProfileHost(), models: createModelCatalog({config: config.value.current}), credentials: credentials.value,
        tools: options.sources ?? [createStaticToolSource(tools)], compaction: options.compaction ?? createCompactionRegistry(), store, artifacts: createMemoryArtifactStore(),
        ...(options.maxTurns === undefined ? {} : {limits: {maxTurns: options.maxTurns}}),
        model: {stream}, judge: {stream: judge.stream, timeoutMs: 1_000},
    };
    const events: RuntimeEvent[] = [];
    return {
        runtime: createRuntime(deps), deps, contexts, judgeContexts: judge.contexts, root, store, events,
        cleanup: async () => {
            credentials.value.close();
            await rm(root, {recursive: true, force: true});
        },
    };
}

/** 条目的简写：类型加自定义类型或角色，便于断言写入顺序。 */
export const kinds = (entries: readonly {type: string; customType?: string; message?: {role: string}}[]): string[] =>
    entries.map((entry) => (entry.type === "message" ? `message:${entry.message!.role}` : entry.customType === undefined ? entry.type : `${entry.type}:${entry.customType}`));

export function invocationPhases(entries: readonly {type: string; customType?: string; data?: unknown}[]): string[] {
    return entries.filter((entry) => entry.type === "custom" && entry.customType === "harness/invocation").map((entry) => (entry.data as {phase: string}).phase);
}
