import {join, normalize} from "node:path";
import {absoluteFsPath, relativeFilePathInside} from "nbook/server/runtime/paths/file-path";
import {PLAN_MODE_DIRECTORY, type PlanModeLocationInput} from "nbook/server/agent/plan-mode-directory";

// 纯路径部分（常量与工具目录投影）在 plan-mode-directory.ts；
// 这里保留需要 exact Project handle 的宿主侧解析逻辑，并 re-export 保持 API 不变。
export {PLAN_MODE_DIRECTORY, planModeToolDirectory, type PlanModeLocationInput} from "nbook/server/agent/plan-mode-directory";

/**
 * 返回当前 Project Workspace 的 Plan Mode 计划目录。
 */
export function planModeDirectory(input: PlanModeLocationInput): string {
    return join(planModeProjectRoot(input), ".agent", "plan");
}

/**
 * 将计划文件路径解析为 Project Workspace 内的安全 Markdown 文件。
 */
export function resolvePlanModeFile(input: PlanModeLocationInput & {planFilePath: string}): {
    displayPath: string;
    absolutePath: string;
} {
    const normalizedInput = input.planFilePath.trim().replace(/\\/g, "/");
    if (!normalizedInput) {
        throw new Error("switch_mode planFilePath cannot be empty.");
    }
    if (normalizedInput.startsWith("/") || /^[A-Za-z]:\//.test(normalizedInput)) {
        throw new Error("switch_mode planFilePath must be relative to the Project Workspace.");
    }
    if (normalizedInput.split("/").includes("..")) {
        throw new Error("switch_mode planFilePath cannot contain '..'.");
    }
    if (!normalizedInput.toLowerCase().endsWith(".md")) {
        throw new Error("switch_mode planFilePath must point to a Markdown .md file.");
    }

    const projectRoot = planModeProjectRoot(input);
    const planRoot = normalize(planModeDirectory(input));
    const absolutePath = normalize(join(projectRoot, normalizedInput));
    const relativeToPlanRoot = relativeFilePathInside(absoluteFsPath(planRoot), absoluteFsPath(absolutePath));
    if (!relativeToPlanRoot || relativeToPlanRoot === ".") {
        throw new Error(`switch_mode planFilePath must stay inside ${PLAN_MODE_DIRECTORY}/.`);
    }

    return {
        displayPath: normalizedInput,
        absolutePath,
    };
}

function planModeProjectRoot(input: PlanModeLocationInput): string {
    return input.currentProject?.workspace.root ?? input.workspaceRoot;
}
