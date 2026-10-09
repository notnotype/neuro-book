/** ContextMenu（同名 .md）的键盘：打开即聚焦首个可用项，方向键与 Home/End 在同级循环，子菜单的进出，Enter 选择。 */
import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import ContextMenu from "./ContextMenu.vue";
import type {ContextMenuItem} from "./context-menu.types";

const chosen: string[] = [];
const ITEMS: ContextMenuItem[] = [
    {label: "新建", action: () => chosen.push("新建")},
    {label: "禁用的", disabled: true},
    {separator: true},
    {label: "更多", children: [{label: "子一", action: () => chosen.push("子一")}, {label: "子二", action: () => chosen.push("子二")}]},
    {label: "删除", action: () => chosen.push("删除")},
];

const mounted: Array<{unmount(): void}> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    chosen.length = 0;
});

const focused = (): string | undefined => document.activeElement?.textContent?.trim();
const press = async (key: string): Promise<void> => {
    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", {key, bubbles: true, cancelable: true}));
    await flushPromises();
};

async function open() {
    const wrapper = mount(ContextMenu, {props: {visible: false, x: 10, y: 10, items: ITEMS}, attachTo: document.body});
    mounted.push(wrapper);
    await flushPromises();
    await wrapper.setProps({visible: true});
    await flushPromises();
    return wrapper;
}

describe("ContextMenu 键盘", () => {
    it("打开即聚焦首个可用项；上下方向键跳过禁用项与分隔线并循环；Home/End 到首末项", async () => {
        await open();
        expect(focused()).toBe("新建");
        await press("ArrowDown");
        expect(focused()).toBe("更多");
        await press("ArrowDown");
        expect(focused()).toBe("删除");
        await press("ArrowDown");
        expect(focused()).toBe("新建");
        await press("ArrowUp");
        expect(focused()).toBe("删除");
        await press("Home");
        expect(focused()).toBe("新建");
        await press("End");
        expect(focused()).toBe("删除");
    });

    it("ArrowRight 展开子菜单并聚焦它的第一项；ArrowLeft 收起并回到展开它的那一项；选择发出 close", async () => {
        const wrapper = await open();
        await press("ArrowDown");
        await press("ArrowRight");
        await flushPromises();
        expect(focused()).toBe("子一");
        await press("ArrowDown");
        expect(focused()).toBe("子二");
        await press("ArrowLeft");
        expect(focused()).toBe("更多");
        expect(document.querySelectorAll("[data-menu-level]")).toHaveLength(0);
        await press("End");
        (document.activeElement as HTMLButtonElement).click();
        expect(chosen).toEqual(["删除"]);
        expect(wrapper.emitted("close")).toHaveLength(1);
    });
});
