/**
 * 评测为每次运行起的 Chrome：调度器唯一拥有它（执行者只连 CDP，不启动也不关闭），在沙箱里跑（执行者能叫它打开 `file://`）。
 * 进程树归 `spawnOwnedProcess`：调度器出错退出时监督进程把整棵树收掉，不留孤儿 Chrome。
 *
 * 结局表要区分 Chrome 自己退出的样子：调度器发的终止不算；退出码 0 是执行者或页面关了它；被信号结束是它自己崩了。
 */

import {mkdir, readFile, rm} from "node:fs/promises";
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
}

export interface ChromeHandle {
    /** 浏览器级的 CDP WebSocket 地址，交给执行者与观察者。 */
    readonly cdpUrl: string;
    /** `http://127.0.0.1:<端口>`，读 `/json/version` 用。 */
    readonly httpUrl: string;
    /** `/json/version` 的 `Browser` 字段，例如 `Chrome/156.0.8078.79`。 */
    readonly version: string;
    /** Chrome 不是被调度器终止、自己退出了时的退出码与信号；还在跑或是调度器终止的为 null。 */
    selfExit(): {readonly exitCode: number | null; readonly signal: string | null} | null;
    close(): Promise<void>;
}

const STARTUP_TIMEOUT_MS = 20_000;

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
    const version = await fetch(`${httpUrl}/json/version`).then((r) => r.json() as Promise<{Browser?: string}>).catch(() => ({Browser: undefined}));
    return {
        cdpUrl: `ws://127.0.0.1:${port}${path}`,
        httpUrl,
        version: version.Browser ?? "unknown",
        selfExit: () => (completion === null || terminating ? null : {exitCode: completion.exitCode, signal: completion.signal}),
        close: async () => {
            terminating = completion === null;
            await lease.terminate("shutdown").catch(() => undefined);
            await completed.catch(() => undefined);
            await removeDirs();
        },
    };
}
