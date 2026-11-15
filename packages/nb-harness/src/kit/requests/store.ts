/**
 * 请求记录的目录（docs/specs/agent/request-trace.md 的“副作用与数据”）。布局：
 *
 * - `format.json`：`{"version": 1}`。版本不认识时整个目录只读，不写、不清理。
 * - `index/<YYYY-MM-DD>.jsonl`：事件行，一行一件事（`start`、`attempt`、`end`），读时按 `id` 折叠。一条请求的后续行都写进它
 *   `start` 所在那天的文件，按天清理时整条一起走。日期按 UTC。
 * - `blobs/<前两位>/<sha256>.json`：一段内容（一条消息、一段系统提示词、一个工具声明、一份回复、一轮用户的话），按内容寻址。
 * - `payloads/<id>.json.gz`：原始请求体。
 *
 * 崩溃时不出现半条记录，靠三条：内容与请求体先写临时文件再改名；它们在引用它们的那一行之前写完，且与那一行在同一个串行
 * 任务里（记录器保证）；打开时把不以换行结尾的天文件截到最后一个换行。不 fsync：防的是进程中途退出，不是掉电。
 */

import {mkdir, readdir, readFile, rename, rm, stat, truncate, writeFile, appendFile} from "node:fs/promises";
import {join} from "node:path";
import {gzip, gunzip} from "node:zlib";
import {promisify} from "node:util";
import {randomUUID} from "node:crypto";

export const FORMAT_VERSION = 1;

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

const DAY_FILE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/u;
const HASH = /^[0-9a-f]{64}$/u;
const RECORD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** 记录 id 是 `randomUUID()` 取的；索引里读到的、远程层转进来的 id 都要过这一关，它会拼进请求体的文件名。 */
export const isRecordId = (id: string): boolean => RECORD_ID.test(id);

export const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

const missing = (error: unknown): boolean => (error as NodeJS.ErrnoException | null)?.code === "ENOENT";

export class RequestFiles {
    readonly #root: string;
    /** 已知在盘上的内容：同一段内容只写一次。只增不减，清理时整体重建。 */
    #knownBlobs = new Set<string>();

    constructor(root: string) {
        this.#root = root;
    }

    get root(): string {
        return this.#root;
    }

