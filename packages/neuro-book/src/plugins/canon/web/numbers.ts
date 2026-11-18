/**
 * 作者在确认条里填的数（docs/specs/canon/author-ui.md 输出 16、21）：十进制，可以带正负号（含减号 −）、小数与千位分隔的逗号。
 * 别的写法（`0x10`、`1e3`、逗号不在千位上的 `1,5`）不算数，不预览也不能保存。条目页的就地改与变更详情页的“改”共用。
 */

const DECIMAL = /^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/u;

export function parseDecimal(value: string): number | undefined {
    const trimmed = value.trim().replace(/^−/u, "-");
    if (!DECIMAL.test(trimmed)) return undefined;
    const number = Number(trimmed.replace(/,/gu, ""));
    return Number.isFinite(number) ? number : undefined;
}
