import {randomUUID} from "node:crypto";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import * as fs from "node:fs";
import {readFile} from "node:fs/promises";
import {createError} from "h3";
import type {FetchError} from "ofetch";
import type {PassportBackupDto, PassportJobDto, PassportJobProgress} from "nbook/shared/dto/passport.dto";
import {redactSensitiveText} from "nbook/runtime/diagnostics/diagnostics";
import type {RuntimePaths} from "nbook/server/runtime/paths/runtime-paths";
import {BackupArchiveService} from "nbook/server/backup/backup-archive-service";
import {BackupRestoreService} from "nbook/server/backup/backup-restore-service";
import {useBackupKeyringService} from "nbook/server/backup/backup-keyring-service";
import {usePassportClient} from "nbook/server/passport/passport-client-service";
import {officialSiteFetch} from "nbook/server/passport/official-site-transport";

// 备份/恢复后台任务管理器（Task 112）：打包与传输耗时可能远超请求超时，
// 路由只负责启动任务并立即返回 jobId，前端轮询任务状态。
// 同一时刻只允许一个任务在跑（备份与恢复互斥，避免打包到一半的数据被恢复覆盖）。

type JobInternal = {
    id: string;
    kind: "backup" | "restore";
    state: "running" | "done" | "error";
    progress: PassportJobProgress | null;
    error: string | null;
    backup: PassportBackupDto | null;
    restore: {restoreDir: string; fileCount: number; appVersion: string} | null;
    warnings: string[];
    startedAt: number;
};

/** 已结束任务的保留数量（防 Map 无界增长） */
const FINISHED_JOB_KEEP = 20;

/**
 * 把归档文件包成 Blob：优先 openAsBlob（零拷贝流式），运行时不支持则整读兜底。
 */
async function fileAsBlob(path: string): Promise<Blob> {
    try {
        if (typeof fs.openAsBlob === "function") {
            return await fs.openAsBlob(path, {type: "application/vnd.neurobook.backup"});
        }
    } catch {
        // 落到整读兜底
    }
    return new Blob([await readFile(path)], {type: "application/vnd.neurobook.backup"});
}

export class PassportJobManager {
    private jobs = new Map<string, JobInternal>();

    /**
     * 查询任务；不存在返回 null。
     */
    job(jobId: string): PassportJobDto | null {
        const job = this.jobs.get(jobId);
        if (!job) {
            return null;
        }
        return {
            id: job.id,
            kind: job.kind,
            state: job.state,
            progress: job.progress,
            error: job.error,
            backup: job.backup,
            restore: job.restore,
            warnings: job.warnings,
        };
    }

    /**
     * 启动云备份任务：打包 State Root → 上传官方站。已有任务在跑时抛 409。
     */
    startBackup(paths: RuntimePaths, comment: string): string {
        const job = this.createJob("backup");
        void this.runBackup(job, paths, comment);
        return job.id;
    }

    /**
     * 启动恢复任务：下载归档 → 校验 → 解包到 State Root 同级 restore 目录。
     */
    startRestore(paths: RuntimePaths, backupId: number): string {
        const job = this.createJob("restore");
        void this.runRestore(job, paths, backupId);
        return job.id;
    }

    private createJob(kind: "backup" | "restore"): JobInternal {
        const running = [...this.jobs.values()].find((job) => job.state === "running");
        if (running) {
            throw createError({statusCode: 409, message: running.kind === "backup" ? "已有备份任务在进行中" : "已有恢复任务在进行中"});
        }
        const job: JobInternal = {
            id: randomUUID(),
            kind,
            state: "running",
            progress: null,
            error: null,
            backup: null,
            restore: null,
            warnings: [],
            startedAt: Date.now(),
        };
        this.jobs.set(job.id, job);
        this.pruneFinished();
        return job;
    }

