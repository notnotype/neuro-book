/**
 * 账号接口的请求底座（w00037 t07 计划 3.16）：补齐站点地址的 `Host`、`Origin`、`Content-Type` 与每个用例自己的 `X-Forwarded-For`，
 * 再加一个存与回送 `Set-Cookie` 的 Cookie 罐。只经 HTTP 与命令行说话，不碰库：造登录态用 `create-admin` 命令建账号。
 *
 * 来源地址：账号的进程起时设 `NB_SITE_TRUSTED_PROXIES=127.0.0.1/32`（`IDENTITY_SITE_ENV`），每个用例给自己的一个文档地址
 * （`203.0.113.<n>`）：限流按来源计（`site.accounts` 输出 19），同一个进程上的用例互不吃额度。
 */

import {IDENTITY_API_PREFIX, IDENTITY_PATHS} from "@notnotype/nb-site-identity-contract";

import {requestJson, SANDBOX_SITE_URL, type JsonResponse, type SiteSandbox} from "./site";

/** 站点地址的 origin 与主机名：改状态的请求要带等于它的 `Origin`（`site.accounts` 输入一节），按主机名分派到站点入口。 */
export const SITE_ORIGIN = new URL(SANDBOX_SITE_URL).origin;
const SITE_HOST = new URL(SANDBOX_SITE_URL).host;

/** 起账号进程时盖在底座环境上的变量：信任回环上的代理，来源地址取 `X-Forwarded-For`。 */
export const IDENTITY_SITE_ENV = {NB_SITE_TRUSTED_PROXIES: "127.0.0.1/32"} as const;

/** 一个 `Set-Cookie` 拆成名字、值与属性；属性名小写，没有值的属性（`HttpOnly`）值为空串。 */
export interface StoredCookie {
    readonly name: string;
    readonly value: string;
    readonly attributes: ReadonlyMap<string, string>;
}

function parseSetCookie(setCookie: string): StoredCookie {
    const [pair = "", ...parts] = setCookie.split(";");
    const at = pair.indexOf("=");
    const attributes = new Map(
        parts.map((part) => {
            const trimmed = part.trim();
            const eq = trimmed.indexOf("=");
            return eq < 0 ? ([trimmed.toLowerCase(), ""] as const) : ([trimmed.slice(0, eq).toLowerCase(), trimmed.slice(eq + 1)] as const);
        }),
    );
    return {name: pair.slice(0, at).trim(), value: pair.slice(at + 1).trim(), attributes};
}

/** 存 `Set-Cookie`，按名字覆盖；`Max-Age=0` 的那一条把同名的删掉（浏览器的做法）。 */
export interface CookieJar {
    /** 记下一个响应的全部 `Set-Cookie`。 */
    store(response: {readonly headers: Headers}): void;
    /** 回送用的 `Cookie` 请求头；罐里空时为 undefined。 */
    header(): string | undefined;
    /** 最近一次存下的某个名字的 Cookie（含删除它的那一条），给断言属性用。 */
    last(name: string): StoredCookie | undefined;
    /** 现在还在罐里的名字。 */
    names(): string[];
}

export function cookieJar(): CookieJar {
    const live = new Map<string, StoredCookie>();
    const seen = new Map<string, StoredCookie>();
    return {
        store: (response) => {
            for (const setCookie of response.headers.getSetCookie()) {
                const cookie = parseSetCookie(setCookie);
                seen.set(cookie.name, cookie);
                if (cookie.attributes.get("max-age") === "0") live.delete(cookie.name);
                else live.set(cookie.name, cookie);
            }
        },
        header: () => (live.size === 0 ? undefined : [...live.values()].map((cookie) => `${cookie.name}=${cookie.value}`).join("; ")),
        last: (name) => seen.get(name),
        names: () => [...live.keys()],
    };
}

