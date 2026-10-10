import {describe, expect, test} from "bun:test";
import type {StreamFn} from "@oh-my-pi/pi-agent-core";
import {createAssistantMessageEventStream} from "@oh-my-pi/pi-ai";
import type {AssistantMessage, Context} from "@oh-my-pi/pi-ai";
import {buildJudgeMessages, judgeWithModel} from "./tools";
import type {JudgeRequest} from "./tools";
import {scriptedModel} from "./testing/scripted-agent";

const model = scriptedModel();
const usage = {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}};
const request: JudgeRequest = {
    tool: {id: "edit", description: "改文件"}, args: {path: "ch3.md", body: "x".repeat(5000)}, tier: "write", reason: "改第三章",
    profile: {id: "writer", name: "写作助手"},
    recent: Array.from({length: 8}, (_, index) => ({role: "user" as const, content: `第 ${index} 条 ${"y".repeat(2000)}`, timestamp: index})),
};

/** 脚本化的流：回一段文字；在 signal 中止前永不结束（never）；不理会取消、永不结束（stalled）；取消后才带着 allow 结束（late-allow）；或直接抛错。 */
function replying(text: string | "never" | "stalled" | "late-allow" | "throw", seen: Context[] = []): StreamFn {
    return (_model, context, options) => {
        seen.push(context);
        if (text === "throw") throw new Error("上游挂了");
        const stream = createAssistantMessageEventStream();
        if (text === "stalled") return stream;
        if (text === "late-allow") {
            options?.signal?.addEventListener("abort", () => {
                const message: AssistantMessage = {role: "assistant", api: model.api, provider: model.provider, model: model.id, content: [{type: "text", text: '{"decision":"allow","reason":"迟到"}'}], usage, stopReason: "stop", timestamp: 1};
                stream.push({type: "done", reason: "stop", message});
                stream.end(message);
            });
            return stream;
        }
        if (text === "never") {
            options?.signal?.addEventListener("abort", () => {
                const aborted: AssistantMessage = {role: "assistant", api: model.api, provider: model.provider, model: model.id, content: [], usage, stopReason: "aborted", timestamp: 1};
                stream.push({type: "error", reason: "aborted", error: aborted});
                stream.end(aborted);
            });
            return stream;
        }
        const message: AssistantMessage = {role: "assistant", api: model.api, provider: model.provider, model: model.id, content: [{type: "text", text}], usage, stopReason: "stop", timestamp: 1};
        stream.push({type: "start", partial: message});
        stream.push({type: "done", reason: "stop", message});
        stream.end(message);
        return stream;
    };
}

describe("审批模型（输出 7）", () => {
    const judge = (text: string | "never" | "stalled" | "late-allow" | "throw", extra: {signal?: AbortSignal; timeoutMs?: number} = {}) => judgeWithModel({model, request, stream: replying(text), ...extra});

    test("场景 4：allow、deny、escalate 照回复；不是 JSON、decision 不合法、抛错、超时、中止一律 escalate", async () => {
        expect(await judge('{"decision": "allow", "reason": "只改一章"}')).toEqual({decision: "allow", reason: "只改一章"});
        expect(await judge('好的，我的判断是 {"decision":"deny","reason":"范围太大"}')).toEqual({decision: "deny", reason: "范围太大"});
        expect(await judge('{"decision": "escalate", "reason": "拿不准"}')).toEqual({decision: "escalate", reason: "拿不准"});
        expect((await judge("我觉得可以")).decision).toBe("escalate");
        expect((await judge("我觉得可以"))).toMatchObject({reason: "invalid-output"});
        expect((await judge('{"decision": "approve"}'))).toMatchObject({decision: "escalate", reason: "invalid-output"});
        expect((await judge("throw"))).toMatchObject({decision: "escalate"});
        expect((await judge("throw")).reason).toContain("request-failed");
        expect(await judge("never", {timeoutMs: 20})).toEqual({decision: "escalate", reason: "timeout"});
        const controller = new AbortController();
        controller.abort();
        expect(await judge('{"decision": "allow"}', {signal: controller.signal})).toEqual({decision: "escalate", reason: "aborted"});
    });

    test("中止与超时自己结算：流不理会取消时到点返回 timeout；取消后才带 allow 结束的回复不采用；运行中中止同样 escalate", async () => {
        expect(await judge("stalled", {timeoutMs: 20})).toEqual({decision: "escalate", reason: "timeout"});
        expect(await judge("late-allow", {timeoutMs: 20})).toEqual({decision: "escalate", reason: "timeout"});
        const running = new AbortController();
        const pending = judge("late-allow", {signal: running.signal, timeoutMs: 10_000});
        running.abort();
        expect(await pending).toEqual({decision: "escalate", reason: "aborted"});
        const stalledRunning = new AbortController();
        const stalled = judge("stalled", {signal: stalledRunning.signal, timeoutMs: 10_000});
        stalledRunning.abort();
        expect(await stalled).toEqual({decision: "escalate", reason: "aborted"});
    });

    test("请求里带工具、等级、理由、截断后的参数与最后六条近期消息；系统提示词要求一行 JSON", async () => {
        const seen: Context[] = [];
        await judgeWithModel({model, request, stream: replying('{"decision":"allow","reason":""}', seen)});
        expect(seen).toHaveLength(1);
        const {systemPrompt, messages} = buildJudgeMessages(request);
        expect(seen[0]!.systemPrompt).toEqual(systemPrompt);
        expect(seen[0]!.messages).toEqual(messages);
        expect(systemPrompt[0]).toContain("decision");
        const text = messages[0]!.content as string;
        expect(text).toContain("工具：edit");
        expect(text).toContain("等级：write");
        expect(text).toContain("工具给出的理由：改第三章");
        expect(text).toContain("Profile：writer（写作助手）");
        expect(text).not.toContain("第 0 条");
        expect(text).not.toContain("第 1 条");
        expect(text).toContain("第 2 条");
        expect(text).toContain("第 7 条");
        expect(text.length).toBeLessThan(4 * 1024 + 6 * 1100 + 500);
    });
});
