import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";
import {defineComponent, h} from "vue";

import {createAgentContext} from "../../context";
import {createAgentViewRegistry} from "../../registry";
import type {AgentViewContribution} from "../../registry";
import type {StatusLineSetting} from "../../status-line";
import type {AgentConversationContext, SessionView} from "../../types";
import AgentStatusBar from "./AgentStatusBar.vue";

const registry = createAgentViewRegistry([]);
const SESSION: SessionView = {id: "s1", title: "第三章", summary: "", profileName: "主创", profileIcon: "i-lucide-feather", archived: false, summaryState: "idle"};
/** 数据项只在有会话时画（见下面“没选会话”）：别的用例都在一个会话里看。 */
const bar = (ctx: AgentConversationContext, options: {readonly session?: boolean} = {}) => mount(AgentStatusBar, {props: {ctx: options.session === false ? ctx : {...ctx, session: ctx.session ?? SESSION}, registry}});
const usage = {contextTokens: 16_300, contextLimit: 128_000, totalTokens: 162_400, input: 101_200, output: 3_100, cacheRead: 58_100, cacheWrite: 0, cacheHitRate: 0.62, cost: 0.07, currency: "USD" as const};

afterEach(() => {
    document.body.innerHTML = "";
});

const WordCount = defineComponent({setup: () => () => h("span", {"data-words": ""}, "改了 1,234 字")});
const hostItems: AgentViewContribution = {source: "test", statusItems: [{id: "x.words", component: WordCount, side: "left", title: "本会话改的字数", source: "字数统计"}]};
const hostRegistry = createAgentViewRegistry([hostItems]);
const withLine = (ctx: AgentConversationContext, statusLine: StatusLineSetting, reg = registry) => mount(AgentStatusBar, {props: {ctx: {...ctx, session: ctx.session ?? SESSION}, registry: reg, statusLine}, attachTo: document.body});
const shownIds = (view: ReturnType<typeof withLine>) => view.findAll("[data-status-item]").map((node) => node.attributes("data-status-item"));

describe("AgentStatusBar 的可选项（conversation.md 输出 45）", () => {
    it("空设置与不给设置一样：左边上下文，右边用量与费用，模型与宿主的项默认不显示", () => {
        const plain = bar(createAgentContext({usage}));
        const empty = withLine(createAgentContext({usage, composer: {effectiveModel: "Claude Sonnet"}}), {}, hostRegistry);
        expect(shownIds(empty)).toEqual(["context", "usage", "cost"]);
        expect(empty.find("[data-context-meter]").exists()).toBe(true);
        expect(empty.find("[data-words]").exists()).toBe(false);
        expect(empty.find("[data-status-model]").exists()).toBe(false);
        expect(empty.get("[data-status-usage]").text()).toBe(plain.get("[data-status-usage]").text());
    });

    it("设置改显隐与次序：关掉用量、打开模型与宿主的项、费用排到前面；提醒类不受设置影响", () => {
        const ctx = createAgentContext({usage, now: 12_000, run: {status: "running", phase: "生成中", startedAt: 0}, composer: {effectiveModel: "Claude Sonnet", thinking: "low"}, connection: {status: "disconnected"}});
        const view = withLine(ctx, {order: ["model", "cost"], visible: {usage: false, model: true, "x.words": true}}, hostRegistry);
        expect(shownIds(view)).toEqual(["context", "x.words", "model", "cost"]);
        expect(view.get("[data-status-model]").text()).toBe("Claude Sonnet · 低");
        expect(view.find("[data-status-usage]").exists()).toBe(false);

        // 全关了：数据项都没有，提醒还在。
        const none = withLine(ctx, {visible: {context: false, usage: false, cost: false}});
        expect(shownIds(none)).toEqual([]);
        expect(none.find("[data-context-meter]").exists()).toBe(false);
        expect(none.find("[data-status-phase]").exists()).toBe(true);
        expect(none.find("[data-status-connection]").exists()).toBe(true);
    });

    it("右键弹勾选菜单（宿主的项标来源），点一项发 toggle、点“状态栏设置…”发 openSettings；不给设置时不弹", async () => {
        const view = withLine(createAgentContext({usage}), {visible: {usage: false}}, hostRegistry);
        await view.get("[data-agent-status]").trigger("contextmenu", {clientX: 40, clientY: 40});
        await flushPromises();
        const items = [...document.body.querySelectorAll<HTMLElement>("[role='menuitemcheckbox'], [role='menuitem']")];
        const labels = items.map((item) => item.textContent?.trim());
        expect(labels).toEqual(["上下文用量", "本会话改的字数 · 插件", "用量与缓存命中", "费用", "模型与推理档", "状态栏设置…"]);
        expect(items.map((item) => item.getAttribute("aria-checked"))).toEqual(["true", "false", "false", "true", "false", null]);
        items[2]!.click();
        await flushPromises();
        expect(view.emitted("toggle")).toEqual([["usage"]]);
        expect(document.body.querySelector("[role='menu']")).toBeNull();

        await view.get("[data-agent-status]").trigger("contextmenu", {clientX: 40, clientY: 40});
        await flushPromises();
        [...document.body.querySelectorAll<HTMLElement>("[role='menuitem']")].at(-1)!.click();
        await flushPromises();
        expect(view.emitted("openSettings")).toHaveLength(1);

        const plain = bar(createAgentContext({usage}));
        await plain.get("[data-agent-status]").trigger("contextmenu");
        await flushPromises();
        expect(document.body.querySelector("[role='menu']")).toBeNull();
    });
});

