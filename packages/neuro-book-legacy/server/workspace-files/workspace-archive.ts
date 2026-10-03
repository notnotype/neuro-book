import {createClient} from "@libsql/client";
import consola from "consola";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {Readable} from "node:stream";
import {setTimeout} from "node:timers/promises";
import {ZipFile} from "yazl";
import {
    readWorkspaceIgnoreRules,
    shouldSkipWorkspacePath,
    type WorkspaceIgnoreRule,
} from "nbook/server/workspace-files/workspace-files";
import type {AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import type {ResolvedProjectWorkspace} from "nbook/server/workspace-files/project-identity";
import {projectWorkspacePathPolicy} from "nbook/server/workspace-files/project-workspace-path-policy";
import {toSqliteFileUrl} from "nbook/server/workspace-files/project-workspace";
import {collectReleasedSqliteHandles} from "nbook/server/workspace-files/sqlite-handle-release";
import type {WorkspaceFileTarget} from "nbook/server/workspace-files/workspace-file-target";
import {isWorkspaceStoragePath} from "nbook/server/workspace-files/workspace-storage-boundary";

const PROJECT_MANIFEST_PATH = "project.yaml";
const PROJECT_CONFIG_PATH = ".nbook/config.json";
const PROJECT_DATABASE_PATH = ".nbook/project.sqlite";
const HISTORY_DATABASE_PATH = ".nbook/history.sqlite";
const SQLITE_BUSY_TIMEOUT_MS = 5_000;
const STAGING_REMOVE_RETRY_DELAYS_MS = [0, 25, 100, 250] as const;

export type WorkspaceArchive = {
    root: AbsoluteFsPath;
    filename: string;
    stream: Readable;
};

/**
 * 创建当前 Workspace 目标的 zip 输出流。
 *
 * 显式 target 决定是否排除 Storage 根：user-assets 下载不导出 Storage 记录、锁与在途临时名，
 * 而同名普通目录 `notes/storage` 继续保留。完整 data 备份与 Project 归档另行保留正式记录。
 */
export async function createWorkspaceZipStream(target: WorkspaceFileTarget): Promise<WorkspaceArchive> {
    const root = target.root;
    const stat = await fs.stat(root);
    if (!stat.isDirectory()) {
        throw new Error("Workspace root is not a directory");
    }

    const ignoreRules = await readWorkspaceIgnoreRules(root);
    const zipFile = new ZipFile();
    await addWorkspaceEntries(zipFile, root, root, ignoreRules, (archivePath) => isWorkspaceStoragePath(target, archivePath));
    zipFile.end();

    return {
        root,
        filename: `${path.basename(root)}.zip`,
        stream: zipFile.outputStream,
    };
}

/**
 * 创建 Project Workspace 下载流。
 *
 * Project SQLite 与 History SQLite 均通过独立在线快照进入压缩包；实时主库及 WAL/SHM
 * 不会被直接复制。两个数据库分别一致，但不提供跨文件系统与数据库的全局事务快照。
 */
export async function createProjectWorkspaceZipStream(
    workspace: ResolvedProjectWorkspace,
): Promise<WorkspaceArchive> {
    const root = workspace.root;
    const stat = await fs.stat(root);
    if (!stat.isDirectory()) {
        throw new Error("Project Workspace root is not a directory");
    }

    const stagingRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nbook-project-archive-"));
    try {
        const manifestPath = path.join(root, PROJECT_MANIFEST_PATH);
        const configPath = path.join(root, PROJECT_CONFIG_PATH);
        const projectDatabasePath = path.join(root, PROJECT_DATABASE_PATH);
        const historyDatabasePath = path.join(root, HISTORY_DATABASE_PATH);
        await assertRegularFile(manifestPath, "Project Workspace 缺少 project.yaml");
        await assertRegularFile(projectDatabasePath, "Project Workspace 缺少 .nbook/project.sqlite");

        const projectSnapshotPath = path.join(stagingRoot, "project.sqlite");
        const historySnapshotPath = path.join(stagingRoot, "history.sqlite");
        await snapshotSqliteDatabase(projectDatabasePath, projectSnapshotPath, "Project SQLite");
        const hasHistoryDatabase = await optionalRegularFile(
            historyDatabasePath,
            "Project Workspace 的 .nbook/history.sqlite 不是普通文件",
        );
        if (hasHistoryDatabase) {
            await snapshotSqliteDatabase(historyDatabasePath, historySnapshotPath, "History SQLite");
        }

        const ignoreRules = await readWorkspaceIgnoreRules(root);
        const zipFile = new ZipFile();
        zipFile.addFile(manifestPath, PROJECT_MANIFEST_PATH);
        if (await optionalRegularFile(configPath, "Project Workspace 的 .nbook/config.json 不是普通文件")) {
            zipFile.addFile(configPath, PROJECT_CONFIG_PATH);
        }
        zipFile.addFile(projectSnapshotPath, PROJECT_DATABASE_PATH);
        if (hasHistoryDatabase) {
            zipFile.addFile(historySnapshotPath, HISTORY_DATABASE_PATH);
        }

        const excludedPaths = projectArchiveExcludedPaths();
        const isExcludedPath = (archivePath: string): boolean => excludedPaths.has(archivePath);
        await addWorkspaceEntries(zipFile, root, root, ignoreRules, isExcludedPath, {workspace, stagingRoot});
        attachStagingCleanup(zipFile.outputStream, stagingRoot);
        zipFile.end();

        return {
            root,
            filename: `${path.basename(root)}.zip`,
            stream: zipFile.outputStream,
        };
    } catch (error) {
        await removeArchiveStaging(stagingRoot);
        throw error;
    }
}

/**
 * 递归加入 workspace 文件；目录只在为空时写入 zip，文件保留相对路径。
 *
 * `isExcluded` 按归档路径判定整体跳过：Project 用它覆盖快照或强制 metadata 的 live 路径，
 * 普通下载用它排除 Storage 根，两者的子树都在递归前被剪掉。
 */
async function addWorkspaceEntries(
    zipFile: ZipFile,
    root: string,
    currentPath: string,
    ignoreRules: WorkspaceIgnoreRule[],
    isExcluded: (archivePath: string) => boolean = () => false,
    projectArchive?: {workspace: ResolvedProjectWorkspace; stagingRoot: string},
    inheritedIgnore: boolean = false,
): Promise<boolean> {
    const entries = await fs.readdir(currentPath, {withFileTypes: true});
    let added = false;

    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, "zh-Hans-CN"))) {
        const absolutePath = path.join(currentPath, entry.name);
        const archivePath = toArchivePath(root, absolutePath);
        if (isExcluded(archivePath)) {
            continue;
        }
        const policy = projectArchive
            ? projectWorkspacePathPolicy({workspace: projectArchive.workspace, relativePath: archivePath, consumer: "archive"})
            : null;
        if (policy?.disposition === "ignore") {
            continue;
        }
        const ignoredByWorkspaceRules = inheritedIgnore
            || shouldSkipWorkspacePath(root, absolutePath, entry.isDirectory(), ignoreRules);
        const skippedByIgnore = policy?.disposition !== "preserve" && ignoredByWorkspaceRules;
        // 根 .nbook 被忽略时仍寻找 policy 强制保留的子项，不自动纳入其他控制面文件。
        const controlDirectory = process.platform === "win32" ? archivePath.toLowerCase() : archivePath;
        const traverseForPreservedChildren = projectArchive && entry.isDirectory() && controlDirectory === ".nbook";
        if (skippedByIgnore && !traverseForPreservedChildren) {
            continue;
        }

        if (entry.isDirectory()) {
            const childAdded = await addWorkspaceEntries(
                zipFile,
                root,
                absolutePath,
                ignoreRules,
                isExcluded,
                projectArchive,
                skippedByIgnore,
            );
            if (!childAdded && !skippedByIgnore) {
                zipFile.addEmptyDirectory(`${archivePath}/`);
            }
            added = childAdded || !skippedByIgnore || added;
            continue;
        }

        if (entry.isFile()) {
            if (projectArchive && policy?.disposition === "preserve") {
                // yazl 会先 stat、稍后再打开源。先固定单文件快照，避免原子替换后大小与内容属于不同修订。
                const snapshotPath = path.join(projectArchive.stagingRoot, "preserved", archivePath);
                await fs.mkdir(path.dirname(snapshotPath), {recursive: true});
                await fs.copyFile(absolutePath, snapshotPath);
                zipFile.addFile(snapshotPath, archivePath);
            } else {
                zipFile.addFile(absolutePath, archivePath);
            }
            added = true;
        }
    }

    return added;
}

