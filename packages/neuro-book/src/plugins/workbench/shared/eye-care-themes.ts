import type {ThemeDeclaration} from "./themes";

type Look = ThemeDeclaration["light"];

/**
 * 护眼主题的配色（docs/specs/theme/skins.md 输出 12）：只换颜色，不带场景。低饱和的底加上压暗的文字；状态色也写，主题包的那套是配白底的，
 * 落在这些底色上不够 4.5。
 */
export const EYE_GREEN_LOOKS: {readonly light: Look; readonly dark: Look} = {
    light: {
        colors: {
            "--color-scheme": "light",
            "--bg-main": "#dcefdc", "--bg-panel": "#dcefdc", "--bg-sidebar": "#cfe5d0", "--bg-subtle": "#cfe5d0", "--bg-input": "#e5f3e5", "--bg-hover": "#c1dbc3",
            "--text-main": "#1d2a20", "--text-secondary": "#3a4b3e", "--text-muted": "#46574a", "--text-inverse": "#f4faf4",
            "--border-color": "#bdd5bf", "--border-strong": "#9fbda3", "--border-accent": "#22653f",
            "--accent-main": "#22653f", "--accent-bg": "#c1dbc3", "--accent-text": "#1e5c39",
            "--status-info": "#1c5f8f", "--status-success": "#1a5f34", "--status-warning": "#7a5200", "--status-danger": "#a42a22",
            "--selection-bg": "#b6d6b9",
        },
    },
    dark: {
        colors: {
            "--color-scheme": "dark",
            "--bg-main": "#1f2a24", "--bg-panel": "#1f2a24", "--bg-sidebar": "#18211c", "--bg-subtle": "#26332c", "--bg-input": "#25312a", "--bg-hover": "#2f3f36",
            "--text-main": "#dfe9e1", "--text-secondary": "#c2d0c6", "--text-muted": "#adbdb2", "--text-inverse": "#14201a",
            "--border-color": "#33443a", "--border-strong": "#4b5f53", "--border-accent": "#7fc79a",
            "--accent-main": "#7fc79a", "--accent-bg": "#2f3f36", "--accent-text": "#8ad0a5",
            "--status-info": "#7dbbe8", "--status-success": "#7fcf9b", "--status-warning": "#e0b35a", "--status-danger": "#f0918a",
            "--selection-bg": "#38503f",
        },
    },
};

export const EYE_SEPIA_LOOKS: {readonly light: Look; readonly dark: Look} = {
    light: {
        colors: {
            "--color-scheme": "light",
            "--bg-main": "#f4ecd8", "--bg-panel": "#f4ecd8", "--bg-sidebar": "#ebe1c8", "--bg-subtle": "#ebe1c8", "--bg-input": "#f9f3e3", "--bg-hover": "#e1d5b8",
            "--text-main": "#2c261a", "--text-secondary": "#4c4332", "--text-muted": "#5a503c", "--text-inverse": "#fbf7ec",
            "--border-color": "#ddd1b4", "--border-strong": "#c4b48f", "--border-accent": "#704f14",
            "--accent-main": "#704f14", "--accent-bg": "#e1d5b8", "--accent-text": "#6f4f16",
            "--status-info": "#1c5a86", "--status-success": "#2f6330", "--status-warning": "#7a4f00", "--status-danger": "#a02b20",
            "--selection-bg": "#dccb9f",
        },
    },
    dark: {
        colors: {
            "--color-scheme": "dark",
            "--bg-main": "#2a2520", "--bg-panel": "#2a2520", "--bg-sidebar": "#211d18", "--bg-subtle": "#332d27", "--bg-input": "#312b25", "--bg-hover": "#3e362d",
            "--text-main": "#eadfca", "--text-secondary": "#cdc2ad", "--text-muted": "#b8ad98", "--text-inverse": "#231d12",
            "--border-color": "#3f382f", "--border-strong": "#5a5044", "--border-accent": "#d8b26a",
            "--accent-main": "#d8b26a", "--accent-bg": "#3e362d", "--accent-text": "#e0bb76",
            "--status-info": "#83b9e0", "--status-success": "#94c98e", "--status-warning": "#e3b65e", "--status-danger": "#ee9388",
            "--selection-bg": "#544832",
        },
    },
};
