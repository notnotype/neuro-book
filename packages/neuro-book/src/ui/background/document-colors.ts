/**
 * 背景要的文档状态：当前主题的颜色（从文档根算好的值）、主题变没变、系统的无障碍偏好（docs/specs/ui/backgrounds.md 输出 6、8）。
 */

import {onBeforeUnmount, onMounted, ref} from "vue";
import type {Ref} from "vue";

import {colorIsLegible, parseColor} from "./background-legibility";
import type {Rgb, TextRole} from "./background-legibility";

/** 读一个变量算好的颜色：变量里可能是 `color-mix(…)`，要让浏览器算，读探针元素的 `color`。 */
export function resolve(name: string, fallback: Rgb): {readonly rgb: Rgb; readonly alpha: number} {
    const probe = document.createElement("span");
    probe.style.display = "none";
    probe.style.color = `var(${name})`;
    document.body.append(probe);
    const parsed = parseColor(getComputedStyle(probe).color);
    probe.remove();
    return parsed ?? {rgb: fallback, alpha: 1};
}

export interface DocumentColors {
    readonly surface: Rgb;
    readonly roles: ReadonlyArray<TextRole>;
    readonly appearance: "light" | "dark";
}

/** 当前明暗。放进 computed 时同时读 `useDocumentThemeVersion`，否则切明暗不重算。 */
export function documentAppearance(): "light" | "dark" {
    return document.documentElement.dataset.nbAppearance === "dark" ? "dark" : "light";
}

export function readDocumentColors(): DocumentColors {
    const appearance = documentAppearance();
    const fallback: Rgb = appearance === "dark" ? [230, 230, 230] : [30, 30, 30];
    const main = resolve("--text-main", fallback).rgb;
    return {
        appearance,
        surface: resolve("--bg-panel", appearance === "dark" ? [30, 30, 30] : [255, 255, 255]).rgb,
        roles: [
            {color: main},
            {color: resolve("--text-secondary", fallback).rgb},
            {color: resolve("--accent-text", fallback).rgb},
            // 高亮的正文：底色与 `.nb-markdown mark` 同一配方。
            {color: main, over: {color: resolve("--status-warning", fallback).rgb, alpha: 0.32}},
        ],
    };
}

/** 纯色底合不合格（输出 7）：主文字、次要文字与链接在它上面都要够。高亮的正文不算：亮色上它的底是半透明的状态色。 */
export function backgroundColorIsLegible(hex: string): boolean {
    const color = parseColor(hex);
    if (color === null) return false;
    return colorIsLegible(color.rgb, readDocumentColors().roles.filter((role) => role.over === undefined));
}

/** 主题、明暗每变一次加一：放进 computed 里读，颜色跟着重算。 */
export function useDocumentThemeVersion(): Readonly<Ref<number>> {
    const version = ref(0);
    let observer: MutationObserver | null = null;
    onMounted(() => {
        observer = new MutationObserver(() => {
            version.value += 1;
        });
        observer.observe(document.documentElement, {attributes: true, attributeFilter: ["data-nb-theme", "data-nb-appearance"]});
        version.value += 1;
    });
    onBeforeUnmount(() => observer?.disconnect());
    return version;
}

const SOLID_QUERIES = ["(prefers-reduced-transparency: reduce)", "(prefers-contrast: more)", "(forced-colors: active)"];

/** 系统要求少透明、高对比或强制颜色时不画图片（输出 8）。 */
export function usePrefersSolid(): Readonly<Ref<boolean>> {
    const solid = ref(false);
    const lists = SOLID_QUERIES.map((query) => window.matchMedia(query));
    const update = (): void => {
        solid.value = lists.some((list) => list.matches);
    };
    onMounted(() => {
        update();
        for (const list of lists) list.addEventListener("change", update);
    });
    onBeforeUnmount(() => {
        for (const list of lists) list.removeEventListener("change", update);
    });
    return solid;
}

/** 源码编辑器要不要透明：谁开了背景谁登记（docs/specs/ui/backgrounds.md 输出 1、2）。写在文档根，Monaco 的主题监听它。 */
const transparentOwners = new Set<symbol>();
export function setEditorTransparent(owner: symbol, on: boolean): void {
    if (on) transparentOwners.add(owner);
    else transparentOwners.delete(owner);
    const root = document.documentElement;
    if (transparentOwners.size > 0) root.dataset.nbEditorTransparent = "";
    else delete root.dataset.nbEditorTransparent;
}
