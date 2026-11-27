/**
 * 社交回调：`GET <LIB_BASE_PATH>/callback/:provider`（`site.accounts` 输出 12、15、23，时序一节社交那几句；计划 3.10 的 `callback.ts`）。
 * 挂载层只把开放了的上游交到这里（`oauth/mount.ts`）。浏览器总被带回站点的落点页（输出 23），不论成败，库的跳转不原样发出。
 *
 * 先后：
 * 0. 查询串超过 `MAX_CALLBACK_QUERY_CHARS` 个字符 → `social_state_invalid`，不认领、不交库（计划 3.6、设计审查第 14 条：这个
 *    地址不要会话，谁都能发，库会把整个查询串读进来）。落点仍按这个 state 原来的意图选。
 * 1. 认领流程（`flow.ts` 的 `claimFlow`）：认领不到（没有、过期、用过、上游对不上）→ `social_state_invalid`，不交库。认领在交库之前：
 *    同一次流程的回调并发到达时只有一个往下走，浏览器不对的那个也用掉了这次流程（时序一节“只能用一次”）。
 * 2. 关联意图另复核发起的会话（模块时钟）；不成立 → `social_state_invalid`，不交库。关联钩子写入之前还会再判一次（`hooks.ts`）。
 * 3. 在帧里交库（`auth.handler`）。库核对 state Cookie 认浏览器（不对时 `state_mismatch`），再换码、取上游的用户信息、登录或关联。
 * 4. 按库的回答定结论，换成落点（`succeed`）。登录成功另记最近登录时间。注册成功（库跳到 `newUser`）不记：与密码注册一样，
 *    注册不算一次登录。
 *
 * 回调地址带 `error` 的（上游报的，例如用户在上游点了取消）：库核对完 state 之后把它原样转进失败地址（升级清单“社交”的“地址里
 * 的 `error` 原样转出”）。所以库转出的码与地址里的相同时，结论只看地址：`access_denied` 是 `social_cancelled`，别的一律
 * `social_failed`，不按库码去译（omp 设计审查第 9b 条：地址参数谁都能写）。不同时是库在转出之前自己判出的（state 不对、浏览器
 * 不对），照常交 `mapSocialError`。仍然交库，而不是看到 `error` 就直接回：浏览器不对的回调由库认出，落到 `social_state_invalid`
 * （时序一节），库也借这一次删掉它的 state 行、清掉 state Cookie。
 */

import type {Context} from "hono";

import {SOCIAL_ERROR_CODES, SOCIAL_ERROR_PARAM, type SocialErrorCode, type SocialIntent, type SocialProvider} from "@notnotype/nb-site-identity-contract";

import {LIB_BASE_PATH, type IdentityAuth} from "../auth";
import {isBannedSessionInsert, type IdentityConnection} from "../db/connection";
import {libDate} from "../db/library-rows";
import {failureFor} from "../errors";
import type {IdentityLog} from "../index";
import {claimFlow, intentOfState, liveFlowSessionUser, runInFrame, SOCIAL_LIBRARY_TARGETS, type ClaimedFlow, type SocialFrame} from "./flow";

export interface SocialCallbackOptions {
    readonly auth: IdentityAuth;
    readonly conn: IdentityConnection;
    readonly clock: {now(): number};
    /** 站点地址的 origin：认库跳去的三个回调地址。 */
    readonly siteOrigin: string;
    readonly log: Pick<IdentityLog, "warn" | "error">;
}

export type SocialCallback = (c: Context, provider: SocialProvider) => Promise<Response>;

/** 回调查询串（不含 `?`）的字符数上限。上游的回调只带 `code`、`state` 等几个短参数，远在这之内。 */
export const MAX_CALLBACK_QUERY_CHARS = 8192;

/** 各意图的落点页（输出 23）。 */
const LANDING: Readonly<Record<SocialIntent, {readonly ok: string; readonly failed: string}>> = {
    login: {ok: "/", failed: "/login"},
    register: {ok: "/", failed: "/register"},
    link: {ok: "/account", failed: "/account"},
};

/** 库判 state 时给的码（库 1.7.27 的 `parseState`、回调端点）：都是“这次流程认不出”。 */
const STATE_CODES: ReadonlySet<string> = new Set(["state_mismatch", "state_not_found", "state_invalid", "state_security_mismatch", "invalid_callback_request"]);

