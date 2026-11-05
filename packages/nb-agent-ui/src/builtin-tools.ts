/**
 * 内置工具的渲染器登记：只有数据与纯函数，不含组件，所以分轮与注册表的测试在 Bun 里跑。类别划分见 Spec「内置工具的类别」；
 * 未登记的工具由通用渲染器兜底。渲染层（`vue/builtin-tools.ts`）按 id 给其中几项挂上详情或节点组件。
 *
 * 只登记通用的 harness 工具；领域工具（例如 NeuroBook 的主体记忆、nb-story 的问答工具）由宿主另行登记。
 */
import type {ToolCallView} from "./types";
import type {ToolEffects, ToolRendererEntry} from "./registry";
import {TASK_TOOL_NAMES} from "./task-list";
import {agentRef} from "./text";
import {argArray, argString, countLines, objectString} from "./tool-args";
import type {CodeLine} from "./tool-detail-lines";
import {splitLines, textLines} from "./tool-detail-lines";
import {editInputChanges, parsePatchChanges, patchLine} from "./tool-formats";

const noEffects = (): ToolEffects => ({read: [], changed: []});

function readEffects(call: ToolCallView): ToolEffects {
    const path = argString(call, "path");
    return {read: path === "" ? [] : [path], changed: []};
}

function writeEffects(call: ToolCallView): ToolEffects {
    const path = argString(call, "path");
    if (path === "") {
        return noEffects();
    }
    // 整文件覆盖时拿不到旧内容，删除行数未知。
    return {read: [], changed: [{path, added: countLines(argString(call, "content")), removed: null}]};
}

/**
 * nb-harness 的 edit（参数是 `input`）按 `editInputChanges`；旧的 `{path, edits}` 写法按替换片段的行数近似统计：
 * oldText 计为删除、newText 计为新增。
 * 片段内未变的行也会被计入，所以数字偏大；精确 diff 需要文件原文，视图拿不到。
 */
function editEffects(call: ToolCallView): ToolEffects {
    if (argString(call, "input") !== "") return {read: [], changed: editInputChanges(call)};
    const path = argString(call, "path");
    if (path === "") {
        return noEffects();
    }
    // NeuroBook 的 `edit-replace`：一处替换。`replace_all` 时次数不知道，数字是一处的。
    if (hasReplacement(call)) return {read: [], changed: [{path, added: countLines(argString(call, "new_string")), removed: countLines(argString(call, "old_string"))}]};
    let added = 0;
    let removed = 0;
    for (const edit of argArray(call, "edits")) {
        added += countLines(objectString(edit, "newText") ?? "");
        removed += countLines(objectString(edit, "oldText") ?? "");
    }
    return {read: [], changed: [{path, added, removed}]};
}

function hasReplacement(call: ToolCallView): boolean {
    return argString(call, "old_string") !== "" || argString(call, "new_string") !== "";
}

function applyPatchEffects(call: ToolCallView): ToolEffects {
    return {read: [], changed: parsePatchChanges(argString(call, "patch"))};
}

/** 参数还在流式生成、要画的那一段还没到：给不出 diff，详情先显示原始参数，不显示“内容为空”。 */
function pending(call: ToolCallView, ...keys: string[]): boolean {
    return call.status === "streaming" && keys.every((key) => argString(call, key) === "" && argArray(call, key).length === 0);
}

/** write 是整文件覆盖：全部算新增。 */
function writeDiff(call: ToolCallView): CodeLine[] | null {
    if (pending(call, "content")) return null;
    return splitLines(argString(call, "content")).map((text) => ({text, tone: "added"}));
}

/**
 * edit 有两种参数。nb-harness 的 edit 是一段 `input`：补丁格式本身就带增删行，按补丁显示；hashline 格式只有行锚操作，
 * 看不出改成了什么，工具的结果正文是改完之后的那几行（`[路径]` 加带行号的内容），有结果时显示它，没有时显示 input 原文。
 * 旧的 `{path, edits}` 写法每个片段先删后增，片段之间一行淡色省略号。
 */
function editDiff(call: ToolCallView): CodeLine[] | null {
    if (pending(call, "input", "edits", "old_string", "new_string")) return null;
    if (hasReplacement(call)) {
        return [
            ...splitLines(argString(call, "old_string")).map((text): CodeLine => ({text, tone: "removed"})),
            ...splitLines(argString(call, "new_string")).map((text): CodeLine => ({text, tone: "added"})),
        ];
    }
    const input = argString(call, "input");
    if (input !== "") {
        if (parsePatchChanges(input).length > 0) return splitLines(input).map(patchLine);
        return textLines(call.result?.text || input);
    }
    const lines: CodeLine[] = [];
    argArray(call, "edits").forEach((edit, index) => {
        if (index > 0) {
            lines.push({text: "⋯", tone: "muted"});
        }
        splitLines(objectString(edit, "oldText") ?? "").forEach((text) => lines.push({text, tone: "removed"}));
        splitLines(objectString(edit, "newText") ?? "").forEach((text) => lines.push({text, tone: "added"}));
    });
    return lines;
}

function applyPatchDiff(call: ToolCallView): CodeLine[] | null {
    if (pending(call, "patch")) return null;
    return splitLines(argString(call, "patch")).map(patchLine);
}

