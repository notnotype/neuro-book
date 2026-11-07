import {mount} from "@vue/test-utils";
import {describe, expect, it} from "vitest";
import {nextTick} from "vue";

import TabStrip from "./TabStrip.vue";

/** 标签条的进出（同名 .md）：行是 `TransitionGroup`，只为拖动中的位移；进出不等帧。 */

describe("TabStrip", () => {
    it("关掉的标签在这一次渲染里就从 DOM 消失：下一步量标签条不会把它算进去", async () => {
        const items = ["a", "b", "c"].map((id) => ({id, title: id}));
        const wrapper = mount(TabStrip, {props: {items, active: "a", label: "tabs"}});
        expect(wrapper.findAll("[data-panel-tab]")).toHaveLength(3);
        await wrapper.setProps({items: items.slice(0, 2)});
        await nextTick();
        expect(wrapper.findAll("[data-panel-tab]").map((tab) => tab.attributes("data-panel-tab"))).toEqual(["a", "b"]);
        wrapper.unmount();
    });
});
