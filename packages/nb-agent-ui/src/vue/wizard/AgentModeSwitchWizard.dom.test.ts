import {mount} from "@vue/test-utils";
import {describe, expect, it} from "vitest";

import type {PendingModeSwitchView} from "../../types";
import {EMPTY_WIZARD} from "../../wizard";
import AgentModeSwitchWizard from "./AgentModeSwitchWizard.vue";

const approval = {value: "ask", options: [{key: "ask", label: "每次询问", icon: ""}, {key: "allow-writes", label: "放行写入", icon: ""}]};
const exitPlan: PendingModeSwitchView = {kind: "mode-switch", id: "m", toolCallId: "c", fromLabel: "计划", toLabel: "普通", plan: "# 改第三章", approval};
const plain: PendingModeSwitchView = {kind: "mode-switch", id: "m", toolCallId: "c", fromLabel: "普通", toLabel: "讨论", approval};

const wizard = (item: PendingModeSwitchView, state = EMPTY_WIZARD) => mount(AgentModeSwitchWizard, {props: {item, state}});
const answer = (view: ReturnType<typeof wizard>) => view.emitted("answer")?.at(-1)?.[0];

describe("申请切换模式的向导（agent/modes.md 输出 8–10）", () => {
    it("有计划：显示计划正文；审批模式没改时批准不带它，保持当前", async () => {
        const view = wizard(exitPlan);
        expect(view.get("[data-mode-switch-plan]").text()).toContain("改第三章");
        await view.get("[data-mode-switch-approve]").trigger("click");
        expect(answer(view)).toEqual({approved: true});
    });

    it("有计划：选了别的审批模式，批准时一起交回", async () => {
        const view = wizard(exitPlan, {...EMPTY_WIZARD, modeSwitch: {m: {approvalMode: "allow-writes"}}});
        await view.get("[data-mode-switch-approve]").trigger("click");
        expect(answer(view)).toEqual({approved: true, approvalMode: "allow-writes"});
    });

    it("没有计划：不选审批模式，标题写目标模式", async () => {
        const view = wizard(plain);
        expect(view.find("[data-mode-switch-plan]").exists()).toBe(false);
        expect(view.find("[data-mode-switch-approval]").exists()).toBe(false);
        expect(view.text()).toContain("切到讨论模式？");
    });

    it("写了附言就是不同意：批准不可点，附言随回答交回", async () => {
        const view = wizard(exitPlan, {...EMPTY_WIZARD, notes: {m: " 再想想 "}});
        expect(view.get("[data-mode-switch-approve]").attributes("disabled")).toBeDefined();
        await view.get("[data-mode-switch-decline]").trigger("click");
        expect(answer(view)).toEqual({approved: false, note: "再想想"});
    });
});
