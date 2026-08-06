import {randomUUID} from "node:crypto";
import {existsSync} from "node:fs";
import {mkdir, open, readdir, readFile, rename, rm} from "node:fs/promises";
import {basename, join} from "node:path";
import {z} from "zod";
import {
    AgentJobSnapshotSchema,
    type AgentJobSnapshot,
    type JsonValue,
} from "nbook/shared/dto/agent-job.dto";

const DurableJsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(DurableJsonValueSchema),
    z.record(z.string(), DurableJsonValueSchema),
]));

const DurableAgentJobDeliverySchema = z.object({
    deliveryId: z.string().min(1),
    clientMessageId: z.string().uuid(),
    message: z.string().optional(),
    /** accepted 后的私有 admission 证据；queued 需要在重启时重新触发 drain。 */
    acceptedState: z.enum(["queued", "persisted"]).optional(),
}).strict();

const DurableAgentJobRecordSchema = z.object({
    schemaVersion: z.literal(1),
    snapshot: AgentJobSnapshotSchema,
    result: DurableJsonValueSchema.optional(),
    detail: DurableJsonValueSchema.optional(),
    workflowRun: DurableJsonValueSchema.optional(),
    delivery: DurableAgentJobDeliverySchema.optional(),
}).strict();

export type DurableAgentJobDelivery = z.infer<typeof DurableAgentJobDeliverySchema>;

export type DurableAgentJobRecord = {
    schemaVersion: 1;
    snapshot: AgentJobSnapshot;
    result?: JsonValue;
    detail?: JsonValue;
    workflowRun?: JsonValue;
    delivery?: DurableAgentJobDelivery;
};

/**
 * 每 Job 一个私有 JSON 文件的 durable store。
 *
 * 写入先在目标目录创建临时文件，fsync 文件后再原子 rename；目录 fsync 在平台支持时补做。
 */
export class AgentJobDurableStore {
    constructor(readonly root: string) {}

    get enabled(): boolean {
        return this.root.length > 0;
    }

    async write(record: DurableAgentJobRecord): Promise<void> {
        if (!this.enabled) {
            return;
        }
        const parsed = DurableAgentJobRecordSchema.parse(record);
        const target = this.pathFor(parsed.snapshot.jobId);
        await mkdir(this.root, {recursive: true});
        const temporary = join(this.root, `.${basename(target)}.${randomUUID()}.tmp`);
        let handle: Awaited<ReturnType<typeof open>> | null = null;
        try {
            handle = await open(temporary, "wx", 0o600);
            await handle.writeFile(`${JSON.stringify(parsed)}\n`, "utf8");
            await handle.sync();
            await handle.close();
            handle = null;
            await rename(temporary, target);
            await this.syncDirectoryBestEffort();
        } catch (error) {
            await handle?.close().catch(() => undefined);
            await rm(temporary, {force: true}).catch(() => undefined);
            throw error;
        }
    }

    async read(jobId: string): Promise<DurableAgentJobRecord | null> {
        if (!this.enabled) {
            return null;
        }
        const path = this.pathFor(jobId);
        if (!existsSync(path)) {
            return null;
        }
        const parsed = DurableAgentJobRecordSchema.parse(JSON.parse(await readFile(path, "utf8")));
        if (parsed.snapshot.jobId !== jobId) {
            throw new Error(`Agent Job durable 文件身份不匹配：${jobId}`);
        }
        return parsed;
    }

    async listJobIds(): Promise<string[]> {
        if (!this.enabled || !existsSync(this.root)) {
            return [];
        }
        const entries = await readdir(this.root, {withFileTypes: true});
        return entries
            .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
            .map((entry) => entry.name.slice(0, -".json".length))
            .filter((jobId) => isSafeJobId(jobId))
            .sort();
    }

    async delete(jobId: string): Promise<void> {
        if (!this.enabled) {
            return;
        }
        await rm(this.pathFor(jobId), {force: true});
        await this.syncDirectoryBestEffort();
    }

    private pathFor(jobId: string): string {
        if (!isSafeJobId(jobId)) {
            throw new Error(`Agent Job ID 不能用于 durable 文件名：${jobId}`);
        }
        return join(this.root, `${jobId}.json`);
    }

    private async syncDirectoryBestEffort(): Promise<void> {
        let handle: Awaited<ReturnType<typeof open>> | null = null;
        try {
            handle = await open(this.root, "r");
            await handle.sync();
        } catch (error) {
            if (!isUnsupportedDirectorySync(error)) {
                throw error;
            }
        } finally {
            await handle?.close().catch(() => undefined);
        }
    }
}

function isSafeJobId(jobId: string): boolean {
    return /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(jobId);
}

function isUnsupportedDirectorySync(error: unknown): boolean {
    if (!(error instanceof Error) || !("code" in error)) {
        return false;
    }
    return error.code === "EISDIR"
        || error.code === "EPERM"
        || error.code === "EINVAL"
        || error.code === "EBADF";
}
