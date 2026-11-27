/**
 * 账号的角色与上游名（docs/specs/site/accounts.md、admin.md 的术语）。schema 在 `./account`，由这里的数组生成。
 *
 * 这个文件不导入 TypeBox：它经 `./constants` 进浏览器的入口块（`constants.test.ts` 检查）。
 */

/** 账号的角色（`site.admin` 术语：管理员是角色为 `admin` 的用户）。 */
export const ROLES = ["user", "admin"] as const;

export type Role = (typeof ROLES)[number];

/** 上游（术语“上游”）。社交登录本身归 t08，上游名在这里是因为上游身份列表与管理详情都要它。 */
export const SOCIAL_PROVIDERS = ["google", "github"] as const;

export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];
