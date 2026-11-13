/**
 * 停靠区（docs/specs/ui/agent-conversation-view.md“输入框与待处理区”）：一次一个、单独提交带会话、没有“全部拒绝”“终止本轮”、
 * 被同步向导压成一条、不移动焦点。
 */
import {mount} from "@vue/test-utils";
import {describe, expect, it} from "vitest";
import {nextTick} from "vue";

import type {PendingApprovalView, PendingInputView} from "../../types";
import AgentDock from "./AgentDock.vue";

const source = {sessionId: "child-1", name: "核对员", icon: "i-lucide-bot"};
const approval = (id: string): PendingApprovalView => ({kind: "approval", id, toolCallId: `c-${id}`, tool: "write", args: {path: `user://${id}.md`}, preview: {state: "ready", files: []}, source});
const asyncQuestion: PendingInputView = {kind: "question", id: "q1", toolCallId: "c-q1", async: true, questions: [{question: "主角叫什么？", options: [{label: "林舟"}, {label: "陈砚"}]}]};
const twoQuestions = (id: string): PendingInputView => ({kind: "question", id, toolCallId: `c-${id}`, async: true, questions: [{question: `${id} 第一题`, options: [{label: "是"}]}, {question: `${id} 第二题`, options: [{label: "否"}]}]});

function dock(items: readonly PendingInputView[], options: {held?: boolean; state?: never} = {}) {
    return mount(AgentDock, {props: {items, ...(options.held === undefined ? {} : {held: options.held}), ...(options.state === undefined ? {} : {state: options.state})}, attachTo: document.body});
}
const actions = (view: ReturnType<typeof dock>) => (view.emitted("action") ?? []).map(([action]) => action as {type: string; batchKey?: string; sessionId?: string; resolutions?: {kind: string; decision?: string}});

