/**
 * SubagentsEntry（同名 .md，docs/specs/agent/conversation.md 输出 43）：入口的个数与红点、浮层的行与第二行、点行进子会话、
 * 停止只停那一次运行。后代数据经注入的 `subagentStoreKey` 给（同对话位置的组件），动作名用真实的注册表。
 */

import {createAgentViewRegistry} from "@notnotype/nb-agent-ui";
import {builtinContributions} from "@notnotype/nb-agent-ui/vue";
import type {RunResult} from "@notnotype/nb-harness/kernel/contracts";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";
import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";
import {ref, shallowRef} from "vue";

import type {ProfileEntry} from "nbook/plugins/agent/shared/contracts";
import type {TreeItem} from "nbook/plugins/agent/shared/subagents";
import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import {AGENT_TEXT_NAMESPACE} from "../../shared/text";
import {subagentContribution} from "../subagent-renderers";
import {subagentStoreKey, toolActionKey, toolActionOf} from "../subagent-store";
import type {SubagentStore} from "../subagent-store";
import {createRunResults, createSeenErrors} from "../subagents-panel";
import {agentCatalogs} from "../text";
import SubagentCard from "./SubagentCard.vue";
import SubagentsEntry from "./SubagentsEntry.vue";

const port = testTextPort("zh-CN", {[AGENT_TEXT_NAMESPACE]: agentCatalogs});
const registry = createAgentViewRegistry([...builtinContributions, subagentContribution({card: SubagentCard})]);
const NOW = 1_000_000;
const PROFILES: ProfileEntry[] = [{key: "x.checker", name: "称谓检查", description: "", source: "test", status: "ok"}];

const mounted: Array<{unmount(): void}> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

function item(id: string, parent: string, patch: Partial<TreeItem> = {}): TreeItem {
    return {id, parent, callId: null, invocation: null, forked: false, profile: "x.checker", name: `${id} 的任务`, state: "idle", runs: [], ...patch};
}

const runResult = (patch: Partial<RunResult>): RunResult => ({runId: "r1", reason: "completed", stopReason: "stop", text: "", result: null, error: null, usage: {} as never, entries: {first: 1, last: 2}, ...patch});

function render(items: readonly TreeItem[], results: Readonly<Record<string, RunResult>> = {}) {
    const stopped: string[] = [];
    const fetched: string[] = [];
    const store: SubagentStore = {
        data: shallowRef({sessionId: "root", tree: new Map(items.map((entry) => [entry.id, entry])), jobs: new Map()}),
        now: ref(NOW),
        tail: async () => null,
        status: async () => null,
        kill: async () => undefined,
        stopRun: async (sessionId) => void stopped.push(sessionId),
        runResult: async (sessionId, runId) => {
            fetched.push(`${sessionId}:${runId}`);
            return results[sessionId] ?? null;
        },
    };
    const seen = createSeenErrors(0);
    const provide = {...provideText(port), [subagentStoreKey as symbol]: store, [toolActionKey as symbol]: (tool: string) => toolActionOf(registry, tool)};
    const wrapper = mount(SubagentsEntry, {global: {provide}, props: {profiles: PROFILES, seen, results: createRunResults(() => undefined)}, attachTo: document.body});
    mounted.push(wrapper);
    return {wrapper, store, stopped, fetched};
}

const rows = (): HTMLElement[] => [...document.body.querySelectorAll<HTMLElement>("[data-subagent-row]")];
const rowOf = (id: string): HTMLElement => document.body.querySelector<HTMLElement>(`[data-subagent-row="${id}"]`)!;
const text = (row: HTMLElement, selector: string): string => row.querySelector(selector)?.textContent?.trim() ?? "";

