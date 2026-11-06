import {mount} from "@vue/test-utils";
import {describe, expect, it, vi} from "vitest";

import type {ContextInspectionView, UsageSummaryView} from "../../types";
import AgentContextInspector from "./AgentContextInspector.vue";

const usage: UsageSummaryView = {contextTokens: 0, contextLimit: null, totalTokens: 0, input: 96_000, output: 12_000, cacheRead: 412_000, cacheWrite: 8_400, cacheHitRate: 0.81, lastCacheHitRate: 0.94, cost: null, currency: "USD"};
const ready: ContextInspectionView = {
    state: "ready",
    estimated: 54_000,
    window: 128_000,
    threshold: 108_000,
    areas: [{key: "system", tokens: 4_000}, {key: "tools", tokens: 3_000}, {key: "opening", tokens: 3_000}, {key: "history", tokens: 42_000}, {key: "turn", tokens: 2_000}],
    slots: [{name: "rules", extension: "nbook.agent", tokens: 2_000, placed: true}, {name: "memory", extension: "lab", tokens: 0, placed: false}],
    diagnostics: [{id: "d", level: "warning", message: "slot failed"}],
};
const show = (inspection: ContextInspectionView, extra: Partial<UsageSummaryView> = {}) => mount(AgentContextInspector, {props: {inspection, systemPrompt: null, usage: {...usage, ...extra}}});

describe("AgentContextInspector", () => {
    it("组成：总量、窗口与压缩线、各块的占比", () => {
        const view = show(ready);
        expect(view.get("[data-context-estimated]").text()).toContain("54.0k");
        expect(view.text()).toContain("108.0k");
        expect(view.get("[data-context-area='history']").text()).toContain("78%");
    });

    it("缓存：本会话与最近一次；服务商不报缓存时说明，不写 0%", () => {
        const view = show(ready);
        expect(view.get("[data-context-cache]").text()).toContain("81%");
        expect(view.get("[data-context-cache]").text()).toContain("94%");
        const none = show(ready, {cacheHitRate: null, lastCacheHitRate: null});
        expect(none.find("[data-context-cache]").exists()).toBe(false);
        expect(none.find("[data-context-no-cache]").exists()).toBe(true);
    });

    it("算不出时写原因，缓存还在；没放进去的槽写明；诊断计数", () => {
        const unavailable = show({state: "unavailable", reason: "模型用不了"});
        expect(unavailable.get("[data-context-unavailable]").text()).toBe("模型用不了");
        expect(unavailable.find("[data-context-cache]").exists()).toBe(true);
        expect(unavailable.find("[data-context-system]").exists()).toBe(false);
        const view = show(ready);
        expect(view.get("[data-context-slots]").text()).toContain("没放进去");
        expect(view.get("[data-context-diagnostics] summary").text()).toContain("1");
    });

    it("系统提示词展开时才要", async () => {
        const view = show(ready);
        expect(view.emitted("load-system-prompt")).toBeUndefined();
        const details = view.get<HTMLDetailsElement>("[data-context-system]");
        details.element.open = true;
        await vi.waitFor(() => expect(view.emitted("load-system-prompt")).toHaveLength(1));
    });
});
