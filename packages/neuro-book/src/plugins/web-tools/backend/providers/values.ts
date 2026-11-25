/**
 * 各家客户端共用的取值规则（docs/specs/web/tools.md 输出 1、3）：日期参数的写法、结果里网址与文字的取法。
 */

import type {SearchRequest} from "./types";

const DATE = /^\d{4}-\d{2}-\d{2}$/u;

/** `after`、`before` 不是 `YYYY-MM-DD` 时交回说明（输出 1）。 */
export function dateProblem(request: SearchRequest): string | null {
    for (const [name, value] of [["after", request.after], ["before", request.before]] as const) {
        if (value !== undefined && !DATE.test(value)) return `${name} must be a date written YYYY-MM-DD`;
    }
    return null;
}

/** 交出解析后的网址（`href`）而不是原串：空白、尖括号等在这里转成百分号写法，之后显示、存档与判定主机用的都是同一个。 */
export const httpHref = (value: unknown): string | null => {
    if (typeof value !== "string") return null;
    try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
    } catch {
        return null;
    }
};

/** 网址的主机是不是屏蔽网站之一或它的子域名（输出 3）：`csdn.net` 也挡 `blog.csdn.net`，不挡 `notcsdn.net`。 */
export function siteBlocked(href: string, sites: readonly string[]): boolean {
    if (sites.length === 0) return false;
    let host: string;
    try {
        host = new URL(href).hostname.toLowerCase();
    } catch {
        return false;
    }
    return sites.some((site) => host === site || host.endsWith(`.${site}`));
}

/** 非空字符串，否则 `undefined`。 */
export const text = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined);

/** 有限的数，否则 `undefined`。 */
export const finite = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
