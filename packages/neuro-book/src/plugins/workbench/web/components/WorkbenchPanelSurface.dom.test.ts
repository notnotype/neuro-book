/** WorkbenchPanelSurface（同名 .md）：框架按钮的名称、禁用与提示、点击事件；收起时内容隐藏不卸载。 */

import {mount} from "@vue/test-utils";
import {describe, expect, it} from "vitest";
import {defineComponent, h, onBeforeUnmount} from "vue";

import WorkbenchPanelSurface from "./WorkbenchPanelSurface.vue";

const actions = [
    {id: "position", label: "面板位置", icon: "i-lucide-panel-bottom", disabled: false},
    {id: "collapse", label: "收起为标题头", icon: "i-lucide-chevrons-down", disabled: true, reason: "面板不在底部或顶部"},
    {id: "maximize", label: "最大化/还原面板", icon: "i-lucide-maximize-2", disabled: false, pressed: true},
];

describe("WorkbenchPanelSurface", () => {
    it("按钮带名称；不可用的禁用并以原因作提示、点了不发事件；可用的发 action；切换类带 aria-pressed；标题是焦点落点", async () => {
        const wrapper = mount(WorkbenchPanelSurface, {props: {title: "面板", actions}});
        const button = (id: string) => wrapper.get(`[data-panel-action="${id}"]`);
        expect(button("position").attributes("aria-label")).toBe("面板位置");
        expect(button("collapse").attributes("disabled")).toBeDefined();
        expect(button("collapse").attributes("title")).toBe("面板不在底部或顶部");
        expect(button("collapse").attributes("aria-label")).toBe("收起为标题头");
        expect(button("maximize").attributes("aria-pressed")).toBe("true");
        await button("collapse").trigger("click");
        await button("position").trigger("click");
        expect(wrapper.emitted("action")).toEqual([["position"]]);
        expect(wrapper.get("[data-shell-focus-target=\"panel-title\"]").text()).toBe("面板");
        expect(wrapper.attributes("aria-label")).toBe("面板");
    });

    it("收起时内容区隐藏但不卸载", async () => {
        let unmounted = 0;
        const Content = defineComponent({setup: () => {
            onBeforeUnmount(() => {
                unmounted += 1;
            });
            return () => h("p", "内容");
        }});
        const wrapper = mount(WorkbenchPanelSurface, {props: {title: "面板", collapsed: false}, slots: {default: () => h(Content)}, attachTo: document.body});
        await wrapper.setProps({collapsed: true});
        expect(wrapper.find("p").isVisible()).toBe(false);
        expect(wrapper.attributes("data-panel-collapsed")).toBe("true");
        await wrapper.setProps({collapsed: false});
        expect(wrapper.find("p").isVisible()).toBe(true);
        expect(unmounted).toBe(0);
        wrapper.unmount();
    });
});
