/**
 * 网络出口：按设置给每个对外请求选路（走哪个代理、还是直连），交回给 Bun 的按次 `proxy` 用的值。规则与已知行为见
 * docs/specs/network/egress.md。
 *
 * - **最内层总是显式写 `proxy`**：走代理写地址，其余（直连、旁路、系统没设）一律写 `false`。不写时 Bun 会读进程环境的
 *   `HTTP_PROXY`，pi-ai 也会按 `PI_PROXY` 自己加，选路就不归设置管了。
 * - 选不出路（代理是 SOCKS 或自动配置脚本、地址不合规、系统设置读不到）时报错、不发请求，不悄悄直连：用户设了代理却直连出去，
 *   在受限网络里会把请求送到不该去的地方。
 * - 不碰重定向：跟不跟随由调用方定（模型请求 `error`，列表与探测 `manual`）。
 */

import {bypassMatches, isLocalHost, parseProxy, splitList} from "./rules";
import {readSystemProxy} from "./system";
import type {ReadText, RunCommand, SystemRead, SystemSource} from "./system";

/** 代理方式：跟随系统（环境变量，再看操作系统设置）、自定义地址、直连。 */
export type ProxyMode = "system" | "custom" | "direct";

/** 一份代理设置：应用级的，或服务商自己的（盖过应用级）。`url` 只在 `custom` 时用。 */
export interface ProxySetting {
    readonly mode: ProxyMode;
    readonly url?: string | null;
}

/** `proxy-unsupported` 代理是 SOCKS 或自动配置脚本；`proxy-invalid` 地址写得不对；`proxy-unreadable` 系统的代理设置读不到。 */
export type EgressFailureCode = "proxy-unsupported" | "proxy-invalid" | "proxy-unreadable";

/** 一次请求的路：`proxy` 原样交给 Bun 的按次 `proxy`。 */
export type EgressRoute = {readonly ok: true; readonly proxy: string | false} | {readonly ok: false; readonly code: EgressFailureCode; readonly message: string};

/** 按目标地址选路；每次请求问一次（系统设置有缓存）。 */
export type EgressRouter = (url: URL) => Promise<EgressRoute>;

/** `fetchFor` 选不出路时抛出，请求没有发出。 */
export class EgressError extends Error {
    override readonly name = "EgressError";
    constructor(readonly code: EgressFailureCode, message: string) {
        super(message);
    }
}

/** 路从哪来：界面写出来。`local` 是目标为本机或私网地址。 */
export type EgressSource =
    | {readonly kind: "setting"}
    | {readonly kind: "direct"}
    | {readonly kind: "env"; readonly name: string}
    | {readonly kind: "system"; readonly name: SystemSource}
    | {readonly kind: "none"}
    | {readonly kind: "local"};

/**
 * 给人看的选路结果，不含用户名密码。`route`：`proxy` 走代理；`bypassed` 本来该走代理，但目标是本机或私网、或在旁路清单里；
 * `direct` 没有代理（直连方式，或系统没设）。`error` 非空时这个目标的请求会失败。
 */
export interface EgressSummary {
    readonly mode: ProxyMode;
    readonly route: "proxy" | "bypassed" | "direct";
    readonly source: EgressSource;
    /** 代理的协议、主机与端口。 */
    readonly origin: string | null;
    readonly hasCredentials: boolean;
    readonly error: {readonly code: EgressFailureCode; readonly message: string} | null;
}

export type EgressTestResult =
    | {readonly ok: true; readonly summary: EgressSummary; readonly ip: string | null; readonly elapsedMs: number}
    | {
        readonly ok: false;
        readonly summary: EgressSummary;
        readonly reason: EgressFailureCode | "unreachable" | "timeout" | "cancelled" | "bad-response";
        readonly status: number | null;
        readonly message: string;
    };

export interface EgressOptions {
    /** 应用级的设置，每次选路现读。 */
    setting(): ProxySetting;
    /** 启动时的环境变量快照：`HTTPS_PROXY`、`HTTP_PROXY`、`ALL_PROXY`、`NO_PROXY` 与读系统设置要的桌面与家目录。 */
    readonly startupEnv: Readonly<Record<string, string | undefined>>;
    readonly platform: NodeJS.Platform;
    /** 读系统设置用的命令；测试换成喂样本的。 */
    readonly run?: RunCommand;
    readonly readText?: ReadText;
    /** 毫秒时钟，系统设置的缓存用。 */
    readonly now?: () => number;
    /** 最终发请求的 `fetch`（缺省全局的）。 */
    readonly fetch?: typeof fetch;
    /** “测试代理”的目标；缺省 Cloudflare 的 trace。 */
    readonly testUrl?: string;
}

