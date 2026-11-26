/**
 * 对外 OAuth 客户端密钥的生成与存法（`site.oauth-provider` 副作用与数据一节：库里只存密钥的哈希）。库在登记客户端时调
 * `generateClientSecret` 发密钥、调 `clientSecretHash` 存哈希；换码时对客户端带来的密钥再调一次 `clientSecretHash`，与存的值做
 * 定长比较（`auth.ts` 的 `storeClientSecret: {hash}`，只给 `hash`、不给 `verify` 时库就这样认）。自家换密钥（计划 3.9）也用这两个
 * 函数，存出来的与库登记时的同一种格式。
 *
 * 为什么不用库缺省的存法：库缺省也是 SHA-256，但格式归库管，库改了缺省，已登记的客户端全都换不了码。这里自己定格式，库升级不碰它。
 * 前面拼一段固定的前缀（域分隔），存出来的值与库缺省的存法不同：库哪天不再调这个函数、改回缺省的哈希时，已有客户端的换码直接
 * `invalid_client`，包内用例能抓到（升级清单“`storeClientSecret: {hash}`”一行）。
 *
 * 用快速哈希、不加盐：密钥是 32 字节的随机数，不是人记的口令，没有字典可猜，慢哈希与盐挡的东西在这里不存在。
 */

import {createHash, randomBytes} from "node:crypto";

/** 域分隔前缀。改它等于换存法：已登记客户端的密钥全部失效。 */
const HASH_DOMAIN = "nb-site-identity/oauth-client-secret/v1\0";

/** 客户端密钥存进 `oauthClient.clientSecret` 的值：前缀加密钥的 SHA-256，base64url、不带填充。 */
export function clientSecretHash(secret: string): string {
    return createHash("sha256").update(HASH_DOMAIN, "utf8").update(secret, "utf8").digest("base64url");
}

/** 新的客户端密钥：32 字节随机数的 base64url。库要求同步返回。 */
export function generateClientSecret(): string {
    return randomBytes(32).toString("base64url");
}
