import {randomUUID} from "node:crypto";
import fs from "node:fs/promises";
import type {FileHandle} from "node:fs/promises";
import path from "node:path";
import * as yaml from "yaml";
import {normalizeProjectCoverPath} from "nbook/shared/project-cover";
import {
    absoluteFsPath,
    assertRealPathContained,
    type AbsoluteFsPath,
} from "nbook/server/runtime/paths/file-path";
import {
    isProjectLockCompromisedError,
    isProjectLockReleaseFailedError,
} from "nbook/server/workspace-files/project-lock";
import {
    isProjectLifecycleError,
    ProjectLifecycleError,
    type ResolvedProjectWorkspace,
    type WorkspaceRelativePath,
} from "nbook/server/workspace-files/project-identity";

export const PROJECT_MANIFEST_FILE = "project.yaml";
const PROJECT_LIFECYCLE_TEMP_PREFIX = ".nbook-project-lifecycle-v1-";
const PROJECT_LIFECYCLE_TEMP_PATTERN = /^\.nbook-project-lifecycle-v1-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/u;

/** 判断文件名是否是Project Lifecycle自身创建的版本化transaction temp。 */
export function isProjectLifecycleTempName(fileName: string): boolean {
    return PROJECT_LIFECYCLE_TEMP_PATTERN.test(fileName);
}

/** 合法Project manifest的核心字段。 */
export type ProjectManifest = {
    readonly kind: "novel";
    readonly title: string;
    readonly summary: string;
    /** 可选 Project Workspace 相对路径；非法外部值按未设置处理。 */
    readonly cover?: string;
};

/** validate返回的结构化manifest问题；只描述可由ensure修复的内容问题。 */
export type ProjectManifestIssue =
    | {
        readonly code: "PROJECT_MANIFEST_MISSING";
        readonly file: typeof PROJECT_MANIFEST_FILE;
    }
    | {
        readonly code: "PROJECT_MANIFEST_CORRUPT";
        readonly file: typeof PROJECT_MANIFEST_FILE;
    }
    | {
        readonly code: "PROJECT_MANIFEST_FIELD_INVALID";
        readonly file: typeof PROJECT_MANIFEST_FILE;
        readonly field: keyof ProjectManifest;
    };

/** Lifecycle对manifest做出的磁盘变更。 */
export type ProjectManifestChange = "none" | "created" | "normalized" | "recovered" | "updated";

/** metadata / cover mutation 只允许修改 NeuroBook 拥有的公开字段。 */
export type ProjectManifestMetadataPatch = {
    /** undefined表示保留当前值。 */
    readonly title?: string;
    /** undefined表示保留当前值；空字符串表示清空。 */
    readonly summary?: string;
    /** undefined表示保留；null表示删除；字符串表示设置规范 Project Workspace 相对路径。 */
    readonly cover?: string | null;
};

/** 完全只读的Project校验结果；repairable表示ensure可安全归一化。 */
export type ProjectValidationResult =
    | {
        readonly status: "valid";
        readonly projectRoot: WorkspaceRelativePath;
        readonly manifest: ProjectManifest;
        readonly issues: readonly [];
    }
    | {
        readonly status: "repairable";
        readonly projectRoot: WorkspaceRelativePath;
        readonly proposedManifest: ProjectManifest;
        readonly issues: readonly ProjectManifestIssue[];
    };

/** Lifecycle内部使用的manifest检查结果；不暴露raw bytes或YAML Document。 */
export type ProjectManifestInspection =
    | {
        readonly status: "valid";
        readonly manifest: ProjectManifest;
        readonly manifestUpdatedAt: string;
    }
    | {
        readonly status: "repairable";
        readonly proposedManifest: ProjectManifest;
        readonly issues: readonly ProjectManifestIssue[];
    }
    | {
        readonly status: "unsafe";
        readonly error: ProjectLifecycleError;
    };

/** Manifest persistence对真实文件系统边界使用的最小Adapter。 */
export type ProjectManifestAdapter = {
    access(filePath: string): Promise<void>;
    mkdir(filePath: string, options: {readonly recursive: boolean}): Promise<string | undefined | void>;
    open(filePath: string, flags: "wx"): Promise<FileHandle>;
    readFile(filePath: string): Promise<Buffer>;
    rename(oldPath: string, newPath: string): Promise<void>;
    rm(filePath: string, options: {readonly force: true; readonly recursive?: boolean}): Promise<void>;
};

