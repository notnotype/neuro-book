/**
 * 管理接口的枚举（docs/specs/site/admin.md）：两个列表的筛选项、审计的动作名与对象种类、审计里“操作者是命令行”的写法。
 * schema 在 `./admin`，由这里的数组生成。
 *
 * 这个文件不导入 TypeBox：它经 `./constants` 进浏览器的入口块（`constants.test.ts` 检查）；管理面板按这些数组
 * 画筛选项、取动作的文案。
 */

/** 账号列表的筛选项（参数 `filter`）：全部、管理员、已封禁、邮箱待补。 */
export const USER_FILTERS = ["all", "admin", "banned", "email_pending"] as const;

export type UserFilter = (typeof USER_FILTERS)[number];

/** 注册码列表的筛选项（参数 `filter`）：全部、可用、用完或过期、已停用。 */
export const REGISTRATION_CODE_FILTERS = ["all", "usable", "exhausted_or_expired", "disabled"] as const;

export type RegistrationCodeFilter = (typeof REGISTRATION_CODE_FILTERS)[number];

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
