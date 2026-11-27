/**
 * 进程的配置，只来自环境变量（`site.operations` 的输入一节、输出 1）。入口读各进程都要的那几项，各模块的 `parseConfig`
 * 读自己的（会话密钥归账号模块）；问题合在一起报。
 *
 * 不泄漏取值靠结构保证：每个校验函数只返回问题词，拼说明与输出那一行的代码只拿到变量名与问题词，拿不到值。
 * 校验在读写任何数据文件之前做；只 `stat` 与 `access` 数据目录本身。
 */

import {accessSync, constants, realpathSync, statSync} from "node:fs";
import {BlockList, isIP} from "node:net";
import {isAbsolute, join} from "node:path";

import {hostnameKey} from "./hostname";
import type {CommandFailure, ConfigProblem, SiteModule, SiteSettings} from "./module";
import {isInsideDir} from "./web";

export type Env = Readonly<Record<string, string | undefined>>;

export interface BaseConfig {
    readonly site: SiteSettings;
    /** 只有本进程有模块用到写入口时才有；按主机分派用它。 */
    readonly telemetryHost: string | null;
    readonly dataDir: string;
    readonly host: string;
    /** 0 表示由系统挑一个空闲端口。 */
    readonly port: number;
    readonly trustedProxies: BlockList;
    readonly backupKeep: number;
    readonly shutdownTimeoutMs: number;
    /**
     * `NB_SITE_TEST_CONTROL` 的口令；没设时为 null，`serve` 就不挂测试控制入口（`site.operations` 输出 11）。
     * 这是秘密：只交给比较口令的那一处，不进日志、失败行与响应。
     */
    readonly testControlToken: string | null;
    /**
     * 前端产物目录（`NB_SITE_WEB_DIR`）的真实路径（已解开符号链接）；没设时为 null，`serve` 就不发网页（`site.operations` 输出 12）。
     * 存真实路径：发文件时按它判断解开链接之后的路径还在不在目录里（`web.ts`）。链接只在启动时解开这一次：部署时若让
     * `NB_SITE_WEB_DIR` 指向一个链接、换链接的指向来切换版本，进程仍发旧目录，要重启（Spec 的配置表写明）。
     */
    readonly webDir: string | null;
}

export interface SiteConfig {
    readonly base: BaseConfig;
    /** 按模块名取各模块 `parseConfig` 的结果。 */
    readonly modules: ReadonlyMap<string, unknown>;
}

export type SiteConfigResult = {readonly ok: true; readonly config: SiteConfig} | {readonly ok: false; readonly problems: readonly ConfigProblem[]};

/** 问题词：取自 `site.operations` 失败与恢复一节的词表。 */
type Problem = "missing" | "not_https" | "has_path" | "same_host" | "not_absolute" | "not_directory" | "not_writable" | "too_short" | "not_integer" | "out_of_range" | "bad_subnet" | "not_ip" | "not_loopback" | "bad_format" | "no_index";

type Parsed<T> = {readonly ok: true; readonly value: T} | {readonly ok: false; readonly problem: Problem};

const ok = <T>(value: T): Parsed<T> => ({ok: true, value});
const bad = (problem: Problem): Parsed<never> => ({ok: false, problem});

/** 没设与设成空串都算没给：容器与 Compose 里常见 `NB_SITE_X=` 这种写法。 */
function present(value: string | undefined): string | undefined {
    return value === undefined || value === "" ? undefined : value;
}

/** HTTPS 根地址：没有路径（只能是 `/`）、查询串与片段。解析不了的也算 `not_https`。 */
function parseRootUrl(value: string): Parsed<URL> {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        // 解析不了就不是 HTTPS 地址；错误对象里带着原值，不往外传。
        return bad("not_https");
    }
    if (url.protocol !== "https:") return bad("not_https");
    if (url.pathname !== "/" || url.search !== "" || url.hash !== "") return bad("has_path");
    return ok(url);
}

function parseDataDir(value: string): Parsed<string> {
    if (!isAbsolute(value)) return bad("not_absolute");
    try {
        if (!statSync(value).isDirectory()) return bad("not_directory");
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        // 不存在或路径中间有一段不是目录：程序不替部署的人创建；别的错误（多半是没有权限）按不可写报。
        return bad(code === "ENOENT" || code === "ENOTDIR" ? "not_directory" : "not_writable");
    }
    try {
        accessSync(value, constants.W_OK | constants.X_OK);
    } catch {
        // access 失败只有一种含义：不可写。
        return bad("not_writable");
    }
    return ok(value);
}

