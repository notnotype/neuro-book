/**
 * 组件测试里管理面板列表的数据：几种条目的造法与按查询参数切一页的回答，类型都取合同包，写错形状类型检查不过。
 * 浏览器场景另有一份（`e2e/fixtures/identity.ts` 与 `e2e/fake-api.ts`），两边各自准备数据，页面不导入任何一份。
 *
 * 只给测试导入；产品代码不导入它，所以不进构建产物。
 */

import {IDENTITY_API_PREFIX, IDENTITY_PATHS, PAGE} from "@notnotype/nb-site-identity-contract/constants";
import type {
    AdminInviteCodeItem,
    AdminInviteCodeListResponse,
    AdminUserItem,
    AuditItem,
    AuditListResponse,
    OAuthClientItem,
    OAuthClientListResponse,
    RegistrationCodeFilter,
    RegistrationCodeItem,
    RegistrationCodeListResponse,
    UserFilter,
    UserListResponse,
} from "@notnotype/nb-site-identity-contract/constants";

/** 用例里服务端回的基准。合同只要求它是一个前缀字母加数字，页面原样带回。 */
export const ANCHOR = "t1764151200000";

const url = (relative: string): string => `${IDENTITY_API_PREFIX}${relative}`;

export const ADMIN_LIST_URLS = {
    users: url(IDENTITY_PATHS.adminUsers),
    registrationCodes: url(IDENTITY_PATHS.adminRegistrationCodes),
    inviteCodes: url(IDENTITY_PATHS.adminInviteCodes),
    audit: url(IDENTITY_PATHS.adminAudit),
    oauthClients: url(IDENTITY_PATHS.adminOAuthClients),
} as const;

const NO_USERS: UserListResponse["counts"] = {all: 0, admin: 0, banned: 0, email_pending: 0};
const NO_CODES: RegistrationCodeListResponse["counts"] = {all: 0, usable: 0, exhausted_or_expired: 0, disabled: 0};

function emptyPage(): {items: never[]; total: number; page: number; pageSize: number; anchor: string} {
    return {items: [], total: 0, page: PAGE.defaultPage, pageSize: PAGE.defaultPageSize, anchor: ANCHOR};
}

/** 管理员打开管理面板的列表页、用例又不在乎列表时，装置回的空列表（`site-harness.ts`）。键是不带查询串的路径。 */
export const EMPTY_ADMIN_LISTS: ReadonlyMap<string, unknown> = new Map<string, unknown>([
    [ADMIN_LIST_URLS.users, {...emptyPage(), counts: NO_USERS} satisfies UserListResponse],
    [ADMIN_LIST_URLS.registrationCodes, {...emptyPage(), counts: NO_CODES} satisfies RegistrationCodeListResponse],
    [ADMIN_LIST_URLS.inviteCodes, emptyPage() satisfies AdminInviteCodeListResponse],
    [ADMIN_LIST_URLS.audit, emptyPage() satisfies AuditListResponse],
    [ADMIN_LIST_URLS.oauthClients, emptyPage() satisfies OAuthClientListResponse],
]);

export function adminUser(id: number, overrides: Partial<AdminUserItem> = {}): AdminUserItem {
    return {
        id,
        username: `user${id}`,
        displayName: `用户 ${id}`,
        email: `user${id}@example.com`,
        emailPending: false,
        role: "user",
        banned: false,
        createdAt: "2026-11-01T08:00:00.000Z",
        lastLoginAt: "2026-11-20T08:00:00.000Z",
        ...overrides,
    };
}

export function registrationCode(id: number, overrides: Partial<RegistrationCodeItem> = {}): RegistrationCodeItem {
    return {
        id,
        code: `REG-${String(id).padStart(4, "0")}-ABCD`,
        maxUses: 5,
        usedCount: 1,
        expiresAt: null,
        note: null,
        disabled: false,
        usable: true,
        createdAt: "2026-11-02T08:00:00.000Z",
        createdBy: {id: 7, username: "alice"},
        ...overrides,
    };
}

export function inviteCode(id: number, overrides: Partial<AdminInviteCodeItem> = {}): AdminInviteCodeItem {
    return {
        id,
        code: `INV-${String(id).padStart(4, "0")}-WXYZ`,
        createdAt: "2026-11-03T08:00:00.000Z",
        usedCount: 0,
        maxUses: null,
        expiresAt: null,
        usable: true,
        owner: {id: 8, username: "bob"},
        ...overrides,
    };
}

export function oauthClient(id: number, overrides: Partial<OAuthClientItem> = {}): OAuthClientItem {
    return {
        id,
        clientId: `client${String(id).padStart(4, "0")}AbCdEfGhIjKlMnOpQrStUv`,
        name: `应用 ${id}`,
        redirectUris: [`https://app${id}.example.com/callback`],
        type: "confidential",
        skipConsent: false,
        disabled: false,
        createdAt: "2026-11-04T08:00:00.000Z",
        ...overrides,
    };
}

export function auditItem(id: number, overrides: Partial<AuditItem> = {}): AuditItem {
    return {
        id,
        createdAt: "2026-11-25T08:00:00.000Z",
        actor: {id: 7, username: "alice"},
        action: "user.ban",
        target: {type: "user", id: 12},
        params: {},
        ...overrides,
    };
}

/** 一页：按查询参数的 `page`、`pageSize` 切 `items`（没给时按合同的缺省）。`total` 是 `items` 的条数。 */
export function pageOf<Item>(items: readonly Item[], query: URLSearchParams): {items: Item[]; total: number; page: number; pageSize: number; anchor: string} {
    const page = Number(query.get("page") ?? PAGE.defaultPage);
    const pageSize = Number(query.get("pageSize") ?? PAGE.defaultPageSize);
    return {items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length, page, pageSize, anchor: query.get("anchor") ?? ANCHOR};
}

/** 账号列表的各筛选项条数，没写的为 0。 */
export function userCounts(counts: Partial<Record<UserFilter, number>>): UserListResponse["counts"] {
    return {...NO_USERS, ...counts};
}

/** 注册码列表的各筛选项条数，没写的为 0。 */
export function codeCounts(counts: Partial<Record<RegistrationCodeFilter, number>>): RegistrationCodeListResponse["counts"] {
    return {...NO_CODES, ...counts};
}
