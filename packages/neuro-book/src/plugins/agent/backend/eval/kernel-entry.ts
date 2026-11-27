/**
 * eval 内核的进程入口（docs/specs/agent/eval.md）：由宿主（`kernels.ts`）以自己的进程组起，经 Bun 的 IPC 收 `run`，
 * 在本进程真实的全局上执行宿主改写过的单元（`rewrite.ts`），代码里的 `tool.<名>`、全局对象与 `display` 都变成发给宿主的消息。
 *
 * 这里跑的是模型写的代码，所以本文件只靠自己能控制的东西：
 * - 不用 `node:vm`：Bun 在 Worker 正执行 `vm.runInContext` 的同步循环时被终止会让父进程 SIGTRAP（t21 的调研），而且
 *   跨次保留变量要的就是这个进程的全局；
 * - 没 `await` 的 rejection 与定时器里抛的错在 Bun 里会直接让进程退出（变量全丢），所以两个处理器都装上，归到当前单元；
 * - 主线程可能被同步死循环占住，“IPC 断开”的监听跑不到，所以另起一个线程看父进程还在不在。
 *
 * 不引入 TypeBox 之类的依赖：每起一个内核都要加载本文件的包。
 */

import {AsyncLocalStorage} from "node:async_hooks";
import {Console} from "node:console";
import {writeSync} from "node:fs";
import {createRequire} from "node:module";
import {isAbsolute, join, resolve} from "node:path";
import {Writable} from "node:stream";
import {pathToFileURL} from "node:url";
import {formatWithOptions, inspect, type InspectOptions} from "node:util";

import type {CallReply, CallTarget, GlobalObjects, HostMessage, KernelMessage} from "./protocol";
import {cellEndMarker, EVAL_PROTOCOL_VERSION, IMPORT_HELPER} from "./constants";

/** 同 omp：深度 6、一行宽 120、不上色。字符串原样（不加引号），整章正文才读得清（`Bun.inspect` 会把它转成一行转义文字）。 */
const INSPECT: InspectOptions = {depth: 6, breakLength: 120, colors: false};

/** 只有单元的帧是模型关心的；内核自己的帧去掉。 */
const CELL_FILE = /cell-\d+\.js/u;

/** 代码里调工具失败时抛的错：带结构化的结局，代码可以按 `status`、`code` 处理（eval.md 输出 8）。 */
class ToolCallError extends Error {
    /** 工具声明了这个码的 `errors` 时才有（eval.md 输出 8）；没有时连属性都不在，`"details" in error` 为 false。 */
    declare readonly details?: unknown;

    constructor(readonly tool: string, readonly status: string, readonly code: string | undefined, message: string, details?: unknown) {
        super(message);
        this.name = "ToolCallError";
        if (details !== undefined) Object.defineProperty(this, "details", {value: details, enumerable: true});
    }
}

const send = (message: KernelMessage): void => {
    process.send!(message);
};

// ─── 当前单元与输出 ─────────────────────────────────────────────

/**
 * 输出、调用与图片属于哪个单元，按发起它的那段代码算：单元的代码在 `cellScope` 里执行，异步的后续（`await` 之后、定时器、
 * 没 await 的 Promise）都带着它。上一个单元留下的定时器在下一个单元期间打印、调工具，仍记在上一个单元名下，宿主据此不把它
 * 算进正在跑的单元，晚到的调用得 `parent-finished`（omp #15409）。取不到时（内核自己的回调）记 0，宿主丢掉。
 */
interface CellScope {
    readonly cell: number;
    readonly floating: unknown[];
    /** 这个单元发起、还没回来的调用数；单元的代码结束后等它归零再交结果（eval.md 输出 5）。 */
    inflight: number;
    drained: (() => void) | null;
}
const cellScope = new AsyncLocalStorage<CellScope>();
/**
 * 正在执行的单元（宿主保证同一时刻只有一个，eval 是 `exclusive`）。进程级的 `unhandledRejection` 处理器不在发起者的异步上下文里，
 * `cellScope` 在那里取不到，就记到它名下。
 */
let active: CellScope | null = null;
const currentCell = (): number => cellScope.getStore()?.cell ?? 0;

