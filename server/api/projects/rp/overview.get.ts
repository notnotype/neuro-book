import {withRpApiProject} from "nbook/server/rp/api-project";
import {readRpRuntimeOverview} from "nbook/server/rp/runtime-view-store";
import {worldEngineFacadeForWorkspaceRoot} from "nbook/server/world-engine";

/** RP 侧边栏玩家投影聚合；不返回幕后事件、actor 内心或 GM 人设。 */
export default defineEventHandler(async (event) => withRpApiProject(event, async (projectRoot, context) => {
    const subjects = await worldEngineFacadeForWorkspaceRoot(context.workspaceRoot).listSubjects(context.projectPath, {type: "character"}, "rp");
    return readRpRuntimeOverview(projectRoot, subjects);
}));
