/**
 * 合同测试的底座：在本测试文件的临时根里起被测的 `nb-site` 进程，只经 HTTP 与命令行和它说话（ADR 0059 决策 6）。
 * 被测程序可以是本仓库的源码，也可以是别的实现：命令由环境变量给出，见 `serverCommand()`。
 *
 * 子进程看到的东西都由这里决定：
 * - 工作目录是本文件的临时根，`HOME` 与 `TMPDIR` 是临时根下的空目录；
 * - 环境只有 `PATH`、`HOME`、`TMPDIR` 加一套合格的 `NB_SITE_*`（`baseEnv()`），不继承测试进程的环境：开发机上设着的
 *   `NB_SITE_*`、代理变量都混不进来；
 * - `serve` 缺省另带一个每次随机生成的测试控制口令（`site.operations` 输出 11），用例要测“没设口令”时用 `env` 把它设成 undefined。
 *
 * 收口：每个起过的进程都登记在这里。用例里起的，在这个用例的 `afterEach` 里停掉；`beforeAll` 里起的属于整个文件（几个用例共用），
 * 在 `afterAll` 里停掉，之后再删临时根（删目录不等于关了里面的文件）。测试进程退出时（正常结束或未捕获异常）`process.on("exit")`
 * 对还活着的 SIGKILL。测试进程自己被 SIGKILL 时子进程会留下，是已知限制（w00037 t05 计划第 8 节）。
 */

import {afterAll, afterEach, beforeAll, beforeEach} from "bun:test";
import {randomBytes} from "node:crypto";
import {readFileSync} from "node:fs";
import {mkdir, rm} from "node:fs/promises";
import {connect, createServer, type AddressInfo} from "node:net";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

/** 被测程序的 argv（JSON 数组），例如 `["/usr/bin/bun","--no-env-file","/abs/server.js"]`；换语言重写后指向新程序。 */
export const SERVER_COMMAND_ENV = "NB_SITE_SERVER_COMMAND";
/** 上一个发布版本的程序，形式同上；只有相邻版本测试用它，没设时那组用例跳过。 */
export const PREVIOUS_SERVER_COMMAND_ENV = "NB_SITE_PREVIOUS_SERVER_COMMAND";

export type LogLine = Readonly<Record<string, unknown>>;
export type Env = Readonly<Record<string, string | undefined>>;

/**
 * 读一个“命令”环境变量：没设或为空串时返回 undefined；设了但不是非空的字符串数组时抛错。
 * 设错了不能悄悄退回缺省的程序：那样对着别的实现跑的人以为测的是新程序。
 */
export function commandFromEnv(name: string): readonly string[] | undefined {
    const raw = process.env[name];
    if (raw === undefined || raw === "") return undefined;
    let value: unknown;
    try {
        value = JSON.parse(raw);
    } catch (error) {
        throw new Error(`${name} must be a JSON array of strings, e.g. ["bun","--no-env-file","/abs/server.js"]`, {cause: error});
    }
    if (!Array.isArray(value) || value.length === 0 || !value.every((item): item is string => typeof item === "string" && item !== "")) {
        throw new Error(`${name} must be a non-empty JSON array of non-empty strings`);
    }
    return value;
}

/**
 * 缺省的被测程序：本仓库 `nb-site-server` 清单里 `bin` 的 `nb-site`，用跑测试的这个 Bun 执行。经 `import.meta.resolve` 找到清单，
 * 那是解析路径，不导入被测系统的代码。`--no-env-file` 与入口首行的写法一致：Bun 缺省会读工作目录的 `.env`。
 */
function defaultCommand(): readonly string[] {
    const manifestPath = fileURLToPath(import.meta.resolve("@notnotype/nb-site-server/package.json"));
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {readonly bin?: unknown};
    const script = typeof manifest.bin === "object" && manifest.bin !== null ? (manifest.bin as Readonly<Record<string, unknown>>)["nb-site"] : undefined;
    if (typeof script !== "string") throw new Error("@notnotype/nb-site-server/package.json has no bin.nb-site");
    return [process.execPath, "--no-env-file", join(dirname(manifestPath), script)];
}

let resolvedCommand: readonly string[] | undefined;

/** 本版本的被测程序：设了 `NB_SITE_SERVER_COMMAND` 就用它，否则用本仓库的源码入口。 */
export function serverCommand(): readonly string[] {
    resolvedCommand ??= commandFromEnv(SERVER_COMMAND_ENV) ?? defaultCommand();
    return resolvedCommand;
}

