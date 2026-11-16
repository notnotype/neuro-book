/**
 * 页面一侧的更新提示（docs/specs/runtime/browser-host.md 输出 11，docs/specs/runtime/desktop-update.md 输出 3 到 10）：真实的桥
 * （`createDesktopBridge`，事件经 `EventTarget` 派发，与壳经 `executeJavascript` 派发的同形）；窗口与通知服务是替身，通知服务
 * 记下发出的通知并由测试点动作、关掉。工作台通知本身的行为（动作后移除、关闭调 `onClose`）在工作台的通知测试里。
 */

import {describe, expect, it} from "bun:test";

import type {NotificationInput, Notifications} from "nbook/plugins/workbench/shared/contracts";
import {createDesktopBridge, DESKTOP_EVENT} from "nbook/shared/desktop-bridge";
import type {UpdateHint} from "nbook/shared/desktop-bridge";

import {createDesktopUpdates} from "./desktop-updates";
import type {WindowState} from "./window";

const READY = (instanceId: string, connection: "online" | "offline" = "online"): WindowState => ({status: "ready", instanceId, connection, project: null, root: {pages: () => []}});

function harness(options: {notifications?: boolean; failSend?: boolean; noShell?: boolean} = {}) {
    const target = new EventTarget();
    const sent: unknown[] = [];
    let failSend = options.failSend ?? false;
    const bridge = createDesktopBridge({
        addEventListener: (type, listener) => target.addEventListener(type, listener as EventListener),
        removeEventListener: (type, listener) => target.removeEventListener(type, listener as EventListener),
        // 普通浏览器：预加载脚本没有留下发送函数。
        ...(options.noShell === true ? {} : {
            __electrobunSendToHost: (message: unknown) => {
                if (failSend) throw new Error("bridge is gone");
                sent.push(message);
            },
        }),
    });
    let state: WindowState = {status: "starting", projectTitle: null};
    const listeners = new Set<(state: WindowState) => void>();
    const shown: Array<{input: NotificationInput; dismissed: boolean}> = [];
    const notifications: Notifications = {
        notify(input) {
            const entry = {input, dismissed: false};
            shown.push(entry);
            return {id: String(shown.length), update: () => undefined, dismiss: () => void (entry.dismissed = true)};
        },
    };
    const pageListeners = {pagehide: new Set<() => void>(), pageshow: new Set<() => void>()};
    const reports: string[] = [];
    const updates = createDesktopUpdates({
        bridge,
        window: {
            get state() {
                return state;
            },
            onChange(listener) {
                listeners.add(listener);
                return () => listeners.delete(listener);
            },
            notifications: () => (state.status === "ready" && (options.notifications ?? true) ? notifications : null),
        },
        page: {addEventListener: (type, listener) => void pageListeners[type].add(listener), removeEventListener: (type, listener) => void pageListeners[type].delete(listener)},
        report: (input) => void reports.push(input.event),
    });
    return {
        updates,
        sent,
        shown,
        reports,
        setState(next: WindowState) {
            state = next;
            for (const listener of listeners) listener(next);
        },
        hint: (id: number, hint: UpdateHint) => target.dispatchEvent(new CustomEvent(DESKTOP_EVENT, {detail: {type: "update-hint", id, hint}})),
        end: (id: number) => target.dispatchEvent(new CustomEvent(DESKTOP_EVENT, {detail: {type: "update-hint-end", id}})),
        pageHide: () => pageListeners.pagehide.forEach((listener) => listener()),
        pageShow: () => pageListeners.pageshow.forEach((listener) => listener()),
        setFailSend: (value: boolean) => void (failSend = value),
    };
}

/** 文字引用的键（`hostText` 构造的 `TextRef`）。 */
const key = (text: unknown) => (text as {key?: string} | undefined)?.key;

