/**
 * ViewPointPicker（同名 .md，docs/specs/canon/author-ui.md 输出 7、8、34）：按钮写的结论、往前往后一处、菜单里的故事线与剧情进度、
 * 章多时的搜索与键盘、标记与锁着。菜单经 Popover 传送到 body，在 document 里找。
 */

import {mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";
import {nextTick} from "vue";

import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import {canonCatalogs} from "../text";
import ViewPointPicker from "./ViewPointPicker.vue";

const port = testTextPort("zh-CN", {"nbook.canon": canonCatalogs});
const mounted: Array<{unmount(): void}> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

const chapterOf = (n: number, title: string | null = null) => ({chapter: `c${String(n)}`, index: n, title, start: `c${String(n)}:start`, end: `c${String(n)}:end`});
const THREE = [chapterOf(1, "好哥哥真难当"), chapterOf(2, "用钱说话"), chapterOf(3)];
const LINES = [{id: "main", name: null, depth: 0}, {id: "l1", name: "重来的那个晚上", depth: 1}];
const picker = (props: Record<string, unknown> = {}) => {
    const wrapper = mount(ViewPointPicker, {props: {chapters: THREE, position: "c3:end", ...props}, global: {provide: provideText(port)}, attachTo: document.body});
    mounted.push(wrapper);
    return wrapper;
};
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const openMenu = async (wrapper: ReturnType<typeof picker>): Promise<HTMLElement> => {
    await wrapper.get("[data-view-point]").trigger("click");
    await nextTick();
    await frame();
    await nextTick();
    const menu = document.querySelector<HTMLElement>("[data-view-point-menu]");
    if (menu === null) throw new Error("菜单没有打开");
    return menu;
};
const radios = (menu: HTMLElement) => [...menu.querySelectorAll<HTMLElement>("[data-position-value]")];

describe("ViewPointPicker", () => {
    it("按钮写结论：只有主线时不写线；不止一条线时写这一页读的线；算上计划加“含计划”；固定看一条线时写那条线、标成固定", async () => {
        const wrapper = picker();
        expect(wrapper.get("[data-view-point]").text().replace(/\s+/gu, "")).toBe("在看第3章末尾");
        await wrapper.setProps({lineOptions: LINES, resolvedLine: "main", planned: true});
        expect(wrapper.get("[data-view-point]").text()).toContain("第 3 章末尾 · 主线 · 含计划");
        expect(wrapper.get("[data-view-point]").attributes("data-pinned")).toBeUndefined();
        await wrapper.setProps({line: "l1", resolvedLine: "l1", planned: false, position: "initial"});
        expect(wrapper.get("[data-view-point]").text()).toContain("最初 · 重来的那个晚上");
        expect(wrapper.get("[data-view-point]").attributes("data-pinned")).toBe("");
    });

    it("往前、往后一处：按最初、每章开头、末尾的顺序走；到头了不可用、悬停写已经是最后；只有最初一个位置时不出", async () => {
        const wrapper = picker();
        const previous = wrapper.get("[data-view-point-prev]");
        const following = wrapper.get("[data-view-point-next]");
        expect(previous.attributes("title")).toBe("往前一处：第 3 章开头");
        expect(following.attributes("disabled")).toBeDefined();
        expect(following.attributes("title")).toBe("已经是最后");
        await previous.trigger("click");
        expect(wrapper.emitted("update:position")).toEqual([["c3:start"]]);
        await wrapper.setProps({position: "initial"});
        expect(wrapper.get("[data-view-point-prev]").attributes("disabled")).toBeDefined();
        await wrapper.get("[data-view-point-next]").trigger("click");
        expect(wrapper.emitted("update:position")!.at(-1)).toEqual(["c1:start"]);
        await wrapper.setProps({chapters: [], canPlan: true});
        expect(wrapper.find("[data-view-point-prev]").exists()).toBe(false);
    });

    it("菜单：故事线一段写按章节自动与当前读的线，选一条发 update:line 并关上；剧情进度是最初与每章的开头、末尾，选一个发 update:position；选了以后焦点回到按钮", async () => {
        const wrapper = picker({lineOptions: LINES, resolvedLine: "main"});
        let menu = await openMenu(wrapper);
        expect(menu.textContent).toContain("故事线");
        expect(menu.querySelector("[data-line-option='']")?.textContent).toContain("按章节自动");
        expect(menu.querySelector("[data-line-option='']")?.textContent).toContain("当前：主线");
        expect(menu.querySelector("[data-line-option='']")?.getAttribute("aria-checked")).toBe("true");
        expect(radios(menu).map((radio) => radio.getAttribute("data-position-value"))).toEqual(["initial", "c1:start", "c1:end", "c2:start", "c2:end", "c3:start", "c3:end"]);
        expect(radios(menu).filter((radio) => radio.getAttribute("aria-checked") === "true").map((radio) => radio.getAttribute("data-position-value"))).toEqual(["c3:end"]);
        expect(menu.querySelector("[data-view-point-plan]")).toBeNull();
        menu.querySelector<HTMLElement>("[data-line-option='l1']")!.click();
        await nextTick();
        expect(wrapper.emitted("update:line")).toEqual([["l1"]]);
        expect(wrapper.get("[data-view-point]").attributes("aria-expanded")).toBe("false");
        expect(document.activeElement).toBe(wrapper.get("[data-view-point]").element);

        menu = await openMenu(wrapper);
        menu.querySelector<HTMLElement>("[data-position-value='c2:end']")!.click();
        await nextTick();
        expect(wrapper.emitted("update:position")).toEqual([["c2:end"]]);
        expect(document.activeElement).toBe(wrapper.get("[data-view-point]").element);
    });

    it("作品里有计划时最下面是开关，拨了发 update:planned、菜单不关；只有主线时没有故事线一段", async () => {
        const wrapper = picker({canPlan: true});
        const menu = await openMenu(wrapper);
        expect(menu.textContent).not.toContain("故事线");
        menu.querySelector<HTMLElement>("[data-view-point-plan] [role='switch']")!.click();
        await nextTick();
        expect(wrapper.emitted("update:planned")).toEqual([[true]]);
        expect(document.querySelector("[data-view-point-menu]")).not.toBeNull();
    });

    it("键盘：打开时焦点在当前位置；上下键换章、保持开头或末尾，左右键换开头末尾", async () => {
        const wrapper = picker();
        const menu = await openMenu(wrapper);
        expect(document.activeElement?.getAttribute("data-position-value")).toBe("c3:end");
        const press = async (key: string) => {
            (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent("keydown", {key, bubbles: true}));
            await nextTick();
        };
        await press("ArrowUp");
        expect(document.activeElement?.getAttribute("data-position-value")).toBe("c2:end");
        await press("ArrowLeft");
        expect(document.activeElement?.getAttribute("data-position-value")).toBe("c2:start");
        await press("Home");
        expect(document.activeElement?.getAttribute("data-position-value")).toBe("initial");
        await press("ArrowDown");
        expect(document.activeElement?.getAttribute("data-position-value")).toBe("c1:start");
        expect(menu.querySelector("[data-view-point-search]")).toBeNull();
    });

    it("多于 12 章：有搜索框，焦点在它上面；按章号（纯数字只认章号）、“第 N 章”（空格可有可无）、标题里的字筛；当前章被筛掉时最初可聚焦；搜不到写一句；按下键进章表", async () => {
        const titles = ["雨夜的来客", "旧校舍的钟", "夏日祭"];
        const chapters = Array.from({length: 30}, (_, index) => chapterOf(index + 1, titles[index % titles.length]!));
        const wrapper = picker({chapters, position: "c20:end"});
        const menu = await openMenu(wrapper);
        const search = menu.querySelector<HTMLInputElement>("[data-view-point-search] input")!;
        expect(document.activeElement).toBe(search);
        const typeIn = async (words: string) => {
            search.value = words;
            search.dispatchEvent(new Event("input", {bubbles: true}));
            await nextTick();
        };
        await typeIn("钟");
        expect([...menu.querySelectorAll("[data-chapter-row]")].map((row) => row.getAttribute("data-chapter-row"))).toEqual(["c2", "c5", "c8", "c11", "c14", "c17", "c20", "c23", "c26", "c29"]);
        await typeIn("第 7 章");
        expect([...menu.querySelectorAll("[data-chapter-row]")].map((row) => row.getAttribute("data-chapter-row"))).toEqual(["c7"]);
        await typeIn("第7章");
        expect([...menu.querySelectorAll("[data-chapter-row]")].map((row) => row.getAttribute("data-chapter-row"))).toEqual(["c7"]);
        await typeIn("3");
        expect([...menu.querySelectorAll("[data-chapter-row]")].map((row) => row.getAttribute("data-chapter-row"))).toEqual(["c3"]);
        await typeIn("12");
        expect([...menu.querySelectorAll("[data-chapter-row]")].map((row) => row.getAttribute("data-chapter-row"))).toEqual(["c12"]);
        expect(radios(menu).filter((radio) => radio.getAttribute("tabindex") === "0").map((radio) => radio.getAttribute("data-position-value"))).toEqual(["initial"]);
        search.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowDown", bubbles: true}));
        await nextTick();
        expect(document.activeElement?.getAttribute("data-position-value")).toBe("c12:start");
        await typeIn("没有这一章");
        expect(menu.textContent).toContain("没有对得上的章");
    });

    it("标记一格只写一样：那一章不在了优先，其次是还没出场；锁着时按钮与前后两步都不可用、悬停写原因", async () => {
        const wrapper = picker({positionGone: true, notAppeared: true});
        expect(wrapper.text()).toContain("原来选的那一章已经不在了");
        expect(wrapper.find("[data-not-appeared]").exists()).toBe(false);
        await wrapper.setProps({positionGone: false});
        expect(wrapper.get("[data-not-appeared]").text()).toBe("这时还没出场");
        await wrapper.setProps({locked: "先提交或放弃正在写的主文字"});
        for (const selector of ["[data-view-point]", "[data-view-point-prev]"]) {
            expect(wrapper.get(selector).attributes("disabled")).toBeDefined();
            expect(wrapper.get(selector).attributes("title")).toBe("先提交或放弃正在写的主文字");
        }
    });
});