export interface ProcessOptions {
    /** 数据目录，写进 `NB_SITE_DATA_DIR`；缺省时这个变量不设（`env` 里再给的照样生效）。 */
    readonly dataDir?: string;
    /** 盖在 `baseEnv()` 之上；值为 undefined 的键从环境里去掉。 */
    readonly env?: Env;
    /** 缺省 `serverCommand()`；相邻版本测试传上一个版本的程序。 */
    readonly command?: readonly string[];
    /** 缺省 10 秒。`start` 是等到监听的上限，`run` 是等到退出的上限。 */
    readonly timeoutMs?: number;
}

export interface RunOptions extends ProcessOptions {
    /** 写进标准输入后关闭；不给时标准输入是空的。 */
    readonly stdin?: string;
}

export interface CommandResult {
    readonly exitCode: number;
    readonly stdout: string;
    readonly stderr: string;
    /** 标准输出里能解析成 JSON 对象的行。 */
    readonly logs: readonly LogLine[];
    /** 标准错误的最后一行解析成的 JSON 对象（以非零码结束的命令写的那一行，`site.operations` 输出 10）；没有或不是 JSON 时为 undefined。 */
    readonly failure: LogLine | undefined;
}

export interface JsonResponse {
    readonly status: number;
    readonly headers: Headers;
    readonly body: unknown;
}

export interface SiteProcess {
    /** 根地址，带末尾的 `/`，取自 `site.listening` 那一行。 */
    readonly url: string;
    readonly dataDir: string | undefined;
    /** 这个进程的测试控制口令；起进程时去掉了口令则为 null。 */
    readonly testControlToken: string | null;
    /** 退出码；还在运行时为 null。 */
    readonly exitCode: number | null;
    /** 到目前为止标准输出里能解析成 JSON 对象的行。 */
    logs(): readonly LogLine[];
    /** 到目前为止的整段标准输出与标准错误。 */
    stdout(): string;
    stderr(): string;
    /** 等到 `GET /health/ready` 回 200，返回响应体；缺省等 10 秒。 */
    ready(timeoutMs?: number): Promise<unknown>;
    /** 发 SIGTERM 并等它退出，返回退出码；超时（缺省 10 秒）后 SIGKILL 并抛错。 */
    stop(timeoutMs?: number): Promise<number>;
    /** 经测试控制入口把模块的时间往前拨，返回拨过之后的 `now`；不是 200 时抛错（带状态码与响应体）。 */
    advanceClock(ms: number): Promise<number>;
    /**
     * 经测试控制入口立即跑一次定时任务，返回状态码与响应体，不按状态码抛错：404、500、503 都是合同里写明的结果，
     * 由用例断言。
     */
    runJob(module: string, job: string): Promise<JsonResponse>;
}

export interface SiteSandbox {
    /** 本文件的临时根；只在 `beforeAll` 之后可用。 */
    readonly root: string;
    /** 临时根下新建一个空的数据目录。 */
    dataDir(): Promise<string>;
    /** 起 `serve`，等到 `site.listening` 那一行；进程先退出或超时都抛错，错误里带已收到的标准错误。 */
    start(options?: ProcessOptions): Promise<SiteProcess>;
    /** 跑一个会自己退出的命令（`migrate`、`backup`，或预期失败的 `serve`），等它退出；超时后 SIGKILL 并抛错。 */
    run(command: string, options?: RunOptions): Promise<CommandResult>;
}

/** 一个起过的子进程。`exitCode` 在两路输出都读完之后才设：断言最后几行时它们一定已经收齐。 */
interface Child {
    readonly subprocess: Bun.Subprocess;
    readonly stdout: string[];
    readonly stderr: string[];
    exitCode: number | null;
    readonly exited: Promise<number>;
    /** `test`：用例里起的，这个用例结束时停掉；`file`：`beforeAll` 里起的，文件结束时停掉。 */
    readonly scope: "test" | "file";
}

const DEFAULT_TIMEOUT_MS = 10_000;
/** 收口时等 SIGTERM 生效的上限；被测程序的停止时限缺省 10 秒，但测试里没有在途的慢请求，正常几十毫秒就退出。 */
const CLEANUP_TIMEOUT_MS = 5_000;

/** 全部文件起过、还活着的子进程，给 `process.on("exit")` 的兜底用。 */
const alive = new Set<Child>();
let exitHookInstalled = false;

function installExitHook(): void {
    if (exitHookInstalled) return;
    exitHookInstalled = true;
    // exit 事件里只能做同步的事：kill 是同步的，不等它退出。
    process.on("exit", () => {
        for (const child of alive) child.subprocess.kill("SIGKILL");
    });
}

