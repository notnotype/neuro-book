import {createHash} from "node:crypto";
import path from "node:path";
import {
    resolveContainedFilePath,
    type AbsoluteFsPath,
} from "nbook/server/runtime/paths/file-path";
import {
    isProjectDomainError,
    ProjectDomainError,
} from "nbook/server/workspace-files/project-domain-error";

declare const workspaceRelativePathBrand: unique symbol;
declare const projectWorkspaceRefBrand: unique symbol;
declare const projectWorkspaceKeyBrand: unique symbol;
declare const canonicalProjectLocatorBrand: unique symbol;
declare const resolvedProjectWorkspaceBrand: unique symbol;

/** Workspace Root 内已经规范化的正斜杠相对路径。 */
export type WorkspaceRelativePath = string & {
    readonly [workspaceRelativePathBrand]: "workspace-relative-path";
};

/** 仅供当前进程 ProjectSession、cache、presence 和 session generation 使用的 identity key。 */
export type ProjectWorkspaceKey = symbol & {
    readonly [projectWorkspaceKeyBrand]: "project-workspace-key";
};

/** Workspace Root 与单段 projectRoot 组合后的平台规范化进程内 locator。 */
export type CanonicalProjectLocator = string & {
    readonly [canonicalProjectLocatorBrand]: "canonical-project-locator";
};

/** Project Workspace 的稳定领域引用；projectRoot 固定为 Workspace Root 下的一级目录名。 */
export type ProjectWorkspaceRef = {
    readonly projectRoot: WorkspaceRelativePath;
    readonly [projectWorkspaceRefBrand]: "project-workspace-ref";
};

/** 已完成一级物理目录与 realpath 校验的 Project Workspace。 */
export type ResolvedProjectWorkspace = {
    readonly ref: ProjectWorkspaceRef;
    readonly root: AbsoluteFsPath;
    /** 非枚举属性；不得进入 DTO、JSONL、数据库或 localStorage。 */
    readonly key: ProjectWorkspaceKey;
    readonly [resolvedProjectWorkspaceBrand]: "resolved-project-workspace";
};

/** Project Lifecycle 当前对外稳定的 typed failure。 */
export type ProjectLifecycleErrorCode =
    | "INVALID_PROJECT_ROOT"
    | "PROJECT_ROOT_LINK_UNSUPPORTED"
    | "PROJECT_ROOT_CASE_COLLISION"
    | "PROJECT_ROOT_IO"
    | "PROJECT_ROOT_REPLACED"
    | "PROJECT_NOT_FOUND"
    | "PROJECT_MANIFEST_IO"
    | "PROJECT_MANIFEST_CONFLICT"
    | "PROJECT_LIFECYCLE_CLOSED";

/** Project identity、root 或 manifest 边界失败。 */
export class ProjectLifecycleError extends ProjectDomainError {
    readonly code: ProjectLifecycleErrorCode;
    readonly statusCode: number;
    override readonly cause: unknown;

    /** 建立保留底层 cause 的 typed failure。 */
    constructor(code: ProjectLifecycleErrorCode, message: string, cause?: unknown) {
        super("lifecycle", message, {cause});
        this.name = "ProjectLifecycleError";
        this.code = code;
        this.statusCode = code === "PROJECT_NOT_FOUND"
            ? 404
            : code === "PROJECT_MANIFEST_IO" || code === "PROJECT_ROOT_IO"
                ? 500
                : code === "PROJECT_LIFECYCLE_CLOSED"
                    || code === "PROJECT_ROOT_REPLACED"
                    || code === "PROJECT_ROOT_CASE_COLLISION"
                    || code === "PROJECT_MANIFEST_CONFLICT"
                    ? 409
                    : 400;
        this.cause = cause;
    }
}

/** HMR 后仍按稳定 nominal base 与 exact kind 识别 Lifecycle error。 */
export function isProjectLifecycleError(error: unknown): error is ProjectLifecycleError {
    return isProjectDomainError(error, "lifecycle");
}

/** 同一case-insensitive Project locator对应多个真实一级目录拼写。 */
export class ProjectRootCaseCollisionError extends ProjectLifecycleError {
    readonly projectRoots: readonly WorkspaceRelativePath[];

    /** 保留稳定排序的冲突成员，供diagnostics与CLI展示。 */
    constructor(projectRoots: readonly WorkspaceRelativePath[]) {
        const stableRoots = Object.freeze([...projectRoots]);
        super(
            "PROJECT_ROOT_CASE_COLLISION",
            `Project Workspace目录存在大小写冲突：${stableRoots.join("、")}`,
        );
        this.name = "ProjectRootCaseCollisionError";
        this.projectRoots = stableRoots;
    }
}

/** 在稳定 Lifecycle nominal 边界内识别大小写冲突的精确子类。 */
export function isProjectRootCaseCollisionError(error: unknown): error is ProjectRootCaseCollisionError {
    return isProjectLifecycleError(error) && error.code === "PROJECT_ROOT_CASE_COLLISION";
}

