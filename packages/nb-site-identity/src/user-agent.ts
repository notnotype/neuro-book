/**
 * 浏览器标识的概要（`site.accounts` 输出 17，副作用与数据一节“浏览器标识只存概要”；w00037 t07 计划 3.5）。
 *
 * 会话行的 `userAgent` 列存的不是原始的 `User-Agent`，而是 `{"browser":…,"os":…}` 的 JSON：建会话前的钩子（`auth.ts` 的
 * `databaseHooks.session.create.before`）把库按请求头填进去的原始写法换成它，原始写法不落库。会话列表按 JSON 读回。
 *
 * 识别用下面两张手写的规则表，各自先匹配先赢。顺序有讲究：很多浏览器的标识里同时带着别家的记号（Edge、Opera、三星浏览器、微信
 * 内置浏览器都带 `Chrome/` 与 `Safari/`，Chrome 带 `Safari/`；iPhone 带 `like Mac OS X`，Android 与 ChromeOS 带 `Linux`），所以
 * 带得多的排在前面。不引第三方解析库：只要两个粗名字（计划的技术选型表）。认不出的项为 null；两项都认不出时整列存 null。
 *
 * 识别在建会话前的钩子里同步跑，那时持着账号库的事务与队列（`auth.ts`），标识又是请求方随意给的，最长到请求头的上限（约 16 KiB）。
 * 所以先截到前 `USER_AGENT_SCAN_LENGTH` 个字符，规则里也不写 `.*` 这类会随长度回溯的写法：要两个记号都出现的，拆成几条各判一次
 * （实现审查第 6 到 8 片第 3 条：原来的 Safari 规则对病态的长标识是平方级的，16 KB 约 50 毫秒）。
 */

/**
 * 只看标识的前这么多个字符。各家浏览器真实的标识在 300 个字符以内，要认的记号都在里面，留出余量取 512；更长的只能是程序随手拼的，
 * 截掉的尾巴里若有记号就认不出，认不出比在持锁时多跑几十毫秒好。
 */
export const USER_AGENT_SCAN_LENGTH = 512;

/** 一条规则：名字与几个记号，记号全都出现才算匹配。每个记号是不回溯的固定写法，判一次的用时随长度线性增长。 */
type Rule = readonly [name: string, patterns: readonly RegExp[]];

/** 浏览器名的规则：第一个匹配的就是答案。 */
const BROWSER_RULES: readonly Rule[] = [
    ["WeChat", [/MicroMessenger\//u]],
    ["Samsung Internet", [/SamsungBrowser\//u]],
    ["Edge", [/\b(?:Edg|EdgA|EdgiOS|Edge)\//u]],
    ["Opera", [/\b(?:OPR|OPiOS|OPT)\/|\bOpera\b/u]],
    ["Firefox", [/\b(?:Firefox|FxiOS)\//u]],
    ["Chrome", [/\b(?:Chrome|CriOS|Chromium)\//u]],
    // 只有 Safari 自己同时带 `Version/` 与 `Safari/`；内嵌网页视图通常不带 `Version/`，认不出比认错好。两个记号的先后不判：
    // 真实的 Safari 总是 `Version/` 在前，不判先后只会多认出反着排的写法，那不是浏览器发的。
    ["Safari", [/\bVersion\/[\d.]+/u, /\bSafari\//u]],
];

/** 系统名的规则：第一个匹配的就是答案。iPadOS 的桌面模式报的是 Macintosh，分不出，算作 macOS。 */
const OS_RULES: readonly Rule[] = [
    ["iOS", [/\b(?:iPhone|iPad|iPod)\b/u]],
    ["Android", [/\bAndroid\b/u]],
    ["ChromeOS", [/\bCrOS\b/u]],
    ["Windows", [/\bWindows\b/u]],
    ["macOS", [/\bMac OS X\b|\bMacintosh\b/u]],
    ["Linux", [/\bLinux\b/u]],
];

const BROWSER_NAMES: ReadonlySet<string> = new Set(BROWSER_RULES.map(([name]) => name));
const OS_NAMES: ReadonlySet<string> = new Set(OS_RULES.map(([name]) => name));

/** 浏览器名与系统名，认不出的为 null。 */
export interface UserAgentSummary {
    readonly browser: string | null;
    readonly os: string | null;
}

const UNKNOWN: UserAgentSummary = {browser: null, os: null};

function firstMatch(rules: readonly Rule[], scanned: string): string | null {
    for (const [name, patterns] of rules) if (patterns.every((pattern) => pattern.test(scanned))) return name;
    return null;
}

/** 从原始的 `User-Agent` 认出浏览器名与系统名；只看前 `USER_AGENT_SCAN_LENGTH` 个字符。 */
export function summarizeUserAgent(raw: string): UserAgentSummary {
    const scanned = raw.slice(0, USER_AGENT_SCAN_LENGTH);
    return {browser: firstMatch(BROWSER_RULES, scanned), os: firstMatch(OS_RULES, scanned)};
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
