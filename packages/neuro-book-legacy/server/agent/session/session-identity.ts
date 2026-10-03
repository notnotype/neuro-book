import {createHash, randomUUID} from "node:crypto";
import type {JsonValue} from "nbook/server/agent/messages/types";
import type {SessionMetadata} from "nbook/server/agent/session/types";
import {AgentSessionIdentitySchema, type AgentSessionIdentity} from "nbook/shared/dto/agent-session.dto";

const IDENTITY_PREFIX = "neuro-book:agent-session:v1\u0000";

/** 为新建 Session 生成不会因数字序号冲突的逻辑身份。 */
export function createSessionIdentity(): AgentSessionIdentity {
    return randomUUID();
}

/**
 * 为没有持久化身份字段的现有 header 生成稳定身份。
 * 只使用 header，不使用正文、文件路径或当前 project 投影，因此追加历史不会改变结果。
 */
export function deriveSessionIdentity(metadata: Omit<SessionMetadata, "sessionIdentity">): AgentSessionIdentity {
    const payload = {...metadata} as Omit<SessionMetadata, "sessionIdentity"> & {sessionIdentity?: AgentSessionIdentity};
    delete payload.sessionIdentity;
    const canonical = stableJson(payload as unknown as JsonValue);
    return `sha256:${createHash("sha256").update(`${IDENTITY_PREFIX}${canonical}`, "utf8").digest("hex")}`;
}

/** 读取现有 metadata 后得到运行时必有的 Session identity。 */
export function resolveSessionIdentity(metadata: SessionMetadata): AgentSessionIdentity {
    if (metadata.sessionIdentity !== undefined) {
        const parsed = AgentSessionIdentitySchema.safeParse(metadata.sessionIdentity);
        if (!parsed.success) {
            throw new Error("Agent Session identity 格式非法。");
        }
        return parsed.data;
    }
    return deriveSessionIdentity(metadata);
}

/** 递归排序 object key，且与 JSON.stringify 一样忽略 object 中的 undefined。 */
function stableJson(value: JsonValue | undefined): string {
    if (value === undefined) return "null";
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map((item) => stableJson(item)).join(",")}]`;
    }
    return `{${Object.keys(value).sort().flatMap((key) => {
        const child = value[key];
        return child === undefined ? [] : [`${JSON.stringify(key)}:${stableJson(child)}`];
    }).join(",")}}`;
}
