import {getQuery} from "h3";
import {useAgentHarness} from "nbook/server/agent/http";
import {readConfigAgentProfileSettings} from "nbook/server/config/config-service";
import {validateConfigAgentProfileSettingsQuery} from "nbook/server/config/query";
import {createServerTiming} from "nbook/server/utils/server-timing";
import {withProjectHttpError} from "nbook/server/api/projects/project-http-error";

/**
 * 读取 Agent Profile settings 专用快照。
 */
export default defineEventHandler((event) => withProjectHttpError(async () => {
    const timing = createServerTiming(event);
    return timing.measure("agent.profileSettings", () => {
        const query = validateConfigAgentProfileSettingsQuery(getQuery(event));
        return readConfigAgentProfileSettings(query, useAgentHarness().profiles, {
            agentProfileSettingsScope: query.scope,
        });
    });
}));
