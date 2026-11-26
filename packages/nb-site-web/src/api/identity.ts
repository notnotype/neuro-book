/**
 * 账号模块的接口（t10 计划 3.2；`site.accounts` 输入与前置条件的接口表）。建在接口层的核心上，每个函数声明路径、方法与
 * 自己处理哪些码；页面只拿 `Result`。路径与类型都取合同包，不在这里另写一份。
 *
 * 各片用到哪个接口就在这里加哪个：现在是取身份的两个（当前账号用）、`meta`、登录与登出。
 */

import {IDENTITY_API_PREFIX, IDENTITY_PATHS} from "@notnotype/nb-site-identity-contract";
import type {EmptyResponse, LoginRequest, LoginResponse, MeResponse, MetaResponse, WhoamiResponse} from "@notnotype/nb-site-identity-contract";

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
    };
}
