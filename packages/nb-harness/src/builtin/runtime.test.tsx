import {afterEach, describe, expect, test} from "bun:test";
import {mkdir, readFile, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {createHarness, kinds, testProfile} from "../runtime/testing/harness";
import type {Harness} from "../runtime/testing/harness";
import {createBuiltinTools} from "./builtin";
import {createLocalFileAccess} from "./local/local";

const harnesses: Harness[] = [];
afterEach(async () => {
    for (const harness of harnesses.splice(0)) await harness.cleanup();
});

describe("经运行时使用内置工具（场景 4）", () => {
    test("模型先 read 再 edit：文件内容改变，日志里有两个工具结果；edit 走 write 等级的审批（write 模式下直接放行）", async () => {
        // 第一步只能拿到 read 的标签之后才能写 edit 的 input：用一个会看上下文的脚本化模型
        const first = await createHarness({profiles: [testProfile({"harness/tools": ["read", "edit"]})], approvalMode: "write", sources: [], script: []});
        harnesses.push(first);
        const root = join(first.root, "project");
        await mkdir(root, {recursive: true});
        await writeFile(join(root, "ch1.md"), "第一章\n林岚出海了。\n", "utf8");
        first.deps.tools.push(createBuiltinTools({access: createLocalFileAccess({root})}));

        // 脚本：第一次请求调 read；第二次请求从工具结果里取标签头写 edit；第三次结束。句柄建 Agent 时读 deps.model，所以先设再建会话
        let tag = "";
        first.deps.model = {stream: (model, ctx) => {
            const last = ctx.messages.at(-1)!;
            const text = last.role === "toolResult" ? last.content.map((block) => ("text" in block ? block.text : "")).join("") : "";
            if (last.role === "toolResult" && text.startsWith("[ch1.md#")) tag = text.split("\n")[0]!;
            const calls = ctx.messages.filter((message) => message.role === "toolResult").length;
            const reply = calls === 0
                ? {calls: [{id: "c1", name: "read", args: {path: "ch1.md"}}]}
                : calls === 1
                    ? {calls: [{id: "c2", name: "edit", args: {input: `${tag}\nPUT 2.=2:\n+林岚出海了，船名叫远航。\n`}}]}
                    : {text: "改好了"};
            return scripted(model, reply);
        }};
        const created = await first.runtime.createSession({profileId: "writer"});
        if (!created.ok) throw new Error(created.code);
        const started = await created.value.prompt({content: "把第二行改成带船名"});
        if (!started.ok) throw new Error(`${started.code}: ${started.detail}`);
        const result = await started.value.done;
        expect(result.status).toBe("completed");
        expect(kinds(result.entries).filter((kind) => kind === "message:toolResult")).toHaveLength(2);
        expect(await readFile(join(root, "ch1.md"), "utf8")).toBe("第一章\n林岚出海了，船名叫远航。\n");
        const results = result.entries.filter((entry) => entry.type === "message" && entry.message.role === "toolResult").map((entry) => (entry.type === "message" && entry.message.role === "toolResult" ? entry.message.isError : null));
        expect(results).toEqual([false, false]);
        await created.value.close();
    });
});

import {createAssistantMessageEventStream} from "@oh-my-pi/pi-ai";
import type {AssistantMessage, Model, ToolCall} from "@oh-my-pi/pi-ai";

const usage = {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}};
function scripted(model: Model, reply: {text: string} | {calls: {id: string; name: string; args: Record<string, unknown>}[]}) {
    const content: AssistantMessage["content"] = "text" in reply ? [{type: "text", text: reply.text}] : reply.calls.map((call): ToolCall => ({type: "toolCall", id: call.id, name: call.name, arguments: call.args}));
    const reason: "stop" | "toolUse" = "text" in reply ? "stop" : "toolUse";
    const message: AssistantMessage = {role: "assistant", api: model.api, provider: model.provider, model: model.id, content, usage, stopReason: reason, timestamp: Date.now()};
    const out = createAssistantMessageEventStream();
    out.push({type: "start", partial: message});
    out.push({type: "done", reason, message});
    out.end(message);
    return out;
}