/** 参数还在流式生成时适配器给的字数（一章要写几分钟）：先让人看到在写哪个文件、写了多少。 */
function streamingPath(call: ToolCallView): string {
    const path = argString(call, "path");
    const args = call.args;
    const chars = call.status === "streaming" && args !== null && typeof args === "object" && !Array.isArray(args) && typeof args.partialChars === "number" ? args.partialChars : null;
    return chars === null || path === "" ? path : `${path} · ${String(chars)}`;
}

function firstQuestion(call: ToolCallView): string {
    const first = argArray(call, "questions")[0];
    return first === undefined ? "" : objectString(first, "question") ?? "";
}

export const builtinToolRenderers: readonly ToolRendererEntry[] = [
    // explore
    {
        id: "read", toolNames: ["read"], category: "explore", icon: "i-lucide-file-text",
        label: agentRef("tool.read"), summary: (call) => argString(call, "path"),
        groupPhrase: (calls) => (agentRef("toolGroup.read", {count: calls.length})),
        effects: readEffects, presentation: "line",
    },
    {
        id: "grep", toolNames: ["grep"], category: "explore", icon: "i-lucide-text-search",
        label: agentRef("tool.grep"), summary: (call) => argString(call, "pattern"),
        groupPhrase: (calls) => (agentRef("toolGroup.search", {count: calls.length})), presentation: "line",
    },
    {
        id: "glob", toolNames: ["glob"], category: "explore", icon: "i-lucide-folder-search",
        label: agentRef("tool.glob"), summary: (call) => argString(call, "pattern"),
        groupPhrase: (calls) => (agentRef("toolGroup.lookup", {count: calls.length})), presentation: "line",
    },
    {
        id: "web_search", toolNames: ["web_search"], category: "explore", icon: "i-lucide-search",
        label: agentRef("tool.webSearch"), summary: (call) => argString(call, "query"),
        groupPhrase: (calls) => (agentRef("toolGroup.search", {count: calls.length})), presentation: "line",
    },
    {
        id: "web_fetch", toolNames: ["web_fetch"], category: "explore", icon: "i-lucide-globe",
        label: agentRef("tool.webFetch"), summary: (call) => argString(call, "url"),
        groupPhrase: (calls) => (agentRef("toolGroup.fetch", {count: calls.length})), presentation: "line",
    },
    {
        id: "list", toolNamePrefix: "list_", category: "explore", icon: "i-lucide-list",
        label: agentRef("tool.list"), summary: (call) => call.name,
        groupPhrase: (calls) => (agentRef("toolGroup.lookup", {count: calls.length})), presentation: "line",
    },
    // mutate
    {
        id: "write", toolNames: ["write"], category: "mutate", icon: "i-lucide-file-plus",
        label: agentRef("tool.write"), summary: streamingPath,
        effects: writeEffects, diff: writeDiff, presentation: "line",
    },
    {
        id: "edit", toolNames: ["edit"], category: "mutate", icon: "i-lucide-file-pen",
        label: agentRef("tool.edit"), summary: (call) => streamingPath(call) || editInputChanges(call).map((change) => change.path).join(", "),
        effects: editEffects, diff: editDiff, presentation: "line",
    },
    {
        id: "apply_patch", toolNames: ["apply_patch"], category: "mutate", icon: "i-lucide-file-diff",
        label: agentRef("tool.applyPatch"),
        summary: (call) => parsePatchChanges(argString(call, "patch")).map((change) => change.path).join(", "),
        effects: applyPatchEffects, diff: applyPatchDiff, presentation: "line",
    },
    // interact
    {
        id: "request_user_input", toolNames: ["request_user_input", "ask"], category: "interact", icon: "i-lucide-message-circle-question",
        label: agentRef("tool.requestUserInput"), summary: firstQuestion, presentation: "node",
    },
    {
        id: "switch_mode", toolNames: ["switch_mode"], category: "interact", icon: "i-lucide-toggle-right",
        label: agentRef("tool.switchMode"), summary: (call) => argString(call, "targetMode"), presentation: "node",
    },
    // other
    {
        id: "task", toolNames: TASK_TOOL_NAMES, category: "other", icon: "i-lucide-list-checks",
        label: agentRef("tool.task"), summary: (call) => argString(call, "title"), presentation: "node",
    },
    {
        id: "run_workflow", toolNames: ["run_workflow"], category: "other", icon: "i-lucide-workflow",
        label: agentRef("tool.runWorkflow"), summary: (call) => argString(call, "workflowKey"), presentation: "node",
    },
    {
        id: "bash", toolNames: ["bash", "shell"], category: "other", icon: "i-lucide-terminal",
        label: agentRef("tool.bash"), summary: (call) => argString(call, "command"), presentation: "card",
    },
    {
        id: "execute_sql", toolNames: ["execute_sql"], category: "other", icon: "i-lucide-database",
        label: agentRef("tool.sql"), summary: (call) => argString(call, "sql"), presentation: "card",
    },
    {
        id: "agent_collaboration", toolNames: ["create_agent", "invoke_agent", "detach_agent", "report_result"], category: "other", icon: "i-lucide-users",
        label: agentRef("tool.agentCollaboration"), summary: (call) => call.name, presentation: "card",
    },
];
