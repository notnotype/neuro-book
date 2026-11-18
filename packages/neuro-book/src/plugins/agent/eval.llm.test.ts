/**
 * eval 接真实模型（docs/specs/agent/eval.md 验收 1、2）：模型按要求写一段代码，在一次 eval 里批量读五章、统计字数，把结果写进文件；
 * eval 自己与代码里调的写工具都要批准，测试逐个批准并核对写工具的事项带着来源（`within`）。判据是日志里的工具调用与文件的最终
 * 内容，不看模型的措辞。只在 `NBOOK_LLM_TESTS=1` 时运行（docs/testing/README.md 的“真实模型”）。
 */

import {afterAll, describe, expect, test} from "bun:test";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {splitReference} from "@notnotype/nb-models/config";
import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {defineProfile} from "@notnotype/nb-harness/kernel";
import type {LogEvent} from "@notnotype/nb-harness/kernel/contracts";
import {llmTestConfig} from "@notnotype/neuro-book-test-support/llm";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

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

const WORKER = "test.llm.eval";
const TOOLS = ["eval", "read", "write", "glob"].map((name) => `nbook.agent.${name}`);
const worker = agentProfile(WORKER, {name: "eval 烟测", description: "测试用", tools: {required: TOOLS, optional: []}});
const plugin: PluginDefinition = {id: "test.llm", entries: [defineEntry({
    id: "server",
    location: "server",
    activationEvents: [worker.activationEvent],
    contributions: [worker.contribution],
    activate: () => ({contributions: {"agent.profiles": {[WORKER]: defineProfile({id: WORKER, version: "1", name: "eval 烟测", description: "测试用", system: "你按要求使用工具完成任务，任务做完后用一句话说明结果。", tools: {required: TOOLS}})}}}),
})]};

/** 五章，字数各不相同；第四章最长。 */
const CHAPTERS = [["第一章", 120], ["第二章", 260], ["第三章", 180], ["第四章", 410], ["第五章", 90]] as const;

describe.skipIf(config === null)("eval 接真实模型", () => {
    test("一次 eval 里批量读五章、统计字数并写进文件；eval 与代码里的写工具各批准一次，写工具的事项带着来源", async () => {
        const {provider, model} = splitReference(config!.model)!;
        root = await createTestTmpRoot("neuro-book-agent-llm", "eval");
        world = await agentWorld(join(root, "world"), {
            plugins: [plugin],
            env: {[config!.apiKeyEnv]: config!.apiKey},
            userSettings: {
                "nbook.models/providers": [{id: provider, kind: "catalog", name: provider, ...(config!.baseUrl === null ? {} : {baseUrl: config!.baseUrl}), apiKeyEnv: config!.apiKeyEnv, auth: "default", models: [{id: model, enabled: true}]}],
                "nbook.models/roles": {items: ["tiny", "fast", "main", "deep"].map((id) => ({id, axis: "gradient", name: "", description: "", model: id === "main" ? config!.model : null}))},
                // 每次询问：读是放行的，eval（执行档）与写要批准。
                "nbook.agent/profileSettings": {[WORKER]: {approvalMode: "ask"}},
            },
        });
        const created = await world.service.create({profile: WORKER});
        if (!created.ok) throw new Error(`create failed: ${JSON.stringify(created)}`);
        const session = created.value;
        const home = join(world.stateRoot, "agent", "sessions", session.id, "home");
        await mkdir(join(home, "正文"), {recursive: true});
        for (const [name, length] of CHAPTERS) await writeFile(join(home, "正文", `${name}.md`), "雨".repeat(length));

        const sent = await session.send({commandId: "llm-eval", input: {text: [
            "用 eval 写一段代码，一次做完下面的事，不要逐个调 read：",
            "1. 在代码里读 session://正文/ 下的五个 .md 文件（第一章到第五章）；",
            "2. 算出每章的字数（字符数）；",
            "3. 在代码里用 write 把结果写进 session://统计.md，每章一行，写成“章名：字数”，最后一行写“最长：章名”。",
        ].join("\n")}});
        if (!sent.ok || sent.value.runId === null) throw new Error(`send failed: ${JSON.stringify(sent)}`);
        const runId = sent.value.runId;

        // 逐个批准：记下每个事项的工具与来源。
        const asked: Array<{tool: string; within: string | null}> = [];
        const handled = new Set<string>();
        const result = await waitUntil("运行结束", async () => {
            world!.settings.clock.advance(100);
            const path = await session.path();
            const resolved = new Set(path.filter((event) => event.type === "interactionResolved").map((event) => (event.data as {id: string}).id));
            for (const event of path.filter((item): item is LogEvent => item.type === "interactionRequested")) {
                const data = event.data as {id: string; kind: string; request: {tool?: string}; within?: {tool: string}};
                if (handled.has(data.id) || resolved.has(data.id) || data.kind !== "approval") continue;
                handled.add(data.id);
                asked.push({tool: data.request.tool ?? "", within: data.within?.tool ?? null});
                await session.resolve({commandId: `llm-eval-${data.id}`, id: data.id, decision: "allow"});
            }
            return session.runResult({runId});
        }, {timeoutMs: 300_000, intervalMs: 200});

        const events = await session.path();
        const nested = events.filter((event) => event.type === "nestedToolResult").map((event) => event.data as {tool: string; status: string; within: {tool: string; invocation: string}});
        const evals = events.filter((event) => event.type === "toolResult" && (event.data as {tool: string}).tool === "nbook.agent.eval").map((event) => event.data as {status: string; code?: string; text: string});
        console.log(JSON.stringify({asked, evals: evals.map((item) => ({status: item.status, code: item.code, text: item.text.slice(0, 300)})), nested: nested.map((item) => [item.tool, item.status])}, null, 1));

        expect(result).toMatchObject({reason: "completed"});
        expect(evals.some((item) => item.status === "ok")).toBe(true);
        // 五章是在同一次 eval 里读的：同一个外层调用下有 5 个成功的读。
        const readsByCall = new Map<string, number>();
        for (const item of nested) if (item.tool === "nbook.agent.read" && item.status === "ok") readsByCall.set(item.within.invocation, (readsByCall.get(item.within.invocation) ?? 0) + 1);
        expect(Math.max(0, ...readsByCall.values())).toBeGreaterThanOrEqual(5);
        // eval 自己问一次；代码里的写工具问一次，事项写明来自 eval。
        expect(asked).toContainEqual({tool: "nbook.agent.eval", within: null});
        expect(asked).toContainEqual({tool: "nbook.agent.write", within: "nbook.agent.eval"});
        const stats = await readFile(join(home, "统计.md"), "utf8");
        for (const [name, length] of CHAPTERS) expect(stats).toContain(`${name}：${String(length)}`);
        expect(stats).toContain("最长：第四章");
    }, 360_000);
});