describe("SubagentsEntry", () => {
    it("没有后代时不画；有时写个数，等你处理时亮红点；点开列出每一行，汇总写在跑与等你处理", async () => {
        const empty = render([]);
        expect(empty.wrapper.find("[data-subagents-entry]").exists()).toBe(false);

        const {wrapper} = render([
            item("a", "root", {state: "waiting", pending: [{id: "p", kind: "approval", callId: "c", request: {tool: "nbook.agent.write"}}]}),
            item("b", "root", {state: "running", tools: 7, startedAt: NOW - 134_000, step: {tool: "nbook.agent.read", target: "project://正文/第三章.md"}}),
            item("b1", "b", {state: "running", profile: "x.unknown"}),
        ]);
        const entry = wrapper.get("[data-subagents-entry]");
        expect(entry.text()).toBe("3");
        expect(wrapper.find("[data-subagents-dot]").exists()).toBe(true);
        await entry.trigger("click");
        await flushPromises();
        expect(rows().map((row) => row.dataset.subagentRow)).toEqual(["a", "b", "b1"]);
        expect(document.body.querySelector("[data-subagents-summary]")?.textContent).toBe("3 个 · 2 个在跑 · 1 个等你处理");
        expect(text(rowOf("a"), "[data-subagent-detail]")).toBe("等你批准：写入");
        expect(text(rowOf("b"), "[data-subagent-detail]")).toBe("7 次 · 2:14 · 读取 第三章.md");
        // 截掉动态字段的只写状态；Profile 查不到写“子代理”。
        expect(rowOf("b1").querySelector("[data-subagent-detail]")).toBeNull();
        expect(text(rowOf("b1"), ".sa-row__name")).toBe("子代理");
        expect(text(rowOf("b1"), "[data-subagent-state]")).toBe("运行中");
    });

    it("收口了的行打开时才取结果：完成写回复的第一行，出错写按类别的那句话；看过的出错不再亮红点", async () => {
        const {wrapper, fetched} = render([
            item("done", "root", {runs: [{runId: "r1", reason: "completed", endedAt: NOW}]}),
            item("err", "root", {runs: [{runId: "r1", reason: "error", endedAt: NOW}]}),
        ], {done: runResult({text: "\n找到 4 处称谓前后不一致。\n\n1. ……"}), err: runResult({reason: "error", error: {kind: "rate_limit"}})});
        expect(fetched).toEqual([]);
        expect(wrapper.find("[data-subagents-dot]").exists()).toBe(true);
        await wrapper.get("[data-subagents-entry]").trigger("click");
        await waitUntil("取到结果", () => text(rowOf("err"), "[data-subagent-detail]") !== "");
        expect(fetched.sort()).toEqual(["done:r1", "err:r1"]);
        expect(text(rowOf("done"), "[data-subagent-detail]")).toBe("找到 4 处称谓前后不一致。");
        expect(text(rowOf("err"), "[data-subagent-detail]")).toBe("模型服务请求太频繁，请稍后重试。");
        expect(text(rowOf("err"), "[data-subagent-state]")).toBe("出错");
        expect(wrapper.find("[data-subagents-dot]").exists()).toBe(false);
    });

    it("一次打开里每次运行只取一次：取不到的不随后代的进度重取，关掉再开才再试；停止、中断的不取", async () => {
        const done = item("d", "root", {runs: [{runId: "r1", reason: "completed", endedAt: NOW}]});
        const stopped = item("s", "root", {runs: [{runId: "r1", reason: "aborted", endedAt: NOW}]});
        const running = (tools: number) => item("a", "root", {state: "running", tools});
        const {wrapper, store, fetched} = render([done, stopped, running(1)]);
        const push = (...items: TreeItem[]) => {
            store.data.value = {...store.data.value, tree: new Map(items.map((entry) => [entry.id, entry]))};
        };
        await wrapper.get("[data-subagents-entry]").trigger("click");
        await flushPromises();
        push(done, stopped, running(2));
        await flushPromises();
        push(done, stopped, running(3));
        await flushPromises();
        expect(fetched).toEqual(["d:r1"]);

        await wrapper.get("[data-subagents-entry]").trigger("click");
        await waitUntil("浮层关了", () => rows().length === 0);
        await wrapper.get("[data-subagents-entry]").trigger("click");
        await flushPromises();
        expect(fetched).toEqual(["d:r1", "d:r1"]);
    });

    it("后代都没了时浮层关掉：之后又有了后代，入口回来、浮层不自己弹开", async () => {
        const {wrapper, store} = render([item("a", "root", {state: "running"})]);
        await wrapper.get("[data-subagents-entry]").trigger("click");
        await flushPromises();
        expect(rows()).toHaveLength(1);
        const tree = store.data.value.tree;
        store.data.value = {...store.data.value, tree: new Map()};
        await flushPromises();
        expect(wrapper.find("[data-subagents-entry]").exists()).toBe(false);
        store.data.value = {...store.data.value, tree};
        await flushPromises();
        expect(wrapper.find("[data-subagents-entry]").exists()).toBe(true);
        expect(rows()).toHaveLength(0);
    });

    it("点一行发 select 并关掉浮层；运行中的行有停止，只停那个会话这次的运行", async () => {
        const {wrapper, stopped} = render([item("a", "root", {state: "running"}), item("d", "root", {runs: [{runId: "r1", reason: "completed", endedAt: NOW}]})]);
        await wrapper.get("[data-subagents-entry]").trigger("click");
        await flushPromises();
        expect(rowOf("d").querySelector("[data-subagent-stop]")).toBeNull();
        (rowOf("a").querySelector("[data-subagent-stop]") as HTMLElement).click();
        await flushPromises();
        expect(stopped).toEqual(["a"]);

        (rowOf("d").querySelector("button") as HTMLElement).click();
        await flushPromises();
        expect(wrapper.emitted("select")).toEqual([["d"]]);
        await waitUntil("浮层关了", () => rows().length === 0);
    });
});
