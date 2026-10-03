import fs from "node:fs/promises";
import path from "node:path";
import {
    absoluteFsPath,
    assertRealPathContained,
    type AbsoluteFsPath,
} from "nbook/server/runtime/paths/file-path";
import {
    createProjectWorkspaceKey,
    isProjectLifecycleError,
    normalizeProjectRoot,
    ProjectLifecycleError,
    ProjectRootCaseCollisionError,
    projectWorkspaceRef,
    resolvedProjectWorkspace,
    type ProjectWorkspaceRef,
    type ResolvedProjectWorkspace,
    type WorkspaceRelativePath,
} from "nbook/server/workspace-files/project-identity";

const PROJECT_DELETED_MARKER = ".nbook/deleted-project.json";

type ProjectRootPhysicalFingerprint = {
    readonly device: bigint;
    readonly inode: bigint;
    readonly birthtimeNs: bigint;
};

type ProjectRootFingerprint = ProjectRootPhysicalFingerprint & {
    readonly canonicalRoot: string;
};

declare const PROJECT_ROOT_PHYSICAL_TOKEN: unique symbol;

/** 只由ProjectRootIdentityModule识别的进程内物理目录token。 */
export type ProjectRootPhysicalToken = {
    readonly [PROJECT_ROOT_PHYSICAL_TOKEN]: true;
};

/** token对应的物理目录当前在指定路径上的所有权状态。 */
export type ProjectRootPhysicalOwnership = "owned" | "missing" | "replaced";

type InspectedProjectRoot = {
    readonly ref: ProjectWorkspaceRef;
    readonly root: AbsoluteFsPath;
    readonly fingerprint: ProjectRootFingerprint;
};

/** Project root拼写比较策略；Windows产品合同固定使用insensitive。 */
export type ProjectRootCaseMode = "sensitive" | "insensitive";

/** 外部文件系统边界：读取Workspace Root当前一级物理目录名称。 */
export type ProjectRootDirectoryReader = (workspaceRoot: AbsoluteFsPath) => Promise<readonly string[]>;

/** 平台边界：判断普通目录项是否带Node Stats未暴露的reparse属性。 */
export type ProjectRootReparseDetector = (projectRoot: AbsoluteFsPath) => Promise<boolean>;

/** Root Identity的构造依赖；只允许注入平台reparse检测边界。 */
export type ProjectRootIdentityOptions = {
    readonly reparseDetector?: ProjectRootReparseDetector;
    readonly caseMode?: ProjectRootCaseMode;
    readonly readDirectoryNames?: ProjectRootDirectoryReader;
};

/** Product在Windows+Bun运行时调用真实kernel attributes；Node-based tooling使用注入tracer验证policy。 */
const PLATFORM_REPARSE_DETECTOR: ProjectRootReparseDetector = async (projectRoot) => {
    if (process.platform !== "win32" || !("bun" in process.versions)) {
        return false;
    }
    const {detectWindowsProjectRootReparse} = await import(
        "nbook/server/workspace-files/project-root-reparse-windows"
    );
    return detectWindowsProjectRootReparse(projectRoot);
};

/** 生产目录读取边界；普通文件与symlink不参与Project locator大小写membership。 */
const NODE_DIRECTORY_READER: ProjectRootDirectoryReader = async (workspaceRoot) => {
    const entries = await fs.readdir(workspaceRoot, {withFileTypes: true});
    return entries
        .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
        .map((entry) => entry.name);
};

/**
 * Project root物理identity深Module。
 *
 * `resolve()`集中完成一级目录、realpath、link/reparse与capture校验；`revalidate()`只接受本Module
 * 生成的ResolvedProjectWorkspace，并用不持久化fingerprint阻止同路径rename/delete/recreate ABA。
 */
export class ProjectRootIdentityModule {
    private readonly workspaceRoot: AbsoluteFsPath;
    private readonly reparseDetector: ProjectRootReparseDetector;
    private readonly caseMode: ProjectRootCaseMode;
    private readonly readDirectoryNames: ProjectRootDirectoryReader;
    private readonly fingerprints = new WeakMap<ResolvedProjectWorkspace, ProjectRootFingerprint>();
    private readonly physicalTokens = new WeakMap<ProjectRootPhysicalToken, ProjectRootPhysicalFingerprint>();
    private canonicalWorkspaceRootPromise: Promise<AbsoluteFsPath> | null = null;

