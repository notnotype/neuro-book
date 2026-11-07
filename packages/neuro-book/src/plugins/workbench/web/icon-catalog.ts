/**
 * “产品里能画的 lucide 图标”目录的纯数据部分（docs/specs/theme/editor.md 输出 21）。读样式表的部分在 `icon-scan.ts`（要 DOM），
 * 测试只引这里：节点侧的类型检查没有 DOM 库。
 */

/** 目录里的一个图标：名字，与产品样式里这个图标默认的 `--svg` 值（`url("data:…")`）。 */
export interface CatalogIcon {
    readonly name: string;
    readonly svg: string;
}

/** 一段选择器恰好是 `.i-lucide-<名>`；带后代、伪类或属性的不收，它们不是“画这个图标”的规则。 */
const ICON_CLASS = /^\.i-lucide-([a-z0-9-]+)$/u;

/**
 * 从一条规则的 `selectorText` 里取图标名。产物里别名写成分组选择器（`.i-lucide-loader-2,.i-lucide-loader-circle{…}`），所以先按
 * 逗号拆开再逐段匹配；图标名只含小写字母、数字与连字符，不会含逗号。
 */
export function parseIconSelector(selectorText: string): string[] {
    const names: string[] = [];
    for (const part of selectorText.split(",")) {
        const name = ICON_CLASS.exec(part.trim())?.[1];
        if (name !== undefined && !names.includes(name)) names.push(name);
    }
    return names;
}

/** 补全候选：以输入开头的在前，其余含有输入的在后，各自按名字排序，至多 `limit` 个；输入为空时没有候选。 */
export function matchIcons(names: ReadonlyArray<string>, query: string, limit = 8): string[] {
    const needle = query.trim().toLowerCase();
    if (needle === "") return [];
    const starts = names.filter((name) => name.startsWith(needle)).sort();
    const contains = names.filter((name) => !name.startsWith(needle) && name.includes(needle)).sort();
    return [...starts, ...contains].slice(0, limit);
}