/** Manifest persistence执行temp best-effort清理时所属的公开Lifecycle操作。 */
export type ProjectManifestCleanupOperation = "ensure" | "import" | "metadata-update" | "cover-update";

/** Manifest persistence无法清理自身temp时交给Lifecycle的窄诊断事件。 */
export type ProjectManifestCleanupIssue = {
    readonly operation: ProjectManifestCleanupOperation;
    readonly target: "manifest-temp" | "recovery-temp";
    /** Workspace Root-relativetemp路径，不暴露绝对文件系统拼写。 */
    readonly path: WorkspaceRelativePath;
    readonly error: unknown;
};

/** Cleanup诊断只能旁路报告，不得改变manifest事务的主结果。 */
export type ProjectManifestCleanupReporter = (issue: ProjectManifestCleanupIssue) => void;

/** Manifest写入前后复核Lifecycle、lock与root identity的提交门禁。 */
export type ProjectManifestCommitGate = () => Promise<void>;

/** Manifest ensure完成后交给Lifecycle发布snapshot的领域结果。 */
export type ProjectManifestEnsureResult = {
    readonly manifest: ProjectManifest;
    readonly change: ProjectManifestChange;
    /** 非空表示旧manifest原始bytes已备份到该Workspace Root-relative路径。 */
    readonly recoveryPath?: WorkspaceRelativePath;
};

/** manifest rename已经完成，但rename后的Lifecycle/lock/root门禁失败。 */
export class ProjectManifestPublishedError extends Error {
    readonly committed = true;
    override readonly cause: unknown;

    /** 调用方必须把它映射为整体事务的部分提交，而不能伪装成rename前失败。 */
    constructor(cause: unknown) {
        super("project.yaml已经原子发布，但发布后门禁失败", {cause});
        this.name = "ProjectManifestPublishedError";
        this.cause = cause;
    }
}

export const NODE_PROJECT_MANIFEST_ADAPTER: ProjectManifestAdapter = {
    access: async (filePath) => fs.access(filePath),
    mkdir: async (filePath, options) => fs.mkdir(filePath, options),
    open: async (filePath, flags) => fs.open(filePath, flags),
    readFile: async (filePath) => fs.readFile(filePath),
    rename: async (oldPath, newPath) => fs.rename(oldPath, newPath),
    rm: async (filePath, options) => fs.rm(filePath, options),
};

type ManifestReadResult =
    | {readonly kind: "missing"}
    | {readonly kind: "unsafe"; readonly error: ProjectLifecycleError}
    | {readonly kind: "corrupt"; readonly raw: Buffer}
    | {
        readonly kind: "normalizable";
        readonly raw: Buffer;
        readonly document: ReturnType<typeof yaml.parseDocument>;
    }
    | {
        readonly kind: "valid";
        readonly raw: Buffer;
        readonly document: ReturnType<typeof yaml.parseDocument>;
        readonly manifest: ProjectManifest;
        readonly manifestUpdatedAt: string;
    };

/**
 * Project manifest内部深Module。
 *
 * Lifecycle只消费领域inspection/ensure结果；raw bytes、YAML Document、recovery、temp、冲突检测
 * 与原子rename全部留在本Module内。
 */
export class ProjectManifestPersistence {
    private readonly workspaceRoot: AbsoluteFsPath;
    private readonly adapter: ProjectManifestAdapter;
    private readonly reportCleanupIssue: ProjectManifestCleanupReporter;

    /** 建立绑定到单个Workspace Root的manifest persistence。 */
    constructor(
        workspaceRoot: AbsoluteFsPath,
        adapter: ProjectManifestAdapter = NODE_PROJECT_MANIFEST_ADAPTER,
        reportCleanupIssue: ProjectManifestCleanupReporter = () => undefined,
    ) {
        this.workspaceRoot = workspaceRoot;
        this.adapter = adapter;
        this.reportCleanupIssue = reportCleanupIssue;
    }

