/** 工具来源与可见工具（docs/specs/harness/tools.md 输出 2、3）。 */

import {toolDefinitionProblem} from "./define";
import type {ToolDefinition, ToolDescriptor, ToolSource, ToolsResult} from "./types";

export function describeTool(definition: ToolDefinition): ToolDescriptor {
    const risk = definition.risk;
    return {
        id: definition.id,
        description: definition.description,
        parameters: definition.parameters,
        risk: risk === undefined ? "exec" : typeof risk === "function" ? "dynamic" : typeof risk === "string" ? risk : risk.tier,
        scope: definition.scope ?? "session",
    };
}

export function createStaticToolSource(tools: readonly ToolDefinition[]): ToolSource {
    const byId = new Map<string, ToolDefinition>();
    for (const tool of tools) {
        const problem = toolDefinitionProblem(tool);
        if (problem !== null) throw new TypeError(`工具定义不合规则：${problem}`);
        if (byId.has(tool.id)) throw new TypeError(`工具 id 重复：${tool.id}`);
        byId.set(tool.id, tool);
    }
    return {
        list: () => [...byId.values()].map(describeTool),
        get: (id) => byId.get(id),
    };
}

/** 可见工具 = Profile 列出的 ∩ 来源此刻可用的，按 Profile 的顺序；同一个 id 来自两个来源整体失败。 */
export function visibleTools(input: {requested: readonly string[]; sources: readonly ToolSource[]}): ToolsResult<{tools: ToolDescriptor[]; missing: string[]}> {
    const available = new Map<string, ToolDescriptor>();
    for (const source of input.sources) {
        for (const descriptor of source.list()) {
            if (available.has(descriptor.id)) return {ok: false, code: "tool-conflict", detail: `工具 ${descriptor.id} 来自两个来源`};
            available.set(descriptor.id, descriptor);
        }
    }
    const visible: ToolDescriptor[] = [];
    const missing: string[] = [];
    const seen = new Set<string>();
    for (const id of input.requested) {
        if (seen.has(id)) continue;
        seen.add(id);
        const descriptor = available.get(id);
        // 请求了来源没有的 id 不是错误（同一 Profile 装到工具更少的宿主照常能用），但要让调用方看得见
        if (descriptor === undefined) missing.push(id);
        else visible.push(descriptor);
    }
    return {ok: true, value: {tools: visible, missing}};
}