/** 内核起来时的工作目录：代码里 `process.chdir` 过，下一个单元开始前改回来（与 `shell` 每次都在同一个目录一致）。 */
const workingDirectory = process.cwd();

const emitText = (text: string): void => {
    send({type: "log", cell: currentCell(), text});
};

/** `console` 的格式化交给 node 自己的 Console（table、group 缩进、count、time 都照它），输出流接到宿主。 */
const sink = new Writable({
    write(chunk: Buffer | string, _encoding, callback) {
        emitText(chunk.toString());
        callback();
    },
});
const base = new Console({stdout: sink, stderr: sink, inspectOptions: INSPECT});
const prefixed = (prefix: string) => (...args: unknown[]): void => emitText(`${prefix}${formatWithOptions(INSPECT, ...args)}\n`);
// warn 与 error 带前缀：同 omp，模型据此分得出是告警还是普通输出。
(globalThis as {console: Console}).console = Object.assign(Object.create(base) as Console, {warn: prefixed("[warn] "), error: prefixed("[error] ")});

// `process.stdout.write` 是 Node 的习惯写法，不接住的话文字会落到内核自己的标准输出上（宿主仍会读到，但与 console 的先后乱了）。
for (const stream of [process.stdout, process.stderr]) {
    (stream as {write: unknown}).write = (chunk: unknown): boolean => {
        emitText(typeof chunk === "string" ? chunk : Buffer.from(chunk as Uint8Array).toString());
        return true;
    };
}

/** 抛出的东西写成文字：Error 取消息、`cause` 与单元里的帧；别的值（`throw "x"`、`Promise.reject(1)`）照 inspect。 */
function describeError(error: unknown): {message: string; stack?: string} {
    if (!(error instanceof Error)) return {message: typeof error === "string" ? error : inspect(error, INSPECT)};
    const frames = (error.stack ?? "").split("\n").filter((line) => /^\s+at /u.test(line) && CELL_FILE.test(line));
    const cause = error.cause === undefined ? "" : `\n[cause] ${describeError(error.cause).message}`;
    const message = `${error.name}: ${error.message}${cause}`;
    return frames.length === 0 ? {message} : {message, stack: frames.join("\n")};
}

process.on("unhandledRejection", (reason) => record(reason));
process.on("uncaughtException", (error) => record(error));

/** 记到发起它的单元名下：那个单元还没结束时它会因此失败（多半是忘了 await）；已经结束的只写一行，宿主不归给正在跑的单元。 */
function record(reason: unknown): void {
    const scope = cellScope.getStore() ?? active ?? undefined;
    if (scope !== undefined) scope.floating.push(reason);
    emitText(`[unhandled] ${describeError(reason).message}\n`);
}

// ─── 代码里调工具 ─────────────────────────────────────────────

let nextCall = 1;
const pending = new Map<number, {resolve(value: unknown): void; reject(error: unknown): void}>();

function call(target: CallTarget, args: unknown): Promise<unknown> {
    const scope = cellScope.getStore();
    return new Promise((resolvePromise, rejectPromise) => {
        const id = nextCall++;
        const settle = (): void => {
            if (scope === undefined) return;
            scope.inflight -= 1;
            if (scope.inflight === 0) scope.drained?.();
        };
        if (scope !== undefined) scope.inflight += 1;
        pending.set(id, {resolve: (value) => (settle(), resolvePromise(value)), reject: (error) => (settle(), rejectPromise(error))});
        try {
            send({type: "call", id, cell: currentCell(), target, args: args ?? {}});
        } catch (error) {
            // 函数、Symbol 这类值结构化克隆不了：只这一次调用失败，码同宿主判的不合格参数（eval.md 输出 9）。
            const tool = target.kind === "tool" ? target.name : `${target.object}.${target.method}`;
            pending.get(id)!.reject(new ToolCallError(tool, "error", "invalid-arguments", `参数传不给 ${tool}：${error instanceof Error ? error.message : String(error)}；参数只能是 JSON 的值。`));
            pending.delete(id);
        }
    });
}

function deliver(id: number, reply: CallReply): void {
    const waiter = pending.get(id);
    if (waiter === undefined) return;
    pending.delete(id);
    if (reply.ok) waiter.resolve(reply.value);
    else waiter.reject(new ToolCallError(reply.tool, reply.status, reply.code, reply.message, reply.details));
}

