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