/** 把外部单段字符串收窄为不可与普通 WorkspaceRelativePath 混用的 Project 引用。 */
export function projectWorkspaceRef(input: string): ProjectWorkspaceRef {
    return Object.freeze({projectRoot: normalizeProjectRoot(input)}) as ProjectWorkspaceRef;
}

/** 将结构化 Project identity 解析到明确 Workspace Root 内。 */
export function resolveProjectWorkspaceRoot(
    workspaceRoot: AbsoluteFsPath,
    ref: ProjectWorkspaceRef,
): AbsoluteFsPath {
    return resolveContainedFilePath(workspaceRoot, ref.projectRoot);
}

/**
 * 构造跨 Lifecycle 实例与 HMR 稳定、但仍不可持久化的 Project key。
 *
 * Symbol registry 只包含版本化 namespace 与 opaque hash，不泄漏 Workspace Root 裸路径。
 */
export function createProjectWorkspaceKey(
    canonicalWorkspaceRoot: AbsoluteFsPath,
    ref: ProjectWorkspaceRef,
): ProjectWorkspaceKey {
    return Symbol.for(
        `nbook.project-workspace.v1:${projectWorkspaceHash(canonicalWorkspaceRoot, ref)}`,
    ) as ProjectWorkspaceKey;
}

/**
 * 返回可在目标目录不存在时派生的 canonical Project locator。
 *
 * Windows 产品合同按大小写不敏感处理，确保同名大小写拼写竞争同一 identity。
 */
export function canonicalProjectLocator(
    canonicalWorkspaceRoot: AbsoluteFsPath,
    ref: ProjectWorkspaceRef,
): CanonicalProjectLocator {
    const projectRoot = normalizeProjectRoot(ref.projectRoot);
    return normalizeIdentityPath(path.join(canonicalWorkspaceRoot, projectRoot)) as CanonicalProjectLocator;
}

/** 为进程 key 与跨进程锁文件名派生不含裸路径的稳定 hash。 */
export function projectWorkspaceHash(
    canonicalWorkspaceRoot: AbsoluteFsPath,
    ref: ProjectWorkspaceRef,
): string {
    const normalizedWorkspaceRoot = normalizeIdentityPath(canonicalWorkspaceRoot);
    const normalizedProjectRoot = normalizeProjectRootIdentity(ref.projectRoot);
    return createHash("sha256")
        .update(normalizedWorkspaceRoot)
        .update("\0")
        .update(normalizedProjectRoot)
        .digest("hex");
}

/** 构造经过Lifecycle验证的resolved identity，并把key设为非枚举属性。 */
export function resolvedProjectWorkspace(
    ref: ProjectWorkspaceRef,
    root: AbsoluteFsPath,
    key: ProjectWorkspaceKey,
): ResolvedProjectWorkspace {
    const resolved = Object.defineProperty({ref, root}, "key", {
        configurable: false,
        enumerable: false,
        value: key,
        writable: false,
    }) as ResolvedProjectWorkspace;
    return Object.freeze(resolved);
}

/** 校验 Project root 是 Workspace Root 下的合法单段 locator。 */
export function normalizeProjectRoot(input: string): WorkspaceRelativePath {
    if (!input || input.includes("/") || input.includes("\\")) {
        throw new ProjectLifecycleError("INVALID_PROJECT_ROOT", "projectRoot 必须是 Workspace Root 下的一级目录名");
    }
    if (input === "." || input === ".." || input.toLocaleLowerCase("en-US") === ".nbook") {
        throw new ProjectLifecycleError("INVALID_PROJECT_ROOT", "projectRoot 使用了保留目录名");
    }
    if (/[<>:"|?*\u0000-\u001F\u007F]/u.test(input)) {
        throw new ProjectLifecycleError("INVALID_PROJECT_ROOT", "projectRoot 包含跨平台文件名不允许的字符");
    }
    if (/[. ]$/u.test(input)) {
        throw new ProjectLifecycleError("INVALID_PROJECT_ROOT", "projectRoot 不能以点或空格结尾");
    }
    if (/^(?:con|prn|aux|nul|com[1-9\u00B9\u00B2\u00B3]|lpt[1-9\u00B9\u00B2\u00B3])(?:\..*)?$/iu.test(input)) {
        throw new ProjectLifecycleError("INVALID_PROJECT_ROOT", "projectRoot 不能使用 Windows 保留设备名");
    }
    return input as WorkspaceRelativePath;
}

/** 把文件系统 locator 收窄为 Project identity 使用的跨调用稳定拼写。 */
function normalizeIdentityPath(input: string): string {
    const normalized = path.resolve(input);
    return process.platform === "win32"
        ? normalized.toLocaleLowerCase("en-US")
        : normalized;
}

/** 生成不依赖目标目录存在性的单段 Project identity 拼写。 */
function normalizeProjectRootIdentity(input: string): string {
    const projectRoot = normalizeProjectRoot(input);
    return process.platform === "win32"
        ? projectRoot.toLocaleLowerCase("en-US")
        : projectRoot;
}
