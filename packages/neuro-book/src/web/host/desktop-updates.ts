/**
 * 页面一侧的更新提示（docs/specs/runtime/browser-host.md 输出 11，docs/specs/runtime/desktop-update.md 输出 3 到 10）：把桌面壳交来
 * 的提示发成工作台通知，把用户的选择交回壳；页面就绪与离开就绪时告诉壳，壳据此交付、转交提示。不依赖 Vue 与 DOM：桥、窗口
 * 与页面事件由装配方（`boot.ts`）给出。普通浏览器里没有壳的事件，这里只是空等。
 *
 * - 就绪：窗口状态是 `ready`，且页面已经挂好（`pagesMounted`，挂的是页面而不是启动失败页）。每个运行实例只报一次
 *   `page-ready`，连接在在线与离线之间变化不再报；离开 `ready` 与 `pagehide` 时报 `page-gone`。发送失败写诊断，下一次状态变化
 *   时再试。
 * - 就绪之前来的提示先存着，就绪后再发。
 * - 同一个 id 再来时，这一页已经发过就不再发（点了动作、被用户关掉、到时消失都算发过）：壳在需要时会换新 id。
 * - `update-hint-end`：撤掉这条通知，连通知中心的记录一起删（被新阶段取代后，留着旧的“下载”只会让人点到旧版本）；之后同一个
 *   id 再交来时重新发（提示转走后又转回这个窗口）。
 * - 发出通知后回 `update-hint-shown`。
 */

import type {DiagnosticInput} from "@notnotype/nb-runtime/diagnostics";

import type {NotificationHandle, NotificationInput, Notifications} from "nbook/plugins/workbench/shared/contracts";
import type {DesktopBridge, HostReply, UpdateChoice, UpdateHint} from "nbook/shared/desktop-bridge";

import {hostText} from "../host-text";
import type {WindowState} from "./window";

export interface DesktopUpdatesWindow {
    readonly state: WindowState;
    onChange(listener: (state: WindowState) => void): () => void;
    notifications(): Notifications | null;
}

/** 页面全局对象里用到的部分：页面卸载。 */
export interface DesktopUpdatesPage {
    addEventListener(type: "pagehide", listener: () => void): void;
    removeEventListener(type: "pagehide", listener: () => void): void;
}

export interface DesktopUpdatesOptions {
    readonly bridge: DesktopBridge;
    readonly window: DesktopUpdatesWindow;
    readonly page: DesktopUpdatesPage;
    readonly report: (input: DiagnosticInput) => void;
}

export interface DesktopUpdates {
    /** 页面（不是启动失败页）挂好了。 */
    pagesMounted(): void;
    dispose(): void;
}

/** 每种提示怎么显示（计划“页面一侧”的表）；`choice` 是动作按钮交回的选择，`closeChoice` 是用户关掉时交回的。 */
function presentation(hint: UpdateHint): {readonly input: Omit<NotificationInput, "action" | "onClose">; readonly action: {readonly label: string; readonly choice: UpdateChoice} | null; readonly closeChoice: UpdateChoice | null} {
    const version = {version: hint.version};
    switch (hint.kind) {
        case "available":
            return {input: {tone: "info", sticky: true, title: hostText("update.available.title", version), message: hostText("update.available.message")}, action: {label: "update.action.download", choice: "download"}, closeChoice: "later"};
        case "notify-only":
            return {input: {tone: "info", sticky: true, title: hostText("update.notifyOnly.title", version), message: hostText(hint.envRoot === true ? "update.notifyOnly.envRootMessage" : "update.notifyOnly.message")}, action: {label: "update.action.openPage", choice: "open-page"}, closeChoice: "later"};
        case "downloading":
            return {input: {tone: "info", sticky: true, progress: null, title: hostText("update.downloading.title", version), message: hostText("update.downloading.message")}, action: null, closeChoice: null};
        case "download-failed":
            return {input: {tone: "warning", sticky: true, title: hostText("update.downloadFailed.title"), message: hostText("update.downloadFailed.message", version)}, action: {label: "update.action.retry", choice: "retry"}, closeChoice: "later"};
        case "downloaded":
            return {input: {tone: "success", sticky: false, title: hostText("update.downloaded.title", version), message: hostText("update.downloaded.message")}, action: null, closeChoice: null};
        case "updated":
            return {input: {tone: "success", sticky: false, title: hostText("update.updated.title", version), message: hostText("update.updated.message")}, action: null, closeChoice: null};
        case "update-failed":
            return {input: {tone: "warning", sticky: false, title: hostText("update.updateFailed.title"), message: hostText("update.updateFailed.message", version)}, action: null, closeChoice: null};
    }
}

