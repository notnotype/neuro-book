/**
 * 遮盖服务商错误正文里回显的密钥：有的服务在 401 的错误正文里原样带上收到的认证头，不遮盖就会进日志与帧
 * （搬自 master `redact.ts`）。适配器是唯一的出口：它交回的回复里已经遮盖过。
 */

import {NO_AUTH_SENTINEL} from "@oh-my-pi/pi-ai/auth-retry";

export const REDACTED_KEY = "[REDACTED]";

/** 把文字里出现的每个密钥换成遮盖文字。密钥不论长短都遮盖；“端点不要认证”的占位值不是密钥，不动。 */
export function redactText(text: string, keys: Iterable<string>): string {
    let result = text;
    for (const key of keys) if (key !== "" && key !== NO_AUTH_SENTINEL) result = result.split(key).join(REDACTED_KEY);
    return result;
}

/** 服务商原文交出去之前的上限：错误正文可能很大（网关的 HTML 错误页），整段进帧、诊断与远程响应会撑爆它们。 */
export const PROVIDER_TEXT_LIMIT = 8 * 1024;

/**
 * 服务商的原文（错误正文、检测结果）交出适配器之前：遮盖密钥、去掉控制字符（换行与制表符留下）、遮掉网址里的用户信息与
 * 查询串（有的服务把带令牌的地址原样回显），最后截到 `PROVIDER_TEXT_LIMIT`、在末尾写明截过（这是开发者文字，用英文，ADR 0034）。
 */
export function sanitizeProviderText(text: string, secrets: Iterable<string>): string {
    const cleaned = redactText(text, secrets)
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, "")
        .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/giu, `$1${REDACTED_KEY}@`)
        .replace(/(\bhttps?:\/\/[^\s?#]+)\?[^\s#]*/giu, `$1?${REDACTED_KEY}`);
    if (cleaned.length <= PROVIDER_TEXT_LIMIT) return cleaned;
    return `${cleaned.slice(0, PROVIDER_TEXT_LIMIT)}… (truncated, ${String(cleaned.length)} chars in total)`;
}
