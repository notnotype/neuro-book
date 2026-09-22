// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {flushPromises, mount} from "@vue/test-utils";
import {nextTick} from "vue";
import WorkbenchTitleActions from "nbook/app/components/workbench/WorkbenchTitleActions.vue";
import type {WorkbenchTitleActionItem} from "nbook/app/utils/workbench/view-title-actions";

/**
 * 标题操作部件的受控面：数据属性（浏览器 smoke 的唯一定位依据）、禁用项仍然渲染、
 * 点击只回传 id、上下文指纹变化会关掉已打开的菜单。
 *
 * 菜单内部的键盘漫游与勾选态归 nb-ui `Dropdown` 的原语，在它的行为测试里覆盖。
 */

const mounted: ReturnType<typeof mount>[] = [];

function mountActions(options: {
    primary?: readonly WorkbenchTitleActionItem[];
    secondary?: readonly WorkbenchTitleActionItem[];
    contextKey?: string;
    scope?: "view" | "panel";
    moreFirst?: boolean;
} = {}) {
    const wrapper = mount(WorkbenchTitleActions, {
        props: {
            primary: options.primary ?? [{id: "refresh", label: "刷新", icon: "i-lucide-refresh-cw"}],
            secondary: options.secondary ?? [],
            contextKey: options.contextKey ?? "k1",
            label: "视图操作",
            ...(options.scope === undefined ? {} : {scope: options.scope}),
            ...(options.moreFirst === undefined ? {} : {moreFirst: options.moreFirst}),
        },
    });
    mounted.push(wrapper);
    return wrapper;
}

function menuItems(): HTMLElement[] {
    return [...document.body.querySelectorAll<HTMLElement>("[role=\"menuitem\"]")];
}

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

describe("WorkbenchTitleActions", () => {
    it("数据属性：根标记用途，按钮带自己的 id，更多触发器是 more", async () => {
        const wrapper = mountActions({
            primary: [{id: "refresh", label: "刷新", icon: "i-lucide-refresh-cw"}],
            secondary: [{id: "demo", label: "示例", icon: "i-lucide-wand-2"}],
        });

        expect(wrapper.attributes("data-title-actions")).toBe("view");
        expect(wrapper.find("[data-title-action=\"refresh\"]").exists()).toBe(true);
        expect(wrapper.find("[data-title-action=\"more\"]").exists()).toBe(true);
        expect(wrapper.find("[data-title-action=\"more\"]").attributes("aria-label")).toContain("视图操作");

        await wrapper.setProps({scope: "panel"});
        expect(wrapper.attributes("data-title-actions")).toBe("panel");
    });

    it("没有动作也没有更多项时不给触发器，根仍在（attrs 有落点）", () => {
        const wrapper = mountActions({primary: [], secondary: []});

        expect(wrapper.find("[data-title-action]").exists()).toBe(false);
        expect(wrapper.attributes("data-title-actions")).toBe("view");
    });

    it("点击只回传 id：组件不执行命令、不认识 commandId", async () => {
        const wrapper = mountActions();

        await wrapper.find("[data-title-action=\"refresh\"]").trigger("click");

        expect(wrapper.emitted("invoke")).toEqual([["refresh"]]);
    });
    it("Alt 只切换图标按钮，不切换菜单项", async () => {
        const wrapper = mountActions({
            primary: [{
                id: "split",
                label: "水平分屏",
                icon: "i-lucide-columns-2",
                alternate: {modifier: "alt", id: "editor.split-vertical", label: "竖直分屏", icon: "i-lucide-rows-2"},
            }],
            secondary: [{id: "rename", label: "重命名"}],
        });
        window.dispatchEvent(new KeyboardEvent("keydown", {altKey: true}));
        await nextTick();
        await wrapper.find("[data-title-action=\"editor.split-vertical\"]").trigger("click");
        window.dispatchEvent(new KeyboardEvent("keyup", {altKey: false}));
        await nextTick();
        await wrapper.find("[data-title-action=\"split\"]").trigger("click");
        await wrapper.find("[data-title-action=\"more\"]").trigger("click");
        await flushPromises();
        menuItems().find((item) => item.textContent?.includes("重命名"))?.click();
        expect(wrapper.emitted("invoke")).toEqual([["editor.split-vertical"], ["split"], ["rename"]]);
    });

    it("禁用项仍然渲染：disabled + aria-disabled + 原因在 title / aria-label 里，点了不发事件", async () => {
        const wrapper = mountActions({
            primary: [{
                id: "maximize",
                label: "最大化面板",
                icon: "i-lucide-maximize-2",
                disabled: true,
                reason: "居中对齐后可最大化",
            }],
        });

        const button = wrapper.find("[data-title-action=\"maximize\"]");
        expect(button.exists()).toBe(true);
        expect(button.attributes("disabled")).toBeDefined();
        expect(button.attributes("aria-disabled")).toBe("true");
        expect(button.attributes("title")).toBe("最大化面板（居中对齐后可最大化）");

        await button.trigger("click");
        expect(wrapper.emitted("invoke")).toBeUndefined();
    });

    it("更多菜单里的禁用项也带原因；可点项回传 id", async () => {
        const wrapper = mountActions({
            primary: [],
            secondary: [
                {id: "open", label: "打开", icon: "i-lucide-folder-open"},
                {id: "locked", label: "锁定", icon: "i-lucide-lock", disabled: true, reason: "只读视图"},
            ],
        });

        await wrapper.find("[data-title-action=\"more\"]").trigger("click");
        await flushPromises();
        await nextTick();

        const items = menuItems();
        expect(items.map((item) => item.textContent?.trim())).toEqual(["打开", "锁定（只读视图）"]);

        items[0]!.click();
        await flushPromises();
        await nextTick();
        expect(wrapper.emitted("invoke")).toEqual([["open"]]);
    });

    it("contextKey 变化关掉已经打开的菜单（受控 open）", async () => {
        const wrapper = mountActions({
            primary: [],
            secondary: [{id: "open", label: "打开", icon: "i-lucide-folder-open"}],
        });

        await wrapper.find("[data-title-action=\"more\"]").trigger("click");
        await flushPromises();
        await nextTick();
        expect(menuItems()).toHaveLength(1);

        await wrapper.setProps({contextKey: "k2"});
        await flushPromises();
        await nextTick();

        expect(menuItems()).toHaveLength(0);
    });

    it("宽度未知（jsdom 里没有布局）时不折叠：按钮一个都不藏", () => {
        const wrapper = mountActions({
            primary: [1, 2, 3, 4, 5].map((index) => ({id: `a${index}`, label: `动作 ${index}`, icon: "i-lucide-star"})),
        });

        expect(wrapper.findAll("[data-title-action]").map((button) => button.attributes("data-title-action")))
            .toEqual(["a1", "a2", "a3", "a4", "a5"]);
    });
});