function collectLines(stream: ReadableStream<Uint8Array>, into: string[]): Promise<void> {
    return (async () => {
        const decoder = new TextDecoder();
        let buffered = "";
        for await (const chunk of stream) {
            buffered += decoder.decode(chunk, {stream: true});
            let newline: number;
            while ((newline = buffered.indexOf("\n")) >= 0) {
                into.push(buffered.slice(0, newline));
                buffered = buffered.slice(newline + 1);
            }
        }
        buffered += decoder.decode();
        if (buffered !== "") into.push(buffered);
    })();
}

function parseLine(line: string): LogLine | undefined {
    let value: unknown;
    try {
        value = JSON.parse(line);
    } catch {
        // 不是 JSON 的行（例如别的实现的用法说明）留在整段输出里给断言看，这里只是不当作日志行。
        return undefined;
    }
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as LogLine) : undefined;
}

function parseLines(lines: readonly string[]): LogLine[] {
    return lines.map(parseLine).filter((line): line is LogLine => line !== undefined);
}

function describeOutput(child: Child): string {
    return `stdout:\n${child.stdout.join("\n")}\nstderr:\n${child.stderr.join("\n")}`;
}

/** 等到退出，返回退出码；超时返回 null，由调用方 SIGKILL 并报错。 */
async function waitForExit(child: Child, timeoutMs: number): Promise<number | null> {
    try {
        const {code} = await waitUntil("process exit", () => (child.exitCode === null ? undefined : {code: child.exitCode}), {timeoutMs});
        return code;
    } catch {
        // 检查函数不抛，走到这里只会是等待超时；超时的那一刻恰好退出了也照实返回。
        return child.exitCode;
    }
}

/** SIGTERM，等到退出；超时就 SIGKILL 并等它退出。返回退出码与是否动用了 SIGKILL。 */
async function terminate(child: Child, timeoutMs: number): Promise<{readonly code: number; readonly killed: boolean}> {
    if (child.exitCode !== null) return {code: child.exitCode, killed: false};
    child.subprocess.kill("SIGTERM");
    const code = await waitForExit(child, timeoutMs);
    if (code !== null) return {code, killed: false};
    child.subprocess.kill("SIGKILL");
    return {code: await child.exited, killed: true};
}

/** 预留一个本机端口：让系统挑一个空闲的再放掉。给“这个端口始终没被监听”的断言用；放掉之后可能被别的进程占去，概率很小。 */
export async function reservePort(): Promise<number> {
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    const {port} = server.address() as AddressInfo;
    await new Promise<void>((resolve, reject) => server.close((error) => (error === undefined ? resolve() : reject(error))));
    return port;
}

/** 这个地址上有没有人在监听：连得上为 true，被拒绝（`ECONNREFUSED`）为 false，别的错误照常抛出。 */
export function isListening(port: number, host = "127.0.0.1"): Promise<boolean> {
    return new Promise((resolve, reject) => {
        const socket = connect({host, port});
        socket.once("connect", () => {
            socket.destroy();
            resolve(true);
        });
        socket.once("error", (error: NodeJS.ErrnoException) => {
            socket.destroy();
            if (error.code === "ECONNREFUSED") resolve(false);
            else reject(error);
        });
    });
}