/**
 * 库的码按意图换成本站的码（升级清单“社交”的“错误码表”一行）。登录路径上的 `signup_disabled`、`account_not_linked` 是库把内部
 * 文字的空格换成下划线得来的（`callback.mjs` 的 `result.error.split(" ").join("_")`，计划问 8），库改了那句文字码就变：升级清单
 * 里那一行守着。别的是库的错误码常量（`OAUTH_CALLBACK_ERROR_CODES`）。
 */
const INTENT_CODES: Readonly<Record<SocialIntent, Readonly<Record<string, SocialErrorCode>>>> = {
    login: {signup_disabled: "social_not_registered", account_not_linked: "social_not_registered", BANNED_USER: "account_banned"},
    register: {account_not_linked: "email_taken", email_not_found: "social_email_missing"},
    link: {account_already_linked_to_different_user: "identity_taken", unable_to_link_account: "social_state_invalid"},
};

const OWN_CODES: ReadonlySet<string> = new Set(SOCIAL_ERROR_CODES);

/**
 * 库的码换成落点上的码（计划 3.10）。帧里钩子记下的自家码优先：库会把钩子抛的错误换成自己的码或吞掉（问 4.1）。码与自家码同名的
 * 一律 `social_failed`：这样的码只可能来自地址参数，谁都能写（输出 23 末句）。认不出的码（含上游取不到用户信息、换码失败、已关联
 * 的身份这次没给邮箱的 `email_not_found`，输出 12）都是 `social_failed`。
 */
export function mapSocialError(intent: SocialIntent, libraryCode: string, ownFailure: SocialErrorCode | undefined): SocialErrorCode {
    if (ownFailure !== undefined) return ownFailure;
    if (OWN_CODES.has(libraryCode)) return "social_failed";
    if (STATE_CODES.has(libraryCode)) return "social_state_invalid";
    if (libraryCode === "access_denied") return "social_cancelled";
    return INTENT_CODES[intent][libraryCode] ?? "social_failed";
}

/** 库对一次回调的回答归成的三种。 */
type LibraryOutcome =
    | {readonly kind: "success"; readonly target: "ok" | "newUser"}
    | {readonly kind: "failure"; readonly code: string}
    | {readonly kind: "unexpected"};

/**
 * 读库的回答（问 8 实测的几种形状）：跳到两个成功地址之一；跳到失败地址或库的缺省错误页（state 认不出时库不知道失败地址），码在
 * `error` 参数里；不跳转、回 JSON 错误体（关联路径上钩子抛的 `APIError`，库不经 `redirectOnError`），码在 `code` 里。
 */
async function readOutcome(response: Response, siteOrigin: string): Promise<LibraryOutcome> {
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location !== null) {
        const target = new URL(location, siteOrigin);
        if (target.origin !== siteOrigin) return {kind: "unexpected"};
        if (target.pathname === SOCIAL_LIBRARY_TARGETS.ok) return {kind: "success", target: "ok"};
        if (target.pathname === SOCIAL_LIBRARY_TARGETS.newUser) return {kind: "success", target: "newUser"};
        if (target.pathname === SOCIAL_LIBRARY_TARGETS.error || target.pathname === `${LIB_BASE_PATH}/error`) return {kind: "failure", code: target.searchParams.get("error") ?? ""};
        return {kind: "unexpected"};
    }
    if (response.status >= 400 && response.headers.get("content-type")?.startsWith("application/json") === true) {
        const body: unknown = await response.json();
        const code = typeof body === "object" && body !== null ? (body as {readonly code?: unknown}).code : undefined;
        if (typeof code === "string") return {kind: "failure", code};
    }
    return {kind: "unexpected"};
}

/** 一个 `Set-Cookie` 的名字。 */
function cookieName(setCookie: string): string {
    return setCookie.slice(0, setCookie.indexOf("=")).trim();
}

