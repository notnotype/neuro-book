/** ShelfDesk（同名 .md）：统计的大字取今天或总字数，最近写到按时间排，空书架是问候，看板娘那一格可叠贡献组件（docs/specs/workbench/bookshelf.md 输出 2、3、22）。 */

import {mount} from "@vue/test-utils";
import {describe, expect, it} from "vitest";
import {defineComponent, h, nextTick, onMounted} from "vue";

import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import type {ShelfItem, ShelfStats} from "../../shared/shelf";
import {projectsCatalogs} from "../text";
import ShelfDesk from "./ShelfDesk.vue";

/** 注入窗口同款的翻译端口（严格模式，缺键或缺参数直接抛错）。 */
const global = {provide: provideText(testTextPort("zh-CN", {"nbook.projects": projectsCatalogs}))};

const NOW = "2026-10-11T12:00:00.000Z";

function item(id: string, title: string, stats: Partial<ShelfStats>): ShelfItem {
    return {
        id, name: id, title, description: null, color: null, cover: null, path: `/books/${id}`, state: "stopped",
        stats: {freshness: "stale", computedAt: NOW, words: 0, files: 0, unreadable: 0, today: null, last: null, ...stats},
    };
}

const last = (at: string, label: string) => ({address: `project://${label}.md`, label, at, excerpt: `${label}的最后一段。`});

describe("ShelfDesk", () => {
    it("今天写了字时大字是今天的净增，否则是总字数；最近写到按时间从近到远；点一条发 continue", async () => {
        const wrapper = mount(ShelfDesk, {global, props: {now: NOW, items: [
            item("a", "长夜行", {words: 286_400, files: 41, today: 1240, last: last("2026-10-11T08:27:00.000Z", "第十七章")}),
            item("b", "北方以北", {words: 123_000, files: 23, last: last("2026-10-10T21:04:00.000Z", "第九章")}),
            item("c", "雾中城", {words: 41_000, files: 9}),
        ]}});
        expect(wrapper.get(".shelf-desk__number").text()).toBe("1,240");
        expect(wrapper.get(".shelf-desk__totals").text()).toContain("45 万字");
        expect(wrapper.get(".shelf-desk__totals").text()).toContain("3 部作品");
        expect(wrapper.findAll("[data-recent-piece]").map((piece) => piece.attributes("data-recent-piece"))).toEqual(["a", "b"]);
        expect(wrapper.get("[data-recent-piece='a']").text()).toContain("第十七章的最后一段");
        await wrapper.get("[data-recent-piece='b']").trigger("click");
        await wrapper.get("[data-continue]").trigger("click");
        expect(wrapper.emitted("continue")).toEqual([["b"], ["a"]]);

        await wrapper.setProps({items: [item("c", "雾中城", {words: 41_000, files: 9})]});
        expect(wrapper.get(".shelf-desk__number").text()).toBe("4.1 万");
        expect(wrapper.find("[data-continue]").exists()).toBe(false);
        expect(wrapper.get("[data-shelf-recent]").text()).toContain("打开一部作品写几个字");
        wrapper.unmount();
    });

    it("空书架：问候与看板娘，没有统计与最近写到", () => {
        const wrapper = mount(ShelfDesk, {global, props: {now: NOW, items: []}});
        expect(wrapper.get("[data-shelf-desk]").text()).toContain("书架还是空的");
        expect(wrapper.find("[data-shelf-stats]").exists()).toBe(false);
        expect(wrapper.find("[data-shelf-recent]").exists()).toBe(false);
        expect(wrapper.find(".nb-brand-mood").exists()).toBe(true);
        wrapper.unmount();
    });

    it("看板娘那一格叠贡献的组件：晚到时猫不重挂，心情跟着它发的 update:mood；拿掉贡献后回到空闲", async () => {
        const Companion = defineComponent({
            emits: ["update:mood"],
            setup(_, {emit}) {
                onMounted(() => emit("update:mood", "ask"));
                return () => h("button", {type: "button", "data-companion": ""}, "星璃");
            },
        });
        const wrapper = mount(ShelfDesk, {global, props: {now: NOW, items: []}});
        const cat = wrapper.get(".nb-brand-mood").element;
        expect(cat.getAttribute("data-mood")).toBe("idle");
        await wrapper.setProps({companion: Companion});
        await nextTick();
        expect(wrapper.get("[data-shelf-mascot] [data-companion]").text()).toBe("星璃");
        expect(wrapper.get(".nb-brand-mood").element).toBe(cat);
        expect(cat.getAttribute("data-mood")).toBe("ask");
        await wrapper.setProps({companion: null});
        expect(wrapper.find("[data-companion]").exists()).toBe(false);
        expect(wrapper.get(".nb-brand-mood").element).toBe(cat);
        expect(cat.getAttribute("data-mood")).toBe("idle");
        wrapper.unmount();
    });
});
