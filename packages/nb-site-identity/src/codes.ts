/**
 * 注册码与邀请码共用的规则（w00037 t07 计划 3.9 的“码的比对”与 3.10 的发放）：生成、请求里的码怎样比对、“还能用”的条件。
 * 两张表（`identity_registration_code`、`identity_invite_code`）判“还能用”的列相同，条件写在这里一份，注册时的扣减、管理列表的
 * 筛选与 `usable` 都用它，不各写一遍。
 */

import {randomBytes} from "node:crypto";

/** Crockford base32 的字母表：去掉了易混的 I、L、O、U。 */
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** 新码的随机字节数：80 位，正好 16 个 base32 字符。 */
const CODE_BYTES = 10;

/** 生成一个新码：16 个字符的 Crockford base32（`site.admin` 输出 7 的“不可猜”，`site.accounts` 输出 18）。 */
export function generateCode(): string {
    const bytes = randomBytes(CODE_BYTES);
    let bits = 0;
    let value = 0;
    let code = "";
    for (const byte of bytes) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            bits -= 5;
            code += CROCKFORD[(value >> bits) & 31];
        }
        // 只留还没用掉的低位，免得 value 越移越大、超出 32 位整数。
        value &= (1 << bits) - 1;
    }
    return code;
}

/**
 * 请求里给的码怎样与存的比：去掉首尾空白后按原文精确比对，不转大小写（计划 3.9）。新生成的码只有大写字母与数字，旧站导入的码保留
 * 原样（`site.legacy-import`），转大小写会让两个导入的码撞在一起。
 */
export function codeInput(raw: string): string {
    return raw.trim();
}

/**
 * “还能用”的 SQL 条件：没停用、没过期、没用完。`table` 是表名或别名；条件里有一个 `?`，绑定现在的时间（库的时间写法，
 * `libDate`）。时间按文字比：存的与绑定的都是同一种到毫秒的 UTC 写法，文字的先后就是时间的先后。
 */
export function usableCodeSql(table: string): string {
    return `${table}.disabled_at IS NULL AND (${table}.expires_at IS NULL OR ${table}.expires_at > ?) AND (${table}.max_uses IS NULL OR ${table}.used_count < ${table}.max_uses)`;
}
