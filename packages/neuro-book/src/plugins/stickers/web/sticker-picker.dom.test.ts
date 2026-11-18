/**
 * 表情选择器面板（docs/specs/agent/stickers.md 输出 39 到 43）：用真的选择器服务（`createStickerPicker`）、真的浏览器目录与内存里的
 * 最近用过，经服务的 `loadPanel()` 挂上绑好服务的面板，看用户点、按键之后面板发出什么。
 */

import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import {provideText} from "nbook/shared/testing/text-port";
import {createHostTextEngine} from "nbook/web/host/text-engine";

import type {BrowserStickerPack, StickerPicker, StickerPickerItem} from "../shared/contracts";
import {createStickerPicker} from "./picker-service";
import {memoryRecent} from "./recent";
import {createStickerDirectory} from "./resolver";
import {stickersCatalogs} from "./text";

const cleanup: Array<() => void> = [];
afterEach(() => {
    for (const dispose of cleanup.splice(0)) dispose();
    document.body.innerHTML = "";
});

const sticker = (name: string) => ({name, width: 64, height: 64, url: `/img/${name}.png`});
const LYRA: BrowserStickerPack = {id: "user.lyra", folder: "lyra", title: "星璃", source: "user", writing: "lyra", stickers: ["开心", "害羞", "困", "疑问", "惊讶", "生气", "委屈", "嗯"].map(sticker)};
const DOG: BrowserStickerPack = {id: "acme.dogs.dog", folder: "dog", title: "小狗", source: "plugin", plugin: {id: "acme.dogs", title: "汪汪"}, writing: "dog", stickers: ["握手", "摇尾巴"].map(sticker)};

async function show(packs: readonly BrowserStickerPack[]) {
    const text = createHostTextEngine({locale: "zh-CN", strict: true});
    text.register("nbook.stickers", stickersCatalogs.catalogs, stickersCatalogs.source);
    const directory = createStickerDirectory();
    directory.set(packs);
    const controller = new AbortController();
    const opened: string[] = [];
    const picker: StickerPicker = createStickerPicker({directory, recent: memoryRecent(), openPacksPage: () => opened.push("packs"), report: () => undefined, signal: controller.signal});
    const events: Array<{kind: "pick"; raw: string; keepOpen: boolean} | {kind: "close"}> = [];
    const outside = document.createElement("button");
    document.body.append(outside);
    const Panel = await picker.loadPanel();
    const wrapper = mount(Panel, {
        attrs: {
            onPick: (item: StickerPickerItem, keepOpen: boolean) => events.push({kind: "pick", raw: item.raw, keepOpen}),
            onClose: () => events.push({kind: "close"}),
        },
        attachTo: document.body,
        global: {provide: provideText(text.port)},
    });
    cleanup.push(() => {
        wrapper.unmount();
        controller.abort();
    });
    await flushPromises();
    const root = wrapper.element as HTMLElement;
    return {wrapper, root, picker, events, opened, outside};
}

const cells = (root: HTMLElement): HTMLElement[] => [...root.querySelectorAll<HTMLElement>("[data-sticker-cell]")];
const cell = (root: HTMLElement, raw: string): HTMLElement => cells(root).find((element) => element.dataset.stickerRaw === raw)!;
const search = (root: HTMLElement): HTMLInputElement => root.querySelector("input")!;
const key = (target: Element, name: string, extra: KeyboardEventInit = {}): void => {
    target.dispatchEvent(new KeyboardEvent("keydown", {key: name, bubbles: true, cancelable: true, ...extra}));
};

