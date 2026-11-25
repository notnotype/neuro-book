/**
 * 三个写入口共用的限流（docs/specs/site/telemetry-ingest.md 输出 8、9）。
 *
 * 状态只在本进程的内存里：两张 `Map`，一个窗口一份，进程重启就清零。来源地址只作为这两张表的键存在，不写日志、不进库，
 * 窗口一过整张表清掉（`take` 发现换了窗口时，或没有新请求时由 `sweep`）。
 *
 * 时间取自调用方给的 `now`（模块的 `clock.now()`）：合同测试拨时间就能跨窗口。窗口按 `now` 对齐，不是滑动的。
 *
 * 来源地址由入口写成了唯一的一种写法（`site.operations` 的输入一节“来源地址”：IPv4 点分，IPv6 小写压缩），
 * 这里不再规范化写法，只按解析出的地址值取 IPv6 的前缀：压缩写法里 `::` 的位置会变，按字符串截前几组会截错。
 */

/** 对齐的时间窗：每小时的 0、10、20 分起（输出 9）。 */
export const RATE_LIMIT_WINDOW_MS = 600_000;

/** 一个窗口里至多这么多个来源（IPv4 地址与 IPv6 的 /64）；满了之后新来源一律拒绝。10 万个约 12 MB（w00037 t06 计划探针 8）。 */
export const RATE_LIMIT_MAX_SOURCES = 100_000;

/** IPv6 的 /48 合计的额度是单个来源的这么多倍（输出 9）。 */
export const PREFIX48_LIMIT_FACTOR = 16;

export type RateLimitDecision = {readonly ok: true} | {readonly ok: false; readonly retryAfterSeconds: number};

export interface RateLimiter {
    /**
     * 计入一个请求并判它能不能过。过了才计数；被拒的不计。`source` 必须是规范写法的 IP 字面量（`ModuleContext.clientAddress`
     * 的返回值），不是时抛 `TypeError`：那是入口的程序错误，不能悄悄把它当成一个来源。
     */
    take(source: string): RateLimitDecision;
    /** 换了窗口就清空：没有新请求时，上一个窗口的地址也按时离开内存（输出 8）。由定时任务调用。 */
    sweep(): void;
    /** 内存里记着的来源数（上一次 `take` 或 `sweep` 时的窗口）；定时任务可以拿它看离上限还有多远。 */
    sources(): number;
}

export interface RateLimiterOptions {
    /** 每个来源每个窗口的请求数（`NB_SITE_TELEMETRY_RATE_LIMIT`）。 */
    readonly limit: number;
    readonly now: () => number;
    /** 缺省 `RATE_LIMIT_MAX_SOURCES`；包内测试给小一点的值。 */
    readonly maxSources?: number;
}

/**
 * IPv6 字面量展开成 8 个 16 位的组；不是 IPv6 的十六进制写法时为 null。末尾写成点分 IPv4 的写法不收：入口的规范写法
 * 是 WHATWG `URL` 的序列化，不会出现它（映射地址已当作 IPv4）。
 */
function ipv6Groups(address: string): number[] | null {
    const halves = address.split("::");
    if (halves.length > 2) return null;
    const parse = (part: string): number[] | null => {
        if (part === "") return [];
        const groups = part.split(":");
        if (!groups.every((group) => /^[0-9a-fA-F]{1,4}$/u.test(group))) return null;
        return groups.map((group) => Number.parseInt(group, 16));
    };
    const head = parse(halves[0]!);
    const tail = halves.length === 2 ? parse(halves[1]!) : [];
    if (head === null || tail === null) return null;
    if (halves.length === 1) return head.length === 8 ? head : null;
    // `::` 至少代表一组零。
    const zeros = 8 - head.length - tail.length;
    return zeros >= 1 ? [...head, ...new Array<number>(zeros).fill(0), ...tail] : null;
}

const IPV4 = /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/u;

/** 限流的键：IPv4 是地址本身；IPv6 是 /64，另给 /48 的合计键。 */
function keysOf(source: string): {readonly source: string; readonly prefix48: string | null} {
    if (IPV4.test(source)) return {source, prefix48: null};
    const groups = ipv6Groups(source);
    if (groups === null) throw new TypeError("rate limiter source is not an IP literal");
    const hex = (count: number): string => groups.slice(0, count).map((group) => group.toString(16)).join(":");
    return {source: `${hex(4)}::/64`, prefix48: `${hex(3)}::/48`};
}

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
    const maxSources = options.maxSources ?? RATE_LIMIT_MAX_SOURCES;
    const prefix48Limit = options.limit * PREFIX48_LIMIT_FACTOR;
    /** 来源（IPv4 地址或 IPv6 的 /64）在本窗口里计入的请求数；它的大小就是来源数。 */
    const counts = new Map<string, number>();
    /**
     * IPv6 的 /48 在本窗口里计入的请求数。条目只在它下面的 /64 计入时建，所以条数不超过 `counts`：
     * 一个人换着 /48 刷，也让内存跟着来源数的上限封顶。
     */
    const prefix48Counts = new Map<string, number>();
    let window = Number.NaN;

    const roll = (now: number): void => {
        const current = Math.floor(now / RATE_LIMIT_WINDOW_MS);
        if (current === window) return;
        window = current;
        counts.clear();
        prefix48Counts.clear();
    };

    return {
        take: (source) => {
            const keys = keysOf(source);
            const now = options.now();
            roll(now);
            const rejected = (): RateLimitDecision => ({ok: false, retryAfterSeconds: Math.max(1, Math.ceil(((window + 1) * RATE_LIMIT_WINDOW_MS - now) / 1000))});
            // 先判 /48 的合计，再看 /64 的条目：被 /48 挡下的不为它下面的新 /64 建条目。
            const prefix48Count = keys.prefix48 === null ? 0 : (prefix48Counts.get(keys.prefix48) ?? 0);
            if (prefix48Count >= prefix48Limit) return rejected();
            const count = counts.get(keys.source);
            if (count === undefined && counts.size >= maxSources) return rejected();
            if ((count ?? 0) >= options.limit) return rejected();
            counts.set(keys.source, (count ?? 0) + 1);
            if (keys.prefix48 !== null) prefix48Counts.set(keys.prefix48, prefix48Count + 1);
            return {ok: true};
        },
        sweep: () => roll(options.now()),
        sources: () => counts.size,
    };
}
