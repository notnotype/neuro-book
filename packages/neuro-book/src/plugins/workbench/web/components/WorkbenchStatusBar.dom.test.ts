/** WorkbenchStatusBar（同名 .md）：项目名、问题提示的优先与可读原因、重试与放弃、面板按钮的文字与落点、界面语言、通知铃铛。 */

import {mount} from "@vue/test-utils";
import {describe, expect, it} from "vitest";

import {provideText} from "nbook/shared/testing/text-port";

import {workbenchTestText} from "../../testing/text";

import WorkbenchStatusBar from "./WorkbenchStatusBar.vue";

describe("WorkbenchStatusBar", () => {
    it("铃铛一直在：没有没看过的时名称“通知”、不带点；有时带点、名称写条数；点了发 open-notifications（notifications.md 输出 17）", async () => {
        const wrapper = mount(WorkbenchStatusBar, {props: {project: "雾港", panelHidden: true}, global: {provide: provideText(workbenchTestText("zh-CN"))}});
        const bell = wrapper.get("[data-status-notifications]");
        expect(bell.attributes("aria-label")).toBe("通知");
        expect(bell.find("[data-status-notifications-dot]").exists()).toBe(false);
        await wrapper.setProps({unreadNotifications: 2});
        expect(bell.attributes("aria-label")).toBe("通知：2 条没看过");
        expect(bell.attributes("title")).toBe("通知：2 条没看过");
        expect(bell.find("[data-status-notifications-dot]").exists()).toBe(true);
        await bell.trigger("click");
        expect(wrapper.emitted("open-notifications")).toHaveLength(1);
        // 铃铛在“显示面板”左边。
        const buttons = wrapper.findAll(".workbench-status-bar__right button");
        expect(buttons.map((button) => button.attributes("data-status-notifications") !== undefined)).toEqual([true, false]);
    });

    it("没有项目时显示“未打开项目”；面板按钮按隐藏与否换文字、带焦点落点，点了发 toggle-panel；不可用时禁用", async () => {
        const wrapper = mount(WorkbenchStatusBar, {props: {project: null, panelHidden: false}, global: {provide: provideText(workbenchTestText("zh-CN"))}});
        expect(wrapper.get("[data-status-project]").text()).toBe("未打开项目");
        const toggle = wrapper.get("[data-shell-focus-target=\"panel-toggle\"]");
        expect(toggle.text()).toBe("隐藏面板");
        await toggle.trigger("click");
        expect(wrapper.emitted("toggle-panel")).toHaveLength(1);
        await wrapper.setProps({panelHidden: true, panelToggleDisabled: true, project: "雾港"});
        expect(toggle.text()).toBe("显示面板");
        expect(toggle.attributes("disabled")).toBeDefined();
        expect(wrapper.get("[data-status-project]").text()).toBe("雾港");
        expect(wrapper.find("[data-status-problem]").exists()).toBe(false);
    });

    it("没保存上的优先于读不到；原因换成可读文字，不认识的码原样；重试与放弃带回记录名；读不到时没有按钮", async () => {
        const wrapper = mount(WorkbenchStatusBar, {props: {project: null, panelHidden: false, problems: [
            {record: "side", kind: "unread", code: "corrupt"},
            {record: "customizations", kind: "unsaved", code: "unavailable"},
        ]}, global: {provide: provideText(workbenchTestText("zh-CN"))}});
        const problem = wrapper.get("[data-status-problem]");
        expect(problem.text()).toBe("布局未保存：存储暂时不可用");
        expect(problem.attributes("role")).toBe("status");
        const buttons = wrapper.findAll("button").filter((button) => ["重试", "放弃"].includes(button.text()));
        await buttons[0]!.trigger("click");
        await buttons[1]!.trigger("click");
        expect(wrapper.emitted("retry")).toEqual([["customizations"]]);
        expect(wrapper.emitted("discard")).toEqual([["customizations"]]);

        await wrapper.setProps({problems: [{record: "side", kind: "unread", code: "weird-code"}]});
        expect(wrapper.get("[data-status-problem]").text()).toBe("布局未读取，正在用默认布局（weird-code）");
        // 读不到时没有重试与放弃：除了铃铛只剩面板按钮。
        expect(wrapper.findAll("button").filter((button) => button.attributes("data-status-notifications") === undefined).map((button) => button.text())).toEqual(["隐藏面板"]);
    });

    it("英文界面", () => {
        const wrapper = mount(WorkbenchStatusBar, {props: {project: null, panelHidden: true, problems: [{record: "side", kind: "unsaved", code: "conflict"}]}, global: {provide: provideText(workbenchTestText("en-US"))}});
        expect(wrapper.text()).toContain("No project open");
        expect(wrapper.text()).toContain("Layout not saved: conflicts with another window");
        expect(wrapper.text()).toContain("Show Panel");
    });
});
