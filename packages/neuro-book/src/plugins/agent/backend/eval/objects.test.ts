/**
 * 全局对象（docs/specs/agent/contributions.md 输出 24、25，agent/eval.md 输出 16，agent/resources.md 输出 16）：哪些对象有效、
 * 文档里的签名、eval 按会话的说明。接进真实服务端与内核的路径在示例的场景 10（`plugin-sdk/examples/scenarios/10-eval-object.test.ts`）。
 */

import {describe, expect, test} from "bun:test";

import type {ContributionDeclarations, ContributionDescriptor} from "@notnotype/nb-runtime/plugins";
import type {ToolDeclaration} from "@notnotype/nb-harness/kernel/contracts";

import {EVAL_OBJECTS_POINT, TOOLS_POINT} from "../../shared/points";
import type {AgentEvalObjectDeclaration, AgentToolDeclaration} from "../../shared/points";
import {AgentTools} from "../tools";
import {objectDoc, objectsSection, tsType, validEvalObjects} from "./objects";
import {evalDeclarationFor, KERNEL_NAMES} from "./tool";

/** 已接受的声明：清单里读到的就是这些（平台已按贡献点的 schema 核对过）。 */
function declarations(items: ReadonlyArray<{capability: string; id: string; plugin: string; declaration: unknown}>): ContributionDeclarations {
    const all = items.map((item): ContributionDescriptor => ({...item, entry: null, location: "server"}));
    return {
        get: (capability, id) => (all.find((item) => item.capability === capability && item.id === id) as never) ?? null,
        list: (capability) => all.filter((item) => item.capability === capability) as never,
    };
}
const object = (plugin: string, name: string, extra: Partial<AgentEvalObjectDeclaration> = {}) => ({capability: EVAL_OBJECTS_POINT, id: `${plugin}.${name}`, plugin, declaration: {name, summary: `${name} 的摘要`, ...extra}});

describe("哪些对象有效（contributions.md 输出 25）", () => {
    test("与内核的名字或宿主全局上已有的名字冲突的不登记；两个插件同名的双方都不登记，诊断写明两个来源", () => {
        const reports: Array<{code: string; data?: Readonly<Record<string, unknown>>}> = [];
        const valid = validEvalObjects(declarations([object("acme.a", "browser"), object("acme.b", "browser"), object("acme.c", "tool"), object("acme.d", "Math"), object("acme.e", "page")]), KERNEL_NAMES, (code, _message, data) => reports.push({code, ...(data === undefined ? {} : {data})}));
        expect([...valid.keys()]).toEqual(["page"]);
        expect(reports.map((item) => [item.code, item.data?.name])).toEqual([["eval-object-conflict", "tool"], ["eval-object-conflict", "Math"], ["eval-object-conflict", "browser"]]);
        expect(reports.at(-1)?.data?.plugins).toEqual(["acme.a", "acme.b"]);
    });

    test("contributions.md 输出 24：方法的对象不是同一插件登记的有效对象时，这个工具不进工具表，诊断一次", () => {
        const method = (plugin: string, objectName: string): {capability: string; id: string; plugin: string; declaration: AgentToolDeclaration} => ({capability: TOOLS_POINT, id: `${plugin}.go`, plugin, declaration: {description: "去", parameters: {type: "object"}, version: "1", effect: "read", global: {object: objectName, method: "go"}}});
        const reports: string[] = [];
        const source = declarations([object("acme.a", "page"), method("acme.a", "page"), method("acme.b", "page"), method("acme.c", "nowhere")]);
        const valid = validEvalObjects(source, KERNEL_NAMES, () => undefined);
        const tools = new AgentTools({declarations: source, evalObjectOf: (name) => valid.get(name), clock: {now: () => 0} as never, activate: async () => true, report: (code) => reports.push(code), services: () => ({}) as never, catalogChanged: () => undefined});
        expect([...tools.all().keys()]).toEqual(["acme.a.go"]);
        tools.all();
        expect(reports).toEqual(["eval-object-missing", "eval-object-missing"]);
    });
});

