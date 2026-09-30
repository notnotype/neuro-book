// @vitest-environment jsdom
import {mount} from "@vue/test-utils";
import {describe, expect, it} from "vitest";
import {h} from "vue";
import WorkbenchStatusBar from "nbook/app/components/workbench/WorkbenchStatusBar.vue";
import WorkbenchStatusBarItem from "nbook/app/components/workbench/WorkbenchStatusBarItem.vue";

describe("WorkbenchStatusBar", () => {
    it("以 role=status 渲染单根 footer，并透传无障碍标签与属性", () => {
        const wrapper = mount(WorkbenchStatusBar, {
            props: {
                ariaLabel: "测试状态栏",
            },
        });

        const footer = wrapper.find("footer");
        expect(footer.exists()).toBe(true);
        expect(footer.attributes("role")).toBe("status");
        expect(footer.attributes("aria-label")).toBe("测试状态栏");
        expect(footer.attributes("data-workbench-status-bar")).toBeDefined();
    });

    it("正确承载 left 与 right 具名插槽", () => {
        const wrapper = mount(WorkbenchStatusBar, {
            slots: {
                left: () => h("span", {id: "left-item"}, "左侧分支"),
                right: () => h("span", {id: "right-item"}, "右侧光标"),
            },
        });

        const left = wrapper.find(".workbench-status-bar__left");
        const right = wrapper.find(".workbench-status-bar__right");

        expect(left.find("#left-item").text()).toBe("左侧分支");
        expect(right.find("#right-item").text()).toBe("右侧光标");
    });
});

describe("WorkbenchStatusBarItem", () => {
    it("可交互项（clickable=true）渲染为 button 并响应点击", async () => {
        const wrapper = mount(WorkbenchStatusBarItem, {
            props: {
                id: "test-branch",
                label: "main",
                icon: "i-lucide-git-branch",
                badge: 3,
                clickable: true,
                title: "主分支",
            },
        });

        const button = wrapper.find("button");
        expect(button.exists()).toBe(true);
        expect(button.attributes("type")).toBe("button");
        expect(button.attributes("data-status-item-id")).toBe("test-branch");
        expect(button.attributes("title")).toBe("主分支");
        expect(button.text()).toContain("main");
        expect(button.text()).toContain("3");

        await button.trigger("click");
        expect(wrapper.emitted("click")).toHaveLength(1);
    });

    it("只读项（clickable=false）渲染为 span 且不触发点击事件", async () => {
        const wrapper = mount(WorkbenchStatusBarItem, {
            props: {
                id: "test-encoding",
                label: "UTF-8",
                clickable: false,
            },
        });

        expect(wrapper.find("button").exists()).toBe(false);
        const span = wrapper.find("span.workbench-status-bar-item");
        expect(span.exists()).toBe(true);
        expect(span.text()).toBe("UTF-8");

        await span.trigger("click");
        expect(wrapper.emitted("click")).toBeUndefined();
    });

    it("支持语义变体与激活态数据标记", () => {
        const wrapper = mount(WorkbenchStatusBarItem, {
            props: {
                variant: "error",
                active: true,
                badge: 12,
            },
        });

        expect(wrapper.classes()).toContain("workbench-status-bar-item--error");
        expect(wrapper.classes()).toContain("workbench-status-bar-item--active");
        expect(wrapper.attributes("data-status-variant")).toBe("error");
        expect(wrapper.attributes("data-status-active")).toBe("true");
    });
});
