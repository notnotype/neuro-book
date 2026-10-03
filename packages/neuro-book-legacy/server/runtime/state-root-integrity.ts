import {lstat, realpath} from "node:fs/promises";
import path from "node:path";
import {absoluteFsPath, type AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";

type StateRootIntegrityBase = Readonly<{
    installationRoot: AbsoluteFsPath;
    stateRoot: AbsoluteFsPath;
    expectedWorkspaceRoot: AbsoluteFsPath;
}>;

/** State Root与Installation Root相同，不需要影子Workspace检查。 */
export type SameStateRootIntegrity = StateRootIntegrityBase & Readonly<{
    kind: "same-state-root";
}>;

/** Installation Root下没有额外Workspace Root。 */
export type CleanStateRootIntegrity = StateRootIntegrityBase & Readonly<{
    kind: "clean";
    checkedWorkspaceRoot: AbsoluteFsPath;
}>;

/** Installation Root下的链接最终指向真实Workspace Root。 */
export type SameTargetWorkspaceIntegrity = StateRootIntegrityBase & Readonly<{
    kind: "same-target-link";
    checkedWorkspaceRoot: AbsoluteFsPath;
    realWorkspaceRoot: AbsoluteFsPath;
}>;

/** Installation Root下存在与真实Workspace Root分叉的数据目录。 */
export type ShadowWorkspaceIntegrity = StateRootIntegrityBase & Readonly<{
    kind: "shadow-workspace";
    checkedWorkspaceRoot: AbsoluteFsPath;
    checkedRealPath: AbsoluteFsPath;
    expectedRealPath: AbsoluteFsPath;
}>;

/** 检查过程中遇到失效链接、权限或其他文件系统错误。 */
export type StateRootInspectionError = StateRootIntegrityBase & Readonly<{
    kind: "inspection-error";
    checkedWorkspaceRoot: AbsoluteFsPath;
    operation: "lstat" | "realpath-checked" | "realpath-expected";
    errorPath: AbsoluteFsPath;
    /** null表示底层错误没有稳定code。 */
    errorCode: string | null;
    errorMessage: string;
}>;

/** State Root与Installation Root的Workspace完整性结果。 */
export type StateRootIntegrityResult =
    | SameStateRootIntegrity
    | CleanStateRootIntegrity
    | SameTargetWorkspaceIntegrity
    | ShadowWorkspaceIntegrity
    | StateRootInspectionError;

/** 需要doctor失败或启动警告的State Root完整性结果。 */
export type StateRootIntegrityFailure = ShadowWorkspaceIntegrity | StateRootInspectionError;

/**
 * 检查Installation Root下是否存在错误或无法验证的影子Workspace Root。
 *
 * 本Module只读取文件系统，不创建、复制、合并、删除或重命名用户数据。
 */
export async function inspectStateRootIntegrity(input: {
    installationRoot: AbsoluteFsPath;
    stateRoot: AbsoluteFsPath;
}): Promise<StateRootIntegrityResult> {
    const installationRoot = absoluteFsPath(path.resolve(input.installationRoot));
    const stateRoot = absoluteFsPath(path.resolve(input.stateRoot));
    const expectedWorkspaceRoot = absoluteFsPath(path.join(stateRoot, "workspace"));
    const base = {installationRoot, stateRoot, expectedWorkspaceRoot};
    if (pathKey(installationRoot) === pathKey(stateRoot)) {
        return {kind: "same-state-root", ...base};
    }

    const checkedWorkspaceRoot = absoluteFsPath(path.join(installationRoot, "workspace"));
    try {
        await lstat(checkedWorkspaceRoot);
    } catch (error) {
        if (errorCode(error) === "ENOENT") {
            return {kind: "clean", ...base, checkedWorkspaceRoot};
        }
        return inspectionError(base, checkedWorkspaceRoot, "lstat", checkedWorkspaceRoot, error);
    }

    const checkedRealPath = await resolveRealPath(base, checkedWorkspaceRoot, "realpath-checked");
    if (checkedRealPath.kind === "inspection-error") {
        return checkedRealPath;
    }
    const expectedRealPath = await resolveRealPath(base, checkedWorkspaceRoot, "realpath-expected", expectedWorkspaceRoot);
    if (expectedRealPath.kind === "inspection-error") {
        return expectedRealPath;
    }
    if (pathKey(checkedRealPath.path) === pathKey(expectedRealPath.path)) {
        return {
            kind: "same-target-link",
            ...base,
            checkedWorkspaceRoot,
            realWorkspaceRoot: checkedRealPath.path,
        };
    }
    return {
        kind: "shadow-workspace",
        ...base,
        checkedWorkspaceRoot,
        checkedRealPath: checkedRealPath.path,
        expectedRealPath: expectedRealPath.path,
    };
}

/** 判断完整性结果是否需要doctor失败或启动警告。 */
export function stateRootIntegrityFailed(result: StateRootIntegrityResult): result is StateRootIntegrityFailure {
    return result.kind === "shadow-workspace" || result.kind === "inspection-error";
}

async function resolveRealPath(
    base: StateRootIntegrityBase,
    checkedWorkspaceRoot: AbsoluteFsPath,
    operation: "realpath-checked" | "realpath-expected",
    target: AbsoluteFsPath = checkedWorkspaceRoot,
): Promise<{kind: "resolved"; path: AbsoluteFsPath} | StateRootInspectionError> {
    try {
        return {kind: "resolved", path: absoluteFsPath(await realpath(target))};
    } catch (error) {
        return inspectionError(base, checkedWorkspaceRoot, operation, target, error);
    }
}

function inspectionError(
    base: StateRootIntegrityBase,
    checkedWorkspaceRoot: AbsoluteFsPath,
    operation: StateRootInspectionError["operation"],
    errorPath: AbsoluteFsPath,
    error: unknown,
): StateRootInspectionError {
    return {
        kind: "inspection-error",
        ...base,
        checkedWorkspaceRoot,
        operation,
        errorPath,
        errorCode: errorCode(error),
        errorMessage: error instanceof Error ? error.message : String(error),
    };
}

function errorCode(error: unknown): string | null {
    return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
        ? error.code
        : null;
}

function pathKey(filePath: string): string {
    const normalized = path.resolve(filePath).replaceAll("\\", "/").replace(/\/+$/g, "");
    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
