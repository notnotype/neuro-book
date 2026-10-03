import {createWriteStream, type WriteStream} from "node:fs";
import {DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateTail, type TruncationResult} from "nbook/server/agent/tools/truncate";
import type {BashOutputReference, BashOutputReservation} from "nbook/server/agent/tools/bash-output-store";

export type OutputSnapshot = {
    content: string;
    truncation: TruncationResult;
    fullOutput?: BashOutputReference;
};

/**
 * 增量收集bash输出。内存只保留尾部，截断时写入Store预留的Cache Root lease。
 */
export class OutputAccumulator {
    private readonly decoder = new TextDecoder();
    private readonly maxRollingBytes = DEFAULT_MAX_BYTES * 2;
    private rawChunks: Buffer[] = [];
    private tailText = "";
    private tailBytes = 0;
    private totalRawBytes = 0;
    private totalDecodedBytes = 0;
    private totalLines = 1;
    private currentLineBytes = 0;
    private finished = false;
    private outputStream: WriteStream | undefined;
    private persistedBytes = 0;
    private capped = false;

    constructor(private readonly reservation: BashOutputReservation | null) {}

    /**
     * 追加原始输出 chunk。
     */
    append(data: Buffer): void {
        if (this.finished) {
            throw new Error("Cannot append to a finished output accumulator");
        }
        this.totalRawBytes += data.length;
        this.appendDecodedText(this.decoder.decode(data, {stream: true}));
        if (this.outputStream || this.shouldUseOutputFile()) {
            this.ensureOutputFile();
            this.persist(data);
            return;
        }
        this.rawChunks.push(data);
    }

    /**
     * 结束收集并 flush decoder。
     */
    finish(): void {
        if (this.finished) {
            return;
        }
        this.finished = true;
        this.appendDecodedText(this.decoder.decode());
        if (this.shouldUseOutputFile()) {
            this.ensureOutputFile();
        }
    }

    /**
     * 生成模型可见快照。
     */
    snapshot(persistIfTruncated = false): OutputSnapshot {
        const truncation = truncateTail(this.tailText, {
            maxLines: DEFAULT_MAX_LINES,
            maxBytes: DEFAULT_MAX_BYTES,
        });
        const truncated = this.totalLines > DEFAULT_MAX_LINES || this.totalDecodedBytes > DEFAULT_MAX_BYTES;
        const finalTruncation: TruncationResult = {
            ...truncation,
            truncated,
            truncatedBy: truncated ? truncation.truncatedBy ?? (this.totalDecodedBytes > DEFAULT_MAX_BYTES ? "bytes" : "lines") : null,
            totalLines: this.totalLines,
            totalBytes: this.totalDecodedBytes,
        };
        if (persistIfTruncated && finalTruncation.truncated) {
            this.ensureOutputFile();
        }
        return {
            content: finalTruncation.content,
            truncation: finalTruncation,
            fullOutput: !finalTruncation.truncated
                ? undefined
                : this.reservation
                    ? {
                        locator: this.reservation.reference.locator,
                        state: this.capped ? "partial" : "available",
                    }
                    : {state: "reclaimed"},
        };
    }

    /**
     * 关闭临时文件流。
     */
    async closeOutput(): Promise<void> {
        if (!this.outputStream) {
            await this.reservation?.discard();
            return;
        }
        const stream = this.outputStream;
        this.outputStream = undefined;
        try {
            await new Promise<void>((resolve, reject) => {
                stream.once("error", reject);
                stream.once("finish", resolve);
                stream.end();
            });
        } catch (error) {
            await this.reservation?.discard();
            throw error;
        }
        await this.reservation?.complete(this.persistedBytes, this.capped);
    }

    get lastLineBytes(): number {
        return this.currentLineBytes;
    }

    private appendDecodedText(text: string): void {
        if (!text) {
            return;
        }
        const bytes = Buffer.byteLength(text, "utf-8");
        this.totalDecodedBytes += bytes;
        this.tailText += text;
        this.tailBytes += bytes;
        if (this.tailBytes > this.maxRollingBytes * 2) {
            const buffer = Buffer.from(this.tailText, "utf-8");
            const start = Math.max(0, buffer.length - this.maxRollingBytes);
            this.tailText = buffer.subarray(start).toString("utf-8");
            this.tailBytes = Buffer.byteLength(this.tailText, "utf-8");
        }
        let newlines = 0;
        let lastNewline = -1;
        for (let index = text.indexOf("\n"); index !== -1; index = text.indexOf("\n", index + 1)) {
            newlines++;
            lastNewline = index;
        }
        if (newlines === 0) {
            this.currentLineBytes += bytes;
            return;
        }
        this.totalLines += newlines;
        this.currentLineBytes = Buffer.byteLength(text.slice(lastNewline + 1), "utf-8");
    }

    private shouldUseOutputFile(): boolean {
        return this.totalRawBytes > DEFAULT_MAX_BYTES || this.totalDecodedBytes > DEFAULT_MAX_BYTES || this.totalLines > DEFAULT_MAX_LINES;
    }

    private ensureOutputFile(): void {
        if (this.outputStream || !this.reservation) {
            return;
        }
        this.outputStream = createWriteStream(this.reservation.physicalPath, {flags: "wx"});
        for (const chunk of this.rawChunks) {
            this.persist(chunk);
        }
        this.rawChunks = [];
    }

    /** 单文件硬预算只影响Cache副本；模型可见尾部继续完整统计并照常返回。 */
    private persist(data: Buffer): void {
        if (!this.outputStream || !this.reservation || this.capped) return;
        const remaining = this.reservation.maxBytes - this.persistedBytes;
        if (remaining <= 0) {
            this.capped = true;
            return;
        }
        const persisted = data.length <= remaining ? data : data.subarray(0, remaining);
        this.outputStream.write(persisted);
        this.persistedBytes += persisted.length;
        if (persisted.length !== data.length) {
            this.capped = true;
        }
    }
}
