/**
 * FilesExplorerView 与 ExplorerFeedback（同名 .md）：工具栏的动作与可用性、显示清单文件的按下状态、未打开项目与停止
 * 同步的提示、偏好记录的三种问题、结果区的提示与关闭、英文界面。行数据由真实的投影算出。
 */

import {mount} from "@vue/test-utils";
import {describe, expect, it} from "vitest";

import type {RootState} from "../tree/model";
import {projectRows} from "../tree/rows";
import FilesExplorerView from "./FilesExplorerView.vue";

const rows = (roots: RootState[]) => projectRows({roots, slots: new Map(), expanded: new Set(), showManifests: false});

const LIVE: RootState[] = [
    {scheme: "project", address: "project://", status: {kind: "live"}},
    {scheme: "user", address: "user://", status: {kind: "live"}},
];

function view(props: Record<string, unknown> = {}) {
    return mount(FilesExplorerView, {props: {locale: "zh-CN", rows: rows(LIVE), selected: [], focus: null, showManifests: false, ready: true, notice: null, problem: null, handleKey: () => "none" as const, ...props}});
}

describe("FilesExplorerView", () => {
    it("工具栏发出动作；显示清单文件是切换按钮；还没就绪时按钮禁用、树换成加载中", async () => {
        const wrapper = view({showManifests: true});
        for (const action of ["refresh", "collapse-all", "toggle-manifests"]) await wrapper.get(`[data-explorer-tool="${action}"]`).trigger("click");
        expect(wrapper.emitted("toolbar")).toEqual([["refresh"], ["collapse-all"], ["toggle-manifests"]]);
        expect(wrapper.get("[data-explorer-tool=\"toggle-manifests\"]").attributes("aria-pressed")).toBe("true");
        expect(wrapper.get("[data-explorer-tool=\"refresh\"]").attributes("aria-pressed")).toBeUndefined();
        await wrapper.setProps({ready: false});
        expect(wrapper.get("[data-explorer-tool=\"refresh\"]").attributes("disabled")).toBeDefined();
        expect(wrapper.find("[role=tree]").exists()).toBe(false);
        expect(wrapper.get("[data-explorer-loading]").text()).toBe("正在读取…");
    });

    it("没有绑定项目：提示与“打开项目”；某个根停止同步：原因与“重新连接”", async () => {
        const wrapper = view({rows: rows([{scheme: "project", address: "project://", status: {kind: "unbound"}}, {scheme: "user", address: "user://", status: {kind: "ended", reason: "provider-stopped"}}])});
        expect(wrapper.get("[data-explorer-unbound]").text()).toContain("尚未打开项目");
        await wrapper.get("[data-explorer-unbound] button").trigger("click");
        expect(wrapper.emitted("open-project")).toHaveLength(1);
        const ended = wrapper.get("[data-explorer-ended=\"user\"]");
        expect(ended.text()).toContain("已停止同步：provider-stopped");
        await ended.get("button").trigger("click");
        expect(wrapper.emitted("reconnect")).toEqual([["user"]]);
        expect(wrapper.get("[data-explorer-row=\"project://\"]").text()).toContain("尚未打开项目");
    });

    it("偏好记录：读不到给“重新读取”；没保存上给重试与放弃；损坏或版本不认识只说明", async () => {
        const wrapper = view({problem: {kind: "unread", code: "unavailable"}});
        expect(wrapper.get("[data-explorer-problem]").text()).toContain("资源管理器偏好未读取，正在用缺省值（unavailable）");
        expect(wrapper.findAll("[data-explorer-problem] button").map((button) => button.text())).toEqual(["重新读取"]);
        await wrapper.get("[data-explorer-problem] button").trigger("click");
        await wrapper.setProps({problem: {kind: "unsaved", code: "conflict"}});
        const buttons = wrapper.findAll("[data-explorer-problem] button");
        expect(buttons.map((button) => button.text())).toEqual(["重试", "放弃"]);
        await buttons[0]?.trigger("click");
        await buttons[1]?.trigger("click");
        expect(wrapper.emitted("prefs-retry")).toHaveLength(2);
        expect(wrapper.emitted("prefs-discard")).toHaveLength(1);
        await wrapper.setProps({problem: {kind: "protected", code: "corrupt"}});
        expect(wrapper.findAll("[data-explorer-problem] button")).toEqual([]);
    });

    it("结果区：有提示才出现，关闭发出 dismiss-notice；英文界面", async () => {
        const wrapper = view();
        expect(wrapper.find("[data-explorer-feedback]").exists()).toBe(false);
        await wrapper.setProps({notice: {kind: "editor-missing", address: "project://a.md"}});
        expect(wrapper.get("[data-explorer-feedback] [role=status]").text()).toBe("编辑器尚未接入，不能打开 project://a.md");
        await wrapper.get("[data-explorer-feedback] button").trigger("click");
        expect(wrapper.emitted("dismiss-notice")).toHaveLength(1);
        await wrapper.setProps({locale: "en-US", notice: {kind: "open-failed", address: "project://a.md", reason: "boom"}});
        expect(wrapper.get("[data-explorer-feedback]").text()).toContain("Could not open project://a.md: boom");
        expect(wrapper.get("[data-explorer-row=\"user://\"]").text()).toContain("User Assets");
    });
});
