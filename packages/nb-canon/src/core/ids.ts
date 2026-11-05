/**
 * 对象 id：一个字母前缀加十进制号，由程序生成、不复用（docs/specs/canon/model.md 输入，revisions.md 输出 20）。
 *
 * “不复用”靠调用方把日志里出现过的每个 id（含已删除的）都交给 `IdAllocator.observe`：编号取见过的最大号加一，
 * 删掉最后一个对象后再新建，也拿不到同一个号。比较按数值部分（`c9` 在 `c10` 之前，model.md 输出 2），不按字符串。
 */

/** `telling` 是讲述（在讲述所在的对象里，但全局分配、不复用）；`line` 留给世界线（canon/worldlines.md），避开修订的 `r`。 */
export const ID_PREFIX = {entry: "e", change: "c", check: "k", decision: "d", suggestion: "s", revision: "r", telling: "t", line: "l"} as const;

export type ObjectKind = "entry" | "change" | "check" | "decision" | "suggestion";

/** 块与列表元素的 id 在各自的列表里分配，前缀固定。 */
export const LOCAL_ID_PREFIX = {block: "b", item: "i"} as const;

const ID_PATTERN = /^([a-z]+)(\d+)$/u;

/** 拆出前缀与编号；不是“字母前缀加十进制号”的 id 返回 null（外部数据里可能有，比较时退回字符串）。 */
export function splitId(id: string): {readonly prefix: string; readonly number: number} | null {
    const match = ID_PATTERN.exec(id);
    if (match === null) return null;
    return {prefix: match[1]!, number: Number(match[2])};
}

/** 同前缀按编号比，前缀不同或不合格式时按字符串比；结果只用于稳定排序。 */
export function compareIds(a: string, b: string): number {
    const left = splitId(a);
    const right = splitId(b);
    if (left !== null && right !== null && left.prefix === right.prefix) return left.number - right.number;
    return a < b ? -1 : a > b ? 1 : 0;
}

/** 按前缀记下见过的最大号，发下一个号。 */
export class IdAllocator {
    readonly #max = new Map<string, number>();

    observe(id: string): void {
        const parts = splitId(id);
        if (parts === null) return;
        if (parts.number > (this.#max.get(parts.prefix) ?? 0)) this.#max.set(parts.prefix, parts.number);
    }

    /** 一份独立的副本：预览与发布在副本上发号，失败时原来的不受影响。 */
    clone(): IdAllocator {
        const copy = new IdAllocator();
        for (const [prefix, number] of this.#max) copy.#max.set(prefix, number);
        return copy;
    }

    next(prefix: string): string {
        const number = (this.#max.get(prefix) ?? 0) + 1;
        this.#max.set(prefix, number);
        return `${prefix}${String(number)}`;
    }
}
