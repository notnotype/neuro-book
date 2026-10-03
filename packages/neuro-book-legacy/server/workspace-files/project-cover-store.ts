import {createHash, randomUUID} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
    absoluteFsPath,
    assertRealPathContained,
    type AbsoluteFsPath,
} from "nbook/server/runtime/paths/file-path";
import type {
    ResolvedProjectWorkspace,
    WorkspaceRelativePath,
} from "nbook/server/workspace-files/project-identity";

const MANAGED_COVER_ROOT = "assets/project-covers";
const MANAGED_COVER_NAME = /^[a-f0-9]{64}\.(?:png|jpg|webp)$/u;

export type ProjectCoverExtension = "jpg" | "png" | "webp";

/** Lifecycle 已接纳、但仍保持原始 bytes 的 Project 封面内容。 */
export type ProjectCoverUpload = Readonly<{
    bytes: Uint8Array;
    extension: ProjectCoverExtension;
}>;

/** 已发布内容寻址文件；created 决定 manifest 失败时是否需要回滚。 */
export type PublishedProjectCover = Readonly<{
    path: string;
    hash: string;
    created: boolean;
    cleanupIssues: readonly ProjectCoverCleanupIssue[];
}>;

/** 成功提交后清理旧托管文件的旁路诊断，不暴露绝对路径。 */
export type ProjectCoverCleanupIssue = Readonly<{
    path: WorkspaceRelativePath;
    error: unknown;
}>;

/**
 * Project Workspace 内应用托管封面的文件存储。
 *
 * 本 Module 不写 manifest，也不决定事务 committed 状态；Lifecycle 是唯一编排者。
 */
export class ProjectCoverStore {
    /** 原子发布原始 bytes 到内容寻址路径；相同内容已存在时幂等复用。 */
    async publish(
        workspace: ResolvedProjectWorkspace,
        upload: ProjectCoverUpload,
    ): Promise<PublishedProjectCover> {
        const bytes = Buffer.from(upload.bytes);
        const hash = createHash("sha256").update(bytes).digest("hex");
        const relativePath = `${MANAGED_COVER_ROOT}/${hash}.${upload.extension}`;
        const managedRoot = absoluteFsPath(path.join(workspace.root, ...MANAGED_COVER_ROOT.split("/")));
        const target = absoluteFsPath(path.join(managedRoot, `${hash}.${upload.extension}`));
        const transactionRoot = absoluteFsPath(path.join(workspace.root, ".nbook", "transactions"));
        const temporary = absoluteFsPath(path.join(transactionRoot, `project-cover-${randomUUID()}.tmp`));

        await fs.mkdir(managedRoot, {recursive: true});
        await fs.mkdir(transactionRoot, {recursive: true});
        await assertRealPathContained(workspace.root, managedRoot);
        await assertRealPathContained(workspace.root, transactionRoot);
        if (await this.matches(target, hash)) {
            return Object.freeze({path: relativePath, hash, created: false, cleanupIssues: Object.freeze([])});
        }

        let created = false;
        try {
            const handle = await fs.open(temporary, "wx");
            try {
                await handle.writeFile(bytes);
                await handle.sync();
            } finally {
                await handle.close();
            }
            await assertRealPathContained(workspace.root, target);
            try {
                await fs.link(temporary, target);
                created = true;
            } catch (error) {
                if (isAlreadyExistsError(error) && await this.matches(target, hash)) {
                    created = false;
                } else {
                    throw error;
                }
            }
        } catch (cause) {
            try {
                await fs.rm(temporary, {force: true});
            } catch (cleanupError) {
                throw new AggregateError([cause, cleanupError], "Project 封面发布失败且 transaction temp 未清理");
            }
            throw cause;
        }
        let cleanupIssues: readonly ProjectCoverCleanupIssue[] = Object.freeze([]);
        try {
            await fs.rm(temporary, {force: true});
        } catch (error) {
            cleanupIssues = Object.freeze([
                this.cleanupIssue(workspace, `.nbook/transactions/${path.basename(temporary)}`, error),
            ]);
        }
        return Object.freeze({path: relativePath, hash, created, cleanupIssues});
    }