    private async runBackup(job: JobInternal, paths: RuntimePaths, comment: string): Promise<void> {
        let tmpDir: string | null = null;
        try {
            const client = usePassportClient();
            // 打包前先确认凭据可用，避免打包几分钟后才发现未关联
            await client.getAccessToken();
            const encryptionKey = await useBackupKeyringService().activeKey(paths);
            if (!encryptionKey) {
                throw new Error("请先保存并确认云备份恢复码");
            }

            tmpDir = await mkdtemp(join(tmpdir(), "nbook-backup-"));
            const archive = await new BackupArchiveService().createArchive(paths, tmpDir, encryptionKey, (done, total) => {
                job.progress = {phase: "packing", done, total};
            });
            job.warnings = archive.warnings;

            job.progress = {phase: "uploading", done: 0, total: archive.fileSize};
            // token 可能在长打包期间过期，上传前再取一次（缓存命中则无额外请求）
            const token = await client.getAccessToken();
            const form = new FormData();
            form.append("meta", JSON.stringify({
                sha256: archive.sha256,
                keyId: archive.keyId,
                appVersion: archive.appVersion,
                kind: "manual",
                comment,
                rotate: false,
            }));
            form.append("file", await fileAsBlob(archive.backupPath), "backup.nbbackup");
            try {
                job.backup = await officialSiteFetch<PassportBackupDto>("backup.upload", "/api/v1/backups", {
                    method: "POST",
                    headers: {authorization: `Bearer ${token}`},
                    body: form,
                }, null);
            } catch (error) {
                const fetchError = error as FetchError<{message?: string; data?: {error?: string}}>;
                if (fetchError?.data?.data?.error === "quota_exceeded") {
                    throw new Error("云端备份配额不足：请在官方站或下方列表删除旧备份后重试");
                }
                if (fetchError?.data?.data?.error === "storage_capacity_exceeded") {
                    throw new Error("官方站存储空间不足，请删除旧文件或稍后重试");
                }
                throw error;
            }
            job.state = "done";
            job.progress = null;
        } catch (error) {
            job.state = "error";
            job.error = redactSensitiveText(error instanceof Error ? error.message : String(error));
        } finally {
            if (tmpDir) {
                await rm(tmpDir, {recursive: true, force: true}).catch(() => undefined);
            }
        }
    }

    private async runRestore(job: JobInternal, paths: RuntimePaths, backupId: number): Promise<void> {
        try {
            const client = usePassportClient();
            const token = await client.getAccessToken();
            // 先取云端元数据：sha256 真相源 + 下载进度总量
            const meta = await officialSiteFetch<PassportBackupDto>("backup.metadata", `/api/v1/backups/${backupId}`, {
                headers: {authorization: `Bearer ${token}`},
            });
            const encryptionKey = await useBackupKeyringService().key(paths, meta.keyId);
            if (!encryptionKey) {
                throw new Error(`本地缺少备份所需密钥（keyId: ${meta.keyId}），请先导入恢复码`);
            }
            job.restore = null;
            const result = await new BackupRestoreService().restore({
                paths,
                token,
                backupId,
                expectedSha256: meta.sha256,
                expectedKeyId: meta.keyId,
                encryptionKey,
                fileSizeHint: meta.fileSize,
                onProgress: (phase, done, total) => {
                    job.progress = {phase, done, total};
                },
            });
            job.restore = result;
            job.state = "done";
            job.progress = null;
        } catch (error) {
            job.state = "error";
            job.error = redactSensitiveText(error instanceof Error ? error.message : String(error));
        }
    }

    /** 清理最旧的已结束任务 */
    private pruneFinished(): void {
        const finished = [...this.jobs.values()]
            .filter((job) => job.state !== "running")
            .sort((left, right) => left.startedAt - right.startedAt);
        while (finished.length > FINISHED_JOB_KEEP) {
            const oldest = finished.shift();
            if (oldest) {
                this.jobs.delete(oldest.id);
            }
        }
    }
}

type GlobalJobManager = {
    passportJobManager?: PassportJobManager;
};

const globalForJobs = globalThis as typeof globalThis & GlobalJobManager;

/**
 * 进程级单例：任务状态必须跨请求共享。
 */
export function usePassportJobManager(): PassportJobManager {
    if (!globalForJobs.passportJobManager) {
        globalForJobs.passportJobManager = new PassportJobManager();
    }
    return globalForJobs.passportJobManager;
}