/** 经原始套接字发一段请求文字，读到对方关闭连接为止。`fetch` 总会补上 `Host`，测“读不出主机名”只能这样发。 */
export function rawHttp(url: string, request: string): Promise<string> {
    const {hostname, port} = new URL(url);
    return new Promise((resolve, reject) => {
        const socket = connect({host: hostname, port: Number(port)});
        const chunks: Buffer[] = [];
        socket.once("connect", () => socket.end(request));
        socket.on("data", (chunk: Buffer) => chunks.push(chunk));
        socket.once("error", reject);
        socket.once("close", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });
}

/** 请求并把响应体按 JSON 读出；响应体不是 JSON 时抛错（合同里每个响应体都是 JSON）。 */
export async function requestJson(url: string, init?: RequestInit): Promise<JsonResponse> {
    const response = await fetch(url, init);
    const text = await response.text();
    let body: unknown;
    try {
        body = JSON.parse(text);
    } catch (error) {
        throw new Error(`${init?.method ?? "GET"} ${url} answered ${String(response.status)} with a body that is not JSON: ${text.slice(0, 200)}`, {cause: error});
    }
    return {status: response.status, headers: response.headers, body};
}

/** 测试控制入口的一次请求；`token` 为 null 时不带 `Authorization`。 */
export function testControlRequest(url: string, path: "clock" | "jobs/run", body: unknown, token: string | null): Promise<JsonResponse> {
    return requestJson(`${url}test-control/${path}`, {
        method: "POST",
        headers: {"Content-Type": "application/json", ...(token === null ? {} : {Authorization: `Bearer ${token}`})},
        body: JSON.stringify(body),
    });
}

/** 一个新的随机口令或密钥：48 个十六进制字符，满足“至少 32 个字符”。 */
export function randomSecret(): string {
    return randomBytes(24).toString("hex");
}

/**
 * 在当前测试文件里登记收口用的钩子，返回沙箱。在文件顶层调用一次：钩子登记在调用处所在的作用域。
 * `purpose` 写进临时根的 owner 标记，传测试文件名。
 */
export function useSiteSandbox(purpose: string): SiteSandbox {
    installExitHook();
    let root: string | undefined;
    let home = "";
    let tmp = "";
    let dataDirs = 0;
    /** 本文件起过、还没收口的进程。 */
    const owned = new Set<Child>();
    /** 在 `beforeEach` 与 `afterEach` 之间为 true：这时起的进程属于当前用例。 */
    let inTest = false;

    const rootOrThrow = (): string => {
        if (root === undefined) throw new Error("the site sandbox is used before its beforeAll ran");
        return root;
    };

    /** 给子进程的环境：只有明确列出的几项。会话密钥每个沙箱随机一个（48 个字符）。 */
    const sessionSecret = randomSecret();
    const baseEnv = (): Record<string, string> => ({
        PATH: process.env.PATH ?? "",
        HOME: home,
        TMPDIR: tmp,
        NB_SITE_URL: "https://site.test",
        NB_SITE_TELEMETRY_URL: "https://telemetry.test",
        NB_SITE_SESSION_SECRET: sessionSecret,
        NB_SITE_HOST: "127.0.0.1",
        NB_SITE_PORT: "0",
    });

    const buildEnv = (options: ProcessOptions, extra: Env): Record<string, string> => {
        const merged: Record<string, string | undefined> = {...baseEnv(), ...(options.dataDir === undefined ? {} : {NB_SITE_DATA_DIR: options.dataDir}), ...extra, ...options.env};
        return Object.fromEntries(Object.entries(merged).filter((entry): entry is [string, string] => entry[1] !== undefined));
    };

    const spawn = (args: readonly string[], env: Record<string, string>, command: readonly string[], stdin: string | undefined): Child => {
        const subprocess = Bun.spawn([...command, ...args], {
            cwd: rootOrThrow(),
            env,
            stdin: stdin === undefined ? "ignore" : new Blob([stdin]),
            stdout: "pipe",
            stderr: "pipe",
        });
        const stdout: string[] = [];
        const stderr: string[] = [];
        const streams = Promise.all([collectLines(subprocess.stdout, stdout), collectLines(subprocess.stderr, stderr)]);
        let settle!: (code: number) => void;
        const child: Child = {
            subprocess,
            stdout,
            stderr,
            exitCode: null,
            scope: inTest ? "test" : "file",
            exited: new Promise<number>((resolve) => (settle = resolve)),
        };
        alive.add(child);
        owned.add(child);
        void (async () => {
            const code = await subprocess.exited;
            try {
                await streams;
            } finally {
                // 读输出出错时（不该发生）错误照常抛成未处理的拒绝，但退出照样登记，等退出的一方不会卡住。
                child.exitCode = code;
                alive.delete(child);
                owned.delete(child);
                settle(code);
            }
        })();
        return child;
    };

    /** 收口一批进程：都先 SIGTERM，等它们退出；有动用 SIGKILL 或退出码不是 0 的，全部收完之后抛错。 */
    const cleanUp = async (children: readonly Child[]): Promise<void> => {
        const outcomes = await Promise.all(children.map(async (child) => ({child, ...(await terminate(child, CLEANUP_TIMEOUT_MS))})));
        const bad = outcomes.filter((outcome) => outcome.killed || outcome.code !== 0);
        if (bad.length > 0) {
            throw new Error(
                `site processes left running did not stop cleanly on SIGTERM:\n${bad.map(({child, code, killed}) => `${killed ? "killed after timeout" : `exit ${String(code)}`}\n${describeOutput(child)}`).join("\n---\n")}`,
            );
        }
    };

    beforeAll(async () => {
        root = await createTestTmpRoot("nb-site-contract", purpose);
        home = join(root, "home");
        tmp = join(root, "tmp");
        await mkdir(home);
        await mkdir(tmp);
    });
    beforeEach(() => {
        inTest = true;
    });
    afterEach(async () => {
        inTest = false;
        await cleanUp([...owned].filter((child) => child.scope === "test"));
    });
    afterAll(async () => {
        try {
            await cleanUp([...owned]);
        } finally {
            if (root !== undefined) await rm(root, {recursive: true, force: true});
        }
    });

    const toProcess = (child: Child, url: string, options: ProcessOptions, token: string | null): SiteProcess => ({
        url,
        dataDir: options.dataDir,
        testControlToken: token,
        get exitCode() {
            return child.exitCode;
        },
        logs: () => parseLines(child.stdout),
        stdout: () => child.stdout.join("\n"),
        stderr: () => child.stderr.join("\n"),
        ready: (timeoutMs = DEFAULT_TIMEOUT_MS) =>
            waitUntil(
                "GET /health/ready answers 200",
                async () => {
                    if (child.exitCode !== null) throw new Error(`serve exited with ${String(child.exitCode)} while waiting for readiness\n${describeOutput(child)}`);
                    const response = await requestJson(`${url}health/ready`);
                    return response.status === 200 ? {body: response.body} : undefined;
                },
                {timeoutMs},
            ).then((result) => result.body),
        stop: async (timeoutMs = DEFAULT_TIMEOUT_MS) => {
            const {code, killed} = await terminate(child, timeoutMs);
            if (killed) throw new Error(`serve did not exit within ${String(timeoutMs)}ms of SIGTERM\n${describeOutput(child)}`);
            return code;
        },
        advanceClock: async (ms) => {
            if (token === null) throw new Error("this process was started without a test control token");
            const response = await testControlRequest(url, "clock", {advanceMs: ms}, token);
            const now = (response.body as {readonly now?: unknown} | null)?.now;
            if (response.status !== 200 || typeof now !== "number") throw new Error(`POST /test-control/clock answered ${String(response.status)}: ${JSON.stringify(response.body)}`);
            return now;
        },
        runJob: (module, job) => {
            if (token === null) throw new Error("this process was started without a test control token");
            return testControlRequest(url, "jobs/run", {module, job}, token);
        },
    });

    return {
        get root() {
            return rootOrThrow();
        },
        dataDir: async () => {
            dataDirs += 1;
            const dir = join(rootOrThrow(), `data-${String(dataDirs)}`);
            await mkdir(dir);
            return dir;
        },
        start: async (options = {}) => {
            const env = buildEnv(options, {NB_SITE_TEST_CONTROL: randomSecret()});
            const token = env.NB_SITE_TEST_CONTROL ?? null;
            const child = spawn(["serve"], env, options.command ?? serverCommand(), undefined);
            const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
            let listening: LogLine;
            try {
                // 同时看两件事，先到先判：读到 `site.listening` 就成功；进程先退出了就立即失败，不等到超时。
                listening = await waitUntil(
                    "site.listening",
                    () => {
                        const line = parseLines(child.stdout).find((candidate) => candidate.event === "site.listening");
                        if (line !== undefined) return line;
                        if (child.exitCode !== null) throw new Error(`serve exited with ${String(child.exitCode)} before site.listening\n${describeOutput(child)}`);
                        return undefined;
                    },
                    {timeoutMs},
                );
            } catch (error) {
                if (child.exitCode !== null) throw error;
                child.subprocess.kill("SIGKILL");
                await child.exited;
                throw new Error(`serve did not log site.listening within ${String(timeoutMs)}ms\n${describeOutput(child)}`, {cause: error});
            }
            if (typeof listening.url !== "string") throw new Error(`site.listening has no url: ${JSON.stringify(listening)}`);
            return toProcess(child, listening.url, options, token);
        },
        run: async (command, options = {}) => {
            const child = spawn([command], buildEnv(options, {}), options.command ?? serverCommand(), options.stdin);
            const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
            const exitCode = await waitForExit(child, timeoutMs);
            if (exitCode === null) {
                child.subprocess.kill("SIGKILL");
                await child.exited;
                throw new Error(`${command} did not exit within ${String(timeoutMs)}ms\n${describeOutput(child)}`);
            }
            const lastStderr = child.stderr.filter((line) => line !== "").at(-1);
            return {
                exitCode,
                stdout: child.stdout.join("\n"),
                stderr: child.stderr.join("\n"),
                logs: parseLines(child.stdout),
                failure: lastStderr === undefined ? undefined : parseLine(lastStderr),
            };
        },
    };
}
