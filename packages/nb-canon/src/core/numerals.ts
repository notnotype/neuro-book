/**
 * 从一段原文里读出所有的数，供写入时核验“每个数有依据”（docs/specs/canon/revisions.md 输出 3）。
 *
 * 自写而不用库：nb-canon 唯一的候选库 nzh 不认“两”（“两千”读成 0）与口语的省略写法（“三千五”读成 3005），
 * 见 w00039 t29 的依赖试验。按中文数字的常规读法处理：
 * - 阿拉伯数字（含全角、千分位逗号、小数），可带“万”“亿”（“3万”“1.5万”）；
 * - 中文数字的一段连续写法（零〇一二两三四五六七八九十百千万亿），口语省略按下一级单位读：“三千五”是 3500、
 *   “一百二”是 120、“四万五”是 45000；中间有“零”时不省略（“一百零五”是 105）。
 * 读不出的写法（例如“一二三”）跳过，不报错：核验只问“原文里有没有这个数”。
 */

const DIGITS: Readonly<Record<string, number>> = {零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9};
const SMALL_UNITS: Readonly<Record<string, number>> = {十: 10, 百: 100, 千: 1000};

const ARABIC = /(\d[\d,]*(?:\.\d+)?)([万亿])?/gu;
const CHINESE = /[零〇一二两三四五六七八九十百千万亿]+/gu;

/** 原文里出现的所有数，按出现的先后（阿拉伯数字在前、中文数字在后）。 */
export function readNumbers(text: string): number[] {
    const normalized = text.replace(/[０-９]/gu, (char) => String.fromCharCode(char.charCodeAt(0) - 0xff10 + 0x30)).replace(/，(?=\d{3})/gu, ",").replace(/．/gu, ".");
    const numbers: number[] = [];
    for (const match of normalized.matchAll(ARABIC)) {
        const base = Number(match[1]!.replaceAll(",", ""));
        if (!Number.isFinite(base)) continue;
        const unit = match[2] === "万" ? 1e4 : match[2] === "亿" ? 1e8 : 1;
        numbers.push(roundDecimal(base * unit));
    }
    for (const match of normalized.matchAll(CHINESE)) {
        const value = parseChineseNumber(match[0]);
        if (value !== null) numbers.push(value);
    }
    return numbers;
}

/** 一段连续的中文数字读成数；读不出返回 null。 */
export function parseChineseNumber(text: string): number | null {
    const yi = text.indexOf("亿");
    if (yi >= 0) {
        const high = yi === 0 ? 1 : parseBelowYi(text.slice(0, yi));
        const low = parseRemainder(text.slice(yi + 1), 1e7, parseBelowYi);
        return high === null || low === null ? null : high * 1e8 + low;
    }
    return parseBelowYi(text);
}

function parseBelowYi(text: string): number | null {
    const wan = text.indexOf("万");
    if (wan >= 0) {
        const high = wan === 0 ? 1 : parseSection(text.slice(0, wan));
        const low = parseRemainder(text.slice(wan + 1), 1e3, parseSection);
        return high === null || low === null ? null : high * 1e4 + low;
    }
    return parseSection(text);
}

/** 大单位后面剩下的部分：只剩一个数字时是口语省略（“四万五”的“五”是五千）；以“零”开头时照常读。 */
function parseRemainder(rest: string, omittedUnit: number, parse: (text: string) => number | null): number | null {
    if (rest === "") return 0;
    const single = rest.length === 1 ? DIGITS[rest] : undefined;
    if (single !== undefined && single !== 0) return single * omittedUnit;
    return parse(rest);
}

/** 一万以下的一段：数字与十、百、千，可以有“零”。 */
function parseSection(text: string): number | null {
    if (text === "") return null;
    let total = 0;
    let digit: number | null = null;
    let lastUnit = 0;
    let sawZero = false;
    for (const char of text) {
        const value = DIGITS[char];
        if (value !== undefined) {
            if (value === 0) {
                sawZero = true;
                continue;
            }
            // 两个数字连着（“一二”）不是数的写法。
            if (digit !== null) return null;
            digit = value;
            continue;
        }
        const unit = SMALL_UNITS[char];
        if (unit === undefined) return null;
        // 单位从大到小排；“十”在开头时是“一十”。
        if (lastUnit !== 0 && unit >= lastUnit) return null;
        total += (digit ?? 1) * unit;
        lastUnit = unit;
        digit = null;
        sawZero = false;
    }
    if (digit !== null) total += !sawZero && lastUnit >= 100 ? digit * (lastUnit / 10) : digit;
    return total;
}

function roundDecimal(value: number): number {
    return Math.round(value * 1e4) / 1e4;
}
