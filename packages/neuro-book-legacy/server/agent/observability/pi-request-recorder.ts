/**
 * Pi 请求可观测：通用 trace 记录 writer。
 *
 * 只认 pi 层事实 + 一个开放 correlation；不解释领域字段。负责把 traced-provider
 * 组装好的记录落成本地文件、维护每 bucket retention 与轻量 index，全部 best-effort
 * （写失败经注入的 onWriteError 上报，不炸调用方）。写入串行化，避免 seq 分配 /
 * prune / clearBucket / index 重写并发交错。
 *
 * 零外部依赖（只有 node:fs / node:path），存储根目录 tracesRoot 由调用方注入
 * （NeuroBook 内为 `repo.tracesRoot`，即 `.nbook/agent/traces`），便于将来整体抽成独立库。布局：
 *   <tracesRoot>/traces-seq.json        全局单调计数器（镜像 session-seq.json）
 *   <tracesRoot>/<bucket>/<id>.json     单条完整记录（bucket = sessionId 或 _system）
 *   <tracesRoot>/<bucket>/index.jsonl   每 bucket 汇总行（列表只读它，不读全量 payload）
 *
 * 隐私边界：traces 刻意保留完整 prompt / 请求体，因此绝不进入 task 72 的可分享日志包；
 * onWriteError 只收到异常对象，绝不把 payload 交给回调。
 */