describe("页面一侧的更新提示", () => {
    it("七种提示各成计划表里的形状：色调、常驻、动作与用户关闭交回的选择", () => {
        const h = harness();
        h.setState(READY("i1"));
        h.updates.pagesMounted();
        const kinds: Array<UpdateHint["kind"]> = ["available", "notify-only", "downloading", "download-failed", "downloaded", "updated", "update-failed"];
        kinds.forEach((kind, index) => h.hint(index + 1, {kind, version: "0.90.2"}));
        const shape = h.shown.map(({input}) => ({tone: input.tone, sticky: input.sticky, progress: input.progress, action: key(input.action?.label), closes: input.onClose !== undefined}));
        expect(shape).toEqual([
            {tone: "info", sticky: true, progress: undefined, action: "update.action.download", closes: true},
            {tone: "info", sticky: true, progress: undefined, action: "update.action.openPage", closes: true},
            {tone: "info", sticky: true, progress: null, action: undefined, closes: false},
            {tone: "warning", sticky: true, progress: undefined, action: "update.action.retry", closes: true},
            {tone: "success", sticky: false, progress: undefined, action: undefined, closes: false},
            {tone: "success", sticky: false, progress: undefined, action: undefined, closes: false},
            {tone: "warning", sticky: false, progress: undefined, action: undefined, closes: false},
        ]);
        expect(h.sent.filter((message) => (message as {type: string}).type === "update-hint-shown")).toHaveLength(7);
        h.shown[0]?.input.action?.run();
        h.shown[1]?.input.action?.run();
        h.shown[3]?.input.action?.run();
        h.shown[0]?.input.onClose?.();
        expect(h.sent.filter((message) => (message as {type: string}).type === "update-choice")).toEqual([
            {type: "update-choice", id: 1, choice: "download"},
            {type: "update-choice", id: 2, choice: "open-page"},
            {type: "update-choice", id: 4, choice: "retry"},
            {type: "update-choice", id: 1, choice: "later"},
        ]);
    });

    it("只提示的正文：设了 NBOOK_STATE_ROOT 时换成说明不设时可以自动更新的那句；标题带版本", () => {
        const h = harness();
        h.setState(READY("i1"));
        h.updates.pagesMounted();
        h.hint(1, {kind: "notify-only", version: "0.90.2"});
        h.hint(2, {kind: "notify-only", version: "0.90.3", envRoot: true});
        expect(h.shown.map(({input}) => key(input.message))).toEqual(["update.notifyOnly.message", "update.notifyOnly.envRootMessage"]);
        expect(h.shown[1]?.input.title).toMatchObject({key: "update.notifyOnly.title", params: {version: "0.90.3"}});
    });

    it("page-ready 在页面挂好之后、每个运行实例一次；在线与离线的变化不再报；离开就绪与 pagehide 报 page-gone", () => {
        const h = harness();
        h.setState(READY("i1"));
        expect(h.sent).toEqual([]);
        h.updates.pagesMounted();
        h.setState(READY("i1", "offline"));
        h.setState(READY("i1", "online"));
        expect(h.sent).toEqual([{type: "page-ready"}]);
        h.setState({status: "server-restarted", reason: "x"});
        expect(h.sent).toEqual([{type: "page-ready"}, {type: "page-gone"}]);
        h.pageHide();
        expect(h.sent).toHaveLength(2);

        const hidden = harness();
        hidden.setState(READY("i1"));
        hidden.updates.pagesMounted();
        hidden.pageHide();
        expect(hidden.sent).toEqual([{type: "page-ready"}, {type: "page-gone"}]);
        // 从往返缓存恢复：页面还是那一页、仍然就绪，重新报就绪。
        hidden.pageShow();
        expect(hidden.sent).toEqual([{type: "page-ready"}, {type: "page-gone"}, {type: "page-ready"}]);
    });

    it("普通浏览器（没有壳）：报就绪与离开发不出去，不写诊断", () => {
        const h = harness({noShell: true});
        h.setState(READY("i1"));
        h.updates.pagesMounted();
        h.setState(READY("i1", "offline"));
        h.setState({status: "server-restarted", reason: "x"});
        h.setState(READY("i2"));
        h.pageHide();
        expect(h.reports).toEqual([]);
    });

    it("就绪前来的提示先存着，挂好后再显示；启动失败页（没挂页面）不显示、不报就绪", () => {
        const h = harness();
        h.hint(5, {kind: "available", version: "0.90.2"});
        h.setState(READY("i1"));
        expect(h.shown).toEqual([]);
        h.updates.pagesMounted();
        expect(h.shown).toHaveLength(1);
        expect(h.sent).toEqual([{type: "page-ready"}, {type: "update-hint-shown", id: 5}]);

        const failed = harness();
        failed.hint(5, {kind: "available", version: "0.90.2"});
        failed.setState(READY("i1"));
        expect(failed.shown).toEqual([]);
        expect(failed.sent).toEqual([]);
    });

    it("同一个 id 再来不重发（发过就算，点了动作或被关掉也一样）；收起时撤掉通知，之后转回来的同一 id 重新发", () => {
        const h = harness();
        h.setState(READY("i1"));
        h.updates.pagesMounted();
        h.hint(1, {kind: "available", version: "0.90.2"});
        h.shown[0]?.input.onClose?.();
        h.hint(1, {kind: "available", version: "0.90.2"});
        expect(h.shown).toHaveLength(1);
        h.end(1);
        expect(h.shown[0]?.dismissed).toBe(true);
        h.hint(1, {kind: "available", version: "0.90.2"});
        expect(h.shown).toHaveLength(2);
        // 还没显示就被收起：不再显示。
        h.setState({status: "starting", projectTitle: null});
        h.hint(2, {kind: "downloading", version: "0.90.2"});
        h.end(2);
        h.setState(READY("i1"));
        expect(h.shown).toHaveLength(2);
    });

    it("工作台没交出通知服务：提示留着并写诊断；发送失败写诊断，下一次状态变化时再报就绪", () => {
        const none = harness({notifications: false});
        none.setState(READY("i1"));
        none.updates.pagesMounted();
        none.hint(1, {kind: "available", version: "0.90.2"});
        expect(none.reports).toEqual(["browser-host.update.no-notifications"]);

        const failing = harness({failSend: true});
        failing.setState(READY("i1"));
        failing.updates.pagesMounted();
        expect(failing.reports).toEqual(["browser-host.update.send-failed"]);
        failing.setFailSend(false);
        failing.setState(READY("i1", "offline"));
        expect(failing.sent).toEqual([{type: "page-ready"}]);
    });

    it("dispose 之后不再收提示", () => {
        const h = harness();
        h.setState(READY("i1"));
        h.updates.pagesMounted();
        h.updates.dispose();
        h.hint(1, {kind: "available", version: "0.90.2"});
        expect(h.shown).toEqual([]);
    });
});
