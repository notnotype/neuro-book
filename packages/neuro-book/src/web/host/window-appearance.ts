/**
 * 磨砂窗口的明暗（docs/specs/runtime/desktop-shell.md 输出 32，docs/specs/runtime/browser-host.md 的“窗口外框”）：窗口带磨砂背景
 * （预加载脚本在 `<html>` 上设了 `data-window-backdrop`）时，把页面当前的明暗交给壳，壳据此设 DWM 的明暗标志，磨砂的底色才与页面同向
 * ——亮色页面放在深色磨砂上字读不清。明暗取文档根上的 `data-nb-appearance`（主题写的，同 `appearance-hint.ts`），变了再交一次。
 *
 * 没有 `data-window-backdrop`（普通窗口、普通浏览器）时什么都不做。属性由预加载脚本在页面脚本之前设好，这里只在启动时看一次。
 */

import type {DesktopBridge} from "nbook/shared/desktop-bridge";

export interface WindowAppearanceOptions {
    readonly document: Document;
    readonly bridge: DesktopBridge;
    /** 没有桥或发送失败：不重试，下一次明暗变化时再交。 */
    readonly report: (event: string, error?: unknown) => void;
}

/** 交回停止观察的函数。 */
export function watchWindowAppearance(options: WindowAppearanceOptions): () => void {
    const root = options.document.documentElement;
    if (!root.hasAttribute("data-window-backdrop")) return () => undefined;
    let sent: boolean | null = null;
    const send = (): void => {
        const appearance = root.dataset.nbAppearance;
        if (appearance !== "light" && appearance !== "dark") return;
        const dark = appearance === "dark";
        if (dark === sent) return;
        try {
            if (options.bridge.send({type: "window-appearance", dark})) sent = dark;
            else options.report("browser-host.window-appearance.no-bridge");
        } catch (error) {
            options.report("browser-host.window-appearance.send-failed", error);
        }
    };
    const observer = new MutationObserver(send);
    observer.observe(root, {attributes: true, attributeFilter: ["data-nb-appearance"]});
    send();
    return () => observer.disconnect();
}