export function createSocialCallback(options: SocialCallbackOptions): SocialCallback {
    const {auth, conn, clock, siteOrigin, log} = options;

    const land = (location: string, cookies: readonly string[]): Response => {
        const headers = new Headers({Location: location, "Cache-Control": "no-store"});
        for (const cookie of cookies) headers.append("Set-Cookie", cookie);
        return new Response(null, {status: 302, headers});
    };
    const failed = (intent: SocialIntent, code: SocialErrorCode, cookies: readonly string[] = []): Response =>
        land(`${LANDING[intent].failed}?${new URLSearchParams({[SOCIAL_ERROR_PARAM]: code})}`, cookies);

    /**
     * 成功时落点与要做的事。登录意图记最近登录时间（与密码登录写的是同一列，`login.ts`）：库建会话时帧里记下了账号。注册意图只该
     * 落到 `newUser`：库登录了已关联的旧账号时建会话前就被拒了（`hooks.ts` 的 `admitSocialSession`），落到 `ok` 是程序错误。
     */
    const succeed = async (flow: ClaimedFlow, frame: SocialFrame, target: "ok" | "newUser"): Promise<string> => {
        if (flow.intent === "link") {
            if (target !== "ok") throw new Error("a social link ended at the new-user target");
            return LANDING.link.ok;
        }
        if (flow.intent === "register") {
            if (target !== "newUser" || frame.registeredUserId === undefined) throw new Error("a social registration succeeded without the library creating an account");
            return flow.payload.continueUrl ?? LANDING.register.ok;
        }
        if (target !== "ok") throw new Error("a social sign-in ended at the new-user target");
        const userId = frame.sessionUserId;
        if (userId === undefined) throw new Error("a social sign-in succeeded without the library creating a session");
        await conn.write((tx) =>
            tx
                .query(`INSERT INTO identity_profile (user_id, last_login_at) VALUES (?, ?) ON CONFLICT (user_id) DO UPDATE SET last_login_at = excluded.last_login_at`)
                .run(userId, libDate(clock.now())),
        );
        return flow.payload.continueUrl ?? LANDING[flow.intent].ok;
    };

    return async (c, provider) => {
        const url = new URL(c.req.raw.url);
        const state = url.searchParams.get("state") ?? "";
        // `search` 带开头的 `?`，没有查询串时是空串（与授权端点同一种数法，`oauth/mount.ts`）。
        if (Math.max(0, url.search.length - 1) > MAX_CALLBACK_QUERY_CHARS) {
            return failed((await conn.read((tx) => intentOfState(tx, state))) ?? "login", "social_state_invalid");
        }
        const nowMs = clock.now();
        const claimed = await conn.write((tx): {readonly flow: ClaimedFlow | null; readonly intent: SocialIntent} => {
            const flow = claimFlow(tx, state, provider, nowMs);
            if (flow === null) return {flow: null, intent: intentOfState(tx, state) ?? "login"};
            if (flow.intent === "link" && (flow.sessionId === null || liveFlowSessionUser(tx, flow.sessionId, nowMs) === null)) return {flow: null, intent: flow.intent};
            return {flow, intent: flow.intent};
        });
        const flow = claimed.flow;
        if (flow === null) return failed(claimed.intent, "social_state_invalid");

        const frame: SocialFrame = {flow};
        let response: Response;
        try {
            response = await runInFrame(frame, () => auth.handler(c.req.raw));
        } catch (error) {
            // 库查过封禁、插会话之前账号被封了：插入撞上触发器（`0004_session_ban_guard.sql`，omp 实现审查第 1 条），库原样抛出
            // `SQLiteError`。帧里已记下要建会话的账号，说明出错的正是插会话那一步：建会话前的钩子之后库在这次回调里不再写库，
            // 别的表上的触发器碰不到这里。
            if (frame.sessionUserId !== undefined && isBannedSessionInsert(error)) return failed(flow.intent, "account_banned");
            // 库抛出的非 `APIError`（`onAPIError.throw`，例如库不可写）：按出错出口的归类记一行，浏览器仍回落点页。
            failureFor(error, log);
            return failed(flow.intent, "social_failed");
        }
        const {sessionToken} = (await auth.$context).authCookies;
        const cookies = response.headers.getSetCookie();
        // 失败时不转发会话 Cookie：库只在成功跳转之前发它，这里是兜底，别的 Cookie（清掉 state Cookie 的那条）照转。
        const withoutSession = cookies.filter((cookie) => cookieName(cookie) !== sessionToken.name);

        const outcome = await readOutcome(response, siteOrigin);
        if (outcome.kind === "unexpected") {
            log.warn("identity.social_unexpected", "the library answered a social callback in an unexpected way", {status: response.status, hasLocation: response.headers.has("location")});
            return failed(flow.intent, "social_failed", withoutSession);
        }
        if (outcome.kind === "failure") {
            const reported = url.searchParams.get("error");
            if (reported !== null && reported !== "" && outcome.code === reported) return failed(flow.intent, reported === "access_denied" ? "social_cancelled" : "social_failed", withoutSession);
            return failed(flow.intent, mapSocialError(flow.intent, outcome.code, frame.ownFailure), withoutSession);
        }
        try {
            return land(await succeed(flow, frame, outcome.target), cookies);
        } catch (error) {
            failureFor(error, log);
            return failed(flow.intent, "social_failed", withoutSession);
        }
    };
}
