import type {NbColorwayVars} from "../../src/colorway/colorway-contract";
import type {ColorwayMeta} from "../../src/colorway/colorway-store";
import {nbColorways} from "../../src/colorway/presets";

/**
 * macOS 自带的两套配色。
 *
 * 「主题带配色」是真实需求而不是花活：这套玻璃在通用 dark 下会发灰——通用 dark 的面色
 * （#252529）是给实心面板调的，透明化之后与底纹混出来的是脏灰。玻璃要的是更冷、
 * 对比更高的一组底色。
 *
 * 但这不构成「必须用我的配色」：`defaultColorway` 是**默认值不是约束**，
 * 用户切到内置 dark 一样成立，只是观感不同。
 *
 * 两套的写法不一样，原因在库那边：
 * · `macos-dark` 从内置 dark spread 出来只改几项——内置有暗色，重造只会让两份色值各自漂移。
 * · `macos-light` 是**完整的一份 33 色**。库的内置配色只剩 dark 一套（`sepia` / `light`
 *   两套亮色已下线），亮色没有可继承的基，只能由主题自己给全。这也是「主题自带配色」
 *   这个扩展点从可选变成必需的那一刻。
 */

/** 中性亮色底，取自已下线的内置 light。玻璃要透出接近纯白的面，所以面色比它更亮一档 */
const MACOS_LIGHT_BASE: NbColorwayVars = {
    "--color-scheme": "light",
    "--bg-main": "#f6f8fa",
    "--bg-panel": "#ffffff",
    "--bg-sidebar": "#f0f2f5",
    "--bg-subtle": "color-mix(in srgb, #f0f2f5 78%, #ffffff)",
    "--bg-input": "#ffffff",
    "--bg-hover": "#e6e8ec",
    "--text-main": "#111827",
    "--text-secondary": "#4b5563",
    "--text-muted": "#616772",
    "--text-inverse": "#ffffff",
    "--border-color": "#e5e7eb",
    "--border-strong": "#d1d5db",
    "--status-info": "#1d5be2",
    "--status-info-bg": "rgba(37, 99, 235, 0.12)",
    "--status-info-border": "rgba(37, 99, 235, 0.28)",
    "--status-success": "#097834",
    "--status-success-bg": "rgba(22, 163, 74, 0.12)",
    "--status-success-border": "rgba(22, 163, 74, 0.28)",
    "--status-warning": "#a65017",
    "--status-warning-bg": "rgba(180, 83, 9, 0.12)",
    "--status-warning-border": "rgba(180, 83, 9, 0.30)",
    "--status-danger": "#d3181d",
    "--status-danger-bg": "rgba(220, 38, 38, 0.10)",
    "--status-danger-border": "rgba(220, 38, 38, 0.26)",
    "--shadow-color": "#0f172a",
    "--shadow-panel": "0 1px 2px rgba(15, 23, 42, 0.10), 0 18px 44px rgba(15, 23, 42, 0.14)",
    "--overlay-bg": "rgba(15, 23, 42, 0.35)",
};

export const macosColorways: Record<string, NbColorwayVars> = {
    "macos-light": {
        ...MACOS_LIGHT_BASE,
        // macOS 的系统强调色（System Blue）
        "--accent-main": "#076ce1",
        "--accent-bg": "rgba(7, 108, 225, 0.12)",
        "--accent-text": "#0060df",
        "--border-accent": "color-mix(in srgb, #076ce1 46%, #e5e7eb)",
        "--selection-bg": "rgba(7, 108, 225, 0.24)",
        // 玻璃面透出来的是这两个色，需要比中性亮色更接近纯白，否则透完偏灰
        "--bg-panel": "#ffffff",
        "--bg-sidebar": "#f5f5f7",
        "--bg-subtle": "color-mix(in srgb, #f5f5f7 78%, #ffffff)",
    },
    "macos-dark": {
        ...nbColorways.dark,
        "--accent-main": "#0a84ff",
        "--accent-bg": "rgba(10, 132, 255, 0.16)",
        "--accent-text": "#5eb0ff",
        "--border-accent": "color-mix(in srgb, #0a84ff 46%, #3f3f46)",
        "--selection-bg": "rgba(10, 132, 255, 0.34)",
        // 冷一档、暗一档：暗色玻璃是压暗不是提亮，底色太亮会把折射糊平
        "--bg-main": "#1c1c1e",
        "--bg-panel": "#2c2c2e",
        "--bg-sidebar": "#232325",
        "--bg-subtle": "color-mix(in srgb, #232325 78%, #2c2c2e)",
        /*
         * 输入框的面必须比它所在的**面板**更靠近前景，不能更暗。
         * 原值 #161618 比窗体底 #1c1c1e 还暗，输入框在面板 #2c2c2e 上成了一个黑洞，
         * 观感就是「没上样式的原生控件」——2026-08-12 放大截图实测确认。
         * 主题层的 --control-surface 也做了半透明抬起，两处都改是因为
         * Select / Dialog 取消按钮这类组件今天仍直接引用 --bg-input（阶段 2 的债）。
         */
        "--bg-input": "#323234",
        "--bg-hover": "#3a3a3c",
        "--border-color": "#3a3a3c",
        "--border-strong": "#48484a",
        // 面板与悬停底比内置 dark 亮，这三种文字跟着提亮一点，对它们落的每个底都到 4.5:1（设计语言“对比度”）
        "--text-muted": "#a9a9b2",
        "--status-info": "#70adfa",
        "--status-danger": "#fc8090",
    },
};

export const macosColorwayMeta: Record<string, ColorwayMeta> = {
    "macos-light": {label: "macOS Light", appearance: "light"},
    "macos-dark": {label: "macOS Dark", appearance: "dark"},
};