describe("布局与分组", () => {
    it("打开时焦点在搜索框；按表情包分组，插件的组头带插件名；底部写第一个表情的名字与写法", async () => {
        const {root} = await show([LYRA, DOG]);
        expect(document.activeElement).toBe(search(root));
        expect([...root.querySelectorAll("h3")].map((head) => [...head.children].map((part) => part.textContent))).toEqual([["星璃"], ["小狗", "汪汪"]]);
        expect(cells(root).map((element) => element.dataset.stickerRaw)).toEqual([...LYRA.stickers.map((item) => `:lyra/${item.name}:`), ":dog/握手:", ":dog/摇尾巴:"]);
        expect(root.querySelector("footer")?.textContent).toContain(":lyra/开心:");
        expect(root.querySelectorAll("[data-sticker-picker-tab]")).toHaveLength(2);
    });

    it("用过的进“最近用过”，排在最前，标签行多一个时钟", async () => {
        const {root, picker} = await show([LYRA, DOG]);
        const [handshake] = picker.search("握手", 8);
        picker.used(handshake!);
        await flushPromises();
        expect(root.querySelector("h3")?.textContent).toBe("最近用过");
        expect(cells(root)[0]?.dataset.stickerRaw).toBe(":dog/握手:");
        expect(root.querySelectorAll("[data-sticker-picker-tab]")).toHaveLength(3);
    });

    it("没有表情包：一句话与“在设置里新建”，点了打开表情包页并关上", async () => {
        const {root, events, opened} = await show([]);
        expect(root.textContent).toContain("还没有表情包");
        root.querySelector<HTMLButtonElement>("[data-sticker-picker-create]")!.click();
        expect(opened).toEqual(["packs"]);
        expect(events).toContainEqual({kind: "close"});
    });
});

describe("插入", () => {
    it("点一下发 pick（不保持），按住 Shift 点发 pick（保持）", async () => {
        const {root, events} = await show([LYRA]);
        cell(root, ":lyra/困:").click();
        cell(root, ":lyra/嗯:").dispatchEvent(new MouseEvent("click", {bubbles: true, shiftKey: true}));
        expect(events).toEqual([{kind: "pick", raw: ":lyra/困:", keepOpen: false}, {kind: "pick", raw: ":lyra/嗯:", keepOpen: true}]);
    });

    it("搜索不分组；回车选第一个结果，Shift+回车保持；没有结果时写一句、回车什么也不做", async () => {
        const {root, events} = await show([LYRA, DOG]);
        const input = search(root);
        input.value = "摇";
        input.dispatchEvent(new Event("input"));
        await flushPromises();
        expect(root.querySelectorAll("h3")).toHaveLength(0);
        expect(cells(root).map((element) => element.dataset.stickerRaw)).toEqual([":dog/摇尾巴:"]);
        key(input, "Enter", {shiftKey: true});
        input.value = "没有这个";
        input.dispatchEvent(new Event("input"));
        await flushPromises();
        expect(root.textContent).toContain("没有叫“没有这个”的表情");
        key(input, "Enter");
        expect(events).toEqual([{kind: "pick", raw: ":dog/摇尾巴:", keepOpen: true}]);
    });
});

describe("键盘与关闭", () => {
    it("搜索框里下方向键进网格；左右按顺序，上下按 6 列，跨组到下一组的同一列（不够长取最后一个）；回车插入", async () => {
        const {root, events} = await show([LYRA, DOG]);
        key(search(root), "ArrowDown");
        expect(document.activeElement).toBe(cell(root, ":lyra/开心:"));
        key(document.activeElement!, "ArrowRight");
        expect(document.activeElement).toBe(cell(root, ":lyra/害羞:"));
        key(document.activeElement!, "ArrowDown");
        expect(document.activeElement).toBe(cell(root, ":lyra/嗯:"));
        key(document.activeElement!, "ArrowDown");
        expect(document.activeElement).toBe(cell(root, ":dog/摇尾巴:"));
        key(document.activeElement!, "ArrowUp");
        expect(document.activeElement).toBe(cell(root, ":lyra/嗯:"));
        key(document.activeElement!, "End");
        expect(document.activeElement).toBe(cell(root, ":dog/摇尾巴:"));
        key(document.activeElement!, "Enter");
        expect(events).toEqual([{kind: "pick", raw: ":dog/摇尾巴:", keepOpen: false}]);
    });

    it("Esc 发 close 并拦下（外面的窗口不跟着关）；焦点离开面板发 close，面板里换焦点不发", async () => {
        const {root, events, outside} = await show([LYRA]);
        const escape = new KeyboardEvent("keydown", {key: "Escape", bubbles: true, cancelable: true});
        search(root).dispatchEvent(escape);
        expect(escape.defaultPrevented).toBe(true);
        expect(events).toEqual([{kind: "close"}]);
        cell(root, ":lyra/困:").focus();
        expect(events).toEqual([{kind: "close"}]);
        outside.focus();
        expect(events).toEqual([{kind: "close"}, {kind: "close"}]);
    });
});
