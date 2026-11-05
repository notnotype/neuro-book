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

/**
 * 规范的 JSON（RFC 8785，docs/specs/canon/model.md 输入的“规范的 JSON”）：对象的键按 UTF-16 码元排序、数用 ECMAScript
 * 的写法、不带空白，与 `stableStringify` 对合法 JSON 的输出相同。区别是不静默：遇到非有限数、孤立的代理项、`undefined`
 * 与非普通对象（Map、Date、类的实例）就抛错，因为这些值在两端各算一次摘要时（作者授权、稳定键、读取输入）会得到
 * 不同的文字。
 */
export function canonicalJson(value: unknown): string {
    if (value === null) return "null";
    if (typeof value === "boolean") return value ? "true" : "false";
    if (typeof value === "number") {
        if (!Number.isFinite(value)) throw new TypeError(`canonical JSON: number ${String(value)} is not finite`);
        return JSON.stringify(value);
    }
    if (typeof value === "string") {
        // 带 u 标志时成对的代理项算一个码点，这个字符类只匹配落单的。
        if (/[\uD800-\uDFFF]/u.test(value)) throw new TypeError("canonical JSON: string has a lone surrogate");
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
    if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
        const record = value as Record<string, unknown>;
        const keys = Object.keys(record).sort();
        return `{${keys.map((key) => {
            if (record[key] === undefined) throw new TypeError(`canonical JSON: key "${key}" is undefined`);
            return `${canonicalJson(key)}:${canonicalJson(record[key])}`;
        }).join(",")}}`;
    }
    throw new TypeError(`canonical JSON: ${typeof value} is not a JSON value`);
}
