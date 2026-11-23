/**
 * 读操作系统的代理设置：Linux 的 GNOME（`gsettings`）与 KDE（`kioslaverc`），macOS 的 `scutil --proxy`，Windows 的注册表
 * （`reg query`）。只读、不改；解析函数按各平台命令的原样输出写，测试喂样本。
 *
 * “读不到”与“没设代理”分开：命令不存在（没装 GNOME 的 Linux）算没设；命令失败、超时或输出认不出来算读不到，由调用方报错，
 * 不悄悄直连。
 */

import {splitList} from "./rules";

/**
 * 系统设置给的规则。`manual` 按协议给地址（原样，可能不带协议名）；`pac` 是自动配置脚本或自动发现，不支持（决定 21）；`unsupported`
 * 是读得懂、但这里不实现的别的规则（KDE 的“只有例外走代理”），同样不悄悄直连。
 */
export type SystemProxy =
    | {readonly kind: "none"}
    | {readonly kind: "manual"; readonly http?: string; readonly https?: string; readonly socks?: string; readonly bypass: readonly string[]}
    | {readonly kind: "pac"}
    | {readonly kind: "unsupported"; readonly reason: string};

/** 哪一处的设置：界面写出来源。 */
export type SystemSource = "gnome" | "kde" | "macos" | "windows";

export type SystemRead =
    | {readonly ok: true; readonly source: SystemSource | null; readonly proxy: SystemProxy}
    | {readonly ok: false; readonly source: SystemSource | null; readonly message: string};

/** 跑一个命令：`code` 是退出码。命令不存在时 reject，错误的 `code` 为 `ENOENT`。 */
export type RunCommand = (command: readonly string[], timeoutMs: number) => Promise<{readonly code: number; readonly stdout: string}>;
/** 读一个文本文件；不存在时为 null。 */
export type ReadText = (path: string) => Promise<string | null>;

export interface SystemReaderOptions {
    readonly platform: NodeJS.Platform;
    readonly env: Readonly<Record<string, string | undefined>>;
    readonly run: RunCommand;
    readonly readText: ReadText;
    readonly timeoutMs: number;
}

const NONE: SystemProxy = {kind: "none"};
const missing = (error: unknown): boolean => (error as {code?: unknown} | null)?.code === "ENOENT";
const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export async function readSystemProxy(options: SystemReaderOptions): Promise<SystemRead> {
    const {platform, env} = options;
    if (platform === "darwin") return viaCommand(options, "macos", ["scutil", "--proxy"], parseScutil, false);
    if (platform === "win32") {
        return viaCommand(options, "windows", ["reg", "query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings"], parseWindowsRegistry, false);
    }
    if (platform !== "linux" && platform !== "freebsd" && platform !== "openbsd") return {ok: true, source: null, proxy: NONE};
    if ((env.XDG_CURRENT_DESKTOP ?? "").split(":").some((name) => name.toUpperCase() === "KDE")) {
        const home = env.XDG_CONFIG_HOME ?? (env.HOME === undefined ? null : `${env.HOME}/.config`);
        if (home === null) return {ok: true, source: "kde", proxy: NONE};
        try {
            const text = await options.readText(`${home}/kioslaverc`);
            if (text === null) return {ok: true, source: "kde", proxy: NONE};
            const proxy = parseKioslaverc(text);
            return proxy === null ? {ok: false, source: "kde", message: "kioslaverc has a proxy type this reader does not know"} : {ok: true, source: "kde", proxy};
        } catch (error) {
            return {ok: false, source: "kde", message: `reading kioslaverc failed: ${describeError(error)}`};
        }
    }
    // 不是 KDE 的都问 gsettings：GNOME、基于它的桌面与没有桌面的会话（这时它答缺省值 `none`）。没装 gsettings 算没设。
    return viaCommand(options, "gnome", ["gsettings", "list-recursively", "org.gnome.system.proxy"], parseGsettings, true);
}

async function viaCommand(options: SystemReaderOptions, source: SystemSource, command: readonly string[], parse: (stdout: string) => SystemProxy | null, absentIsNone: boolean): Promise<SystemRead> {
    let result: {readonly code: number; readonly stdout: string};
    try {
        result = await options.run(command, options.timeoutMs);
    } catch (error) {
        if (absentIsNone && missing(error)) return {ok: true, source: null, proxy: NONE};
        return {ok: false, source, message: `${command[0] ?? ""} failed: ${describeError(error)}`};
    }
    if (result.code !== 0) {
        // `gsettings` 没有这个模式（装了别的桌面、没装 GNOME 的模式）时非零退出：算没设。
        if (absentIsNone) return {ok: true, source: null, proxy: NONE};
        return {ok: false, source, message: `${command[0] ?? ""} exited with ${String(result.code)}`};
    }
    const proxy = parse(result.stdout);
    return proxy === null ? {ok: false, source, message: `${command[0] ?? ""} printed settings this reader does not understand`} : {ok: true, source, proxy};
}

