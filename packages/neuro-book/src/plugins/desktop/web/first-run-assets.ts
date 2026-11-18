/**
 * 首次启动向导第二步的主题缩略图（docs/specs/runtime/desktop-shell.md 输出 34）：每个内置主题（工作台的四个与内置插件 theme-study
 * 的书房）亮、暗各一张书架页的截图，
 * 由 `scripts/first-run-thumbnails.ts` 生成。文件与内置主题的对应由 `first-run-assets.test.ts` 核对；插件给的主题没有缩略图。
 * 地址写成 `new URL(…, import.meta.url)`，由 Vite 把文件打进构建。
 */

export interface ThemeThumbnails {
    readonly light: string;
    readonly dark: string;
}

export const FIRST_RUN_THUMBNAILS: Readonly<Record<string, ThemeThumbnails>> = {
    "nbook": {light: new URL("./assets/first-run/nbook-light.webp", import.meta.url).href, dark: new URL("./assets/first-run/nbook-dark.webp", import.meta.url).href},
    "macos": {light: new URL("./assets/first-run/macos-light.webp", import.meta.url).href, dark: new URL("./assets/first-run/macos-dark.webp", import.meta.url).href},
    "eye-green": {light: new URL("./assets/first-run/eye-green-light.webp", import.meta.url).href, dark: new URL("./assets/first-run/eye-green-dark.webp", import.meta.url).href},
    "eye-sepia": {light: new URL("./assets/first-run/eye-sepia-light.webp", import.meta.url).href, dark: new URL("./assets/first-run/eye-sepia-dark.webp", import.meta.url).href},
    "nbook.theme-study.study": {light: new URL("./assets/first-run/nbook.theme-study.study-light.webp", import.meta.url).href, dark: new URL("./assets/first-run/nbook.theme-study.study-dark.webp", import.meta.url).href},
};
