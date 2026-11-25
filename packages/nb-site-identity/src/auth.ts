/**
 * Better Auth 的装配（w00037 t07 计划 3.4；ADR 0063）。账号模块自己做登录、注册与管理，库只负责发会话与 Cookie、认 Cookie、
 * 清 Cookie，以及 t08 的协议部分。库的 `auth.handler` 在本 Task 不挂到任何路径上：只经 `auth.api` 在进程内调用，库自带的端点
 * 从外部都到不了（`site.accounts` 边界与兼容一节）。
 *
 * 这里依赖库 1.7.27 的几处内部行为，每处都对着包说明 `AGENTS.md` 的“升级清单”里一条用例；升级库时先跑那些用例：
 * - `SERVER_ONLY` 端点经 `auth.handler` 访问是 404，只能经 `auth.api` 调用（清单“内部接口”一行）。
 * - `internalAdapter.createSession`、`findSession`，`setSessionCookie`、`deleteSessionCookie`（同上）。
 * - 建会话前的钩子改写的时间与列如实落库（清单“存法”一行）。
 * - `deferSessionRefresh` 打开时，以 GET 调 `getSession` 不写库：按系统时间到期的会话只回空、不删行（清单“库内行为”一行）。
 * - `onAPIError.throw` 打开时，经 `handler` 的非 `APIError` 从 `handler` 抛出，不被打印到标准错误（同上）。
 */

import {Type, type Static, type TSchema} from "typebox";
import {Value} from "typebox/value";

import {betterAuth, type BetterAuthOptions, type StandardSchemaV1} from "better-auth";
import {createAuthEndpoint} from "better-auth/api";
import {deleteSessionCookie, setSessionCookie} from "better-auth/cookies";
import {admin, username} from "better-auth/plugins";

import {parseUsernameInput, USERNAME} from "@notnotype/nb-site-identity-contract";

import type {LibDatabaseConfig} from "./db/connection";
import type {IdentityLog} from "./index";

/** 库的路由前缀。本 Task 不把 `auth.handler` 挂上去；t08 在这个前缀下按白名单挂标准 OAuth 端点（ADR 0060 决策 3）。 */
export const LIB_BASE_PATH = "/api/identity/auth";

const DAY_SECONDS = 86_400;

export interface IdentityAuthOptions {
    readonly database: LibDatabaseConfig;
    /** 站点地址的 origin；库的 `baseURL`。 */
    readonly siteUrl: string;
    /** `NB_SITE_SESSION_SECRET`：签 Cookie 用，不进日志。 */
    readonly secret: string;
    readonly sessionDays: number;
    readonly clock: {now(): number};
    readonly log: Pick<IdentityLog, "warn" | "error">;
}

/**
 * 端点的请求体 schema：库的端点收 Standard Schema（better-call 校验 `body` 并据此给 `auth.api` 的参数定类型），这里把 TypeBox 的
 * schema 包成它。这几个端点只有本模块在进程内调用，校验不过是程序错误。
 */
function bodySchema<S extends TSchema>(schema: S): StandardSchemaV1<Static<S>> {
    return {
        "~standard": {
            version: 1,
            vendor: "nb-site-identity",
            validate: (value) => (Value.Check(schema, value) ? {value: value as Static<S>} : {issues: [{message: "the request body does not match the endpoint's schema"}]}),
        },
    };
}

const IssueSessionBody = Type.Object({userId: Type.Integer({minimum: 1}), userAgent: Type.Union([Type.String(), Type.Null()])}, {additionalProperties: false});
const SessionCookieBody = Type.Object({token: Type.String()}, {additionalProperties: false});

/**
 * 本模块自己的小插件：三个只供服务端调用的端点（`SERVER_ONLY`，经 `handler` 是 404）。Cookie 的名字与属性只由库的
 * `setSessionCookie`、`deleteSessionCookie` 决定，模块不自己拼。调用方用 `returnHeaders: true` 取 `Set-Cookie`。
 */
function nbSession() {
    return {
        id: "nb-session",
        endpoints: {
            /**
             * 给一个已存在的账号发会话。`userAgent` 是已换成概要的写法或 null（原始的浏览器标识不落库，`site.accounts` 副作用一节）。
             * 账号被封禁时 `admin` 插件在建会话前拒绝（`APIError`，`BANNED_USER`），调用方换成 `account_banned`。
             */
            issueSession: createAuthEndpoint("/nb-session/issue", {method: "POST", body: bodySchema(IssueSessionBody), metadata: {SERVER_ONLY: true}}, async (ctx) => {
                const {userId, userAgent} = ctx.body;
                const user = await ctx.context.internalAdapter.findUserById(String(userId));
                if (user === null) throw new TypeError("issueSession: the account does not exist");
                const session = await ctx.context.internalAdapter.createSession(String(userId), false, {userAgent});
                await setSessionCookie(ctx, {session, user}, false);
                return ctx.json({sessionId: Number(session.id)});
            }),
            /**
             * 会话延长之后重发同一个令牌的 Cookie（新的 `Max-Age`，`site.accounts` 输出 5）。令牌查不到会话时（延长之后、这里之前
             * 被删了）不发，回 `{issued: false}`。
             */
            sessionCookie: createAuthEndpoint("/nb-session/cookie", {method: "POST", body: bodySchema(SessionCookieBody), metadata: {SERVER_ONLY: true}}, async (ctx) => {
                const found = await ctx.context.internalAdapter.findSession(ctx.body.token);
                if (found === null) return ctx.json({issued: false});
                await setSessionCookie(ctx, found, false);
                return ctx.json({issued: true});
            }),
            /** 清除会话 Cookie 的 `Set-Cookie`（登出、会话到期）。不碰库。 */
            clearSessionCookie: createAuthEndpoint("/nb-session/clear", {method: "POST", metadata: {SERVER_ONLY: true}}, async (ctx) => {
                deleteSessionCookie(ctx);
                return ctx.json({});
            }),
        },
    } as const;
}

