import {useAgentHarness} from "nbook/server/agent/http";
import {readConfigAgentProfileBuildStatus} from "nbook/server/config/config-service";
import {createServerTiming} from "nbook/server/utils/server-timing";

/**
 * 读取 Agent Profile 编译/加载状态。
 */
export default defineEventHandler(async (event) => {
    const timing = createServerTiming(event);
    return timing.measure("agent.profileBuildStatus", () => {
        return readConfigAgentProfileBuildStatus(useAgentHarness().profiles);
    });
});
