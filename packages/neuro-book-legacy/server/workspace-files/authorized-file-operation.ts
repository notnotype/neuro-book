import path from "node:path";
import {
    absoluteFsPath,
    assertRealPathContained,
    relativeFilePathInside,
    relativeRealPathInside,
    resolveContainedFilePath,
    type AbsoluteFsPath,
} from "nbook/server/runtime/paths/file-path";
import {projectWorkspaceRef} from "nbook/server/workspace-files/project-identity";
import {
    ProjectNotOpenError,
    requireActiveReadyProject,
} from "nbook/server/runtime/product-project";
import type {ReadyProjectSessionRef} from "nbook/server/workspace-files/project-session-types";

/** Agent 文件操作的能力种类；所有数据面操作都使用同一授权边界。 */
export type AuthorizedFileOperation = "read" | "write" | "edit" | "apply_patch";

/** RunFrame 与工具上下文提供的完整文件定位能力。 */
export type FileOperationContext = Readonly<{
    workspaceRoot: AbsoluteFsPath;
    currentProject: ReadyProjectSessionRef | null;
}>;

/** 已解析并捕获 exact Project generation 的文件目标。 */
export type ResolvedFileTarget = Readonly<{
    kind: "relative" | "project" | "workspace-control" | "absolute";
    absolutePath: AbsoluteFsPath;
    /** null 表示该目标不携带 Project 领域归属。 */
    project: ReadyProjectSessionRef | null;
    /** Project 相对路径或 Workspace Root `.nbook` 内的相对路径。 */
    relativePath?: string;
}>;

/** 已完成领域解析、Project 生命周期和真实路径检查的文件操作目标。 */
export type AuthorizedFileTarget = Readonly<{
    operation: AuthorizedFileOperation;
    target: ResolvedFileTarget;
    /** null 表示绝对地址直接受宿主文件系统权限约束。 */
    containmentRoot: AbsoluteFsPath | null;
}>;

/**
 * 授权一次文件操作。
 *
 * 普通相对路径以 Current Project Workspace 为根；无 Current Project 时以
 * Workspace Root 为根。`workspace/<project>/<relative-path>` 只是一条跨 Project
 * 输入语法，解析结果直接携带 exact ready generation，不再产生 Project Path 身份。
 */
export async function authorizeFileOperation(
    context: FileOperationContext,
    inputPath: string,
    operation: AuthorizedFileOperation,
): Promise<AuthorizedFileTarget> {
    const currentProject = currentReadyProject(context.currentProject);
    const normalizedInput = inputPath.trim().replaceAll("\\", "/");
    if (!normalizedInput) {
        throw new Error("文件路径不能为空");
    }

    const resolved = await resolveFileTarget(context.workspaceRoot, currentProject, normalizedInput);
    if (resolved.containmentRoot) {
        await assertRealPathContained(resolved.containmentRoot, resolved.target.absolutePath);
    }
    return {
        operation,
        target: resolved.target,
        containmentRoot: resolved.containmentRoot,
    };
}

/** 授权受信任进程使用本次 session 的 cwd。 */
export async function authorizeProcessCwd(
    context: FileOperationContext,
): Promise<Readonly<{root: AbsoluteFsPath}>> {
    const currentProject = currentReadyProject(context.currentProject);
    const root = currentProject?.workspace.root ?? context.workspaceRoot;
    await assertRealPathContained(root, root);
    return {root};
}

/** 确认 admission 捕获的 handle 仍是当前 exact ready generation。 */
function currentReadyProject(
    currentProject: ReadyProjectSessionRef | null,
): ReadyProjectSessionRef | null {
    if (!currentProject) {
        return null;
    }
    const ready = requireActiveReadyProject(currentProject.workspace.ref);
    if (ready !== currentProject) {
        throw new ProjectNotOpenError(currentProject.workspace.ref.projectRoot);
    }
    return ready;
}

/** 将用户输入解析成绝对目标，并在 Project 地址上捕获 exact generation。 */
async function resolveFileTarget(
    workspaceRoot: AbsoluteFsPath,
    currentProject: ReadyProjectSessionRef | null,
    inputPath: string,
): Promise<Readonly<{target: ResolvedFileTarget; containmentRoot: AbsoluteFsPath | null}>> {
    if (path.isAbsolute(inputPath)) {
        const absolutePath = absoluteFsPath(inputPath);
        const relativePath = currentProject
            ? await relativeRealPathInside(currentProject.workspace.root, absolutePath)
            : null;
        if (currentProject && relativePath && relativePath !== ".") {
            return {
                target: {kind: "absolute", absolutePath, project: currentProject, relativePath},
                containmentRoot: currentProject.workspace.root,
            };
        }
        return {
            target: {kind: "absolute", absolutePath, project: null},
            containmentRoot: null,
        };
    }

    const segments = inputPath.split("/");
    if (segments[0] === "workspace") {
        if (segments.some((segment) => segment.length === 0) || segments.length < 3) {
            throw new Error("跨 Project 路径必须使用 workspace/<project>/<relative-path>");
        }
        if (segments[1] === ".nbook") {
            const controlRoot = resolveContainedFilePath(workspaceRoot, ".nbook");
            const relativePath = segments.slice(2).join("/");
            return {
                target: {
                    kind: "workspace-control",
                    absolutePath: resolveContainedFilePath(controlRoot, relativePath),
                    project: null,
                    relativePath,
                },
                containmentRoot: controlRoot,
            };
        }

        const project = requireActiveReadyProject(projectWorkspaceRef(segments[1]!));
        const absolutePath = resolveContainedFilePath(project.workspace.root, segments.slice(2).join("/"));
        const relativePath = relativeFilePathInside(project.workspace.root, absolutePath);
        if (!relativePath || relativePath === ".") {
            throw new Error("跨 Project 路径必须指向 Project Workspace 内的文件或目录项");
        }
        return {
            target: {kind: "project", absolutePath, project, relativePath},
            containmentRoot: project.workspace.root,
        };
    }

    const root = currentProject?.workspace.root ?? workspaceRoot;
    if (currentProject && segments[0] === currentProject.workspace.ref.projectRoot) {
        throw new Error(`当前 Project Workspace 内请使用相对路径，不要重复添加 ${segments[0]}/ 前缀`);
    }
    const absolutePath = resolveContainedFilePath(root, inputPath);
    const relativePath = relativeFilePathInside(root, absolutePath);
    if (!relativePath) {
        throw new Error(`路径越过文件系统根：${inputPath}`);
    }
    return {
        target: {
            kind: "relative",
            absolutePath,
            project: currentProject,
            ...(currentProject && relativePath !== "." ? {relativePath} : {}),
        },
        containmentRoot: root,
    };
}