export interface IdentityRequestInit {
    readonly method?: string;
    /** 请求体：对象按 JSON 发；字符串、字节（`Uint8Array`）与流原样发。缺省不带请求体。 */
    readonly body?: unknown;
    /** 盖在缺省头上；值为 null 的去掉（例如去掉 `Origin`）。 */
    readonly headers?: Readonly<Record<string, string | null>>;
    /** 这个用例的来源地址，写进 `X-Forwarded-For`。 */
    readonly from: string;
    /** 给了时回送它的 Cookie，并把响应的 `Set-Cookie` 存进去。 */
    readonly jar?: CookieJar;
}

/**
 * 请求一个账号接口（`path` 相对 `IDENTITY_API_PREFIX`，以 `/` 开头）并按 JSON 读响应。缺省带站点的 `Host` 与 `Origin`、
 * `X-Forwarded-For`；有请求体时另带 `Content-Type: application/json`。
 */
export async function identityRequest(url: string, path: string, init: IdentityRequestInit): Promise<JsonResponse> {
    const headers = new Headers({Host: SITE_HOST, Origin: SITE_ORIGIN, "X-Forwarded-For": init.from});
    if (init.body !== undefined) headers.set("Content-Type", "application/json");
    const cookie = init.jar?.header();
    if (cookie !== undefined) headers.set("Cookie", cookie);
    for (const [name, value] of Object.entries(init.headers ?? {})) {
        if (value === null) headers.delete(name);
        else headers.set(name, value);
    }
    const body =
        init.body === undefined ? undefined : typeof init.body === "string" || init.body instanceof Uint8Array || init.body instanceof ReadableStream ? init.body : JSON.stringify(init.body);
    const response = await requestJson(new URL(`${IDENTITY_API_PREFIX.slice(1)}${path}`, url).href, {method: init.method ?? "GET", headers, ...(body === undefined ? {} : {body})});
    init.jar?.store(response);
    return response;
}

/** 登录（`POST login`）；给了 `jar` 时存下会话 Cookie，给了 `continue` 时带上续接令牌（`site.accounts` 输出 4）。 */
export function login(
    url: string,
    identifier: string,
    password: string,
    init: {readonly from: string; readonly jar?: CookieJar; readonly headers?: Readonly<Record<string, string | null>>; readonly continue?: string},
): Promise<JsonResponse> {
    const {continue: continueToken, ...rest} = init;
    return identityRequest(url, IDENTITY_PATHS.login, {method: "POST", body: {identifier, password, ...(continueToken === undefined ? {} : {continue: continueToken})}, ...rest});
}

/** 失败时带上的标准输出行数：够看到 `process.fatal` 与它前面几行，不把迁移的整段日志都塞进报错。 */
const STDOUT_TAIL_LINES = 10;

/**
 * 用 `create-admin` 建（或重置）一个管理员，返回账号 id（标准输出那一行 `identity.admin_upserted` 的 `userId`）；非零退出时抛错，
 * 错误里带标准错误与标准输出的末尾：码是 `internal` 时原因只在标准输出的 `process.fatal` 那一行（`site.operations` 失败表）。
 * 给 `beforeAll` 造登录态用：合同里能造出账号的只有这个命令（注册在后面的片）。
 */
export async function createAdmin(sandbox: Pick<SiteSandbox, "run">, dataDir: string, args: readonly string[], password: string): Promise<number> {
    const result = await sandbox.run("create-admin", {dataDir, args, stdin: `${password}\n`});
    const userId = result.logs.find((line) => line.event === "identity.admin_upserted")?.userId;
    if (result.exitCode !== 0 || typeof userId !== "number") {
        const stdoutTail = result.stdout.split("\n").filter((line) => line !== "").slice(-STDOUT_TAIL_LINES);
        throw new Error(`create-admin ${args.join(" ")} exited ${String(result.exitCode)}\nstderr:\n${result.stderr}\nstdout (last ${String(STDOUT_TAIL_LINES)} lines):\n${stdoutTail.join("\n")}`);
    }
    return userId;
}