const hostPort = (host: string | undefined, port: string | undefined): string | undefined => {
    if (host === undefined || host === "" || port === undefined || port === "" || port === "0") return undefined;
    return `${host}:${port}`;
};

/** `gsettings list-recursively org.gnome.system.proxy` 的输出：每行 `<schema> <key> <value>`，字符串值带单引号。 */
export function parseGsettings(stdout: string): SystemProxy | null {
    const values = new Map<string, string>();
    for (const line of stdout.split("\n")) {
        const match = /^(org\.gnome\.system\.proxy(?:\.[a-z]+)?) ([a-z-]+) (.*)$/u.exec(line.trim());
        if (match !== null) values.set(`${match[1] ?? ""} ${match[2] ?? ""}`, (match[3] ?? "").trim());
    }
    const text = (key: string): string | undefined => {
        const value = values.get(key);
        if (value === undefined) return undefined;
        return /^'(.*)'$/u.exec(value)?.[1] ?? value;
    };
    const mode = text("org.gnome.system.proxy mode");
    if (mode === undefined) return null;
    if (mode === "none") return NONE;
    if (mode === "auto") return {kind: "pac"};
    if (mode !== "manual") return null;
    const of = (kind: string): string | undefined => hostPort(text(`org.gnome.system.proxy.${kind} host`), text(`org.gnome.system.proxy.${kind} port`));
    // HTTP 代理的认证（`use-authentication`）：写进地址交给 Bun（它变成 `Proxy-Authorization`），说明里只写“带用户名与密码”。
    const http = of("http");
    const user = text("org.gnome.system.proxy.http authentication-user") ?? "";
    const authed = http !== undefined && values.get("org.gnome.system.proxy.http use-authentication") === "true" && user !== ""
        ? `http://${encodeURIComponent(user)}:${encodeURIComponent(text("org.gnome.system.proxy.http authentication-password") ?? "")}@${http}`
        : http;
    const ignore = values.get("org.gnome.system.proxy ignore-hosts") ?? "[]";
    const bypass = [...ignore.matchAll(/'([^']*)'/gu)].map((match) => match[1] ?? "").filter((entry) => entry !== "");
    // HTTPS 没单独设时用 HTTP 的那一个：GNOME 自己的解析（GProxyResolverGnome）就是这样回退的。
    return manual(authed, of("https") ?? authed, of("socks"), bypass);
}

function manual(http: string | undefined, https: string | undefined, socks: string | undefined, bypass: readonly string[]): SystemProxy {
    return {kind: "manual", ...(http === undefined ? {} : {http}), ...(https === undefined ? {} : {https}), ...(socks === undefined ? {} : {socks}), bypass};
}

/**
 * KDE 的 `kioslaverc` 的 `[Proxy Settings]` 组：`ProxyType` 0 不用、1 手动、2 自动配置脚本、3 自动发现、4 用环境变量（环境变量
 * 已先读过，这里算没设）。地址写成 `http://host:8080` 或 `http://host 8080`。
 */
export function parseKioslaverc(text: string): SystemProxy | null {
    const values = new Map<string, string>();
    let inGroup = false;
    for (const raw of text.split("\n")) {
        const line = raw.trim();
        if (line.startsWith("[")) {
            inGroup = line === "[Proxy Settings]";
            continue;
        }
        const equals = line.indexOf("=");
        if (inGroup && equals > 0) values.set(line.slice(0, equals).trim(), line.slice(equals + 1).trim());
    }
    const type = values.get("ProxyType") ?? "0";
    if (type === "0" || type === "4") return NONE;
    if (type === "2" || type === "3") return {kind: "pac"};
    if (type !== "1") return null;
    // “只有例外里的目标走代理”（`ReversedException`）与一般的旁路清单相反，这里不实现：报不支持，不按旁路清单走反了路。
    const reversed = (values.get("ReversedException") ?? "").toLowerCase();
    if (reversed === "1" || reversed === "true") return {kind: "unsupported", reason: "KDE's reversed proxy exceptions (only the listed hosts use the proxy)"};
    const of = (key: string): string | undefined => {
        const value = values.get(key)?.replace(/\s+(\d+)$/u, ":$1");
        return value === undefined || value === "" ? undefined : value;
    };
    return manual(of("httpProxy"), of("httpsProxy"), of("socksProxy"), splitList(values.get("NoProxyFor") ?? ""));
}

