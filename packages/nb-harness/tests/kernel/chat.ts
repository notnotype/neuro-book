/**
 * 终端演示：会话目录上的 JSONL 存储加真实的 OMP 适配器。每行输入发一条消息，回复边生成边打出；
 * 输入 `/reopen` 关掉会话再从同一份日志打开，接着聊；`/quit` 退出。
 *
 * 用法（凭据按 neuro-book-test-support 的 llmTestConfig 取，例如 DEEPSEEK_API_KEY）：
 *   bun tests/kernel/chat.ts <会话根目录> [会话 id]
 */

import {createInterface} from "node:readline/promises";
import {defineModel, resolveModel} from "@notnotype/nb-harness";
import {closeSession, createJsonlStore, createSession, defineProfile, ompCall, ompModelInfo, openSession, systemClock, type SessionApi, type SessionEnv} from "@notnotype/nb-harness/kernel";
import {llmTestConfig} from "@notnotype/neuro-book-test-support/llm";

const [root, id = "chat"] = process.argv.slice(2);
if (root === undefined) {
    console.error("usage: bun tests/kernel/chat.ts <session root> [session id]");
    process.exit(2);
}
// 运行这个脚本本身就是“要调用模型”的意图，所以替它打开真实模型的开关（密钥要进进程环境，模型从那里读）。
process.env.NBOOK_LLM_TESTS = "1";
const config = llmTestConfig();
if (config === null) {
    console.error("no model credentials (DEEPSEEK_API_KEY in the environment or the repository .env)");
    process.exit(2);
}
const base = resolveModel(config.model).model;
const target = defineModel({provider: base.provider, api: base.api, baseUrl: config.baseUrl ?? base.baseUrl, id: base.id, apiKeyEnv: config.apiKeyEnv, reasoning: base.reasoning, input: base.input, contextWindow: base.contextWindow, maxTokens: base.maxTokens});
const profile = defineProfile({id: "demo.chat", version: "1", name: "演示", description: "终端演示", system: "你是简洁的中文助手。"});
const call = ompCall({model: target.model, apiKey: target.apiKey, priceKnown: false});
const env: SessionEnv = {
    store: createJsonlStore({root}),
    profiles: {resolve: (key) => (key === profile.id ? profile : undefined)},
    models: {resolve: () => ({ok: true, info: ompModelInfo(target.model), call})},
    tools: {declarations: () => [], create: () => Promise.reject(new Error("no tools"))},
    resources: () => ({read: async () => undefined, resolve: (uri) => uri}),
    sessions: {get: () => Promise.reject(new Error("no sessions"))},
    clock: systemClock,
    approve: async () => ({verdict: "allow", by: "demo"}),
};

async function open(): Promise<SessionApi> {
    const opened = await openSession(env, id);
    if (opened.ok) return opened.value;
    if (opened.code !== "session-not-found") throw new Error(`open failed: ${opened.code}`);
    const created = await createSession(env, {profile: profile.id, id});
    if (!created.ok) throw new Error(`create failed: ${created.code}`);
    return created.value;
}

let session = await open();
const follow = (api: SessionApi) => api.subscribe((frame) => {
    if (frame.type === "delta" && frame.part === "text") process.stdout.write(frame.text);
});
let unsubscribe = follow(session);
console.log(`会话 ${id}（${(await session.snapshot()).head} 条事件）。/reopen 重开，/quit 退出。`);
// 用异步迭代读行：等模型回答时到达的行会排着，管道输入也不丢。
const input = createInterface({input: process.stdin});
let counter = 0;
process.stdout.write("> ");
for await (const raw of input) {
    const line = raw.trim();
    if (line === "/quit") break;
    if (line === "/reopen") {
        unsubscribe();
        await closeSession(session);
        session = await open();
        unsubscribe = follow(session);
        console.log(`已重开（${(await session.snapshot()).head} 条事件）。`);
    } else if (line !== "") {
        const sent = await session.send({commandId: `${Date.now()}-${(counter += 1)}`, input: {text: line}});
        if (!sent.ok || sent.value.runId === null) console.log(`发送失败：${sent.ok ? "already running" : sent.code}`);
        else {
            const result = await session.waitRun(sent.value.runId);
            console.log(result.error === null ? `\n（${result.usage.input}+${result.usage.output} tokens）` : `\n[${result.reason}] ${result.error.kind} ${result.error.message ?? ""}`);
        }
    }
    process.stdout.write("> ");
}
input.close();
unsubscribe();
await closeSession(session);
