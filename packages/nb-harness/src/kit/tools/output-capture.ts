/**
 * 工具输出的窗口与全文（docs/specs/agent/builtin-tools.md 输出 21）：`shell` 与 `eval` 共用，模型对两者的输出只学一套。
 *
 * `push` 只做同步的事（输出回调不等异步，同 omp 的 `OutputSink`）：内存里留开头与结尾，放不下之后同步追加到一个本地临时文件；
 * 结束后再由 `saveFullOutput` 拷进 `artifacts/`。这样暂存目录不可用不影响执行，也不会因为保存失败让命令跑第二遍。
 *
 * 转后台（host-kit.md 的自动转后台）：`soFar` 交出到此刻的输出——还没超出窗口时是内存里的全部文字（小，接手的一方写进自己的文件），
 * 超出之后是暂存文件（大，接手的一方改名接过、接着往同一个描述符追加，不拷贝）。接手成功后才 `release`，失败时暂存仍归这里，前台照常。
 */

import {closeSync, mkdtempSync, openSync, rmSync, writeSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";

import type {KitServices} from "../files/index.js";
import {capLines, headAndTail, lineCount, LINE_BYTES, OUTPUT_LIMIT, PART_BYTES, WINDOW_BYTES, WINDOW_LINES} from "./shell-window.js";

/** 到此刻的输出（转后台时交给接手的一方）。 */
export interface OutputSoFar {
    /** 还没超出窗口：内存里的全部文字；超出之后为 null，看 `spool`。 */
    readonly text: string | null;
    /** 超出窗口之后的暂存文件（在系统临时目录里）；`release` 之后描述符与文件归接手的一方。 */
    readonly spool: {readonly fd: number; readonly path: string} | null;
    readonly bytes: number;
    readonly lines: number;
    /** 内存里留着的结尾（够截出最后一行）。 */
    readonly tail: string;
    readonly full: boolean;
}

export class OutputCapture {
    /** 超出窗口之后才逐块累加的换行数。 */
    #lines = 0;
    /** 没超限时是全部输出；超限后是结尾（留到一个结尾窗口的两倍再修剪，免得每块都修）。 */
    #memory = "";
    #memoryBytes = 0;
    #head = "";
    /** 当前这一行已有多少字节：长行可能跨好几块。 */
    #lineBytes = 0;
    #spool: {readonly fd: number; readonly path: string} | null = null;
    #spoolBytes = 0;
    overflowed = false;
    full = false;
    totalBytes = 0;
    spoolProblem: string | null = null;
    chunkProblem: string | null = null;

    push(chunk: string): void {
        this.totalBytes += Buffer.byteLength(chunk, "utf8");
        this.#memory += chunk;
        this.#memoryBytes += Buffer.byteLength(chunk, "utf8");
        if (this.overflowed) {
            // 换行只在超出之后逐块数：之前内存里是全部输出，要用时（`soFar`）再数。
            this.#lines += newlines(chunk);
            this.#spoolWrite(chunk);
            if (this.#memoryBytes > PART_BYTES * 2) {
                this.#memory = Buffer.from(this.#memory, "utf8").subarray(-PART_BYTES).toString("utf8");
                this.#memoryBytes = Buffer.byteLength(this.#memory, "utf8");
            }
            return;
        }
        const parts = chunk.split("\n");
        let longest = 0;
        parts.forEach((part, index) => {
            const size = Buffer.byteLength(part, "utf8") + (index === 0 ? this.#lineBytes : 0);
            longest = Math.max(longest, size);
            if (index === parts.length - 1) this.#lineBytes = size;
        });
        if (this.#memoryBytes > WINDOW_BYTES || lineCount(this.#memory) > WINDOW_LINES || longest > LINE_BYTES) {
            this.overflowed = true;
            this.#head = Buffer.from(this.#memory, "utf8").subarray(0, PART_BYTES).toString("utf8");
            this.#lines = newlines(this.#memory);
            this.#spoolWrite(this.#memory);
        }
    }

    #spoolWrite(text: string): void {
        if (this.spoolProblem !== null || this.full) return;
        try {
            this.#openSpool();
            const bytes = Buffer.from(text, "utf8");
            const room = OUTPUT_LIMIT - this.#spoolBytes;
            const taken = bytes.length > room ? bytes.subarray(0, room) : bytes;
            writeSync(this.#spool!.fd, taken);
            this.#spoolBytes += taken.length;
            if (taken.length < bytes.length) this.full = true;
        } catch (error) {
            this.spoolProblem = error instanceof Error ? error.message : String(error);
        }
    }

    /** 交给模型的输出窗口（docs/specs/agent/builtin-tools.md 的术语）；`clipped` 指内容少了，全文要去 `artifacts/` 看。 */
    window(): {readonly text: string; readonly clipped: boolean} {
        if (!this.overflowed) return {text: this.#memory, clipped: false};
        // 总量与行数都在预算内，只是单行超限（内存这时一定是全部输出）：不用省略中间。
        if (this.totalBytes <= WINDOW_BYTES && lineCount(this.#memory) <= WINDOW_LINES) return {text: capLines(this.#memory), clipped: true};
        return {text: headAndTail(this.#head, Buffer.from(this.#memory, "utf8").subarray(-PART_BYTES).toString("utf8"), this.totalBytes), clipped: true};
    }

    #openSpool(): void {
        if (this.#spool !== null) return;
        const directory = mkdtempSync(join(tmpdir(), "harness-output-"));
        const path = join(directory, "output.log");
        this.#spool = {fd: openSync(path, "wx", 0o600), path};
    }

    /** 到此刻的输出；暂存出过错时交不出（null），命令留在前台。 */
    soFar(): OutputSoFar | null {
        if (this.spoolProblem !== null) return null;
        const tail = Buffer.from(this.#memory, "utf8").subarray(-PART_BYTES).toString("utf8");
        if (!this.overflowed) return {text: this.#memory, spool: null, bytes: this.totalBytes, lines: newlines(this.#memory), tail, full: false};
        if (this.#spool === null) return null;
        return {text: null, spool: {fd: this.#spool.fd, path: this.#spool.path}, bytes: this.#spoolBytes, lines: this.#lines, tail, full: this.full};
    }

    /** 接手成功之后：暂存的描述符与文件（连同它所在的临时目录）归接手的一方，这里不再写、不再关、不再删。 */
    release(): void {
        this.#spool = null;
    }

    get spoolPath(): string | null {
        return this.spoolProblem === null ? (this.#spool?.path ?? null) : null;
    }

    dispose(): void {
        if (this.#spool === null) return;
        closeSync(this.#spool.fd);
        rmSync(dirname(this.#spool.path), {recursive: true, force: true});
        this.#spool = null;
    }
}

const encoder = new TextEncoder();

const newlines = (text: string): number => {
    let count = 0;
    for (let at = text.indexOf("\n"); at !== -1; at = text.indexOf("\n", at + 1)) count += 1;
    return count;
};

/** 超出窗口的全文存进 `artifacts/`；`label` 是存放时的名字（`shell`、`eval`）。 */
export async function saveFullOutput(artifacts: KitServices["artifacts"], capture: OutputCapture, label: string): Promise<{readonly address?: string; readonly problem?: string}> {
    const path = capture.spoolPath;
    if (path === null) return {problem: capture.spoolProblem ?? "没有全文"};
    const saved = await artifacts.save(label, async (sink) => {
        for await (const chunk of Bun.file(path).stream()) await sink.write(chunk);
        if (capture.full) await sink.write(encoder.encode(`\n[输出超过 64 MiB，后面的没有保存；共 ${String(capture.totalBytes)} 字节]\n`));
    });
    return saved.ok ? {address: saved.value.address} : {problem: `${saved.code}: ${saved.detail}`};
}