    /** 建立绑定到单个Workspace Root的root identity Module。 */
    constructor(workspaceRoot: AbsoluteFsPath, options: ProjectRootIdentityOptions = {}) {
        this.workspaceRoot = workspaceRoot;
        this.reparseDetector = options.reparseDetector ?? PLATFORM_REPARSE_DETECTOR;
        this.caseMode = options.caseMode ?? (process.platform === "win32" ? "insensitive" : "sensitive");
        this.readDirectoryNames = options.readDirectoryNames ?? NODE_DIRECTORY_READER;
    }

    /** 解析并捕获一个一级物理Project Workspace的进程内identity。 */
    async resolve(
        ref: ProjectWorkspaceRef,
        knownDirectoryNames?: readonly string[],
    ): Promise<ResolvedProjectWorkspace> {
        const inspected = await this.inspect(ref, knownDirectoryNames);
        const canonicalWorkspaceRoot = await this.canonicalWorkspaceRoot();
        const resolved = resolvedProjectWorkspace(
            inspected.ref,
            inspected.root,
            createProjectWorkspaceKey(canonicalWorkspaceRoot, inspected.ref),
        );
        this.fingerprints.set(resolved, inspected.fingerprint);
        return resolved;
    }

    /** 复核ResolvedProjectWorkspace仍指向capture时的同一个物理目录。 */
    async revalidate(workspace: ResolvedProjectWorkspace): Promise<void> {
        const expected = this.fingerprints.get(workspace);
        if (!expected) {
            throw rootReplacedError("Resolved Project Workspace不属于当前root identity generation");
        }
        let current: InspectedProjectRoot;
        try {
            current = await this.inspect(workspace.ref);
        } catch (cause) {
            if (isProjectLifecycleError(cause) && cause.code === "PROJECT_ROOT_IO") {
                throw cause;
            }
            throw rootReplacedError("Project Workspace root在运行期间失效", cause);
        }
        if (current.root !== workspace.root || !sameFingerprint(expected, current.fingerprint)) {
            throw rootReplacedError("Project Workspace root已被外部替换");
        }
    }

    /** 捕获可跨同卷rename比较、但不能离开当前进程持久化的物理目录token。 */
    async capturePhysical(root: AbsoluteFsPath): Promise<ProjectRootPhysicalToken> {
        const stat = await projectRootStat(root, this.reparseDetector);
        const token = Object.freeze({}) as ProjectRootPhysicalToken;
        this.physicalTokens.set(token, physicalFingerprint(stat));
        return token;
    }

    /**
     * 区分事务目录仍由token拥有、已正常移动/删除或已被replacement占用。
     *
     * 真实文件系统/平台属性读取失败继续抛PROJECT_ROOT_IO，调用方不得把它误判为missing。
     */
    async inspectPhysicalOwnership(
        root: AbsoluteFsPath,
        token: ProjectRootPhysicalToken,
    ): Promise<ProjectRootPhysicalOwnership> {
        const expected = this.physicalTokens.get(token);
        if (!expected) {
            return "replaced";
        }
        let stat: Awaited<ReturnType<typeof projectRootStat>>;
        try {
            stat = await projectRootStat(root, this.reparseDetector);
        } catch (cause) {
            if (isProjectLifecycleError(cause)) {
                if (cause.code === "PROJECT_NOT_FOUND") {
                    return "missing";
                }
                if (cause.code === "PROJECT_ROOT_IO") {
                    throw cause;
                }
                return "replaced";
            }
            throw rootIoError("无法检查事务拥有的Project root", cause);
        }
        return samePhysicalFingerprint(expected, physicalFingerprint(stat)) ? "owned" : "replaced";
    }

    /** 复核指定路径仍指向token捕获时的同一个物理目录，不要求路径保持不变。 */
    async revalidatePhysical(root: AbsoluteFsPath, token: ProjectRootPhysicalToken): Promise<void> {
        const ownership = await this.inspectPhysicalOwnership(root, token);
        if (ownership !== "owned") {
            throw rootReplacedError(
                ownership === "missing"
                    ? "事务拥有的Project root在rename后失效"
                    : "事务拥有的Project root已被外部替换",
            );
        }
    }

    /** 只有物理lstat明确ENOENT才视为可供事务rename使用的空目标。 */
    async assertPhysicalVacant(root: AbsoluteFsPath): Promise<void> {
        try {
            await fs.lstat(root);
        } catch (cause) {
            if (isMissingPathError(cause)) {
                return;
            }
            throw rootIoError("无法确认事务目标路径是否为空闲", cause);
        }
        throw rootReplacedError("事务目标路径已被外部物理entry占用");
    }