/**
 * 这些键不能当成工具名交回函数：`then` 会让 `await tool` 卡到超时（omp 对照时实测），`toJSON`、`constructor` 与 Symbol
 * 是格式化与序列化会去读的。
 */
const NOT_A_NAME = new Set(["then", "toJSON", "constructor", "valueOf", "toString"]);

let toolNames: ReadonlySet<string> = new Set();

const tool = new Proxy({} as Record<string, (args?: unknown) => Promise<unknown>>, {
    get(_target, name) {
        if (typeof name !== "string" || NOT_A_NAME.has(name)) return undefined;
        if (!toolNames.has(name)) {
            // 拼错的名字当场说清楚，并给出能用的，模型一次就能改对。
            return () => Promise.reject(new ToolCallError(name, "error", "unknown-tool", `没有叫 ${name} 的工具。能用的：${[...toolNames].sort().join("、") || "（没有）"}`));
        }
        return (args?: unknown) => call({kind: "tool", name}, args);
    },
    has: (_target, name) => typeof name === "string" && toolNames.has(name),
    ownKeys: () => [...toolNames],
    getOwnPropertyDescriptor: (_target, name) => (typeof name === "string" && toolNames.has(name) ? {configurable: true, enumerable: true, writable: false, value: (args?: unknown) => call({kind: "tool", name}, args)} : undefined),
});

/** 全局对象：每个是一个普通对象，列得出方法；会话里的对象变了就换掉，不在了就删掉。 */
let installed = new Set<string>();
function installGlobals(globals: GlobalObjects): void {
    const next = new Set(globals.map((object) => object.name));
    for (const name of installed) if (!next.has(name)) delete (globalThis as Record<string, unknown>)[name];
    for (const object of globals) {
        const methods = Object.fromEntries(object.methods.map((method) => [method, (args?: unknown) => call({kind: "global", object: object.name, method}, args)]));
        (globalThis as Record<string, unknown>)[object.name] = Object.freeze(methods);
    }
    installed = next;
}

/** `display({data, mime})`：`data` 收 base64 字符串、Buffer 与各种字节视图。 */
function display(image: {data: unknown; mime: unknown}): void {
    if (typeof image !== "object" || image === null || typeof image.mime !== "string" || !image.mime.startsWith("image/")) throw new TypeError("display 要 {data, mime}，mime 是 image/png 这类");
    const data = image.data;
    let base64: string;
    // `uint8array.toString("base64")` 不认编码参数，交回的是 `137,80,78,…` 这样的十进制串（omp 专门容忍了它）。
    if (typeof data === "string" && /^\d{1,3}(?:,\d{1,3})+$/u.test(data)) base64 = Buffer.from(data.split(",").map(Number)).toString("base64");
    else if (typeof data === "string") base64 = data;
    else if (data instanceof ArrayBuffer) base64 = Buffer.from(data).toString("base64");
    else if (ArrayBuffer.isView(data)) base64 = Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("base64");
    else throw new TypeError("display 的 data 要是 base64 字符串或字节（Buffer、Uint8Array、ArrayBuffer）");
    send({type: "display", cell: currentCell(), image: {data: base64, mime: image.mime}});
}

/**
 * 代码里的 `import(…)` 与顶层 `import` 都经这里（`rewrite.ts` 改写过来）：`node:`、`bun:`、绝对路径照原样；相对路径与包名按
 * 内核的工作目录解析，与 `shell` 里写相对路径的结果一致。
 */
function importFrom(specifier: string, options?: ImportCallOptions): Promise<unknown> {
    if (/^(?:node|bun):/u.test(specifier) || specifier.startsWith("file:")) return load(specifier, options);
    if (isAbsolute(specifier)) return load(pathToFileURL(specifier).href, options);
    if (specifier.startsWith("./") || specifier.startsWith("../")) return load(pathToFileURL(resolve(process.cwd(), specifier)).href, options);
    return load(Bun.resolveSync(specifier, process.cwd()), options);
}

