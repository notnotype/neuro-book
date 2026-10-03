import {icons as lucideIcons} from "@iconify-json/lucide";

export type LucideIconOption = {
    name: string;
    className: string;
};

const lucideIconNameSet = new Set(Object.keys(lucideIcons.icons));

export const lucideIconOptions: LucideIconOption[] = Object.keys(lucideIcons.icons)
    .sort((left, right) => left.localeCompare(right, "en"))
    .map((name) => ({
        name,
        className: toLucideIconClass(name),
    }));

/**
 * 将 lucide 图标名转为 UnoCSS 图标类名。
 */
export function toLucideIconClass(name: string): string {
    return `i-lucide-${name}`;
}

/**
 * 规范化 frontmatter 中的图标字段。
 */
export function normalizeLucideIconName(value: unknown): string | null {
    if (typeof value !== "string") {
        return null;
    }

    const iconName = value
        .trim()
        .replace(/^i-lucide-/i, "")
        .replace(/^lucide:/i, "");
    return lucideIconNameSet.has(iconName) ? iconName : null;
}

/**
 * 读取 frontmatter 图标类名，非法值返回 null。
 */
export function readLucideIconClass(value: unknown): string | null {
    const iconName = normalizeLucideIconName(value);
    return iconName ? toLucideIconClass(iconName) : null;
}
