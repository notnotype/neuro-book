import {useAgentHarness} from "nbook/server/agent/http";
import {listAgentProfileCatalog} from "nbook/server/agent/profiles/profile-http-service";

/**
 * 列出新 Agent Profile catalog，供 TSX Profile 工作台读取。
 */
export default defineEventHandler(async () => {
    return listAgentProfileCatalog(useAgentHarness().profiles);
});
