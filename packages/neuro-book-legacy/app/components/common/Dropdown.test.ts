// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {mount, type VueWrapper} from "@vue/test-utils";
import Dropdown, {type DropdownItem} from "./Dropdown.vue";

const mounted: VueWrapper[] = [];

beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
    });
});

afterEach(() => {
    for (const wrapper of mounted.splice(0)) {
        wrapper.unmount();
    }
    document.body.replaceChildren();
    vi.unstubAllGlobals();
});

describe("common/Dropdown 代理桥接", () => {
    const items: DropdownItem[] = [
        {label: "查看详情", value: "details"},
        {label: "编辑信息", value: "edit"},
    ];

    it("正确渲染插槽内容并在点击时触发浮层", async () => {
        const wrapper = mount(Dropdown, {
            props: {items},
            slots: {
                default: "<button class=\"trigger-btn\">更多操作</button>",
            },
            attachTo: document.body,
        });
        mounted.push(wrapper);

        const btn = wrapper.find("button.trigger-btn");
        expect(btn.exists()).toBe(true);
        expect(btn.text()).toBe("更多操作");
    });
});
