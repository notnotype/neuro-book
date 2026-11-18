/**
 * eval 内核在宿主这一侧（docs/specs/agent/eval.md）：`Kernel` 是一个内核进程，`KernelRegistry` 管全服务端内核的总数。
 *
 * 所有权：`Kernel` 由会话的 eval 实现持有（一个会话至多一个），它负责起进程、握手、按单元收发消息、结束进程组。进程是自己
 * 进程组的组长，结束时整组 SIGKILL，代码起的子进程一起收掉；服务端异常退出时由内核自己的看门狗线程收组（`kernel-entry.ts`）。
 *
 * 进程的标准输出与错误一直有人读：没人读的管道写满后内核里的子进程会卡住。单元期间直接写到 fd 1、2 的（`Bun.$` 不取 `.text()`、
 * `inherit` 的子进程）并进这个单元的输出；错误流另留最后 16 KiB，内核意外退出时写进结果。
 */

import type {CallReply, CallTarget, GlobalObjects, HostMessage, KernelError, KernelMessage} from "./protocol";
import {isKernelMessage} from "./protocol";
import {EVAL_PROTOCOL_VERSION} from "./constants";

/** 结束标记（`cellEndMarker`）的样子；内核写的，代码不会恰好写出带 NUL 的这一串。 */
const MARKER = /\u0000nbook-eval-cell-end:(\d+)\u0000/u;

/** 握手的期限：冷启动是宿主的成本，不算进单元时限；负载高时起一个 Bun 要几秒（omp 取同样的下限）。 */
export const HANDSHAKE_MS = 15_000;
const STDERR_TAIL_BYTES = 16 * 1024;

export interface KernelLaunch {
    /** 内核入口文件的绝对路径。 */
    readonly entry: string;
    readonly cwd: string;
    /** 完整的环境（已叠加服务端环境）：`Bun.spawn` 的 `env` 是替换，不是叠加。 */
    readonly env: Readonly<Record<string, string>>;
}

export interface KernelExit {
    readonly code: number | null;
    readonly signal: string | null;
    readonly stderrTail: string;
    /** 宿主自己结束的（重置、超时、回收、会话关闭）；为假时是意外退出（崩溃、被外部杀、代码里 `process.exit`，退出码 0 也算）。 */
    readonly intentional: boolean;
}

export interface CellRequest {
    readonly cell: number;
    readonly source: string;
    readonly tools: readonly string[];
    readonly globals: GlobalObjects;
}

/** 一个单元执行期间宿主要做的事；`call` 交回给代码的结果（成功的值或失败的结局），不抛。 */
export interface CellHandlers {
    text(text: string): void;
    image(image: {readonly data: string; readonly mime: string}): void;
    call(target: CallTarget, args: unknown): Promise<CallReply>;
}

export type CellEnd =
    | {readonly kind: "done"; readonly ok: true; readonly value?: string}
    | {readonly kind: "done"; readonly ok: false; readonly error: KernelError}
    | {readonly kind: "exited"; readonly exit: KernelExit};

export type StartResult = {readonly ok: true; readonly kernel: Kernel} | {readonly ok: false; readonly reason: string};

export class Kernel {
    readonly #child: Bun.Subprocess<"ignore", "pipe", "pipe">;
    readonly exited: Promise<KernelExit>;
    #intentional = false;
    #stderrTail = "";
    #ready: ((version: number) => void) | null = null;
    /**
     * 正在执行的单元：只有它的输出、图片与调用算数，别的单元晚到的消息按 eval.md 输出 9 处理。`end` 是收到的 `done`，
     * 两条管道都读到这个单元的结束标记之后才交出去（直接写 fd 的输出走管道，可能比 IPC 的 `done` 晚到）。
     */
    #current: {readonly cell: number; readonly handlers: CellHandlers; readonly done: (end: CellEnd) => void; end: CellEnd | null} | null = null;
    /** 两条管道各自读到的最后一个结束标记的单元号。 */
    readonly #marked = {stdout: 0, stderr: 0};

