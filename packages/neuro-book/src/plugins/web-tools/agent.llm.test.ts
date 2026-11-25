/**
 * 网页工具接真实模型与真实 DeepSeek 接口的冒烟（docs/specs/web/tools.md 验收 1、2 的真实版）：deepseek-flash 的会话里，模型自己
 * 调 `web_search` 查一个问题；再按要求在一次 eval 里批量 `web_fetch` 三个网址，代码拿到结构值。判据是日志里的工具调用与它们的
 * 结局，不看模型的措辞。密钥只在内存与启动环境里（`memoryKeyStore`），不写进文件。只在 `NBOOK_LLM_TESTS=1` 时运行。
 */

import {afterAll, describe, expect, test} from "bun:test";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import {splitReference} from "@notnotype/nb-models/config";
import {defineProfile} from "@notnotype/nb-harness/kernel";
import type {LogEvent} from "@notnotype/nb-harness/kernel/contracts";
import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {llmTestConfig} from "@notnotype/neuro-book-test-support/llm";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {definitionAt} from "nbook/manifest";
import {agentProfile} from "nbook/plugins/agent/shared/points";
import {agentWorld} from "nbook/plugins/agent/testing/world";
import type {AgentWorld} from "nbook/plugins/agent/testing/world";

import {createWebBackendPlugin} from "./backend/plugin";
import {descriptor} from "./plugin";
import {FETCH_TOOL, SEARCH_TOOL} from "./shared/contracts";
import {memoryKeyStore} from "./testing/memory-keys";

const config = llmTestConfig();
let root = "";
let world: AgentWorld | null = null;

afterAll(async () => {
    await world?.close();
    if (root !== "") await rm(root, {recursive: true, force: true});
});

const PROFILE = "test.llm-web.smoke";
const TOOLS = ["nbook.agent.eval", "nbook.agent.read"];
const declared = agentProfile(PROFILE, {name: "网页工具烟测", description: "测试用", tools: {required: TOOLS, optional: []}});
const profiles: PluginDefinition = {id: "test.llm-web", entries: [defineEntry({
    id: "server",
    location: "server",
    activationEvents: [declared.activationEvent],
    contributions: [declared.contribution],
    activate: () => ({contributions: {"agent.profiles": {[PROFILE]: defineProfile({id: PROFILE, version: "1", name: "网页工具烟测", description: "测试用", system: "你按要求使用工具完成任务，任务做完后用一句话说明结果。", tools: {required: TOOLS}})}}}),
})]};

const URLS = ["https://github.com/jina-ai/reader", "https://zh.wikipedia.org/wiki/%E7%BD%91%E7%BB%9C%E5%B0%8F%E8%AF%B4", "https://www.jjwxc.net/"];

const toolCalls = (path: readonly LogEvent[], type: "toolResult" | "nestedToolResult") => path.filter((event) => event.type === type).map((event) => event.data as {tool?: string; status?: string; code?: string; text?: string});

/** 找出这样一次 eval：调用成功，里面的嵌套调用读了 `urls` 里的每个网址（按解析后的写法比）。交回它里面的 `web_fetch` 结局。 */
function batchedFetches(path: readonly LogEvent[], urls: readonly string[]): ReadonlyArray<{readonly status: string}> | null {
    const href = (value: unknown): string | null => {
        try {
            return typeof value === "string" ? new URL(value).href : null;
        } catch {
            return null;
        }
    };
    const results = new Map(path.filter((event) => event.type === "toolResult").map((event) => {
        const data = event.data as {callId: string; status: string};
        return [data.callId, data.status] as const;
    }));
    const nested = path.filter((event) => event.type === "nestedToolResult").map((event) => event.data as {within: {invocation: string}; tool: string; args: {url?: unknown}; status: string});
    for (const event of path) {
        if (event.type !== "toolStarted") continue;
        const started = event.data as {callId: string; tool: string; invocation: string};
        if (started.tool !== "nbook.agent.eval" || results.get(started.callId) !== "ok") continue;
        const fetches = nested.filter((call) => call.within.invocation === started.invocation && call.tool === FETCH_TOOL);
        const read = new Set(fetches.map((call) => href(call.args.url)));
        if (urls.every((url) => read.has(new URL(url).href))) return fetches;
    }
    return null;
}

/** 这一段日志里成功的搜索查过哪些候选名：模型直接调的，与成功的 eval 里调的（嵌套调用记在 `nestedToolResult`）。 */
function searchedNames(path: readonly LogEvent[], names: readonly string[]): ReadonlySet<string> {
    const results = new Map(path.filter((event) => event.type === "toolResult").map((event) => {
        const data = event.data as {callId: string; status: string};
        return [data.callId, data.status] as const;
    }));
    const queriesOf = (args: {queries?: unknown} | undefined): string[] => (Array.isArray(args?.queries) ? args.queries.filter((query): query is string => typeof query === "string") : []);
    const searched: string[] = [];
    const okEvals = new Set<string>();
    for (const event of path) {
        if (event.type !== "toolStarted") continue;
        const started = event.data as {callId: string; tool: string; invocation: string; args?: {queries?: unknown}};
        if (results.get(started.callId) !== "ok") continue;
        if (started.tool === SEARCH_TOOL) searched.push(...queriesOf(started.args));
        if (started.tool === "nbook.agent.eval") okEvals.add(started.invocation);
    }
    for (const event of path) {
        if (event.type !== "nestedToolResult") continue;
        const nested = event.data as {within: {invocation: string}; tool: string; args?: {queries?: unknown}; status: string};
        if (nested.tool === SEARCH_TOOL && nested.status === "ok" && okEvals.has(nested.within.invocation)) searched.push(...queriesOf(nested.args));
    }
    return new Set(names.filter((name) => searched.some((query) => query.toLowerCase().includes(name.toLowerCase()))));
}

