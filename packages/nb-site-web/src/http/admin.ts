/**
 * 管理接口（t10 计划 3.2；`site.admin` 输入与前置条件的接口表）：四个列表页用的五个列表、对账号的五种处置、注册码的发放与停用，
 * 与 OAuth 客户端的登记、改动、换密钥（`site.oauth-provider` 输出 9、16）。
 * 建在接口层的核心上，路径与类型都取合同包；页面只拿 `Result`。
 *
 * 不进应用根的上下文：只有管理面板的页面用它，各页用 `createAdminApi(useSite().api)` 自己建一份，跟着管理面板的块走，
 * 不进访客的入口块。`forbidden`（角色刚被改）与 `unauthenticated` 都走统一处理（`site.ts`），这里不声明 `handles`。
 */

import {IDENTITY_API_PREFIX, IDENTITY_PATHS, identityPath} from "@notnotype/nb-site-identity-contract/constants";
import type {
    AdminInviteCodeListResponse,
    AdminUserAction,
    AdminUserItem,
    AuditListQuery,
    AuditListResponse,
    CreateOAuthClientRequest,
    CreateOAuthClientResponse,
    CreateRegistrationCodeRequest,
    InviteCodeListQuery,
    OAuthClientItem,
    OAuthClientListQuery,
    OAuthClientListResponse,
    PatchOAuthClientRequest,
    PatchRegistrationCodeRequest,
    RegistrationCodeItem,
    RegistrationCodeListQuery,
    RegistrationCodeListResponse,
    ResetPasswordResponse,
    Role,
    RoleRequest,
    RotateSecretResponse,
    UserListQuery,
    UserListResponse,
} from "@notnotype/nb-site-identity-contract/constants";

import type {ApiCore, Result} from "./core";

/** 回处置之后那一条的四种处置（`AdminUserItem` 的注释）；重置密码回的是新密码，单独一个函数。 */
export type UserItemAction = Exclude<AdminUserAction, "role" | "reset-password">;

export interface AdminApi {
    listUsers(query: UserListQuery): Promise<Result<UserListResponse>>;
    /** 封禁、解封、结束全部会话（输出 2、5）：成功回处置之后的那一条。 */
    actOnUser(id: number, action: UserItemAction): Promise<Result<AdminUserItem>>;
    /** 改角色（输出 3、5）：成功回处置之后的那一条。 */
    setRole(id: number, role: Role): Promise<Result<AdminUserItem>>;
    /** 重置密码（输出 4）：新密码只在这个回答里出现一次。 */
    resetPassword(id: number): Promise<Result<ResetPasswordResponse>>;
    listRegistrationCodes(query: RegistrationCodeListQuery): Promise<Result<RegistrationCodeListResponse>>;
    /** 发放注册码（输出 7）：成功回带着码的那一项。 */
    createRegistrationCode(body: CreateRegistrationCodeRequest): Promise<Result<RegistrationCodeItem>>;
    /** 停用注册码（输出 7）：停用不能撤回；成功回停用之后的那一项。 */
    disableRegistrationCode(id: number): Promise<Result<RegistrationCodeItem>>;
    listInviteCodes(query: InviteCodeListQuery): Promise<Result<AdminInviteCodeListResponse>>;
    listAudit(query: AuditListQuery): Promise<Result<AuditListResponse>>;
    listOAuthClients(query: OAuthClientListQuery): Promise<Result<OAuthClientListResponse>>;
    /** 登记客户端（输出 9）：机密客户端的密钥只在这个回答里出现一次。回调地址不合种类的规则回 `redirect_uri_invalid`。 */
    createOAuthClient(body: CreateOAuthClientRequest): Promise<Result<CreateOAuthClientResponse>>;
    /** 改名字、回调地址、是否免确认、是否停用（输出 16）：成功回改过之后的那一项；`clientId` 是客户端 id，不是数字 id。 */
    patchOAuthClient(clientId: string, body: PatchOAuthClientRequest): Promise<Result<OAuthClientItem>>;
    /** 换密钥（输出 9）：新密钥只出现这一次，旧密钥立即不能用；公开客户端回 `client_public`。 */
    rotateOAuthClientSecret(clientId: string): Promise<Result<RotateSecretResponse>>;
}

const path = (relative: string): string => `${IDENTITY_API_PREFIX}${relative}`;

/** 查询串：没给的参数不写（合同里它们都可省，省了按缺省）。参数的先后按调用方给的键序，同一查询串总是同一个写法。 */
function withQuery(relative: string, query: Readonly<Record<string, string | undefined>>): string {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) if (value !== undefined) search.set(key, value);
    const text = search.toString();
    return text === "" ? path(relative) : `${path(relative)}?${text}`;
}

export function createAdminApi(core: ApiCore): AdminApi {
    return {
        listUsers: (query) => core.request<UserListResponse>({method: "GET", path: withQuery(IDENTITY_PATHS.adminUsers, query)}),
        // 不需要参数的写接口不带请求体（`site.accounts` 输出 22）。
        actOnUser: (id, action) => core.request<AdminUserItem>({method: "POST", path: path(identityPath.adminUserAction(id, action))}),
        setRole: (id, role) => core.request<AdminUserItem>({method: "POST", path: path(identityPath.adminUserAction(id, "role")), body: {role} satisfies RoleRequest}),
        resetPassword: (id) => core.request<ResetPasswordResponse>({method: "POST", path: path(identityPath.adminUserAction(id, "reset-password"))}),
        listRegistrationCodes: (query) => core.request<RegistrationCodeListResponse>({method: "GET", path: withQuery(IDENTITY_PATHS.adminRegistrationCodes, query)}),
        createRegistrationCode: (body) => core.request<RegistrationCodeItem>({method: "POST", path: path(IDENTITY_PATHS.adminRegistrationCodes), body}),
        disableRegistrationCode: (id) => core.request<RegistrationCodeItem>({method: "PATCH", path: path(identityPath.adminRegistrationCode(id)), body: {disabled: true} satisfies PatchRegistrationCodeRequest}),
        listInviteCodes: (query) => core.request<AdminInviteCodeListResponse>({method: "GET", path: withQuery(IDENTITY_PATHS.adminInviteCodes, query)}),
        listAudit: (query) => core.request<AuditListResponse>({method: "GET", path: withQuery(IDENTITY_PATHS.adminAudit, query)}),
        listOAuthClients: (query) => core.request<OAuthClientListResponse>({method: "GET", path: withQuery(IDENTITY_PATHS.adminOAuthClients, query)}),
        createOAuthClient: (body) => core.request<CreateOAuthClientResponse>({method: "POST", path: path(IDENTITY_PATHS.adminOAuthClients), body}),
        patchOAuthClient: (clientId, body) => core.request<OAuthClientItem>({method: "PATCH", path: path(identityPath.adminOAuthClient(clientId)), body}),
        rotateOAuthClientSecret: (clientId) => core.request<RotateSecretResponse>({method: "POST", path: path(identityPath.adminOAuthClientRotate(clientId))}),
    };
}
