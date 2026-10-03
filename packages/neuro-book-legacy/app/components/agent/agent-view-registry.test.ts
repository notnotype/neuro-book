import {describe, expect, it} from "vitest";
import {AgentViewRegistryConflictError, createAgentViewRegistry, GENERIC_TOOL_RENDERER, type HeaderActionEntry} from "./agent-view-registry";
import {builtinToolsContribution} from "./builtin-tools";

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
});