describe.skipIf(config === null)("网页工具接真实模型", () => {
    test("模型自己用 web_search 查；再在一次 eval 里批量 web_fetch 三个网址，拿到结构值", async () => {
        const {provider, model} = splitReference(config!.model)!;
        root = await createTestTmpRoot("neuro-book-web-llm", "网页工具烟测");
        world = await agentWorld(join(root, "world"), {
            plugins: [definitionAt("server", descriptor, createWebBackendPlugin(memoryKeyStore({deepseek: config!.apiKey}))), profiles],
            env: {[config!.apiKeyEnv]: config!.apiKey},
            userSettings: {
                "nbook.models/providers": [{id: provider, kind: "catalog", name: provider, ...(config!.baseUrl === null ? {} : {baseUrl: config!.baseUrl}), apiKeyEnv: config!.apiKeyEnv, auth: "default", models: [{id: model, enabled: true}]}],
                "nbook.models/roles": {items: ["tiny", "fast", "main", "deep"].map((id) => ({id, axis: "gradient", name: "", description: "", model: id === "main" ? config!.model : null}))},
                "nbook.agent/profileSettings": {[PROFILE]: {approvalMode: "yolo"}},
            },
        });
        const created = await world.service.create({profile: PROFILE});
        if (!created.ok) throw new Error(`create failed: ${JSON.stringify(created)}`);
        const session = created.value;

        const first = await session.send({commandId: "llm-web-1", input: {text: "用 web_search 搜一下“网文 黄金三章 写法”，告诉我前两条结果的标题和网址。"}});
        if (!first.ok || first.value.runId === null) throw new Error(`send failed: ${JSON.stringify(first)}`);
        await session.waitRun(first.value.runId);
        const afterSearch = await session.path();
        const searches = afterSearch.filter((event) => event.type === "toolStarted" && (event.data as {tool?: string}).tool === SEARCH_TOOL);
        expect(searches.length).toBeGreaterThan(0);
        expect(toolCalls(afterSearch, "toolResult").some((result) => result.tool === SEARCH_TOOL && result.status === "ok")).toBe(true);

        // 查一串互不相关的名字：工具说明让模型一次写几条查询，不再一个名字一次（w00052 t02 的来源：46 次串行搜索）。
        const names = ["Stellafolio", "Lumifolio", "Astrascribe", "Starquill"];
        const batchTurn = await session.send({commandId: "llm-web-names", input: {text: `帮我查一下这几个名字有没有被别的软件或网站用过：${names.join("、")}。每个名字各给一句结论。`}});
        if (!batchTurn.ok || batchTurn.value.runId === null) throw new Error(`send failed: ${JSON.stringify(batchTurn)}`);
        await session.waitRun(batchTurn.value.runId);
        // 判据：这一轮成功的搜索（直接调或在成功的 eval 里调）覆盖了几乎全部候选名，且模型往返不超过 3 次（一次搜完再作答是 2 次；
        // 一个名字一次要 5 次以上）。
        const namesPath = (await session.path()).slice(afterSearch.length);
        const covered = searchedNames(namesPath, names);
        expect(covered.size).toBeGreaterThanOrEqual(names.length - 1);
        expect(namesPath.filter((event) => event.type === "modelStarted").length).toBeLessThanOrEqual(3);

        const second = await session.send({commandId: "llm-web-2", input: {text: [
            "用 eval 写一段代码，一次做完，不要逐个调工具：",
            `在代码里用 tool.web_fetch 依次读这三个网址：${URLS.join("、")}；`,
            "每个拿到的是对象，把 title 和 markdown 的字数打印出来。读取慢，调用 eval 时把 timeout 设成 180。",
        ].join("\n")}});
        if (!second.ok || second.value.runId === null) throw new Error(`send failed: ${JSON.stringify(second)}`);
        await session.waitRun(second.value.runId);
        const path = await session.path();
        // 同一次成功的 eval 里读了三个网址，至少两个读到了（第三个站点可能拒绝机器读取）。
        const batch = batchedFetches(path, URLS);
        expect(batch).not.toBeNull();
        expect(batch!.filter((result) => result.status === "ok").length).toBeGreaterThanOrEqual(2);
        expect(JSON.stringify(path)).not.toContain(config!.apiKey);
    }, 600_000);
});
