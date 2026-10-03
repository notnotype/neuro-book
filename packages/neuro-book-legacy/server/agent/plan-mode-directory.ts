import type {ReadyProjectSessionRef} from "nbook/profile-sdk/contracts";

/**
 * Plan Mode 目录的纯路径逻辑。
 *
 * 单独成模块的原因：profile artifact 依赖图会包含本模块；`plan-mode-path.ts`
 * 顶层引用 session-file-scope → project-workspace（@libsql/client 值导入），
 * 那条链不允许进 artifact。这里只允许类型导入与 node 内置模块。
 */

/**
 * Project Workspace 内 Plan Mode 计划目录的固定相对路径。
 */
export const PLAN_MODE_DIRECTORY = ".agent/plan";

export type PlanModeLocationInput = {
    workspaceRoot: string;
    currentProject: ReadyProjectSessionRef | null;
};

/**
 * 返回 Agent 文件工具可使用的 Plan Mode 目录路径。
 */
export function planModeToolDirectory(input: PlanModeLocationInput): string {
    return PLAN_MODE_DIRECTORY;
}
