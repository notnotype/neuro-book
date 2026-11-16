/**
 * 桌面壳与页面之间的桥（docs/specs/runtime/desktop-shell.md 输出 10、13 到 15，docs/specs/runtime/browser-host.md 输出 9 到 11
 * 与“窗口外框”）。壳一侧（`desktop/src/bun/`）与页面一侧（`src/web/host/close-query.ts`、`desktop-updates.ts`、`desktop-frame.ts`）
 * 都从这里取消息形状与校验，两边不各写一份。
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

/** 窗口按钮（desktop-shell 输出 10）：最小化、在最大化与还原之间切换、关闭（与系统的关闭同一条路）。 */
export const WindowControlSchema = Type.Union([Type.Literal("minimize"), Type.Literal("toggle-maximize"), Type.Literal("close")]);
export type WindowControl = Static<typeof WindowControlSchema>;

/**
 * 预加载脚本在没有系统标题栏的窗口里定义的能力标记（只读，值为 1）：页面据此自己画窗口按钮。它只是渲染信号，不是安全边界。
 */
export const DESKTOP_FRAME_MARKER = "__nbookDesktopFrame";

/**
 * 桌面专属设置的有效值（desktop-shell 的“桌面专属设置”）：`nbook.desktop` 的页面入口从配置服务读出、经 `windowDesktopKey` 交给壳。
 * 设置的拥有者是服务端的 `nbook.settings`，壳只拿这份值、缓存上一次的。
 */
/** 界面缩放的档位（沿用 Chromium 的一组）：桥消息、壳的缓存与 `nbook.desktop` 的配置声明共用这一份。 */
export const ZoomLevelSchema = Type.Union([
    Type.Literal(0.5), Type.Literal(0.67), Type.Literal(0.75), Type.Literal(0.8), Type.Literal(0.9), Type.Literal(1),
    Type.Literal(1.1), Type.Literal(1.25), Type.Literal(1.5), Type.Literal(1.75), Type.Literal(2),
]);
export type ZoomLevel = Static<typeof ZoomLevelSchema>;

export const DesktopSettingValuesSchema = Type.Object({
    zoom: ZoomLevelSchema,
    openAtLogin: Type.Boolean(),
}, {additionalProperties: false});
export type DesktopSettingValues = Static<typeof DesktopSettingValuesSchema>;

/** 页面交回的选择：动作按钮（下载、重试、打开下载页）或关掉通知（“以后”）。 */
export const UpdateChoiceSchema = Type.Union([Type.Literal("download"), Type.Literal("retry"), Type.Literal("open-page"), Type.Literal("later")]);
export type UpdateChoice = Static<typeof UpdateChoiceSchema>;

const ShellMessageSchema = Type.Union([
    Type.Object({type: Type.Literal("close-query"), generation: Generation, reason: Type.Union([Type.Literal("window"), Type.Literal("quit")])}),
    Type.Object({type: Type.Literal("close-end"), generation: Generation}),
    /** 壳的当前更新提示交给这个窗口；同一个 `id` 可能再来（转交、刷新后重发）。 */
    Type.Object({type: Type.Literal("update-hint"), id: Generation, hint: UpdateHintSchema}),
    /** 这条提示已被新阶段取代或转给了别的窗口：收起它，连通知中心里的记录。 */
    Type.Object({type: Type.Literal("update-hint-end"), id: Generation}),
    /** 窗口是不是最大化：严格等于 Win32 的 IsZoomed，贴边分屏不算（desktop-shell 输出 10）。 */
    Type.Object({type: Type.Literal("window-state"), maximized: Type.Boolean()}),
]);

/**
 * 页面能发给壳的消息：关闭前询问的两种回答；更新提示的选择、“已显示”，页面就绪与离开就绪（壳据此交付、转交提示，
 * desktop-update 输出 3）；窗口按钮与窗口状态的查询；加上预加载脚本自己发的标题与新窗口请求。
 */
const PageMessageSchema = Type.Union([
    Type.Object({type: Type.Literal("close-ack"), generation: Generation}),
    Type.Object({type: Type.Literal("close-answer"), generation: Generation, answer: Type.Union([Type.Literal("allow"), Type.Literal("deny")])}),
    Type.Object({type: Type.Literal("update-choice"), id: Generation, choice: UpdateChoiceSchema}),
    Type.Object({type: Type.Literal("update-hint-shown"), id: Generation}),
    Type.Object({type: Type.Literal("page-ready")}),
    Type.Object({type: Type.Literal("page-gone")}),
    Type.Object({type: Type.Literal("window-control"), action: WindowControlSchema}),
    /** 外框一建立就问一次当前的窗口状态：整页导航之后、壳下一次推送之前，按钮不该显示错的字形。 */
    Type.Object({type: Type.Literal("window-state-query")}),
    Type.Object({type: Type.Literal("desktop-settings"), values: DesktopSettingValuesSchema}),
    Type.Object({type: Type.Literal("title"), title: Type.String()}),
    Type.Object({type: Type.Literal("open-window"), url: Type.String()}),
]);

export type ShellMessage = Static<typeof ShellMessageSchema>;
export type PageMessage = Static<typeof PageMessageSchema>;
/** 页面里的宿主发的消息（标题与新窗口请求只由预加载脚本发）。 */
export type HostReply = Exclude<PageMessage, {type: "title" | "open-window"}>;

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
    send(message: HostReply): boolean;
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