describe("AgentDock", () => {
    it("带来源的标题写子代理与它在等什么、图标换成子代理的；批准单独提交并带事项所在的会话；没有全部拒绝", async () => {
        const view = dock([approval("a")]);
        expect(view.get("[data-agent-dock]").text()).toContain("子代理「核对员」");
        expect(view.find(".acv-wizard-frame__icon.i-lucide-bot").exists()).toBe(true);
        expect(view.find("[data-approval-deny-all]").exists()).toBe(false);
        await view.get("[data-approval-decision='allow']").trigger("click");
        expect(actions(view).filter((action) => action.type === "input.submit")).toEqual([{type: "input.submit", batchKey: "a", sessionId: "child-1", resolutions: {kind: "approval", decision: "allow"}}]);
        view.unmount();
    });

    it("几个事项一次一个：第 n / m 个、上一个与下一个；打开子会话发 session.select", async () => {
        const view = dock([approval("a"), approval("b")]);
        expect(view.get("[data-wizard-count]").text()).toBe("第 1 / 2 个");
        expect(view.get("[data-dock-step='previous']").attributes("disabled")).toBeDefined();
        await view.get("[data-dock-step='next']").trigger("click");
        expect(view.get("[data-wizard-count]").text()).toBe("第 2 / 2 个");
        await view.get("[data-dock-open]").trigger("click");
        expect(actions(view)).toContainEqual({type: "session.select", sessionId: "child-1"});
        view.unmount();
    });

    it("看到的那个答完消失后，停在原来的位置；前面的消失时还是它", async () => {
        const view = dock([approval("a"), approval("b"), approval("c")]);
        await view.get("[data-dock-step='next']").trigger("click");
        await view.setProps({items: [approval("b"), approval("c")]});
        expect(view.get("[data-wizard-count]").text()).toBe("第 1 / 2 个");
        expect(view.get("[data-agent-dock]").text()).toContain("b.md");
        view.unmount();
    });

    it("提问事项的题号按事项算：在前一个翻到第二题，换到下一个从第一题开始；标题行写第几个与第几题", async () => {
        const view = dock([twoQuestions("x"), twoQuestions("y")]);
        await view.get("[data-question-step='next']").trigger("click");
        // 受控：宿主经 state 放回，组件里也已记下。
        expect(view.get("[data-wizard-count]").text()).toBe("第 1 / 2 个 · 第 2 / 2 题");
        await view.get("[data-dock-step='next']").trigger("click");
        expect(view.get("[data-agent-dock]").text()).toContain("y 第一题");
        expect(view.get("[data-wizard-count]").text()).toBe("第 2 / 2 个 · 第 1 / 2 题");
        // 前一个答完消失：留在原来的位置，接着的这个也从第一题开始。
        await view.get("[data-question-step='next']").trigger("click");
        await view.setProps({items: [twoQuestions("y"), twoQuestions("z")]});
        expect(view.get("[data-agent-dock]").text()).toContain("y 第二题");
        await view.setProps({items: [twoQuestions("z")]});
        expect(view.get("[data-agent-dock]").text()).toContain("z 第一题");
        view.unmount();
    });

    it("焦点在停靠区里时，翻到下一个、收起、展开之后焦点还在停靠区里", async () => {
        const view = dock([approval("a"), approval("b")]);
        const next = view.get<HTMLElement>("[data-dock-step='next']");
        next.element.focus();
        await next.trigger("click");
        await nextTick();
        // 到了最后一个，“下一个”不可用：焦点换到“上一个”。
        expect(document.activeElement?.getAttribute("data-dock-step")).toBe("previous");
        view.get<HTMLElement>("[data-wizard-collapse]").element.focus();
        await view.get("[data-wizard-collapse]").trigger("click");
        await nextTick();
        expect(document.activeElement?.hasAttribute("data-dock-expand")).toBe(true);
        await view.get("[data-dock-expand]").trigger("click");
        await nextTick();
        expect(document.activeElement?.hasAttribute("data-wizard-collapse")).toBe(true);
        view.unmount();
    });

    it("恢复的状态按位置给出看到的那个；之后前面的事项出现、消失，看到的还是它", async () => {
        const view = dock([approval("a"), approval("b"), approval("c")], {state: {collapsed: false, index: 1, wizard: {step: 0, answers: {}, approvals: {}, notes: {}}} as never});
        expect(view.get("[data-agent-dock]").text()).toContain("b.md");
        await view.setProps({items: [approval("new"), approval("a"), approval("b"), approval("c")]});
        expect(view.get("[data-agent-dock]").text()).toContain("b.md");
        expect(view.get("[data-wizard-count]").text()).toBe("第 3 / 4 个");
        view.unmount();
    });

    it("异步提问没有来源与终止本轮，提交不带会话", async () => {
        const view = dock([asyncQuestion]);
        expect(view.get("[data-agent-dock]").text()).not.toContain("子代理");
        expect(view.find("[data-question-stop]").exists()).toBe(false);
        view.unmount();
    });

    it("同步向导在时收成一条、不能展开；能收起、展开，经 dock.state 交出；出现时不抢焦点", async () => {
        const input = document.createElement("input");
        document.body.append(input);
        input.focus();
        const view = dock([approval("a"), asyncQuestion]);
        expect(document.activeElement).toBe(input);
        await view.get("[data-wizard-collapse]").trigger("click");
        expect(view.get("[data-dock-collapsed]").text()).toContain("2 个待处理");
        expect(view.get("[data-dock-collapsed]").text()).toContain("子代理「核对员」");
        expect(actions(view).filter((action) => action.type === "dock.state").at(-1)).toMatchObject({type: "dock.state"});
        await view.get("[data-dock-expand]").trigger("click");
        expect(view.find("[data-dock-collapsed]").exists()).toBe(false);

        await view.setProps({held: true});
        expect(view.find("[data-dock-collapsed]").exists()).toBe(true);
        expect(view.find("[data-dock-expand]").exists()).toBe(false);
        await view.setProps({held: false});
        expect(view.find("[data-dock-collapsed]").exists()).toBe(false);
        view.unmount();
        input.remove();
    });
});
