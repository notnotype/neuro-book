/**
 * 测试里起 `nb-site` 子进程的辅助：收集标准输出与标准错误的每一行、等某一行出现、等退出，并保证用例失败时也停掉它
 * （`stopAllSiteProcesses()` 放在 `afterEach`）。只给本包的测试用。
 *
 * 子进程的环境只有调用方给的变量加 `PATH`，`HOME` 指向临时根下的空目录，工作目录是临时根：继承来的 `NB_SITE_*`、
 * 家目录与仓库根的 `.env` 都影响不到它（入口另以 `--no-env-file` 启动）。
 */

import {mkdir} from "node:fs/promises";
import {join, resolve} from "node:path";

import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

const SERVER_SRC = resolve(import.meta.dir, "..");
/** 产品入口与测试入口。 */
export const MAIN_SCRIPT = join(SERVER_SRC, "main.ts");
export const FIXTURE_SCRIPT = join(SERVER_SRC, "testing", "fixture-main.ts");

export type LogLine = Readonly<Record<string, unknown>>;

export interface SiteProcess {
    readonly stdout: readonly string[];
    readonly stderr: readonly string[];
    /** 退出码；还没退出时为 null。 */
    readonly exitCode: number | null;
    readonly exited: Promise<number>;
    /** 标准输出里能解析成 JSON 的行。 */
    logs(): LogLine[];
    /** 等标准输出里出现满足条件的日志行，返回它；进程先退出了就立即失败。 */
    waitForLog(description: string, match: (line: LogLine) => boolean, timeoutMs?: number): Promise<LogLine>;
    /** 等退出，返回退出码。 */
    waitForExit(timeoutMs?: number): Promise<number>;
    signal(signal: NodeJS.Signals): void;
    writeStdin(text: string): void;
}

const running = new Set<{readonly process: Bun.Subprocess; readonly exited: Promise<number>}>();

function collect(stream: ReadableStream<Uint8Array>, into: string[]): Promise<void> {
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
        if (buffered !== "") into.push(buffered);
    })();
}

function parse(line: string): LogLine | undefined {
    try {
        const value: unknown = JSON.parse(line);
        return typeof value === "object" && value !== null ? (value as LogLine) : undefined;
    } catch {
        // 不是 JSON 的行（例如 commander 的用法说明）留在 `stdout` 里给断言看，这里只是不当作日志行。
        return undefined;
    }
}

export interface StartOptions {
    /** 临时根：子进程的工作目录，`HOME` 建在它下面。 */
    readonly root: string;
    readonly args: readonly string[];
    readonly env: Readonly<Record<string, string>>;
    /** 缺省是测试入口 `FIXTURE_SCRIPT`。 */
    readonly script?: string;
}

export async function startSite(options: StartOptions): Promise<SiteProcess> {
    const home = join(options.root, "home");
    await mkdir(home, {recursive: true});
    const child = Bun.spawn([process.execPath, "--no-env-file", options.script ?? FIXTURE_SCRIPT, ...options.args], {
        cwd: options.root,
        env: {PATH: process.env.PATH ?? "", HOME: home, ...options.env},
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
    });
    const stdout: string[] = [];
    const stderr: string[] = [];
    const streams = Promise.all([collect(child.stdout, stdout), collect(child.stderr, stderr)]);
    let exitCode: number | null = null;
    // 等两路输出读完再算退出：断言最后几行时它们一定已经收齐。
    const exited = (async () => {
        const code = await child.exited;
        await streams;
        exitCode = code;
        return code;
    })();
    const entry = {process: child, exited};
    running.add(entry);
    void exited.finally(() => running.delete(entry));

    const logs = (): LogLine[] => stdout.map(parse).filter((line): line is LogLine => line !== undefined);
    return {
        stdout,
        stderr,
        get exitCode() {
            return exitCode;
        },
        exited,
        logs,
        waitForLog: (description, match, timeoutMs = 10_000) =>
            waitUntil(
                description,
                () => {
                    const found = logs().find(match);
                    if (found !== undefined) return found;
                    if (exitCode !== null) throw new Error(`process exited with ${String(exitCode)} before: ${description}\nstdout:\n${stdout.join("\n")}\nstderr:\n${stderr.join("\n")}`);
                    return undefined;
                },
                {timeoutMs},
            ),
        waitForExit: (timeoutMs = 10_000) => waitUntil("process exit", () => (exitCode === null ? undefined : {code: exitCode}), {timeoutMs}).then((result) => result.code),
        signal: (signal) => child.kill(signal),
        writeStdin: (text) => {
            void child.stdin.write(text);
            void child.stdin.flush();
        },
    };
}

/** 放在 `afterEach`：还在跑的子进程一律 SIGKILL 并等它退出，免得用例失败时留下占着端口与锁的进程。 */
export async function stopAllSiteProcesses(): Promise<void> {
    const entries = [...running];
    for (const entry of entries) entry.process.kill("SIGKILL");
    await Promise.all(entries.map((entry) => entry.exited));
}

/** 起服务并等到 `site.listening`，返回进程与它的根地址（带末尾的 `/`）。 */
export async function startServing(options: Omit<StartOptions, "args">): Promise<{readonly site: SiteProcess; readonly url: string}> {
    const site = await startSite({...options, args: ["serve"]});
    const listening = await site.waitForLog("site.listening", (line) => line.event === "site.listening");
    return {site, url: String(listening.url)};
}
