import {throwAgentV2Removed} from "nbook/server/api/agent/_removed";

/**
 * 旧 Agent v2 API 已移除，等待前端迁移到新 session/invocation API。
 */
export default defineEventHandler(() => {
    throwAgentV2Removed();
});