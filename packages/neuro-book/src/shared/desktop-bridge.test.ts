/**
 * 桌面壳与页面之间的桥（desktop-bridge.ts）：两个方向的形状校验，页面一侧的监听与发送。监听用真实的 `EventTarget` 与
 * `CustomEvent`，与壳经 `executeJavascript` 派发的事件同形。
 */

import {describe, expect, it} from "bun:test";

import {createDesktopBridge, DESKTOP_EVENT, parsePageMessage, parseShellMessage} from "./desktop-bridge";
import type {BridgeGlobal, ShellMessage} from "./desktop-bridge";

function page(send?: (message: unknown) => void): BridgeGlobal & {dispatch(detail: unknown): void} {
    const target = new EventTarget();
    return {
        addEventListener: (type, listener) => target.addEventListener(type, listener as EventListener),
        removeEventListener: (type, listener) => target.removeEventListener(type, listener as EventListener),
        ...(send === undefined ? {} : {__electrobunSendToHost: send}),
        dispatch: (detail) => target.dispatchEvent(new CustomEvent(DESKTOP_EVENT, {detail})),
    };
}

describe("桌面桥", () => {
    it("壳的消息：询问与结束收下；别的形状、负数与小数的代次、未知原因丢弃", () => {
        expect(parseShellMessage({type: "close-query", generation: 3, reason: "quit"})).toEqual({type: "close-query", generation: 3, reason: "quit"});
        expect(parseShellMessage({type: "close-end", generation: 0})).toEqual({type: "close-end", generation: 0});
        for (const bad of [null, "close-query", {type: "close-query", generation: 1}, {type: "close-query", generation: -1, reason: "window"}, {type: "close-end", generation: 1.5}, {type: "close-query", generation: 1, reason: "reload"}, {type: "open-window", url: "x"}]) {
            expect(parseShellMessage(bad)).toBeNull();
        }
    });

    it("页面的消息：两种回答、标题与新窗口收下；回答缺代次或不认识的回答丢弃", () => {
        expect(parsePageMessage({type: "close-ack", generation: 2})).toEqual({type: "close-ack", generation: 2});
        expect(parsePageMessage({type: "close-answer", generation: 2, answer: "deny"})).toEqual({type: "close-answer", generation: 2, answer: "deny"});
        expect(parsePageMessage({type: "title", title: ""})).toEqual({type: "title", title: ""});
        expect(parsePageMessage({type: "open-window", url: "http://127.0.0.1:4517/?project=a"})).not.toBeNull();
        for (const bad of [{type: "close-answer", generation: 2, answer: "maybe"}, {type: "close-ack"}, {type: "shell-ready"}, {type: "title", title: 1}]) {
            expect(parsePageMessage(bad)).toBeNull();
        }
    });

    it("更新提示的消息：七种提示、选择、已显示与页面就绪收下；不认识的种类、选择与缺版本号丢弃", () => {
        for (const kind of ["available", "notify-only", "downloading", "download-failed", "downloaded", "updated", "update-failed"]) {
            expect(parseShellMessage({type: "update-hint", id: 1, hint: {kind, version: "0.90.2"}})).not.toBeNull();
        }
        expect(parseShellMessage({type: "update-hint", id: 2, hint: {kind: "notify-only", version: "0.90.2", envRoot: true}})).not.toBeNull();
        expect(parseShellMessage({type: "update-hint-end", id: 2})).toEqual({type: "update-hint-end", id: 2});
        for (const bad of [{type: "update-hint", id: 1, hint: {kind: "installing", version: "1"}}, {type: "update-hint", id: 1, hint: {kind: "available"}}, {type: "update-hint", id: 1, hint: {kind: "available", version: ""}}, {type: "update-hint-end"}]) {
            expect(parseShellMessage(bad)).toBeNull();
        }
        for (const choice of ["download", "retry", "open-page", "later"]) expect(parsePageMessage({type: "update-choice", id: 3, choice})).not.toBeNull();
        expect(parsePageMessage({type: "update-hint-shown", id: 3})).toEqual({type: "update-hint-shown", id: 3});
        expect(parsePageMessage({type: "page-ready"})).toEqual({type: "page-ready"});
        expect(parsePageMessage({type: "page-gone"})).toEqual({type: "page-gone"});
        for (const bad of [{type: "update-choice", id: 3, choice: "install"}, {type: "update-choice", choice: "later"}, {type: "update-hint-shown", id: -1}]) {
            expect(parsePageMessage(bad)).toBeNull();
        }
    });

    it("窗口外框的消息：三种按钮动作、状态查询与最大化状态收下；不认识的动作、缺字段丢弃", () => {
        for (const action of ["minimize", "toggle-maximize", "close"] as const) expect(parsePageMessage({type: "window-control", action})).toEqual({type: "window-control", action});
        expect(parsePageMessage({type: "window-state-query"})).toEqual({type: "window-state-query"});
        expect(parseShellMessage({type: "window-state", maximized: true})).toEqual({type: "window-state", maximized: true});
        for (const bad of [{type: "window-control", action: "maximize"}, {type: "window-control"}]) expect(parsePageMessage(bad)).toBeNull();
        for (const bad of [{type: "window-state"}, {type: "window-state", maximized: "yes"}]) expect(parseShellMessage(bad)).toBeNull();
    });

    it("更新提示的 tray：布尔值收下、缺省也收下；不是布尔值的整条丢弃", () => {
        const hint = {kind: "downloaded", version: "0.90.2"} as const;
        expect(parseShellMessage({type: "update-hint", id: 1, hint, tray: true})).toEqual({type: "update-hint", id: 1, hint, tray: true});
        expect(parseShellMessage({type: "update-hint", id: 1, hint})).toEqual({type: "update-hint", id: 1, hint});
        expect(parseShellMessage({type: "update-hint", id: 1, hint, tray: "yes"})).toBeNull();
    });

    it("桌面设置的值：四项齐全才收下；缺一项、多一项、关窗去向或窗口背景不认识的值都丢弃", () => {
        const values = {zoom: 1.25, openAtLogin: false, closeLastWindow: "tray", windowBackdrop: "mica"} as const;
        expect(parsePageMessage({type: "desktop-settings", values})).toEqual({type: "desktop-settings", values});
        for (const bad of [{zoom: 1.25, openAtLogin: false}, {zoom: 1.25, openAtLogin: false, closeLastWindow: "tray"}, {...values, closeLastWindow: "hide"}, {...values, windowBackdrop: "glass"}, {...values, extra: 1}]) {
            expect(parsePageMessage({type: "desktop-settings", values: bad})).toBeNull();
        }
    });

    it("窗口明暗：dark 是布尔才收下", () => {
        expect(parsePageMessage({type: "window-appearance", dark: true})).toEqual({type: "window-appearance", dark: true});
        expect(parsePageMessage({type: "window-appearance", dark: "dark"})).toBeNull();
        expect(parsePageMessage({type: "window-appearance"})).toBeNull();
    });

    it("页面一侧：只把形状对的事件交给处理器；停止监听后不再收到", () => {
        const global = page();
        const seen: ShellMessage[] = [];
        const stop = createDesktopBridge(global).listen((message) => seen.push(message));
        global.dispatch({type: "close-query", generation: 1, reason: "window"});
        global.dispatch({type: "close-query", generation: "1", reason: "window"});
        global.dispatch(undefined);
        stop();
        global.dispatch({type: "close-end", generation: 1});
        expect(seen).toEqual([{type: "close-query", generation: 1, reason: "window"}]);
    });

    it("发送时才取壳的发送函数：一开始没有、后来出现的照样能发；没有时返回 false", () => {
        const sent: unknown[] = [];
        const global = page();
        const bridge = createDesktopBridge(global);
        expect(bridge.send({type: "close-ack", generation: 1})).toBe(false);
        global.__electrobunSendToHost = (message) => sent.push(message);
        expect(bridge.send({type: "close-answer", generation: 1, answer: "allow"})).toBe(true);
        expect(sent).toEqual([{type: "close-answer", generation: 1, answer: "allow"}]);
    });
});