    /** 完全只读检查manifest，并把外部YAML收窄为领域结果。 */
    async inspect(workspace: ResolvedProjectWorkspace): Promise<ProjectManifestInspection> {
        return inspectionFromRead(
            await this.readRoot(workspace.root, workspace.ref.projectRoot),
            workspace.ref.projectRoot,
        );
    }

    /** 确保manifest合法；不处理Lifecycle锁、snapshot或root identity。 */
    async ensure(
        workspace: ResolvedProjectWorkspace,
        commitGate: ProjectManifestCommitGate,
        knownInspection?: ProjectManifestInspection,
    ): Promise<ProjectManifestEnsureResult> {
        return this.ensureRoot(
            workspace.root,
            workspace.ref.projectRoot,
            commitGate,
            "ensure",
            knownInspection,
        );
    }

    /** 原子更新manifest metadata，保留未知YAML内容并为语义改写保存原始bytes。 */
    async updateMetadata(
        workspace: ResolvedProjectWorkspace,
        patch: ProjectManifestMetadataPatch,
        commitGate: ProjectManifestCommitGate,
        operation: Extract<ProjectManifestCleanupOperation, "metadata-update" | "cover-update"> = "metadata-update",
    ): Promise<ProjectManifestEnsureResult> {
        const {projectRoot} = workspace.ref;
        const manifestPath = path.join(workspace.root, PROJECT_MANIFEST_FILE);
        const existing = await this.readRoot(workspace.root, projectRoot);
        if (existing.kind === "unsafe") {
            throw existing.error;
        }
        const current = existing.kind === "valid"
            ? existing.manifest
            : existing.kind === "normalizable"
                ? normalizedManifest(existing.document, projectRoot)
                : defaultManifest(projectRoot);
        const manifest: ProjectManifest = {
            kind: "novel",
            title: patch.title ?? current.title,
            summary: patch.summary ?? current.summary,
            ...(patch.cover === null
                ? {}
                : patch.cover !== undefined
                    ? {cover: patch.cover}
                    : current.cover === undefined
                        ? {}
                        : {cover: current.cover}),
        };
        if (
            existing.kind === "valid"
            && manifest.title === existing.manifest.title
            && manifest.summary === existing.manifest.summary
            && manifest.cover === existing.manifest.cover
        ) {
            return {manifest: existing.manifest, change: "none"};
        }

        await commitGate();
        let change: ProjectManifestChange;
        let recoveryPath: WorkspaceRelativePath | undefined;
        try {
            if (existing.kind === "missing") {
                await publishManifest(
                    this.adapter,
                    manifestPath,
                    projectRoot,
                    Buffer.from(yaml.stringify(manifest), "utf8"),
                    null,
                    commitGate,
                    operation,
                    this.reportCleanupIssue,
                );
                change = "created";
            } else {
                recoveryPath = await backupManifest(
                    this.adapter,
                    this.workspaceRoot,
                    workspace.root,
                    projectRoot,
                    existing.raw,
                    operation,
                    this.reportCleanupIssue,
                );
                await commitGate();
                if (existing.kind === "corrupt") {
                    await publishManifest(
                        this.adapter,
                        manifestPath,
                        projectRoot,
                        Buffer.from(yaml.stringify(manifest), "utf8"),
                        existing.raw,
                        commitGate,
                        operation,
                        this.reportCleanupIssue,
                    );
                    change = "recovered";
                } else {
                    normalizeManifestDocument(existing.document, manifest);
                    await publishManifest(
                        this.adapter,
                        manifestPath,
                        projectRoot,
                        Buffer.from(existing.document.toString(), "utf8"),
                        existing.raw,
                        commitGate,
                        operation,
                        this.reportCleanupIssue,
                    );
                    change = existing.kind === "valid" ? "updated" : "normalized";
                }
            }
        } catch (error) {
            if (
                isProjectLifecycleError(error)
                || isProjectLockCompromisedError(error)
                || isProjectLockReleaseFailedError(error)
                || error instanceof ProjectManifestPublishedError
            ) {
                throw error;
            }
            throw new ProjectLifecycleError(
                "PROJECT_MANIFEST_IO",
                `无法安全更新 ${projectRoot}/${PROJECT_MANIFEST_FILE}`,
                error,
            );
        }
        return {manifest, change, recoveryPath};
    }

