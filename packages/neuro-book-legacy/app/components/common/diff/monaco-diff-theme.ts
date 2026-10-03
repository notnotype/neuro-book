import {buildMonacoTheme} from "nbook/app/components/markdown-studio/monaco-theme";
import type {MonacoEditorApi} from "nbook/app/components/markdown-studio/load-monaco-editor";
import {THEME_HOST_SELECTOR} from "nbook/app/utils/theme/host";
import {useProductTheme} from "nbook/app/utils/theme/theme-session";

export function readDiffCssVars(host: HTMLElement | null): CSSStyleDeclaration {
    const themeHost = host?.closest(THEME_HOST_SELECTOR);
    return getComputedStyle(themeHost ?? document.documentElement);
}

/**
 * 注册并使用 diff 用的 Monaco 主题。
 *
 * 明暗取自产品主题会话（不再是调用方传入的主题 id），配色取自当前渲染出来的角色变量：
 * 主题包里 `--bg-panel` 等具体色值写在 `<html>` 上，这里按角色变量名读取。
 */
export function applyMonacoDiffTheme(monacoApi: MonacoEditorApi, host: HTMLElement | null): string {
    const cssVars = readDiffCssVars(host);
    const {appearance} = useProductTheme();
    const themeName = `neuro-book-diff-${appearance.value}`;
    monacoApi.editor.defineTheme(themeName, buildMonacoTheme(appearance.value, {
        accent: cssVars.getPropertyValue("--accent-main").trim() || "#3b82f6",
        background: cssVars.getPropertyValue("--panel-surface").trim() || "#1f1f1f",
        border: cssVars.getPropertyValue("--border-color").trim() || "#2b3340",
        foreground: cssVars.getPropertyValue("--text-main").trim() || "#f3f4f6",
        hover: cssVars.getPropertyValue("--bg-hover").trim() || "rgba(255,255,255,0.04)",
        muted: cssVars.getPropertyValue("--text-muted").trim() || "#94a3b8",
        selection: cssVars.getPropertyValue("--accent-bg").trim() || "rgba(59,130,246,0.18)",
    }));
    monacoApi.editor.setTheme(themeName);
    return themeName;
}