export function createDesktopUpdates(options: DesktopUpdatesOptions): DesktopUpdates {
    let mounted = false;
    /** 已报过 `page-ready` 的运行实例；离开就绪（报过 `page-gone`）后为 null。 */
    let reportedReady: string | null = null;
    /** 还没发出的提示（还没就绪，或工作台没交出通知服务）。 */
    const pending = new Map<number, UpdateHint>();
    /** 这一页已经发过的提示；句柄在被撤掉时用。 */
    const shown = new Map<number, NotificationHandle>();

    const send = (message: HostReply): boolean => {
        try {
            if (options.bridge.send(message)) return true;
            options.report({level: "warn", event: "browser-host.update.no-bridge", message: "页面里没有桌面壳的发送函数，更新提示的回复发不出去", data: {type: message.type}});
        } catch (error) {
            options.report({level: "warn", event: "browser-host.update.send-failed", message: "给桌面壳回消息失败", error, data: {type: message.type}});
        }
        return false;
    };

    const show = (id: number, hint: UpdateHint, notifications: Notifications): void => {
        const {input, action, closeChoice} = presentation(hint);
        const handle = notifications.notify({
            ...input,
            ...(action === null ? {} : {action: {label: hostText(action.label), run: () => void send({type: "update-choice", id, choice: action.choice})}}),
            ...(closeChoice === null ? {} : {onClose: () => void send({type: "update-choice", id, choice: closeChoice})}),
        });
        shown.set(id, handle);
        send({type: "update-hint-shown", id});
    };

    const ready = (): boolean => mounted && options.window.state.status === "ready";

    const flush = (): void => {
        if (!ready() || pending.size === 0) return;
        const notifications = options.window.notifications();
        if (notifications === null) {
            options.report({level: "warn", event: "browser-host.update.no-notifications", message: "工作台没有交出通知服务，更新提示显示不了", data: {pending: pending.size}});
            return;
        }
        for (const [id, hint] of [...pending]) {
            pending.delete(id);
            show(id, hint, notifications);
        }
    };

    const sync = (): void => {
        const state = options.window.state;
        if (state.status === "ready" && mounted) {
            if (reportedReady !== state.instanceId && send({type: "page-ready"})) reportedReady = state.instanceId;
            flush();
            return;
        }
        if (state.status !== "ready" && reportedReady !== null && send({type: "page-gone"})) reportedReady = null;
    };

    const stopListening = options.bridge.listen((message) => {
        if (message.type === "update-hint") {
            if (shown.has(message.id)) return;
            pending.set(message.id, message.hint);
            flush();
            return;
        }
        if (message.type === "update-hint-end") {
            pending.delete(message.id);
            shown.get(message.id)?.dismiss();
            shown.delete(message.id);
        }
    });
    const stopWatching = options.window.onChange(sync);
    const onPageHide = (): void => {
        if (reportedReady !== null && send({type: "page-gone"})) reportedReady = null;
    };
    options.page.addEventListener("pagehide", onPageHide);

    return {
        pagesMounted() {
            mounted = true;
            sync();
        },
        dispose() {
            stopListening();
            stopWatching();
            options.page.removeEventListener("pagehide", onPageHide);
        },
    };
}