export interface Egress {
    /** 一份选路函数：`override` 是服务商自己的设置，不给时用应用级的。 */
    routeFor(override?: ProxySetting): EgressRouter;
    /** 按选路发请求的 `fetch`；选不出路时 reject `EgressError`，请求没有发出。 */
    fetchFor(override?: ProxySetting): typeof fetch;
    /** 某个目标（缺省是测试目标）会怎么走。 */
    describe(target?: URL, override?: ProxySetting): Promise<EgressSummary>;
    /** 经选出的路请求一次测试目标，交回出口 IP 与耗时。 */
    test(override?: ProxySetting, signal?: AbortSignal): Promise<EgressTestResult>;
}

/** 测试目标：响应小、带出口 IP（`ip=` 一行）。写进 Spec 的外联清单。 */
export const EGRESS_TEST_URL = "https://www.cloudflare.com/cdn-cgi/trace";
export const EGRESS_LIMITS = {systemTimeoutMs: 2000, systemCacheMs: 60_000, testTimeoutMs: 10_000, testBodyBytes: 16 * 1024} as const;

type Decision = {readonly summary: EgressSummary; readonly proxy: string | false};

export function createEgress(options: EgressOptions): Egress {
    const env = options.startupEnv;
    const now = options.now ?? Date.now;
    const send = options.fetch ?? fetch;
    const run = options.run ?? runCommand;
    const readText = options.readText ?? readTextFile;
    let cached: {readonly at: number; readonly read: Promise<SystemRead>} | null = null;
    /** 系统设置读一次缓存 60 秒，同时在读的共用一次：每个模型请求都跑一次 `reg query` 太慢。 */
    const systemProxy = (): Promise<SystemRead> => {
        if (cached === null || now() - cached.at >= EGRESS_LIMITS.systemCacheMs) {
            cached = {at: now(), read: readSystemProxy({platform: options.platform, env, run, readText, timeoutMs: EGRESS_LIMITS.systemTimeoutMs})};
        }
        return cached.read;
    };
    const envValue = (name: string): {readonly name: string; readonly value: string} | null => {
        for (const key of [name.toLowerCase(), name]) {
            const value = env[key]?.trim();
            if (value !== undefined && value !== "") return {name: key, value};
        }
        return null;
    };
    const noProxy = (): string[] => splitList(envValue("NO_PROXY")?.value ?? "");

    async function decide(target: URL, setting: ProxySetting): Promise<Decision> {
        const base = {mode: setting.mode, origin: null, hasCredentials: false, error: null} as const;
        if (setting.mode === "direct") return {proxy: false, summary: {...base, route: "direct", source: {kind: "direct"}}};
        if (isLocalHost(target.hostname)) return {proxy: false, summary: {...base, route: "bypassed", source: {kind: "local"}}};
        const failed = (source: EgressSource, code: EgressFailureCode, message: string): Decision => ({proxy: false, summary: {...base, route: "direct", source, error: {code, message}}});
        const via = (source: EgressSource, raw: string, bypass: readonly string[]): Decision => {
            const parsed = parseProxy(raw);
            if (!parsed.ok) {
                const where = source.kind === "env" ? `the ${source.name} environment variable` : source.kind === "system" ? `the ${source.name} proxy settings` : "the proxy setting";
                return parsed.reason === "unsupported"
                    ? failed(source, "proxy-unsupported", `${where} names a proxy that is not HTTP or HTTPS (SOCKS is not supported; use the HTTP port of the proxy software)`)
                    : failed(source, "proxy-invalid", `${where} is not a valid proxy address`);
            }
            const shown = {origin: parsed.address.origin, hasCredentials: parsed.address.hasCredentials};
            // 命中旁路时写 `false` 而不是交地址让 Bun 自己按 `NO_PROXY` 旁路：两边的匹配写法不必完全一致，界面说的就是实际走的。
            if (bypassMatches(bypass, target)) return {proxy: false, summary: {...base, ...shown, route: "bypassed", source}};
            return {proxy: parsed.address.url, summary: {...base, ...shown, route: "proxy", source}};
        };
        if (setting.mode === "custom") {
            if (setting.url === undefined || setting.url === null || setting.url.trim() === "") return failed({kind: "setting"}, "proxy-invalid", "the custom proxy has no address");
            if (/^[a-z][a-z0-9+.-]*:\/\/[^/]*@/iu.test(setting.url.trim())) return failed({kind: "setting"}, "proxy-invalid", "the custom proxy address must not contain a user name or password");
            // 自定义也认环境的 `NO_PROXY`：Bun 对显式的代理同样按它旁路（docs/specs/network/egress.md 的已知行为）。
            return via({kind: "setting"}, setting.url, noProxy());
        }
        const fromEnv = target.protocol === "https:" ? envValue("HTTPS_PROXY") ?? envValue("ALL_PROXY") : envValue("HTTP_PROXY") ?? envValue("ALL_PROXY");
        if (fromEnv !== null) return via({kind: "env", name: fromEnv.name}, fromEnv.value, noProxy());
        const read = await systemProxy();
        if (!read.ok) return failed(read.source === null ? {kind: "none"} : {kind: "system", name: read.source}, "proxy-unreadable", read.message);
        const source: EgressSource = read.source === null ? {kind: "none"} : {kind: "system", name: read.source};
        const proxy = read.proxy;
        if (proxy.kind === "none") return {proxy: false, summary: {...base, route: "direct", source}};
        if (proxy.kind === "pac") return failed(source, "proxy-unsupported", "the system proxy uses an automatic configuration script or auto-discovery, which is not supported; set a manual HTTP proxy or a custom proxy");
        const address = target.protocol === "https:" ? proxy.https : proxy.http;
        if (address === undefined) {
            if (proxy.socks !== undefined) return failed(source, "proxy-unsupported", "the system proxy is SOCKS only, which is not supported; use the HTTP port of the proxy software");
            return {proxy: false, summary: {...base, route: "direct", source}};
        }
        return via(source, address, proxy.bypass);
    }

    const settingOf = (override: ProxySetting | undefined): ProxySetting => override ?? options.setting();
    const routeFor = (override?: ProxySetting): EgressRouter => async (url) => {
        const decision = await decide(url, settingOf(override));
        const error = decision.summary.error;
        return error === null ? {ok: true, proxy: decision.proxy} : {ok: false, code: error.code, message: error.message};
    };
    const fetchFor = (override?: ProxySetting): typeof fetch => {
        const route = routeFor(override);
        return (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
            const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
            const decided = await route(new URL(href));
            if (!decided.ok) throw new EgressError(decided.code, decided.message);
            // Bun 的类型声明里 `proxy` 只有字符串；`false` 是 1.4.3 起的按次直连。
            return send(input, {...init, proxy: decided.proxy as string});
        }) as typeof fetch;
    };
    const describe = async (target?: URL, override?: ProxySetting): Promise<EgressSummary> => (await decide(target ?? new URL(options.testUrl ?? EGRESS_TEST_URL), settingOf(override))).summary;

    async function test(override?: ProxySetting, signal?: AbortSignal): Promise<EgressTestResult> {
        const url = new URL(options.testUrl ?? EGRESS_TEST_URL);
        const setting = settingOf(override);
        const decision = await decide(url, setting);
        const summary = decision.summary;
        if (summary.error !== null) return {ok: false, summary, reason: summary.error.code, status: null, message: summary.error.message};
        const timeout = AbortSignal.timeout(EGRESS_LIMITS.testTimeoutMs);
        const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
        const started = now();
        const failed = (reason: "unreachable" | "timeout" | "cancelled" | "bad-response", message: string, status: number | null = null): EgressTestResult => ({ok: false, summary, reason, status, message});
        const interrupted = (): EgressTestResult | null => (signal?.aborted === true ? failed("cancelled", "the test was cancelled") : timeout.aborted ? failed("timeout", `no answer within ${String(EGRESS_LIMITS.testTimeoutMs)} ms`) : null);
        let response: Response;
        try {
            response = await send(url, {method: "GET", redirect: "manual", signal: combined, proxy: decision.proxy as string});
        } catch (error) {
            return interrupted() ?? failed("unreachable", error instanceof Error ? error.message : String(error));
        }
        if (response.status !== 200) {
            await response.body?.cancel().catch(() => undefined);
            return failed("bad-response", `the test target answered ${String(response.status)}`, response.status);
        }
        let text: string;
        try {
            text = await readLimited(response, EGRESS_LIMITS.testBodyBytes);
        } catch (error) {
            return interrupted() ?? failed("unreachable", error instanceof Error ? error.message : String(error));
        }
        const ip = /^ip=(.+)$/mu.exec(text)?.[1]?.trim() ?? null;
        return {ok: true, summary, ip, elapsedMs: Math.max(0, Math.round(now() - started))};
    }

    return {routeFor, fetchFor, describe, test};
}

