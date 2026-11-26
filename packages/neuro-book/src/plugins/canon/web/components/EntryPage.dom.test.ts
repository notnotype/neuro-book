/**
 * EntryPage（同名 .md，docs/specs/canon/author-ui.md 输出 6 到 9、27、38）：页头、时间点、分页与插槽；四种状态；未出场、选过的章
 * 不在了的标记、断开的横幅；交互发出的事件。
 */

import {mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import {canonCatalogs} from "../text";
import {ContextMenu, DropdownMenu} from "@notnotype/nb-ui/components";

import EntryPage from "./EntryPage.vue";

const port = testTextPort("zh-CN", {"nbook.canon": canonCatalogs});
const mounted: Array<{unmount(): void}> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

const base = {
    status: "normal" as const,
    name: "哥哥",
    summary: "星瑕的另一个身份",
    sameAs: {id: "e1", name: "星瑕"},
    chapters: [{chapter: "1", index: 1, title: null, start: "1:start", end: "1:end"}],
    position: "1:end",
    tabs: [{value: "text", label: "文字", iconClass: "i-lucide-file-text", segment: "own" as const}, {value: "plot", label: "情节", iconClass: "i-lucide-git-commit-horizontal", segment: "view" as const, count: 2}],
    tab: "text",
};

function page(props: Record<string, unknown> = {}) {
    const wrapper = mount(EntryPage, {props: {...base, ...props}, slots: {default: "<p data-content>分页内容</p>"}, global: {provide: provideText(port)}, attachTo: document.body});
    mounted.push(wrapper);
    return wrapper;
}

describe("EntryPage", () => {
    it("页头是名字、“是谁”、简介与时间点，下面是分页与内容；点“是谁”的链接发 open-entry，切分页发 update:tab", async () => {
        const wrapper = page();
        expect(wrapper.get("h1").text()).toBe("哥哥");
        expect(wrapper.text()).toContain("是谁：星瑕");
        expect(wrapper.text()).toContain("星瑕的另一个身份");
        expect(wrapper.get("[data-view-point]").text()).toContain("第 1 章末尾");
        expect(wrapper.findAll("[role='tab']").map((tab) => tab.text().replace(/\s+/gu, ""))).toEqual(["文字", "情节2"]);
        expect(wrapper.get("[role='tabpanel'] [data-content]").text()).toBe("分页内容");
        await wrapper.findAll("header button").find((button) => button.text() === "星瑕")!.trigger("click");
        expect(wrapper.emitted("open-entry")).toEqual([["e1"]]);
        await wrapper.findAll("[role='tab']")[1]!.trigger("click");
        expect(wrapper.emitted("update:tab")).toEqual([["plot"]]);
        expect(wrapper.find("button[aria-label='更多']").exists()).toBe(true);
    });

    it("换分页时内容换成新的一页，过渡的方向跟着列表里的先后：往后切从后方进来，往前切从前方（输出 9）", async () => {
        const tabs = [...base.tabs.slice(0, 1), {value: "data:look", label: "形象", iconClass: "i-lucide-shirt", segment: "own" as const}, base.tabs[1]!];
        const wrapper = page({tabs, tab: "text"});
        const shift = () => {
            const style = (wrapper.get("[role='tabpanel']").element as HTMLElement).style;
            return [style.getPropertyValue("--entry-page-tab-x"), style.getPropertyValue("--entry-page-tab-y")];
        };
        await wrapper.setProps({tab: "plot"});
        expect(shift()).toEqual(["12px", "0px"]);
        await wrapper.setProps({tab: "data:look"});
        expect(shift()).toEqual(["-12px", "0px"]);
        expect(wrapper.get("[role='tabpanel'] [data-tab-content] [data-content]").text()).toBe("分页内容");
    });

    it("没有章、没有计划又只有主线（空作品）时不出“在看”；作品里有计划、或不止一条线时出", async () => {
        const empty = page({chapters: [], position: "initial"});
        expect(empty.find("[data-view-point]").exists()).toBe(false);
        const planned = page({chapters: [], position: "initial", canPlan: true});
        expect(planned.get("[data-view-point]").text()).toContain("最初");
        const lines = page({chapters: [], position: "initial", lineOptions: [{id: "main", name: null, depth: 0}, {id: "l1", name: "回溯以后", depth: 1}], resolvedLine: "main"});
        expect(lines.get("[data-view-point]").text()).toContain("最初 · 主线");
    });

    it("可编辑时名字、简介本身是按钮，点了发出带锚点的 edit-name、edit-summary；没有“改”；没有简介时写“一句话简介”", async () => {
        const wrapper = page({editable: true, summary: ""});
        expect(wrapper.findAll("button").some((button) => button.text() === "改")).toBe(false);
        const name = wrapper.get("[data-edit='entry.name']");
        expect(name.text()).toBe("哥哥");
        await name.trigger("click");
        expect(wrapper.emitted("edit-name")).toEqual([[name.element]]);
        const summary = wrapper.get("[data-edit='entry.summary']");
        expect(summary.text()).toBe("一句话简介");
        await summary.trigger("click");
        expect(wrapper.emitted("edit-summary")).toEqual([[summary.element]]);
    });

    it("添加别名：回车加上；失焦时非空也加上；Escape 放弃，之后的失焦不再加；已有的不再加", async () => {
        const wrapper = page({editable: true, aliases: ["小瑕"]});
        const start = async (): Promise<HTMLInputElement> => {
            await wrapper.findAll("[data-entry-aliases] button").find((button) => button.text() === "添加别名")!.trigger("click");
            return wrapper.get("[data-entry-aliases] input").element as HTMLInputElement;
        };
        let input = await start();
        await wrapper.get("[data-entry-aliases] input").setValue("夜王");
        await wrapper.get("[data-entry-aliases] input").trigger("keydown", {key: "Enter"});
        input = await start();
        await wrapper.get("[data-entry-aliases] input").setValue("哥哥大人");
        await wrapper.get("[data-entry-aliases] input").trigger("blur");
        input = await start();
        await wrapper.get("[data-entry-aliases] input").setValue("不要的");
        await wrapper.get("[data-entry-aliases] input").trigger("keydown", {key: "Escape"});
        input.dispatchEvent(new FocusEvent("blur"));
        await start();
        await wrapper.get("[data-entry-aliases] input").setValue("小瑕");
        await wrapper.get("[data-entry-aliases] input").trigger("keydown", {key: "Enter"});
        expect(wrapper.emitted("aliases")).toEqual([[{add: ["夜王"]}], [{add: ["哥哥大人"]}]]);
    });

    it("横排的分页带图标，第一个看法前有分段；可编辑又有能加的组时行尾有“＋”，选一项发 add-component、打开时发 add-open；更多里没有“添加一组设定”", async () => {
        const wrapper = page({
            editable: true,
            tabs: [
                {value: "data:character", label: "人物", iconClass: "i-lucide-user-round", segment: "own", removable: true},
                {value: "text", label: "文字", iconClass: "i-lucide-file-text", segment: "own"},
                {value: "plot", label: "情节", iconClass: "i-lucide-git-commit-horizontal", segment: "view", count: 3},
            ],
            tab: "text",
            addable: [{value: "nbook.canon.look", label: "形象"}],
        });
        const tabs = wrapper.findAll("[role='tablist'] [role='tab']").filter((tab) => tab.attributes("data-tab-value") !== undefined);
        const segments = new Map(tabs.map((tab) => [tab.attributes("data-tab-value"), tab.attributes("data-segment-start") !== undefined]));
        expect(Object.fromEntries(segments)).toEqual({"data:character": false, text: false, plot: true});
        expect(wrapper.find("[role='tablist'] .i-lucide-user-round").exists()).toBe(true);
        const add = wrapper.findAllComponents(DropdownMenu).find((menu) => (menu.props("items") as {id: string}[]).some((item) => item.id === "nbook.canon.look"))!;
        add.vm.$emit("update:open", true);
        add.vm.$emit("select", "nbook.canon.look");
        expect(wrapper.emitted("add-open")).toHaveLength(1);
        expect(wrapper.emitted("add-component")).toEqual([["nbook.canon.look"]]);
        const more = wrapper.findAllComponents(DropdownMenu).find((menu) => (menu.props("items") as {id: string}[]).some((item) => item.id === "delete"))!;
        expect((more.props("items") as {id: string}[]).map((item) => item.id)).not.toContain("add-component");
        // 没有能加的组时不出“＋”。
        expect(page({editable: true}).find("[data-add-component]").exists()).toBe(false);
    });

    it("右键一页先选中它，菜单里有“添加一组设定”（下一级是能加的组，打开时同“＋”发 add-open）；是一组设定时另有“去掉这组设定”", async () => {
        const wrapper = page({
            editable: true,
            tabs: [
                {value: "data:character", label: "人物", iconClass: "i-lucide-user-round", segment: "own", removable: true},
                {value: "text", label: "文字", iconClass: "i-lucide-file-text", segment: "own"},
            ],
            tab: "text",
            addable: [{value: "nbook.canon.look", label: "形象"}],
        });
        const menu = () => wrapper.findComponent(ContextMenu);
        const tabOf = (value: string) => wrapper.findAll(`[role='tab'][data-tab-value='${value}']`)[0]!;
        await tabOf("data:character").trigger("contextmenu", {clientX: 5, clientY: 6});
        expect(wrapper.emitted("update:tab")).toEqual([["data:character"]]);
        expect(menu().props("open")).toBe(true);
        expect(wrapper.emitted("add-open")).toHaveLength(1);
        type Item = {label?: string; separator?: boolean; children?: {label: string; action: () => void}[]; action?: () => void};
        const items = menu().props("items") as Item[];
        expect(items.map((item) => (item.separator === true ? "|" : item.label))).toEqual(["添加一组设定", "|", "去掉“人物”这组设定"]);
        items[0]!.children![0]!.action();
        items[2]!.action!();
        expect(wrapper.emitted("add-component")).toEqual([["nbook.canon.look"]]);
        expect(wrapper.emitted("remove-component")).toHaveLength(1);
        // 文字分页不是一组设定：没有“去掉”。
        await tabOf("text").trigger("contextmenu", {clientX: 5, clientY: 6});
        expect((menu().props("items") as Item[]).map((item) => item.label)).toEqual(["添加一组设定"]);
    });

    it("读取中、读取失败、找不到、已删除各只有一句，没有页头控件与分页", () => {
        expect(page({status: "loading"}).text()).toBe("读取中…");
        expect(page({status: "missing"}).text()).toBe("找不到这个条目");
        expect(page({status: "failed"}).get("[role='alert']").text()).toBe("没有读出来");
        const deleted = page({status: "deleted"});
        expect(deleted.text()).toBe("哥哥这个条目已删除");
        expect(deleted.find("[role='tab']").exists()).toBe(false);
    });

    it("未出场、选过的章不在了写在时间点旁的标记里，不另起一行；断开的“重试”发 retry", async () => {
        expect(page({notAppeared: true}).get("[data-not-appeared]").text()).toBe("这时还没出场");
        expect(page({positionGone: true}).get("header [role='status']").text()).toBe("原来选的那一章已经不在了");
        const wrapper = page({disconnected: true});
        expect(wrapper.get("[role='status']").text()).toContain("世界已断开");
        await wrapper.findAll("button").find((button) => button.text() === "重试")!.trigger("click");
        expect(wrapper.emitted("retry")).toHaveLength(1);
    });
});
