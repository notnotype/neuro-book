/**
 * 账号模块的接口（t10 计划 3.2；`site.accounts` 输入与前置条件的接口表）。建在接口层的核心上，每个函数声明路径、方法与
 * 自己处理哪些码；页面只拿 `Result`。路径与类型都取合同包，不在这里另写一份。
 *
 * 各片用到哪个接口就在这里加哪个：现在是取身份的两个（当前账号用）、`meta`、登录、登出、注册、补交同意、社交流程的发起，
 * 与账号页用的资料、密码、会话、上游身份、邀请码（B4）与已授权的应用（B7）。
 */

import {IDENTITY_API_PREFIX, IDENTITY_PATHS, identityPath} from "@notnotype/nb-site-identity-contract/constants";
import type {
    ChangePasswordRequest,
    ConsentRequest,
    ConsentResponse,
    EmptyResponse,
    GrantListResponse,
    IdentityListResponse,
    InviteCodeItem,
    InviteCodeListResponse,
    LoginRequest,
    LoginResponse,
    MeResponse,
    MetaResponse,
    PatchInviteCodeRequest,
    PatchMeRequest,
    RegisterRequest,
    RegisterResponse,
    SessionListResponse,
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
    /** 改自己的资料（输出 8）：成功回改过之后的资料。 */
    patchMe(body: PatchMeRequest): Promise<Result<MeResponse>>;
    /** 改密码或给没有密码的账号设密码（输出 9）。成功后别的会话都已结束（输出 6），当前这个保留。 */
    changePassword(body: ChangePasswordRequest): Promise<Result<EmptyResponse>>;
    /** 自己的会话（输出 17）。 */
    sessions(): Promise<Result<SessionListResponse>>;
    /** 结束自己的一个会话（输出 17）；不是自己的或不存在的回 `not_found`。 */
    endSession(id: number): Promise<Result<EmptyResponse>>;
    /** 已关联的上游身份（输出 24）。 */
    identities(): Promise<Result<IdentityListResponse>>;
    /** 解绑一个上游身份（输出 16、24）：解绑后没有登录方式回 `last_login_method`，不是自己的或不存在的回 `not_found`。 */
    unlinkIdentity(id: number): Promise<Result<EmptyResponse>>;
    /** 自己的邀请码，含停用、过期与用完的（输出 18）。 */
    inviteCodes(): Promise<Result<InviteCodeListResponse>>;
    /** 生成一个邀请码（输出 18）：已有 10 个能用的回 `invite_code_limit`。 */
    createInviteCode(): Promise<Result<InviteCodeItem>>;
    /** 停用自己的一个邀请码（输出 18）：成功回停用之后的那一项。 */
    disableInviteCode(id: number): Promise<Result<InviteCodeItem>>;
    /** 自己给过应用的授权（`site.oauth-provider` 输出 15）：免确认的客户端不在里面。 */
    grants(): Promise<Result<GrantListResponse>>;
    /** 撤销一项授权（输出 15）：不是自己的、已撤销的或客户端改成了免确认的回 `not_found`。 */
    revokeGrant(id: number): Promise<Result<EmptyResponse>>;
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
        // 下面是账号页的接口，都要有会话、都在同意门槛之内：`unauthenticated` 与门槛那种 `consent_required` 照常走统一处理。
        patchMe: (body) => core.request<MeResponse>({method: "PATCH", path: path(IDENTITY_PATHS.me), body}),
        changePassword: (body) => core.request<EmptyResponse>({method: "POST", path: path(IDENTITY_PATHS.mePassword), body}),
        sessions: () => core.request<SessionListResponse>({method: "GET", path: path(IDENTITY_PATHS.meSessions)}),
        // 不需要参数的写接口不带请求体（输出 22）。
        endSession: (id) => core.request<EmptyResponse>({method: "DELETE", path: path(identityPath.meSession(id))}),
        identities: () => core.request<IdentityListResponse>({method: "GET", path: path(IDENTITY_PATHS.meIdentities)}),
        unlinkIdentity: (id) => core.request<EmptyResponse>({method: "DELETE", path: path(identityPath.meIdentity(id))}),
        inviteCodes: () => core.request<InviteCodeListResponse>({method: "GET", path: path(IDENTITY_PATHS.meInviteCodes)}),
        createInviteCode: () => core.request<InviteCodeItem>({method: "POST", path: path(IDENTITY_PATHS.meInviteCodes)}),
        disableInviteCode: (id) => core.request<InviteCodeItem>({method: "PATCH", path: path(identityPath.meInviteCode(id)), body: {disabled: true} satisfies PatchInviteCodeRequest}),
        grants: () => core.request<GrantListResponse>({method: "GET", path: path(IDENTITY_PATHS.meGrants)}),
        revokeGrant: (id) => core.request<EmptyResponse>({method: "DELETE", path: path(identityPath.meGrant(id))}),
    };
}
