/**
 * 推理能力与档位在线上的样子：真实的 OMP 目录与真实的 OMP 服务商实现，请求发往本机的 OpenAI 兼容端点，断言实收的请求体
 * （docs/specs/models/service.md“角色的思考档”）。密钥是假的。
 */

import {afterAll, describe, expect, test} from "bun:test";
import {getBundledModel, type Model} from "@oh-my-pi/pi-catalog";
import {requestEffort} from "../api/reasoning.js";
import type {ModelRequest} from "../api/index.js";
import {ompCall, ompModelInfo} from "./omp.js";
import {reasoningOf} from "./reasoning.js";

const bodies: Record<string, unknown>[] = [];
const event = (type: string, data: Record<string, unknown>) => `event: ${type}\ndata: ${JSON.stringify({type, ...data})}\n\n`;
const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
        const body = JSON.parse(await request.text()) as Record<string, unknown>;
        bodies.push(body);
        const {pathname} = new URL(request.url);
        let sse: string;
        if (pathname.endsWith("/messages")) {
            sse = event("message_start", {message: {id: "m", type: "message", role: "assistant", content: [], model: body.model, stop_reason: null, stop_sequence: null, usage: {input_tokens: 1, output_tokens: 0}}})
                + event("content_block_start", {index: 0, content_block: {type: "text", text: ""}})
                + event("content_block_delta", {index: 0, delta: {type: "text_delta", text: "好"}})
                + event("content_block_stop", {index: 0})
                + event("message_delta", {delta: {stop_reason: "end_turn", stop_sequence: null}, usage: {output_tokens: 1}})
                + event("message_stop", {});
        } else if (pathname.includes(":streamGenerateContent")) {
            sse = `data: ${JSON.stringify({candidates: [{content: {role: "model", parts: [{text: "好"}]}, finishReason: "STOP"}], usageMetadata: {promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2}})}\n\n`;
        } else {
            const chunk = (part: object) => `data: ${JSON.stringify({id: "c", object: "chat.completion.chunk", created: 0, model: "m", ...part})}\n\n`;
            sse = chunk({choices: [{index: 0, delta: {role: "assistant", content: "好"}, finish_reason: null}]})
                + chunk({choices: [{index: 0, delta: {}, finish_reason: "stop"}]})
                + chunk({choices: [], usage: {prompt_tokens: 1, completion_tokens: 1, total_tokens: 2}})
                + "data: [DONE]\n\n";
        }
        return new Response(sse, {headers: {"content-type": "text/event-stream"}});
    },
});
afterAll(() => server.stop(true));

/** 目录里的真实模型，只把地址换成本机端点。 */
function local(provider: string, id: string): Model {
    const model = getBundledModel(provider as never, id as never) as Model | undefined;
    if (model === undefined) throw new Error(`the bundled catalog has no ${provider}/${id}; pick another model of the same class`);
    const origin = `http://127.0.0.1:${server.port}`;
    return {...model, baseUrl: model.api === "anthropic-messages" || model.api.startsWith("google-") ? origin : `${origin}/v1`};
}

/** 会话选了 `session` 时，这个模型线上实际发出的推理相关字段（不含与推理无关的）。 */
async function wire(model: Model, session: string | null): Promise<Record<string, unknown>> {
    const info = ompModelInfo(model);
    const reasoning = requestEffort(session, {info});
    const request: ModelRequest = {
        purpose: "turn",
        model: info.id,
        ...(reasoning.effort === undefined ? {} : {effort: reasoning.effort}),
        params: reasoning.disableReasoning === true ? {disableReasoning: true} : {},
        headers: {},
        system: [],
        messages: [{role: "user", content: [{kind: "text", text: "你好", origin: {kind: "fixed", by: "kernel"}}]}],
        tools: [],
    };
    bodies.length = 0;
    const response = await ompCall({model, apiKey: async () => "sk-test-not-a-real-key-123456", priceKnown: false})(request, new AbortController().signal, () => undefined);
    expect(response.stopReason).toBe("stop");
    const sent = bodies[0] as {reasoning_effort?: unknown; enable_thinking?: unknown; thinking?: unknown; output_config?: unknown; generationConfig?: {thinkingConfig?: unknown}};
    const {reasoning_effort, enable_thinking} = sent;
    // 只带每个协议里和推理有关的字段；OpenAI 兼容的测试只看前两个，别的协议的字段只在断言它们的测试里读（`wireOf`）。
    return {...(reasoning_effort === undefined ? {} : {reasoning_effort}), ...(enable_thinking === undefined ? {} : {enable_thinking})};
}

