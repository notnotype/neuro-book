/**
 * TitleActions（同名 .md）：按钮点了发 run（key）；“⋯”按节列出、勾选项与禁用原因；打开着的“⋯”在身份变化时关闭、之前的
 * 选择不执行。
 */
import {mount} from "@vue/test-utils";
import type {VueWrapper} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";
import {nextTick} from "vue";

import TitleActions from "./TitleActions.vue";

const wrappers: VueWrapper[] = [];
afterEach(() => {
    for (const wrapper of wrappers.splice(0)) wrapper.unmount();
});

async function flush(times = 8): Promise<void> {
    for (let index = 0; index < times; index += 1) await nextTick();
}

describe("TitleActions", () => {
    const entry = (key: string, title: string, extra: {disabledReason?: string; pressed?: boolean; icon?: string | null} = {}) => ({key, command: `test.${key}`, title, icon: extra.icon === undefined ? "i-lucide-square" : extra.icon, disabledReason: extra.disabledReason ?? null, ...(extra.pressed === undefined ? {} : {pressed: extra.pressed})});
    const model = {
        buttons: [entry("own:0", "刷新")],
        menu: [[entry("own:1", "显示隐藏文件", {pressed: true, icon: null})], [entry("acme.export", "导出", {disabledReason: "没有选中的章节"}), entry("acme.copy", "复制路径")]],
    };
    const props = {model, identity: "a|view:a|single|published|1", moreLabel: "更多操作"};
    const all = (): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>("[role^=menuitem]"));

    async function openMore(wrapper: VueWrapper): Promise<void> {
        const trigger = wrapper.get("[data-title-actions-more]");
        (trigger.element as HTMLButtonElement).focus();
        await trigger.trigger("keydown", {key: "ArrowDown"});
        await flush();
    }

    it("按钮点了发 run（key）；“⋯”按节列出、节间一条分隔线，勾选项带 aria-checked，禁用项带原因；选中发 run", async () => {
        const wrapper = mount(TitleActions, {props, attachTo: document.body});
        wrappers.push(wrapper);
        await wrapper.get('[data-title-action-key="own:0"]').trigger("click");
        expect(wrapper.emitted("run")).toEqual([["own:0"]]);
        expect(wrapper.get("[data-title-actions-more]").attributes("aria-label")).toBe("更多操作");
        await openMore(wrapper);
        expect(all().map((item) => [item.textContent?.trim(), item.getAttribute("role"), item.getAttribute("aria-checked"), item.getAttribute("aria-disabled")])).toEqual([
            ["显示隐藏文件", "menuitemcheckbox", "true", null],
            ["导出", "menuitem", null, "true"],
            ["复制路径", "menuitem", null, null],
        ]);
        expect(document.querySelectorAll("[role=separator]").length).toBe(1);
        all().find((item) => item.textContent?.trim() === "复制路径")!.click();
        await flush();
        expect(wrapper.emitted("run")?.[1]).toEqual(["acme.copy"]);
    });

    it("画成按钮的动作带稳定名 command 与命令 id（agent/page-agent.md 输出 6）", () => {
        const wrapper = mount(TitleActions, {props, attachTo: document.body});
        wrappers.push(wrapper);
        const button = wrapper.get('[data-title-action-key="own:0"]');
        expect([button.attributes("data-nb-target"), button.attributes("data-nb-key")]).toEqual(["command", "test.own:0"]);
    });

    it("“⋯”开着时身份变了：菜单关闭，之前的选择不执行；没有菜单项时不画“⋯”", async () => {
        const wrapper = mount(TitleActions, {props, attachTo: document.body});
        wrappers.push(wrapper);
        await openMore(wrapper);
        expect(all().length).toBe(3);
        await wrapper.setProps({identity: "a|view:a|single|published|2"});
        await flush();
        expect(all()).toEqual([]);
        expect(wrapper.emitted("run")).toBeUndefined();
        await wrapper.setProps({model: {buttons: model.buttons, menu: []}});
        expect(wrapper.find("[data-title-actions-more]").exists()).toBe(false);
    });

    it("有 badge 的按钮在图标后面画数字、带 badged 样式；收进“⋯”的项不画数字（视图标题不受影响）", async () => {
        const badged = {...entry("own:comments", "显示或隐藏批注页边", {pressed: true}), badge: "12"};
        const wrapper = mount(TitleActions, {props: {model: {buttons: [entry("own:0", "刷新"), badged], menu: [[{...badged, key: "own:menu-comments"}]]}, identity: "a", moreLabel: "更多操作"}, attachTo: document.body});
        wrappers.push(wrapper);
        const button = wrapper.get('[data-title-action-key="own:comments"]');
        expect(button.text()).toBe("12");
        expect(button.classes()).toContain("title-actions__badged");
        expect(button.attributes("aria-pressed")).toBe("true");
        expect(wrapper.get('[data-title-action-key="own:0"]').text()).toBe("");
        expect(wrapper.get('[data-title-action-key="own:0"]').classes()).not.toContain("title-actions__badged");
        await openMore(wrapper);
        expect(all().map((item) => item.textContent?.trim())).toEqual(["显示或隐藏批注页边"]);
    });
});
