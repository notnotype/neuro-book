/**
 * 发起社交流程：`POST social/:provider/start`（`site.accounts` 输出 11、13、15；计划 3.10 的 `start.ts`）。
 *
 * 先后：来源头与请求体上限由子应用的中间件先查 → 上游（不是两个上游之一 `not_found`，没开放 `provider_disabled`）→ 请求体（先按
 * `intent` 选出那一支的 schema，再按它判：联合类型整个判时，`fields` 会混进别的意图的键）→ 按意图的检查 → 调库拿上游地址与 state
 * Cookie → 写流程行（`flow.ts`）→ 回 `{url}`，转发库的 state Cookie。
 *
 * 按意图：
 * - `login`：带了 `continue` 的解它，合格的继续地址存进流程（输出 11、23），不合格照常发起。
 * - `register`：第 9 片做（注册的校验与 `requestSignUp`）。
 * - `link`：要会话并过同意门槛；有密码的账号要带对的当前密码，经哈希限额校验，限流与改密码共用按账号的计数（计划 3.10：“限流照
 *   改密码”）。流程行记下发起的会话：回调与关联钩子按它复核（`flow.ts` 的 `liveFlowSessionUser`）。
 *
 * 库的 state 只认浏览器（state Cookie）与库自己的 `verification` 行（升级清单“社交”几行）；本站的意图、继续地址、发起的会话都在
 * 流程行里，按库给的 state 对上。
 */

import type {Context, Hono} from "hono";
import {Type} from "typebox";
import {Value} from "typebox/value";

import {SOCIAL_PROVIDERS, SocialStartRequest, type SocialProvider, type SocialStartResponse} from "@notnotype/nb-site-identity-contract";

import type {IdentityAuth} from "../auth";
import {readCredential} from "../change-password";
import type {IdentityConnection} from "../db/connection";
import {IdentityFailure, invalidFields, readBody} from "../errors";
import {HashOverloadedError, type HashLimiter} from "../hash-limiter";
import type {IdentityLog} from "../index";
import {appendCookies, requireSession, type RouteKey} from "../middleware";
import type {ContinueResolver} from "../oauth/continue";
import type {PasswordFunctions} from "../password";
import type {IdentityRateLimits} from "../rate-limit";
import type {Sessions} from "../session";
import {createFlow, SOCIAL_LIBRARY_TARGETS, type FlowPayload} from "./flow";

/** 路由的写法（Hono 的参数写法），也是同意门槛认的路由键。 */
export const SOCIAL_START_ROUTE = "/social/:provider/start";
const ROUTE_KEY: RouteKey = `POST ${SOCIAL_START_ROUTE}`;

export interface SocialStartOptions {
    readonly auth: IdentityAuth;
    readonly conn: IdentityConnection;
    readonly sessions: Sessions;
    readonly clock: {now(): number};
    /** 开放了的上游（`social/providers.ts` 的 `openProviders`）。 */
    readonly providers: readonly SocialProvider[];
    /** 站点地址的 origin：交给库的三个回调地址（`SOCIAL_LIBRARY_TARGETS`）拼在它上面。 */
    readonly siteOrigin: string;
    readonly hashLimiter: HashLimiter;
    readonly rateLimits: IdentityRateLimits;
    readonly passwords: PasswordFunctions;
    readonly resolveContinue: ContinueResolver;
    readonly log: Pick<IdentityLog, "warn">;
}

type Branch = (typeof SocialStartRequest.anyOf)[number];

/** 请求体先只要求是对象；意图对上了再按那一支判。 */
const AnyObject = Type.Record(Type.String(), Type.Unknown());

function readIntentBranch(body: Record<string, unknown>): SocialStartRequest {
    const branch: Branch | undefined = SocialStartRequest.anyOf.find((candidate) => candidate.properties.intent.const === body.intent);
    if (branch === undefined) throw new IdentityFailure("validation_failed", ["intent"]);
    if (!Value.Check(branch, body)) throw new IdentityFailure("validation_failed", invalidFields(branch, body));
    return body as SocialStartRequest;
}

function isProvider(value: string): value is SocialProvider {
    return (SOCIAL_PROVIDERS as readonly string[]).includes(value);
}

