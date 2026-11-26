/**
 * 两个上游在库里的配置（计划 3.4 的 `genericOAuth`；配置见 `config.ts`）。只为开放了的上游加：没开放的上游库里没有，挂载层也不放它的
 * 回调（`oauth/mount.ts`）。
 *
 * 两个都 `pkce: true`、`disableImplicitSignUp: true`：库不在登录意图下替没关联的上游身份建账号（`site.accounts` 输出 12），只有
 * 注册意图（`requestSignUp`）才建。取用户信息时把上游账号的名字与“邮箱是否验证过”记进社交流程的帧（`flow.ts`），注册钩子与
 * 上游名字表要用；这里不拒未验证的邮箱：登录已关联的身份时邮箱不参与认人（计划第 9 节 P12），拒在注册钩子里（第 9 片）。
 *
 * 依赖库的行为（升级清单“社交上游”几行）：Google 配了 `discoveryUrl` 时库在启动时取发现文档，回调里 id_token 带着 `sub` 与
 * `email` 就按 id_token 认人（经上游的公钥验签、核对 `nonce`），不再调 userinfo，`emailVerified` 取 id_token 的 `email_verified`；
 * GitHub 用自定义的 `getUserInfo`，库按它回的 `id` 认上游身份。
 *
 * 发现文档缺 `issuer` 或 `jwks_uri` 时库建不出验签的配置，却照样建上游、改读不验签不比 nonce 的 id_token（omp 实现审查第 6 条），
 * 所以 Google 配 `requireIdTokenVerification`：库 1.7.27 在带 `discoveryUrl` 时跳过这样的上游、放进待重试表，发起时再取一次仍缺
 * 就抛 `PROVIDER_NOT_FOUND`，`start.ts` 换成 503 `unavailable`（`site.accounts` 输出 11）。
 */

import type {GenericOAuthConfig} from "better-auth/plugins";

import type {SocialProvider} from "@notnotype/nb-site-identity-contract";

import type {GitHubUpstreamConfig, GoogleUpstreamConfig, SocialConfig} from "../config";
import {currentFrame} from "./flow";

/** 上游账号的名字的长度上限（`0003_social.sql`）；超了截断。 */
const UPSTREAM_NAME_MAX = 200;

/** 开放了的上游，按 `SOCIAL_PROVIDERS` 的先后。 */
export function openProviders(social: SocialConfig): SocialProvider[] {
    return [...(social.google === undefined ? [] : (["google"] as const)), ...(social.github === undefined ? [] : (["github"] as const))];
}

/** 交给 `genericOAuth({config})` 的配置；没有开放的上游时是空数组。 */
export function socialProviderConfigs(social: SocialConfig): GenericOAuthConfig[] {
    return [...(social.google === undefined ? [] : [googleConfig(social.google)]), ...(social.github === undefined ? [] : [githubConfig(social.github)])];
}

function recordUpstream(name: string, emailVerified: boolean): void {
    const frame = currentFrame();
    if (frame !== undefined) frame.upstream = {name: [...name].slice(0, UPSTREAM_NAME_MAX).join(""), emailVerified};
}

function googleConfig(google: GoogleUpstreamConfig): GenericOAuthConfig {
    return {
        providerId: "google",
        clientId: google.clientId,
        clientSecret: google.clientSecret,
        discoveryUrl: `${google.issuer}/.well-known/openid-configuration`,
        // 文件头：拿不到验 id_token 的公钥就不建这个上游，不退回不验签。
        requireIdTokenVerification: true,
        scopes: ["openid", "email", "profile"],
        pkce: true,
        disableImplicitSignUp: true,
        // 上游账号的名字取邮箱（`site.accounts` 术语一节），没有邮箱时退到显示名、再退到 `sub`：只是给本人认的，有总比空好。
        // 回空对象：账号的字段由库按上游信息取缺省，注册时再由注册钩子改写（第 9 片）。
        mapProfileToUser: (profile) => {
            const email = typeof profile.email === "string" ? profile.email : "";
            const name = typeof profile.name === "string" ? profile.name : "";
            // `emailVerified` 是库从 `email_verified` 解出的布尔（字符串的 "true" 也认），与库记进账号的是同一个值。
            recordUpstream(email || name || String(profile.sub ?? ""), profile.emailVerified === true);
            return {};
        },
    };
}

/** GitHub 的 `/user/emails` 的一项。 */
interface GitHubEmail {
    readonly email?: unknown;
    readonly primary?: unknown;
    readonly verified?: unknown;
}

function githubConfig(github: GitHubUpstreamConfig): GenericOAuthConfig {
    return {
        providerId: "github",
        clientId: github.clientId,
        clientSecret: github.clientSecret,
        authorizationUrl: `${github.url}/login/oauth/authorize`,
        tokenUrl: `${github.url}/login/oauth/access_token`,
        scopes: ["read:user", "user:email"],
        pkce: true,
        disableImplicitSignUp: true,
        // GitHub 不是 OpenID Connect：`/user` 的 `email` 是用户自己选的公开邮箱、可能为空，也不说验没验证过；主邮箱与它的
        // `verified` 只在 `/user/emails` 里（与库内置的 github 提供方同样的取法）。只取主邮箱（`site.accounts` 输出 13）：没有主
        // 邮箱时不给邮箱，库以 `email_not_found` 拒绝（输出 12 的已知限制）。两个接口任一个不成功都回 null，库按
        // `unable_to_get_user_info` 处理：猜一个邮箱或验证状态都可能让注册钩子判错。
        getUserInfo: async (tokens) => {
            const headers = {Authorization: `Bearer ${tokens.accessToken ?? ""}`, Accept: "application/vnd.github+json", "User-Agent": "nb-site"};
            const [userResponse, emailsResponse] = await Promise.all([fetch(`${github.apiUrl}/user`, {headers}), fetch(`${github.apiUrl}/user/emails`, {headers})]);
            if (!userResponse.ok || !emailsResponse.ok) return null;
            const user = (await userResponse.json()) as {readonly id?: unknown; readonly login?: unknown; readonly name?: unknown; readonly avatar_url?: unknown};
            const emails = (await emailsResponse.json()) as unknown;
            if (typeof user.id !== "number" || typeof user.login !== "string" || !Array.isArray(emails)) return null;
            const primary = (emails as GitHubEmail[]).find((item) => item.primary === true && typeof item.email === "string");
            const emailVerified = primary?.verified === true;
            recordUpstream(user.login, emailVerified);
            return {
                id: String(user.id),
                ...(primary === undefined ? {} : {email: primary.email as string}),
                emailVerified,
                name: typeof user.name === "string" && user.name !== "" ? user.name : user.login,
                ...(typeof user.avatar_url === "string" ? {image: user.avatar_url} : {}),
            };
        },
    };
}
