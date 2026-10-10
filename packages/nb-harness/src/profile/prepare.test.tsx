import {describe, expect, test} from "bun:test";
import {Type} from "typebox";
import {Appending, Assistant, createProfileHost, defineProfile, History, Image, Input, nodeComponent, Prompt, Reminder, System, Tag, User} from "./profile";
import type {Diagnostic, NodeTypeDefinition, ProfileNode, PromptContext} from "./profile";

const context: PromptContext = {session: {id: "s", createdAt: "2026-10-10T00:00:00.000Z"}, turn: 1, now: new Date(0), fields: {}};

async function diagnose(prompt: () => ProfileNode, host = createProfileHost()): Promise<{code: string; diagnostics: string[]}> {
    const result = await host.prepare(defineProfile({id: "p", name: "n", description: "d", version: 1, prompt}), {context});
    if (result.ok) return {code: "ok", diagnostics: result.value === null ? [] : []};
    return {code: result.code, diagnostics: result.diagnostics.map((d: Diagnostic) => `${d.code}@${d.path}`)};
}

describe("准备与校验（输出 2、15）", () => {
    test("场景 3：位置校验——Reminder 放在 Prompt 下、Input 放在 History 里、Image 放在 System 或 Assistant 里、Assistant 作种子、两个 Appending、两个 id 相同的 Reminder", async () => {
        expect(await diagnose(() => <Prompt><Reminder id="r">x</Reminder></Prompt>)).toEqual({code: "invalid-prompt", diagnostics: ["invalid-parent@Prompt>Reminder[0]", "invalid-parent@Prompt>Reminder[0]"]});
        expect((await diagnose(() => <Prompt><History><Input /></History></Prompt>)).diagnostics).toEqual(["invalid-child@Prompt>History[0]"]);
        expect((await diagnose(() => <Prompt><System><Image mimeType="image/png" data="x" /></System></Prompt>)).diagnostics).toEqual(["invalid-parent@Prompt>System[0]>Image[0]", "image-not-allowed@Prompt>System[0]>Image[0]"]);
        expect((await diagnose(() => <Prompt><Assistant><Image mimeType="image/png" data="x" /></Assistant></Prompt>)).diagnostics).toEqual(["invalid-parent@Prompt>Assistant[0]>Image[0]", "image-not-allowed@Prompt>Assistant[0]>Image[0]"]);
        expect((await diagnose(() => <Prompt><History><Assistant>示例</Assistant></History></Prompt>)).diagnostics).toEqual(["invalid-parent@Prompt>History[0]", "invalid-parent@Prompt>History[0]>Assistant[0]"]);
        expect((await diagnose(() => <Prompt><Appending><Input /></Appending><Appending><Input /></Appending></Prompt>)).diagnostics).toEqual(["multiple-appending@Prompt>Appending[1]"]);
        expect((await diagnose(() => <Prompt><Appending><Reminder id="a">1</Reminder><Reminder id="a">2</Reminder></Appending></Prompt>)).diagnostics).toEqual(["duplicate-state-id@Prompt>Appending[0]>Reminder[1]"]);
        expect((await diagnose(() => <Prompt><Appending><Input /><Input /></Appending></Prompt>)).diagnostics).toEqual(["multiple-input@Prompt>Appending[0]"]);
        expect((await diagnose(() => <Prompt><History><User>a</User></History><History><User>b</User></History></Prompt>)).diagnostics).toEqual(["multiple-seeded-history@Prompt>History[1]"]);
        expect((await diagnose(() => <Prompt><System><Tag name="Bad Name">x</Tag></System></Prompt>)).diagnostics).toEqual(["invalid-props@Prompt>System[0]>Tag[0]"]);
    });

    test("场景 2 的校验部分：History as=\"text\" 放进种子或 Appending 的消息里为 invalid-parent，放在请求消息里合法", async () => {
        expect((await diagnose(() => <Prompt><History><User><History as="text" /></User></History></Prompt>)).diagnostics).toEqual(["invalid-parent@Prompt>History[0]>User[0]>History[0]"]);
        expect((await diagnose(() => <Prompt><Appending><User><History as="text" /></User></Appending></Prompt>)).diagnostics).toEqual(["invalid-parent@Prompt>Appending[0]>User[0]>History[0]"]);
        expect((await diagnose(() => <Prompt><User><History as="text" /></User></Prompt>)).code).toBe("ok");
    });

    test("提示词函数抛错或返回的根不是 Prompt 为 prompt-threw；未注册的节点为 unknown-node", async () => {
        expect(await diagnose(() => {
            throw new Error("坏了");
        })).toEqual({code: "invalid-prompt", diagnostics: ["prompt-threw@Prompt"]});
        expect((await diagnose(() => <User>不是根</User>)).diagnostics).toEqual(["prompt-threw@Prompt"]);
        const Unknown = nodeComponent("plugin.y/unknown");
        expect((await diagnose(() => <Prompt><User><Unknown /></User></Prompt>)).diagnostics).toEqual(["unknown-node@Prompt>User[0]>plugin.y/unknown[0]"]);
    });

    test("输出 15：请求消息出现在第一个 History 之前时给 cache-unfriendly 警告，prepare 仍成功", async () => {
        const host = createProfileHost();
        const profile = defineProfile({id: "p", name: "n", description: "d", version: 1, prompt: () => <Prompt><User>动态</User><History /><Appending><Input /></Appending></Prompt>});
        const prepared = await host.prepare(profile, {context});
        expect(prepared.ok).toBe(true);
        const fine = defineProfile({...profile, prompt: () => <Prompt><History /><User>动态</User></Prompt>});
        const quiet = await host.prepare(fine, {context});
        expect(quiet.ok).toBe(true);
        // 警告随 renderRequest 的 diagnostics 之外单独保存：这里用一次失败的 prepare 看到它与错误并列。
        const mixed = await host.prepare(defineProfile({...profile, prompt: () => <Prompt><User>动态</User><History /><Reminder id="r">x</Reminder></Prompt>}), {context});
        expect(mixed.ok ? null : mixed.diagnostics.map((d) => d.code).sort()).toEqual(["cache-unfriendly", "invalid-parent", "invalid-parent"]);
    });
});

