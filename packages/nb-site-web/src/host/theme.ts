/**
 * 站点的主题与明暗（t10 计划 3.5“换明暗时重画”；t09 第 4、6 条：全站 nb-ui 默认主题 nbook、跟随系统明暗）。不经 Nuxt 装主题：
 * 装主题模块（带 vars.css），在根元素上写主题与明暗，再套同一明暗的配色。写法照 dev-panel 的 `host/theme.ts`。
 *
 * 做成可切换的形状（t05 前端骨架审查第 2 条）：第一版只跟随系统，以后加手动切换只要调 `setAppearance`。到那时用户的选择要在
 * 首帧之前生效，内容安全策略只许自家脚本（计划 3.8），得用一个不带 `type="module"` 的同步外部脚本先写根元素；现在不需要：
 * `index.html` 的 `color-scheme` 让浏览器在脚本跑之前就按系统明暗画底色。
 */

import {applyColorway} from "@notnotype/nb-ui/colorway";
import {installTheme} from "@notnotype/nb-ui/theme";
import nbookTheme from "@notnotype/nb-ui/themes/nbook";
import {readonly, shallowRef} from "vue";
import type {Ref} from "vue";

/** 用户能选的明暗；`system` 跟随系统。 */
export type Appearance = "system" | "light" | "dark";

/** 实际用上的明暗。 */
export type ResolvedAppearance = "light" | "dark";

const THEME_ID = "nbook";
const COLORWAYS = {light: "nbook-light", dark: "nbook-dark"} as const satisfies Record<ResolvedAppearance, string>;

export interface SiteThemeOptions {
    /** 写主题与明暗的根元素，产品里是 `document.documentElement`。 */
    readonly root: HTMLElement;
    /** 系统是不是暗色：产品里是 `window.matchMedia("(prefers-color-scheme: dark)")`。 */
    readonly systemDark: MediaQueryList;
    /** 一开始的选择；缺省跟随系统。 */
    readonly appearance?: Appearance;
}

export interface SiteTheme {
    /** 实际用上的明暗；图表等要按明暗重画的组件 `watch` 它，在下一帧读计算样式（计划 3.5）。 */
    readonly resolved: Readonly<Ref<ResolvedAppearance>>;
    readonly appearance: Readonly<Ref<Appearance>>;
    setAppearance(appearance: Appearance): void;
    /** 解除对系统明暗的监听。 */
    dispose(): void;
}

let installed = false;

/** 主题包里取配色；缺了是主题包坏了，带着两个 id 抛出，不用非空断言让它变成看不懂的 TypeError。 */
function colorwayVars(resolved: ResolvedAppearance) {
    const id = COLORWAYS[resolved];
    const vars = nbookTheme.colorways?.[id];
    if (vars === undefined) throw new Error(`主题 ${THEME_ID} 里没有配色 ${id}`);
    return vars;
}

export function createSiteTheme(options: SiteThemeOptions): SiteTheme {
    if (!installed) {
        installTheme(nbookTheme);
        installed = true;
    }
    const appearance = shallowRef<Appearance>(options.appearance ?? "system");
    const resolved = shallowRef<ResolvedAppearance>("light");

    function apply(): void {
        const next: ResolvedAppearance = appearance.value === "system" ? (options.systemDark.matches ? "dark" : "light") : appearance.value;
        const root = options.root;
        root.dataset.nbTheme = THEME_ID;
        root.dataset.nbAppearance = next;
        applyColorway(root, colorwayVars(next));
        resolved.value = next;
    }

    const onSystemChange = () => {
        if (appearance.value === "system") apply();
    };
    options.systemDark.addEventListener("change", onSystemChange);
    apply();

    return {
        resolved: readonly(resolved) as Readonly<Ref<ResolvedAppearance>>,
        appearance: readonly(appearance) as Readonly<Ref<Appearance>>,
        setAppearance(next) {
            appearance.value = next;
            apply();
        },
        dispose() {
            options.systemDark.removeEventListener("change", onSystemChange);
        },
    };
}
