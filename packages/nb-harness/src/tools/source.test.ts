import {describe, expect, test} from "bun:test";
import {Type} from "typebox";
import {createStaticToolSource, defineTool, toolDefinitionProblem, visibleTools} from "./tools";
import type {ToolDefinition} from "./tools";

const ok = async () => ({ok: true as const, content: "ok"});
const read = (): ToolDefinition => defineTool({id: "read", description: "读文件", parameters: Type.Object({path: Type.String()}), risk: "read", execute: ok});
const edit = (): ToolDefinition => defineTool({id: "edit", description: "改文件", parameters: Type.Object({path: Type.String()}), risk: (args) => ((args as {path: string}).path.startsWith("/etc") ? {tier: "exec", policy: "deny", reason: "系统文件"} : "write"), execute: ok});
const bash = (): ToolDefinition => defineTool({id: "plugin.x/bash", description: "跑命令", parameters: Type.Object({cmd: Type.String()}), scope: "project", execute: ok});

describe("定义（输出 1）", () => {
    test("场景 1：合法的内置与插件工具通过并被冻结；id、说明、参数、风险各写坏一种，defineTool 抛 TypeError，toolDefinitionProblem 给出同样的说明", () => {
        expect(Object.isFrozen(read())).toBe(true);
        expect(bash().scope).toBe("project");
        const base = {id: "read", description: "d", parameters: Type.Object({}), execute: ok};
        const cases: [unknown, string][] = [
            [{...base, id: "Bad Id"}, "id"],
            [{...base, id: "ns/"}, "id"],
            [{...base, description: ""}, "description"],
            [{...base, parameters: Type.String()}, "parameters"],
            [{...base, risk: "danger"}, "risk"],
            [{...base, risk: {tier: "exec", policy: "maybe"}}, "policy"],
            [{...base, scope: "global"}, "scope"],
            [{...base, execute: "nope"}, "execute"],
        ];
        for (const [definition, keyword] of cases) {
            const problem = toolDefinitionProblem(definition);
            expect(problem).toContain(keyword);
            expect(() => defineTool(definition as ToolDefinition)).toThrow(TypeError);
            expect(() => defineTool(definition as ToolDefinition)).toThrow(problem as string);
        }
    });
});

describe("来源与可见工具（输出 2、3）", () => {
    test("静态来源按顺序列出描述符，函数风险写 dynamic，缺省 exec；id 重复抛 TypeError；get 取实现", () => {
        const source = createStaticToolSource([read(), edit(), bash()]);
        expect(source.list().map((d) => `${d.id}:${d.risk}:${d.scope}`)).toEqual(["read:read:session", "edit:dynamic:session", "plugin.x/bash:exec:project"]);
        expect(source.get("edit")?.description).toBe("改文件");
        expect(source.get("nope")).toBeUndefined();
        expect(() => createStaticToolSource([read(), read()])).toThrow(TypeError);
        expect(() => createStaticToolSource([{...read(), id: "x y"} as ToolDefinition])).toThrow(TypeError);
    });

    test("场景 2：两个来源、Profile 列出四个 id（一个没有来源）：按 Profile 顺序得到三个，没有来源的列在 missing；两个来源各有同名工具时 tool-conflict", () => {
        const a = createStaticToolSource([read(), edit()]);
        const b = createStaticToolSource([bash()]);
        const visible = visibleTools({requested: ["plugin.x/bash", "missing", "read", "edit", "read"], sources: [a, b]});
        expect(visible.ok && visible.value.tools.map((d) => d.id)).toEqual(["plugin.x/bash", "read", "edit"]);
        expect(visible.ok && visible.value.missing).toEqual(["missing"]);
        const conflict = visibleTools({requested: ["read"], sources: [a, createStaticToolSource([read()])]});
        expect(conflict.ok ? null : `${conflict.code}:${conflict.detail}`).toBe("tool-conflict:工具 read 来自两个来源");
        expect(visibleTools({requested: [], sources: [a, b]})).toEqual({ok: true, value: {tools: [], missing: []}});
    });
});
