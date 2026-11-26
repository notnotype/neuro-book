/**
 * 账号模块的接口（t10 计划 3.2；`site.accounts` 输入与前置条件的接口表）。建在接口层的核心上，每个函数声明路径、方法与
 * 自己处理哪些码；页面只拿 `Result`。路径与类型都取合同包，不在这里另写一份。
 *
 * 各片用到哪个接口就在这里加哪个：现在是取身份的两个（当前账号用）、`meta`、登录、登出、注册、补交同意与社交流程的发起。
 */

import {IDENTITY_API_PREFIX, IDENTITY_PATHS, identityPath} from "@notnotype/nb-site-identity-contract/constants";
import type {
    ConsentRequest,
    ConsentResponse,
    EmptyResponse,
    LoginRequest,
    LoginResponse,
    MeResponse,
    MetaResponse,
    RegisterRequest,
    RegisterResponse,
    SocialProvider,
    SocialStartRequest,
    SocialStartResponse,
    WhoamiResponse,
} from "@notnotype/nb-site-identity-contract/constants";

import type {AccountSource} from "../session/account";
import type {ApiCore, Result} from "./core";

/** 账号模块的接口。取身份的两个合起来就是当前账号要的 `AccountSource`。 */
export interface IdentityApi extends AccountSource {
    /** 当前条款版本、注册与各上游是否开放。任何人都能调，不受同意门槛限制。 */
    meta(): Promise<Result<MetaResponse>>;
    /** 密码登录（输出 4）。成功时会话已随 `Set-Cookie` 建立，当前账号由调用方重取。 */
    login(body: LoginRequest): Promise<Result<LoginResponse>>;
    /** 结束当前会话（输出 5）。 */
    logout(): Promise<Result<EmptyResponse>>;
    /** 密码注册（输出 1 到 3）。成功时会话已建立，当前账号由调用方重取。 */
    register(body: RegisterRequest): Promise<Result<RegisterResponse>>;
    /** 补交同意（输出 10）。成功后当前账号由调用方重取。 */
    consent(body: ConsentRequest): Promise<Result<ConsentResponse>>;
    /** 发起社交登录、注册或关联（输出 11、13、15）：成功回上游的地址，由调用方带浏览器过去。 */
    socialStart(provider: SocialProvider, body: SocialStartRequest): Promise<Result<SocialStartResponse>>;
}

const path = (relative: string): string => `${IDENTITY_API_PREFIX}${relative}`;

export function createIdentityApi(core: ApiCore): IdentityApi {
    return {
        // 取身份的两个在路由守卫里被调用，自己处理 `unauthenticated`（见 `AccountSource` 的注释）。
        // `GET me` 不受同意门槛限制（`site.accounts` 输出 10），不用声明 `consent_required`。
        whoami: () => core.request<WhoamiResponse>({method: "GET", path: path(IDENTITY_PATHS.whoami), handles: ["unauthenticated"]}),
        me: () => core.request<MeResponse>({method: "GET", path: path(IDENTITY_PATHS.me), handles: ["unauthenticated"]}),
        meta: () => core.request<MetaResponse>({method: "GET", path: path(IDENTITY_PATHS.meta)}),
        // 登录回的是 `invalid_credentials`，不会回 `unauthenticated`；不声明，万一回了照常走统一处理。
        login: (body) => core.request<LoginResponse>({method: "POST", path: path(IDENTITY_PATHS.login), body}),
        // 不带请求体（输出 22：不需要参数的写接口请求体可以为空）。会话已经没了时服务端回 `unauthenticated`：要的结果（登出）已经成立，
        // 由登出的调用方当作成功，统一处理不必再带人去登录页。
        logout: () => core.request<EmptyResponse>({method: "POST", path: path(IDENTITY_PATHS.logout), handles: ["unauthenticated"]}),
        // 注册回的 `consent_required` 是“没勾同意”或条款版本已换（输出 3），不是同意门槛：由注册页显示在勾选框上，统一处理跳过。
        register: (body) => core.request<RegisterResponse>({method: "POST", path: path(IDENTITY_PATHS.register), body, handles: ["consent_required"]}),
        // 同意页自己就是门槛的去处：补交时回的 `consent_required`（版本又换了）由同意页显示，不再跳一次同意页。
        consent: (body) => core.request<ConsentResponse>({method: "POST", path: path(IDENTITY_PATHS.meConsent), body, handles: ["consent_required"]}),
        // 注册意图的发起与注册一样，`consent_required` 是“没勾同意”（输出 13 按输出 3 校验），由注册页显示。关联意图在同意门槛之内
        // （输出 10），回这个码就是门槛，照常走统一处理；登录意图在访客页上发起，统一处理在那里本来就不管这个码。
        socialStart: (provider, body) => core.request<SocialStartResponse>({
            method: "POST",
            path: path(identityPath.socialStart(provider)),
            body,
            ...(body.intent === "register" ? {handles: ["consent_required"] as const} : {}),
        }),
    };
}
