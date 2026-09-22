// @vitest-environment jsdom
import {describe, expect, it, vi} from "vitest";
import {h} from "vue";
import {mount} from "@vue/test-utils";
import WorkbenchContainerSection from "nbook/app/components/workbench/WorkbenchContainerSection.vue";

function mountSection(collapsible: boolean, action: ReturnType<typeof vi.fn>) {
    return mount(WorkbenchContainerSection, {
        props: {
            id: "lab-section",
            title: "工作区信息",
            contextLabel: "只读",
            collapsible,
        },
        slots: {
            default: () => h("p", "内容"),
            actions: () => h("button", {type: "button", "data-testid": "refresh", onClick: action}, "刷新"),
        },
    });
}

describe("WorkbenchContainerSection", () => {
    it("不可折叠时保持静态标题且 actions 可点击", async () => {
        const action = vi.fn();
        const wrapper = mountSection(false, action);
        const header = wrapper.get(".workbench-container-section__header");
        const actionButton = wrapper.get("[data-testid=refresh]");

        expect(header.find("button").exists()).toBe(true);
        expect(header.find("button button").exists()).toBe(false);
        expect(header.attributes("aria-expanded")).toBeUndefined();
        expect(actionButton.attributes("disabled")).toBeUndefined();

        await actionButton.trigger("click");

        expect(action).toHaveBeenCalledTimes(1);
        expect(wrapper.emitted("toggle")).toBeUndefined();
    });

    it("可折叠时 toggle 使用 ARIA，actions 不触发展开收起", async () => {
        const action = vi.fn();
        const wrapper = mountSection(true, action);
        const toggle = wrapper.get(".workbench-container-section__toggle");
        const actionButton = wrapper.get("[data-testid=refresh]");

        expect(toggle.attributes("aria-expanded")).toBe("true");
        expect(toggle.attributes("aria-controls")).toBe("section-body-lab-section");
        expect(toggle.find("button").exists()).toBe(false);

        await toggle.trigger("click");
        expect(toggle.attributes("aria-expanded")).toBe("false");
        expect(wrapper.emitted("toggle")).toEqual([[true]]);

        await actionButton.trigger("click");

        expect(action).toHaveBeenCalledTimes(1);
        expect(wrapper.emitted("toggle")).toHaveLength(1);
    });
});
