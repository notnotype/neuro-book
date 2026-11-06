/**
 * 内置工具接真实模型（docs/specs/agent/builtin-tools.md 的验收 1）：真实模型按说明读一个文件、改一行、搜到它、用 shell 统计行数。
 * 判据是文件的最终内容与日志里的工具调用，不看模型的措辞。只在 `NBOOK_LLM_TESTS=1` 时运行（docs/testing/README.md 的“真实模型”）。
 */

import {afterAll, describe, expect, test} from "bun:test";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {defineProfile} from "@notnotype/nb-harness/kernel";
import {llmTestConfig} from "@notnotype/neuro-book-test-support/llm";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {splitReference} from "nbook/plugins/models/shared/rules";

import {agentProfile} from "./shared/points";
import {agentWorld} from "./testing/world";
import type {AgentWorld} from "./testing/world";

const config = llmTestConfig();
let root = "";
let world: AgentWorld | null = null;

afterAll(async () => {
    await world?.close();
    if (root !== "") await rm(root, {recursive: true, force: true});
});

const WORKER = "test.llm.worker";
const TOOLS = ["read", "write", "edit", "grep", "glob", "shell"].map((name) => `nbook.agent.${name}`);
const worker = agentProfile(WORKER, {name: "工具烟测", description: "测试用", tools: {required: TOOLS, optional: []}});
const plugin: PluginDefinition = {id: "test.llm", entries: [defineEntry({
    id: "server",
    location: "server",
    activationEvents: [worker.activationEvent],
    contributions: [worker.contribution],
    activate: () => ({contributions: {"agent.profiles": {[WORKER]: defineProfile({id: WORKER, version: "1", name: "工具烟测", description: "测试用", system: "你按要求使用工具完成任务，任务做完后用一句话说明结果。", tools: {required: TOOLS}})}}}),
})]};

describe.skipIf(config === null)("内置工具接真实模型", () => {
    test("读一个文件、改一行、grep 找到它、shell 统计行数", async () => {
        const {provider, model} = splitReference(config!.model)!;
        root = await createTestTmpRoot("neuro-book-agent-llm", "builtin-tools");
        world = await agentWorld(join(root, "world"), {
            plugins: [plugin],
            env: {[config!.apiKeyEnv]: config!.apiKey},
            userSettings: {
                "nbook.models/providers": [{id: provider, kind: "catalog", name: provider, ...(config!.baseUrl === null ? {} : {baseUrl: config!.baseUrl}), apiKeyEnv: config!.apiKeyEnv, auth: "default", models: [{id: model, enabled: true}]}],
                "nbook.models/roles": {items: ["tiny", "fast", "main", "deep"].map((id) => ({id, axis: "gradient", name: "", description: "", model: id === "main" ? config!.model : null}))},
                "nbook.agent/profileSettings": {[WORKER]: {approvalMode: "yolo"}},
            },
        });
        const created = await world.service.create({profile: WORKER});
        if (!created.ok) throw new Error(`create failed: ${JSON.stringify(created)}`);
        const session = created.value;
        const home = join(world.stateRoot, "agent", "sessions", session.id, "home");
        await mkdir(home, {recursive: true});
        await writeFile(join(home, "第一章.md"), "林舟走进雨里。\n他没有回头。\n雨越下越大。\n");

        const sent = await session.send({commandId: "llm-tools", input: {text: [
            "依次做这四件事，每一步都用工具，不要跳过：",
            "1. 用 read 读 session://第一章.md；",
            "2. 用 edit 把第二行改成“他回头看了一眼。”，其余行不动；",
            "3. 用 grep 在 session:// 里搜“回头看了一眼”；",
            "4. 用 shell 执行 wc -l session://第一章.md。",
        ].join("\n")}});
        if (!sent.ok || sent.value.runId === null) throw new Error(`send failed: ${JSON.stringify(sent)}`);
        const runId = sent.value.runId;
        const result = await waitUntil("运行结束", async () => {
            world!.settings.clock.advance(100);
            return session.runResult({runId});
        }, {timeoutMs: 240_000, intervalMs: 100});
        const events = await session.path();
        const results = events.filter((event) => event.type === "toolResult").map((event) => event.data as unknown as {tool: string; status: string; code?: string; text: string});
        console.log(JSON.stringify(results.map((item) => ({tool: item.tool, status: item.status, code: item.code, text: item.text.slice(0, 200)})), null, 1));
        expect(result).toMatchObject({reason: "completed"});
        expect(await readFile(join(home, "第一章.md"), "utf8")).toBe("林舟走进雨里。\n他回头看了一眼。\n雨越下越大。\n");
        const ok = (tool: string) => results.filter((item) => item.tool === `nbook.agent.${tool}` && item.status === "ok");
        expect(ok("read").length).toBeGreaterThan(0);
        expect(ok("edit").length).toBeGreaterThan(0);
        expect(ok("grep").some((item) => item.text.includes("回头看了一眼"))).toBe(true);
        expect(ok("shell").some((item) => item.text.includes("3"))).toBe(true);
    }, 300_000);
});