    private constructor(launch: KernelLaunch) {
        this.#child = Bun.spawn([process.execPath, "--no-env-file", launch.entry], {
            cwd: launch.cwd,
            env: {...launch.env},
            detached: true,
            stdin: "ignore",
            stdout: "pipe",
            stderr: "pipe",
            ipc: (message) => this.#receive(message),
        });
        void this.#drain(this.#child.stdout, "stdout", (text) => this.#current?.handlers.text(text));
        void this.#drain(this.#child.stderr, "stderr", (text) => {
            this.#stderrTail = (this.#stderrTail + text).slice(-STDERR_TAIL_BYTES);
            this.#current?.handlers.text(text);
        });
        this.exited = this.#child.exited.then(() => {
            // 内核自己退出时（崩溃、`process.exit`）它起的子进程还在：整组结束（eval.md 输出 13）。
            this.#killGroup();
            const exit: KernelExit = {code: this.#child.exitCode, signal: this.#child.signalCode, stderrTail: this.#stderrTail, intentional: this.#intentional};
            const current = this.#current;
            this.#current = null;
            current?.done({kind: "exited", exit});
            return exit;
        });
    }

    /** 起进程并握手。失败时进程已结束，`reason` 是给模型与用户看的原因。 */
    static async start(launch: KernelLaunch, options: {readonly handshakeMs?: number; readonly signal?: AbortSignal} = {}): Promise<StartResult> {
        let kernel: Kernel;
        try {
            kernel = new Kernel(launch);
        } catch (error) {
            return {ok: false, reason: `内核进程起不来：${error instanceof Error ? error.message : String(error)}`};
        }
        const version = await new Promise<number | "exited" | "timeout" | "aborted">((resolve) => {
            // 四种结局谁先到算谁，之后的都不理；计时器与挂在运行信号上的监听在这里一起撤掉。
            const settle = (value: number | "exited" | "timeout" | "aborted"): void => {
                clearTimeout(timer);
                options.signal?.removeEventListener("abort", abort);
                resolve(value);
            };
            const timer = setTimeout(() => settle("timeout"), options.handshakeMs ?? HANDSHAKE_MS);
            const abort = (): void => settle("aborted");
            options.signal?.addEventListener("abort", abort, {once: true});
            kernel.#ready = settle;
            void kernel.exited.then(() => settle("exited"));
            kernel.#send({type: "hello", version: EVAL_PROTOCOL_VERSION});
        });
        kernel.#ready = null;
        if (version === EVAL_PROTOCOL_VERSION) return {ok: true, kernel};
        await kernel.kill();
        if (version === "exited") {
            const exit = await kernel.exited;
            return {ok: false, reason: `内核进程起来就退出了（${describeExit(exit)}）${exit.stderrTail === "" ? "" : `：${exit.stderrTail.trim()}`}`};
        }
        if (version === "timeout") return {ok: false, reason: `内核在 ${String((options.handshakeMs ?? HANDSHAKE_MS) / 1000)} 秒内没有握手`};
        if (version === "aborted") return {ok: false, reason: "起内核时运行被停止"};
        return {ok: false, reason: `内核入口的协议版本是 ${String(version)}，宿主是 ${String(EVAL_PROTOCOL_VERSION)}（升级后还在用旧的入口文件？）`};
    }

    /** 内核进程号，也是它的进程组号（诊断与测试用）。 */
    get pid(): number {
        return this.#child.pid;
    }

    get alive(): boolean {
        return this.#child.exitCode === null && this.#child.signalCode === null;
    }

    /** 执行一个单元，等它结束或内核退出。同一时刻只执行一个（eval 是 `exclusive`）。 */
    run(request: CellRequest, handlers: CellHandlers): Promise<CellEnd> {
        if (this.#current !== null) throw new Error(`kernel is already running cell ${String(this.#current.cell)}`);
        return new Promise<CellEnd>((resolve) => {
            this.#current = {cell: request.cell, handlers, done: resolve, end: null};
            if (!this.alive) {
                this.#current = null;
                void this.exited.then((exit) => resolve({kind: "exited", exit}));
                return;
            }
            this.#send({type: "run", cell: request.cell, source: request.source, tools: request.tools, globals: request.globals});
        });
    }

    /** 结束整个进程组并等它退出；之后 `exited` 的 `intentional` 为真。已经退出的直接交回。 */
    async kill(): Promise<KernelExit> {
        if (this.alive) {
            this.#intentional = true;
            this.#killGroup();
        }
        return this.exited;
    }

    #killGroup(): void {
        try {
            process.kill(-this.#child.pid, "SIGKILL");
        } catch {
            // 不是组长（平台不支持进程组）或组已经没了：至少结束内核自己（已经退出的再杀一次也无妨）。
            this.#child.kill("SIGKILL");
        }
    }

    #send(message: HostMessage): void {
        // 内核刚退出、退出事件还没到时发消息会同步抛错（omp issue #2997）：退出由 `exited` 收口，这里吞掉。
        try {
            this.#child.send(message);
        } catch {
            return;
        }
    }

    #receive(raw: unknown): void {
        if (!isKernelMessage(raw)) {
            // 代码能直接 `process.send` 任意东西：不认识的消息不理，单元照常（坏掉的内核由退出或时限收口）。
            return;
        }
        const message: KernelMessage = raw;
        switch (message.type) {
            case "ready":
                this.#ready?.(message.version);
                return;
            case "log":
                if (message.cell === this.#current?.cell) this.#current.handlers.text(message.text);
                return;
            case "display":
                if (message.cell === this.#current?.cell) this.#current.handlers.image(message.image);
                return;
            case "call": {
                const current = this.#current;
                if (current === null || message.cell !== current.cell) {
                    // 上一个单元留下的代码在它结束之后才调（eval.md 输出 9）：不执行，告诉那段代码。
                    this.#send({type: "reply", id: message.id, reply: {ok: false, tool: message.target.kind === "tool" ? message.target.name : `${message.target.object}.${message.target.method}`, status: "error", code: "parent-finished", message: "发起这次调用的单元已经结束，调用没有执行。"}});
                    return;
                }
                void current.handlers.call(message.target, message.args).then((reply) => this.#send({type: "reply", id: message.id, reply}));
                return;
            }
            case "done": {
                const current = this.#current;
                if (current === null || message.cell !== current.cell) return;
                current.end = message.ok ? {kind: "done", ok: true, ...(message.value === undefined ? {} : {value: message.value})} : {kind: "done", ok: false, error: message.error};
                this.#settle();
                return;
            }
        }
    }

    /** 收到了 `done`、两条管道也都读到了它的结束标记：交出这个单元的结果。 */
    #settle(): void {
        const current = this.#current;
        if (current === null || current.end === null || this.#marked.stdout < current.cell || this.#marked.stderr < current.cell) return;
        this.#current = null;
        current.done(current.end);
    }

    async #drain(stream: ReadableStream<Uint8Array>, name: "stdout" | "stderr", deliver: (text: string) => void): Promise<void> {
        const decoder = new TextDecoder();
        let pending = "";
        try {
            for await (const chunk of stream) {
                pending += decoder.decode(chunk, {stream: true});
                for (let match = MARKER.exec(pending); match !== null; match = MARKER.exec(pending)) {
                    if (match.index > 0) deliver(pending.slice(0, match.index));
                    pending = pending.slice(match.index + match[0].length);
                    this.#marked[name] = Number(match[1]);
                    this.#settle();
                }
                // 标记可能被切在两块里：从可能是标记开头的 NUL 起留着等下一块，前面的先交出去。
                const cut = pending.indexOf("\u0000");
                const ready = cut < 0 ? pending : pending.slice(0, cut);
                if (ready !== "") deliver(ready);
                pending = cut < 0 ? "" : pending.slice(cut);
            }
        } catch {
            // 进程被杀时流会出错：退出由 `exited` 收口。
        }
    }
}

