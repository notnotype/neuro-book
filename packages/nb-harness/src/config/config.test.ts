import {describe, expect, test} from "bun:test";
import {createConfigStore, validateHarnessConfig} from "./config";
import type {HarnessConfig} from "./config";

const full = () => ({
    providers: [
        {id: "local", api: "openai-completions", baseUrl: "http://127.0.0.1:8000/v1", models: [{id: "qwen", name: "Qwen", contextWindow: 32000, maxTokens: 4096, input: ["text"], supportsTools: true}]},
        {id: "deepseek", api: "openai-completions", baseUrl: "https://api.deepseek.com", headers: {"x-a": "1"}, models: [{id: "deepseek-chat"}, {id: "deepseek-reasoner", reasoning: true}]},
    ],
    models: {defaultModel: "deepseek/deepseek-chat"},
    roles: {items: [
        {id: "tiny", axis: "gradient", name: "轻", description: "便宜", modelKey: "local/qwen"},
        {id: "fast", axis: "gradient", name: "快", description: "", modelKey: null},
        {id: "main", axis: "gradient", name: "主", description: "主力", modelKey: "deepseek/deepseek-chat"},
        {id: "approval", axis: "specialist", name: "审批", description: "审批工具调用", modelKey: ""},
    ]},
    profiles: {writer: {model: "deepseek/deepseek-reasoner", settings: {tone: "plain"}}, editor: {}},
    approval: {mode: "write", tools: {bash: "ask", read: "allow"}},
});

function problems(input: unknown): string[] {
    const result = validateHarnessConfig(input);
    return result.ok ? [] : result.problems.map((p) => p.path);
}

describe("校验与规范化（输出 1、2）", () => {
    test("场景 1：完整配置通过，缺省值补齐、空引用按未给出、快照深冻结且输入不变", () => {
        const input = full();
        const snapshot = JSON.stringify(input);
        const result = validateHarnessConfig(input);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const config: HarnessConfig = result.value;
        expect(config.roles.items[3]!.modelKey).toBeNull();
        expect(config.profiles.editor).toEqual({});
        expect(config.approval).toEqual({mode: "write", tools: {bash: "ask", read: "allow"}});
        expect(() => {
            (config.roles.items as unknown[]).push({});
        }).toThrow(TypeError);
        expect(() => {
            (config.providers[0] as {id: string}).id = "x";
        }).toThrow(TypeError);
        expect(JSON.stringify(input)).toBe(snapshot);

        const minimal = validateHarnessConfig({});
        expect(minimal.ok && minimal.value).toEqual({providers: [], models: {}, roles: {items: []}, profiles: {}, approval: {tools: {}}});
    });

    test("场景 1：改坏三处一次得到三条问题，路径各自正确", () => {
        const input = full();
        input.roles.items[1]!.id = "tiny";
        input.providers[0]!.baseUrl = "not a url";
        input.models.defaultModel = "deepseek-chat";
        expect(problems(input).sort()).toEqual(["models.defaultModel", "providers[0].baseUrl", "roles.items[1].id"].sort());
        const result = validateHarnessConfig(input);
        expect(result.ok ? null : result.problems.find((p) => p.path === "roles.items[1].id")?.reason).toContain("tiny");
    });

    test("场景 3：未知字段、重复的服务与模型 id、坏的角色引用、非对象、JSON 不能表示的值各是一条问题", () => {
        expect(problems({...full(), extra: 1})).toEqual(["extra"]);
        expect(problems({providers: [{id: "a", api: "x", baseUrl: "http://a", models: [{id: "m"}, {id: "m"}]}, {id: "a", api: "x", baseUrl: "http://a", models: []}]}).sort()).toEqual([
            "providers[0].models[1].id", "providers[1].id",
        ].sort());
        expect(problems({roles: {items: [{id: "r", axis: "gradient", name: "n", description: "", modelKey: "nope"}]}})).toEqual(["roles.items[0].modelKey"]);
        expect(problems({profiles: {w: {model: "a/b/c"}}})).toEqual(["profiles.w.model"]);
        expect(problems({profiles: {"bad id": {}}}).length).toBeGreaterThan(0);
        expect(problems([])).toEqual([""]);
        expect(problems({models: {defaultModel: undefined}})).toEqual(["models.defaultModel"]);
        expect(problems({approval: {tools: {bash: "maybe"}}})).toEqual(["approval.tools.bash"]);
        const circular: Record<string, unknown> = {};
        circular.self = circular;
        expect(problems({profiles: {w: {settings: circular}}})[0]!.startsWith("profiles.w.settings")).toBe(true);
    });
});

describe("存储（输出 3–6）", () => {
    test("场景 2：坏配置不建存储；替换坏配置 current 不变且不通知；替换好配置通知一次；release 后不再收到；监听函数抛错不影响别人", () => {
        expect(createConfigStore({providers: "nope"}).ok).toBe(false);
        const created = createConfigStore(full());
        if (!created.ok) throw new Error("应能创建");
        const store = created.value;
        const seen: string[] = [];
        const first = store.subscribe((snapshot) => seen.push(`a:${snapshot.models.defaultModel ?? "-"}`));
        store.subscribe(() => {
            throw new Error("监听函数坏了");
        });
        store.subscribe((snapshot) => seen.push(`b:${snapshot.models.defaultModel ?? "-"}`));

        const before = store.current;
        const bad = store.replace({models: {defaultModel: "broken"}});
        expect(bad.ok).toBe(false);
        expect(store.current).toBe(before);
        expect(seen).toEqual([]);

        const good = store.replace({models: {defaultModel: "local/qwen"}});
        expect(good.ok).toBe(true);
        expect(store.current.models.defaultModel).toBe("local/qwen");
        expect(seen).toEqual(["a:local/qwen", "b:local/qwen"]);
        expect(good.ok && good.value).toBe(store.current);

        first.release();
        store.replace({models: {defaultModel: "local/qwen"}});
        expect(seen).toEqual(["a:local/qwen", "b:local/qwen", "b:local/qwen"]);
        expect(() => {
            (store.current as {providers: unknown[]}).providers.push({});
        }).toThrow(TypeError);
    });
});
