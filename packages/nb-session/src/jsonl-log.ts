import {appendFile, readFile, stat, truncate} from "node:fs/promises";
import {join} from "node:path";
import {isValidSessionId, materializeEntry, parseEntryLine, type SessionEntry} from "./entries.js";
import {makeClock, makeQueue, windowEntries, type SessionLog, type SessionReadOptions} from "./memory-log.js";

interface ScanResult {
    readonly entries: readonly SessionEntry[];
    /** 可解析前缀的字节数；其后的字节属于中断尾。 */
    readonly validBytes: number;
}

/** 扫描 JSONL 缓冲区：首个不可解析的（或没以 LF 结尾的）行起视为中断尾。 */
function scanJsonl(buffer: Buffer): ScanResult {
    const entries: SessionEntry[] = [];
    let validBytes = 0;
    let offset = 0;
    while (offset < buffer.length) {
        const newlineIndex = buffer.indexOf(0x0a, offset);
        if (newlineIndex === -1) break;
        const line = buffer.subarray(offset, newlineIndex).toString("utf-8");
        const entry = line === "" ? null : parseEntryLine(line);
        if (entry === null) break;
        entries.push(entry);
        offset = newlineIndex + 1;
        validBytes = offset;
    }
    return {entries, validBytes};
}

/**
 * 一文件一会话的 JSONL 日志：`<root>/<sessionId>.jsonl`，一行一条条目。
 * 创建时校验 `sessionId` 与 `root`（不合法则 reject）；创建时读回已有文件以续接 `seq`。
 */
export async function createJsonlSessionLog(options: {
    readonly root: string;
    readonly sessionId: string;
    readonly now?: () => Date;
}): Promise<SessionLog> {
    const {root, sessionId} = options;
    if (!isValidSessionId(sessionId)) {
        throw new Error(`非法会话 id：${JSON.stringify(sessionId)}（允许 [A-Za-z0-9._-]{1,128}）`);
    }
    const info = await stat(root).catch(() => null);
    if (info === null || !info.isDirectory()) {
        throw new Error(`会话根目录不存在或不是目录：${root}`);
    }

    const file = join(root, `${sessionId}.jsonl`);
    const clock = makeClock(options.now);
    const run = makeQueue();
    let entries: SessionEntry[] = [];
    let nextSeq = 1;
    let corruptBytes = 0;

    const load = async (): Promise<void> => {
        const buffer = await readFile(file).catch(() => null);
        if (buffer === null) {
            entries = [];
            nextSeq = 1;
            corruptBytes = 0;
            return;
        }
        const scanned = scanJsonl(buffer);
        entries = [...scanned.entries];
        nextSeq = entries.length > 0 ? entries[entries.length - 1].seq + 1 : 1;
        corruptBytes = buffer.length - scanned.validBytes;
    };

    await load();

    return {
        sessionId,
        append(inputs) {
            return run(async () => {
                if (corruptBytes > 0) {
                    throw new Error(`会话文件存在中断尾（${corruptBytes} 字节）：${file}；请先调用 repair()`);
                }
                if (inputs.length === 0) return [];
                const startSeq = nextSeq;
                const stamped = inputs.map((input, index) => materializeEntry(input, startSeq + index, clock()));
                await appendFile(file, `${stamped.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf-8");
                entries = [...entries, ...stamped];
                nextSeq = startSeq + stamped.length;
                return stamped;
            });
        },
        read(readOptions?: SessionReadOptions) {
            return run(async () => {
                await load();
                return windowEntries(entries, readOptions);
            });
        },
        tail() {
            return run(async () => {
                await load();
                return entries[entries.length - 1] ?? null;
            });
        },
        repair() {
            return run(async () => {
                await load();
                if (corruptBytes === 0) return {droppedBytes: 0};
                const buffer = await readFile(file);
                const dropped = corruptBytes;
                await truncate(file, buffer.length - dropped);
                corruptBytes = 0;
                return {droppedBytes: dropped};
            });
        },
    };
}