    /**
     * 版本认识时建目录、收拾上次退出留下的临时文件，交回 true；不认识（或 `format.json` 读不懂）时什么都不动，交回 false
     * （调用方不写、不清理）。先读版本再动手：更新的版本可能正在用这些临时文件恢复。
     */
    async prepare(): Promise<boolean> {
        const formatPath = join(this.#root, "format.json");
        let text: string | null = null;
        try {
            text = await readFile(formatPath, "utf8");
        } catch (error) {
            if (!missing(error)) throw error;
        }
        if (text !== null) {
            let version: unknown;
            try {
                version = (JSON.parse(text) as {version?: unknown} | null)?.version;
            } catch {
                // 读不懂的版本文件按不认识处理（它是改名写成的，正常不会只写一半）。
                version = undefined;
            }
            if (version !== FORMAT_VERSION) return false;
        }
        await mkdir(join(this.#root, "index"), {recursive: true});
        await mkdir(join(this.#root, "blobs"), {recursive: true});
        await mkdir(join(this.#root, "payloads"), {recursive: true});
        // 整天重写（`rewriteDay`）中途退出留下的临时文件：天文件本身没动，删掉即可。
        for (const name of await readdir(join(this.#root, "index"))) if (name.endsWith(".tmp")) await rm(join(this.#root, "index", name), {force: true});
        if (text === null) await this.#writeAtomic(formatPath, JSON.stringify({version: FORMAT_VERSION}));
        return true;
    }

    async #writeAtomic(path: string, data: string | Uint8Array): Promise<void> {
        const temp = `${path}.${randomUUID()}.tmp`;
        await writeFile(temp, data);
        await rename(temp, path);
    }

    #blobPath(hash: string): string {
        return join(this.#root, "blobs", hash.slice(0, 2), `${hash}.json`);
    }

    /** 这个进程里写过或确认过在盘上的内容。 */
    hasBlob(hash: string): boolean {
        return this.#knownBlobs.has(hash);
    }

    async writeBlob(hash: string, json: string): Promise<void> {
        if (this.#knownBlobs.has(hash)) return;
        const path = this.#blobPath(hash);
        try {
            await stat(path);
        } catch (error) {
            if (!missing(error)) throw error;
            await mkdir(join(this.#root, "blobs", hash.slice(0, 2)), {recursive: true});
            await this.#writeAtomic(path, json);
        }
        this.#knownBlobs.add(hash);
    }

    /** 没有时交回 null（清理与读取同时发生）。 */
    async readBlob(hash: string): Promise<string | null> {
        if (!HASH.test(hash)) return null;
        try {
            return await readFile(this.#blobPath(hash), "utf8");
        } catch (error) {
            if (missing(error)) return null;
            throw error;
        }
    }

    #payloadPath(id: string): string {
        if (!isRecordId(id)) throw new TypeError(`not a request record id: ${id}`);
        return join(this.#root, "payloads", `${id}.json.gz`);
    }

    /** 交回压缩后的字节数。 */
    async writePayload(id: string, body: string): Promise<number> {
        const compressed = await gzipAsync(Buffer.from(body, "utf8"));
        await this.#writeAtomic(this.#payloadPath(id), compressed);
        return compressed.byteLength;
    }

    async readPayload(id: string): Promise<string | null> {
        if (!isRecordId(id)) return null;
        try {
            return (await gunzipAsync(await readFile(this.#payloadPath(id)))).toString("utf8");
        } catch (error) {
            if (missing(error)) return null;
            throw error;
        }
    }

    async deletePayload(id: string): Promise<void> {
        await rm(this.#payloadPath(id), {force: true});
    }

    /** 删掉不属于 `keep` 里任何一条记录的请求体文件（含写到一半的临时文件），交回删了几个。 */
    async collectPayloads(keep: ReadonlySet<string>): Promise<number> {
        let removed = 0;
        const base = join(this.#root, "payloads");
        for (const name of await readdir(base)) {
            const id = name.endsWith(".json.gz") ? name.slice(0, -".json.gz".length) : null;
            if (id !== null && keep.has(id)) continue;
            await rm(join(base, name), {force: true});
            removed += 1;
        }
        return removed;
    }

    #dayPath(day: string): string {
        return join(this.#root, "index", `${day}.jsonl`);
    }

    async appendLine(day: string, line: object): Promise<void> {
        await appendFile(this.#dayPath(day), `${JSON.stringify(line)}\n`);
    }

    async days(): Promise<string[]> {
        const names = await readdir(join(this.#root, "index"));
        return names.flatMap((name) => DAY_FILE.exec(name)?.[1] ?? []).sort();
    }

    /**
     * 读一天的事件行，解析不了的行交给 `onBad` 并跳过。不以换行结尾时（上次写到一半就退出了）末尾的半行不算，`partial` 给出
     * 该截到的长度：调用方确认这一天的版本认识之后用 `repairDay` 截掉，否则下一次追加会和半行粘在一起。
     */
    async readDay(day: string, onBad: (line: number) => void): Promise<{readonly lines: unknown[]; readonly partial: number | null}> {
        const buffer = await readFile(this.#dayPath(day));
        const partial = buffer.length > 0 && buffer[buffer.length - 1] !== 0x0a ? buffer.lastIndexOf(0x0a) + 1 : null;
        const text = buffer.subarray(0, partial ?? buffer.length).toString("utf8");
        const lines: unknown[] = [];
        text.split("\n").forEach((line, index) => {
            if (line === "") return;
            try {
                lines.push(JSON.parse(line));
            } catch {
                onBad(index + 1);
            }
        });
        return {lines, partial};
    }

    async repairDay(day: string, keep: number): Promise<void> {
        await truncate(this.#dayPath(day), keep);
    }

    /** 整天重写（清空一部分时）；没有剩下的行就删掉文件。 */
    async rewriteDay(day: string, lines: readonly object[]): Promise<void> {
        if (lines.length === 0) {
            await rm(this.#dayPath(day), {force: true});
            return;
        }
        await this.#writeAtomic(this.#dayPath(day), lines.map((line) => `${JSON.stringify(line)}\n`).join(""));
    }

    /** 删掉没有被引用的内容文件，交回删了几个。 */
    async collectBlobs(referenced: ReadonlySet<string>): Promise<number> {
        let removed = 0;
        const base = join(this.#root, "blobs");
        for (const prefix of await readdir(base)) {
            const directory = join(base, prefix);
            for (const name of await readdir(directory)) {
                const hash = name.replace(/\.json$/u, "");
                if (referenced.has(hash)) continue;
                await rm(join(directory, name), {force: true});
                removed += 1;
            }
        }
        this.#knownBlobs = new Set([...this.#knownBlobs].filter((hash) => referenced.has(hash)));
        return removed;
    }

    /** 目录占用：全部文件的字节数与其中原始请求体的字节数。 */
    async usage(): Promise<{bytes: number; payloadBytes: number}> {
        const sizeOf = async (directory: string): Promise<number> => {
            let total = 0;
            for (const entry of await readdir(directory, {withFileTypes: true})) {
                const path = join(directory, entry.name);
                total += entry.isDirectory() ? await sizeOf(path) : (await stat(path)).size;
            }
            return total;
        };
        const payloadBytes = await sizeOf(join(this.#root, "payloads"));
        return {bytes: payloadBytes + await sizeOf(join(this.#root, "index")) + await sizeOf(join(this.#root, "blobs")), payloadBytes};
    }
}