    /** 把import source交出的原始manifest写入私有staging，并在发布root前完成静默修复。 */
    async materializeImportedManifest(
        stagingRoot: AbsoluteFsPath,
        projectRoot: WorkspaceRelativePath,
        manifestBytes: Uint8Array | undefined,
        commitGate: ProjectManifestCommitGate,
    ): Promise<ProjectManifestEnsureResult> {
        if (manifestBytes !== undefined) {
            await commitGate();
            const manifestPath = path.join(stagingRoot, PROJECT_MANIFEST_FILE);
            try {
                const handle = await this.adapter.open(manifestPath, "wx");
                try {
                    await handle.writeFile(Buffer.from(manifestBytes));
                    await handle.sync();
                } finally {
                    await handle.close();
                }
            } catch (error) {
                throw new ProjectLifecycleError(
                    "PROJECT_MANIFEST_IO",
                    `无法在import staging中写入 ${projectRoot}/${PROJECT_MANIFEST_FILE}`,
                    error,
                );
            }
            await commitGate();
        }
        return this.ensureRoot(stagingRoot, projectRoot, commitGate, "import");
    }

    /** 在指定Project root中确保manifest合法；真实root与私有staging共用同一解析和恢复合同。 */
    private async ensureRoot(
        absoluteProjectRoot: AbsoluteFsPath,
        projectRoot: WorkspaceRelativePath,
        commitGate: ProjectManifestCommitGate,
        operation: Extract<ProjectManifestCleanupOperation, "ensure" | "import">,
        knownInspection?: ProjectManifestInspection,
    ): Promise<ProjectManifestEnsureResult> {
        if (knownInspection?.status === "valid") {
            return {manifest: knownInspection.manifest, change: "none"};
        }
        if (knownInspection?.status === "unsafe") {
            throw knownInspection.error;
        }
        const manifestPath = path.join(absoluteProjectRoot, PROJECT_MANIFEST_FILE);
        const existing = await this.readRoot(absoluteProjectRoot, projectRoot);
        if (existing.kind === "valid") {
            return {manifest: existing.manifest, change: "none"};
        }
        if (existing.kind === "unsafe") {
            throw existing.error;
        }
        const manifest = existing.kind === "normalizable"
            ? normalizedManifest(existing.document, projectRoot)
            : defaultManifest(projectRoot);
        await commitGate();
        let change: ProjectManifestChange;
        let recoveryPath: WorkspaceRelativePath | undefined;
        try {
            if (existing.kind === "missing") {
                await publishManifest(
                    this.adapter,
                    manifestPath,
                    projectRoot,
                    Buffer.from(yaml.stringify(manifest), "utf8"),
                    null,
                    commitGate,
                    operation,
                    this.reportCleanupIssue,
                );
                change = "created";
            } else {
                recoveryPath = await backupManifest(
                    this.adapter,
                    this.workspaceRoot,
                    absoluteProjectRoot,
                    projectRoot,
                    existing.raw,
                    operation,
                    this.reportCleanupIssue,
                );
                await commitGate();
                if (existing.kind === "normalizable") {
                    normalizeManifestDocument(existing.document, manifest);
                    await publishManifest(
                        this.adapter,
                        manifestPath,
                        projectRoot,
                        Buffer.from(existing.document.toString(), "utf8"),
                        existing.raw,
                        commitGate,
                        operation,
                        this.reportCleanupIssue,
                    );
                    change = "normalized";
                } else {
                    await publishManifest(
                        this.adapter,
                        manifestPath,
                        projectRoot,
                        Buffer.from(yaml.stringify(manifest), "utf8"),
                        existing.raw,
                        commitGate,
                        operation,
                        this.reportCleanupIssue,
                    );
                    change = "recovered";
                }
            }
        } catch (error) {
            if (
                isProjectLifecycleError(error)
                || isProjectLockCompromisedError(error)
                || isProjectLockReleaseFailedError(error)
                || error instanceof ProjectManifestPublishedError
            ) {
                throw error;
            }
            throw new ProjectLifecycleError(
                "PROJECT_MANIFEST_IO",
                `无法安全写入 ${projectRoot}/${PROJECT_MANIFEST_FILE}`,
                error,
            );
        }
        return {manifest, change, recoveryPath};
    }

