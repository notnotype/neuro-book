/**
 * WorkbenchToolStrip（同名 .md）的入口角标（docs/specs/workbench/views.md 输出 17）：放不下收进“更多”、拖动与指示块要真实布局，在 e2e 里。
 */

import {mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import WorkbenchToolStrip from "./WorkbenchToolStrip.vue";
import type {ToolStripEntry} from "./WorkbenchToolStrip.vue";

const entry = (id: string, label: string, count?: number): ToolStripEntry => ({id, label, icon: "i-lucide-square", tooltip: label, viewId: null, current: false, pressed: false, ...(count === undefined ? {} : {count})});

afterEach(() => {
    document.body.innerHTML = "";
});

describe("WorkbenchToolStrip", () => {
    it("入口有计数时图标右上角画角标、读屏名称是“标题 数”；没有计数不画；超过 99 写 99+", () => {
        const wrapper = mount(WorkbenchToolStrip, {props: {label: "活动栏", moreLabel: "更多", entries: [entry("view:bot", "bot", 3), entry("view:files", "文件"), entry("view:mail", "消息", 100)]}, attachTo: document.body});
        expect(wrapper.findAll("[data-tool-entry]").map((button) => button.attributes("aria-label"))).toEqual(["bot 3", "文件", "消息 99+"]);
        expect(wrapper.findAll("[data-tool-count]").map((badge) => [badge.attributes("data-tool-count"), badge.text(), badge.attributes("aria-hidden")])).toEqual([["view:bot", "3", "true"], ["view:mail", "99+", "true"]]);
    });

    it("入口带稳定名 workbench.container 与容器 id，活动栏项带 workbench.activity 与项 id（agent/page-agent.md 输出 6）", () => {
        const items = [
            {id: "acme.settings", title: "设置", icon: "i-lucide-settings", interactive: true, pressed: null, disabledReason: null},
            {id: "acme.profile", title: "个人资料", icon: "i-lucide-user", interactive: false, pressed: null, disabledReason: null},
        ];
        const wrapper = mount(WorkbenchToolStrip, {props: {label: "活动栏", moreLabel: "更多", entries: [entry("acme.project", "项目")], items}, attachTo: document.body});
        const named = (selector: string) => wrapper.findAll(selector).map((element) => [element.attributes("data-nb-target"), element.attributes("data-nb-key")]);
        expect(named("[data-tool-entry]")).toEqual([["workbench.container", "acme.project"]]);
        expect(named("[data-activity-item]")).toEqual([["workbench.activity", "acme.settings"], ["workbench.activity", "acme.profile"]]);
    });
});
