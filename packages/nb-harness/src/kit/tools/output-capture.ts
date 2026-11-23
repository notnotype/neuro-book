/**
 * 工具输出的窗口与全文（docs/specs/agent/builtin-tools.md 输出 21）：`shell` 与 `eval` 共用，模型对两者的输出只学一套。
 *
 * `push` 只做同步的事（输出回调不等异步，同 omp 的 `OutputSink`）：内存里留开头与结尾，放不下之后同步追加到一个本地临时文件；
 * 结束后再由 `saveFullOutput` 拷进 `artifacts/`。这样暂存目录不可用不影响执行，也不会因为保存失败让命令跑第二遍。
 *
 * `spoolFromStart`（`shell` 可能自动转后台时）：从第一块起就同步写暂存，转后台时 `handover` 把文件与它的统计整个交出去，接手的一方改名、
 * 接着往同一个描述符追加，不拷贝（host-kit.md 的自动转后台）。暂存仍在系统临时目录里：工具不往任何根里写。
 */

import {closeSync, mkdtempSync, openSync, rmSync, writeSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";

import type {KitServices} from "../files/index.js";
import {capLines, headAndTail, lineCount, LINE_BYTES, OUTPUT_LIMIT, PART_BYTES, WINDOW_BYTES, WINDOW_LINES} from "./shell-window.js";

/** 交出去的暂存：描述符与路径归接手的一方，之后 `dispose` 不再关它、删它。 */
export interface SpoolHandover {
    readonly fd: number;
    readonly path: string;
    readonly bytes: number;
    readonly lines: number;
    /** 内存里留着的结尾（够截出最后一行）。 */
    readonly tail: string;
    readonly full: boolean;
}

export class OutputCapture {
    readonly #fromStart: boolean;
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

    constructor(options: {readonly spoolFromStart?: boolean} = {}) {
        this.#fromStart = options.spoolFromStart === true;
    }

    push(chunk: string): void {
        this.totalBytes += Buffer.byteLength(chunk, "utf8");
        this.#memory += chunk;
        this.#memoryBytes += Buffer.byteLength(chunk, "utf8");
        for (let index = chunk.indexOf("\n"); index !== -1; index = chunk.indexOf("\n", index + 1)) this.#lines += 1;
        // 从一开始就写暂存：超出窗口时不用再把内存里的补写一遍。
        if (this.#fromStart) this.#spoolWrite(chunk);
        if (this.overflowed) {
            if (!this.#fromStart) this.#spoolWrite(chunk);
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
            if (!this.#fromStart) this.#spoolWrite(this.#memory);
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

    /**
     * 交出暂存（只在 `spoolFromStart` 时可交）：一个同步步骤，之后这里不再写它、不再删它（连同它所在的临时目录，归接手的一方）。还没有
     * 输出时先建一个空文件。暂存出过错时交不出，命令留在前台。
     */
    handover(): SpoolHandover | null {
        if (!this.#fromStart || this.spoolProblem !== null) return null;
        try {
            this.#openSpool();
        } catch (error) {
            this.spoolProblem = error instanceof Error ? error.message : String(error);
            return null;
        }
        const spool = this.#spool!;
        this.#spool = null;
        const tail = Buffer.from(this.#memory, "utf8").subarray(-PART_BYTES).toString("utf8");
        return {fd: spool.fd, path: spool.path, bytes: this.#spoolBytes, lines: this.#lines, tail, full: this.full};
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