    /** 在尚未发布的同卷staging root中写入最小manifest。 */
    async materializeManifest(
        stagingRoot: AbsoluteFsPath,
        projectRoot: WorkspaceRelativePath,
        manifest: ProjectManifest = defaultManifest(projectRoot),
    ): Promise<void> {
        const manifestPath = path.join(stagingRoot, PROJECT_MANIFEST_FILE);
        try {
            const handle = await this.adapter.open(manifestPath, "wx");
            try {
                await handle.writeFile(Buffer.from(yaml.stringify(manifest), "utf8"));
                await handle.sync();
            } finally {
                await handle.close();
            }
        } catch (error) {
            throw new ProjectLifecycleError(
                "PROJECT_MANIFEST_IO",
                `无法在staging中创建 ${projectRoot}/${PROJECT_MANIFEST_FILE}`,
                error,
            );
        }
    }

    /** 将真实manifest读取故障统一映射为typed lifecycle I/O error。 */
    private async readRoot(
        absoluteProjectRoot: AbsoluteFsPath,
        projectRoot: WorkspaceRelativePath,
    ): Promise<ManifestReadResult> {
        try {
            return await readManifest(
                this.workspaceRoot,
                path.join(absoluteProjectRoot, PROJECT_MANIFEST_FILE),
                this.adapter,
            );
        } catch (error) {
            if (isProjectLifecycleError(error)) {
                throw error;
            }
            throw new ProjectLifecycleError(
                "PROJECT_MANIFEST_IO",
                `无法读取 ${projectRoot}/${PROJECT_MANIFEST_FILE}`,
                error,
            );
        }
    }
}

/** 把内部read结果映射为不泄漏persistence细节的领域inspection。 */
function inspectionFromRead(
    read: ManifestReadResult,
    projectRoot: WorkspaceRelativePath,
): ProjectManifestInspection {
    if (read.kind === "unsafe") {
        return {status: "unsafe", error: read.error};
    }
    if (read.kind === "valid") {
        return Object.freeze({
            status: "valid",
            manifest: Object.freeze({...read.manifest}),
            manifestUpdatedAt: read.manifestUpdatedAt,
        });
    }
    const proposedManifest = read.kind === "normalizable"
        ? normalizedManifest(read.document, projectRoot)
        : defaultManifest(projectRoot);
    const issues: readonly ProjectManifestIssue[] = read.kind === "missing"
        ? [{code: "PROJECT_MANIFEST_MISSING", file: PROJECT_MANIFEST_FILE}]
        : read.kind === "corrupt"
            ? [{code: "PROJECT_MANIFEST_CORRUPT", file: PROJECT_MANIFEST_FILE}]
            : manifestFieldIssues(read.document);
    return Object.freeze({
        status: "repairable",
        proposedManifest: Object.freeze(proposedManifest),
        issues: Object.freeze(issues),
    });
}

/** 读取manifest，并保留ensure所需的raw bytes与YAML Document。 */
async function readManifest(
    workspaceRoot: AbsoluteFsPath,
    manifestPath: string,
    adapter: ProjectManifestAdapter,
): Promise<ManifestReadResult> {
    let stat: Awaited<ReturnType<typeof fs.lstat>>;
    try {
        stat = await fs.lstat(manifestPath);
    } catch (error) {
        if (isMissingPathError(error)) {
            return {kind: "missing"};
        }
        throw error;
    }
    if (stat.isSymbolicLink() || !stat.isFile()) {
        return {
            kind: "unsafe",
            error: new ProjectLifecycleError(
                "PROJECT_MANIFEST_IO",
                "project.yaml 必须是 Project Workspace 内的普通物理文件",
            ),
        };
    }
    try {
        await assertRealPathContained(workspaceRoot, absoluteFsPath(manifestPath));
    } catch (error) {
        return {
            kind: "unsafe",
            error: new ProjectLifecycleError(
                "PROJECT_MANIFEST_IO",
                "project.yaml 的真实路径不能越过 Workspace Root",
                error,
            ),
        };
    }
    const raw = await adapter.readFile(manifestPath);
    const document = yaml.parseDocument(raw.toString("utf8"), {prettyErrors: true, strict: true});
    if (document.errors.length > 0 || !yaml.isMap(document.contents)) {
        return {kind: "corrupt", raw};
    }
    const kind: unknown = document.get("kind");
    const title: unknown = document.get("title");
    const summary: unknown = document.get("summary");
    if (kind !== "novel" || typeof title !== "string" || typeof summary !== "string") {
        return {kind: "normalizable", raw, document};
    }
    const cover = normalizeProjectCoverPath(document.get("cover"));
    return {
        kind: "valid",
        raw,
        document,
        manifest: {kind, title, summary, ...(cover === undefined ? {} : {cover})},
        manifestUpdatedAt: stat.mtime.toISOString(),
    };
}

