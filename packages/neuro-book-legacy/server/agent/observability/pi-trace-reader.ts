/**
 * Pi 请求 trace 只读 reader，与 PiRequestRecorder 共享目录布局：
 *   <tracesRoot>/<bucket>/<seq>.json + <bucket>/index.jsonl
 *
 * 设计约束（将来与 recorder 一起抽成独立库）：
 * - 零外部依赖（只有 node:fs + recorder 的类型/布局约定）；tracesRoot 由调用方注入
 *   （NeuroBook 内为 `repo.tracesRoot`）。
 * - 目录或文件不存在一律返回空态：trace 功能关闭时查看器显示空列表，不报错。
 * - bucket/id 来自 HTTP 路径参数且直接拼文件路径，必须过 isValidTraceBucket/isValidTraceId
 *   白名单（防路径穿越）；reader 方法内部同样校验兜底，非法入参直接 throw，由 HTTP 层转状态码。
 */
import {readFile, readdir} from "node:fs/promises";
import {join} from "node:path";
import {isValidTraceBucket, isValidTraceId} from "nbook/server/agent/observability/pi-request-recorder";
import type {PiTraceIndexEntry, PiTraceRecord} from "nbook/server/agent/observability/pi-request-recorder";

// 校验函数定义在 recorder（bucket 命名规则属于 writer），这里 re-export 保持路由的 import 面不变。
export {isValidTraceBucket, isValidTraceId} from "nbook/server/agent/observability/pi-request-recorder";

/** bucket 汇总行，查看器的 bucket 下拉用。 */
export type PiTraceBucketSummary = {
    bucket: string;
    /** 该 bucket 当前保留的记录条数（retention 裁剪后）。 */
    count: number;
    /** 最新一条记录的时间戳；index 为空时缺省。 */
    lastTs?: string;
};

export class PiTraceReader {
    private readonly tracesRoot: string;

    constructor(input: {tracesRoot: string}) {
        this.tracesRoot = input.tracesRoot;
    }

    /** 列出所有有记录的 bucket，按最新记录时间倒序。 */
    async listBuckets(): Promise<PiTraceBucketSummary[]> {
        const entries = await readdir(this.tracesRoot, {withFileTypes: true}).catch(() => []);
        const summaries: PiTraceBucketSummary[] = [];
        for (const entry of entries) {
            if (!entry.isDirectory() || !isValidTraceBucket(entry.name)) {
                continue;
            }
            const index = await this.listIndex(entry.name);
            if (index.length === 0) {
                continue;
            }
            summaries.push({bucket: entry.name, count: index.length, lastTs: index[0]?.ts});
        }
        return summaries.sort((a, b) => (b.lastTs ?? "").localeCompare(a.lastTs ?? ""));
    }

    /** 读某 bucket 的 index 条目，最新在前。坏行（进程崩溃截断的尾行）直接跳过。 */
    async listIndex(bucket: string): Promise<PiTraceIndexEntry[]> {
        assertBucket(bucket);
        const raw = await readFile(join(this.tracesRoot, bucket, "index.jsonl"), "utf8").catch(() => "");
        const parsed: PiTraceIndexEntry[] = [];
        for (const line of raw.split("\n")) {
            if (!line.trim()) {
                continue;
            }
            try {
                parsed.push(JSON.parse(line) as PiTraceIndexEntry);
            } catch {
                // 崩溃截断的坏行不致命，跳过
            }
        }
        return parsed.reverse();
    }

    /** 跨所有 bucket 聚合最近记录：各 bucket index 合并按 ts 倒序取前 limit 条，并打上来源 bucket（目录名）。 */
    async listRecent(limit: number): Promise<Array<PiTraceIndexEntry & {bucket: string}>> {
        const dirents = await readdir(this.tracesRoot, {withFileTypes: true}).catch(() => []);
        const merged: Array<PiTraceIndexEntry & {bucket: string}> = [];
        for (const dirent of dirents) {
            if (!dirent.isDirectory() || !isValidTraceBucket(dirent.name)) {
                continue;
            }
            for (const entry of await this.listIndex(dirent.name)) {
                merged.push({...entry, bucket: dirent.name});
            }
        }
        return merged.sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, Math.max(limit, 0));
    }

    /** 读单条完整记录；文件不存在（已被 retention 清理）或损坏时返回 null。 */
    async readRecord(bucket: string, id: string): Promise<PiTraceRecord | null> {
        assertBucket(bucket);
        if (!isValidTraceId(id)) {
            throw new Error(`非法 trace id：${id}`);
        }
        try {
            return JSON.parse(await readFile(join(this.tracesRoot, bucket, `${id}.json`), "utf8")) as PiTraceRecord;
        } catch {
            return null;
        }
    }
}

function assertBucket(bucket: string): void {
    if (!isValidTraceBucket(bucket)) {
        throw new Error(`非法 trace bucket：${bucket}`);
    }
}