/**
 * 交给 `betterAuth` 的选项。包内测试的 `createTestAuth` 也用它，库导出的表结构与产品的装配是同一份（`db/schema.test.ts`）。
 */
export function identityAuthOptions(options: IdentityAuthOptions) {
    const {clock, log} = options;
    const sessionSeconds = options.sessionDays * DAY_SECONDS;
    return {
        baseURL: options.siteUrl,
        basePath: LIB_BASE_PATH,
        secret: options.secret,
        database: options.database,
        advanced: {
            // 库插入时不带 id，由表的 AUTOINCREMENT 发号；库把 id 读成字符串，模块对外一律转成整数。
            database: {generateId: "serial"},
            // 库的 Cookie 一律用 `__Host-` 前缀，会话 Cookie 因此叫 `__Host-nbsite.session_token`（`site.accounts` 输出 5）：浏览器
            // 只收 Secure、`Path=/`、不带 `Domain` 的 `__Host-` Cookie，同一上级域名下的别的子域塞不进同名的 Cookie（`__Secure-` 挡
            // 不住，实现审查第 3 条）。库 1.7.27 的名字是“`useSecureCookies` 给的 `__Secure-`（或空串）+ 前缀 + `.` + Cookie 名”，
            // 没有给 `__Host-` 的开关，所以关掉 `useSecureCookies`、把 `__Host-` 写进前缀；Secure 改由 `defaultCookieAttributes`
            // 给，恒为 Secure、与站点地址的协议无关。库给的属性缺省就是 `Path=/`、不带 `Domain`（没开 `crossSubDomainCookies`），
            // better-call 写 `__Host-` 名字的 Cookie 时也会强制成这样。名字与属性由 `auth.test.ts` 的“发会话”用例核对。
            cookiePrefix: "__Host-nbsite",
            useSecureCookies: false,
            defaultCookieAttributes: {secure: true},
            // 会话表不存来源地址（`site.accounts` 副作用一节）。
            ipAddress: {disableIpTracking: true},
        },
        // 限流自己做（计划 3.8）。
        rateLimit: {enabled: false},
        session: {
            expiresIn: sessionSeconds,
            updateAge: DAY_SECONDS,
            // 库按系统时间判延长，合同测试拨的是模块的时钟，所以延长由模块做（`session.ts`），库的关掉。
            disableSessionRefresh: true,
            // 以 GET 调 `getSession` 时库不写库：按系统时间到期的会话库只回空、不删行（设计审查第 10 条）。到期的行只由模块删。
            deferSessionRefresh: true,
            // 会话只存数据库：封禁、登出删行之后立即无效（提案“官方站重写”4.5 一节）。
            cookieCache: {enabled: false},
        },
        // 库自带的遥测缺省关，但环境变量 BETTER_AUTH_TELEMETRY 能打开它；显式关掉。
        telemetry: {enabled: false},
        // 非 APIError 从 handler 抛出，交给模块的出错出口；缺省时 better-call 把整个错误（含堆栈与路径）打印到标准错误（计划探针 p10）。
        onAPIError: {throw: true},
        // 库的日志只取级别与 message，不带附加参数（可能是请求或错误对象，含路径与秘密）。
        logger: {
            level: "warn",
            log: (level, message) => {
                if (level === "error") log.error("identity.lib", message);
                else log.warn("identity.lib", message);
            },
        },
        databaseHooks: {
            session: {
                create: {
                    // 库建会话时取系统时间；改成模块的时钟（计划 3.14：合同测试拨的是模块的时钟）。来源地址恒为空；
                    // 浏览器标识由 issueSession 给（概要或 null），没给时库填的空串也存成 null。
                    before: async (session) => {
                        const now = clock.now();
                        return {
                            data: {
                                ...session,
                                createdAt: new Date(now),
                                updatedAt: new Date(now),
                                expiresAt: new Date(now + sessionSeconds * 1000),
                                ipAddress: null,
                                userAgent: session.userAgent === "" || session.userAgent === undefined ? null : session.userAgent,
                            },
                        };
                    },
                },
            },
        },
        plugins: [
            // 规则与 `site.accounts` 的字段规则同一份：先判 ASCII 再转小写（合同包的 `parseUsernameInput`）。
            username({
                minUsernameLength: USERNAME.minLength,
                maxUsernameLength: USERNAME.maxLength,
                usernameValidator: (value) => parseUsernameInput(value) !== undefined,
                usernameNormalization: (value) => value.toLowerCase(),
            }),
            // 给 user 表加 role、banned 等列，并在建会话前拒绝被封禁的账号。它的管理端点不对外，管理接口都是自家路由。
            admin(),
            nbSession(),
        ],
    } satisfies BetterAuthOptions;
}

export function createIdentityAuth(options: IdentityAuthOptions) {
    return betterAuth(identityAuthOptions(options));
}

export type IdentityAuth = ReturnType<typeof createIdentityAuth>;