/** 返回ensure在缺失或损坏字段时使用的最小manifest。 */
function defaultManifest(projectRoot: WorkspaceRelativePath): ProjectManifest {
    return {kind: "novel", title: projectRoot, summary: ""};
}

/** 逐字段保留仍合法的核心值，只为缺失或非法字段提供默认值。 */
function normalizedManifest(
    document: ReturnType<typeof yaml.parseDocument>,
    projectRoot: WorkspaceRelativePath,
): ProjectManifest {
    const title: unknown = document.get("title");
    const summary: unknown = document.get("summary");
    const cover = normalizeProjectCoverPath(document.get("cover"));
    return {
        kind: "novel",
        title: typeof title === "string" ? title : projectRoot,
        summary: typeof summary === "string" ? summary : "",
        ...(cover === undefined ? {} : {cover}),
    };
}

/** 按稳定字段顺序报告所有需要归一化的核心manifest字段。 */
function manifestFieldIssues(
    document: ReturnType<typeof yaml.parseDocument>,
): readonly ProjectManifestIssue[] {
    const issues: ProjectManifestIssue[] = [];
    if (document.get("kind") !== "novel") {
        issues.push({code: "PROJECT_MANIFEST_FIELD_INVALID", file: PROJECT_MANIFEST_FILE, field: "kind"});
    }
    if (typeof document.get("title") !== "string") {
        issues.push({code: "PROJECT_MANIFEST_FIELD_INVALID", file: PROJECT_MANIFEST_FILE, field: "title"});
    }
    if (typeof document.get("summary") !== "string") {
        issues.push({code: "PROJECT_MANIFEST_FIELD_INVALID", file: PROJECT_MANIFEST_FILE, field: "summary"});
    }
    return issues;
}

/** 只修改NeuroBook拥有的核心字段，保留未知mapping、顺序和已有Scalar注释。 */
function normalizeManifestDocument(
    document: ReturnType<typeof yaml.parseDocument>,
    manifest: ProjectManifest,
): void {
    setScalar(document, "kind", manifest.kind);
    setScalar(document, "title", manifest.title);
    setScalar(document, "summary", manifest.summary);
    if (manifest.cover === undefined) {
        document.delete("cover");
    } else {
        setScalar(document, "cover", manifest.cover);
    }
}

/** 优先原位更新Scalar value，避免Document.set丢失节点上的行尾注释。 */
function setScalar(
    document: ReturnType<typeof yaml.parseDocument>,
    key: "kind" | "title" | "summary" | "cover",
    value: string,
): void {
    const current: unknown = document.get(key, true);
    if (yaml.isScalar(current)) {
        current.value = value;
        return;
    }
    document.set(key, value);
}

