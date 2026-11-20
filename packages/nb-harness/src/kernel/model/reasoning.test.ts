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
const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
        bodies.push(JSON.parse(await request.text()) as Record<string, unknown>);
        const chunk = (body: object) => `data: ${JSON.stringify({id: "c", object: "chat.completion.chunk", created: 0, model: "m", ...body})}\n\n`;
        const sse = chunk({choices: [{index: 0, delta: {role: "assistant", content: "好"}, finish_reason: null}]})
            + chunk({choices: [{index: 0, delta: {}, finish_reason: "stop"}]})
            + chunk({choices: [], usage: {prompt_tokens: 1, completion_tokens: 1, total_tokens: 2}})
            + "data: [DONE]\n\n";
        return new Response(sse, {headers: {"content-type": "text/event-stream"}});
    },
});
afterAll(() => server.stop(true));

/** 目录里的真实模型，只把地址换成本机端点。 */
function local(provider: string, id: string): Model {
    const model = getBundledModel(provider as never, id as never) as Model | undefined;
    if (model === undefined) throw new Error(`the bundled catalog has no ${provider}/${id}; pick another model of the same class`);
    return {...model, baseUrl: `http://127.0.0.1:${server.port}/v1`};
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
    const {reasoning_effort, enable_thinking} = bodies[0] as {reasoning_effort?: unknown; enable_thinking?: unknown};
    return {...(reasoning_effort === undefined ? {} : {reasoning_effort}), ...(enable_thinking === undefined ? {} : {enable_thinking})};
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