export function describeExit(exit: KernelExit): string {
    return exit.signal !== null ? `信号 ${exit.signal}` : `退出码 ${String(exit.code)}`;
}

/** 一个会话的内核在登记表里的条目：超过上限时被选中回收，`evict` 由持有者结束内核并记下原因。 */
export interface KernelOwner {
    evict(): void;
}

/**
 * 全服务端的内核总数（eval.md 输出 11）：每个有内核的会话占一个进程，超过上限时回收最久没用的那个。上限是内存的兜底，
 * 30 分钟的空闲回收由各会话自己计时。
 */
export class KernelRegistry {
    readonly #owners = new Map<KernelOwner, number>();
    #tick = 0;

    constructor(readonly limit: number = 8) {}

    /** 会话起了内核或用了一次：记为最近用过；超过上限时回收别的会话里最久没用的。 */
    touch(owner: KernelOwner): void {
        this.#owners.set(owner, ++this.#tick);
        while (this.#owners.size > this.limit) {
            let oldest: KernelOwner | null = null;
            let oldestTick = Infinity;
            for (const [candidate, tick] of this.#owners) {
                if (candidate !== owner && tick < oldestTick) {
                    oldest = candidate;
                    oldestTick = tick;
                }
            }
            if (oldest === null) return;
            this.#owners.delete(oldest);
            oldest.evict();
        }
    }

    /** 会话的内核结束了（重置、空闲、关闭）：不再占名额。 */
    release(owner: KernelOwner): void {
        this.#owners.delete(owner);
    }

    get size(): number {
        return this.#owners.size;
    }
}
