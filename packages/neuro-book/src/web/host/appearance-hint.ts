/**
 * 加载页的明暗提示（docs/specs/runtime/browser-host.md 启动序列第 1 步）：加载页在任何脚本之前画出第一帧，那时还不知道
 * 产品主题，只能靠上一次的记录。宿主观察文档根上的主题（明暗、主题包与配色的内联变量），每次变了就把明暗与加载页要用的
 * 四种颜色记进本地存储；两份 index.html 头部的内联脚本在第一帧前读它。
 *
 * 读的一方是内联脚本，不能 import 这里：键名、字段与颜色格式两边各写一份，`appearance-hint.dom.test.ts` 核对它们一致。
 * 谁写文档根就记谁：Lab 也写文档根，在 Lab 里切过明暗，下次加载页取的就是 Lab 最后的明暗。
 */

import {SKIN_VARS} from "nbook/ui/theme/skin-vars";

export const HOST_APPEARANCE_KEY = "nbook.host-appearance";

export interface HostAppearanceHint {
    readonly appearance: "light" | "dark";
    /** 以下都是计算后的颜色（`rgb(…)`）：加载页的底色、书名、提示与进度条。 */
    readonly background: string;
    readonly text: string;
    readonly muted: string;
    readonly accent: string;
    /**
     * 主题的场景图（只有同源的 `pathname`）与进度样式（缺省的 `bar` 不记）：加载页用它们画背景与进度指示（docs/specs/theme/skins.md 输出 19）。
     * 两个字段各自独立：缺一个或不合格只是这一项退回缺省，不影响颜色，也不影响彼此。
     */
    readonly scene?: string;
    readonly indicator?: "dots" | "pulse" | "page";
}

const INDICATORS: ReadonlySet<string> = new Set(["dots", "pulse", "page"]);
/** 路径里不能有引号、括号、反斜杠与空白：它会被放进 `url("…")`。内联脚本读时做同样的检查。 */
const SAFE_PATH = /^\/[^"'()\\\s]+$/u;

/**
 * 文档根上 `--skin-loading-scene` 的值（`url("…")`）转成同源的路径；不是同源、带用户名密码、带查询或片段、路径含不安全字符的都不认。
 * 地址一律先按浏览器的 URL 规则解析再判同源，不用正则当同源校验：内置主题素材在开发服务里是绝对地址（`new URL(…, import.meta.url)`），
 * 在产物里是 `/assets/…`，插件素材与用户素材是 `/api/…` 的相对地址，`//host/…` 这类协议相对地址解析后是别的主机。
 */
export function hostScenePath(value: string, location: Pick<Location, "href" | "origin">): string | null {
    const raw = /^url\(\s*(["'])(.*)\1\s*\)$/u.exec(value.trim())?.[2];
    if (raw === undefined) return null;
    let url: URL;
    try {
        url = new URL(raw, location.href);
    } catch {
        return null;
    }
    if (url.origin !== location.origin || url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") return null;
    return url.pathname.startsWith("//") || !SAFE_PATH.test(url.pathname) ? null : url.pathname;
}

/** 加载页的四种颜色取自这些主题变量。 */
const SOURCES = {background: "--panel-surface", text: "--text-main", muted: "--text-muted", accent: "--accent-main"} as const;

/** 本地存储的最小写入面；浏览器里是 `window.localStorage`。 */
export interface HintStorage {
    setItem(key: string, value: string): void;
}

/** 文档根上当前的明暗与颜色；还没有写主题（没有明暗，或某个变量没有定义）时为 null。 */
export function readDocumentHint(root: HTMLElement): HostAppearanceHint | null {
    const appearance = root.dataset.nbAppearance;
    if (appearance !== "light" && appearance !== "dark") return null;
    const declared = getComputedStyle(root);
    if (Object.values(SOURCES).some((name) => declared.getPropertyValue(name).trim() === "")) return null;
    // 主题变量可能是 color-mix 之类的表达式：借一个元素的 color 让浏览器算成 rgb，内联脚本只需认 rgb。
    const probe = root.ownerDocument.createElement("span");
    probe.hidden = true;
    root.ownerDocument.body.append(probe);
    const resolve = (name: string): string => {
        probe.style.color = `var(${name})`;
        return getComputedStyle(probe).color;
    };
    const scene = hostScenePath(declared.getPropertyValue(SKIN_VARS.loadingScene), root.ownerDocument.location);
    const indicator = declared.getPropertyValue(SKIN_VARS.loadingIndicator).trim();
    try {
        return {
            appearance,
            background: resolve(SOURCES.background),
            text: resolve(SOURCES.text),
            muted: resolve(SOURCES.muted),
            accent: resolve(SOURCES.accent),
            ...(scene === null ? {} : {scene}),
            ...(INDICATORS.has(indicator) ? {indicator: indicator as "dots" | "pulse" | "page"} : {}),
        };
    } finally {
        probe.remove();
    }
}

export interface RememberAppearanceOptions {
    readonly root: HTMLElement;
    readonly storage: () => HintStorage;
    readonly warn: (message: string) => void;
}

/** 开始记录：先记一次当前的，之后文档根的主题每变一次记一次（值没变不写）。返回停止观察的函数。 */
export function rememberDocumentAppearance(options: RememberAppearanceOptions): () => void {
    let written = "";
    let warned = false;
    const record = (): void => {
        const hint = readDocumentHint(options.root);
        if (hint === null) return;
        const value = JSON.stringify(hint);
        if (value === written) return;
        try {
            options.storage().setItem(HOST_APPEARANCE_KEY, value);
            written = value;
        } catch (error) {
            // 存储不可用（隐私模式、被禁用、配额已满）只影响下一次加载页的颜色：说一次，不打断工作台。
            if (!warned) options.warn(`加载页的明暗提示写不进本地存储：${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
            warned = true;
        }
    };
    const observer = new MutationObserver(record);
    observer.observe(options.root, {attributes: true, attributeFilter: ["data-nb-appearance", "data-nb-theme", "style"]});
    record();
    return () => observer.disconnect();
}
