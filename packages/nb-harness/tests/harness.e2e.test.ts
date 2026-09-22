import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
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

const apiKey = process.env.DEEPSEEK_API_KEY ?? Bun.env.DEEPSEEK_API_KEY;
const modelRef = process.env.REAL_MODEL_SMOKE_MODEL ?? "deepseek/deepseek-flash";
const llmTest = apiKey === undefined ? test.skip : test;

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

describe("真实模型（无 DEEPSEEK_API_KEY 时跳过）", () => {
    llmTest(
        "模型通过 read 工具读取文件并回答",
        async () => {
            const sessionId = "real-read";
            const file = join(root, "note.txt");
            await writeFile(file, "秘密内容：青鸟计划\n", "utf-8");
            const log = await createJsonlSessionLog({root, sessionId});
            const harness = await createHarness({
                model: modelRef,
                cwd: root,
                sessionLog: log,
                node: ProfilePrompt({children: [System({children: ["你是严谨的助手，必须调用工具获取事实。"]})]}),
            });

            try {
                const result = await harness.turn("读取 note.txt（用 read 工具）并原样回答文件里的内容。");
                const entries = await log.read();

                expect(entries.some((entry) => entry.kind === "tool_call" && entry.toolName === "read")).toBe(true);
                expect(entries.some((entry) => entry.kind === "tool_result" && entry.isError === false)).toBe(true);
                expect(result.text.length).toBeGreaterThan(0);

                const replayed = await log.read();
                expect(replayed.map((entry) => entry.seq)).toEqual(entries.map((entry) => entry.seq));
            } finally {
                await harness.close();
            }
        },
        180_000,
    );

    llmTest(
        "模型通过 edit 工具把 beta 改成 BETA",
        async () => {
            const sessionId = "real-edit";
            const file = join(root, "target.txt");
            await writeFile(file, "alpha\nbeta\ngamma\n", "utf-8");
            const log = await createJsonlSessionLog({root, sessionId});
            const harness = await createHarness({
                model: modelRef,
                cwd: root,
                sessionLog: log,
                node: ProfilePrompt({children: [System({children: ["你是严谨的助手，必须先用 read 读取文件再用 edit 修改。"]})]}),
            });

            try {
                await harness.turn("用 read 读取 target.txt，然后用 edit 把第 2 行 beta 改成大写 BETA。");
                const disk = await readFile(file, "utf-8").catch(() => "<缺失>");

                expect(disk).toBe("alpha\nBETA\ngamma\n");
                const entries = await log.read();
                expect(entries.some((entry) => entry.kind === "tool_call" && entry.toolName === "edit")).toBe(true);
            } finally {
                await harness.close();
            }
        },
        180_000,
    );
});
