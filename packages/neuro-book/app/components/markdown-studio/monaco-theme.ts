import type * as Monaco from "monaco-editor";
import type {ProductAppearance} from "nbook/shared/theme/theme-axes";

type ThemeVars = {
    accent: string;
    background: string;
    border: string;
    foreground: string;
    hover: string;
    muted: string;
    selection: string;
};

type ThemePreset = {
    base: Monaco.editor.BuiltinTheme;
    colors: Monaco.editor.IColors;
    rules: Monaco.editor.ITokenThemeRule[];
};

/**
 * 浅色源码模式继续跟当前 IDE 的变量保持一致。
 */
const buildLightPreset = (vars: ThemeVars): ThemePreset => ({
    base: "vs",
    colors: {
        "editor.background": vars.background,
        "editor.foreground": vars.foreground,
        "editorLineNumber.foreground": vars.muted,
        "editorLineNumber.activeForeground": vars.foreground,
        "editorCursor.foreground": vars.accent,
        "editor.selectionBackground": vars.selection,
        "editor.lineHighlightBackground": vars.hover,
        "editorIndentGuide.background1": vars.border,
        "editorIndentGuide.activeBackground1": vars.accent,
        "editorWhitespace.foreground": vars.border,
        "editorGutter.background": vars.background,
    },
    rules: [
        { token: "", foreground: vars.foreground.replace("#", "") },
        { token: "comment", foreground: vars.muted.replace("#", "") },
        { token: "string", foreground: "0F766E" },
        { token: "constant.numeric", foreground: "C2410C" },
        { token: "keyword", foreground: "1D4ED8" },
        { token: "entity.name.function", foreground: "7C3AED" },
        { token: "markup.heading.markdown", foreground: "1D4ED8" },
        { token: "markup.list.markdown", foreground: "C2410C" },
        { token: "markup.quote.markdown", foreground: "0F766E" },
        { token: "markup.raw.inline.markdown", foreground: "BE123C" },
    ],
});

/**
 * 深色源码模式使用更克制的 GitHub/Night Owl 风格混合。
 */
const buildDarkPreset = (vars: ThemeVars): ThemePreset => ({
    base: "vs-dark",
    colors: {
        "editor.background": vars.background,
        "editor.foreground": vars.foreground,
        "editorLineNumber.foreground": vars.muted,
        "editorLineNumber.activeForeground": vars.foreground,
        "editorCursor.foreground": vars.accent,
        "editor.selectionBackground": vars.selection,
        "editor.lineHighlightBackground": vars.hover,
        "editorIndentGuide.background1": vars.border,
        "editorIndentGuide.activeBackground1": vars.accent,
        "editorWhitespace.foreground": vars.border,
        "editorGutter.background": vars.background,
    },
    rules: [
        { token: "", foreground: vars.foreground.replace("#", "") },
        { token: "comment", foreground: "7D8590" },
        { token: "string", foreground: "A5D6FF" },
        { token: "constant.numeric", foreground: "FFAB70" },
        { token: "keyword", foreground: "FF7B72" },
        { token: "entity.name.function", foreground: "D2A8FF" },
        { token: "markup.heading.markdown", foreground: "79C0FF" },
        { token: "markup.list.markdown", foreground: "E3B341" },
        { token: "markup.quote.markdown", foreground: "8B949E" },
        { token: "markup.raw.inline.markdown", foreground: "7EE787" },
    ],
});

/**
 * 按配色明暗生成 Monaco 主题；色值来自当前配色的具体取值（变量表或宿主 computed style）。
 */
export const buildMonacoTheme = (appearance: ProductAppearance, vars: ThemeVars): Monaco.editor.IStandaloneThemeData => {
    const preset = appearance === "dark" ? buildDarkPreset(vars) : buildLightPreset(vars);

    return {
        base: preset.base,
        inherit: true,
        rules: preset.rules,
        colors: preset.colors,
    };
};
