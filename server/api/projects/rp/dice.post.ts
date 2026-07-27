import {requireProjectPathQuery} from "nbook/server/utils/novel-chapter";
import {assertProjectWorkspaceDirectory} from "nbook/server/workspace-files/project-workspace";
import {resolveProjectWorkspaceRoot} from "nbook/server/workspace-files/project-path";
import {runtimePathsFromEnv} from "nbook/server/runtime/paths/runtime-paths";
import {assertProjectOpen, markProjectActivity, ProjectNotOpenError} from "nbook/server/workspace-files/project-session";
import {createProjectNotOpenHttpError} from "nbook/server/workspace-files/project-open-guard";
import {rollDice} from "nbook/server/rp/dice-store";

/**
 * RP 模式掷骰：用户点击前端骰子按钮触发。服务端 crypto RNG 掷 2d6，
 * 追加写入项目 rp/dice/rolls.jsonl（agent 读取的唯一真相源）并返回本次结果。
 */
export default defineEventHandler(async (event) => {
    try {
        const workspaceRoot = runtimePathsFromEnv().workspaceRoot;
        const projectPath = await assertProjectWorkspaceDirectory(workspaceRoot, requireProjectPathQuery(event));
        assertProjectOpen(projectPath);
        markProjectActivity(projectPath);
        const projectRoot = resolveProjectWorkspaceRoot(workspaceRoot, projectPath);
        return await rollDice(projectRoot);
    } catch (error) {
        if (error instanceof ProjectNotOpenError) {
            throw createProjectNotOpenHttpError(error);
        }
        throw error;
    }
});
