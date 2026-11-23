/**
 * 选路用到的纯规则：哪些目标总是直连、代理地址怎么读、旁路清单怎么匹配。只看主机串，不做 DNS 解析（解析了也不能保证与 Bun
 * 实际连的是同一个地址，而且会让每次选路多一次网络往返）。
 */

/** 本机与私网地址：总是直连。主机名只认 `localhost` 与 `*.localhost`；IP 认回环、私网、链路本地，含 IPv4 映射的 IPv6。 */
export function isLocalHost(hostname: string): boolean {
    const host = hostname.toLowerCase().replace(/^\[|\]$/gu, "").replace(/\.$/u, "");
    if (host === "localhost" || host.endsWith(".localhost")) return true;
    const v4 = ipv4(host);
    if (v4 !== null) return localV4(v4);
    if (!host.includes(":")) return false;
    const groups = ipv6(host);
    if (groups === null) return false;
    if (groups.every((group, index) => group === (index === 7 ? 1 : 0))) return true;
    if (groups.every((group) => group === 0)) return true;
    // IPv4 映射（`::ffff:a.b.c.d`，URL 会规范成 `::ffff:7f00:1` 这种十六进制写法）。
    if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
        const high = groups[6] ?? 0;
        const low = groups[7] ?? 0;
        return localV4([high >> 8, high & 0xff, low >> 8, low & 0xff]);
    }
    const first = groups[0] ?? 0;
    return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80;
}

function localV4([a, b]: readonly number[]): boolean {
    if (a === undefined || b === undefined) return false;
    return a === 127 || a === 10 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

/** 点分四段的 IPv4；不是时为 null。 */
function ipv4(host: string): number[] | null {
    const parts = host.split(".");
    if (parts.length !== 4 || !parts.every((part) => /^\d{1,3}$/u.test(part))) return null;
    const numbers = parts.map(Number);
    return numbers.every((value) => value <= 255) ? numbers : null;
}

/** 展开成 8 组的 IPv6；末尾可以是点分的 IPv4。不是合法写法时为 null。 */
function ipv6(host: string): number[] | null {
    // 末尾点分的 IPv4 换成两组十六进制，后面只处理一种写法。
    const lastColon = host.lastIndexOf(":");
    const v4 = ipv4(host.slice(lastColon + 1));
    const text = v4 === null ? host : `${host.slice(0, lastColon + 1)}${(((v4[0] ?? 0) << 8) | (v4[1] ?? 0)).toString(16)}:${(((v4[2] ?? 0) << 8) | (v4[3] ?? 0)).toString(16)}`;
    const halves = text.split("::");
    if (halves.length > 2) return null;
    const parse = (part: string): number[] | null => {
        if (part === "") return [];
        const groups = part.split(":");
        if (!groups.every((group) => /^[0-9a-f]{1,4}$/u.test(group))) return null;
        return groups.map((group) => Number.parseInt(group, 16));
    };
    const head = parse(halves[0] ?? "");
    const rest = halves.length === 2 ? parse(halves[1] ?? "") : [];
    if (head === null || rest === null) return null;
    const known = head.length + rest.length;
    if (halves.length === 1 ? known !== 8 : known > 7) return null;
    return [...head, ...Array<number>(8 - known).fill(0), ...rest];
}

/** 读出来的代理地址：`url` 可以直接交给 Bun 的 `proxy`；`origin` 是去掉用户名密码后给人看的。 */
export interface ProxyAddress {
    readonly url: string;
    readonly origin: string;
    readonly hasCredentials: boolean;
}

export type ParsedProxy = {readonly ok: true; readonly address: ProxyAddress} | {readonly ok: false; readonly reason: "unsupported" | "invalid"};

/**
 * 读一个代理地址。环境变量与系统设置里常省略协议（`proxy.example:8080`），按 http 补上；只收 http 与 https，SOCKS 等别的协议
 * 是 `unsupported`（Bun 的 `fetch` 不支持，决定 21）。
 */
export function parseProxy(raw: string): ParsedProxy {
    const text = raw.trim();
    if (text === "") return {ok: false, reason: "invalid"};
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//iu.test(text) ? text : `http://${text}`;
    let url: URL;
    try {
        url = new URL(withScheme);
    } catch {
        return {ok: false, reason: "invalid"};
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return {ok: false, reason: "unsupported"};
    if (url.hostname === "") return {ok: false, reason: "invalid"};
    return {ok: true, address: {url: url.href, origin: url.origin, hasCredentials: url.username !== "" || url.password !== ""}};
}

/**
 * 旁路清单（`NO_PROXY`、系统设置里的例外）是否命中目标。各来源的写法合在一起认：`*` 全部；`<local>`（Windows）不带点的主机名；
 * IPv4 网段 `10.0.0.0/8` 与 macOS 的简写 `169.254/16`；带 `*` 的通配；前导 `.` 或 `*.` 只配子域名；其余配本身与子域名（curl 的写法）。
 * 写了端口的只在端口相同时命中。
 */
export function bypassMatches(entries: readonly string[], target: URL): boolean {
    const host = target.hostname.toLowerCase().replace(/^\[|\]$/gu, "").replace(/\.$/u, "");
    const port = target.port === "" ? (target.protocol === "https:" ? "443" : "80") : target.port;
    for (const raw of entries) {
        let entry = raw.trim().toLowerCase();
        if (entry === "") continue;
        if (entry === "*") return true;
        if (entry === "<local>") {
            if (!host.includes(".") && !host.includes(":")) return true;
            continue;
        }
        const cidr = /^(\d{1,3}(?:\.\d{1,3}){0,3})\/(\d{1,2})$/u.exec(entry);
        if (cidr !== null) {
            if (inCidr(host, cidr[1] ?? "", Number(cidr[2]))) return true;
            continue;
        }
        const withPort = /^(.*[^:\]]):(\d+)$/u.exec(entry);
        if (withPort !== null && !entry.startsWith("[") && (withPort[1] ?? "").split(":").length === 1) {
            if (withPort[2] !== port) continue;
            entry = withPort[1] ?? "";
        }
        entry = entry.replace(/^\[|\]$/gu, "");
        if (entry.includes("*") && !entry.startsWith("*.")) {
            const pattern = new RegExp(`^${entry.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/gu, "\\$&")).join(".*")}$`, "u");
            if (pattern.test(host)) return true;
            continue;
        }
        const suffixOnly = entry.startsWith(".") || entry.startsWith("*.");
        const name = entry.replace(/^\*?\./u, "");
        if (host.endsWith(`.${name}`)) return true;
        if (!suffixOnly && host === name) return true;
    }
    return false;
}

function inCidr(host: string, network: string, bits: number): boolean {
    const target = ipv4(host);
    if (target === null || bits > 32) return false;
    const parts = network.split(".").map(Number);
    while (parts.length < 4) parts.push(0);
    if (parts.some((value) => value > 255)) return false;
    // 按数值比前 `bits` 位（不用位运算：JS 的位运算是有符号 32 位，最高位为 1 的地址会变成负数）。
    const toNumber = (value: readonly number[]): number => value.reduce((sum, part) => sum * 256 + part, 0);
    const block = 2 ** (32 - bits);
    return Math.floor(toNumber(target) / block) === Math.floor(toNumber(parts) / block);
}

/** 逗号或空白分隔的清单（`NO_PROXY`、KDE 的 `NoProxyFor`）；Windows 的分号另拆。 */
export const splitList = (text: string): string[] => text.split(/[,;\s]+/u).filter((entry) => entry !== "");
