import {describe, expect, test} from "bun:test";
import {Type} from "typebox";
import {createProfileHost, defineProfile, History, nodeComponent, Prompt, System, User} from "./profile";
import type {NodeTypeDefinition, PromptContext} from "./profile";

const context: PromptContext = {session: {id: "s", createdAt: "2026-10-10T00:00:00.000Z"}, turn: 1, now: new Date(0), fields: {}};

const Catalog = nodeComponent("plugin.x/catalog");
const catalogDefinition: NodeTypeDefinition = {
    id: "plugin.x/catalog",
    category: "content",
    props: Type.Object({}),
    parents: ["*message"],
    children: "none",
    sources: ["plugin.x/skills"],
    render: (_node, ctx) => (ctx.sources["plugin.x/skills"] as string[]).join("、"),
};

function failure(result: {ok: boolean} & Record<string, unknown>): string | null {
    return result.ok ? null : (result.code as string);
}

describe("注册（输出 1）", () => {
    test("场景 5：注册内容节点与它依赖的数据源，Profile 使用它；dispose 后再 prepare 为 unknown-node；注册 History 为 reserved-node", async () => {
        const host = createProfileHost();
        const node = host.registerNodeType(catalogDefinition);
        expect(node.ok).toBe(true);
        const source = host.registerSource({id: "plugin.x/skills", schema: Type.Array(Type.String()), phase: "invocation", resolve: async () => ["改写", "润色"]});
        expect(source.ok).toBe(true);
        const profile = defineProfile({
            id: "writer", name: "写作", description: "d", version: 1,
            prompt: () => (
                <Prompt>
                    <System>你是写作助手。</System>
                    <History><User>技能：<Catalog /></User></History>
                </Prompt>
            ),
        });
        const prepared = await host.prepare(profile, {context});
        expect(prepared.ok).toBe(true);
        if (!prepared.ok) return;
        expect(host.renderSeeds(prepared.value, "new-session").messages[0]!.message.content).toBe("技能：改写、润色");

        if (node.ok) node.value.dispose();
        const after = await host.prepare(profile, {context});
        expect(after.ok ? null : after.diagnostics.map((d) => d.code)).toEqual(["unknown-node"]);
        expect(after.ok ? null : after.code).toBe("invalid-prompt");
        // 已准备的结果不受 dispose 影响。
        expect(host.renderSeeds(prepared.value, "new-session").messages).toHaveLength(1);

        const reserved = host.registerNodeType({...catalogDefinition, id: "harness/history"});
        expect(failure(reserved)).toBe("reserved-node");
        expect(failure(host.registerNodeType({...catalogDefinition, id: "harness/fragment"}))).toBe("reserved-node");
    });

    test("同一主机内 id 重复为 duplicate-registration；dispose 后可以重新注册；两个主机互不影响", () => {
        const a = createProfileHost();
        const b = createProfileHost();
        const first = a.registerNodeType(catalogDefinition);
        expect(first.ok).toBe(true);
        expect(failure(a.registerNodeType(catalogDefinition))).toBe("duplicate-registration");
        expect(b.registerNodeType(catalogDefinition).ok).toBe(true);
        if (first.ok) first.value.dispose();
        expect(a.registerNodeType(catalogDefinition).ok).toBe(true);
        expect(failure(a.registerNodeType({...catalogDefinition, id: "harness/user"}))).toBe("duplicate-registration");
        expect(failure(a.registerField({id: "harness/tools", schema: Type.Array(Type.String())}))).toBeNull();
        expect(failure(a.registerField({id: "harness/tools", schema: Type.Array(Type.String())}))).toBe("duplicate-registration");
    });

    test("定义不合规则为 invalid-definition，detail 说明原因", () => {
        const host = createProfileHost();
        const bad = (definition: unknown): string => {
            const result = host.registerNodeType(definition as NodeTypeDefinition);
            return result.ok ? "ok" : `${result.code}:${result.detail}`;
        };
        expect(bad({...catalogDefinition, id: "NoNamespace"})).toContain("invalid-definition:id");
        expect(bad({...catalogDefinition, props: Type.String()})).toContain("props");
        expect(bad({...catalogDefinition, parents: []})).toContain("parents");
        expect(bad({...catalogDefinition, category: "layout"})).toContain("category");
        expect(bad({id: "p/m", category: "message", props: Type.Object({}), parents: ["harness/prompt"], children: "content"})).toContain("role");
        expect(bad({id: "p/s", category: "stateful", props: Type.Object({}), parents: ["harness/appending"], children: "content", render: () => ({content: null, state: null})})).toContain("id");
        expect(failure(host.registerSource({id: "p/src", schema: Type.String(), phase: "sometimes", resolve: async () => ""} as never))).toBe("invalid-definition");
        expect(failure(host.registerField({id: "no-slash", schema: Type.String()}))).toBe("invalid-definition");
    });

    test("场景 6：未注册字段只得到警告并被忽略；注册后值不合 schema 为 invalid-field", async () => {
        const host = createProfileHost();
        const profile = defineProfile({
            id: "p", name: "n", description: "d", version: 1,
            fields: {"harness/tools": ["read", 3]},
            prompt: (ctx) => <Prompt><System>工具数：{Object.keys(ctx.fields).length}</System></Prompt>,
        });
        const loose = await host.prepare(profile, {context});
        expect(loose.ok).toBe(true);
        if (!loose.ok) return;
        expect(host.renderSystem(loose.value).systemPrompt).toEqual(["工具数：0"]);
        expect(host.renderRequest(loose.value, {history: [], invocationStart: 0}).diagnostics).toEqual([]);
        expect(host.prepare(profile, {context}).then((result) => (result.ok ? result.value : null))).resolves.not.toBeNull();

        host.registerField({id: "harness/tools", schema: Type.Array(Type.String())});
        const strict = await host.prepare(profile, {context});
        expect(strict.ok ? null : strict.diagnostics.map((d) => `${d.code}@${d.path}`)).toEqual(["invalid-field@fields.harness/tools"]);

        const okProfile = defineProfile({...profile, fields: {"harness/tools": ["read"]}, prompt: (ctx) => <Prompt><System>{JSON.stringify(ctx.fields)}</System></Prompt>});
        const valid = await host.prepare(okProfile, {context});
        expect(valid.ok && host.renderSystem(valid.value).systemPrompt).toEqual(['{"harness/tools":["read"]}']);
    });
});
