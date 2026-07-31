import {z} from "zod";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {openProject} from "nbook/server/workspace-files/project-session";
import {readProjectWorkspaceTreeSnapshot} from "nbook/server/workspace-files/project-workspace-index";
import {openProjectHistoryAndMaintain} from "nbook/server/workspace-history/project-history";
import {runtimePathsFromEnv} from "nbook/server/runtime/paths/runtime-paths";
import {normalizeProjectPath} from "nbook/server/workspace-files/project-path";
import {resolveNovelWorkspaceTarget} from "nbook/server/workspace-files/novel-workspace";
import {auditRpOnProjectOpen} from "nbook/server/rp/consistency-store";

const OpenProjectBodySchema = z.object({
    projectPath: z.string().trim().min(1, "projectPath 不能为空"),
});

/**
 * 显式打开 Project 会话（Task 94）。
 * openProject 内部完成目录校验（404）与数据库迁移收敛；未 open 前数据面接口会以 409 拒绝。
 */
export default defineEventHandler(async (event) => {
    const body = await validateBody(event, OpenProjectBodySchema);
    const runtimePaths = runtimePathsFromEnv();
    const projectPath = normalizeProjectPath(body.projectPath);
    const target = await resolveNovelWorkspaceTarget(runtimePaths, projectPath);
    await openProject(runtimePaths.workspaceRoot, target.projectPath, {kind: "user"});
    // D11：open 即预热 tree watcher（fire-and-forget，不阻塞响应，失败静默——首个 tree 请求会自然重建）。
    // 预热放在路由层而非 project-session 内部，避免 project-session 与 project-workspace-index 循环 import。
    void readProjectWorkspaceTreeSnapshot({target}).catch(() => undefined);
    // Task 95 D13/D14/D15：预热 history 库 + closed 期间外部变更对账扫描 + 24h 维护（同样 fire-and-forget）。
    void openProjectHistoryAndMaintain(target.root, target.projectPath).catch(() => undefined);
    // P9：RP 项目打开后在后台运行 standard 审计；问题写入状态页，不阻塞普通项目打开。
    void auditRpOnProjectOpen(target.root).catch(() => undefined);
    return {success: true};
});