describe("AgentStatusBar", () => {
    it("没选会话：不画上下文、用量与费用；提醒项（断线）照常", () => {
        const view = bar(createAgentContext({usage, connection: {status: "disconnected", actionRequired: false}}), {session: false});
        expect(view.find("[data-context-meter]").exists()).toBe(false);
        expect(view.find("[data-status-usage]").exists()).toBe(false);
        expect(view.find("[data-status-cost]").exists()).toBe(false);
        expect(view.get("[data-status-connection]").text()).toBe("连接断开");
    });

    it("宿主能给上下文详情时圆环与缓存命中能点；不能给时只是显示", async () => {
        const inspectable = bar(createAgentContext({usage, interaction: {canInspectContext: true}}));
        await inspectable.get("button[data-context-meter]").trigger("click");
        await inspectable.get("button[data-status-cache]").trigger("click");
        expect(inspectable.emitted("inspect")).toHaveLength(2);

        const plain = bar(createAgentContext({usage}));
        expect(plain.find("button[data-context-meter]").exists()).toBe(false);
        expect(plain.find("button[data-status-cache]").exists()).toBe(false);
        expect(plain.get("[data-status-cache]").text()).toBe("62%");
    });

    it("左边圆环与百分比，右边累计、输入、输出、命中与费用", () => {
        const view = bar(createAgentContext({usage}));
        expect(view.find("[data-context-meter]").text()).toBe("13%");
        expect(view.get("[data-status-usage]").text()).toBe("162.4k101.2k3.1k62%");
        expect(view.get("[data-status-cost]").text()).toBe("$0.07");
    });

    it("输出 15：不知道窗口时只显示绝对数；90% 起变红；没有用量时右边空着", () => {
        expect(bar(createAgentContext({usage: {...usage, contextLimit: null}})).text()).toContain("16.3k");
        expect(bar(createAgentContext({usage: {...usage, contextTokens: 116_480}})).get("[data-context-meter]").attributes("data-tone")).toBe("danger");
        expect(bar(createAgentContext()).find("[data-status-usage]").exists()).toBe(false);
    });

    it("单价未知不显示费用，为 0 写免费；没有单价的请求在悬停里说明", () => {
        expect(bar(createAgentContext({usage: {...usage, cost: null}})).find("[data-status-cost]").exists()).toBe(false);
        expect(bar(createAgentContext({usage: {...usage, cost: 0}})).get("[data-status-cost]").text()).toBe("免费");
        expect(bar(createAgentContext({usage: {...usage, costState: "unpriced"}})).get("[data-status-cost]").attributes("title")).toContain("费用上限对它无效");
    });

    it("输出 17：到告警线，费用变色，左边写超过告警线", () => {
        const view = bar(createAgentContext({usage: {...usage, cost: 1.02, costState: "warned"}}));
        expect(view.get("[data-status-cost-warned]").text()).toBe("超过告警线");
        expect(view.get("[data-status-cost]").classes()).toContain("is-warn");
    });

    it("运行阶段与用时、等重发（第几次、还等多久）、等批准", () => {
        const now = 1_000_000;
        expect(bar(createAgentContext({now, run: {status: "running", phase: "生成中", startedAt: now - 72_000}})).get("[data-status-phase]").text()).toBe("生成中 1:12");
        expect(bar(createAgentContext({now, run: {status: "running", phase: "请求中", retry: {attempt: 2, max: 5, resumeAt: now + 7_500}}})).get("[data-status-phase]").text()).toBe("重发 2/5，8 秒后");
        expect(bar(createAgentContext({now, run: {status: "waiting", phase: ""}, pendingInputs: [{kind: "approval", id: "a", toolCallId: "c", tool: "edit", args: {}, preview: {state: "loading"}}]})).get("[data-status-phase]").text()).toBe("等你批准");
        expect(bar(createAgentContext({now, run: {status: "waiting", phase: ""}, pendingInputs: [{kind: "question", id: "q", toolCallId: "c", questions: []}]})).get("[data-status-phase]").text()).toBe("等你回答");
    });

    it("正在停止：超过 10 秒提示工具没有响应", () => {
        const now = 1_000_000;
        const stopping = {status: "stopping" as const, phase: "", startedAt: now - 60_000};
        expect(bar(createAgentContext({now, run: stopping, stopRequestedAt: now - 5_000})).get("[data-status-phase]").text()).toBe("正在停止");
        expect(bar(createAgentContext({now, run: stopping, stopRequestedAt: now - 11_000})).get("[data-status-phase]").text()).toContain("工具未响应");
    });

    it("模式不在状态栏标出（看输入框工具栏）；断线写连接状态", () => {
        const modes = [{key: "normal", label: "普通"}, {key: "plan", label: "计划"}];
        const approval = {options: [{key: "ask", label: "每次都问", description: "", icon: "i-lucide-x"}, {key: "yolo", label: "全部放行", description: "", icon: "i-lucide-x", danger: true}], value: "yolo"};
        const text = bar(createAgentContext({composer: {modes, mode: "plan", approval}})).get("[data-agent-status]").text();
        expect(text).not.toContain("计划");
        expect(text).not.toContain("全部放行");
        expect(bar(createAgentContext({connection: {status: "disconnected", actionRequired: false}})).get("[data-status-connection]").text()).toBe("连接断开");
    });
});

