/**
 * 近来的时刻的相对说法，账号页与管理面板共用（t09 定稿：账号页“已登录的设备”写“2 小时前”，用户页“最后登录”写“刚刚”“3 小时前”
 * “昨天”）：账号页的最后使用时间与授权时间、用户页的最后登录都用它。
 *
 * - 一小时内：调用方给的说法。账号页写“1 小时内”：会话的最后使用时间服务端每小时至多更新一次（`site.accounts` 输出 17），
 *   写“刚刚”是假精度；用户页的最后登录是准确时刻，写“刚刚”。
 * - 一天内：“N 小时前”，按整小时往下取。
 * - 本地日历的昨天（且已过了一天）：“昨天”。
 * - 更早的回 `undefined`，由调用方按那一页自己的日期写法写（账号页“11月24日”，管理面板的表格“11-24”）。
 *
 * “现在”由调用方取注入的时钟（`SiteClock.now`），不在这里读系统时间。
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function localDayStart(time: number): number {
    const date = new Date(time);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function recentTime(iso: string, now: number, locale: string, withinHour: string): string | undefined {
    const at = Date.parse(iso);
    const elapsed = now - at;
    // 时钟比服务端慢一点时 `elapsed` 是负的：也算一小时内。
    if (elapsed < HOUR_MS) return withinHour;
    if (elapsed < DAY_MS) return new Intl.RelativeTimeFormat(locale, {numeric: "always"}).format(-Math.floor(elapsed / HOUR_MS), "hour");
    const today = localDayStart(now);
    // 昨天的开头：今天开头往前一小时所在那天的开头。不用“今天开头减 24 小时”：夏令时切换那天不是 24 小时。
    const yesterday = localDayStart(today - HOUR_MS);
    if (at >= yesterday) return new Intl.RelativeTimeFormat(locale, {numeric: "auto"}).format(-1, "day");
    return undefined;
}

/** 账号页的日期写法（`recentTime` 回 `undefined` 时）：今年的写“11月24日”，往年的带上年份。 */
export function accountDate(iso: string, now: number, locale: string): string {
    const at = new Date(iso);
    const sameYear = at.getFullYear() === new Date(now).getFullYear();
    return new Intl.DateTimeFormat(locale, sameYear ? {month: "long", day: "numeric"} : {year: "numeric", month: "long", day: "numeric"}).format(at);
}
