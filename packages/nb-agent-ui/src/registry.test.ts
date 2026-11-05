import {describe, expect, it} from "bun:test";
import {AgentViewRegistryConflictError, createAgentViewRegistry, GENERIC_TOOL_RENDERER, visibleEntries, type HeaderActionEntry} from "./registry";
import {createAgentContext} from "./context";
import {builtinComposerContribution} from "./vue/builtin-composer";
import {builtinToolRenderers} from "./builtin-tools";
import {agentRef} from "./text";

const builtinToolsContribution = {source: "builtin:tools", tools: builtinToolRenderers};

function headerAction(id: string, order?: number): HeaderActionEntry {
    return {id, order, icon: "i-lucide-plus", label: id, target: {kind: "action", action: {type: "view.close"}}, pinnable: true};
}

describe("createAgentViewRegistry", () => {
    it("同一扩展点重复 id 时构造失败，并指出扩展点、id 与两个来源", () => {
        const build = () => createAgentViewRegistry([
            {source: "builtin:header", headerActions: [headerAction("sessions")]},
            {source: "plugin:x", headerActions: [headerAction("sessions")]},
        ]);

        expect(build).toThrow(AgentViewRegistryConflictError);
        expect(build).toThrow(/headerActions.*sessions.*builtin:header.*plugin:x/u);
    });

    it("不同扩展点可以使用相同 id", () => {
        expect(() => createAgentViewRegistry([
            {source: "a", headerActions: [headerAction("attachments")]},
            {source: "b", commands: [{id: "attachments", name: "attachments", description: "附件"}]},
        ])).not.toThrow();
    });

    it("按 order 升序排列，同值保持登记先后", () => {
        const registry = createAgentViewRegistry([
            {source: "a", headerActions: [headerAction("late", 10), headerAction("first")]},
            {source: "b", headerActions: [headerAction("second"), headerAction("early", -1)]},
        ]);

        expect(registry.list("headerActions").map((entry) => entry.id)).toEqual(["early", "first", "second", "late"]);
    });
});

describe("registry.resolveTool", () => {
    const registry = createAgentViewRegistry([builtinToolsContribution]);

    it("按内置类别登记", () => {
        expect(registry.resolveTool("read").category).toBe("explore");
        expect(registry.resolveTool("list_workflows").category).toBe("explore");
        expect(registry.resolveTool("apply_patch").category).toBe("mutate");
        expect(registry.resolveTool("request_user_input").category).toBe("interact");
        expect(registry.resolveTool("bash").category).toBe("other");
    });

    it("未登记的工具落到通用渲染器，类别为 other", () => {
        expect(registry.resolveTool("unknown_tool")).toBe(GENERIC_TOOL_RENDERER);
    });

    it("精确工具名优先于前缀匹配", () => {
        const custom = createAgentViewRegistry([
            builtinToolsContribution,
            {source: "plugin:y", tools: [{id: "list_special", toolNames: ["list_special"], category: "other", icon: "", label: "", summary: () => "", presentation: "card"}]},
        ]);

        expect(custom.resolveTool("list_special").id).toBe("list_special");
        expect(custom.resolveTool("list_other").id).toBe("list");
    });

    it("前缀互相包含时取最长的，与登记顺序无关", () => {
        const longer = {id: "atlas", toolNamePrefix: "list_atlas_", category: "other" as const, icon: "", label: "", summary: () => "", presentation: "card" as const};
        for (const contributions of [[builtinToolsContribution, {source: "p", tools: [longer]}], [{source: "p", tools: [longer]}, builtinToolsContribution]]) {
            const custom = createAgentViewRegistry(contributions);
            expect(custom.resolveTool("list_atlas_regions").id).toBe("atlas");
            expect(custom.resolveTool("list_workflows").id).toBe("list");
        }
    });

    it("两个渲染器声明同一工具名或同一前缀时构造失败，并指出工具名与两个来源", () => {
        const sameName = () => createAgentViewRegistry([
            builtinToolsContribution,
            {source: "plugin:z", tools: [{id: "my_read", toolNames: ["read"], category: "other", icon: "", label: "", summary: () => "", presentation: "card"}]},
        ]);
        expect(sameName).toThrow(AgentViewRegistryConflictError);
        expect(sameName).toThrow(/read.*builtin:tools.*plugin:z/u);
        expect(() => createAgentViewRegistry([
            builtinToolsContribution,
            {source: "plugin:z", tools: [{id: "my_list", toolNamePrefix: "list_", category: "other", icon: "", label: "", summary: () => "", presentation: "card"}]},
        ])).toThrow(/list_/u);
    });
});

