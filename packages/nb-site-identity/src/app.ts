/**
 * 账号的子应用：挂在 `IDENTITY_API_PREFIX` 下的自家路由（w00037 t07 计划 3.6；ADR 0063）。全部接口都是自家路由，库的
 * `auth.handler` 不挂在这里。
 *
 * 登记的先后就是请求经过的先后：不缓存 → 来源头 → 请求体大小 → 各路由 → 最后一条兜底路由。兜底路由覆盖前缀本身与前缀下的任何路径与
 * 方法，回 404 `not_found` 的 `ErrorBody`：子应用经 `app.route` 挂进入口应用时它自己的 `notFound` 不跟着走，没有兜底时未知的路径
 * 会落到入口的 404（`{"code":…}` 的形状，与账号的错误形状不同；omp 设计审查第 8 条）。兜底之后再登记的路由会被它挡住，所以它
 * 必须最后登记。
 */

import {Hono} from "hono";

import {IDENTITY_PATHS, type MetaResponse, type SocialProvider} from "@notnotype/nb-site-identity-contract";

import {registerAuditListRoute, type AuditListOptions} from "./admin/audit-list";
import {registerInviteCodeAdminRoutes, type InviteCodeAdminOptions} from "./admin/invite-codes";
import {registerOAuthClientAdminRoutes, type OAuthClientAdminOptions} from "./admin/oauth-clients";
import {registerRegistrationCodeRoutes, type RegistrationCodeAdminOptions} from "./admin/registration-codes";
import {registerUserAdminRoutes, type UserAdminOptions} from "./admin/users";
import {registerChangePasswordRoute, type ChangePasswordOptions} from "./change-password";
import {bodySizeLimit, failureFor, failureResponse, readEmptyBody, respondFailure} from "./errors";
import type {IdentityLog} from "./index";
import {registerInviteCodeRoutes, type InviteCodeOptions} from "./invite-codes";
import {loginRoute, type LoginOptions} from "./login";
import {registerMeRoutes, type MeOptions} from "./me";
import {appendCookies, requireSameOrigin} from "./middleware";
import {registerMySessionRoutes, type MySessionsOptions} from "./my-sessions";
import {registerOAuthConsentRoutes, type OAuthConsentOptions} from "./oauth/consent-api";
import {registerGrantRoutes, type GrantOptions} from "./oauth/grants";
import {registerRoute, type RegisterOptions} from "./register";
import type {Sessions} from "./session";
import {registerIdentityRoutes, type IdentityRoutesOptions} from "./social/identities";
import {registerSocialStartRoute, type SocialStartOptions} from "./social/start";

export interface IdentityAppOptions {
    readonly sessions: Sessions;
    /** 站点地址的 origin，来源头要等于它。 */
    readonly siteOrigin: string;
    readonly termsVersion: string;
    readonly registrationOpen: boolean;
    /** 开放了的社交上游（`meta` 的 `providers`）。 */
    readonly socialProviders: readonly SocialProvider[];
    readonly log: Pick<IdentityLog, "warn" | "error">;
    readonly login: LoginOptions;
    readonly register: RegisterOptions;
    readonly changePassword: ChangePasswordOptions;
    readonly me: MeOptions;
    readonly mySessions: MySessionsOptions;
    readonly inviteCodes: InviteCodeOptions;
    readonly registrationCodes: RegistrationCodeAdminOptions;
    readonly adminUsers: UserAdminOptions;
    readonly adminInviteCodes: InviteCodeAdminOptions;
    readonly audit: AuditListOptions;
    readonly adminOAuthClients: OAuthClientAdminOptions;
    readonly oauthConsent: OAuthConsentOptions;
    readonly grants: GrantOptions;
    readonly socialStart: SocialStartOptions;
    readonly identities: IdentityRoutesOptions;
}

export function createIdentityApp(options: IdentityAppOptions): Hono {
    const {sessions, log} = options;
    const app = new Hono();

    // 账号接口的回答随 Cookie 变（是谁、有哪些会话），一律不许缓存：反向代理或 CDN 的一条宽松规则就能把一个人的回答发给别人，
    // 浏览器的前进后退缓存也会在登出后显示旧的身份（实现审查第 5 条）。放在第一个、在 `next()` 之后设：后面的中间件与路由抛出的
    // 错误已由子应用的出错出口在各自那一层换成响应，这里拿到的 `c.res` 包括出错出口、请求体上限与兜底 404 回的响应。
    app.use("*", async (c, next) => {
        await next();
        c.res.headers.set("Cache-Control", "no-store");
    });
    app.use("*", requireSameOrigin(options.siteOrigin));
    app.use("*", bodySizeLimit);

    // 问身份：任何人可调，不延长会话、不写库（`site.accounts` 输出 7）。与模块导出的 `whoami` 是同一个函数。
    app.get(IDENTITY_PATHS.whoami, (c) => sessions.whoami(c.req.raw));

    app.get(IDENTITY_PATHS.meta, (c) => {
        const open = new Set(options.socialProviders);
        const body: MetaResponse = {termsVersion: options.termsVersion, registrationOpen: options.registrationOpen, providers: {google: open.has("google"), github: open.has("github")}};
        return c.json(body);
    });

    // 登出：没有会话时也成功；删不成时出口回 503、不清 Cookie（`Sessions.logout`）。同意门槛放行它，所以不经 `requireSession`，
    // 也不延长一个马上就要结束的会话。
    app.post(IDENTITY_PATHS.logout, async (c) => {
        await readEmptyBody(c);
        appendCookies(c, await sessions.logout(c.req.header("Cookie") ?? null));
        return c.json({});
    });

    app.post(IDENTITY_PATHS.register, registerRoute(options.register));
    app.post(IDENTITY_PATHS.login, loginRoute(options.login));
    registerMeRoutes(app, options.me);
    registerMySessionRoutes(app, options.mySessions);
    registerInviteCodeRoutes(app, options.inviteCodes);
    registerChangePasswordRoute(app, options.changePassword);
    registerRegistrationCodeRoutes(app, options.registrationCodes);
    registerUserAdminRoutes(app, options.adminUsers);
    registerInviteCodeAdminRoutes(app, options.adminInviteCodes);
    registerAuditListRoute(app, options.audit);
    registerOAuthClientAdminRoutes(app, options.adminOAuthClients);
    registerOAuthConsentRoutes(app, options.oauthConsent);
    registerGrantRoutes(app, options.grants);
    registerSocialStartRoute(app, options.socialStart);
    registerIdentityRoutes(app, options.identities);

    app.all("*", (c) => respondFailure(c, failureResponse("not_found")));
    app.onError((error, c) => respondFailure(c, failureFor(error, log)));
    return app;
}
