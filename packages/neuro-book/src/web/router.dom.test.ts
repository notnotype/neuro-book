/**
 * 窗口的页面路由：页面表之外的路径给“页面不存在”；声明了 reloadOnLeave 的页面（Lab）离开时整页加载，同一页面
 * 只改查询参数照常在应用内导航（ui.component-lab 场景 17）。
 */

import {flushPromises, mount} from "@vue/test-utils";
import {describe, expect, it} from "vitest";
import {defineComponent, h} from "vue";
import {RouterView, createMemoryHistory} from "vue-router";

import {createPageRouter} from "./router";

const pageComponent = (name: string) => defineComponent({setup: () => () => h("main", {"data-page": name})});

async function openAt(path: string) {
    const navigations: string[] = [];
    const router = createPageRouter({
        pages: [
            {path: "/", title: "NeuroBook", load: async () => pageComponent("home")},
            {path: "/lab", title: "组件 Lab", reloadOnLeave: true, load: async () => pageComponent("lab")},
        ],
        history: createMemoryHistory(),
        navigateDocument: (href) => navigations.push(href),
    });
    const view = mount(RouterView, {global: {plugins: [router]}});
    await router.push(path);
    await flushPromises();
    return {router, view, navigations};
}

describe("页面路由", () => {
    it("页面表之外的路径显示“页面不存在”并设置标题", async () => {
        const {view} = await openAt("/nope");
        expect(view.find("[data-page-not-found]").exists()).toBe(true);
        expect(view.text()).toContain("/nope");
        expect(document.title).toBe("页面不存在");
    });

    it("进入 Lab 是应用内导航，标题随页面", async () => {
        const {router, view, navigations} = await openAt("/");
        await router.push("/lab");
        await flushPromises();
        expect(view.find("[data-page=lab]").exists()).toBe(true);
        expect(document.title).toBe("组件 Lab");
        expect(navigations).toEqual([]);
    });

    it("离开 Lab 去别的页面时整页加载，当前页面不变", async () => {
        const {router, view, navigations} = await openAt("/lab");
        void router.push("/?from=lab");
        await flushPromises();
        expect(navigations).toEqual(["/?from=lab"]);
        expect(router.currentRoute.value.path).toBe("/lab");
        expect(view.find("[data-page=lab]").exists()).toBe(true);
    });

    it("Lab 只改查询参数时照常导航", async () => {
        const {router, navigations} = await openAt("/lab");
        await router.replace({query: {c: "JsonViewer"}});
        expect(router.currentRoute.value.query).toEqual({c: "JsonViewer"});
        expect(navigations).toEqual([]);
    });
});