describe("工具目录与会话工具集里的对象（profile-settings.md 输出 28、29）", () => {
    test("目录给有效对象的方法带上对象名、方法名与界面说明；按对象去掉时会话的工具集里没有它的方法", () => {
        const method = (plugin: string, objectName: string, name: string): {capability: string; id: string; plugin: string; declaration: AgentToolDeclaration} => ({capability: TOOLS_POINT, id: `${plugin}.${name}`, plugin, declaration: {description: name, parameters: {type: "object"}, version: "1", effect: "read", global: {object: objectName, method: name}, defaultForAll: true}});
        const source = declarations([object("acme.a", "page", {description: {"zh-CN": "看页面", "en-US": "See the page"}}), object("acme.b", "other"), method("acme.a", "page", "look"), method("acme.a", "page", "point"), method("acme.b", "other", "peek")]);
        const valid = validEvalObjects(source, KERNEL_NAMES, () => undefined);
        const tools = new AgentTools({declarations: source, evalObjectOf: (name) => valid.get(name), clock: {now: () => 0} as never, activate: async () => true, report: () => undefined, services: () => ({}) as never, catalogChanged: () => undefined});
        expect(tools.catalog().map((entry) => [entry.id, entry.object])).toEqual([
            ["acme.a.look", {name: "page", method: "look", description: {"zh-CN": "看页面", "en-US": "See the page"}}],
            ["acme.a.point", {name: "page", method: "point", description: {"zh-CN": "看页面", "en-US": "See the page"}}],
            ["acme.b.peek", {name: "other", method: "peek", description: "other 的摘要"}],
        ]);
        const ids = (binding?: Parameters<AgentTools["forSession"]>[1]) => tools.forSession({required: [], optional: []}, binding, false).map((tool) => tool.id);
        expect(ids()).toEqual(["acme.a.look", "acme.a.point", "acme.b.peek"]);
        expect(ids({added: [], removed: [], objects: {added: [], removed: ["page"]}})).toEqual(["acme.b.peek"]);
    });
});

