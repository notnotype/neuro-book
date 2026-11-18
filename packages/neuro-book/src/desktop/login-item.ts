/**
 * 开机自启登记的解析（docs/specs/runtime/desktop-shell.md 输出 27）：`reg query <Run 键>` 列出整个键的值，从中找某个值名。
 * 查整个键而不是只查这个值：值不存在时 `reg query /v` 也以非零退出，与查询失败分不开；列整个键时，不存在就是列表里没有，
 * 非零退出才是失败。值行是“<空白><值名><空白><类型><空白><数据>”，值名与数据里都可能有空格，所以按类型字段切。
 */

const VALUE_TYPES = ["REG_EXPAND_SZ", "REG_SZ"] as const;

/** 列表里这个值名登记的数据；没有为 null。类型是 REG_SZ 或 REG_EXPAND_SZ（展开在登录时由系统做，这里原样交回）。 */
export function runValueOf(listing: string, name: string): string | null {
    for (const line of listing.split(/\r?\n/u)) {
        const trimmed = line.trim();
        for (const type of VALUE_TYPES) {
            const marker = ` ${type} `;
            const at = trimmed.indexOf(marker);
            // 值名后面跟的是类型字段：值名本身可能含空格，所以比对类型字段之前的整段。
            if (at > 0 && trimmed.slice(0, at).trim() === name) return trimmed.slice(at + marker.length).trim();
            if (trimmed === `${name} ${type}`) return "";
        }
    }
    return null;
}
