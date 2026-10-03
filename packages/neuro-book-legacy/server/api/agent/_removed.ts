import {createError} from "h3";

/**
 * 旧 Agent v2 HTTP API 已在 Pi Agent Harness 迁移中移除。
 */
export function throwAgentV2Removed(): never {
    throw createError({
        statusCode: 501,
        statusMessage: "Agent v2 API removed",
        message: "旧 /api/agent 接口已移除；后续前端会统一迁移到新的 Agent session/invocation API。",
    });
}