    /** 捕获期间执行lstat → realpath → lstat双检，拒绝拼接出的瞬时identity。 */
    private async inspect(
        ref: ProjectWorkspaceRef,
        knownDirectoryNames?: readonly string[],
    ): Promise<InspectedProjectRoot> {
        const requestedRoot = await this.resolveSpelling(ref, knownDirectoryNames);
        const absoluteRoot = absoluteFsPath(path.join(this.workspaceRoot, requestedRoot));
        const before = await projectRootStat(absoluteRoot, this.reparseDetector);
        let canonicalWorkspaceRoot: AbsoluteFsPath;
        let canonicalRoot: AbsoluteFsPath;
        try {
            [canonicalWorkspaceRoot, canonicalRoot] = await Promise.all([
                this.canonicalWorkspaceRoot(),
                fs.realpath(absoluteRoot).then(absoluteFsPath),
            ]);
        } catch (cause) {
            if (isProjectLifecycleError(cause)) {
                throw cause;
            }
            throw rootIoError("无法解析Project Workspace root真实路径", cause);
        }
        try {
            await assertRealPathContained(this.workspaceRoot, absoluteRoot);
        } catch (cause) {
            throw new ProjectLifecycleError(
                "PROJECT_ROOT_LINK_UNSUPPORTED",
                "Project Workspace root真实路径不能越过Workspace Root",
                cause,
            );
        }
        const after = await projectRootStat(absoluteRoot, this.reparseDetector);
        if (!sameStat(before, after)) {
            throw rootReplacedError("Project Workspace root在identity capture期间发生变化");
        }

        const actualRoot = normalizeProjectRoot(path.basename(canonicalRoot));
        const canonicalRelativePath = path.relative(canonicalWorkspaceRoot, canonicalRoot);
        if (canonicalRelativePath !== actualRoot) {
            throw new ProjectLifecycleError(
                "PROJECT_ROOT_LINK_UNSUPPORTED",
                "Project Workspace root必须是Workspace Root的一级物理目录",
            );
        }
        let deleted: boolean;
        try {
            deleted = await pathExists(path.join(absoluteRoot, PROJECT_DELETED_MARKER));
        } catch (cause) {
            throw rootIoError("无法检查Project Workspace删除标记", cause);
        }
        if (deleted) {
            throw new ProjectLifecycleError("PROJECT_NOT_FOUND", "Project Workspace已删除");
        }
        const canonicalRef = projectWorkspaceRef(actualRoot);
        return {
            ref: canonicalRef,
            root: canonicalRoot,
            fingerprint: {
                canonicalRoot: normalizeCanonicalRoot(canonicalRoot),
                ...physicalFingerprint(after),
            },
        };
    }

    /** 将调用方locator解析为唯一真实拼写；collision在任何lstat/realpath前fail closed。 */
    private async resolveSpelling(
        ref: ProjectWorkspaceRef,
        knownDirectoryNames?: readonly string[],
    ): Promise<WorkspaceRelativePath> {
        const requestedRoot = normalizeProjectRoot(ref.projectRoot);
        let directoryNames: readonly string[];
        try {
            directoryNames = knownDirectoryNames ?? await this.readDirectoryNames(this.workspaceRoot);
        } catch (cause) {
            throw rootIoError("无法读取Workspace Root一级目录", cause);
        }
        const requestedIdentity = normalizeCase(requestedRoot, this.caseMode);
        const matches = directoryNames
            .flatMap((entryName) => {
                try {
                    const normalized = normalizeProjectRoot(entryName);
                    return normalizeCase(normalized, this.caseMode) === requestedIdentity ? [normalized] : [];
                } catch {
                    return [];
                }
            })
            .sort(compareProjectRoots);
        if (matches.length > 1) {
            throw new ProjectRootCaseCollisionError(matches);
        }
        return matches[0] ?? requestedRoot;
    }

    /** 惰性解析canonical Workspace Root，避免identity受输入路径拼写影响。 */
    private canonicalWorkspaceRoot(): Promise<AbsoluteFsPath> {
        if (!this.canonicalWorkspaceRootPromise) {
            this.canonicalWorkspaceRootPromise = fs.realpath(this.workspaceRoot).then(absoluteFsPath);
        }
        return this.canonicalWorkspaceRootPromise;
    }
}

