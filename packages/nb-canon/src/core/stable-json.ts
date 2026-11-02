/**
 * 稳定序列化：对象的键按 UTF-16 码元排序、不带空白，值为 `undefined` 的键省略。同样的数据得到同样的文字，
 * 用作摘要的输入（请求摘要、归纳缓存的键、Component 登记集合的摘要）与深比较。
 */
export function stableStringify(value: unknown): string {
    if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
    if (Array.isArray(value)) return `[${value.map((item) => (item === undefined ? "null" : stableStringify(item))).join(",")}]`;
    const keys = Object.keys(value).sort();
    const parts: string[] = [];
    for (const key of keys) {
        const item = (value as Record<string, unknown>)[key];
        if (item === undefined) continue;
        parts.push(`${JSON.stringify(key)}:${stableStringify(item)}`);
    }
    return `{${parts.join(",")}}`;
}

/** 两个 JSON 值是否相同（键的顺序不算）。 */
export function sameJson(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
    return stableStringify(a) === stableStringify(b);
}