/**
 * 前端产物目录：绝对路径、已经存在的目录、里面有 `index.html` 这个文件（单页回退要发它）。返回解开符号链接之后的真实路径。
 * 只看目录与 `index.html` 本身，不读别的文件；读不到（不存在、中间一段不是目录、没有权限）都按 `not_directory` 报，
 * 这里没有“可写”的要求。
 */
function parseWebDir(value: string): Parsed<string> {
    if (!isAbsolute(value)) return bad("not_absolute");
    let real: string;
    try {
        real = realpathSync(value);
        if (!statSync(real).isDirectory()) return bad("not_directory");
    } catch {
        // 错误对象里带着路径，不往外传；哪一种读不到对部署的人都是“这不是一个能用的目录”。
        return bad("not_directory");
    }
    try {
        // 与发文件时同一条规则（`web.ts` 的 `isInsideDir`）：经链接落到目录外的 `index.html` 回退发不出，不算有。
        const index = realpathSync(join(real, "index.html"));
        if (!isInsideDir(real, index) || !statSync(index).isFile()) return bad("no_index");
    } catch {
        // 没有这个文件，或它是指向不存在之处的链接。
        return bad("no_index");
    }
    return ok(real);
}

/** `setTimeout` 能表示的最大延时（2^31 - 1 毫秒）。 */
const MAX_TIMER_DELAY_MS = 2_147_483_647;

/** `min` 到 `max` 的整数。`-1` 这种是整数、只是越界。 */
function parseInteger(value: string, min: number, max: number): Parsed<number> {
    if (!/^-?\d+$/u.test(value)) return bad("not_integer");
    const number = Number(value);
    return number < min || number > max ? bad("out_of_range") : ok(number);
}

/**
 * 测试控制口令（`site.operations` 的配置表）：32 到 256 个大小写字母、数字、`-`、`_`。口令要原样放进 `Authorization` 请求头，
 * 汉字放不进请求头、末尾的空格会被 HTTP 客户端去掉，这类值配得进去却永远对不上，所以在启动时就拒绝。
 */
const TEST_CONTROL_MIN_LENGTH = 32;
const TEST_CONTROL_MAX_LENGTH = 256;
const TEST_CONTROL_CHARS = /^[A-Za-z0-9_-]+$/u;

/** 短于下限是 `too_short`；够长但过长或含别的字符是 `bad_format`。长度按码点计，短的那一侧与会话密钥同一种数法。 */
function testControlProblem(token: string): Problem | undefined {
    const length = [...token].length;
    if (length < TEST_CONTROL_MIN_LENGTH) return "too_short";
    if (length > TEST_CONTROL_MAX_LENGTH || !TEST_CONTROL_CHARS.test(token)) return "bad_format";
    return undefined;
}

const LOOPBACK_V4 = (() => {
    const list = new BlockList();
    list.addSubnet("127.0.0.0", 8, "ipv4");
    return list;
})();

/**
 * 本机回环：`127.0.0.0/8` 与 `::1`。IPv6 先经 `URL` 规范化，`0:0:0:0:0:0:0:1` 这类写法也认；`::ffff:127.0.0.1` 这类
 * 映射地址不算：认得少只会多拒，不会让测试控制入口暴露到回环之外。
 */
function isLoopback(host: string): boolean {
    const family = isIP(host);
    if (family === 4) return LOOPBACK_V4.check(host, "ipv4");
    return family === 6 && URL.parse(`http://[${host}]/`)?.hostname === "[::1]";
}

/** 逗号分隔的网段；只写地址时当作单个地址（IPv4 的 /32、IPv6 的 /128）。 */
function parseSubnets(value: string): Parsed<BlockList> {
    const list = new BlockList();
    for (const entry of value.split(",").map((item) => item.trim())) {
        const [address = "", prefix, extra] = entry.split("/");
        const family = isIP(address);
        if (family === 0 || extra !== undefined) return bad("bad_subnet");
        const bits = prefix === undefined ? (family === 4 ? 32 : 128) : /^\d+$/u.test(prefix) ? Number(prefix) : -1;
        if (bits < 0 || bits > (family === 4 ? 32 : 128)) return bad("bad_subnet");
        list.addSubnet(address, bits, family === 4 ? "ipv4" : "ipv6");
    }
    return ok(list);
}

/**
 * 读入口这一层的配置与每个模块的配置。`NB_SITE_TELEMETRY_URL` 只在某个模块声明了 `ingest` 入口时才要求，
 * 两个地址的主机名不同也只在那时核对：只装账号模块的进程用不上写入口。
 */
