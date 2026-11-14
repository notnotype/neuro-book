/**
 * 桌面壳与页面之间的桥（docs/specs/runtime/desktop-shell.md 输出 13 到 15，docs/specs/runtime/browser-host.md 输出 9 到 11）。
 * 壳一侧（`desktop/src/bun/`）与页面一侧（`src/web/host/close-query.ts`）都从这里取消息形状与校验，两边不各写一份。
 *
 * 通道是 Electrobun 的事件桥：壳经 `executeJavascript` 在页面里派发 `nbook-desktop` 事件（`detail` 是壳的消息）；页面经
 * 预加载脚本留下的 `window.__electrobunSendToHost(message)` 回消息。同一页面里的脚本都能发（插件完全信任，ADR 0022），所以
 * 壳只按网页视图、代次与形状认消息，不认发送方。
 */

import {Type} from "typebox";
import type {Static} from "typebox";
import {Value} from "typebox/value";

/** 关窗的原因：`quit` 是关掉以后自有服务端会停止（最后一次关闭）。 */
export type CloseReason = "window" | "quit";

/** 壳在页面里派发的事件名。 */
export const DESKTOP_EVENT = "nbook-desktop";

const Generation = Type.Integer({minimum: 0});

/**
 * 更新提示（docs/specs/runtime/desktop-update.md 输出 3 到 10）：壳至多持有一条，按种类决定页面怎么显示、收什么选择。
 * `envRoot` 只在 `notify-only` 上：这次启动设了 `NBOOK_STATE_ROOT`，正文另说明不设时可以自动更新。
 */
export const UpdateHintSchema = Type.Object({
    kind: Type.Union([
        Type.Literal("available"),
        Type.Literal("notify-only"),
        Type.Literal("downloading"),
        Type.Literal("download-failed"),
        Type.Literal("downloaded"),
        Type.Literal("updated"),
        Type.Literal("update-failed"),
    ]),
    version: Type.String({minLength: 1}),
    envRoot: Type.Optional(Type.Boolean()),
});
export type UpdateHint = Static<typeof UpdateHintSchema>;
export type UpdateHintKind = UpdateHint["kind"];

/** 页面交回的选择：动作按钮（下载、重试、打开下载页）或关掉通知（“以后”）。 */
export const UpdateChoiceSchema = Type.Union([Type.Literal("download"), Type.Literal("retry"), Type.Literal("open-page"), Type.Literal("later")]);
export type UpdateChoice = Static<typeof UpdateChoiceSchema>;

const ShellMessageSchema = Type.Union([
    Type.Object({type: Type.Literal("close-query"), generation: Generation, reason: Type.Union([Type.Literal("window"), Type.Literal("quit")])}),
    Type.Object({type: Type.Literal("close-end"), generation: Generation}),
]);

/** 页面能发给壳的消息：关闭前询问的两种回答，加上预加载脚本自己发的标题与新窗口请求。 */
const PageMessageSchema = Type.Union([
    Type.Object({type: Type.Literal("close-ack"), generation: Generation}),
    Type.Object({type: Type.Literal("close-answer"), generation: Generation, answer: Type.Union([Type.Literal("allow"), Type.Literal("deny")])}),
    Type.Object({type: Type.Literal("title"), title: Type.String()}),
    Type.Object({type: Type.Literal("open-window"), url: Type.String()}),
]);

export type ShellMessage = Static<typeof ShellMessageSchema>;
export type PageMessage = Static<typeof PageMessageSchema>;
/** 页面里的宿主发的那两种（另两种只由预加载脚本发）。 */
export type CloseReply = Extract<PageMessage, {type: "close-ack" | "close-answer"}>;

/** 壳发来的消息；形状不对返回 null（页面里别的脚本也能派发同名事件）。 */
export function parseShellMessage(value: unknown): ShellMessage | null {
    return Value.Check(ShellMessageSchema, value) ? value : null;
}

/** 页面发来的消息；形状不对返回 null。 */
export function parsePageMessage(value: unknown): PageMessage | null {
    return Value.Check(PageMessageSchema, value) ? value : null;
}

/** 页面一侧的桥。 */
export interface DesktopBridge {
    /** 订阅壳的消息；形状不对的事件丢弃。 */
    listen(handler: (message: ShellMessage) => void): () => void;
    /** 回壳；没有壳的发送函数时返回 false。 */
    send(message: CloseReply): boolean;
}

/** 页面的全局对象里桥用到的部分。 */
export interface BridgeGlobal {
    addEventListener(type: string, listener: (event: unknown) => void): void;
    removeEventListener(type: string, listener: (event: unknown) => void): void;
    __electrobunSendToHost?: (message: unknown) => void;
}

/**
 * 总是监听壳的事件（普通浏览器里不会有这个事件），发送时才取 `__electrobunSendToHost`：预加载脚本同样在调用时才取，它出现的
 * 时刻不由页面决定，启动时取一次不够。取不到时由调用方写诊断。
 */
export function createDesktopBridge(global: BridgeGlobal): DesktopBridge {
    return {
        listen(handler) {
            const listener = (event: unknown): void => {
                const message = parseShellMessage((event as {detail?: unknown} | null)?.detail);
                if (message !== null) handler(message);
            };
            global.addEventListener(DESKTOP_EVENT, listener);
            return () => global.removeEventListener(DESKTOP_EVENT, listener);
        },
        send(message) {
            const send = global.__electrobunSendToHost;
            if (typeof send !== "function") return false;
            send(message);
            return true;
        },
    };
}