describe("registry.resolveEntry（验收 28）", () => {
    const component = {};
    it("按附注的 customType 精确匹配，没有登记时为 null", () => {
        const registry = createAgentViewRegistry([{source: "plugin:story", entries: [{id: "unverified", customType: "story.unverified-refs", component}]}]);
        expect(registry.resolveEntry("story.unverified-refs")?.id).toBe("unverified");
        expect(registry.resolveEntry("story.unverified")).toBeNull();
    });

    it("两个条目渲染器声明同一个 customType 时构造失败，与登记顺序无关", () => {
        const build = () => createAgentViewRegistry([
            {source: "plugin:a", entries: [{id: "a", customType: "story.refs", component}]},
            {source: "plugin:b", entries: [{id: "b", customType: "story.refs", component}]},
        ]);
        expect(build).toThrow(AgentViewRegistryConflictError);
        expect(build).toThrow(/条目类型「story.refs」/u);
    });
});

describe("内置消息操作", () => {
    it("复制：结果是结果节点时发 tool.copy，否则按消息复制", async () => {
        const {builtinMessageActionsContribution} = await import("./vue/builtin-message-actions");
        const copy = createAgentViewRegistry([builtinMessageActionsContribution]).list("messageActions").find((entry) => entry.id === "copy")!;
        const message = {kind: "assistant" as const, id: "a3", timestamp: 1, status: "done" as const, text: "", thinking: "", model: "m", toolCalls: [], contentOmitted: false};
        expect(copy.toAction(message, {outcomeCallId: "q2"})).toEqual({type: "tool.copy", toolCallId: "q2"});
        expect(copy.toAction(message, {outcomeCallId: null})).toEqual({type: "message.copy", messageId: "a3"});
    });
});

describe("工具回调抛错", () => {
    it("摘要、组合短语、文件影响抛错时退回通用结果，不往外抛", () => {
        const boom = () => {
            throw new Error("回调坏了");
        };
        const registry = createAgentViewRegistry([{
            source: "test:plugin",
            tools: [{id: "boom", toolNames: ["boom"], category: "explore", icon: "i-lucide-bomb", label: "炸", presentation: "line", summary: boom, groupPhrase: boom, effects: boom}],
        }]);
        const tool = registry.resolveTool("boom");
        const call = {id: "c1", name: "boom", status: "success" as const, args: {}};
        expect(tool.summary(call)).toBe("boom");
        expect(tool.groupPhrase?.([call, call, call])).toEqual(agentRef("toolGroup.generic", {count: 3}));
        expect(tool.effects?.(call)).toEqual({read: [], changed: []});
    });

    it("diff 抛错时当作这次给不出 diff（null），详情退回原始参数与结果", () => {
        const registry = createAgentViewRegistry([{
            source: "test:plugin",
            tools: [{id: "boom", toolNames: ["boom"], category: "mutate", icon: "i-lucide-bomb", label: "炸", presentation: "line", summary: () => "", diff: () => {
                throw new Error("diff 坏了");
            }}],
        }]);
        expect(registry.resolveTool("boom").diff?.({id: "c1", name: "boom", status: "success", args: {}})).toBeNull();
    });
});

describe("内置输入框命令（t11）", () => {
    it("宿主声明了支持哪些命令时，菜单与发送只认这些；不声明时登记的都在", () => {
        const registry = createAgentViewRegistry([builtinComposerContribution]);
        const names = (commands: readonly string[] | undefined): string[] => visibleEntries(registry.list("commands"), createAgentContext({interaction: {commands}} as never)).map((entry) => entry.name);
        expect(names(undefined)).toContain("clear");
        expect(names(["compact"])).toEqual(["compact"]);
        expect(names([])).toEqual([]);
    });
});