describe("数据源（输出 4）", () => {
    const Clock = nodeComponent("plugin.t/clock");
    const Weather = nodeComponent("plugin.t/weather");
    function hostWithSources(): {host: ReturnType<typeof createProfileHost>; calls: {invocation: number; modelCall: number}} {
        const host = createProfileHost();
        const calls = {invocation: 0, modelCall: 0};
        const content = (id: string, source: string): NodeTypeDefinition => ({id, category: "content", props: Type.Object({}), parents: ["*message", "harness/system"], children: "none", sources: [source], render: (_n, ctx) => String(ctx.sources[source])});
        host.registerNodeType(content("plugin.t/clock", "plugin.t/time"));
        host.registerNodeType(content("plugin.t/weather", "plugin.t/forecast"));
        host.registerSource({id: "plugin.t/time", schema: Type.String(), phase: "invocation", resolve: async () => `t${(calls.invocation += 1)}`});
        host.registerSource({id: "plugin.t/forecast", schema: Type.String(), phase: "model-call", resolve: async () => `f${(calls.modelCall += 1)}`});
        return {host, calls};
    }

    test("场景 13：prepare 各取一次；两次 refresh 后 invocation 仍为 1 次、model-call 为 3 次，refresh 结果中 invocation 数据不变", async () => {
        const {host, calls} = hostWithSources();
        const profile = defineProfile({id: "p", name: "n", description: "d", version: 1, prompt: () => <Prompt><System><Clock /> <Weather /></System></Prompt>});
        const prepared = await host.prepare(profile, {context});
        if (!prepared.ok) throw new Error(prepared.detail);
        expect(calls).toEqual({invocation: 1, modelCall: 1});
        expect(host.renderSystem(prepared.value).systemPrompt).toEqual(["t1 f1"]);
        const once = await host.refresh(prepared.value, {});
        if (!once.ok) throw new Error(once.detail);
        const twice = await host.refresh(once.value, {});
        if (!twice.ok) throw new Error(twice.detail);
        expect(calls).toEqual({invocation: 1, modelCall: 3});
        expect(host.renderSystem(twice.value).systemPrompt).toEqual(["t1 f3"]);
        // 渲染不取数（输出 14）。
        host.renderSystem(twice.value);
        host.renderRequest(twice.value, {history: [], invocationStart: 0});
        expect(calls).toEqual({invocation: 1, modelCall: 3});
        // 没有 model-call 数据源时 refresh 原样返回。
        const onlyClock = await host.prepare(defineProfile({...profile, prompt: () => <Prompt><System><Clock /></System></Prompt>}), {context});
        if (!onlyClock.ok) throw new Error(onlyClock.detail);
        const same = await host.refresh(onlyClock.value, {});
        expect(same.ok && same.value).toBe(onlyClock.value);
    });

    test("场景 5：取数结果不合 schema 为 source-failed；取数抛错也是 source-failed；数据源未注册为 unknown-source；signal 中止为 cancelled", async () => {
        const host = createProfileHost();
        const Bad = nodeComponent("plugin.t/bad");
        host.registerNodeType({id: "plugin.t/bad", category: "content", props: Type.Object({}), parents: ["*message"], children: "none", sources: ["plugin.t/number"], render: () => ""});
        host.registerSource({id: "plugin.t/number", schema: Type.Number(), phase: "invocation", resolve: async () => "不是数字"});
        const profile = defineProfile({id: "p", name: "n", description: "d", version: 1, prompt: () => <Prompt><User><Bad /></User></Prompt>});
        const wrong = await host.prepare(profile, {context});
        expect(wrong.ok ? null : wrong.diagnostics.map((d) => `${d.code}@${d.path}`)).toEqual(["source-failed@plugin.t/number"]);

        const Missing = nodeComponent("plugin.t/missing");
        host.registerNodeType({id: "plugin.t/missing", category: "content", props: Type.Object({}), parents: ["*message"], children: "none", sources: ["plugin.t/nowhere"], render: () => ""});
        const missing = await host.prepare(defineProfile({...profile, prompt: () => <Prompt><User><Missing /></User></Prompt>}), {context});
        expect(missing.ok ? null : missing.diagnostics.map((d) => d.code)).toEqual(["unknown-source"]);

        const Throwing = nodeComponent("plugin.t/throwing");
        host.registerNodeType({id: "plugin.t/throwing", category: "content", props: Type.Object({}), parents: ["*message"], children: "none", sources: ["plugin.t/boom"], render: () => ""});
        host.registerSource({id: "plugin.t/boom", schema: Type.String(), phase: "invocation", resolve: async () => {
            throw new Error("网断了");
        }});
        const threw = await host.prepare(defineProfile({...profile, prompt: () => <Prompt><User><Throwing /></User></Prompt>}), {context});
        expect(threw.ok ? null : threw.diagnostics[0]).toMatchObject({code: "source-failed", path: "plugin.t/boom"});

        const controller = new AbortController();
        controller.abort();
        const cancelled = await host.prepare(profile, {context, signal: controller.signal});
        expect(cancelled.ok ? null : cancelled.code).toBe("cancelled");
    });
});