/** 在Project内为即将发生语义改写的manifest保存原始bytes。 */
async function backupManifest(
    adapter: ProjectManifestAdapter,
    workspaceRoot: AbsoluteFsPath,
    absoluteProjectRoot: AbsoluteFsPath,
    projectRoot: WorkspaceRelativePath,
    raw: Buffer,
    operation: ProjectManifestCleanupOperation,
    reportCleanupIssue: ProjectManifestCleanupReporter,
): Promise<WorkspaceRelativePath> {
    const recoveryRoot = absoluteFsPath(path.join(absoluteProjectRoot, ".nbook", "recovery"));
    await assertRealPathContained(workspaceRoot, recoveryRoot);
    await adapter.mkdir(recoveryRoot, {recursive: true});
    await assertRealPathContained(workspaceRoot, recoveryRoot);
    const backupName = `project-manifest-${new Date().toISOString().replaceAll(":", "-")}-${randomUUID()}.yaml`;
    const backupPath = path.join(recoveryRoot, backupName);
    const temporaryPath = absoluteFsPath(path.join(recoveryRoot, transactionTempName()));
    try {
        const handle = await adapter.open(temporaryPath, "wx");
        try {
            await handle.writeFile(raw);
            await handle.sync();
        } finally {
            await handle.close();
        }
        await adapter.rename(temporaryPath, backupPath);
    } finally {
        await cleanupTemporaryPath(
            adapter,
            temporaryPath,
            operation,
            "recovery-temp",
            `${projectRoot}/.nbook/recovery/${path.basename(temporaryPath)}` as WorkspaceRelativePath,
            reportCleanupIssue,
        );
    }
    return `${projectRoot}/.nbook/recovery/${backupName}` as WorkspaceRelativePath;
}

/** 用同目录temp与rename原子发布manifest，并做best-effort外部冲突检测。 */
async function publishManifest(
    adapter: ProjectManifestAdapter,
    manifestPath: string,
    projectRoot: WorkspaceRelativePath,
    nextRaw: Buffer,
    expectedRaw: Buffer | null,
    commitGate: ProjectManifestCommitGate,
    operation: ProjectManifestCleanupOperation,
    reportCleanupIssue: ProjectManifestCleanupReporter,
): Promise<void> {
    const temporaryPath = absoluteFsPath(path.join(path.dirname(manifestPath), transactionTempName()));
    try {
        const handle = await adapter.open(temporaryPath, "wx");
        try {
            await handle.writeFile(nextRaw);
            await handle.sync();
        } finally {
            await handle.close();
        }
        if (expectedRaw) {
            const currentRaw = await adapter.readFile(manifestPath);
            if (!currentRaw.equals(expectedRaw)) {
                throw new ProjectLifecycleError(
                    "PROJECT_MANIFEST_CONFLICT",
                    "project.yaml在ensure期间被外部修改",
                );
            }
        } else if (await pathExists(manifestPath, adapter)) {
            throw new ProjectLifecycleError(
                "PROJECT_MANIFEST_CONFLICT",
                "project.yaml在ensure期间已由其他进程创建",
            );
        }
        await commitGate();
        await adapter.rename(temporaryPath, manifestPath);
        try {
            await commitGate();
        } catch (error) {
            throw new ProjectManifestPublishedError(error);
        }
    } finally {
        await cleanupTemporaryPath(
            adapter,
            temporaryPath,
            operation,
            "manifest-temp",
            `${projectRoot}/${path.basename(temporaryPath)}` as WorkspaceRelativePath,
            reportCleanupIssue,
        );
    }
}

/** Temp清理永远是best-effort；失败只进入diagnostics，不能遮蔽或制造manifest主结果。 */
async function cleanupTemporaryPath(
    adapter: ProjectManifestAdapter,
    temporaryPath: AbsoluteFsPath,
    operation: ProjectManifestCleanupOperation,
    target: ProjectManifestCleanupIssue["target"],
    diagnosticPath: WorkspaceRelativePath,
    reportCleanupIssue: ProjectManifestCleanupReporter,
): Promise<void> {
    try {
        await adapter.rm(temporaryPath, {force: true});
    } catch (error) {
        try {
            reportCleanupIssue(Object.freeze({operation, target, path: diagnosticPath, error}));
        } catch {
            // diagnostics reporter同样不能改变manifest事务结果。
        }
    }
}

/** 生成只会被精确matcher识别的Lifecycle transaction temp文件名。 */
function transactionTempName(): string {
    return `${PROJECT_LIFECYCLE_TEMP_PREFIX}${randomUUID()}.tmp`;
}

/** 判断路径是否存在；除ENOENT外的I/O错误继续上抛。 */
async function pathExists(targetPath: string, adapter: ProjectManifestAdapter): Promise<boolean> {
    try {
        await adapter.access(targetPath);
        return true;
    } catch (error) {
        if (isMissingPathError(error)) {
            return false;
        }
        throw error;
    }
}

/** 判断Node文件系统错误是否表示路径不存在。 */
function isMissingPathError(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
