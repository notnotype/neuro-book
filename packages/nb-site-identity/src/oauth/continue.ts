/**
 * 续接令牌与确认标识（w00037 t08 计划 3.7、3.9；`site.oauth-provider` 输出 4、14 与时序一节）。
 *
 * 两样都是库跳转地址上那段签名参数（库的 `signParams`）整段做 base64url：库带人去登录页、站点同意页、确认页时给的查询串，原样包
 * 起来交给浏览器，回来时解开、验签，就是当时那次授权请求。签名用库上下文的 `secret`，验签用库导出的 `verifyOAuthQueryParams`，
 * 它同时按系统时间判库写的 `exp`。模块另按自己的时钟判 10 分钟（`ba_iat` 起算）：合同测试拨的是模块的时钟，库的 `exp` 拨不动。
 *
 * 签名参数里库自己加的五个字段（升级清单“续接的签名参数”一行）：`sig`；`exp`（秒，系统时间）；`ba_iat`（毫秒，系统时间）；`ba_pl`
 * （配了 `postLogin` 时确认页带的发起会话 id）；`ba_param`（被签名的参数名，每个名一项，含它自己）。续接回授权端点时五个都去掉，
 * 回到的就是客户端发来的那组参数，库重新签名。
 */

import {verifyOAuthQueryParams} from "@better-auth/oauth-provider";

import {OAUTH_ENDPOINT_PATHS} from "@notnotype/nb-site-identity-contract";

/** 续接令牌与确认标识的有效期，从库签名的时刻（`ba_iat`）起算（时序一节）。 */
export const CONTINUE_LIFETIME_MS = 600_000;

/**
 * 令牌长度的上限（字符）。授权端点收的查询串至多 4096 个字符、只把认得的十来个参数交库（`authorize-request.ts`），库签名时再加
 * 签名字段，做 base64url 后至多六千个字符上下：第 6 片实测，交库的参数全带上、`state` 填满到 4096 个字符时最长 5942（`state`
 * 用重新编码后变长的字符也一样，入口按重新编码后的长度判）。上限留出余量，入口的上限改大时要跟着算（计划 omp 设计审查第 5 条）。
 * 超过的不解：解码与验签的开销随长度长。
 */
export const MAX_CONTINUE_TOKEN_LENGTH = 8192;

/** 库加的五个签名字段（文件头）。 */
const SIGNED_FIELDS = ["sig", "exp", "ba_iat", "ba_pl", "ba_param"] as const;

const ISSUED_AT_FIELD = "ba_iat";

const BASE64URL = /^[A-Za-z0-9_-]*$/u;

/** 谁来用这个令牌：登录（含注册）刚建立了会话；补交同意没有重新登录。 */
export type ContinueConsumer = "login" | "consent";

/** 库跳转地址（`/login?<签名参数>` 之类）里 `?` 之后的整段，做 base64url；没有查询串时为 null。 */
export function continueTokenFromLibraryRedirect(location: string): string | null {
    const mark = location.indexOf("?");
    if (mark < 0 || mark === location.length - 1) return null;
    return Buffer.from(location.slice(mark + 1), "utf8").toString("base64url");
}

/** 验过的令牌：库签名的原始查询串（交回库的确认端点时要原样给，重新编码会对不上签名），与读成的参数（含五个签名字段）。 */
export interface SignedQuery {
    readonly signed: string;
    readonly params: URLSearchParams;
}

/**
 * 解开并核对一个令牌；不合格时为 null：超长、不是 base64url、解出来不是 UTF-8、库验签不过（被改过，或过了库按系统时间写的
 * `exp`）、`ba_iat` 不是恰好一个整数、按模块的时钟已过 10 分钟。
 */
export async function verifySignedQuery(token: string, nowMs: number, secret: string): Promise<SignedQuery | null> {
    if (token.length > MAX_CONTINUE_TOKEN_LENGTH || !BASE64URL.test(token)) return null;
    let signed: string;
    try {
        signed = new TextDecoder("utf-8", {fatal: true}).decode(Buffer.from(token, "base64url"));
    } catch {
        // 解不成 UTF-8 的字节只可能是被改过的令牌，按不合格处理；不记日志：令牌来自浏览器，不是本模块的错。
        return null;
    }
    if (!(await verifyOAuthQueryParams(signed, secret))) return null;
    const params = new URLSearchParams(signed);
    const issuedAt = params.getAll(ISSUED_AT_FIELD);
    if (issuedAt.length !== 1) return null;
    const issuedAtMs = Number(issuedAt[0]);
    if (!Number.isSafeInteger(issuedAtMs) || nowMs - issuedAtMs > CONTINUE_LIFETIME_MS) return null;
    return {signed, params};
}

/** 去掉五个签名字段，回客户端发来的那组参数。 */
export function withoutSignedFields(params: URLSearchParams): URLSearchParams {
    const rest = new URLSearchParams(params);
    for (const field of SIGNED_FIELDS) rest.delete(field);
    return rest;
}

/**
 * 令牌合格时回站内的继续地址（授权端点加参数），不合格时为 null（`verifySignedQuery`）。`consumer` 是 `login` 时另去掉 `prompt` 里的
 * `login` 与 `max_age`：这次登录刚满足了它们，不去掉库会再带人去登录页，一直打转（输出 4）。补交同意不是重新登录，两样都留着
 * （输出 12）。
 */
export async function resolveContinue(token: string, nowMs: number, consumer: ContinueConsumer, secret: string): Promise<string | null> {
    const verified = await verifySignedQuery(token, nowMs, secret);
    if (verified === null) return null;
    const rest = withoutSignedFields(verified.params);
    if (consumer === "login") {
        const prompts = (rest.get("prompt") ?? "").split(" ").filter((value) => value !== "" && value !== "login");
        if (prompts.length > 0) rest.set("prompt", prompts.join(" "));
        else rest.delete("prompt");
        rest.delete("max_age");
    }
    return `${OAUTH_ENDPOINT_PATHS.authorize}?${rest}`;
}

/** 登录、注册、补交同意解续接令牌用的函数：模块按自己的时钟与库的 `secret` 绑好（`module.ts`）。 */
export type ContinueResolver = (token: string, consumer: ContinueConsumer) => Promise<string | null>;
