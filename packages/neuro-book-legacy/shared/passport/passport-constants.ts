// Passport 客户端共享常量（Task 112 spec §11）。

/** v1 唯一账号槽位；表结构已带 slotId，将来做多槽位切换不迁移 */
export const DEFAULT_SLOT_ID = "default";

/** 实例申请的 scope 全集：v1 实例功能就是发布 + 备份 */
export const REQUESTED_SCOPES = ["workshop:publish", "backup:read", "backup:write"] as const;

/** NeuroBook 唯一可信官方站；实例侧不接受用户提供的上游地址。 */
export const OFFICIAL_PASSPORT_SITE_URL = "https://nbook.notnotype.com";
