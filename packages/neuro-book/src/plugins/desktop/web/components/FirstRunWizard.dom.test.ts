/**
 * FirstRunWizard（同名 .md）：四步的按钮与事件、Esc 当作跳过、点遮罩不关；换步后焦点仍在主按钮；进度的读屏文字随步变；卡片组
 * 是单选组，方向键选中下一张、Tab 只停在选中的那张；开关、语言与“打开”发出的事件；便携版只有关窗去向；作品目录还没建时有中性提示。
 */

import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import {desktopCatalogs} from "../text";
import FirstRunWizard from "./FirstRunWizard.vue";

const global = {provide: provideText(testTextPort("zh-CN", {"nbook.desktop": desktopCatalogs}))};

const mounted: Array<{unmount(): void}> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

type Props = InstanceType<typeof FirstRunWizard>["$props"];

const BASE: Props = {
    open: true,
    step: 1,
    themes: [
        {id: "nbook", name: "NeuroBook", thumbnails: {light: "nbook-light.webp", dark: "nbook-dark.webp"}},
        {id: "macos", name: "macOS", thumbnails: {light: "macos-light.webp", dark: "macos-dark.webp"}},
        {id: "acme.paper", name: "Paper", thumbnails: null},
    ],
    theme: "nbook",
    appearance: "system",
    dark: false,
    locales: [{value: "zh-CN", label: "简体中文"}, {value: "en-US", label: "English"}],
    locale: "zh-CN",
    options: {desktopShortcut: true, openAtLogin: false, tray: false},
    shownOptions: ["desktopShortcut", "openAtLogin", "tray"],
    places: {stateRoot: "C:\\Users\\lin\\AppData\\Local\\NeuroBook", library: "C:\\Users\\lin\\Documents\\NeuroBook"},
    libraryMissing: false,
    error: null,
};

function open(props: Partial<Props> = {}) {
    const wrapper = mount(FirstRunWizard, {global, props: {...BASE, ...props}, attachTo: document.body});
    mounted.push(wrapper);
    return wrapper;
}

const query = <T extends Element = HTMLElement>(selector: string): T => {
    const found = document.body.querySelector<T>(selector);
    if (found === null) throw new Error(`没有 ${selector}`);
    return found;
};
const all = (selector: string): HTMLElement[] => [...document.body.querySelectorAll<HTMLElement>(selector)];
const textOf = (selector: string): string => (document.body.querySelector(selector)?.textContent ?? "").replace(/\s+/g, "");
const key = (target: Element, name: string): void => {
    target.dispatchEvent(new KeyboardEvent("keydown", {key: name, bubbles: true, cancelable: true}));
};