/** 库给的上游地址里的 state（库 1.7.27 写在授权地址的查询串里）。没有时是程序错误：回调认不出这次流程。 */
function stateOf(url: string): string {
    const state = new URL(url).searchParams.get("state");
    if (state === null || state === "") throw new Error("the library's authorization url carries no state");
    return state;
}

export function registerSocialStartRoute(app: Hono, options: SocialStartOptions): void {
    const {auth, conn, sessions, clock, hashLimiter, rateLimits, passwords, log} = options;
    const open = new Set<SocialProvider>(options.providers);
    const targets = {
        callbackURL: `${options.siteOrigin}${SOCIAL_LIBRARY_TARGETS.ok}`,
        errorCallbackURL: `${options.siteOrigin}${SOCIAL_LIBRARY_TARGETS.error}`,
    };

    const limited = async <T>(work: () => Promise<T>): Promise<T> => {
        try {
            return await hashLimiter.run(work);
        } catch (error) {
            if (error instanceof HashOverloadedError) throw new IdentityFailure("overloaded");
            throw error;
        }
    };

    /** 关联的检查（文件头）；通过时回发起的会话 id 与要转发的 Cookie 头。 */
    const checkLink = async (c: Context, body: Extract<SocialStartRequest, {intent: "link"}>): Promise<{readonly sessionId: number; readonly cookie: string}> => {
        const session = await requireSession(c, sessions, ROUTE_KEY);
        const credential = await conn.read((tx) => readCredential(tx, session.userId));
        if (credential.password !== null && body.currentPassword === undefined) throw new IdentityFailure("validation_failed", ["currentPassword"]);
        const decision = rateLimits.changePassword(session.userId);
        if (!decision.ok) throw new IdentityFailure("rate_limited", [], decision.retryAfterSeconds);
        const stored = credential.password;
        if (stored !== null) {
            const current = body.currentPassword!;
            if (!(await limited(() => passwords.verify(current, stored, {accountId: session.userId, log})))) throw new IdentityFailure("invalid_credentials");
        }
        // 库的 `linkSocialAccount` 从 Cookie 认会话、把它的令牌加密进 state，回调时库自己也复核一次（按系统时间）。
        return {sessionId: session.sessionId, cookie: c.req.header("Cookie") ?? ""};
    };

    app.post(SOCIAL_START_ROUTE, async (c) => {
        const name = c.req.param("provider");
        if (!isProvider(name)) throw new IdentityFailure("not_found");
        if (!open.has(name)) throw new IdentityFailure("provider_disabled");
        const provider = name;
        const body = readIntentBranch(await readBody(c, AnyObject));

        let started: {readonly url: string; readonly cookies: readonly string[]};
        let payload: FlowPayload = {};
        let sessionId: number | null = null;
        switch (body.intent) {
            case "login": {
                const continueUrl = body.continue === undefined ? null : await options.resolveContinue(body.continue, "login");
                if (continueUrl !== null) payload = {continueUrl};
                const {headers, response} = await auth.api.signInSocial({body: {provider, ...targets, disableRedirect: true}, headers: new Headers(), returnHeaders: true});
                if (response.url === undefined) throw new Error("the library gave no authorization url for a social sign-in");
                started = {url: response.url, cookies: headers.getSetCookie()};
                break;
            }
            case "register":
                // 注册意图的校验、`requestSignUp` 与回调里的注册钩子都在第 9 片接上；在那之前它是没接上的入口，不是请求方的错。
                throw new Error("social registration is not wired yet");
            case "link": {
                const link = await checkLink(c, body);
                sessionId = link.sessionId;
                const {headers, response} = await auth.api.linkSocialAccount({body: {provider, ...targets, disableRedirect: true}, headers: new Headers({cookie: link.cookie}), returnHeaders: true});
                started = {url: response.url, cookies: headers.getSetCookie()};
                break;
            }
        }

        const state = stateOf(started.url);
        await conn.write((tx) => createFlow(tx, {state, intent: body.intent, provider, payload, sessionId, nowMs: clock.now()}));
        appendCookies(c, started.cookies);
        const response: SocialStartResponse = {url: started.url};
        return c.json(response);
    });
}
