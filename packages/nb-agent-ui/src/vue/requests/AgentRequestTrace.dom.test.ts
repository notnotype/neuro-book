/**
 * 模型请求查看器（docs/specs/agent/request-trace.md 输出 14、16、18、19、22、24）：列表的分组与行、筛选、详情的概览与几页、
 * 全文与原始请求体按需要、空状态。窄时的来回切换靠容器查询，happy-dom 量不到，在 Lab 的真实浏览器里看。
 */
import {describe, expect, it} from "vitest";
import {mount} from "@vue/test-utils";
import {nextTick} from "vue";

import type {RequestTraceDetail, RequestTraceRow} from "../../request-trace";
import AgentRequestTrace from "./AgentRequestTrace.vue";

const at = (hour: number, minute: number, second = 0) => new Date(2026, 10, 15, hour, minute, second).getTime();

const usage = (input: number, cacheRead: number, cost: number | null) => ({input, output: 120, cacheRead, cacheWrite: 0, cost});

const rows: RequestTraceRow[] = [
    {id: "r3", session: "s1", title: "第二章改稿", request: 3, purpose: "turn", model: "deepseek/deepseek-flash", turn: {id: "t2", index: 2, input: "把雾港码头那段改紧一点"}, startedAt: at(10, 5), status: "running", toolsChanged: false, attempts: 0},
    {id: "r2", session: "s1", title: "第二章改稿", request: 2, purpose: "turn", model: "deepseek/deepseek-flash", turn: {id: "t1", index: 1, input: "检查林照的年龄"}, startedAt: at(10, 2), endedAt: at(10, 2, 6), status: "error", error: {kind: "rate_limit"}, http: 429, resend: 2, toolsChanged: true, attempts: 2},
    {id: "r1", session: "s1", title: "第二章改稿", request: 1, purpose: "turn", model: "deepseek/deepseek-flash", turn: {id: "t1", index: 1, input: "检查林照的年龄"}, startedAt: at(10, 1), endedAt: at(10, 1, 4), status: "ok", usage: usage(200, 1800, 0.0021), http: 200, toolsChanged: false, attempts: 1},
];

const detail: RequestTraceDetail = {
    ...rows[2]!,
    hash: "h1",
    modifiedBy: [{extension: "nbook.agent.guards", fields: ["system"]}],
    params: {maxTokens: 8000},
    profile: "nbook.agent.main",
    system: [{hash: "sys1", preview: "你是长篇写作助手。", tokens: 820}],
    messages: [
        {hash: "m1", role: "user", preview: "检查林照的年龄", tokens: 12, images: 0},
        {hash: "m2", role: "assistant", preview: "", tokens: 30, toolCalls: [{id: "c1", tool: "builtin.read", args: {path: "第一章.md"}}], images: 0},
        {hash: "m3", role: "tool", preview: "林照二十三岁", tokens: 900, callId: "c1", images: 1},
    ],
    messagesNext: null,
    tools: [{hash: "tool1", id: "builtin.read", description: "读文件"}],
    reply: {hash: "reply1", role: "assistant", preview: "第一章写的是二十三岁。", tokens: 18, images: 0},
    attemptList: [{url: "https://api.example.test/v1/chat/completions", startedAt: at(10, 1), endedAt: at(10, 1, 4), status: 200, responseHeaders: {"x-ratelimit-remaining-requests": "99"}}],
    payload: {state: "present", bytes: 38_200},
};

function mountTrace(props: Partial<InstanceType<typeof AgentRequestTrace>["$props"]> = {}) {
    return mount(AgentRequestTrace, {
        props: {
            rows,
            list: {state: "ready", more: false},
            totals: {count: 3, input: 2000, cacheRead: 1800, cost: 0.0021},
            facets: {sessions: [{id: "s1", count: 3, title: "第二章改稿"}], models: [{id: "deepseek/deepseek-flash", count: 3}]},
            query: {},
            selected: "r1",
            detail: {state: "ready", value: detail},
            contents: {},
            payload: {state: "idle"},
            enabled: true,
            now: at(10, 5, 12),
            locale: "zh-CN",
            ...props,
        },
        attachTo: document.body,
    });
}

