import {prepareSystemAssets} from "nbook/server/workspace-files/system-assets-preflight";
import {useAgentHarness} from "nbook/server/agent/http";

/**
 * 准备最新系统 assets 后同步到用户 assets。
 */
export default defineEventHandler(async () => {
    const harness = useAgentHarness();
    const result = await prepareSystemAssets({
        syncUserAssets: true,
        profileRelease: {
            mode: "in_process",
            registry: harness.profiles,
        },
    });
    return result.userAssetsSync;
});