describe("FirstRunWizard", () => {
    it("第一步：焦点在“开始”，“开始”发 next、“跳过”发 skip；进度读作第 1 步", async () => {
        const wrapper = open();
        await flushPromises();
        expect(document.activeElement).toBe(query("[data-first-run-primary]"));
        expect(textOf("[data-first-run-primary]")).toBe("开始");
        expect(textOf("[data-first-run-progress]")).toBe("第1步，共4步：欢迎");
        query("[data-first-run-primary]").click();
        query("[data-first-run-secondary]").click();
        expect(Object.keys(wrapper.emitted())).toEqual(expect.arrayContaining(["next", "skip"]));
        expect(wrapper.emitted("back")).toBeUndefined();
    });

    it("Esc 发 skip，点遮罩不关也不发事件", async () => {
        const wrapper = open({step: 2});
        await flushPromises();
        key(query("[data-first-run-primary]"), "Escape");
        await flushPromises();
        expect(wrapper.emitted("skip")).toHaveLength(1);
        const overlay = query("[data-dialog-overlay]");
        overlay.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true, button: 0}));
        overlay.dispatchEvent(new PointerEvent("pointerup", {bubbles: true, button: 0}));
        await flushPromises();
        expect(wrapper.emitted("skip")).toHaveLength(1);
        expect(query("[data-first-run-wizard]")).toBeTruthy();
    });

    it("换步后焦点仍在主按钮，文字与读屏的进度跟着变；第四步主按钮发 finish、次按钮发 back", async () => {
        const wrapper = open();
        await flushPromises();
        const primary = query("[data-first-run-primary]");
        await wrapper.setProps({step: 2});
        await flushPromises();
        expect(document.activeElement).toBe(primary);
        expect(textOf("[data-first-run-primary]")).toBe("下一步");
        expect(textOf("[data-first-run-progress]")).toBe("第2步，共4步：外观");
        await wrapper.setProps({step: 4});
        await flushPromises();
        expect(textOf("[data-first-run-primary]")).toBe("开始写作");
        query("[data-first-run-primary]").click();
        query("[data-first-run-secondary]").click();
        expect(wrapper.emitted("finish")).toHaveLength(1);
        expect(wrapper.emitted("back")).toHaveLength(1);
        expect(wrapper.emitted("next")).toBeUndefined();
    });

    it("主题卡片是单选组：选中的那张可以 Tab 到；暗色时取暗的缩略图；没有缩略图的只写名字", async () => {
        open({step: 2, dark: true});
        await flushPromises();
        const cards = all("[data-theme-card]");
        expect(cards.map((card) => card.getAttribute("aria-checked"))).toEqual(["true", "false", "false"]);
        expect(cards.map((card) => card.tabIndex)).toEqual([0, -1, -1]);
        expect(query("[data-theme-card='nbook'] img").getAttribute("src")).toBe("nbook-dark.webp");
        expect(document.body.querySelector("[data-theme-card='acme.paper'] img")).toBeNull();
        expect(textOf("[data-theme-card='acme.paper']")).toBe("Paper");
    });

    it("主题卡片：方向键与点选都发 change，当前主题不在列表里时 Tab 停在第一张、没有选中", async () => {
        const wrapper = open({step: 2, theme: "user.mine"});
        await flushPromises();
        const cards = all("[data-theme-card]");
        expect(cards.map((card) => card.getAttribute("aria-checked"))).toEqual(["false", "false", "false"]);
        expect(cards.map((card) => card.tabIndex)).toEqual([0, -1, -1]);
        cards[1]!.click();
        key(cards[0]!, "ArrowRight");
        key(cards[0]!, "End");
        expect(wrapper.emitted("change")).toEqual([[{key: "theme", value: "macos"}], [{key: "theme", value: "macos"}], [{key: "theme", value: "acme.paper"}]]);
    });

    it("明暗卡片：方向键从当前的那张往前选；缩略图取所选主题的，跟随系统亮暗各半", async () => {
        const wrapper = open({step: 2, appearance: "dark"});
        await flushPromises();
        const cards = all("[data-scheme-card]");
        expect(cards.map((card) => card.getAttribute("aria-checked"))).toEqual(["false", "true", "false"]);
        key(cards[1]!, "ArrowLeft");
        expect(wrapper.emitted("change")).toEqual([[{key: "appearance", value: "light"}]]);
        expect([...query("[data-scheme-card='system']").querySelectorAll("img")].map((img) => img.getAttribute("src"))).toEqual(["nbook-light.webp", "nbook-dark.webp"]);
    });

    it("第三步：开关发 change；便携版只有关窗去向", async () => {
        const wrapper = open({step: 3});
        await flushPromises();
        expect(all("[data-desktop-option]").map((row) => row.dataset.desktopOption)).toEqual(["desktopShortcut", "openAtLogin", "tray"]);
        query("[data-desktop-option='openAtLogin'] [role='switch']").click();
        await flushPromises();
        expect(wrapper.emitted("change")).toEqual([[{key: "openAtLogin", value: true}]]);
        await wrapper.setProps({shownOptions: ["tray"]});
        expect(all("[data-desktop-option]").map((row) => row.dataset.desktopOption)).toEqual(["tray"]);
    });

    it("回车在开关上不前进", async () => {
        const wrapper = open({step: 3});
        await flushPromises();
        key(query("[data-desktop-option='tray'] [role='switch']"), "Enter");
        await flushPromises();
        expect(wrapper.emitted("next")).toBeUndefined();
    });

    it("第四步：两处位置的路径与“打开”；作品目录还没建时有中性提示；有错误时状态行换成它", async () => {
        const wrapper = open({step: 4, libraryMissing: true});
        await flushPromises();
        expect(textOf("[data-place='state-root']")).toContain("C:\\Users\\lin\\AppData\\Local\\NeuroBook");
        expect(textOf("[data-library-missing]")).toBe("第一次新建作品时会建出这个文件夹。");
        query("[data-place='library'] button").click();
        query("[data-place='state-root'] button").click();
        expect(wrapper.emitted("open-place")).toEqual([["library"], ["state-root"]]);
        expect(document.body.textContent).toContain("以后都能在设置里改");
        await wrapper.setProps({error: "文件夹没有打开。"});
        await flushPromises();
        expect(document.body.textContent).toContain("文件夹没有打开。");
    });
});