describe("列表（输出 14、16）", () => {
    it("同一会话同一轮的相邻请求一组，组头写会话、轮与那一轮的话；每条两行，按状态换第二行", () => {
        const view = mountTrace();
        const heads = view.findAll(".arl__group-head").map((head) => head.text());
        expect(heads).toHaveLength(2);
        expect(heads[0]).toContain("第 2 轮");
        expect(heads[1]).toContain("第二章改稿");
        expect(heads[1]).toContain("检查林照的年龄");
        const [running, failed, ok] = view.findAll("[data-request-row]");
        expect(running!.text()).toContain("已等 12.0s");
        expect(failed!.text()).toContain("HTTP 429");
        expect(failed!.text()).toContain("×2");
        expect(failed!.find("[aria-label='工具声明与上一次不同']").exists()).toBe(true);
        // 输入是全部输入（含缓存的部分），命中率按它算。
        expect(ok!.text()).toContain("入 2.0k");
        expect(ok!.text()).toContain("缓存 90%");
        expect(ok!.attributes("aria-selected")).toBe("true");
        expect(view.get(".arl__head").text()).toContain("3 次请求");
        view.unmount();
    });

    it("点一条与上下键都选中；筛选改了发 update:query，有条件时能一下清掉", async () => {
        const view = mountTrace();
        await view.findAll("[data-request-row]")[1]!.trigger("click");
        await view.get("[role='listbox']").trigger("keydown", {key: "ArrowUp"});
        expect(view.emitted("action")).toEqual([[{type: "request.select", id: "r2"}], [{type: "request.select", id: "r2"}]]);
        const menus = view.findAllComponents({name: "DropdownMenu"});
        menus[2]!.vm.$emit("select", "status:error");
        menus[0]!.vm.$emit("select", "session:s1");
        expect(view.emitted("update:query")).toEqual([[{statuses: ["error"]}], [{sessions: ["s1"]}]]);
        await view.setProps({query: {sessions: ["s1"], statuses: ["error"], sort: "time"}});
        // 只看一个会话时组头不写会话标题。
        expect(view.findAll(".arl__group-session")).toHaveLength(0);
        await view.get("[data-request-clear-filters]").trigger("click");
        expect(view.emitted("update:query")?.at(-1)).toEqual([{sort: "time"}]);
        view.unmount();
    });

    it("按别的排序时不分组；没有记录、记录关着、没有符合筛选的各有空状态（输出 24）", async () => {
        const view = mountTrace({query: {sort: "cost"}});
        expect(view.findAll(".arl__group-head")).toHaveLength(0);
        await view.setProps({rows: [], query: {}, selected: null, detail: {state: "idle"}});
        expect(view.text()).toContain("还没有模型请求");
        await view.setProps({enabled: false});
        expect(view.text()).toContain("没有在记录模型请求");
        await view.findAll("button").find((button) => button.text() === "打开记录")!.trigger("click");
        expect(view.emitted("action")?.at(-1)).toEqual([{type: "request.open-settings"}]);
        await view.setProps({query: {statuses: ["error"]}});
        expect(view.text()).toContain("没有符合筛选的请求");
        view.unmount();
    });
});

describe("详情（输出 18、19、22）", () => {
    it("概览写序号、状态、会话与轮、Profile、用量与改过请求的扩展；新一次旧一次按列表的先后", async () => {
        const view = mountTrace();
        const overview = view.get(".ard__overview").text();
        expect(overview).toContain("请求 #1");
        expect(overview).toContain("第二章改稿 · 第 1 轮 · nbook.agent.main");
        expect(overview).toContain("90% · 读 1.8k");
        expect(overview).toContain("$0.0021");
        expect(overview).toContain("nbook.agent.guards: system");
        expect(view.get("[data-request-older]").attributes("disabled")).toBeDefined();
        await view.get("[data-request-newer]").trigger("click");
        expect(view.emitted("action")?.at(-1)).toEqual([{type: "request.select", id: "r2"}]);
        view.unmount();
    });

    it("消息页一条一行，回复在最后；展开一行先要全文，交来之后原地显示", async () => {
        const view = mountTrace();
        const heads = view.findAll(".ard__item-head");
        expect(heads.map((head) => head.find(".ard__role").text())).toEqual(["用户", "助手", "工具结果", "回复"]);
        expect(heads[1]!.text()).toContain("调用 builtin.read");
        expect(heads[2]!.text()).toContain("调用 c1 的结果");
        expect(heads[2]!.text()).toContain("1 张图片");
        await heads[2]!.trigger("click");
        expect(view.emitted("action")?.at(-1)).toEqual([{type: "request.load-content", hash: "m3"}]);
        expect(view.get(".ard__full").text()).toContain("正在读取内容");
        await view.setProps({contents: {m3: {state: "ready", text: JSON.stringify({role: "tool", callId: "c1", content: [{kind: "text", text: "林照二十三岁，见第一章第 12 行。"}, {kind: "image", mime: "image/png", bytes: 2048, hash: "x"}]})}}});
        expect(view.get(".ard__full").text()).toContain("林照二十三岁，见第一章第 12 行。");
        expect(view.get(".ard__full").text()).toContain("image/png · 2.0 KB");
        view.unmount();
    });

    it("原始请求体那一页打开时才要；没有存时写原因；换一条记录时停在原来那一页", async () => {
        const view = mountTrace();
        const tabs = view.findAllComponents({name: "Tabs"});
        tabs[0]!.vm.$emit("update:modelValue", "payload");
        await nextTick();
        expect(view.emitted("action")?.at(-1)).toEqual([{type: "request.load-payload", id: "r1"}]);
        await view.setProps({payload: {state: "ready", text: "{\"model\":\"deepseek-flash\",\"messages\":[]}"}});
        expect(view.findAll(".arj__line").map((line) => line.text())).toEqual(["1{", "2  \"model\": \"deepseek-flash\",", "3  \"messages\": []", "4}"]);
        await view.setProps({selected: "r2", detail: {state: "ready", value: {...detail, ...rows[1]!, payload: {state: "pruned"}}}, payload: {state: "idle"}});
        expect(view.get("[data-request-payload-reason]").text()).toBe("原始请求体已因总量上限删掉");
        view.unmount();
    });

    it("没有记录、读不出时占满详情区；读不出时能重试", async () => {
        const view = mountTrace({detail: {state: "missing"}});
        expect(view.text()).toContain("这次请求没有记录（记录关着，或已经清掉）");
        await view.setProps({detail: {state: "error"}});
        await view.get(".ard__state button").trigger("click");
        expect(view.emitted("action")?.at(-1)).toEqual([{type: "request.retry-detail"}]);
        view.unmount();
    });
});
