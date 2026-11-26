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
 * - `emailAndPassword.password` 的哈希与校验成为库上下文的 `password`（清单“内部接口”一行）。
 * - t08：签名钥的挑法与宽限期、私钥用 `secretConfig` 加密、`jwks` 的算法回退（清单“签名钥”几行，`oauth/signing-key.ts`）；
 *   `codeExpiresIn`、`accessTokenExpiresIn` 的缺省（清单“寿命”一行）；`storeClientSecret: {hash}` 是库校验客户端密钥的唯一途径
 *   （清单“客户端密钥”一行）；`getEndpoints` 给出与 `auth.api` 同一组端点，`disabledPaths` 逐字比路径、只挡 `handler`、不挡
 *   `auth.api`（清单“关掉的路径”一行）。
 * - t08 第 8 片：社交上游（`genericOAuth`，`social/providers.ts`）、state Cookie 的寿命、已关联身份登录时不写回上游令牌
 *   （`updateAccountOnSignIn`）、建会话前的钩子在社交回调里记下账号、库改 `emailVerified` 与重复关联走改账号的路径
 *   （`social/hooks.ts`；清单“社交”几行）。
 * - t08 第 9 片：社交注册时库在自己的事务里先后调建用户、建账号前的钩子，会话在提交之后建；注册意图碰上已关联的身份时库不建用户、
 *   直接建会话，建会话前的钩子拒它（`social/hooks.ts`；清单“社交”的“社交注册的先后”一行）。
 */

import {Type, type Static, type TSchema} from "typebox";
import {Value} from "typebox/value";

import {betterAuth, type BetterAuthOptions, type StandardSchemaV1} from "better-auth";
import {createAuthEndpoint, getEndpoints} from "better-auth/api";
import {deleteSessionCookie, setSessionCookie} from "better-auth/cookies";
import {admin, genericOAuth, jwt, username, type JwtOptions} from "better-auth/plugins";

import {oauthProvider} from "@better-auth/oauth-provider";

import {IDENTITY_AUTH_PREFIX, parseUsernameInput, USERNAME} from "@notnotype/nb-site-identity-contract";

import type {SocialConfig} from "./config";
import type {IdentityConnection} from "./db/connection";
import type {IdentityLog} from "./index";
import {clientSecretHash, generateClientSecret} from "./oauth/client-secret";
import {hashPassword, verifyPassword} from "./password";
import {consentRequiredIn} from "./session";
import {currentFrame, SOCIAL_FLOW_MS} from "./social/flow";
import {admitSocialSession, socialDatabaseHooks} from "./social/hooks";
import {socialProviderConfigs} from "./social/providers";
import {storedUserAgent} from "./user-agent";

/**
 * 库的路由前缀，就是合同的 `IDENTITY_AUTH_PREFIX`：库按完整路径认端点、发现文档里的地址也由它拼，入口挂挂载层（`oauth/mount.ts`）用的是
 * 合同的那个，两者必须相同（ADR 0060 决策 3）。
 */
export const LIB_BASE_PATH = IDENTITY_AUTH_PREFIX;

const DAY_SECONDS = 86_400;

export interface IdentityAuthOptions {
    /** 库经它的 `libDatabase()` 访问库；用户信息的扩展字段与登录后的同意判断经它的 `read`。 */
    readonly conn: IdentityConnection;
    /** 站点地址的 origin；库的 `baseURL`。 */
    readonly siteUrl: string;
    /** `NB_SITE_SESSION_SECRET`：签 Cookie 用，不进日志。 */
    readonly secret: string;
    readonly sessionDays: number;
    /** 当前条款版本：登录之后、确认之前判站点同意（`postLogin`）。 */
    readonly termsVersion: string;
    readonly clock: {now(): number};
    readonly log: Pick<IdentityLog, "warn" | "error">;
    /** 开放了的社交上游（`config.ts`）；不给时都不开放。 */
    readonly social?: SocialConfig;
}

/**
 * 换下来的签名钥的公钥还列在公钥地址里的时长（秒）：`site.oauth-provider` 输出 17，30 天。与库的缺省相同，仍显式写，库改缺省时
 * 不跟着变（实现审查第 4 条）。
 */
export const JWKS_GRACE_SECONDS = 30 * DAY_SECONDS;

/**
 * 库的 jwt 插件的选项；`oauth/signing-key.ts` 在启动时建钥也用这一份，新钥匙的算法与长度与库签发时期待的一致。
 * 签发者是站点地址的 origin、不带路径（`site.oauth-provider` 输出 2、11）。`disableSettingJwtHeader`：库不在会话响应上加
 * `set-auth-jwt` 头，那是给“会话换 JWT”用的，本站不提供。
 */