/**
 * `scutil --proxy` 的输出：最外层 `<dictionary> {` 里每行 `Key : value`，`ExceptionsList : <array> {` 里每行 `N : 条目`。只读最外层：
 * `__SCOPED__` 等嵌套的字典是按网卡或域名的配置，不是全局的；把它们的同名键并进来会把只给某个网卡的代理用到别处。
 * 自动配置脚本或自动发现开着时按不支持报，哪怕同时设了手动地址（系统按脚本走，我们照手动走就与系统不一致了）。
 */
export function parseScutil(stdout: string): SystemProxy | null {
    if (!stdout.includes("<dictionary>")) return null;
    const values = new Map<string, string>();
    const exceptions: string[] = [];
    /** 当前在第几层花括号里；最外层的字典是第 1 层。 */
    let depth = 0;
    let inExceptions = false;
    for (const raw of stdout.split("\n")) {
        const line = raw.trim();
        if (line === "}") {
            if (inExceptions && depth === 2) inExceptions = false;
            depth -= 1;
            continue;
        }
        if (line.endsWith("{")) {
            depth += 1;
            if (depth === 2 && /^ExceptionsList : <array> \{$/u.test(line)) inExceptions = true;
            continue;
        }
        if (inExceptions && depth === 2) {
            const entry = /^\d+ : (.*)$/u.exec(line)?.[1];
            if (entry !== undefined) exceptions.push(entry.trim());
            continue;
        }
        if (depth !== 1) continue;
        const match = /^([A-Za-z]+) : (.*)$/u.exec(line);
        if (match !== null) values.set(match[1] ?? "", (match[2] ?? "").trim());
    }
    if (values.get("ProxyAutoConfigEnable") === "1" || values.get("ProxyAutoDiscoveryEnable") === "1") return {kind: "pac"};
    const of = (prefix: string): string | undefined => (values.get(`${prefix}Enable`) === "1" ? hostPort(values.get(`${prefix}Proxy`), values.get(`${prefix}Port`)) : undefined);
    const http = of("HTTP");
    const https = of("HTTPS");
    const socks = of("SOCKS");
    if (http === undefined && https === undefined && socks === undefined) return NONE;
    if (values.get("ExcludeSimpleHostnames") === "1") exceptions.push("<local>");
    return manual(http, https, socks, exceptions);
}

/**
 * `reg query "HKCU\...\Internet Settings"` 的输出：每行 `    名字    REG_类型    值`。`ProxyServer` 是 `host:port`（各协议共用）
 * 或 `http=h:p;https=h:p;socks=h:p`；`ProxyOverride` 分号分隔，`<local>` 指不带点的主机名；`AutoConfigURL` 有值是自动配置脚本。
 * 自动发现（WPAD，“自动检测设置”）的开关在二进制的连接设置里，这里不读：它在 Windows 上缺省开着、多数网络里找不到配置，系统自己
 * 会退回手动设置或直连；把它当成“不支持”会让缺省设置的用户每个请求都失败（docs/specs/network/egress.md 的已知行为）。
 */
export function parseWindowsRegistry(stdout: string): SystemProxy | null {
    const values = new Map<string, string>();
    for (const line of stdout.split(/\r?\n/u)) {
        const match = /^\s+(\S+)\s+(REG_[A-Z_]+)\s*(.*)$/u.exec(line);
        if (match !== null) values.set((match[1] ?? "").toLowerCase(), (match[3] ?? "").trim());
    }
    if (values.size === 0) return null;
    if ((values.get("autoconfigurl") ?? "") !== "") return {kind: "pac"};
    const enabled = values.get("proxyenable");
    if (enabled === undefined || Number(enabled) === 0) return NONE;
    const server = values.get("proxyserver") ?? "";
    if (server === "") return NONE;
    const bypass = (values.get("proxyoverride") ?? "").split(";").map((entry) => entry.trim()).filter((entry) => entry !== "");
    if (!server.includes("=")) return manual(server, server, undefined, bypass);
    const parts = new Map(server.split(";").map((part) => {
        const equals = part.indexOf("=");
        return [part.slice(0, equals).trim().toLowerCase(), part.slice(equals + 1).trim()] as const;
    }));
    const of = (key: string): string | undefined => {
        const value = parts.get(key);
        return value === undefined || value === "" ? undefined : value;
    };
    return manual(of("http"), of("https"), of("socks"), bypass);
}
