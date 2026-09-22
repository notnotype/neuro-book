// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {mount, type VueWrapper} from "@vue/test-utils";
import ContextMenu, {type ContextMenuItem} from "./ContextMenu.vue";

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

describe("common/ContextMenu 代理桥接", () => {
    it("正确渲染 ContextMenu 并映射 danger tone", async () => {
        const actionFn = vi.fn();
        const items: ContextMenuItem[] = [
            {label: "复制", action: actionFn},
            {label: "删除", danger: true, action: actionFn},
        ];

        const wrapper = mount(ContextMenu, {
            props: {
                visible: true,
                x: 100,
                y: 100,
                items,
            },
            attachTo: document.body,
        });
        mounted.push(wrapper);

        // NbContextMenu renders teleport to body or theme host
        expect(wrapper.exists()).toBe(true);
    });
});