    /** manifest 已知未提交时，仅删除本次新建且仍匹配内容哈希的原图。 */
    async rollback(
        workspace: ResolvedProjectWorkspace,
        published: PublishedProjectCover,
    ): Promise<void> {
        if (!published.created) {
            return;
        }
        const target = absoluteFsPath(path.join(workspace.root, ...published.path.split("/")));
        await assertRealPathContained(workspace.root, target);
        if (!await this.matches(target, published.hash)) {
            throw new Error("待回滚的 Project 封面已经被外部替换");
        }
        await fs.rm(target, {force: true});
    }

    /**
     * 成功提交后把托管目录收口到当前 manifest 引用。
     *
     * 手工配置在其他目录的封面不属于本 Module；这里仅识别内容寻址文件名。
     */
    async converge(
        workspace: ResolvedProjectWorkspace,
        currentCover: string | undefined,
    ): Promise<readonly ProjectCoverCleanupIssue[]> {
        const managedRoot = absoluteFsPath(path.join(workspace.root, ...MANAGED_COVER_ROOT.split("/")));
        try {
            await assertRealPathContained(workspace.root, managedRoot);
        } catch (error) {
            if (isMissingPathError(error)) {
                return Object.freeze([]);
            }
            return Object.freeze([this.cleanupIssue(workspace, MANAGED_COVER_ROOT, error)]);
        }
        let names: string[];
        try {
            names = await fs.readdir(managedRoot);
        } catch (error) {
            if (isMissingPathError(error)) {
                return Object.freeze([]);
            }
            return Object.freeze([this.cleanupIssue(workspace, MANAGED_COVER_ROOT, error)]);
        }

        const currentName = currentCover?.startsWith(`${MANAGED_COVER_ROOT}/`)
            ? currentCover.slice(MANAGED_COVER_ROOT.length + 1)
            : undefined;
        const issues: ProjectCoverCleanupIssue[] = [];
        for (const name of names) {
            if (!MANAGED_COVER_NAME.test(name) || name === currentName) {
                continue;
            }
            const target = absoluteFsPath(path.join(managedRoot, name));
            try {
                await fs.rm(target, {force: true});
            } catch (error) {
                issues.push(this.cleanupIssue(workspace, `${MANAGED_COVER_ROOT}/${name}`, error));
            }
        }
        return Object.freeze(issues);
    }

    /** 只把相对 Project 内容路径投影到 Workspace Root-relative diagnostics。 */
    private cleanupIssue(
        workspace: ResolvedProjectWorkspace,
        relativePath: string,
        error: unknown,
    ): ProjectCoverCleanupIssue {
        return Object.freeze({
            path: `${workspace.ref.projectRoot}/${relativePath}` as WorkspaceRelativePath,
            error,
        });
    }

    /** 现有内容寻址文件必须是普通文件且 bytes 与文件名哈希一致。 */
    private async matches(target: AbsoluteFsPath, expectedHash: string): Promise<boolean> {
        try {
            const entryStat = await fs.lstat(target);
            if (!entryStat.isFile() || entryStat.isSymbolicLink()) {
                throw new Error("Project 封面内容寻址路径不是普通文件");
            }
            const bytes = await fs.readFile(target);
            if (createHash("sha256").update(bytes).digest("hex") !== expectedHash) {
                throw new Error("Project 封面内容寻址文件与文件名哈希不一致");
            }
            return true;
        } catch (error) {
            if (isMissingPathError(error)) {
                return false;
            }
            throw error;
        }
    }
}

/** 判断底层 I/O 是否只表示路径缺失。 */
function isMissingPathError(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

/** 判断原子 no-replace 发布是否输给了同路径并发发布。 */
function isAlreadyExistsError(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}