export function identityJwtOptions(siteUrl: string) {
    return {
        disableSettingJwtHeader: true,
        jwt: {issuer: new URL(siteUrl).origin},
        jwks: {keyPairConfig: {alg: "RS256", modulusLength: 2048}, gracePeriod: JWKS_GRACE_SECONDS},
    } satisfies JwtOptions;
}

/**
 * 库的端点里对外要的那几条（`site.oauth-provider` 输出 1，计划 3.6 的挂载白名单）：别的“方法加路径”经站点都是 404。路径是库端点
 * 的写法（`auth.api` 里端点的 `path`，带参数的写成 `:name`），方法是对外放行的。挂载层（`oauth/mount.ts`）照这张表登记；
 * `disabledPaths` 由它反推（`disabledLibraryPaths`）。
 *
 * 只有公钥列着 HEAD（`site.oauth-provider` 输入表下那句）：挂载层把它当 GET 交库再去掉正文，因为库对 HEAD 一律 404（升级清单
 * “对外端点的方法”一行）。授权端点不收 HEAD：收了就有发码的副作用。
 */
export const LIBRARY_PUBLIC_ENDPOINTS = [
    // POST 只收表单（OIDC Core 3.1.2.1 要求同时支持 GET 与 POST；计划 omp 设计审查第 3 条）。
    {path: "/oauth2/authorize", methods: ["GET", "POST"]},
    {path: "/oauth2/token", methods: ["POST"]},
    {path: "/oauth2/userinfo", methods: ["GET", "POST"]},
    {path: "/oauth2/revoke", methods: ["POST"]},
    {path: "/jwks", methods: ["GET", "HEAD"]},
    // 社交登录的回调（第 8 片）：挂载层只放开放了的上游，`:id` 是 `google` 或 `github`。
    {path: "/callback/:id", methods: ["GET"]},
] as const satisfies readonly {readonly path: string; readonly methods: readonly string[]}[];

/** 库端点表里本模块读的两样：路径（`createAuthEndpoint.serverOnly` 建的没有路径），与是否只供服务端调用。 */
interface LibraryEndpointShape {
    readonly path?: string;
    readonly options?: {readonly metadata?: {readonly SERVER_ONLY?: boolean}};
}

/**
 * 交给库的 `disabledPaths`：库的全部端点路径，减去对外要的（`LIBRARY_PUBLIC_ENDPOINTS`）、只供服务端调用的与带参数的。经 `handler`
 * 这些路径一律 404；服务端经 `auth.api` 调不受影响（第六轮问 6 实测）。这是第二道，第一道是挂载层的白名单（计划 3.6）：白名单
 * 写宽了时，库删会话（`/sign-out`、`/revoke-sessions`、`/admin/ban-user` 等，不经 `oauth/revoke.ts` 的撤销）、改密码、改账号
 * 的端点仍到不了（实现审查第 1 条）。不手写清单：库新加的端点自动落进关掉的一边。
 *
 * 取法：`better-auth/api` 导出的 `getEndpoints` 用同一份选项算出端点表。库 1.7.27 的 `betterAuth` 由它得出 `auth.api`、`handler`
 * 每次请求也由它建路由，所以三者是同一组端点；它的端点只在被调用时才等上下文，这里给一个不会完成的 Promise，只读 `path` 与
 * `options`。以上进升级清单“关掉的路径”一行。
 *
 * 不列的两类：
 * - 只供服务端调用的（`metadata.SERVER_ONLY`）：经 `handler` 本来就是 404。列进来的话，`auth.test.ts` 守着这条库行为的用例就
 *   分辨不出 404 是谁给的。
 * - 带参数的（`/reset-password/:token`）：库拿请求路径（去掉基路径与末尾的斜杠）与 `disabledPaths` 逐字比，不认参数，写进去只挡
 *   字面的 `:token`。它们只靠挂载白名单挡；`oauth/provider.test.ts` 列着现在经 `handler` 到得了的几条，库新加时那条用例失败。
 * 逐字比也不分方法：对外路径上合同不要的方法（`PUT /oauth2/authorize`、`GET /oauth2/token`）这里关不掉，由挂载层按方法挡。
 */
export function disabledLibraryPaths(options: BetterAuthOptions): string[] {
    const publicPaths = new Set<string>(LIBRARY_PUBLIC_ENDPOINTS.map((endpoint) => endpoint.path));
    const {api} = getEndpoints(new Promise<never>(() => undefined), options);
    const paths = new Set<string>();
    for (const endpoint of Object.values(api) as LibraryEndpointShape[]) {
        const path = endpoint.path;
        if (path === undefined || publicPaths.has(path) || path.includes(":") || endpoint.options?.metadata?.SERVER_ONLY === true) continue;
        paths.add(path);
    }
    return [...paths].sort();
}

/** 授权码与访问令牌的寿命（秒）：用库的缺省，不在选项里写；库改了缺省时包内用例失败（升级清单“寿命”一行）。 */
export const LIBRARY_CODE_SECONDS = 600;
export const LIBRARY_ACCESS_TOKEN_SECONDS = 3600;

