/** Menubar（同名 .md）的手工级联：键盘展开子菜单后焦点进它的第一项，上下移动，左方向键收起回到展开它的那一项。 */
import {mount, type VueWrapper} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";
import {nextTick} from "vue";

import Menubar from "./Menubar.vue";

async function flush(times = 8): Promise<void> {
    for (let index = 0; index < times; index += 1) await nextTick();
}

const MENUS = [
    {id: "file", label: "文件", items: [
        {label: "新建", id: "new"},
        {label: "导出", id: "export", children: [{label: "Markdown", id: "md"}, {label: "EPUB", id: "epub"}]},
    ]},
    {id: "edit", label: "编辑", items: [{label: "撤销", id: "undo"}]},
];

const press = async (key: string): Promise<void> => {
    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", {key, bubbles: true, cancelable: true}));
    await flush();
};
const focused = (): string | undefined => document.activeElement?.textContent?.trim();

describe("Menubar 级联键盘", () => {
    const wrappers: VueWrapper[] = [];
    afterEach(() => {
        for (const wrapper of wrappers.splice(0)) wrapper.unmount();
    });

    it("右方向键展开子菜单并聚焦它的第一项；上下移动；左方向键收起回到父项", async () => {
        const wrapper = mount(Menubar, {attachTo: document.body, props: {menus: MENUS, modelValue: "file"}});
        wrappers.push(wrapper);
        await flush();
        const parent = document.querySelector<HTMLElement>("[data-menubar-level='file'] [aria-haspopup=menu]")!;
        expect(parent.textContent?.trim()).toBe("导出");
        parent.focus();
        await press("ArrowRight");
        expect(focused()).toBe("Markdown");
        // reka 的一级把右方向键当成切到下一组：展开子菜单的这一下不能让它切走。
        expect(wrapper.emitted("update:modelValue")).toBeUndefined();
        await press("ArrowDown");
        expect(focused()).toBe("EPUB");
        await press("ArrowDown");
        expect(focused()).toBe("Markdown");
        await press("ArrowLeft");
        expect(document.activeElement).toBe(parent);
        expect(document.querySelectorAll(".nb-menu-level")).toHaveLength(0);
    });
});