/** 同 `wire`，但交回 Anthropic 与 Gemini 协议里和推理有关的请求体字段。 */
async function wireOf(model: Model, session: string | null): Promise<Record<string, unknown>> {
    await wire(model, session);
    const sent = bodies[0] as {thinking?: unknown; output_config?: unknown; generationConfig?: {thinkingConfig?: unknown}};
    return {...(sent.thinking === undefined ? {} : {thinking: sent.thinking}), ...(sent.output_config === undefined ? {} : {output_config: sent.output_config}), ...(sent.generationConfig?.thinkingConfig === undefined ? {} : {google: sent.generationConfig.thinkingConfig})};
}

describe("reasoningOf：真实目录里各类模型", () => {
    test("不推理、会推理但不能调档、可调档的模型各是什么", () => {
        expect(reasoningOf(local("aimlapi", "Qwen/Qwen2.5-7B-Instruct-Turbo"))).toEqual({kind: "none"});
        expect(reasoningOf(local("cline-pass", "cline-free/minimax-m3.1-flash"))).toEqual({kind: "fixed"});
        expect(reasoningOf(local("aiand", "qwen/qwen3.6-27b"))).toMatchObject({kind: "levels", off: "disable", unset: "off", verified: true});
    });

    test("只能降到最低档的模型不叫“可关闭”，强制思考的模型不能关", () => {
        expect(reasoningOf(local("aiand", "deepseek-ai/deepseek-v4-flash"))).toMatchObject({kind: "levels", off: "lowest"});
        expect(reasoningOf(local("aiand", "moonshotai/kimi-k3"))).toMatchObject({kind: "levels", off: "none", unset: "low"});
    });

    test("Anthropic、Gemini 与 OpenAI 兼容路由里不能真关的模型", () => {
        expect(reasoningOf(local("anthropic", "claude-haiku-4-5"))).toMatchObject({kind: "levels", off: "disable", unset: "off"});
        expect(reasoningOf(local("anthropic", "claude-sonnet-4-6"))).toMatchObject({kind: "levels", off: "lowest", unset: null});
        expect(reasoningOf(local("anthropic", "claude-sonnet-5-5"))).toMatchObject({kind: "levels", off: "lowest", unset: null});
        expect(reasoningOf(local("google", "gemini-2.5-flash"))).toMatchObject({kind: "levels", off: "disable", unset: "off"});
        expect(reasoningOf(local("google", "gemini-3.5-flash"))).toMatchObject({kind: "levels", off: "none", unset: "minimal"});
        expect(reasoningOf(local("moonshot", "kimi-k2.7-code"))).toMatchObject({kind: "levels", off: "lowest", unset: null});
        expect(reasoningOf(local("github-copilot", "grok-code-fast-1"))).toEqual({kind: "fixed"});
    });

    test("目录给的是未验证的梯级时标 verified: false", () => {
        const model = local("aiand", "qwen/qwen3.6-27b");
        const unverified = {...model, thinking: {...model.thinking!, unverified: true}} as Model;
        expect(reasoningOf(unverified)).toMatchObject({kind: "levels", verified: false});
    });
});