import {appendFile, mkdir, readFile, readdir, rm, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";

/** trace 来源分类。turn = 主 ReAct 轮次；compaction = 压缩摘要；health-check = 模型连通性 smoke。 */
export type PiTraceKind = "turn" | "compaction" | "health-check";

/** 领域关联字段，由调用方（harness）填。除 kind 外都可选（compaction/health-check 可能缺）。 */
export type PiTraceCorrelation = {
    kind: PiTraceKind;
    sessionId?: number;
    invocationId?: string;
    profileKey?: string;
    turnIndex?: number;
    /** 运行形态：caller.kind（user/agent/system）。 */
    mode?: string;
};

/**
 * Prompt 分区种类（Task 126）。
 *
 * 前五种对齐 Profile DSL 的 Prompt 分区合同；`system` / `tools` 是不在 messages
 * 数组里的两个额外开销面，`conversation` 是普通对话流量。
 */
export type PiTraceSegmentKind =
    | "system"
    | "tools"
    | "historySet"
    | "conversation"
    | "modelContext"
    | "appending"
    | "currentInput";

/** 一个 prompt 分区。同一 kind 允许出现多段（历史里散落的旧提醒与本轮提醒之间隔着对话）。 */
export type PiTraceSegment = {
    kind: PiTraceSegmentKind;
    /** messages 数组下标区间 [start, end)；system / tools 不在 messages 里，为 null。 */
    range: {start: number; end: number} | null;
    /** 与区间内消息一一对应的 Profile DSL 来源名；无来源的位置为 null。整段无来源时省略本字段。 */
    labels?: (readonly string[] | null)[];
    /** 纯估算（chars/4，与 compaction 同口径）。真实值由消费方按 provider usage 比例校准。 */
    estimatedTokens: number;
};

/** 请求侧（pi 层）。context = pi 规范化（跨 provider 统一），payload = provider 原生（wire-truth）。 */
export type PiTraceRequest = {
    provider: string;
    api: string;
    model: string;
    baseUrl?: string;
    reasoning?: string;
    /** pi 规范化上下文（systemPrompt/messages/tools），供 UI 归一化渲染。 */
    context?: unknown;
    /** 上下文分区归因；调用方未提供前缀归因时缺省（compaction / health-check 等无 profile prepare 的调用）。 */
    segments?: PiTraceSegment[];
    /**
     * 归因来源。缺省等同 `full`；`legacy` 表示该 session 建于归因功能之前，
     * 分区由位置推断而来，HistorySet 与首轮提醒未分开。
     */
    attribution?: "full" | "legacy";
    /** 工具集指纹；用于跨请求检测工具变化导致的缓存断点前移。无工具时缺省。 */
    toolsHash?: string;
    /** onPayload 拿到的 provider 原生请求体；capturePayload 关时为 undefined。 */
    payload?: unknown;
    /** 原生 payload 因安全边界被主动省略时说明原因。 */
    payloadOmittedReason?: "attachment";
};

/** 响应侧健康度。失败时 httpStatus/headers 可能缺，errorMessage 从 stream 最终消息补。 */
export type PiTraceResponse = {
    httpStatus?: number;
    headers?: Record<string, string>;
    stopReason?: string;
    usage?: {
        input: number;
        output: number;
        cacheRead: number;
        cacheWrite: number;
        /** 仅当 Provider 提供 1h cache write 拆分时存在。 */
        cacheWrite1h?: number;
        /** 仅当 Provider 提供 reasoning token 拆分时存在。 */
        reasoning?: number;
        totalTokens: number;
    };
    errorMessage?: string;
};

/** 时序。ttftMs 仅对被迭代的 turn 有效；只 await result() 的调用（compaction/health-check）为空。 */
export type PiTraceTiming = {
    startedAt: string;
    ttftMs?: number;
    durationMs?: number;
};

/** 一条完整 trace 记录。id/ts 由 recorder 分配，调用方提交 draft。 */
export type PiTraceRecord = {
    id: string;
    ts: string;
    status: "ok" | "error" | "aborted";
    correlation: PiTraceCorrelation;
    request: PiTraceRequest;
    response: PiTraceResponse;
    timing: PiTraceTiming;
};

/** 调用方提交的记录草稿，缺 id/ts，由 recorder 补齐。 */
export type PiTraceDraft = Omit<PiTraceRecord, "id" | "ts">;

/** index.jsonl 汇总行：列表只读它，避免读全量 payload。 */
export type PiTraceIndexEntry = {
    id: string;
    ts: string;
    status: PiTraceRecord["status"];
    kind: PiTraceKind;
    invocationId?: string;
    turnIndex?: number;
    provider: string;
    model: string;
    stopReason?: string;
    totalTokens?: number;
    /**
     * 缓存拆分（Task 126）。缓存时间轴只读 index，不能为了拿这四个数去读 N 份含全量
     * prompt 正文的完整记录。provider 未返回 usage 时缺省。
     */
    usage?: {input: number; output: number; cacheRead: number; cacheWrite: number};
    /** 工具集指纹；跨请求比对即可发现工具变化导致的缓存失效。无工具时缺省。 */
    toolsHash?: string;
    ttftMs?: number;
    durationMs?: number;
    bytes: number;
};

/** 每次记录的 retention 设置（由 config 解析后传入，recorder 不读 config）。 */
export type PiTraceWriteOptions = {
    /** 每 bucket 保留最近多少条；<= 0 表示不裁剪。 */
    maxRecords: number;
};

/** bucket 目录名白名单：纯数字 sessionId 或 _system（writeOnce 的 fallback bucket 命名由本模块决定）。 */
export function isValidTraceBucket(bucket: string): boolean {
    return /^\d+$/.test(bucket) || bucket === "_system";
}

/** trace id 白名单：纯数字 seq。 */
export function isValidTraceId(id: string): boolean {
    return /^\d+$/.test(id);
}

export class PiRequestRecorder {
    private readonly tracesRoot: string;
    private readonly seqPath: string;
    /** 写失败回调（best-effort 语义的唯一出口）；缺省静默。NeuroBook 侧注入 appLogger 包装。 */
    private readonly onWriteError?: (error: unknown) => void;
    /** 串行写队列：保证 seq 分配、文件写入、prune、clearBucket、index 重写不并发交错。 */
    private tail: Promise<void> = Promise.resolve();

    constructor(input: {tracesRoot: string; onWriteError?: (error: unknown) => void}) {
        this.tracesRoot = input.tracesRoot;
        this.seqPath = join(this.tracesRoot, "traces-seq.json");
        this.onWriteError = input.onWriteError;
    }

    /**
     * 落一条记录。best-effort：任何失败只经 onWriteError 上报，不抛；串行执行。
     * 调用方可 `void recorder.record(...)` 走 fire-and-forget；测试可 await。
     */
    async record(draft: PiTraceDraft, options: PiTraceWriteOptions): Promise<void> {
        const run = this.tail.then(() => this.writeOnce(draft, options)).catch((error) => {
            this.onWriteError?.(error);
        });
        this.tail = run;
        await run;
    }

    /**
     * 清空整个 bucket（数字 sessionId 或 _system）。挂进串行写队列执行，确保不与在途
     * record 竞态；目录不存在视为成功。删除失败向调用方抛出（用户显式动作，前端要区分
     * 成败；HTTP 层转 500），但不毒化后续写队列。traces-seq.json 不动，seq 不回收不复用。
     */
    async clearBucket(bucket: string): Promise<void> {
        if (!isValidTraceBucket(bucket)) {
            throw new Error(`非法 trace bucket：${bucket}`);
        }
        // maxRetries 缓解 Windows 上与并发读（查看器 GET）竞争导致的 EBUSY。
        const run = this.tail.then(() => rm(join(this.tracesRoot, bucket), {recursive: true, force: true, maxRetries: 2}));
        this.tail = run.then(() => undefined, () => undefined);
        await run;
    }

    /** 等待当前已排队的写全部落盘。给测试与优雅关闭用；普通热路径不需要。 */
    async flush(): Promise<void> {
        await this.tail;
    }

    private async writeOnce(draft: PiTraceDraft, options: PiTraceWriteOptions): Promise<void> {
        const bucket = draft.correlation.sessionId !== undefined ? String(draft.correlation.sessionId) : "_system";
        const bucketDir = join(this.tracesRoot, bucket);
        await mkdir(bucketDir, {recursive: true});

        const seq = await this.nextSeq();
        const id = String(seq);
        const record: PiTraceRecord = {...draft, id, ts: new Date().toISOString()};
        const body = JSON.stringify(record, null, 2);
        await writeFile(join(bucketDir, `${id}.json`), body, "utf8");

        const indexEntry: PiTraceIndexEntry = {
            id,
            ts: record.ts,
            status: record.status,
            kind: record.correlation.kind,
            invocationId: record.correlation.invocationId,
            turnIndex: record.correlation.turnIndex,
            provider: record.request.provider,
            model: record.request.model,
            stopReason: record.response.stopReason,
            totalTokens: record.response.usage?.totalTokens,
            usage: record.response.usage
                ? {
                    input: record.response.usage.input,
                    output: record.response.usage.output,
                    cacheRead: record.response.usage.cacheRead,
                    cacheWrite: record.response.usage.cacheWrite,
                }
                : undefined,
            toolsHash: record.request.toolsHash,
            ttftMs: record.timing.ttftMs,
            durationMs: record.timing.durationMs,
            bytes: Buffer.byteLength(body, "utf8"),
        };
        await appendFile(join(bucketDir, "index.jsonl"), `${JSON.stringify(indexEntry)}\n`, "utf8");

        if (options.maxRecords > 0) {
            await this.prune(bucketDir, options.maxRecords);
        }
    }

    /** 分配全局单调 seq；镜像 session-repo 的 session-seq.json。 */
    private async nextSeq(): Promise<number> {
        await mkdir(dirname(this.seqPath), {recursive: true});
        let next = 1;
        try {
            const current = JSON.parse(await readFile(this.seqPath, "utf8")) as {next?: unknown};
            if (typeof current.next === "number" && Number.isInteger(current.next) && current.next > 0) {
                next = current.next;
            }
        } catch {
            next = 1;
        }
        await writeFile(this.seqPath, JSON.stringify({next: next + 1}, null, 2), "utf8");
        return next;
    }

    /** 每 bucket 只保留 seq 最大的 maxRecords 条，删更旧的 json，并把 index.jsonl 重写为保留集。 */
    private async prune(bucketDir: string, maxRecords: number): Promise<void> {
        const files = await readdir(bucketDir).catch(() => [] as string[]);
        const seqs = files
            .filter((name) => name.endsWith(".json"))
            .map((name) => Number(name.slice(0, -".json".length)))
            .filter((n) => Number.isInteger(n))
            .sort((a, b) => a - b);
        if (seqs.length <= maxRecords) {
            return;
        }
        const removed = new Set(seqs.slice(0, seqs.length - maxRecords).map((n) => String(n)));
        for (const id of removed) {
            await rm(join(bucketDir, `${id}.json`), {force: true});
        }
        const indexPath = join(bucketDir, "index.jsonl");
        const raw = await readFile(indexPath, "utf8").catch(() => "");
        if (!raw) {
            return;
        }
        const keptLines = raw.split("\n").filter((line) => {
            if (!line.trim()) {
                return false;
            }
            try {
                return !removed.has(String((JSON.parse(line) as PiTraceIndexEntry).id));
            } catch {
                return false;
            }
        });
        await writeFile(indexPath, keptLines.length ? `${keptLines.join("\n")}\n` : "", "utf8");
    }
}
