import {describe, expect, test} from "bun:test";
import type {AssistantMessage, Message} from "@oh-my-pi/pi-ai";
import {Appending, createProfileHost, defineProfile, History, Input, Prompt, System, User} from "./profile";
import type {PreparedProfile, Profile, ProfileHost, PromptContext} from "./profile";

const context: PromptContext = {session: {id: "s", createdAt: "2026-10-10T00:00:00.000Z"}, turn: 3, now: new Date(5_000), fields: {}};
const usage = {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}};
const user = (content: string, extra: Partial<Extract<Message, {role: "user"}>> = {}): Message => ({role: "user", content, timestamp: 1, ...extra});
const assistant = (content: AssistantMessage["content"]): Message => ({role: "assistant", content, api: "a", provider: "p", model: "m", usage, stopReason: "toolUse", timestamp: 2});
const toolResult = (toolCallId: string, textValue: string): Message => ({role: "toolResult", toolCallId, toolName: "read", content: [{type: "text", text: textValue}], isError: false, timestamp: 3});

const text = (message: Message): string => (typeof message.content === "string" ? message.content : message.content.map((block) => ("text" in block ? block.text : block.type)).join("|"));

async function prepared(host: ProfileHost, profile: Profile): Promise<PreparedProfile> {
    const result = await host.prepare(profile, {context});
    if (!result.ok) throw new Error(`${result.code}: ${result.detail}`);
    return result.value;
}

/** 三轮历史，带 attribution: agent 的提醒与本次调用的消息。 */
const history: Message[] = [
    user("修改第三章"),
    user("<system-reminder>\n保持第三人称\n</system-reminder>", {attribution: "agent"}),
    assistant([{type: "text", text: "先读一下"}, {type: "toolCall", id: "c1", name: "read", arguments: {path: "ch3.md"}}]),
    toolResult("c1", "第三章正文"),
    assistant([{type: "text", text: "改好了"}]),
    user("再改第四章"),
    assistant([{type: "text", text: "好"}]),
    user("本次输入"),
    assistant([{type: "toolCall", id: "c2", name: "read", arguments: {}}]),
    toolResult("c2", "本次的结果"),
];
const INVOCATION_START = 7;

describe("请求（输出 7、11）", () => {
    test("场景 2：两个布局 History（一个 last=2）与一个 History as=\"text\" 的请求消息：完整历史、最后两轮、一段本次调用之前的历史文字", async () => {
        const host = createProfileHost();
        const p = await prepared(host, defineProfile({
            id: "p", name: "n", description: "d", version: 1,
            prompt: () => <Prompt><System>s</System><History /><User>回顾：<History as="text" last={1} /></User><History last={2} /></Prompt>,
        }));
        const out = host.renderRequest(p, {history, invocationStart: INVOCATION_START});
        expect(out.messages.length).toBe(history.length + 1 + 5);
        expect(out.messages.slice(0, history.length)).toEqual(history);
        const review = text(out.messages[history.length]!);
        expect(review).toBe("回顾：user: 再改第四章\n\nassistant: 好");
        expect(out.messages.slice(history.length + 1).map(text)).toEqual(["再改第四章", "好", "本次输入", "toolCall", "本次的结果"]);
        expect(out.diagnostics).toEqual([]);
    });

    test("场景 12：轮按用户发出的消息划分，带 attribution: agent 的提醒不开始新一轮：last=1 只取最后一轮，last=2 取到“修改第三章”", async () => {
        const host = createProfileHost();
        const before = history.slice(0, INVOCATION_START);
        const one = await prepared(host, defineProfile({id: "p", name: "n", description: "d", version: 1, prompt: () => <Prompt><History last={1} /></Prompt>}));
        expect(host.renderRequest(one, {history: before, invocationStart: before.length}).messages.map(text)).toEqual(["再改第四章", "好"]);
        const two = await prepared(host, defineProfile({id: "p", name: "n", description: "d", version: 1, prompt: () => <Prompt><History last={2} /></Prompt>}));
        expect(host.renderRequest(two, {history: before, invocationStart: before.length}).messages[0]!).toEqual(user("修改第三章"));
    });

    test("场景 10：没有 History 的 Profile：请求只给出本次调用的消息；Appending 与种子在请求里不产生内容", async () => {
        const host = createProfileHost();
        const p = await prepared(host, defineProfile({id: "p", name: "n", description: "d", version: 1, prompt: () => <Prompt><System>只看本次</System><Appending><Input /><User>附加</User></Appending></Prompt>}));
        const out = host.renderRequest(p, {history, invocationStart: INVOCATION_START});
        expect(out.messages.map(text)).toEqual(["本次输入", "toolCall", "本次的结果"]);
        expect(out.systemPrompt).toEqual(["只看本次"]);
        const withHistory = await prepared(host, defineProfile({id: "p", name: "n", description: "d", version: 1, prompt: () => <Prompt><History><User>种子</User></History><Appending><Input /></Appending></Prompt>}));
        expect(host.renderRequest(withHistory, {history, invocationStart: INVOCATION_START}).messages).toEqual(history);
    });

    test("输出 7：invocationStart 越界按 history.length 处理并给 invalid-invocation-start 警告；文本形式的 History 只含本次调用之前的历史", async () => {
        const host = createProfileHost();
        const p = await prepared(host, defineProfile({id: "p", name: "n", description: "d", version: 1, prompt: () => <Prompt><User><History as="text" /></User></Prompt>}));
        const out = host.renderRequest(p, {history, invocationStart: 99});
        expect(out.diagnostics.map((d) => d.code)).toEqual(["invalid-invocation-start"]);
        expect(text(out.messages[0]!)).toContain("本次的结果");
        expect(out.messages).toHaveLength(1);
        const inRange = host.renderRequest(p, {history, invocationStart: INVOCATION_START});
        expect(text(inRange.messages[0]!)).not.toContain("本次");
        expect(text(inRange.messages[0]!)).toContain("[调用 read {\"path\":\"ch3.md\"}]");
        expect(text(inRange.messages[0]!)).toContain("toolResult(read): 第三章正文");
    });
});
