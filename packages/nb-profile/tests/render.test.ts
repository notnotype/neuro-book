import {describe, expect, test} from "bun:test";
import {AIMessage, HistorySet, If, Message, ProfilePrompt, Reminder, System, ToolResult, renderProfile, type ProfileNode} from "../src";

const history = [
    {role: "user", text: "第一条", callId: undefined},
    {role: "tool", text: "工具输出", callId: "c1"},
    {role: "assistant", text: "回复", callId: undefined},
] as const;

describe("renderProfile", () => {
    test("System 与 Reminder 按文档顺序进入 systemPrompt", () => {
        const node = ProfilePrompt({
            children: [System({children: ["第一段"]}), Reminder({children: ["提醒一段"]}), System({children: ["第二段"]})],
        });

        const rendered = renderProfile(node, {messages: []});
        expect(rendered.systemPrompt).toEqual(["第一段", "提醒一段", "第二段"]);
        expect(rendered.messages).toEqual([]);
    });

    test("HistorySet 按文档顺序展开历史；tool-results 只取工具消息", () => {
        const node = ProfilePrompt({
            children: [
                Message({children: ["静态用户消息"]}),
                HistorySet({children: []}),
                HistorySet({kind: "tool-results", children: []}),
                AIMessage({children: ["静态助手消息"]}),
            ],
        });

        const rendered = renderProfile(node, {messages: history});
        expect(rendered.messages.map((message) => message.text)).toEqual([
            "静态用户消息",
            "第一条",
            "工具输出",
            "回复",
            "工具输出",
            "静态助手消息",
        ]);
        expect(rendered.messages.map((message) => message.role)).toEqual(["user", "user", "tool", "assistant", "tool", "assistant"]);
    });

    test("If when=false 丢弃整棵子树（顶层与 System 内部都生效）", () => {
        const node = ProfilePrompt({
            children: [
                If({when: false, children: [System({children: ["不应出现"]}), Message({children: ["也不应出现"]})]}),
                System({children: ["保留 A", If({when: false, children: ["丢弃 B"]}), "保留 C"]}),
                If({when: true, children: [Message({children: ["保留的消息"]})]}),
            ],
        });

        const rendered = renderProfile(node, {messages: []});
        expect(rendered.systemPrompt).toEqual(["保留 A\n保留 C"]);
        expect(rendered.messages.map((message) => message.text)).toEqual(["保留的消息"]);
    });

    test("ToolResult 按 callId 取历史文本；找不到 callId 时渲染为空", () => {
        const node = ProfilePrompt({
            children: [
                ToolResult({callId: "c1", children: []}),
                ToolResult({callId: "missing", children: []}),
                ToolResult({children: []}),
            ],
        });

        const rendered = renderProfile(node, {messages: history});
        expect(rendered.messages).toEqual([{role: "tool", text: "工具输出", callId: "c1"}]);
    });

    test("连续空段折叠成一个空行，首尾空白去掉", () => {
        const node = System({children: ["标题", "", "", "正文", "  "]});

        expect(renderProfile(node, {messages: []}).systemPrompt).toEqual(["标题\n\n正文"]);
    });

    test("Message 默认 user，role=assistant 时按助手输出", () => {
        const node = ProfilePrompt({
            children: [Message({children: ["默认角色"]}), Message({role: "assistant", children: ["显式角色"]})],
        });

        expect(renderProfile(node, {messages: []}).messages).toEqual([
            {role: "user", text: "默认角色"},
            {role: "assistant", text: "显式角色"},
        ]);
    });

    test("未知节点只下探子节点，不抛错", () => {
        const custom: ProfileNode = {kind: "DomainThing", props: {}, children: [Message({children: ["穿透"]})]};

        expect(renderProfile(custom, {messages: []}).messages).toEqual([{role: "user", text: "穿透"}]);
    });
});