describe("AgentStatusBar 窄时收项与宿主项的隔离（conversation.md 输出 45、contributions.md 输出 22）", () => {
    // jsdom 没有布局：用按 data-status-item 给宽度的假布局代替（提醒那一块按 data-status-reminders），状态栏宽 200（可用 200 - 24 = 176）。
    const DEFAULT_WIDTHS: Record<string, number> = {usage: 120, cost: 40, "x.empty": 0, "x.w": 30};
    let WIDTHS = DEFAULT_WIDTHS;
    let remindersWidth = 0;
    const originals = {observer: globalThis.ResizeObserver, offset: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth"), client: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth")};
    let barWidth = 200;
    /** 只量登记过的元素：被取消观察的元素再变宽，状态栏不会知道（同真实的 ResizeObserver）。`resize` 模拟这些元素尺寸变了。 */
    const observed = new Set<Element>();
    let observers: FakeObserver[] = [];
    class FakeObserver {
        private readonly callback: () => void;
        constructor(callback: () => void) { this.callback = callback; observers.push(this); }
        observe(element: Element): void { observed.add(element); queueMicrotask(this.callback); }
        unobserve(element: Element): void { observed.delete(element); }
        disconnect(): void {}
        fire(): void { this.callback(); }
    }
    const resize = (): void => { for (const observer of observers) observer.fire(); };
    const install = (): void => {
        globalThis.ResizeObserver = FakeObserver as unknown as typeof ResizeObserver;
        Object.defineProperty(HTMLElement.prototype, "offsetWidth", {configurable: true, get() {
            if ((this as HTMLElement).hasAttribute("data-status-reminders")) return remindersWidth;
            const id = (this as HTMLElement).getAttribute("data-status-item");
            return id === null ? 0 : WIDTHS[id] ?? 0;
        }});
        Object.defineProperty(HTMLElement.prototype, "clientWidth", {configurable: true, get() { return (this as HTMLElement).hasAttribute("data-agent-status") ? barWidth : 0; }});
    };
    afterEach(() => {
        globalThis.ResizeObserver = originals.observer;
        for (const [name, descriptor] of [["offsetWidth", originals.offset], ["clientWidth", originals.client]] as const) {
            if (descriptor === undefined) delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
            else Object.defineProperty(HTMLElement.prototype, name, descriptor);
        }
        barWidth = 200;
        WIDTHS = DEFAULT_WIDTHS;
        remindersWidth = 0;
        observed.clear();
        observers = [];
    });

    const Words = defineComponent({setup: () => () => h("span", "w")});
    const Empty = defineComponent({setup: () => () => null});
    const Broken = defineComponent({setup: () => () => { throw new Error("坏组件"); }});
    const plugin = (id: string, component: ReturnType<typeof defineComponent>) => ({id, component, side: "right" as const, title: id, source: "x"});
    const settle = async (): Promise<void> => { await flushPromises(); await flushPromises(); };
    const open = async (items: ReturnType<typeof plugin>[], width = 200) => {
        install();
        barWidth = width;
        const view = withLine(createAgentContext({usage}), {visible: Object.fromEntries(items.map((item) => [item.id, true]))}, createAgentViewRegistry([{source: "t", statusItems: items}]));
        await settle();
        return view;
    };
    const collapsed = (view: ReturnType<typeof withLine>) => view.findAll(".is-collapsed").map((node) => node.attributes("data-status-item"));

    it("放不下从前往后收进“…”，放宽后回来；最后一项也放不下时全收", async () => {
        const view = await open([plugin("x.w", Words)]);
        // 右边 120 + 40 + 30 + 间距 12 + 与左边的间距 6 = 208 > 176：收用量，剩“…”16 + 40 + 30 + 间距 18 = 104。
        expect(collapsed(view)).toEqual(["usage"]);
        expect(view.find("[data-status-more]").exists()).toBe(true);

        const tight = await open([plugin("x.w", Words)], 60);
        expect(collapsed(tight)).toEqual(["usage", "cost", "x.w"]);
        expect(tight.find("[data-status-more]").exists()).toBe(true);

        const wide = await open([plugin("x.w", Words)], 400);
        expect(collapsed(wide)).toEqual([]);
        expect(wide.find("[data-status-more]").exists()).toBe(false);
    });

    it("项换到左边：右边收完再收左边的数据项，从后往前；提醒不收", async () => {
        install();
        WIDTHS = {context: 40, usage: 120, cost: 40};
        remindersWidth = 60;
        const ctx = createAgentContext({usage, now: 12_000, run: {status: "running", phase: "生成中", startedAt: 0}});
        const line = {side: {usage: "left"}} as const;
        // 左边 40 + 120 + 提醒 60 + 间距 12；右边 40 与间距 6，共 278 > 176。收费用、再收用量：40 + 60 + 6，右边“…”16 + 6，共 128。
        barWidth = 200;
        const view = withLine(ctx, line);
        await settle();
        expect(collapsed(view)).toEqual(["usage", "cost"]);
        expect(view.get("[data-status-more]").attributes("aria-label")).toBe("162.4k · 输入 101.2k，输出 3.1k，缓存读 58.1k，缓存写 0 · $0.07");
        expect(view.find("[data-status-phase]").exists()).toBe(true);
        // 再窄：上下文也收，只剩提醒与“…”；悬停里上下文写百分比。
        barWidth = 150;
        const narrow = withLine(ctx, line);
        await settle();
        expect(collapsed(narrow)).toEqual(["context", "usage", "cost"]);
        expect(narrow.get("[data-status-more]").attributes("aria-label")).toMatch(/^13% · /u);
        expect(narrow.find("[data-status-phase]").exists()).toBe(true);
    });

    it("挂着时把一项从右边换到左边：新位置照样量宽，之后变窄了收起跟着变", async () => {
        install();
        WIDTHS = {context: 40, usage: 120, cost: 40};
        const view = withLine(createAgentContext({usage}), {});
        await settle();
        expect(collapsed(view)).toEqual(["usage"]);
        await view.setProps({statusLine: {side: {usage: "left"}}});
        await settle();
        // 左边 40 + 120 + 间距 6，右边 40 与间距 6，共 212 > 176：先收费用，再收用量。
        expect(collapsed(view)).toEqual(["usage", "cost"]);
        expect(observed.has(view.get(".acv-status__left [data-status-item='usage']").element)).toBe(true);
        // 用量变窄到 60：40 + 60 + 6 + 40 + 6 = 152，都放得下。
        WIDTHS = {context: 40, usage: 60, cost: 40};
        resize();
        await settle();
        expect(collapsed(view)).toEqual([]);
    });

    it("宽度为 0 的项（没有内容、还在加载）不占位，也不让别的项失去收起", async () => {
        const view = await open([plugin("x.w", Words), plugin("x.empty", Empty)]);
        expect(collapsed(view)).toEqual(["usage"]);
    });

    it("宿主项渲染时抛错：只这一项不画，状态栏其余项与提醒照常", async () => {
        install();
        const view = withLine(createAgentContext({usage, connection: {status: "disconnected"}}), {visible: {"x.broken": true}}, createAgentViewRegistry([{source: "t", statusItems: [plugin("x.broken", Broken)]}]));
        await settle();
        expect(view.find("[data-status-usage]").exists()).toBe(true);
        expect(view.find("[data-status-cost]").exists()).toBe(true);
        expect(view.find("[data-status-connection]").exists()).toBe(true);
    });

    it("右键菜单关闭后焦点回到打开前的地方：选项、Esc 都回；点到菜单外不抢", async () => {
        const input = document.createElement("textarea");
        document.body.append(input);
        const view = withLine(createAgentContext({usage}), {});
        for (const close of [() => (document.body.querySelector("[role='menuitemcheckbox']") as HTMLElement).click(), () => document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}))]) {
            input.focus();
            await view.get("[data-agent-status]").trigger("contextmenu", {clientX: 10, clientY: 10});
            await settle();
            expect(document.activeElement).not.toBe(input);
            close();
            await settle();
            expect(document.activeElement).toBe(input);
        }
    });
});
