/**
 * Monaco 的主题：颜色取自文档根上当前产品主题的 token（docs/specs/theme/system.md），明暗按文档根的 `color-scheme`。
 * 主题或明暗变了重新生成。
 */

import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api.js";

export const MONACO_THEME = "nbook";

/** 读一个 token 的解析值；没有时用 `fallback`。 */
function token(style: CSSStyleDeclaration, name: string, fallback: string): string {
    return style.getPropertyValue(name).trim() || fallback;
}

/** Monaco 只认 `#rrggbb`（可带透明度）；把 `rgb()` 之类经画布换算，换不了的用 `fallback`。 */
function hex(color: string, fallback: string): string {
    if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/iu.test(color)) return color;
    const canvas = document.createElement("canvas").getContext("2d");
    if (canvas === null) return fallback;
    canvas.fillStyle = fallback;
    canvas.fillStyle = color;
    const resolved = canvas.fillStyle;
    return /^#[0-9a-f]{6}$/iu.test(resolved) ? resolved : fallback;
}

export function buildMonacoTheme(root: HTMLElement): Monaco.editor.IStandaloneThemeData {
    const style = getComputedStyle(root);
    const dark = style.colorScheme.includes("dark") || root.dataset.nbAppearance === "dark";
    const background = hex(token(style, "--bg-main", dark ? "#1f1f1f" : "#ffffff"), dark ? "#1f1f1f" : "#ffffff");
    const foreground = hex(token(style, "--text-main", dark ? "#e6e6e6" : "#1f2328"), dark ? "#e6e6e6" : "#1f2328");
    const muted = hex(token(style, "--text-muted", dark ? "#8b949e" : "#6e7781"), dark ? "#8b949e" : "#6e7781");
    const accent = hex(token(style, "--accent", "#3b82f6"), "#3b82f6");
    const hover = hex(token(style, "--bg-hover", dark ? "#2a2a2a" : "#f3f4f6"), dark ? "#2a2a2a" : "#f3f4f6");
    return {
        base: dark ? "vs-dark" : "vs",
        inherit: true,
        rules: [],
        colors: {
            "editor.background": background,
            "editor.foreground": foreground,
            "editorGutter.background": background,
            "editorLineNumber.foreground": muted,
            "editorLineNumber.activeForeground": foreground,
            "editorCursor.foreground": accent,
            "editor.lineHighlightBackground": hover,
        },
    };
}
