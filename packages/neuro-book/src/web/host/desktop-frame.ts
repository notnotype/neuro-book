/**
 * 桌面窗口的外框（docs/specs/runtime/browser-host.md 的“窗口外框”，docs/specs/runtime/desktop-shell.md 输出 10）：窗口没有系统
 * 标题栏时，页面自己画窗口按钮；页面自己没有标题栏时（书架首页、宿主页），再画一条后备的标题栏。这里管状态与 `<html>` 上的
 * 属性，`DesktopFrame.vue` 只按状态画（与 `close-ui.ts`、`CloseLayer.vue` 同形）。不依赖 Vue 之外的东西，DOM 由装配方给。
 *
 * 判断“窗口没有系统标题栏”只看预加载脚本定义的能力标记（`DESKTOP_FRAME_MARKER`），不看是不是桌面：标记只在壳决定自己画外框的
 * 窗口里有。普通浏览器里没有标记，这里什么都不做。
 *
 * `<html>` 上的属性是样式与壳之间的约定，样式只认属性（`styles.css`），变量的值写在样式里：
 *
 * - `data-desktop-frame`：外框开着。预加载在页面脚本之前就设了（静态加载页要用），这里再设一次，e2e 与真实路径一致。
 * - `data-desktop-frame-bar`：页面没有自己的标题栏，宿主画后备标题栏，页面整体下移 36px。
 *
 * 页面有没有自己的标题栏，看 `#app` 子树里有没有 `[data-desktop-titlebar]`。观察整个子树要经得起编辑器、对话流这类持续改 DOM
 * 的地方，所以回调按帧合并，并且已经找到、那个元素还连在文档上时不再查询。
 */

import {shallowRef} from "vue";
import type {ShallowRef} from "vue";

import type {DiagnosticInput} from "@notnotype/nb-runtime/diagnostics";

import {DESKTOP_FRAME_MARKER} from "nbook/shared/desktop-bridge";
import type {DesktopBridge, WindowControl} from "nbook/shared/desktop-bridge";

export interface DesktopFrameState {
    /** 壳推来的最大化状态；还没推来时为 false。 */
    readonly maximized: boolean;
    /** 页面自己画了标题栏（`[data-desktop-titlebar]`）；为 false 时宿主画后备标题栏。 */
    readonly pageTitlebar: boolean;
    /** 窗口在前台：不在前台时按钮字形变淡。 */
    readonly focused: boolean;
    /** 文档标题，后备标题栏显示它。 */
    readonly title: string;
}

export interface DesktopFrame {
    /** 窗口没有系统标题栏、要画外框。为 false 时 `state` 不变，`control` 什么都不做。 */
    readonly enabled: boolean;
    readonly state: Readonly<ShallowRef<DesktopFrameState>>;
    /** 按钮被按下：交给壳；发不出去时写诊断。 */
    control(action: WindowControl): void;
    dispose(): void;
}

/** 页面全局对象里用到的部分。 */
export interface DesktopFrameGlobal {
    /** 预加载脚本定义的能力标记（`DESKTOP_FRAME_MARKER`），值为 1 表示窗口没有系统标题栏。 */
    readonly __nbookDesktopFrame?: unknown;
    addEventListener(type: "focus" | "blur", listener: () => void): void;
    removeEventListener(type: "focus" | "blur", listener: () => void): void;
    requestAnimationFrame(callback: () => void): number;
    cancelAnimationFrame(handle: number): void;
}

export interface DesktopFrameOptions {
    readonly global: DesktopFrameGlobal;
    readonly bridge: DesktopBridge;
    readonly document: Document;
    readonly report: (input: DiagnosticInput) => void;
}

/** 页面自己画的标题栏要带的属性（合同见 browser-host 的“窗口外框”）。 */
export const DESKTOP_TITLEBAR_SELECTOR = "[data-desktop-titlebar]";

export function createDesktopFrame(options: DesktopFrameOptions): DesktopFrame {
    const {document} = options;
    const state = shallowRef<DesktopFrameState>({maximized: false, pageTitlebar: false, focused: document.hasFocus(), title: document.title});
    if (options.global[DESKTOP_FRAME_MARKER] !== 1) {
        return {enabled: false, state, control() {}, dispose() {}};
    }

    const html = document.documentElement;
    html.setAttribute("data-desktop-frame", "");
    const update = (patch: Partial<DesktopFrameState>): void => {
        const next = {...state.value, ...patch};
        html.toggleAttribute("data-desktop-frame-bar", !next.pageTitlebar);
        state.value = next;
    };

    let titlebar: Element | null = null;
    const findTitlebar = (): void => {
        if (titlebar?.isConnected === true) return;
        titlebar = document.getElementById("app")?.querySelector(DESKTOP_TITLEBAR_SELECTOR) ?? null;
        if ((titlebar !== null) !== state.value.pageTitlebar) update({pageTitlebar: titlebar !== null});
    };
    let frame: number | null = null;
    const app = document.getElementById("app");
    const titlebarObserver = new MutationObserver(() => {
        if (frame !== null) return;
        frame = options.global.requestAnimationFrame(() => {
            frame = null;
            findTitlebar();
        });
    });
    if (app !== null) titlebarObserver.observe(app, {childList: true, subtree: true});

    // 文档标题由路由与语言切换改写（`router.ts` 的 afterEach）：观察 `<head>` 里 `<title>` 的增删与文字。
    const titleObserver = new MutationObserver(() => {
        if (document.title !== state.value.title) update({title: document.title});
    });
    titleObserver.observe(document.head, {childList: true, subtree: true, characterData: true});

    const onFocus = (): void => update({focused: true});
    // 焦点进了页面里的 iframe（HTML 预览）时窗口也收到 blur，但它仍在前台：以 `document.hasFocus()` 为准。
    const onBlur = (): void => update({focused: document.hasFocus()});
    options.global.addEventListener("focus", onFocus);
    options.global.addEventListener("blur", onBlur);

    const unlisten = options.bridge.listen((message) => {
        if (message.type === "window-state" && message.maximized !== state.value.maximized) update({maximized: message.maximized});
    });

    const send = (message: Parameters<DesktopBridge["send"]>[0]): void => {
        try {
            if (!options.bridge.send(message)) options.report({level: "warn", event: "browser-host.frame.no-bridge", message: "The desktop shell send function is missing", data: {type: message.type}});
        } catch (error) {
            options.report({level: "warn", event: "browser-host.frame.send-failed", message: "Sending to the desktop shell failed", error, data: {type: message.type}});
        }
    };

    update({});
    findTitlebar();
    // 整页导航之后，壳下一次推送要等到页面报就绪；先问一次，按钮的字形从一开始就对。
    send({type: "window-state-query"});

    return {
        enabled: true,
        state,
        control: (action) => send({type: "window-control", action}),
        dispose() {
            titlebarObserver.disconnect();
            titleObserver.disconnect();
            if (frame !== null) options.global.cancelAnimationFrame(frame);
            options.global.removeEventListener("focus", onFocus);
            options.global.removeEventListener("blur", onBlur);
            unlisten();
        },
    };
}
