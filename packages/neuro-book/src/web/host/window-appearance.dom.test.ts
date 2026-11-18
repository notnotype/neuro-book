/**
 * 磨砂窗口的明暗（docs/specs/runtime/desktop-shell.md 输出 32）：带 `data-window-backdrop` 的窗口把页面明暗交给壳，变了再交；普通窗口什么都不发。
 */

import {afterEach, describe, expect, it} from "vitest";

import type {DesktopBridge, HostReply} from "nbook/shared/desktop-bridge";

import {watchWindowAppearance} from "./window-appearance";

function fakeBridge(): {readonly bridge: DesktopBridge; readonly sent: HostReply[]} {
    const sent: HostReply[] = [];
    return {sent, bridge: {listen: () => () => undefined, send: (message) => (sent.push(message), true)}};
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
    document.documentElement.removeAttribute("data-window-backdrop");
    document.documentElement.removeAttribute("data-nb-appearance");
});

describe("watchWindowAppearance", () => {
    it("带磨砂背景的窗口：启动时交一次当前明暗，之后只在变了才交", async () => {
        document.documentElement.setAttribute("data-window-backdrop", "acrylic");
        document.documentElement.dataset.nbAppearance = "light";
        const {bridge, sent} = fakeBridge();
        const stop = watchWindowAppearance({document, bridge, report: () => undefined});
        expect(sent).toEqual([{type: "window-appearance", dark: false}]);
        document.documentElement.dataset.nbAppearance = "light";
        document.documentElement.dataset.nbAppearance = "dark";
        await flush();
        expect(sent).toEqual([{type: "window-appearance", dark: false}, {type: "window-appearance", dark: true}]);
        stop();
        document.documentElement.dataset.nbAppearance = "light";
        await flush();
        expect(sent).toHaveLength(2);
    });

    it("主题还没写明暗：等它写出来再交", async () => {
        document.documentElement.setAttribute("data-window-backdrop", "mica");
        const {bridge, sent} = fakeBridge();
        const stop = watchWindowAppearance({document, bridge, report: () => undefined});
        expect(sent).toEqual([]);
        document.documentElement.dataset.nbAppearance = "dark";
        await flush();
        expect(sent).toEqual([{type: "window-appearance", dark: true}]);
        stop();
    });

    it("没有磨砂背景（普通窗口、普通浏览器）：什么都不发", async () => {
        document.documentElement.dataset.nbAppearance = "dark";
        const {bridge, sent} = fakeBridge();
        const stop = watchWindowAppearance({document, bridge, report: () => undefined});
        document.documentElement.dataset.nbAppearance = "light";
        await flush();
        expect(sent).toEqual([]);
        stop();
    });

    it("桥发不出去：写诊断、不抛；下一次变化再试", async () => {
        document.documentElement.setAttribute("data-window-backdrop", "mica");
        document.documentElement.dataset.nbAppearance = "dark";
        const events: string[] = [];
        let ok = false;
        const sent: HostReply[] = [];
        const bridge: DesktopBridge = {listen: () => () => undefined, send: (message) => (ok ? (sent.push(message), true) : false)};
        const stop = watchWindowAppearance({document, bridge, report: (event) => events.push(event)});
        expect(events).toEqual(["browser-host.window-appearance.no-bridge"]);
        ok = true;
        document.documentElement.dataset.nbAppearance = "light";
        await flush();
        expect(sent).toEqual([{type: "window-appearance", dark: false}]);
        stop();
    });
});
