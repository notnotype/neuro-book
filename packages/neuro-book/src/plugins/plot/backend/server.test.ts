import {describe, expect, test} from "bun:test";

import type {ModelPort, ModelRequest, ModelResponse} from "@notnotype/nb-harness/kernel/contracts";

import {descriptor} from "../plugin";
import {plotModelImplementation} from "./server";

const USAGE = {input: 1, output: 2, cacheRead: 0, cacheWrite: 0, cost: null, complete: true};
const INFO = {id: "p/m", contextWindow: 1000, maxOutput: 500, capabilities: {vision: false, thinking: false}, efforts: []};
const RESPONSE: ModelResponse = {content: [], toolCalls: [{id: "c", tool: "plot.answer", args: {answer: "no", quotes: []}}], stopReason: "tool", usage: USAGE, model: "p/m"};

/** 记下每次解析与请求的端口。 */
function port(result: Partial<ModelResponse> = {}, refuse?: string) {
    const roles: (string | undefined)[] = [];
    const requests: ModelRequest[] = [];
    const value: ModelPort = {resolve: (query) => {
        roles.push(query.role);
        if (refuse !== undefined) return {ok: false, code: refuse as "role-unbound"};
        return {ok: true, info: INFO, call: (request) => {
            requests.push(request);
            return Promise.resolve({...RESPONSE, ...result});
        }};
    }};
    return {value, roles, requests};
}
const ASK = {role: "ledger", system: "系统", user: "问题", answer: "yesNo", maxTokens: 2000} as const;
const context = {signal: new AbortController().signal};
const self = {plugin: descriptor.id};

describe("nbook.plot/model 的提供方", () => {
    test("别的插件调：wrong-caller，不解析、不发请求", async () => {
        const fake = port();
        const other = plotModelImplementation(fake.value, {plugin: "other.plugin"});
        expect(other.methods.available()).toMatchObject({ok: false, code: "wrong-caller"});
        expect(await other.methods.ask(ASK, context)).toMatchObject({ok: false, code: "wrong-caller"});
        expect(fake.roles).toEqual([]);
    });

    test("available 解析两个角色（记账 main、试读 fast），不发请求；有解析失败给那个码；没有模型服务时 no-model", () => {
        const fake = port();
        expect(plotModelImplementation(fake.value, self).methods.available()).toEqual({ok: true, value: {problem: null}});
        expect(fake.roles).toEqual(["main", "fast"]);
        expect(fake.requests).toEqual([]);
        expect(plotModelImplementation(port({}, "role-unbound").value, self).methods.available()).toEqual({ok: true, value: {problem: "role-unbound"}});
        expect(plotModelImplementation(null, self).methods.available()).toEqual({ok: true, value: {problem: "no-model"}});
    });

    test("ask：强制调用 answer 工具，输出上限夹到模型上限；试读用 fast；答案是工具的参数，带用量", async () => {
        const fake = port();
        const impl = plotModelImplementation(fake.value, self);
        expect(await impl.methods.ask(ASK, context)).toEqual({ok: true, value: {outcome: "answer", answer: {answer: "no", quotes: []}, usage: {input: 1, output: 2, cacheRead: 0, cacheWrite: 0, cost: null}}});
        const [request] = fake.requests;
        expect(request).toMatchObject({purpose: "background", model: "p/m", params: {maxTokens: 500}, toolChoice: {tool: "plot.answer"}});
        expect(request!.tools.map((tool) => tool.id)).toEqual(["plot.answer"]);
        expect(request!.tools[0]!.parameters).toMatchObject({type: "object"});
        await impl.methods.ask({...ASK, role: "reader"}, context);
        expect(fake.roles.at(-1)).toBe("fast");
    });

    test("ask 的几种结局：错误只传类别，不传文字；撞上输出上限、取消、没调工具各自区分", async () => {
        const outcome = async (result: Partial<ModelResponse>) => (await plotModelImplementation(port(result).value, self).methods.ask(ASK, context) as {value: unknown}).value;
        const failed = await outcome({stopReason: "error", toolCalls: [], error: {kind: "auth", message: "bad key sk-secret"}}) as Record<string, unknown>;
        expect(failed).toMatchObject({outcome: "failed", kind: "auth"});
        expect(JSON.stringify(failed)).not.toContain("sk-secret");
        expect(await outcome({stopReason: "length"})).toMatchObject({outcome: "length", capped: true});
        expect(await plotModelImplementation(port({stopReason: "length"}).value, self).methods.ask({...ASK, maxTokens: 100}, context)).toMatchObject({value: {outcome: "length", capped: false}});
        expect(await outcome({stopReason: "aborted", toolCalls: []})).toMatchObject({outcome: "aborted"});
        expect(await outcome({stopReason: "stop", toolCalls: []})).toMatchObject({outcome: "answer", answer: null});
        expect(await plotModelImplementation(port({}, "no-credentials").value, self).methods.ask(ASK, context)).toMatchObject({ok: true, value: {outcome: "failed", kind: "no-credentials"}});
    });
});
