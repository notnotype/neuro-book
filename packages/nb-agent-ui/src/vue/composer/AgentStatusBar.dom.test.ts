import {mount} from "@vue/test-utils";
import {describe, expect, it} from "vitest";

import {createAgentContext} from "../../context";
import {createAgentViewRegistry} from "../../registry";
import type {AgentConversationContext, SessionView} from "../../types";
import AgentStatusBar from "./AgentStatusBar.vue";

const registry = createAgentViewRegistry([]);
const SESSION: SessionView = {id: "s1", title: "第三章", summary: "", profileName: "主创", profileIcon: "i-lucide-feather", archived: false, summaryState: "idle"};
/** 数据项只在有会话时画（见下面“没选会话”）：别的用例都在一个会话里看。 */
const bar = (ctx: AgentConversationContext, options: {readonly session?: boolean} = {}) => mount(AgentStatusBar, {props: {ctx: options.session === false ? ctx : {...ctx, session: ctx.session ?? SESSION}, registry}});
const usage = {contextTokens: 16_300, contextLimit: 128_000, totalTokens: 162_400, input: 101_200, output: 3_100, cacheRead: 58_100, cacheWrite: 0, cacheHitRate: 0.62, cost: 0.07, currency: "USD" as const};

describe("AgentStatusBar", () => {
    it("没选会话：不画上下文、用量与费用；提醒项（非默认模式、全部放行）照常", () => {
        const modes = [{key: "normal", label: "普通"}, {key: "plan", label: "计划"}];
        const approval = {options: [{key: "ask", label: "每次询问", description: ""}, {key: "yolo", label: "全部放行", description: "", danger: true}], value: "yolo"};
        const view = bar(createAgentContext({usage, composer: {modes, mode: "plan", approval}}), {session: false});
        expect(view.find("[data-context-meter]").exists()).toBe(false);
        expect(view.find("[data-status-usage]").exists()).toBe(false);
        expect(view.find("[data-status-cost]").exists()).toBe(false);
        expect(view.find("[data-status-mode]").exists()).toBe(true);
        expect(view.find("[data-status-yolo]").exists()).toBe(true);
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

    it("全部放行有警告；断线写连接状态", () => {
        const approval = {options: [{key: "ask", label: "每次都问", description: "", icon: "i-lucide-x"}, {key: "yolo", label: "全部放行", description: "", icon: "i-lucide-x", danger: true}], value: "yolo"};
        expect(bar(createAgentContext({composer: {approval}})).find("[data-status-yolo]").exists()).toBe(true);
        expect(bar(createAgentContext({composer: {approval: {...approval, value: "ask"}}})).find("[data-status-yolo]").exists()).toBe(false);
        expect(bar(createAgentContext({connection: {status: "disconnected", actionRequired: false}})).get("[data-status-connection]").text()).toBe("连接断开");
    });
});
