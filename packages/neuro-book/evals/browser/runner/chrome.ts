/**
 * 评测为每次运行起的 Chrome：调度器唯一拥有它（执行者只连 CDP，不启动也不关闭），在沙箱里跑（执行者能叫它打开 `file://`）。
 * 进程树归 `spawnOwnedProcess`：调度器出错退出时监督进程把整棵树收掉，不留孤儿 Chrome。
 *
 * 结局表要区分 Chrome 自己退出的样子：调度器发的终止不算；退出码 0 是执行者或页面关了它；被信号结束是它崩了或被杀了。
 * 监督进程盯的是 bwrap，bwrap 把沙箱里进程的信号结束折成 128+n 的退出码（bubblewrap 0.13 的 `propagate_exit_status`），
 * 所以这里把它还原成信号名；Chrome 自己正常退出的码都在 128 以内。
 */

import {mkdir, readFile, rm} from "node:fs/promises";
import {constants} from "node:os";
import {join} from "node:path";

import {spawnOwnedProcess} from "@notnotype/owned-process";
import type {OwnedProcessCompletion} from "@notnotype/owned-process";

import {sandboxArgv} from "./sandbox";

export interface ChromeOptions {
    /** 本次运行的临时目录：Chrome 的配置目录与家目录建在它下面（`chrome-profile/`、`chrome-home/`），关掉时只删这两个。 */
    readonly runDir: string;
    readonly chromePath?: string;
    readonly windowSize?: readonly [number, number];
    readonly timeZone?: string;
    readonly language?: string;
    /** 沙箱里 Chrome 自己的沙箱起不来时加 `--no-sandbox`（外面已有 bwrap）。 */
    readonly noChromeSandbox?: boolean;
    /** 沙箱里另外要藏起来的宿主目录（见 `SandboxSpec.hide`）。 */
    readonly hide?: readonly string[];
}

export interface ChromeHandle {
    /** 浏览器级的 CDP WebSocket 地址，交给执行者与观察者。 */
    readonly cdpUrl: string;
    /** `http://127.0.0.1:<端口>`，读 `/json/version` 用。 */
    readonly httpUrl: string;
    /** `/json/version` 的 `Browser` 字段，例如 `Chrome/156.0.8078.79`。 */
    readonly version: string;
    /** Chrome 不是被调度器终止、自己退出了时的退出码与信号；还在跑或是调度器终止的为 null。 */
    selfExit(): ProcessExit | null;
    close(): Promise<void>;
}

const STARTUP_TIMEOUT_MS = 20_000;
const VERSION_TIMEOUT_MS = 5_000;

export interface ProcessExit {
    readonly exitCode: number | null;
    readonly signal: string | null;
}

/** 把 bwrap 的 128+n 退出码还原成信号名；本来就带信号或退出码在 128 以内的原样交回。 */
export function decodeSandboxExit(exit: ProcessExit): ProcessExit {
    if (exit.signal !== null || exit.exitCode === null || exit.exitCode <= 128) return exit;
    const number = exit.exitCode - 128;
    const name = Object.entries(constants.signals).find(([, value]) => value === number)?.[0] ?? `SIG${number}`;
    return {exitCode: null, signal: name};
}

export async function launchChrome(options: ChromeOptions): Promise<ChromeHandle> {
    const profile = join(options.runDir, "chrome-profile");
    const home = join(options.runDir, "chrome-home");
    await mkdir(profile, {recursive: true});
    await mkdir(home, {recursive: true});
    const [width, height] = options.windowSize ?? [1280, 900];
    const chromeArgs = [
        options.chromePath ?? "/usr/bin/google-chrome-stable",
        "--headless=new",
        "--remote-debugging-port=0",
        "--remote-debugging-address=127.0.0.1",
        "--user-data-dir=/tmp/profile",
        "--no-proxy-server",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-networking",
        "--disable-component-update",
        `--window-size=${width},${height}`,
        `--accept-lang=${options.language ?? "zh-CN"}`,
        ...(options.noChromeSandbox === true ? ["--no-sandbox"] : []),
        "about:blank",
    ];
    const argv = sandboxArgv({
        command: chromeArgs,
        binds: [{host: profile, sandbox: "/tmp/profile", writable: true}, {host: home, sandbox: "/tmp/chrome-home", writable: true}],
        hide: options.hide,
        env: {PATH: "/usr/local/bin:/usr/bin:/bin", HOME: "/tmp/chrome-home", TZ: options.timeZone ?? "Asia/Shanghai", LANG: "C.UTF-8"},
        cwd: "/tmp/chrome-home",
    });
    const lease = spawnOwnedProcess({command: argv[0] as string, args: argv.slice(1), env: {PATH: process.env.PATH ?? "/usr/bin:/bin"}, stdout: "ignore", stderr: "pipe", graceMs: 2_000});
    const stderr: string[] = [];
    lease.stderr?.on("data", (chunk: Buffer) => {
        stderr.push(chunk.toString("utf8"));
        if (stderr.length > 200) stderr.shift();
    });
    let terminating = false;
    let completion: OwnedProcessCompletion | null = null;
    const completed = lease.completion.then((value) => {
        completion = value;
        return value;
    });

    const removeDirs = async () => {
        await rm(profile, {recursive: true, force: true});
        await rm(home, {recursive: true, force: true});
    };
    const fail = async (message: string): Promise<never> => {
        terminating = true;
        await lease.terminate("startup-failure").catch(() => undefined);
        await removeDirs().catch(() => undefined);
        throw new Error(`${message}; chrome stderr tail: ${stderr.join("").slice(-1500)}`);
    };

    // Chrome 把实际端口与浏览器级路径写进配置目录里的 DevToolsActivePort。
    const started = performance.now();
    let port = "";
    let path = "";
    while (port === "") {
        if (completion !== null) return fail(`chrome exited during startup: ${JSON.stringify(completion)}`);
        if (performance.now() - started > STARTUP_TIMEOUT_MS) return fail(`chrome did not write DevToolsActivePort within ${STARTUP_TIMEOUT_MS} ms`);
        const text = await readFile(join(profile, "DevToolsActivePort"), "utf8").catch(() => "");
        const [first, second] = text.split("\n");
        if (first !== undefined && /^\d+$/u.test(first) && second !== undefined && second.startsWith("/devtools/browser/")) {
            port = first;
            path = second.trim();
        } else {
            await Bun.sleep(50);
        }
    }
    const httpUrl = `http://127.0.0.1:${port}`;
    const version = await fetch(`${httpUrl}/json/version`, {signal: AbortSignal.timeout(VERSION_TIMEOUT_MS)}).then((r) => r.json() as Promise<{Browser?: string}>).catch(() => ({Browser: undefined}));
    return {
        cdpUrl: `ws://127.0.0.1:${port}${path}`,
        httpUrl,
        version: version.Browser ?? "unknown",
        selfExit: () => (completion === null || terminating ? null : decodeSandboxExit({exitCode: completion.exitCode, signal: completion.signal})),
        close: async () => {
            terminating = completion === null;
            await lease.terminate("shutdown").catch(() => undefined);
            await completed.catch(() => undefined);
            await removeDirs();
        },
    };
}