/** id_token 的寿命（秒）：`site.oauth-provider` 输出 11，签发后 1 小时。库的缺省是 10 小时，所以显式写。 */
export const ID_TOKEN_SECONDS = 3600;

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

const IssueSessionBody = Type.Object({userId: Type.Integer({minimum: 1})}, {additionalProperties: false});
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
             * 给一个已存在的账号发会话。浏览器标识随调用的 `headers`（`user-agent`）进来，库的 `createSession` 从这次调用的请求头
             * 里取它，与 t08 由库自己建会话时是同一条路；原始写法在建会话前的钩子里换成概要，不落库（见 `databaseHooks`）。
             * 账号被封禁时 `admin` 插件在建会话前拒绝（`APIError`，`BANNED_USER`），调用方换成 `account_banned`。
             */
            issueSession: createAuthEndpoint("/nb-session/issue", {method: "POST", body: bodySchema(IssueSessionBody), metadata: {SERVER_ONLY: true}}, async (ctx) => {
                const {userId} = ctx.body;
                const user = await ctx.context.internalAdapter.findUserById(String(userId));
                if (user === null) throw new TypeError("issueSession: the account does not exist");
                const session = await ctx.context.internalAdapter.createSession(String(userId), false);
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
    const {clock, conn, log, termsVersion} = options;
    const sessionSeconds = options.sessionDays * DAY_SECONDS;
    const assembled = {
        baseURL: options.siteUrl,
        basePath: LIB_BASE_PATH,
        secret: options.secret,
        database: conn.libDatabase(),
        advanced: {
            database: {
                // 库插入时不带 id，由表的 AUTOINCREMENT 发号；库把 id 读成字符串，模块对外一律转成整数。
                generateId: "serial",
                // 库按令牌查会话时连带它的账号（`findSession` 的 `join: {user: true}`）。缺省关着时库分两次查、两次之间放开队列的锁，
                // 改角色并结束会话的写事务能插在中间，问身份就拿旧会话回了新角色（omp 实现审查第 6 条）。打开后 Kysely 适配器用一条
                // 带 LEFT JOIN 的查询，会话与账号出自同一个库状态。由 `session.test.ts` 的“改角色与问身份交错”用例核对。
                joins: true,
            },
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
            // 社交流程的 state Cookie（认发起的浏览器，`site.accounts` 时序一节）：库缺省 300 秒，Spec 要 10 分钟，与流程行、库的 state
            // 行同寿（问 7.5d；升级清单“社交”的“state Cookie 的寿命”一行）。
            cookies: {state: {attributes: {maxAge: SOCIAL_FLOW_MS / 1000}}},
        },
        // 限流自己做（计划 3.8）。
        rateLimit: {enabled: false},
        // 密码登录、注册、改密码都是模块自己的路由（`login.ts` 等），库的这几个端点不对外（`auth.handler` 没挂）。仍然打开并换上
        // 模块的哈希与校验：库自己在别的路径上碰密码时（t08 的关联要核对当前密码）用的是同一种存法，不会写出库缺省的
        // `hexsalt:hexkey` 格式（计划 3.7 的“密码格式”）。关掉库的注册：账号只经模块的注册与命令行建。
        emailAndPassword: {
            enabled: true,
            disableSignUp: true,
            password: {
                hash: hashPassword,
                // 库不给账号 id，日志里记 "library"：只有未知格式那一行用得到。
                verify: ({hash, password}) => verifyPassword(password, hash, {accountId: "library", log}),
            },
        },
        account: {
            accountLinking: {
                // 社交登录不按邮箱自动关联到已有账号（`site.accounts` 输出 12、14：认人只按上游身份，邮箱撞号时拒绝）。
                disableImplicitLinking: true,
                // 关联不要求上游的邮箱与账号的邮箱相同（输出 15）。
                allowDifferentEmails: true,
                // 不列时库对上游说邮箱没验证过的身份拒绝关联（`unable_to_link_account`）；关联认的是会话与当前密码，不看上游邮箱。
                trustedProviders: ["google", "github"],
            },
            // 已关联的身份登录时库缺省把这次的上游令牌写回 `account` 行（问 11）；站点不存上游令牌（副作用一节），关掉。建行时的
            // 令牌由建账号前的钩子置空（`social/hooks.ts`）。
            updateAccountOnSignIn: false,
        },
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
            // 社交流程里的改账号列、建与改上游身份的行（`social/hooks.ts`）。
            ...socialDatabaseHooks({conn, clock}),
            session: {
                create: {
                    // 库建会话时取系统时间；改成模块的时钟（计划 3.14：合同测试拨的是模块的时钟）。来源地址恒为空。
                    // 浏览器标识：库按这次调用的请求头填进原始的 `User-Agent`（没有时是空串），这里换成概要的 JSON 或 null
                    // （`user-agent.ts`；`site.accounts` 副作用一节“只存概要”）。所有建会话的路（模块的 issueSession、t08 由库建的）
                    // 都经这个钩子，概要只在这一处算。`databaseHooks` 的 before 返回的 `data` 整个替换库要插入的行，是库 1.7.27 的
                    // 行为，由升级清单“内部接口”的“发会话”用例核对。
                    // 社交回调里库自己建会话：注册意图下库没建账号就拒（库登录了已关联的旧账号），通过时把账号记进帧，回调据此写最近
                    // 登录时间（`social/hooks.ts` 的 `admitSocialSession`）。
                    before: async (session) => {
                        const frame = currentFrame();
                        if (frame !== undefined) admitSocialSession(frame, Number(session.userId));
                        const now = clock.now();
                        return {
                            data: {
                                ...session,
                                createdAt: new Date(now),
                                updatedAt: new Date(now),
                                expiresAt: new Date(now + sessionSeconds * 1000),
                                ipAddress: null,
                                userAgent: storedUserAgent(session.userAgent),
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
            jwt(identityJwtOptions(options.siteUrl)),
            // 社交上游（`social/providers.ts`）。没有开放的上游时也加，只是不带上游：插件本身不加端点与表（回调是库的
            // `/callback/:id`），总在时 `auth.api` 的类型不随配置变。
            genericOAuth({config: socialProviderConfigs(options.social ?? {})}),
            // 对外 OAuth 与 OIDC（`site.oauth-provider`）。只有授权码一种授权方式、必须带 openid；动态登记保持缺省关，客户端只经
            // 管理接口登记。登录页与确认页是站点前端的页面（库带人去这两处，挂载层再改写，计划 3.6、3.8）。
            // 寿命：授权码与访问令牌用库的缺省（`LIBRARY_CODE_SECONDS`、`LIBRARY_ACCESS_TOKEN_SECONDS`），id_token 显式写 1 小时。
            oauthProvider({
                loginPage: "/login",
                consentPage: "/oauth/consent",
                scopes: ["openid", "profile", "email"],
                grantTypes: ["authorization_code"],
                requireOpenId: true,
                idTokenExpiresIn: ID_TOKEN_SECONDS,
                // 只给 hash、不给 verify：库换码时对带来的密钥调一次 hash，与存的值做定长比较（`oauth/client-secret.ts`）。
                storeClientSecret: {hash: clientSecretHash},
                generateClientSecret,
                // 用户信息的两个扩展字段（`site.oauth-provider` 输出 7）。库给的别的字段由挂载层滤掉（计划 3.6）。
                customUserInfoClaims: ({user, scopes}) => userInfoClaims(conn, Number(user.id), scopes),
                // 缺站点同意的账号在库认出会话之后、看确认之前被带去站点的同意页（计划 3.4；行为由第 6 片的用例核对）。授权不按
                // 业务对象区分（`consentReferenceId` 恒为空）。同意的规则只有 `consentRequiredIn` 一份。
                postLogin: {
                    page: "/consent",
                    consentReferenceId: () => undefined,
                    shouldRedirect: ({user}) => conn.read((tx) => consentRequiredIn(tx, Number(user.id), termsVersion)),
                },
            }),
        ],
    } satisfies BetterAuthOptions;
    // 关掉的路径要从装好插件的这一份选项算：端点表随插件变。
    return {...assembled, disabledPaths: disabledLibraryPaths(assembled)} satisfies BetterAuthOptions;
}

/**
 * 用户信息端点在库给的字段之外加的：`profile` 范围给 `preferred_username`（小写的登录名），`email` 范围给 `email_pending`
 * （`identity_profile` 里的待补标记）。账号没有资料行或没有登录名是程序错误：每个账号建时都同时建资料行、写登录名。
 */
async function userInfoClaims(conn: IdentityConnection, userId: number, scopes: readonly string[]): Promise<Record<string, unknown>> {
    const row = await conn.read((tx) =>
        tx
            .query<{username: string | null; email_pending: number}, [number]>(
                `SELECT u."username" AS username, p.email_pending AS email_pending FROM "user" u JOIN identity_profile p ON p.user_id = u.id WHERE u.id = ?`,
            )
            .get(userId),
    );
    if (row === null || row.username === null) throw new Error("userinfo: the account has no profile row or no username");
    return {
        ...(scopes.includes("profile") ? {preferred_username: row.username} : {}),
        ...(scopes.includes("email") ? {email_pending: row.email_pending === 1} : {}),
    };
}

export function createIdentityAuth(options: IdentityAuthOptions) {
    return betterAuth(identityAuthOptions(options));
}

export type IdentityAuth = ReturnType<typeof createIdentityAuth>;
