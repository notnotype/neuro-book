/**
 * `ui` 接真实模型的冒烟（docs/specs/agent/page-agent.md 的 Smoke）：用户问“在哪改主题，带我去”，模型读 `ui` 的文档、写 eval 代码，
 * 先在界面目录里找，再按路径逐步高亮。只在 `NBOOK_LLM_TESTS=1` 时运行。
 *
 * 服务端、agent 插件与 `nbook.page-agent` 的服务端都是真的；窗口是按合同答复的测试窗口（`testing/window-side.ts`）：目录交回
 * “主题”一条与它的三步路径，高亮按 `until` 当场答复 clicked 或 next。浏览器里画得对不对由 e2e 管，这里看的是模型能不能照
 * 文档用对 `ui`。
 */

import {afterAll, describe, expect, test} from "bun:test";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import {defineProfile} from "@notnotype/nb-harness/kernel";
import type {LogEvent} from "@notnotype/nb-harness/kernel/contracts";
import {splitReference} from "@notnotype/nb-models/config";
import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {llmTestConfig} from "@notnotype/neuro-book-test-support/llm";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {definitionAt} from "nbook/manifest";
import {agentProfile} from "nbook/plugins/agent/shared/points";
import {agentWorld} from "nbook/plugins/agent/testing/world";
import type {AgentWorld} from "nbook/plugins/agent/testing/world";

import {pageAgentBackendPlugin} from "./backend/plugin";
import {descriptor} from "./plugin";
import type {FindEntry} from "./shared/contracts";
import {testWindow, testWindowState} from "./testing/window-side";

const config = llmTestConfig();
let root = "";
let world: AgentWorld | null = null;

afterAll(async () => {
    await world?.close();
    if (root !== "") await rm(root, {recursive: true, force: true});
});

const GUIDE = "test.llm.guide";
// 带 read：模型照 eval 的说明读 `docs://eval/ui.md` 里的签名（main 等真实 Profile 都有它）。
const TOOLS = ["eval", "read"].map((name) => `nbook.agent.${name}`);
const guide = agentProfile(GUIDE, {name: "引导烟测", description: "测试用", tools: {required: TOOLS, optional: []}});
const plugin: PluginDefinition = {id: "test.llm", entries: [defineEntry({
    id: "server",
    location: "server",
    activationEvents: [guide.activationEvent],
    contributions: [guide.contribution],
    activate: () => ({contributions: {"agent.profiles": {[GUIDE]: defineProfile({
        id: GUIDE, version: "1", name: "引导烟测", description: "测试用",
        system: "你是 NeuroBook 里的助手。用户问界面怎么用时，用 eval 里的 `ui` 对象在用户的窗口里找到位置，并一步步高亮带用户点过去。做完用一句话说明。",
        tools: {required: TOOLS},
    })}}}),
})]};

/** 目录里的“主题”：打开设置、点外观一节、主题那一行。 */
const THEME: FindEntry = {
    kind: "setting",
    title: "主题",
    description: "界面的配色与字体",
    id: "nbook.workbench/theme",
    path: [
        {at: {target: "workbench.activity", key: "settings"}, appears: {role: "dialog", name: "设置"}},
        {at: {target: "settings.section", key: "appearance"}, appears: {target: "settings.row", key: "nbook.workbench/theme"}},
        {at: {target: "settings.row", key: "nbook.workbench/theme"}, appears: null},
    ],
};

describe.skipIf(config === null)("ui 接真实模型", () => {
    test("“在哪改主题，带我去”：先在界面目录里找，再按路径逐步高亮每一步的控件", async () => {
        const {provider, model} = splitReference(config!.model)!;
        root = await createTestTmpRoot("neuro-book-page-agent-llm", "guide");
        world = await agentWorld(join(root, "world"), {
            plugins: [plugin, definitionAt("server", descriptor, pageAgentBackendPlugin)],
            env: {[config!.apiKeyEnv]: config!.apiKey},
            userSettings: {
                "nbook.models/providers": [{id: provider, kind: "catalog", name: provider, ...(config!.baseUrl === null ? {} : {baseUrl: config!.baseUrl}), apiKeyEnv: config!.apiKeyEnv, auth: "default", models: [{id: model, enabled: true}]}],
                "nbook.models/roles": {items: ["tiny", "fast", "main", "deep"].map((id) => ({id, axis: "gradient", name: "", description: "", model: id === "main" ? config!.model : null}))},
                "nbook.agent/profileSettings": {[GUIDE]: {approvalMode: "ask"}},
            },
        });
        // 会话不属于作品：用不绑定作品的窗口（输出 1）。
        const state = testWindowState({name: "w1", title: "NeuroBook", focused: true});
        state.find = (input) => (/主题|theme/iu.test(input.query) ? [THEME] : []);
        state.onHighlight = (filter, emit) => {
            emit({kind: "installed", window: state.info, target: {ref: "w1.1", role: "button", name: "目标"}, warnings: []});
            emit({kind: "outcome", outcome: {outcome: filter.until === "click" ? "clicked" : "next"}});
        };
        await world.settings.window("w1", [testWindow(state)], {bound: false});

        const created = await world.service.create({profile: GUIDE});
        if (!created.ok) throw new Error(`create failed: ${JSON.stringify(created)}`);
        const session = created.value;
        const sent = await session.send({commandId: "llm-guide", input: {text: "在哪改主题，带我去"}});
        if (!sent.ok || sent.value.runId === null) throw new Error(`send failed: ${JSON.stringify(sent)}`);
        const runId = sent.value.runId;

        const handled = new Set<string>();
        const result = await waitUntil("运行结束", async () => {
            world!.settings.clock.advance(100);
            const path = await session.path();
            const resolved = new Set(path.filter((event) => event.type === "interactionResolved").map((event) => (event.data as {id: string}).id));
            for (const event of path.filter((item): item is LogEvent => item.type === "interactionRequested")) {
                const data = event.data as {id: string; kind: string};
                if (handled.has(data.id) || resolved.has(data.id) || data.kind !== "approval") continue;
                handled.add(data.id);
                await session.resolve({commandId: `llm-guide-${data.id}`, id: data.id, decision: "allow"});
            }
            return session.runResult({runId});
        }, {timeoutMs: 300_000, intervalMs: 200});

        const events = await session.path();
        const nested = events.filter((event) => event.type === "nestedToolResult").map((event) => event.data as {tool: string; status: string; code?: string; args: unknown; preview: string});
        const highlighted = state.highlights.map((item) => item.filter);
        // 失败的嵌套调用连参数与开头的输出一起打出来：看模型是照文档写错了，还是文档没写清。
        const failed = nested.filter((item) => item.status !== "ok").map((item) => ({tool: item.tool, code: item.code, args: item.args, preview: item.preview.slice(0, 400)}));
        console.log(JSON.stringify({result, found: state.found, highlighted, nested: nested.map((item) => [item.tool, item.status]), failed}, null, 1));

        expect(result).toMatchObject({reason: "completed"});
        expect(state.found.some((input) => /主题|theme/iu.test(input.query))).toBe(true);
        // 按路径逐步：三步的 at 依次被高亮，每一步写了说明。
        expect(highlighted.map((filter) => filter.at)).toEqual(THEME.path.map((step) => step.at));
        for (const filter of highlighted) expect(filter.message.trim()).not.toBe("");
        expect(nested.filter((item) => item.tool === "nbook.page-agent.highlight").every((item) => item.status === "ok")).toBe(true);
    }, 360_000);
});
