/**
 * PageNotices（同名 .md，docs/specs/canon/author-ui.md 输出 18、42）：三行各写什么、各发什么；作者那一行上指针停着、焦点在里面
 * 时经 `hold` 暂停，离开放开，卸载时放开还没放开的；读屏的 `role="status"` 常在。
 */

import {mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import {canonCatalogs} from "../../text";
import PageNotices from "./PageNotices.vue";

const port = testTextPort("zh-CN", {"nbook.canon": canonCatalogs});
const mounted: Array<{unmount(): void}> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
});
const mountNotices = (props: Record<string, unknown>) => {
    const wrapper = mount(PageNotices, {props, global: {provide: provideText(port)}, attachTo: document.body});
    mounted.push(wrapper);
    return wrapper;
};
const button = (root: ReturnType<typeof mountNotices>, scope: string, name: string) => root.get(scope).findAll("button").find((item) => item.text() === name || item.attributes("aria-label") === name)!;

describe("PageNotices", () => {
    it("没有提示时读屏的 status 也在；作者那一行写标题、给了位置时写“记在某处”，查看详情、还原、关闭各发各的", async () => {
        const wrapper = mountNotices({});
        expect(wrapper.find("[role='status']").exists()).toBe(true);
        expect(wrapper.find("[data-notice-bar]").exists()).toBe(false);
        await wrapper.setProps({notice: {revision: "r1", title: "改外观"}});
        expect(wrapper.get("[data-notice-bar]").text()).toContain("改外观");
        expect(wrapper.find("[data-notice-where]").exists()).toBe(false);
        await wrapper.setProps({notice: {revision: "r1", title: "改外观", where: "第 3 章"}});
        expect(wrapper.get("[data-notice-where]").text()).toBe("记在第 3 章");
        await wrapper.setProps({notice: {revision: "r1", title: "改外观"}});
        await button(wrapper, "[data-notice-bar]", "查看详情").trigger("click");
        await button(wrapper, "[data-notice-bar]", "还原").trigger("click");
        await button(wrapper, "[data-notice-bar]", "关闭").trigger("click");
        expect(wrapper.emitted("receipt")).toEqual([["r1"]]);
        expect(wrapper.emitted("undo")).toEqual([[{revision: "r1", title: "改外观"}]]);
        expect(wrapper.emitted("close")).toHaveLength(1);
    });

    it("Agent 那一行写最近一次的标题与之前的次数；查看详情、还原、看改动记录、关闭各发各的", async () => {
        const wrapper = mountNotices({agent: {revision: "r2", title: "给星瑕加别名", earlier: 2}});
        expect(wrapper.get("[data-agent-notice]").text()).toContain("Agent 改了设定：给星瑕加别名（之前还改了 2 次）");
        for (const name of ["查看详情", "还原", "看改动记录", "关闭"]) await button(wrapper, "[data-agent-notice]", name).trigger("click");
        expect(wrapper.emitted("receipt")).toEqual([["r2"]]);
        expect(wrapper.emitted("undo")).toHaveLength(1);
        expect(wrapper.emitted("revisions")).toHaveLength(1);
        expect(wrapper.emitted("close-agent")).toHaveLength(1);
        await wrapper.setProps({agent: {revision: "r2", title: "给星瑕加别名", earlier: 0}});
        expect(wrapper.get("[data-agent-notice]").text()).not.toContain("之前还改了");
    });

    it("Agent 那一次已还原：同一个按钮写“已还原”、标成不可用，点了不再发出还原", async () => {
        const wrapper = mountNotices({agent: {revision: "r2", title: "建校长", earlier: 0}});
        const undo = wrapper.get("[data-agent-undo]");
        await wrapper.setProps({agent: {revision: "r2", title: "建校长", earlier: 0, undone: true}});
        // 还是那一个元素：还原对话框关闭时焦点回到它。
        expect(wrapper.get("[data-agent-undo]").element).toBe(undo.element);
        expect(undo.text()).toBe("已还原");
        expect(undo.attributes("aria-disabled")).toBe("true");
        await undo.trigger("click");
        expect(wrapper.emitted("undo")).toBeUndefined();
    });

    it("页面自己的写入失败是一行 alert，关掉发 close-error", async () => {
        const wrapper = mountNotices({error: "这个条目被别处改过"});
        expect(wrapper.get("[data-page-error]").attributes("role")).toBe("alert");
        expect(wrapper.get("[data-page-error]").text()).toContain("这个条目被别处改过");
        await button(wrapper, "[data-page-error]", "关闭").trigger("click");
        expect(wrapper.emitted("close-error")).toHaveLength(1);
    });

    it("作者那一行没了（关掉、自己收起）时放开它上面的暂停：摘掉的行收不到指针离开，不放开的话之后的提示都不再自己收起", async () => {
        const events: string[] = [];
        let next = 0;
        const hold = () => {
            const id = ++next;
            events.push(`hold ${String(id)}`);
            return () => void events.push(`release ${String(id)}`);
        };
        const wrapper = mountNotices({notice: {revision: "r1", title: "改外观"}, hold});
        const row = wrapper.get("[data-notice-bar]");
        await row.trigger("pointerenter");
        (row.findAll("button")[0]!.element as HTMLButtonElement).focus();
        await wrapper.setProps({notice: null});
        expect(events).toEqual(["hold 1", "hold 2", "release 1", "release 2"]);
        // 下一条照常：指着时暂停，卸载时放开。
        await wrapper.setProps({notice: {revision: "r2", title: "改年龄"}});
        await wrapper.get("[data-notice-bar]").trigger("pointerenter");
        wrapper.unmount();
        mounted.splice(0);
        expect(events).toEqual(["hold 1", "hold 2", "release 1", "release 2", "hold 3", "release 3"]);
    });

    it("指针停着、焦点在作者那一行里各暂停一次；两样都离开才全部放开，卸载时放开还没放开的", async () => {
        const events: string[] = [];
        let next = 0;
        const hold = () => {
            const id = ++next;
            events.push(`hold ${String(id)}`);
            return () => void events.push(`release ${String(id)}`);
        };
        const wrapper = mountNotices({notice: {revision: "r1", title: "改外观"}, hold});
        const row = wrapper.get("[data-notice-bar]");
        await row.trigger("pointerenter");
        await row.trigger("pointerenter");
        (row.findAll("button")[0]!.element as HTMLButtonElement).focus();
        await row.trigger("pointerleave");
        expect(events).toEqual(["hold 1", "hold 2", "release 1"]);
        // 焦点在行里的两个按钮之间移动不算离开。
        (row.findAll("button")[1]!.element as HTMLButtonElement).focus();
        expect(events).toEqual(["hold 1", "hold 2", "release 1"]);
        wrapper.unmount();
        mounted.splice(0);
        expect(events).toEqual(["hold 1", "hold 2", "release 1", "release 2"]);
    });
});