export function parseSiteConfig(env: Env, modules: readonly SiteModule[]): SiteConfigResult {
    const problems: ConfigProblem[] = [];
    const field = <T>(name: string, parse: (value: string) => Parsed<T>, fallback?: T): T | undefined => {
        const value = present(env[name]);
        if (value === undefined) {
            if (fallback === undefined) problems.push({name, problem: "missing"});
            return fallback;
        }
        const parsed = parse(value);
        if (parsed.ok) return parsed.value;
        problems.push({name, problem: parsed.problem});
        return undefined;
    };

    const siteUrl = field("NB_SITE_URL", parseRootUrl);
    const needsIngest = modules.some((module) => module.surfaces.includes("ingest"));
    const telemetryUrl = needsIngest ? field("NB_SITE_TELEMETRY_URL", parseRootUrl) : undefined;
    if (siteUrl !== undefined && telemetryUrl !== undefined && hostnameKey(siteUrl.hostname) === hostnameKey(telemetryUrl.hostname)) {
        problems.push({name: "NB_SITE_TELEMETRY_URL", problem: "same_host"});
    }
    const dataDir = field("NB_SITE_DATA_DIR", parseDataDir);
    const host = field("NB_SITE_HOST", (value) => (isIP(value) === 0 ? bad("not_ip") : ok(value)), "127.0.0.1");
    const port = field("NB_SITE_PORT", (value) => parseInteger(value, 0, 65_535), 8080);
    const trustedProxies = field("NB_SITE_TRUSTED_PROXIES", parseSubnets, new BlockList());
    const backupKeep = field("NB_SITE_BACKUP_KEEP", (value) => parseInteger(value, 1, Number.MAX_SAFE_INTEGER), 7);
    // 上界是计时器能表示的最大延时：更大的值会被 `setTimeout` 改成 1 毫秒，“多等一会儿”变成“一点也不等”。
    const shutdownTimeoutMs = field("NB_SITE_SHUTDOWN_TIMEOUT_MS", (value) => parseInteger(value, 1, MAX_TIMER_DELAY_MS), 10_000);
    // 缺省是“没设”而不是某个值，所以不经 `field` 的缺省值；空串同样算没设。
    const rawToken = present(env.NB_SITE_TEST_CONTROL);
    const tokenProblem = rawToken === undefined ? undefined : testControlProblem(rawToken);
    if (tokenProblem !== undefined) problems.push({name: "NB_SITE_TEST_CONTROL", problem: tokenProblem});
    // 测试控制入口能改服务看到的时间，只许在本机回环上提供（`site.operations` 的边界一节）；问题记在监听地址上。
    if (rawToken !== undefined && host !== undefined && !isLoopback(host)) problems.push({name: "NB_SITE_HOST", problem: "not_loopback"});
    // 可选、没有缺省值：没设（含空串）时不发网页，未知地址照旧 404。
    const rawWebDir = present(env.NB_SITE_WEB_DIR);
    const webDir = rawWebDir === undefined ? undefined : parseWebDir(rawWebDir);
    if (webDir?.ok === false) problems.push({name: "NB_SITE_WEB_DIR", problem: webDir.problem});

    const moduleConfigs = new Map<string, unknown>();
    for (const module of modules) {
        const result = module.parseConfig(env);
        if (result.ok) moduleConfigs.set(module.name, result.config);
        else problems.push(...result.problems);
    }

    if (problems.length > 0) return {ok: false, problems};
    return {
        ok: true,
        config: {
            base: {
                site: {siteUrl: siteUrl!.origin, telemetryUrl: telemetryUrl?.origin ?? null},
                telemetryHost: telemetryUrl === undefined ? null : hostnameKey(telemetryUrl.hostname),
                dataDir: dataDir!,
                host: host!,
                port: port!,
                trustedProxies: trustedProxies!,
                backupKeep: backupKeep!,
                shutdownTimeoutMs: shutdownTimeoutMs!,
                testControlToken: rawToken ?? null,
                webDir: webDir?.ok === true ? webDir.value : null,
            },
            modules: moduleConfigs,
        },
    };
}

/** `config_invalid` 的那一行：说明里只列变量名。 */
export function configFailure(problems: readonly ConfigProblem[]): CommandFailure {
    return {
        code: "config_invalid",
        message: `invalid configuration: ${problems.map((problem) => `${problem.name} (${problem.problem})`).join(", ")}`,
        fields: {problems},
    };
}
