/**
 * 桌面窗口的外框（runtime.browser-host 的“窗口外框”）：`host/desktop-frame.ts` 的状态与 `<html>` 属性，`DesktopFrame.vue` 按状态
 * 画的按钮与后备标题栏。桥用真实的 `createDesktopBridge`，壳的消息经真实的 `CustomEvent` 派发，发给壳的消息记下来看。
 * 拖动区域的计算样式与关闭层开着时按钮可用，要真实浏览器，在 `e2e/desktop-frame.e2e.ts`。
 */

import {mount} from "@vue/test-utils";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import {TEXT_PORT_KEY} from "@notnotype/nb-ui/text-port";

import {createDesktopBridge, DESKTOP_EVENT, DESKTOP_FRAME_MARKER} from "nbook/shared/desktop-bridge";
import type {BridgeGlobal, ShellMessage} from "nbook/shared/desktop-bridge";

import DesktopFrame from "./DesktopFrame.vue";
import {createDesktopFrame} from "./host/desktop-frame";
import type {DesktopFrame as Frame} from "./host/desktop-frame";
import {createHostTextEngine} from "./host/text-engine";

const html = document.documentElement;
let app: HTMLElement;
let frames: Frame[] = [];

beforeEach(() => {
    app = document.createElement("div");
    app.id = "app";
    document.body.append(app);
    document.title = "书架";
});

afterEach(() => {
    for (const frame of frames) frame.dispose();
    frames = [];
    app.remove();
    for (const name of ["data-desktop-frame", "data-desktop-frame-bar"]) html.removeAttribute(name);
});

/** 一个页面：带不带能力标记，壳那边能不能收消息。 */
function setup(options: {marker: boolean; shellReceives?: boolean}) {
    const sent: unknown[] = [];
    const reports: unknown[] = [];
    const target = new EventTarget();
    const bridgeGlobal: BridgeGlobal = {
        addEventListener: (type, listener) => target.addEventListener(type, listener as EventListener),
        removeEventListener: (type, listener) => target.removeEventListener(type, listener as EventListener),
        ...(options.shellReceives === false ? {} : {__electrobunSendToHost: (message: unknown) => sent.push(message)}),
    };
    const global = {
        requestAnimationFrame: (callback: () => void) => window.requestAnimationFrame(callback),
        cancelAnimationFrame: (handle: number) => window.cancelAnimationFrame(handle),
        ...(options.marker ? {[DESKTOP_FRAME_MARKER]: 1} : {}),
    };
    const frame = createDesktopFrame({global, bridge: createDesktopBridge(bridgeGlobal), document, report: (input) => reports.push(input)});
    frames.push(frame);
    const shell = (message: ShellMessage): void => void target.dispatchEvent(new CustomEvent(DESKTOP_EVENT, {detail: message}));
    return {frame, sent, reports, shell};
}

function mountFrame(frame: Frame) {
    return mount(DesktopFrame, {props: {frame}, attachTo: document.body, global: {provide: {[TEXT_PORT_KEY as symbol]: createHostTextEngine({locale: "zh-CN", strict: true}).port}}});
}

describe("窗口外框", () => {
    it("没有能力标记（普通浏览器）：不设属性、不发消息、什么都不画", () => {
        const {frame, sent} = setup({marker: false});
        const view = mountFrame(frame);
        expect(frame.enabled).toBe(false);
        expect(html.hasAttribute("data-desktop-frame")).toBe(false);
        expect(html.hasAttribute("data-desktop-frame-bar")).toBe(false);
        expect(sent).toEqual([]);
        expect(view.find("[data-desktop-controls]").exists()).toBe(false);
        frame.control("close");
        expect(sent).toEqual([]);
        view.unmount();
    });

    it("有标记、页面没有自己的标题栏：设外框与后备标题栏的属性，画后备标题栏与三个按钮，一建立就问窗口状态", () => {
        const {frame, sent} = setup({marker: true});
        const view = mountFrame(frame);
        expect(html.hasAttribute("data-desktop-frame")).toBe(true);
        expect(html.hasAttribute("data-desktop-frame-bar")).toBe(true);
        expect(sent).toEqual([{type: "window-state-query"}]);
        expect(view.get("[data-desktop-fallback-bar]").text()).toContain("书架");
        const controls = view.get("[data-desktop-controls]");
        expect(controls.attributes("role")).toBe("group");
        expect(controls.attributes("aria-label")).toBe("窗口");
        expect(controls.findAll("button").map((button) => button.attributes("aria-label"))).toEqual(["最小化", "最大化", "关闭"]);
        expect(controls.findAll("button").every((button) => button.attributes("tabindex") === "-1")).toBe(true);
        view.unmount();
    });

    it("页面挂上自己的标题栏后撤掉后备标题栏，摘掉后又画回来", async () => {
        const {frame} = setup({marker: true});
        const view = mountFrame(frame);
        const titlebar = document.createElement("header");
        titlebar.setAttribute("data-desktop-titlebar", "");
        app.append(titlebar);
        await vi.waitFor(() => expect(html.hasAttribute("data-desktop-frame-bar")).toBe(false));
        expect(view.find("[data-desktop-fallback-bar]").exists()).toBe(false);
        expect(view.find("[data-desktop-controls]").exists()).toBe(true);
        titlebar.remove();
        app.append(document.createElement("main"));
        await vi.waitFor(() => expect(html.hasAttribute("data-desktop-frame-bar")).toBe(true));
        view.unmount();
    });

    it("按钮把动作交给壳，按下时不取焦点；壳推来最大化后按钮名换成“还原”", async () => {
        const {frame, sent, shell} = setup({marker: true});
        const view = mountFrame(frame);
        sent.length = 0;
        for (const action of ["minimize", "toggle-maximize", "close"]) {
            const down = new MouseEvent("mousedown", {bubbles: true, cancelable: true});
            view.get(`[data-desktop-control="${action}"]`).element.dispatchEvent(down);
            expect(down.defaultPrevented).toBe(true);
            await view.get(`[data-desktop-control="${action}"]`).trigger("click");
        }
        expect(sent).toEqual([{type: "window-control", action: "minimize"}, {type: "window-control", action: "toggle-maximize"}, {type: "window-control", action: "close"}]);
        // 图标：最大化是一个方块，还原是两个叠着的方块（多一条路径）。
        const icon = () => view.get('[data-desktop-control="toggle-maximize"] svg').element.children.length;
        expect(icon()).toBe(1);
        shell({type: "window-state", maximized: true});
        await view.vm.$nextTick();
        expect(view.get('[data-desktop-control="toggle-maximize"]').attributes("aria-label")).toBe("还原");
        expect(icon()).toBe(2);
        shell({type: "window-state", maximized: false});
        await view.vm.$nextTick();
        expect(view.get('[data-desktop-control="toggle-maximize"]').attributes("aria-label")).toBe("最大化");
        view.unmount();
    });

    it("文档标题变了，后备标题栏跟着变", async () => {
        const {frame} = setup({marker: true});
        const view = mountFrame(frame);
        document.title = "长夜行";
        await vi.waitFor(() => expect(view.get("[data-desktop-fallback-bar]").text()).toContain("长夜行"));
        view.unmount();
    });

    it("壳的发送函数不在：写诊断，不抛错", () => {
        const {frame, reports} = setup({marker: true, shellReceives: false});
        frame.control("minimize");
        expect(reports).toEqual([
            expect.objectContaining({event: "browser-host.frame.no-bridge", data: {type: "window-state-query"}}),
            expect.objectContaining({event: "browser-host.frame.no-bridge", data: {type: "window-control"}}),
        ]);
    });
});
