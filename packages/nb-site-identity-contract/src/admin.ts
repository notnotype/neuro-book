/**
 * 管理接口的请求与响应（docs/specs/site/admin.md）。分页列表的参数与响应四个列表相同；查询串里的值都是字符串，
 * schema 用 `pattern` 限写法，缺省值与上下限在 `PAGE`。请求（含查询串）都拒收多余的键。
 */

import {Type} from "typebox";
import type {Static, TInteger, TObject, TSchema} from "typebox";

import {InviteCodeItem, RoleSchema, SocialProviderSchema} from "./account";
import {Bio, DECIMAL_ID_PATTERN, DisplayName, Email, Id, LOGIN_IDENTIFIER, RegistrationCodeNote, Username, WebUrl, codePointPattern} from "./fields";
import {literalUnion, nullable, strictObject} from "./schema";
import {IsoTimestamp} from "./time";

/**
 * `anchor`：翻页的基准，取自同一次翻页里上一个响应（输出 9、10）。对调用方是不透明的字符串，原样带回；
 * 这里只限写法：一两个小写字母加一个不超过 15 位的十进制数，数字部分可以是 0（空列表给出的基准也能带回来）。
 * 前缀对不对、是否晚于当前时刻由服务端判，不合同样是 `validation_failed`、`fields: ["anchor"]`。
 */
export const ANCHOR_PATTERN = "^[a-z]{1,2}(?:0|[1-9][0-9]{0,14})$";

export const Anchor = Type.String({pattern: ANCHOR_PATTERN});

/** 分页参数（分页参数表）：`page` 从 1 起，`pageSize` 1 到 100；都可省，缺省见 `PAGE`。 */
const pageQueryProperties = {
    page: Type.Optional(Type.String({pattern: DECIMAL_ID_PATTERN})),
    pageSize: Type.Optional(Type.String({pattern: "^(?:[1-9][0-9]?|100)$"})),
    anchor: Type.Optional(Anchor),
};

/** 账号列表的筛选项（参数 `filter`）：全部、管理员、已封禁、邮箱待补。 */
export const USER_FILTERS = ["all", "admin", "banned", "email_pending"] as const;

export type UserFilter = (typeof USER_FILTERS)[number];

/** 注册码列表的筛选项（参数 `filter`）：全部、可用、用完或过期、已停用。 */
export const REGISTRATION_CODE_FILTERS = ["all", "usable", "exhausted_or_expired", "disabled"] as const;

export type RegistrationCodeFilter = (typeof REGISTRATION_CODE_FILTERS)[number];

/**
 * `GET admin/users`：`q` 是用户名、邮箱、显示名的前缀，`filter` 是一个筛选项。`q` 至多 254 个码点
 * （最长的邮箱），空串等于不搜。
 */
export const UserListQuery = strictObject({
    ...pageQueryProperties,
    q: Type.Optional(Type.String({pattern: codePointPattern(0, LOGIN_IDENTIFIER.maxLength)})),
    filter: Type.Optional(literalUnion(USER_FILTERS)),
});

export type UserListQuery = Static<typeof UserListQuery>;

/** `GET admin/registration-codes`。 */
export const RegistrationCodeListQuery = strictObject({
    ...pageQueryProperties,
    filter: Type.Optional(literalUnion(REGISTRATION_CODE_FILTERS)),
});

export type RegistrationCodeListQuery = Static<typeof RegistrationCodeListQuery>;

/**
 * 只有分页参数、没有搜索与筛选的列表的查询串。`site.oauth-provider` 的客户端列表也用这一套（分页参数表前一句），
 * 它的 `OAuthClientListQuery` 由此而来。
 */
export const PageQuery = strictObject(pageQueryProperties);

export type PageQuery = Static<typeof PageQuery>;

/** `GET admin/invite-codes`：没有筛选项。 */
export const InviteCodeListQuery = strictObject(pageQueryProperties);

export type InviteCodeListQuery = Static<typeof InviteCodeListQuery>;

/** 审计里“操作者是命令行”在查询参数 `actorId` 里的写法（输入与前置条件的接口表）。 */
export const AUDIT_CLI_ACTOR = "cli";

