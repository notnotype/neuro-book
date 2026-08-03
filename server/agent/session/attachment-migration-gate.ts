import {access} from "node:fs/promises";
import {dirname, join} from "node:path";
import {
    acquireAgentSessionStoreLease,
    acquireAgentSessionStoreLeaseSync,
    AGENT_SESSION_STORE_LEASE_RELATIVE_PATH,
} from "nbook/server/agent/session/agent-session-store-lease";

/** Attachment 硬切迁移使用的 Workspace Root 级 sentinel 相对路径。 */
export const ATTACHMENT_MIGRATION_LOCK_RELATIVE_PATH = join(
    ".nbook",
    "agent",
    "migrations",
    "attachment-v1.lock",
);
export const ATTACHMENT_RUNTIME_LEASE_RELATIVE_PATH = AGENT_SESSION_STORE_LEASE_RELATIVE_PATH;

const runtimeSyncLeases = new Map<string, {release: () => void; refs: number}>();

/** 迁移 sentinel 存在时，session repository 禁止继续写入。 */
export class AttachmentMigrationInProgressError extends Error {
    readonly code = "ATTACHMENT_MIGRATION_IN_PROGRESS" as const;

    constructor() {
        super("Attachment 迁移正在进行，暂时禁止写入 Agent session。");
        this.name = "AttachmentMigrationInProgressError";
    }
}

/** 判断错误是否表示 Attachment 迁移正在占用 Workspace Root。 */
export function isAttachmentMigrationInProgressError(error: unknown): error is AttachmentMigrationInProgressError {
    return error instanceof AttachmentMigrationInProgressError;
}

/**
 * 读取 Attachment 迁移 sentinel，作为 session repository 的第二道写入门禁。
 *
 * 本类不负责创建、更新或删除 lock；这些动作属于一次性迁移脚本。只要 lock
 * 文件存在（即使内容损坏或为空），所有调用方都必须 fail closed，不能尝试
 * 猜测 lock 是否过期后自行放行。
 */
export class AttachmentMigrationGate {
    readonly lockPath: string;
    private readonly rootWorkspace: string;

    constructor(rootWorkspace: string) {
        this.rootWorkspace = rootWorkspace;
        this.lockPath = join(rootWorkspace, ATTACHMENT_MIGRATION_LOCK_RELATIVE_PATH);
    }

    /** 迁移 lock 所在目录，供迁移脚本创建 sentinel 时复用。 */
    get lockDirectory(): string {
        return dirname(this.lockPath);
    }

    /** 迁移与运行时共用的 Workspace Root 进程租约路径。 */
    get runtimeLeasePath(): string {
        return join(dirname(this.lockPath), "runtime.lease");
    }

    /**
     * 获取运行时全生命周期租约。相同进程内的多个 Harness 共享一个租约，
     * 迁移脚本无法在 Agent 仍运行时取得同一租约，从根上消除 sentinel TOCTOU。
     */
    async acquireRuntimeLease(): Promise<() => Promise<void>> {
        return acquireAgentSessionStoreLease(this.rootWorkspace, "migration");
    }

    /** 同步获取启动期租约，保证 Harness 构造完成前迁移无法插入。 */
    acquireRuntimeLeaseSync(): () => void {
        const existing = runtimeSyncLeases.get(this.runtimeLeasePath);
        if (existing) {
            existing.refs += 1;
            return () => this.releaseRuntimeLeaseSync(this.runtimeLeasePath);
        }
        const release = acquireAgentSessionStoreLeaseSync(this.rootWorkspace, "runtime");
        runtimeSyncLeases.set(this.runtimeLeasePath, {release, refs: 1});
        return () => this.releaseRuntimeLeaseSync(this.runtimeLeasePath);
    }

    private releaseRuntimeLeaseSync(path: string): void {
        const lease = runtimeSyncLeases.get(path);
        if (!lease) return;
        lease.refs -= 1;
        if (lease.refs > 0) return;
        runtimeSyncLeases.delete(path);
        lease.release();
    }

    /** lock 存在时抛出稳定错误；不存在时允许继续写入。 */
    async assertWritable(): Promise<void> {
        try {
            await access(this.lockPath);
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (code === "ENOENT") {
                return;
            }
            throw error;
        }
        throw new AttachmentMigrationInProgressError();
    }
}
