/**
 * 精确档的数（docs/specs/canon/components.md 输出 14）：有限的十进制数，绝对值小于 10¹¹，最多 4 位小数，加减不出现二进制浮点误差。
 *
 * 做法：合格的数乘 10⁴ 后是小于 10¹⁵ 的整数，在安全整数里，按整数加减再除回去。除回去的结果最多 15 位有效数字，
 * 双精度能精确往返，所以 JSON 读写也不失真。这条理由在范围放大到 10¹¹ 以上或小数位超过 4 位时失效。
 */

export const EXACT_LIMIT = 1e11;
export const EXACT_DECIMALS = 4;
const SCALE = 10 ** EXACT_DECIMALS;

export type ExactProblem = "not-finite" | "out-of-range" | "too-many-decimals";

/** 合格返回 null，否则返回哪里不合格。 */
export function exactProblem(value: number): ExactProblem | null {
    if (!Number.isFinite(value)) return "not-finite";
    if (Math.abs(value) >= EXACT_LIMIT) return "out-of-range";
    // String 给出能精确往返的最短十进制写法；很小的数会写成指数形式，那一定超过 4 位小数。
    const text = String(Math.abs(value));
    if (text.includes("e")) return value === 0 ? null : "too-many-decimals";
    const dot = text.indexOf(".");
    if (dot >= 0 && text.length - dot - 1 > EXACT_DECIMALS) return "too-many-decimals";
    return null;
}

/** 两个合格的数相加；结果超出范围返回 null。调用方先用 `exactProblem` 检查两个加数。 */
export function addExact(a: number, b: number): number | null {
    const sum = (Math.round(a * SCALE) + Math.round(b * SCALE)) / SCALE;
    return Math.abs(sum) >= EXACT_LIMIT ? null : sum;
}

/** 两个合格的数之差（新值减旧值），就地改的剧情变化用它生成加减（revisions.md 输出 8）。 */
export function subtractExact(a: number, b: number): number | null {
    return addExact(a, -b);
}
