/**
 * 角色图标：键 → 图标 class。nb-models 只存键（`RoleConfig.icon`），画法在这里；不认识的键与没写键的角色，
 * 内置角色用 `BUILTIN_ROLE_ICONS`，自建角色用 `DEFAULT_ROLE_ICON`。
 *
 * class 必须是写死的字面量：图标集按源码里出现的 class 名生成，拼出来的名字不会被扫到。
 */

/** 角色图标的键，顺序就是选图标菜单里的顺序；每个键在语言目录里要有 `roles.icons.<键>` 的名字（模型设置页）。 */
export const ROLE_ICON_KEYS = ["feather", "bolt", "star", "telescope", "fold-vertical", "library", "pen", "brain", "book-open", "search", "wand", "scale", "shield", "languages", "palette", "flask"] as const;
export type RoleIconKey = (typeof ROLE_ICON_KEYS)[number];

export const ROLE_ICONS: Readonly<Record<RoleIconKey, string>> = {
    feather: "i-lucide-feather",
    bolt: "i-lucide-zap",
    star: "i-lucide-star",
    telescope: "i-lucide-telescope",
    "fold-vertical": "i-lucide-fold-vertical",
    library: "i-lucide-library",
    pen: "i-lucide-pen-line",
    brain: "i-lucide-brain",
    "book-open": "i-lucide-book-open",
    search: "i-lucide-search",
    wand: "i-lucide-wand-sparkles",
    scale: "i-lucide-scale",
    shield: "i-lucide-shield-check",
    languages: "i-lucide-languages",
    palette: "i-lucide-palette",
    flask: "i-lucide-flask-conical",
};

/** 内置角色没写 `icon` 时用的键。 */
export const BUILTIN_ROLE_ICONS: Readonly<Record<string, string>> = {
    tiny: "feather",
    fast: "bolt",
    main: "star",
    deep: "telescope",
    compaction: "fold-vertical",
};

export const DEFAULT_ROLE_ICON = "i-lucide-sparkles";

/** 角色图标的 class：显式写的键优先，其次内置角色的默认键，最后通用图标。 */
export function roleIconClass(roleId: string, key: string | null | undefined): string {
    const known: Readonly<Record<string, string | undefined>> = ROLE_ICONS;
    if (key !== null && key !== undefined && known[key] !== undefined) return known[key]!;
    const builtin = BUILTIN_ROLE_ICONS[roleId];
    return builtin === undefined ? DEFAULT_ROLE_ICON : known[builtin] ?? DEFAULT_ROLE_ICON;
}
