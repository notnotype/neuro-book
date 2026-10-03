import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {rm} from "node:fs/promises";
import type {AgentTool} from "@oh-my-pi/pi-agent-core";
import {ProfilePrompt, System} from "@notnotype/nb-profile";
import {createJsonlSessionLog} from "@notnotype/nb-session";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {createHarness, definePlugin} from "../src";
import {scriptedStreamFn} from "../src/testing";

let root = "";

beforeAll(async () => {
    root = await createTestTmpRoot("nb-harness-e2e", "harness-assembly");
});

afterAll(async () => {
    if (root !== "") await rm(root, {recursive: true, force: true});
});

// 脚本化流不发请求，模型名只用于装配。
const modelRef = "deepseek/deepseek-flash";

function profile(): ReturnType<typeof ProfilePrompt> {
    return ProfilePrompt({children: [System({children: ["你是 nb-harness 的测试助手。"]})]});
}

describe("harness 装配（脚本化流，不调用真实模型）", () => {
    test("工具集含 read/edit，事件可订阅，turn 落盘用户与助手消息", async () => {
        const log = await createJsonlSessionLog({root, sessionId: "assembly"});
        const harness = await createHarness({
            model: modelRef,
            cwd: root,
            sessionLog: log,
            node: profile(),
            streamFn: scriptedStreamFn("装配测试回复"),
            apiKey: () => "scripted",
        });

        try {
            const eventTypes: string[] = [];
            const unsubscribe = harness.subscribe((event) => eventTypes.push(event.type));
            const result = await harness.turn("你好");
            unsubscribe();

            expect(harness.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(["read", "edit"]));
            expect(eventTypes).toContain("agent_start");
            expect(eventTypes).toContain("agent_end");
            expect(result.text).toBe("装配测试回复");

            const entries = await log.read();
            expect(entries.map((entry) => entry.kind)).toEqual(["message", "message"]);
            expect(entries[0]).toMatchObject({kind: "message", role: "user"});
            expect(entries[1]).toMatchObject({kind: "message", role: "assistant", text: "装配测试回复"});
            expect(result.entries).toHaveLength(2);
        } finally {
            await harness.close();
        }
    });

    test("use() 注册的插件工具进入工具集", async () => {
        const log = await createJsonlSessionLog({root, sessionId: "plugin"});
        const echo: AgentTool = {
            name: "echo",
            label: "Echo",
            description: "回显输入",
            parameters: {type: "object", properties: {text: {type: "string"}}, required: ["text"]},
            execute: async (_toolCallId, params) => ({content: [{type: "text", text: String((params as {text: string}).text)}]}),
        } as AgentTool;
        const harness = await createHarness({
            model: modelRef,
            cwd: root,
            sessionLog: log,
            node: profile(),
            streamFn: scriptedStreamFn("ok"),
            apiKey: () => "scripted",
        });

        try {
            expect(harness.tools.some((tool) => tool.name === "echo")).toBe(false);
            harness.use(definePlugin({manifest: {name: "demo", version: "0.0.1"}, tools: [echo]}));
            expect(harness.tools.some((tool) => tool.name === "echo")).toBe(true);
        } finally {
            await harness.close();
        }
    });

    test("重复注册同名插件报错", async () => {
        const log = await createJsonlSessionLog({root, sessionId: "plugin-dup"});
        const harness = await createHarness({
            model: modelRef,
            cwd: root,
            sessionLog: log,
            node: profile(),
            streamFn: scriptedStreamFn("ok"),
            apiKey: () => "scripted",
            plugins: [definePlugin({manifest: {name: "dup"}})],
        });

        try {
            expect(() => harness.use(definePlugin({manifest: {name: "dup"}}))).toThrow(/插件已注册/u);
        } finally {
            await harness.close();
        }
    });
});