/**
 * 把绝对路径转成 zip 内使用的 POSIX 相对路径。
 */
function toArchivePath(root: string, absolutePath: string): string {
    return path.relative(root, absolutePath).split(path.sep).join("/");
}

/** 确认 Project 下载契约要求的路径是普通文件。 */
async function assertRegularFile(filePath: string, message: string): Promise<void> {
    try {
        const stat = await fs.stat(filePath);
        if (!stat.isFile()) {
            throw new Error(message);
        }
    } catch (error) {
        if (isMissingPathError(error)) {
            throw new Error(message, {cause: error});
        }
        throw error;
    }
}

/** 可选文件仅在真实缺失时返回 false；权限和其他 I/O 错误不得伪装成缺失。 */
async function optionalRegularFile(filePath: string, message: string): Promise<boolean> {
    try {
        const stat = await fs.stat(filePath);
        if (!stat.isFile()) {
            throw new Error(message);
        }
        return true;
    } catch (error) {
        if (isMissingPathError(error)) {
            return false;
        }
        throw error;
    }
}

/** 使用独立 libsql 连接把在线数据库压缩为单文件快照，并校验输出完整性。 */
async function snapshotSqliteDatabase(sourcePath: string, outputPath: string, label: string): Promise<void> {
    const source = createClient({url: toSqliteFileUrl(sourcePath)});
    try {
        await source.execute(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
        await source.execute({sql: "VACUUM INTO ?", args: [outputPath]});
    } catch (error) {
        throw new Error(`${label} 在线快照失败`, {cause: error});
    } finally {
        await source.close();
        collectReleasedSqliteHandles();
    }

    const snapshot = createClient({url: toSqliteFileUrl(outputPath)});
    try {
        const result = await snapshot.execute("PRAGMA quick_check");
        const failures = result.rows
            .map((row) => String(row["quick_check"] ?? ""))
            .filter((value) => value !== "ok");
        if (failures.length > 0 || result.rows.length === 0) {
            throw new Error(failures.join("; ") || "quick_check 未返回结果");
        }
    } catch (error) {
        throw new Error(`${label} 快照完整性校验失败`, {cause: error});
    } finally {
        await snapshot.close();
        collectReleasedSqliteHandles();
    }
}

/** Project 归档由快照或强制 metadata 覆盖的 live 路径，递归枚举时必须跳过。 */
function projectArchiveExcludedPaths(): ReadonlySet<string> {
    return new Set([
        PROJECT_MANIFEST_PATH,
        PROJECT_CONFIG_PATH,
        PROJECT_DATABASE_PATH,
        `${PROJECT_DATABASE_PATH}-wal`,
        `${PROJECT_DATABASE_PATH}-shm`,
        HISTORY_DATABASE_PATH,
        `${HISTORY_DATABASE_PATH}-wal`,
        `${HISTORY_DATABASE_PATH}-shm`,
    ]);
}

/** 归档流结束、关闭或失败后幂等清理 OS 临时 staging。 */
function attachStagingCleanup(stream: Readable, stagingRoot: string): void {
    let cleanup: Promise<void> | null = null;
    const run = (): void => {
        cleanup ??= removeArchiveStaging(stagingRoot);
        void cleanup;
    };
    stream.once("end", run);
    stream.once("close", run);
    stream.once("error", run);
}

/** Windows 文件句柄释放可能稍晚；仅对 EBUSY/EPERM 做有限重试。 */
async function removeArchiveStaging(stagingRoot: string): Promise<void> {
    let lastError: unknown = null;
    for (const delayMs of STAGING_REMOVE_RETRY_DELAYS_MS) {
        if (delayMs > 0) {
            await setTimeout(delayMs);
        }
        try {
            await fs.rm(stagingRoot, {recursive: true, force: true});
            return;
        } catch (error) {
            lastError = error;
            if (!isRetryableRemoveError(error)) {
                break;
            }
            collectReleasedSqliteHandles({force: true});
        }
    }
    consola.warn({stagingRoot, error: lastError}, "Project Workspace 下载临时目录清理失败");
}

/** 判断扫描或强制文件检查是否遇到路径消失。 */
function isMissingPathError(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

/** 判断 Windows 删除失败是否值得等待句柄释放后重试。 */
function isRetryableRemoveError(error: unknown): boolean {
    return typeof error === "object"
        && error !== null
        && "code" in error
        && (error.code === "EBUSY" || error.code === "EPERM");
}