describe("档位在线上的样子（本机端点实收）", () => {
    test("可关闭：选关闭发关闭开关，选档发档，不选时协议本身就是关的", async () => {
        const model = local("aiand", "qwen/qwen3.6-27b");
        expect(await wire(model, "off")).toEqual({enable_thinking: false});
        expect(await wire(model, "high")).toEqual({enable_thinking: true});
        expect(await wire(model, null)).toEqual({enable_thinking: false});
    });

    test("只能降档：选关闭发的是最低一档，不是关闭", async () => {
        const model = local("aiand", "deepseek-ai/deepseek-v4-flash");
        expect(await wire(model, "off")).toEqual({reasoning_effort: "low"});
        expect(await wire(model, "max")).toEqual({reasoning_effort: "max"});
        expect(await wire(model, "xhigh")).toEqual({reasoning_effort: "high"});
    });

    test("强制思考：不选和选关闭都垫到最低档，选的档照发", async () => {
        const model = local("aiand", "moonshotai/kimi-k3");
        expect(await wire(model, null)).toEqual({reasoning_effort: "low"});
        expect(await wire(model, "off")).toEqual({reasoning_effort: "low"});
        expect(await wire(model, "high")).toEqual({reasoning_effort: "high"});
    });

    test("不能调档与不推理：选什么都不发推理字段", async () => {
        for (const session of [null, "high", "off"]) {
            expect(await wire(local("cline-pass", "cline-free/minimax-m3.1-flash"), session)).toEqual({});
            expect(await wire(local("aimlapi", "Qwen/Qwen2.5-7B-Instruct-Turbo"), session)).toEqual({});
        }
    });
});

describe("Anthropic 与 Gemini 与不发推理参数的路由（本机端点实收）", () => {
    test("Anthropic 能真关的模型：不选与选关闭都发 disabled，选档发预算", async () => {
        const model = local("anthropic", "claude-haiku-4-5");
        expect(await wireOf(model, null)).toEqual({thinking: {type: "disabled"}});
        expect(await wireOf(model, "off")).toEqual({thinking: {type: "disabled"}});
        expect(await wireOf(model, "high")).toMatchObject({thinking: {type: "enabled"}});
    });

    test("Anthropic 的自适应模型：关闭只是最低档，不是 disabled", async () => {
        const adaptive = local("anthropic", "claude-sonnet-4-6");
        // 不选时 OMP 只发最低档的 effort（不带 thinking 字段）；选“关闭”落到最低一档，是自适应思考加最低档，不发 disabled。
        expect(await wireOf(adaptive, null)).toEqual({output_config: {effort: "low"}});
        expect(await wireOf(adaptive, "off")).toMatchObject({thinking: {type: "adaptive"}, output_config: {effort: "low"}});
        expect(await wireOf(adaptive, "high")).toMatchObject({thinking: {type: "adaptive"}, output_config: {effort: "high"}});
        expect(await wireOf(local("anthropic", "claude-sonnet-5-5"), null)).toEqual({thinking: {type: "between_tools"}});
        expect(await wireOf(local("anthropic", "claude-sonnet-5-5"), "off")).toMatchObject({thinking: {type: "adaptive"}});
    });

    test("Gemini：能真关的模型发预算 0；强制思考的模型不选也发最低级别", async () => {
        const budget = local("google", "gemini-2.5-flash");
        expect(await wireOf(budget, null)).toEqual({google: {includeThoughts: false, thinkingBudget: 0}});
        expect(await wireOf(budget, "off")).toEqual({google: {includeThoughts: false, thinkingBudget: 0}});
        expect(await wireOf(local("google", "gemini-3.5-flash"), null)).toEqual({google: {includeThoughts: true, thinkingLevel: "MINIMAL"}});
    });

    test("路由不发推理参数时，选什么都一样，能力也不是可调档", async () => {
        const model = local("github-copilot", "grok-code-fast-1");
        expect(reasoningOf(model)).toEqual({kind: "fixed"});
        for (const session of [null, "off", "high"]) expect(await wire(model, session)).toEqual({});
    });

    test("关闭策略是 omit 的路由：选关闭发最低档，不是什么都不发", async () => {
        const model = local("moonshot", "kimi-k2.7-code");
        expect(await wire(model, null)).toEqual({});
        expect(await wire(model, "off")).toMatchObject({reasoning_effort: expect.any(String)});
    });
});
