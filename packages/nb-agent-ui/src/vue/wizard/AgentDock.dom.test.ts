/**
 * 停靠区（docs/specs/ui/agent-conversation-view.md“输入框与待处理区”）：一次一个、单独提交带会话、没有“全部拒绝”“终止本轮”、
 * 被同步向导压成一条、不移动焦点。
 */
import {mount} from "@vue/test-utils";
import {describe, expect, it} from "vitest";

import type {PendingApprovalView, PendingInputView} from "../../types";
import AgentDock from "./AgentDock.vue";

const source = {sessionId: "child-1", name: "核对员", icon: "i-lucide-bot"};
const approval = (id: string): PendingApprovalView => ({kind: "approval", id, toolCallId: `c-${id}`, tool: "write", args: {path: `user://${id}.md`}, preview: {state: "ready", files: []}, source});
const asyncQuestion: PendingInputView = {kind: "question", id: "q1", toolCallId: "c-q1", async: true, questions: [{question: "主角叫什么？", options: [{label: "林舟"}, {label: "陈砚"}]}]};

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
