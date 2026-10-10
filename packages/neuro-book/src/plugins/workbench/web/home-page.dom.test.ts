/**
 * 工作台的两个内置页面（docs/specs/ui/workbench-shell.md 输出 36–37）：`/` 在没有项目且有首页贡献时渲染贡献的组件，
 * 其余情形渲染外壳；加载失败退回外壳并记诊断；提供者换了之后迟到的结果不用；`/workbench` 从不用首页贡献。
 */

import {flushPromises, mount} from "@vue/test-utils";
import {describe, expect, it} from "vitest";
import {defineComponent, h, shallowRef} from "vue";
import type {Component} from "vue";

import {createWorkbenchPages} from "./home-page";
import type {HomeProvider} from "./home-slot";

const Shell = defineComponent({name: "ShellMarker", render: () => h("div", {"data-test-shell": ""})});
const Home = defineComponent({name: "HomeMarker", render: () => h("div", {"data-test-home": ""})});
const OtherHome = defineComponent({name: "OtherHomeMarker", render: () => h("div", {"data-test-other-home": ""})});

function world(projectName: string | null = null) {
    const current = shallowRef<HomeProvider | null>(null);
    const reports: string[] = [];
    const pages = createWorkbenchPages({
        renderDocument: () => h("span", {"data-test-document": ""}),
        renderShell: () => h(Shell),
        renderCommandHost: () => h("span", {"data-test-commands": ""}),
        projectName,
        home: {current},
        reportHome: (message) => reports.push(message),
    });
    return {current, reports, pages};
}

const immediate = (id: string, component: Component): HomeProvider => ({id, load: async () => component});

describe("工作台页面与首页贡献", () => {
    it("没有首页贡献时渲染外壳；文档根与命令宿主都在", () => {
        const {pages} = world();
        const wrapper = mount(pages.home);
        expect(wrapper.find("[data-test-shell]").exists()).toBe(true);
        expect(wrapper.find("[data-test-document]").exists()).toBe(true);
        expect(wrapper.find("[data-test-commands]").exists()).toBe(true);
        expect(wrapper.attributes("data-workbench-home")).toBeUndefined();
    });

    it("有首页贡献时加载期间不画外壳，加载完渲染贡献的组件；撤回后回到外壳", async () => {
        const {current, pages} = world();
        current.value = immediate("test.shelf.home", Home);
        const wrapper = mount(pages.home);
        expect(wrapper.find("[data-test-shell]").exists()).toBe(false);
        await flushPromises();
        expect(wrapper.find("[data-test-home]").exists()).toBe(true);
        expect(wrapper.attributes("data-workbench-home")).toBe("test.shelf.home");
        current.value = null;
        await flushPromises();
        expect(wrapper.find("[data-test-home]").exists()).toBe(false);
        expect(wrapper.find("[data-test-shell]").exists()).toBe(true);
    });

    it("加载失败时退回外壳并记诊断", async () => {
        const {current, reports, pages} = world();
        current.value = {id: "test.broken.home", load: async () => {
            throw new Error("组件没找到");
        }};
        const wrapper = mount(pages.home);
        await flushPromises();
        expect(wrapper.find("[data-test-shell]").exists()).toBe(true);
        expect(wrapper.attributes("data-workbench-home")).toBeUndefined();
        expect(reports).toEqual(["首页 test.broken.home 加载失败，退回空工作台：组件没找到"]);
    });

    it("提供者换了之后，旧提供者迟到的结果不用", async () => {
        const {current, pages} = world();
        const first: {resolve: ((component: Component) => void) | null} = {resolve: null};
        current.value = {id: "test.first.home", load: () => new Promise<Component>((resolve) => {
            first.resolve = resolve;
        })};
        const wrapper = mount(pages.home);
        await flushPromises();
        current.value = immediate("test.second.home", OtherHome);
        await flushPromises();
        expect(wrapper.find("[data-test-other-home]").exists()).toBe(true);
        first.resolve?.(Home);
        await flushPromises();
        expect(wrapper.find("[data-test-home]").exists()).toBe(false);
        expect(wrapper.find("[data-test-other-home]").exists()).toBe(true);
    });

    it("/workbench 不用首页贡献；绑定了项目的窗口也不用", async () => {
        const {current, pages} = world();
        current.value = immediate("test.shelf.home", Home);
        const workbench = mount(pages.workbench);
        await flushPromises();
        expect(workbench.find("[data-test-shell]").exists()).toBe(true);
        expect(workbench.find("[data-test-home]").exists()).toBe(false);

        const bound = world("novel");
        bound.current.value = immediate("test.shelf.home", Home);
        const page = mount(bound.pages.home);
        await flushPromises();
        expect(page.find("[data-test-shell]").exists()).toBe(true);
        expect(page.attributes("data-workbench-project")).toBe("novel");
    });
});