/** 读取并校验Project root是普通物理目录。 */
async function projectRootStat(
    projectRoot: AbsoluteFsPath,
    reparseDetector: ProjectRootReparseDetector,
) {
    let stat: Awaited<ReturnType<typeof fs.lstat>>;
    try {
        stat = await fs.lstat(projectRoot, {bigint: true});
    } catch (cause) {
        if (isMissingPathError(cause)) {
            throw new ProjectLifecycleError("PROJECT_NOT_FOUND", "Project Workspace不存在", cause);
        }
        throw rootIoError("无法读取Project Workspace root属性", cause);
    }
    if (stat.isSymbolicLink()) {
        throw new ProjectLifecycleError(
            "PROJECT_ROOT_LINK_UNSUPPORTED",
            "Project Workspace root不能是symlink、junction或reparse point",
        );
    }
    let isReparse: boolean;
    try {
        isReparse = await reparseDetector(projectRoot);
    } catch (cause) {
        if (isProjectLifecycleError(cause)) {
            throw cause;
        }
        throw rootIoError("无法读取Project Workspace root平台属性", cause);
    }
    if (isReparse) {
        throw new ProjectLifecycleError(
            "PROJECT_ROOT_LINK_UNSUPPORTED",
            "Project Workspace root不能是symlink、junction或reparse point",
        );
    }
    if (!stat.isDirectory()) {
        throw new ProjectLifecycleError("INVALID_PROJECT_ROOT", "Project Workspace root必须是一级物理目录");
    }
    return stat;
}

/** capture前后只比较物理identity事实，不使用会被正常内容写入改变的mtime/ctime。 */
function sameStat(
    left: Awaited<ReturnType<typeof projectRootStat>>,
    right: Awaited<ReturnType<typeof projectRootStat>>,
): boolean {
    return left.dev === right.dev
        && left.ino === right.ino
        && left.birthtimeNs === right.birthtimeNs;
}

/** 比较两个不透明root fingerprint。 */
function sameFingerprint(left: ProjectRootFingerprint, right: ProjectRootFingerprint): boolean {
    return left.canonicalRoot === right.canonicalRoot
        && samePhysicalFingerprint(left, right);
}

/** 从Node bigint Stats收窄出rename稳定的物理目录身份。 */
function physicalFingerprint(
    stat: Awaited<ReturnType<typeof projectRootStat>>,
): ProjectRootPhysicalFingerprint {
    return {
        device: stat.dev,
        inode: stat.ino,
        birthtimeNs: stat.birthtimeNs,
    };
}

/** 比较两个不包含路径拼写的物理目录identity。 */
function samePhysicalFingerprint(
    left: ProjectRootPhysicalFingerprint,
    right: ProjectRootPhysicalFingerprint,
): boolean {
    return left.device === right.device
        && left.inode === right.inode
        && left.birthtimeNs === right.birthtimeNs;
}

/** Windows locator按产品合同大小写不敏感，POSIX保留真实拼写。 */
function normalizeCanonicalRoot(root: AbsoluteFsPath): string {
    return process.platform === "win32"
        ? root.toLocaleLowerCase("en-US")
        : root;
}

/** 按显式平台策略生成单段Project locator的比较key。 */
function normalizeCase(root: WorkspaceRelativePath, caseMode: ProjectRootCaseMode): string {
    return caseMode === "insensitive" ? root.toLocaleLowerCase("en-US") : root;
}

/** 使用code-point顺序稳定排序collision成员，不依赖系统locale。 */
function compareProjectRoots(left: WorkspaceRelativePath, right: WorkspaceRelativePath): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

/** 统一构造root ABA replacement typed failure。 */
function rootReplacedError(message: string, cause?: unknown): ProjectLifecycleError {
    return new ProjectLifecycleError("PROJECT_ROOT_REPLACED", message, cause);
}

/** 统一构造root文件系统/平台属性typed failure。 */
function rootIoError(message: string, cause: unknown): ProjectLifecycleError {
    return new ProjectLifecycleError("PROJECT_ROOT_IO", message, cause);
}

/** 判断路径是否存在；除ENOENT外的I/O错误继续上抛。 */
async function pathExists(targetPath: string): Promise<boolean> {
    try {
        await fs.access(targetPath);
        return true;
    } catch (cause) {
        if (isMissingPathError(cause)) {
            return false;
        }
        throw cause;
    }
}

/** 判断Node文件系统错误是否表示路径不存在。 */
function isMissingPathError(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
