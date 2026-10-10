import {describe, expect, test} from "bun:test";
import {getBundledModels, getBundledProviders} from "@oh-my-pi/pi-catalog";
import {validateHarnessConfig} from "../config/config";
import type {HarnessConfig} from "../config/config";
import {createModelCatalog} from "./models";

const bundledProvider = getBundledProviders()[0]!;
const bundledModel = getBundledModels(bundledProvider)[0]!;
const bundledRef = `${bundledModel.provider}/${bundledModel.id}`;

function config(input: unknown): HarnessConfig {
    const result = validateHarnessConfig(input);
    if (!result.ok) throw new Error(JSON.stringify(result.problems));
    return result.value;
}

const base = () => ({
    providers: [{
        id: bundledModel.provider, api: "openai-completions", baseUrl: "http://127.0.0.1:9/v1",
        models: [{id: bundledModel.id, name: "覆盖目录里的同名模型", contextWindow: 1234, input: ["text", "image"]}, {id: "extra", supportsTools: false}],
    }],
    models: {defaultModel: "local/qwen"},
    roles: {items: [
        {id: "main", axis: "gradient", name: "主", description: "", modelKey: `${bundledModel.provider}/extra`},
        {id: "fast", axis: "gradient", name: "快", description: "", modelKey: null},
    ]},
});

describe("目录与解析（输出 1、2）", () => {
    test("场景 1：配置覆盖 OMP 目录里的同名模型，list 只列配置的那条；目录里别的模型照常解析为 bundled", () => {
        const catalog = createModelCatalog({config: config(base())});
        const listed = catalog.list();
        const same = listed.filter((summary) => summary.ref === bundledRef);
        expect(same).toHaveLength(1);
        expect(same[0]).toMatchObject({source: "config", name: "覆盖目录里的同名模型", contextWindow: 1234, input: ["text", "image"]});
        expect(listed.filter((summary) => summary.source === "bundled").length).toBeGreaterThan(10);

        const resolved = catalog.resolve(bundledRef);
        expect(resolved.ok && resolved.value.baseUrl).toBe("http://127.0.0.1:9/v1");
        const other = getBundledModels(bundledProvider).find((model) => model.id !== bundledModel.id)!;
        const fromBundled = catalog.resolve(`${other.provider}/${other.id}`);
        expect(fromBundled.ok && fromBundled.value.baseUrl).toBe(other.baseUrl);
        expect(listed.find((summary) => summary.ref === `${other.provider}/${other.id}`)?.source).toBe("bundled");

        const extra = catalog.resolve(`${bundledModel.provider}/extra`);
        expect(extra.ok && extra.value).toMatchObject({supportsTools: false, input: ["text"], reasoning: false, contextWindow: null, maxTokens: null});
    });

    test("输出 2 的失败码：语法不对、服务不存在、模型不存在", () => {
        const catalog = createModelCatalog({config: config(base())});
        const code = (ref: string): string | null => {
            const result = catalog.resolve(ref);
            return result.ok ? null : result.code;
        };
        expect(code("no-slash")).toBe("invalid-model-ref");
        expect(code("a/b/c")).toBe("invalid-model-ref");
        expect(code("nowhere/model")).toBe("unknown-provider");
        expect(code(`${bundledModel.provider}/does-not-exist`)).toBe("unknown-model");
        expect(code("local/qwen")).toBe("unknown-provider");
    });
});

describe("选择链与能力（输出 3、4）", () => {
    const catalog = createModelCatalog({config: config({...base(), models: {defaultModel: `${bundledModel.provider}/extra`}})});
    const via = (request: Parameters<typeof catalog.select>[0]): string => {
        const result = catalog.select(request);
        return result.ok ? `${result.value.via}:${result.value.model.id}${result.value.role === undefined ? "" : `@${result.value.role}`}` : result.code;
    };

    test("场景 2：显式模型优先；角色未绑定不回落；Profile 的模型、缺省角色、全局缺省依次；全部没有为 no-default-model", () => {
        expect(via({model: bundledRef, role: "main", profile: {id: "p", model: `${bundledModel.provider}/extra`}})).toBe(`explicit:${bundledModel.id}`);
        expect(via({role: "main", profile: {id: "p", model: bundledRef}})).toBe("role:extra@main");
        expect(via({role: "fast", profile: {id: "p", model: bundledRef}})).toBe("role-not-bound");
        expect(via({role: "nope"})).toBe("unknown-role");
        expect(via({profile: {id: "p", model: bundledRef, defaultRole: "main"}})).toBe(`profile-model:${bundledModel.id}`);
        expect(via({profile: {id: "p", defaultRole: "main"}})).toBe("profile-role:extra@main");
        expect(via({profile: {id: "p", defaultRole: "fast"}})).toBe("role-not-bound");
        expect(via({profile: {id: "p"}})).toBe("default:extra");
        expect(via({model: "bad ref"})).toBe("invalid-model-ref");
        const noDefault = createModelCatalog({config: config({...base(), models: {}})});
        const none = noDefault.select({profile: {id: "p"}});
        expect(none.ok ? null : none.code).toBe("no-default-model");
    });

    test("输出 4：工具与图片能力各一条问题；未声明 supportsTools 按支持", () => {
        const noTools = catalog.resolve(`${bundledModel.provider}/extra`);
        const withImage = catalog.resolve(bundledRef);
        if (!noTools.ok || !withImage.ok) throw new Error("应能解析");
        expect(catalog.checkCapabilities(noTools.value, {tools: true, images: true}).map((p) => p.capability)).toEqual(["tools", "images"]);
        expect(catalog.checkCapabilities(withImage.value, {tools: true, images: true})).toEqual([]);
        expect(catalog.checkCapabilities(noTools.value, {})).toEqual([]);
    });
});
