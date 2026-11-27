/**
 * 站点的主题与明暗（t10 计划 3.5“换明暗时重画”；t09 第 4、6 条：全站 nb-ui 默认主题 nbook、缺省跟随系统明暗）。不经 Nuxt 装主题：
 * 装主题模块（带 vars.css），在根元素上写主题与明暗，再套同一明暗的配色。写法照 dev-panel 的 `host/theme.ts`。
 *
 * 用户能在账号菜单的“外观”里选跟随系统、亮色或暗色（开发者 2026-11-27 看演示后加）：菜单调 `setAppearance`，`site.ts` 把选择
 * 存进 `localStorage`（`host/storage.ts`），下次启动时作为 `appearance` 传进来。
 *
 * 首帧：应用的模块脚本在整页解析完才跑，在那之前浏览器按根元素的 `color-scheme` 画底色。只靠 `index.html` 的
 * `<meta name="color-scheme">` 的话，选了暗色而系统是亮色的人每次打开都先闪一下亮底。所以 `index.html` 的 `<head>` 里先跑一个
 * 不带 `type="module"` 的同步外部脚本 `public/appearance.js`，读存下的选择、写根元素的 `style.colorScheme` 与
 * `data-nb-appearance`；内容安全策略只许自家脚本（计划 3.8），不能内联。之后由这里接手，`apply` 照样写这两样，选回跟随系统时
 * 首帧脚本写下的 `colorScheme` 也被换掉。
 */

import {applyColorway} from "@notnotype/nb-ui/colorway";
import {installTheme} from "@notnotype/nb-ui/theme";
import nbookTheme from "@notnotype/nb-ui/themes/nbook";
import {readonly, shallowRef} from "vue";
import type {Ref} from "vue";

/** 用户能选的明暗；`system` 跟随系统。 */
export const APPEARANCES = ["system", "light", "dark"] as const;
export type Appearance = (typeof APPEARANCES)[number];

export function isAppearance(value: unknown): value is Appearance {
    return (APPEARANCES as readonly unknown[]).includes(value);
}

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
        // 浏览器的底色与原生部件（滚动条、表单控件）按它画。配色经 `--color-scheme` 也给出明暗，但首帧脚本写下的行内值压过它，
        // 所以这里照样写行内值。
        root.style.colorScheme = next;
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