/** 内核里唯一一处计算出来的导入：模块是用户代码要的，不是打包要管的依赖（应用包的发布检查按这段文字放行，scripts/pack-app.ts）。 */
const load = (target: string, options?: ImportCallOptions): Promise<unknown> => import(target, options);

Object.assign(globalThis, {
    tool,
    display,
    ToolCallError,
    [IMPORT_HELPER]: importFrom,
    // 模型常写 `require("node:fs")`：间接 eval 在 ESM 的内核里没有 require，按工作目录建一个。
    require: createRequire(join(process.cwd(), "eval-cell.js")),
});

// ─── 执行 ─────────────────────────────────────────────

async function run(cell: number, source: string): Promise<void> {
    const scope: CellScope = {cell, floating: [], inflight: 0, drained: null};
    active = scope;
    // 结果都经 `finish` 发：先在两条管道里写结束标记，宿主收全直接写 fd 的输出再结束这个单元（`cellEndMarker`）。
    const finish = (message: KernelMessage): void => {
        const marker = cellEndMarker(cell);
        for (const fd of [1, 2]) {
            try {
                writeSync(fd, marker);
            } catch {
                // 管道已关（宿主在收口）：宿主那边由内核退出收口。
            }
        }
        send(message);
    };
    try {
        if (process.cwd() !== workingDirectory) process.chdir(workingDirectory);
        const geval = globalThis.eval;
        const value = await cellScope.run(scope, () => geval(`${source}\n//# sourceURL=cell-${cell}.js`));
        // 没 await 的调用还在路上：等它们回来（回来之后挂在它们后面的代码可能再抛错），再让浮动的 rejection 冒出来，然后才判。
        // 一次回来可能又发起新的调用，所以循环到真的归零。
        while (scope.inflight > 0) await new Promise<void>((done) => (scope.drained = done));
        // 两轮宏任务：IPC 回调里产生的 rejection，Bun 要到下一轮之后才派发 `unhandledRejection`（实测一轮不够）。
        await Bun.sleep(0);
        await Bun.sleep(0);
        const floating = scope.floating;
        if (floating.length > 0) {
            const first = describeError(floating[0]);
            finish({type: "done", cell, ok: false, error: {message: `Unhandled rejection（是不是忘了 await？）：${first.message}`, ...(first.stack === undefined ? {} : {stack: first.stack})}});
            return;
        }
        finish({type: "done", cell, ok: true, ...(value === undefined ? {} : {value: typeof value === "string" ? value : inspect(value, INSPECT)})});
    } catch (error) {
        finish({type: "done", cell, ok: false, error: describeError(error)});
    } finally {
        active = null;
    }
}

process.on("message", (raw: unknown) => {
    const message = raw as HostMessage;
    switch (message.type) {
        case "hello":
            send({type: "ready", version: EVAL_PROTOCOL_VERSION});
            return;
        case "run":
            toolNames = new Set(message.tools);
            installGlobals(message.globals);
            void run(message.cell, message.source);
            return;
        case "reply":
            deliver(message.id, message.reply);
            return;
    }
});

// ─── 父进程不在了就收掉整个进程组 ─────────────────────────────────

/** 杀自己的进程组：代码起的子进程一起结束（eval.md 输出 13）。不是组长时（例如平台不支持）退而只结束自己。 */
const KILL_GROUP = `
    const {workerData} = require("node:worker_threads");
    setInterval(() => {
        try { process.kill(workerData.parent, 0); return; } catch {}
        try { process.kill(-workerData.self, "SIGKILL"); } catch { process.kill(workerData.self, "SIGKILL"); }
    }, 250);
`;

// 单独一个线程：主线程被同步死循环占住时 IPC 的 disconnect 事件不会派发（omp 为此加了看门狗线程，issue #14340）。
// 线程的代码是一段 Blob URL，不按路径找文件（应用包的发布检查按这段文字放行，scripts/pack-app.ts）。
const watchdogUrl = URL.createObjectURL(new Blob([KILL_GROUP], {type: "application/javascript"}));
new Worker(watchdogUrl, {workerData: {parent: process.ppid, self: process.pid}} as WorkerOptions);
process.on("disconnect", () => {
    try {
        process.kill(-process.pid, "SIGKILL");
    } catch {
        process.exit(1);
    }
});