/** 读到上限为止（测试目标的响应只有几百字节；上限防它被换成别的大页面）。 */
async function readLimited(response: Response, limit: number): Promise<string> {
    const reader = response.body?.getReader();
    if (reader === undefined) return "";
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
        const {done, value} = await reader.read();
        if (done) break;
        size += value.byteLength;
        chunks.push(value);
        if (size >= limit) {
            await reader.cancel().catch(() => undefined);
            break;
        }
    }
    return new TextDecoder().decode(Buffer.concat(chunks)).slice(0, limit);
}

/** 缺省的命令执行：超时就杀掉并 reject。命令不存在时 Bun 抛 `ENOENT`，原样 reject。 */
const runCommand: RunCommand = async (command, timeoutMs) => {
    const child = Bun.spawn([...command], {stdout: "pipe", stderr: "ignore", stdin: "ignore"});
    let timedOut = false;
    const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
    }, timeoutMs);
    try {
        const [stdout, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
        if (timedOut) throw new Error(`${command[0] ?? ""} did not answer within ${String(timeoutMs)} ms`);
        return {code, stdout};
    } finally {
        clearTimeout(timer);
    }
};

const readTextFile: ReadText = async (path) => {
    const file = Bun.file(path);
    return (await file.exists()) ? file.text() : null;
};