/**
 * 审计动作名（输出 8）。`oauth_client.*` 三个由 t08 写入，现在就列着：前端按枚举取动作的文案。只追加。
 */
export const AUDIT_ACTIONS = [
    "user.ban",
    "user.unban",
    "user.role",
    "user.revoke_sessions",
    "user.reset_password",
    "registration_code.create",
    "registration_code.disable",
    "admin.cli_upsert",
    "oauth_client.create",
    "oauth_client.update",
    "oauth_client.rotate_secret",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** 审计记录的对象种类；`oauth_client` 由 t08 写入。 */
export const AUDIT_TARGET_TYPES = ["user", "registration_code", "oauth_client"] as const;

export type AuditTargetType = (typeof AUDIT_TARGET_TYPES)[number];

/**
 * `GET admin/audit`：按操作者（数字 id，或 `cli`）、对象（`targetType` 加 `targetId`）、动作筛；没有 `counts`
 * （这几项不是枚举的筛选项）。
 */
export const AuditListQuery = strictObject({
    ...pageQueryProperties,
    actorId: Type.Optional(Type.String({pattern: `^(?:${AUDIT_CLI_ACTOR}|${DECIMAL_ID_PATTERN.slice(1, -1)})$`})),
    targetType: Type.Optional(literalUnion(AUDIT_TARGET_TYPES)),
    targetId: Type.Optional(Type.String({pattern: DECIMAL_ID_PATTERN})),
    action: Type.Optional(literalUnion(AUDIT_ACTIONS)),
});

export type AuditListQuery = Static<typeof AuditListQuery>;

const Count = Type.Integer({minimum: 0});

function pageProperties<Item extends TSchema>(item: Item) {
    return {
        items: Type.Array(item),
        total: Count,
        page: Type.Integer({minimum: 1}),
        pageSize: Type.Integer({minimum: 1, maximum: 100}),
        anchor: Anchor,
    };
}

/**
 * 分页列表的响应（分页参数表之后一段）：`total` 是符合当前搜索与筛选、且在基准那一刻已经存在的条数；
 * `anchor` 是这次用的基准，不带 `anchor` 的请求以当时为基准。
 */
export function PageResponse<Item extends TSchema>(item: Item) {
    return strictObject(pageProperties(item));
}

/** 带筛选项的列表另带 `counts`：每个筛选项在当前搜索下各有多少条，键就是筛选项的取值。 */
export function FilteredPageResponse<Item extends TSchema, const Filters extends readonly string[]>(item: Item, filters: Filters) {
    const counts = strictObject(Object.fromEntries(filters.map((filter) => [filter, Count]))) as TObject<{[Filter in Filters[number]]: TInteger}>;
    return strictObject({...pageProperties(item), counts});
}

/** 列表与详情里指向一个账号的引用。 */
export const UserRef = strictObject({id: Id, username: Username});

export type UserRef = Static<typeof UserRef>;

const adminUserProperties = {
    id: Id,
    username: Username,
    displayName: DisplayName,
    email: nullable(Email),
    emailPending: Type.Boolean(),
    role: RoleSchema,
    banned: Type.Boolean(),
    createdAt: IsoTimestamp,
    lastLoginAt: nullable(IsoTimestamp),
};

/**
 * 账号列表的一条（输入与前置条件最后一段）：邮箱待补时 `email` 为 `null` 且 `emailPending` 为真；
 * 没登录过时 `lastLoginAt` 为 `null`。封禁、解封、改角色、结束会话成功时也回这一条（处置之后的状态）。
 */
export const AdminUserItem = strictObject(adminUserProperties);

export type AdminUserItem = Static<typeof AdminUserItem>;

export const UserListResponse = FilteredPageResponse(AdminUserItem, USER_FILTERS);

export type UserListResponse = Static<typeof UserListResponse>;

/** `GET admin/users/:id`：列表那一条加资料、登录方式（是否有密码、关联了哪些上游）、会话数、注册时用的码与邀请人。 */
export const AdminUserDetail = strictObject({
    ...adminUserProperties,
    avatarUrl: nullable(WebUrl),
    website: nullable(WebUrl),
    bio: nullable(Bio),
    hasPassword: Type.Boolean(),
    providers: Type.Array(SocialProviderSchema),
    sessionCount: Count,
    registrationCode: nullable(strictObject({id: Id, code: Type.String()})),
    inviter: nullable(UserRef),
});

export type AdminUserDetail = Static<typeof AdminUserDetail>;

/** `POST admin/users/:id/role`（输出 3、5）。 */
export const RoleRequest = strictObject({role: RoleSchema});

export type RoleRequest = Static<typeof RoleRequest>;

/** `POST admin/users/:id/reset-password`（输出 4）：新密码只在这个响应里出现一次。 */
export const ResetPasswordResponse = strictObject({password: Type.String()});

export type ResetPasswordResponse = Static<typeof ResetPasswordResponse>;

/** 可用次数：正整数，不超过 `Number.MAX_SAFE_INTEGER`；`null` 是不限。 */
const MaxUses = nullable(Type.Integer({minimum: 1, maximum: Number.MAX_SAFE_INTEGER}));

/**
 * 注册码（输出 7）：列表里有码本身、已用次数与是否还能用；`createdBy` 为 `null` 是命令行或导入时找不到人。
 * 发放、改备注或停用成功都回这一项。
 */
export const RegistrationCodeItem = strictObject({
    id: Id,
    code: Type.String(),
    maxUses: MaxUses,
    usedCount: Count,
    expiresAt: nullable(IsoTimestamp),
    note: nullable(RegistrationCodeNote),
    disabled: Type.Boolean(),
    usable: Type.Boolean(),
    createdAt: IsoTimestamp,
    createdBy: nullable(UserRef),
});

export type RegistrationCodeItem = Static<typeof RegistrationCodeItem>;

export const RegistrationCodeListResponse = FilteredPageResponse(RegistrationCodeItem, REGISTRATION_CODE_FILTERS);

export type RegistrationCodeListResponse = Static<typeof RegistrationCodeListResponse>;

/** `POST admin/registration-codes`：码由服务端生成，不可猜（输出 7）。 */
export const CreateRegistrationCodeRequest = strictObject({
    maxUses: MaxUses,
    expiresAt: Type.Optional(nullable(IsoTimestamp)),
    note: Type.Optional(RegistrationCodeNote),
});

export type CreateRegistrationCodeRequest = Static<typeof CreateRegistrationCodeRequest>;

/**
 * `PATCH admin/registration-codes/:id`：改备注（`null` 清空）或停用，至少一项。停用不能撤回，所以 `disabled`
 * 只收 `true`。只改备注不写审计（输出 8）。
 */
export const PatchRegistrationCodeRequest = strictObject(
    {
        note: Type.Optional(nullable(RegistrationCodeNote)),
        disabled: Type.Optional(Type.Literal(true)),
    },
    {minProperties: 1},
);

export type PatchRegistrationCodeRequest = Static<typeof PatchRegistrationCodeRequest>;

/** 全站邀请码列表的一条：自己的邀请码那一项加主人；旧站导入时找不到主人的为 `null`。 */
export const AdminInviteCodeItem = strictObject({...InviteCodeItem.properties, owner: nullable(UserRef)});

export type AdminInviteCodeItem = Static<typeof AdminInviteCodeItem>;

export const AdminInviteCodeListResponse = PageResponse(AdminInviteCodeItem);

export type AdminInviteCodeListResponse = Static<typeof AdminInviteCodeListResponse>;

/**
 * 审计记录（输出 8，副作用与数据）：`actor` 为 `null` 是命令行。`params` 是动作的参数：改角色记旧角色与新角色，
 * 结束会话记条数，发放注册码记可用次数与过期时间；不含密码、码与备注。
 */
export const AuditItem = strictObject({
    id: Id,
    createdAt: IsoTimestamp,
    actor: nullable(UserRef),
    action: literalUnion(AUDIT_ACTIONS),
    target: strictObject({type: literalUnion(AUDIT_TARGET_TYPES), id: Id}),
    params: Type.Record(Type.String(), Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Null()])),
});

export type AuditItem = Static<typeof AuditItem>;

export const AuditListResponse = PageResponse(AuditItem);

export type AuditListResponse = Static<typeof AuditListResponse>;
