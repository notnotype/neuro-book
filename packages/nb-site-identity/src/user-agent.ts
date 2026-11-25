/**
 * 浏览器标识的概要（`site.accounts` 输出 17，副作用与数据一节“浏览器标识只存概要”；w00037 t07 计划 3.5）。
 *
 * 会话行的 `userAgent` 列存的不是原始的 `User-Agent`，而是 `{"browser":…,"os":…}` 的 JSON：建会话前的钩子（`auth.ts` 的
 * `databaseHooks.session.create.before`）把库按请求头填进去的原始写法换成它，原始写法不落库。会话列表按 JSON 读回。
 *
 * 识别用下面两张手写的规则表，各自先匹配先赢。顺序有讲究：很多浏览器的标识里同时带着别家的记号（Edge、Opera、三星浏览器、微信
 * 内置浏览器都带 `Chrome/` 与 `Safari/`，Chrome 带 `Safari/`；iPhone 带 `like Mac OS X`，Android 与 ChromeOS 带 `Linux`），所以
 * 带得多的排在前面。不引第三方解析库：只要两个粗名字（计划的技术选型表）。认不出的项为 null；两项都认不出时整列存 null。
 */

/** 浏览器名的规则：第一个匹配的就是答案。 */
const BROWSER_RULES: readonly (readonly [name: string, pattern: RegExp])[] = [
    ["WeChat", /MicroMessenger\//u],
    ["Samsung Internet", /SamsungBrowser\//u],
    ["Edge", /\b(?:Edg|EdgA|EdgiOS|Edge)\//u],
    ["Opera", /\b(?:OPR|OPiOS|OPT)\/|\bOpera\b/u],
    ["Firefox", /\b(?:Firefox|FxiOS)\//u],
    ["Chrome", /\b(?:Chrome|CriOS|Chromium)\//u],
    // 只有 Safari 自己同时带 `Version/` 与 `Safari/`；内嵌网页视图通常不带 `Version/`，认不出比认错好。
    ["Safari", /\bVersion\/[\d.]+.*\bSafari\//u],
];

/** 系统名的规则：第一个匹配的就是答案。iPadOS 的桌面模式报的是 Macintosh，分不出，算作 macOS。 */
const OS_RULES: readonly (readonly [name: string, pattern: RegExp])[] = [
    ["iOS", /\b(?:iPhone|iPad|iPod)\b/u],
    ["Android", /\bAndroid\b/u],
    ["ChromeOS", /\bCrOS\b/u],
    ["Windows", /\bWindows\b/u],
    ["macOS", /\bMac OS X\b|\bMacintosh\b/u],
    ["Linux", /\bLinux\b/u],
];

const BROWSER_NAMES: ReadonlySet<string> = new Set(BROWSER_RULES.map(([name]) => name));
const OS_NAMES: ReadonlySet<string> = new Set(OS_RULES.map(([name]) => name));

/** 浏览器名与系统名，认不出的为 null。 */
export interface UserAgentSummary {
    readonly browser: string | null;
    readonly os: string | null;
}

const UNKNOWN: UserAgentSummary = {browser: null, os: null};

function firstMatch(rules: readonly (readonly [string, RegExp])[], raw: string): string | null {
    for (const [name, pattern] of rules) if (pattern.test(raw)) return name;
    return null;
}

/** 从原始的 `User-Agent` 认出浏览器名与系统名。 */
export function summarizeUserAgent(raw: string): UserAgentSummary {
    return {browser: firstMatch(BROWSER_RULES, raw), os: firstMatch(OS_RULES, raw)};
}

/**
 * 会话行 `userAgent` 列要存的值：概要的 JSON；没有标识（库填的空串）或两项都认不出时为 null。建会话前的钩子调它，
 * 登录、注册与 t08 由库建的会话都经那一处，不在各个路由里各写一份。
 */
export function storedUserAgent(raw: string | null | undefined): string | null {
    if (raw === null || raw === undefined || raw === "") return null;
    const summary = summarizeUserAgent(raw);
    return summary.browser === null && summary.os === null ? null : JSON.stringify(summary);
}

/**
 * 把会话行里存的值读回概要。只认规则表里的名字：列里若有别的写法（比如有人绕过钩子存了原始标识），回答里也不会出现它
 * （输出 17“不给原始的浏览器标识”）。读不出时回两个 null，并由调用方记一行诊断。
 */
export function readStoredUserAgent(stored: string | null): {readonly summary: UserAgentSummary; readonly readable: boolean} {
    if (stored === null) return {summary: UNKNOWN, readable: true};
    let value: unknown;
    try {
        value = JSON.parse(stored);
    } catch {
        return {summary: UNKNOWN, readable: false};
    }
    if (typeof value !== "object" || value === null) return {summary: UNKNOWN, readable: false};
    const {browser, os} = value as {readonly browser?: unknown; readonly os?: unknown};
    const known = (name: unknown, names: ReadonlySet<string>) => (typeof name === "string" && names.has(name) ? name : null);
    const summary = {browser: known(browser, BROWSER_NAMES), os: known(os, OS_NAMES)};
    const readable = (browser === null || summary.browser !== null) && (os === null || summary.os !== null);
    return {summary, readable};
}
