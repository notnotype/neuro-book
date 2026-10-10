import {describe, expect, test} from "bun:test";
import {Type} from "typebox";
import {createStaticToolSource, defineTool, toAgentTool, toAgentToolResult} from "./tools";
import type {AdapterHooks, JsonValue, ToolCall, ToolDefinition, ToolSource} from "./tools";
import {runScriptedAgent} from "./testing/scripted-agent";

const session = {id: "s"};
const approveAll: AdapterHooks["approve"] = async () => ({approved: true});

function hooks(source: ToolSource, extra: Partial<AdapterHooks> = {}): AdapterHooks {
    return {source, session, approve: approveAll, ...extra};
}

const echo = (): ToolDefinition =>
    defineTool({
        id: "echo", description: "回显", parameters: Type.Object({text: Type.String()}), risk: "read",
        execute: async (args, ctx) => {
            ctx.report({stage: "half"});
            return {ok: true, content: `回显：${(args as {text: string}).text}`, details: {length: (args as {text: string}).text.length}};
        },
    });
const failing = (): ToolDefinition => defineTool({id: "failing", description: "失败", parameters: Type.Object({}), execute: async () => ({ok: false, code: "not-found", message: "文件不存在", details: {path: "x"}})});
const throwing = (): ToolDefinition => defineTool({
    id: "throwing", description: "抛错", parameters: Type.Object({}),
    execute: async () => {
        throw new Error("炸了");
    },
});

