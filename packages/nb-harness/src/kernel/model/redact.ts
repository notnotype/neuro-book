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
