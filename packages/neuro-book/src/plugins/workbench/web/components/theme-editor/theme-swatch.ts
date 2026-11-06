/**
 * 一套主题在设置里的“预览色”：背景、文字、强调三个颜色，取它在某个明暗下实际生效的配色（主题包缺省盖上声明里写的）。
 * 读不出时给 `null`，调用方不画那一块。
 */

import type {ThemeEntry} from "../../themes";

export interface ThemeSwatch {
    readonly background: string | null;
    readonly text: string | null;
    readonly accent: string | null;
}

export function themeSwatch(entry: ThemeEntry, appearance: "light" | "dark", baseColors: (base: string, appearance: "light" | "dark") => Readonly<Record<string, string>>): ThemeSwatch {
    const colors = {...baseColors(entry.declaration.base, appearance), ...(entry.declaration[appearance].colors ?? {})};
    return {background: colors["--bg-main"] ?? null, text: colors["--text-main"] ?? null, accent: colors["--accent-main"] ?? null};
}