describe("文档（resources.md 输出 16）", () => {
    test("签名由参数与 returns 生成：对象、数组、可选、枚举、联合、额外属性；认不出的写 unknown", () => {
        expect(tsType({type: "object", properties: {url: {type: "string"}, wait: {enum: ["load", "idle"]}, tags: {type: "array", items: {type: "string"}}, n: {type: "integer"}}, required: ["url"]})).toBe('{url: string; wait?: "load" | "idle"; tags?: string[]; n?: number}');
        expect(tsType({anyOf: [{type: "string"}, {type: "null"}]})).toBe("string | null");
        expect(tsType({type: "object", additionalProperties: {type: "boolean"}})).toBe("{[key: string]: boolean}");
        expect(tsType({type: "array", items: {anyOf: [{type: "string"}, {type: "number"}]}})).toBe("Array<string | number>");
        expect(tsType({not: {}})).toBe("unknown");
    });

    test("eval.md 输出 17：字段带说明或缺省时对象分行写、字段前写说明（注释结束符转义、换行折成空格）；更深一层带说明时外层也分行；都没有的仍是一行", () => {
        const schema = {type: "object", required: ["query"], properties: {
            query: {type: "string", description: "要找的词"},
            limit: {type: "integer", default: 5},
            scope: {type: "object", properties: {kind: {type: "string", description: "哪一类\n设置或命令 */ 都行", default: "all"}}},
            tags: {type: "array", items: {type: "object", properties: {name: {type: "string", description: "标签名"}}}},
            flag: {type: "boolean"},
        }};
        expect(tsType(schema)).toBe([
            "{",
            "    /** 要找的词 */",
            "    query: string;",
            "    /** 缺省 5 */",
            "    limit?: number;",
            "    scope?: {",
            "        /** 哪一类 设置或命令 *\\/ 都行（缺省 \"all\"） */",
            "        kind?: string;",
            "    };",
            "    tags?: Array<{",
            "        /** 标签名 */",
            "        name?: string;",
            "    }>;",
            "    flag?: boolean;",
            "}",
        ].join("\n"));
        expect(tsType({type: "object", properties: {items: {type: "array", items: {type: "object", properties: {b: {type: "string"}}}}}})).toBe("{items?: Array<{b?: string}>}");
    });

    test("文档写一行摘要、插件写的说明、每个方法的签名与说明；没声明 returns 的交回文字", () => {
        const doc = objectDoc({name: "page", plugin: "acme.a", summary: "看页面", docs: "先 snapshot 再操作。"}, [
            {object: "page", method: "snapshot", description: "取页面的快照。", parameters: {type: "object", properties: {}}, returns: {type: "object", properties: {nodes: {type: "array", items: {type: "string"}}}, required: ["nodes"]}},
            {object: "page", method: "click", description: "点一个元素。", parameters: {type: "object", properties: {ref: {type: "string"}}, required: ["ref"]}},
        ]);
        expect(doc).toContain("# page\n\n看页面\n\n先 snapshot 再操作。");
        expect(doc).toContain("click(args: {ref: string}): Promise<string>");
        expect(doc).toContain("snapshot(args: {}): Promise<{nodes: string[]}>");
        // 方法按名字排：click 在 snapshot 前面。
        expect(doc.indexOf("### page.click")).toBeLessThan(doc.indexOf("### page.snapshot"));
    });

    test("输出 17：声明了 errors 的方法，文档按码列出 details 的形状；没声明的不写这一段", () => {
        const doc = objectDoc({name: "page", plugin: "acme.a", summary: "看页面"}, [
            {object: "page", method: "click", description: "点一个元素。", parameters: {type: "object", properties: {}}, errors: {"stale-ref": {type: "object", properties: {ref: {type: "string"}}, required: ["ref"]}, ambiguous: {type: "object", properties: {candidates: {type: "array", items: {type: "string"}}}, required: ["candidates"]}}},
            {object: "page", method: "snapshot", description: "取页面的快照。", parameters: {type: "object", properties: {}}},
        ]);
        const click = doc.slice(doc.indexOf("### page.click"), doc.indexOf("### page.snapshot"));
        expect(click).toContain("```ts\n\"ambiguous\": {candidates: string[]}\n\"stale-ref\": {ref: string}\n```");
        expect(doc.slice(doc.indexOf("### page.snapshot"))).not.toContain("details");
    });
});

describe("eval 按会话的说明（eval.md 输出 16）", () => {
    const base: ToolDeclaration = {id: "nbook.agent.eval", description: "基础说明", parameters: {type: "object"}, provider: "nbook.agent", version: "1", finish: false, concurrency: "exclusive", strict: true, effect: "exec", invokes: true};

    test("列出这个会话里的对象，每个一行摘要加文档地址；版本带这一节的哈希，对象变了版本跟着变", () => {
        const one = evalDeclarationFor(base, [{name: "page", plugin: "acme.a", summary: "看页面"}]);
        expect(one.description).toContain("基础说明");
        expect(one.description).toContain("- `page`：看页面（docs://eval/page.md）");
        expect(one.version).toMatch(/^1\+[0-9a-f]{8}$/u);
        const two = evalDeclarationFor(base, [{name: "page", plugin: "acme.a", summary: "看页面"}, {name: "browser", plugin: "acme.b", summary: "开网页"}]);
        expect(two.version).not.toBe(one.version);
        // 先后不影响：按名字排。
        expect(evalDeclarationFor(base, [{name: "browser", plugin: "acme.b", summary: "开网页"}, {name: "page", plugin: "acme.a", summary: "看页面"}]).version).toBe(two.version);
    });

    test("没有对象时说明与版本都是基础的那份", () => {
        expect(evalDeclarationFor(base, [])).toBe(base);
        expect(objectsSection([])).toBeNull();
    });
});