describe("适配（输出 8–11）", () => {
    test("场景 5：真实 OMP Agent 连续调用三个工具——放行并带进度、审批拒绝、参数不合 schema；描述符来自定义", async () => {
        const source = createStaticToolSource([echo(), failing()]);
        const progress: [ToolCall, JsonValue][] = [];
        const approve: AdapterHooks["approve"] = async (call) => (call.toolId === "failing" ? {approved: false, reason: "用户不让"} : {approved: true});
        const tools = source.list().map((descriptor) => toAgentTool(descriptor, hooks(source, {approve, report: (call, p) => progress.push([call, p])})));
        expect(tools[0]).toMatchObject({name: "echo", label: "echo", description: "回显"});
        expect((tools[0] as {approval?: unknown}).approval).toBeUndefined();

        const run = await runScriptedAgent({
            tools,
            script: [{calls: [{id: "c1", name: "echo", args: {text: "你好"}}, {id: "c2", name: "failing", args: {}}, {id: "c3", name: "echo", args: {nope: true}}]}],
        });
        expect(run.toolResults.slice(0, 2)).toEqual([
            {toolCallId: "c1", text: "回显：你好", isError: false},
            {toolCallId: "c2", text: "denied: 用户不让", isError: true},
        ]);
        // 缺必填参数的调用由 OMP 的循环先拦下（它自己的错误文本），不会到达适配层。
        expect(run.toolResults[2]).toMatchObject({toolCallId: "c3", isError: true});
        expect(run.toolResults[2]!.text).toContain("text");
        expect(progress).toEqual([[{toolCallId: "c1", toolId: "echo", args: {text: "你好"}}, {stage: "half"}]]);
        expect(run.requests).toBe(2);

        // 适配层自己的校验兜底：直接调用（不经 OMP 的循环）时不合 schema 的参数得到 invalid-arguments。
        const direct = await tools[0]!.execute("c9", {text: 3} as never, undefined, undefined);
        expect(direct.isError).toBe(true);
        expect(direct.content[0]).toMatchObject({type: "text", text: expect.stringContaining("invalid-arguments: /text") as unknown as string});
    });

    test("场景 5：来源在调用中途撤掉工具得到 tool-unavailable；中止得到 aborted；工具返回 ok:false 与抛错各自成为错误结果", async () => {
        const inner = createStaticToolSource([echo(), failing(), throwing()]);
        let withdrawn = false;
        const source: ToolSource = {list: () => inner.list(), get: (id) => (withdrawn && id === "echo" ? undefined : inner.get(id))};
        const tools = inner.list().map((descriptor) => toAgentTool(descriptor, hooks(source)));
        withdrawn = true;
        const run = await runScriptedAgent({tools, script: [{calls: [{id: "c1", name: "echo", args: {text: "x"}}, {id: "c2", name: "failing", args: {}}, {id: "c3", name: "throwing", args: {}}]}]});
        expect(run.toolResults.map((r) => `${r.toolCallId}:${r.isError}:${r.text}`)).toEqual([
            "c1:true:tool-unavailable: 工具 echo 此刻不可用",
            "c2:true:not-found: 文件不存在",
            "c3:true:execution-failed: 炸了",
        ]);

        const aborted = inner.list().map((descriptor) => toAgentTool(descriptor, hooks(inner, {approve: async () => ({aborted: true})})));
        const abortedRun = await runScriptedAgent({tools: aborted, script: [{calls: [{id: "c1", name: "echo", args: {text: "x"}}]}]});
        expect(abortedRun.toolResults).toEqual([{toolCallId: "c1", text: "aborted: 调用已中止", isError: true}]);
    });

    test("场景 6：拦截器——beforeExecute 改写参数后工具收到新参数；返回 deny 时工具不执行；afterExecute 改写结果", async () => {
        const source = createStaticToolSource([echo()]);
        let executed = 0;
        const counting = createStaticToolSource([defineTool({...echo(), execute: async (args) => {
            executed += 1;
            return {ok: true, content: `回显：${(args as {text: string}).text}`};
        }})]);
        const rewritten = toAgentTool(source.list()[0]!, hooks(counting, {interceptor: {beforeExecute: async (call) => ({args: {text: `${(call.args as {text: string}).text}!`}}), afterExecute: async (_call, outcome) => (outcome.ok ? {...outcome, content: `${outcome.content}（改过）`} : outcome)}}));
        const run = await runScriptedAgent({tools: [rewritten], script: [{calls: [{id: "c1", name: "echo", args: {text: "嗨"}}]}]});
        expect(run.toolResults[0]).toEqual({toolCallId: "c1", text: "回显：嗨!（改过）", isError: false});
        expect(executed).toBe(1);

        const denied = toAgentTool(source.list()[0]!, hooks(counting, {interceptor: {beforeExecute: async () => ({deny: "项目未打开"})}}));
        const deniedRun = await runScriptedAgent({tools: [denied], script: [{calls: [{id: "c1", name: "echo", args: {text: "嗨"}}]}]});
        expect(deniedRun.toolResults[0]).toEqual({toolCallId: "c1", text: "denied: 项目未打开", isError: true});
        expect(executed).toBe(1);

        const badRewrite = toAgentTool(source.list()[0]!, hooks(counting, {interceptor: {beforeExecute: async () => ({args: {text: 1}})}}));
        const badRun = await runScriptedAgent({tools: [badRewrite], script: [{calls: [{id: "c1", name: "echo", args: {text: "嗨"}}]}]});
        expect(badRun.toolResults[0]!.text).toContain("invalid-arguments: 拦截器改写后的参数不合规则");
        expect(executed).toBe(1);
    });

    test("输出 9：结果转换——字符串变一个文本块，details 原样；ok:false 变 isError 文本", () => {
        expect(toAgentToolResult({ok: true, content: "文字", details: {a: 1}})).toEqual({content: [{type: "text", text: "文字"}], details: {a: 1}});
        expect(toAgentToolResult({ok: true, content: [{type: "text", text: "a"}, {type: "image", mimeType: "image/png", data: "QUJD"}]})).toEqual({content: [{type: "text", text: "a"}, {type: "image", mimeType: "image/png", data: "QUJD"}]});
        expect(toAgentToolResult({ok: false, code: "nope", message: "不行", details: null})).toEqual({content: [{type: "text", text: "nope: 不行"}], isError: true, details: null});
    });
});
