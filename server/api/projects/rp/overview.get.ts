import {withRpApiProject} from "nbook/server/rp/api-project";
import {readRpRuntimeOverview} from "nbook/server/rp/runtime-view-store";
import {worldEngineFacadeForWorkspaceRoot} from "nbook/server/world-engine";

/** RP 侧边栏玩家投影聚合；不返回幕后事件、actor 内心或 GM 人设。 */
export default defineEventHandler(async (event) => withRpApiProject(event, async (projectRoot, context) => {
    const worldEngine = worldEngineFacadeForWorkspaceRoot(context.workspaceRoot);
    const status = await worldEngine.getWorldStatus(context.projectPath, "rp");
    // RP 的独立 Schema 与 Calendar 只会在开团企划确认后的 Bootstrap config 阶段生成。
    // 引导期缺少 rp/world-engine/ 是正常状态，此时 overview 仍需返回企划与运行侧栏数据。
    const subjects = status.initialized
        ? await worldEngine.listSubjects(context.projectPath, {type: "character"}, "rp")
        : [];
    return readRpRuntimeOverview(projectRoot, subjects);
}));
