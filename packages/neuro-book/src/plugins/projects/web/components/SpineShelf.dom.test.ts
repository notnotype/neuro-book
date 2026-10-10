/** SpineShelf（同名 .md）：列表框语义、键盘移动与打开、移除，点选与两根虚线书脊。 */

import {mount} from "@vue/test-utils";
import {describe, expect, it} from "vitest";

import type {ShelfItem} from "../../shared/shelf";
import SpineShelf from "./SpineShelf.vue";

function item(id: string, title: string): ShelfItem {
    return {
        id, name: id, title, description: null, color: null, path: `/books/${id}`, state: id === "b" ? "running" : "stopped",
        stats: {freshness: "none", computedAt: null, words: 0, files: 0, unreadable: 0, today: null, last: null},
    };
}

const items = [item("a", "长夜行"), item("b", "北方以北"), item("c", "雾中城")];

/** 受控挂载：像父组件一样把 `update:activeId` 写回去。 */
function mountShelf(activeId: string | null) {
    const wrapper = mount(SpineShelf, {
        props: {locale: "zh-CN" as const, items, activeId, "onUpdate:activeId": (id: string) => wrapper.setProps({activeId: id})},
        attachTo: document.body,
    });
    return wrapper;
}

describe("SpineShelf", () => {
    it("书脊是列表框的选项，活动项由 aria-activedescendant 指出；正在打开的书脊有说明", () => {
        const wrapper = mountShelf("b");
        const listbox = wrapper.get("[role=listbox]");
        const options = wrapper.findAll("[role=option]");
        expect(options.map((option) => option.text())).toEqual(["长夜行", "北方以北", "雾中城"]);
        expect(listbox.attributes("aria-activedescendant")).toBe(options[1]!.attributes("id"));
        expect(options[1]!.attributes("aria-selected")).toBe("true");
        expect(options[1]!.find("[aria-label]").attributes("aria-label")).toBe("已在一个窗口里打开");
        wrapper.unmount();
    });

    it("聚焦时没有选中就选第一部；方向键移动并停在两端，Home 与 End 到两端", async () => {
        const wrapper = mountShelf(null);
        const listbox = wrapper.get("[role=listbox]");
        await listbox.trigger("focus");
        expect(wrapper.props("activeId")).toBe("a");
        await listbox.trigger("keydown", {key: "ArrowLeft"});
        expect(wrapper.props("activeId")).toBe("a");
        await listbox.trigger("keydown", {key: "ArrowRight"});
        expect(wrapper.props("activeId")).toBe("b");
        await listbox.trigger("keydown", {key: "End"});
        expect(wrapper.props("activeId")).toBe("c");
        await listbox.trigger("keydown", {key: "ArrowRight"});
        expect(wrapper.props("activeId")).toBe("c");
        await listbox.trigger("keydown", {key: "Home"});
        expect(wrapper.props("activeId")).toBe("a");
        wrapper.unmount();
    });

    it("Enter 打开选中的那部，Delete 请求移出书架；点书脊选中它，双击打开", async () => {
        const wrapper = mountShelf("b");
        const listbox = wrapper.get("[role=listbox]");
        await listbox.trigger("keydown", {key: "Enter"});
        await listbox.trigger("keydown", {key: "Delete"});
        expect(wrapper.emitted("open")).toEqual([["b"]]);
        expect(wrapper.emitted("remove")).toEqual([["b"]]);
        const third = wrapper.findAll("[role=option]")[2]!;
        await third.trigger("click");
        expect(wrapper.props("activeId")).toBe("c");
        expect(document.activeElement).toBe(listbox.element);
        await third.trigger("dblclick");
        expect(wrapper.emitted("open")).toEqual([["b"], ["c"]]);
        wrapper.unmount();
    });

    it("空书架只有两根虚线书脊，各发自己的事件", async () => {
        const wrapper = mount(SpineShelf, {props: {locale: "zh-CN" as const, items: [], activeId: null}});
        expect(wrapper.find("[role=listbox]").exists()).toBe(false);
        await wrapper.get("[data-shelf-create]").trigger("click");
        await wrapper.get("[data-shelf-add]").trigger("click");
        expect(wrapper.emitted("create")).toHaveLength(1);
        expect(wrapper.emitted("add-existing")).toHaveLength(1);
    });
});
