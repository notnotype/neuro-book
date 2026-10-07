/**
 * e2e 用到的进程：生产构建的后端（`dist/server` 加 `dist/web`）与真实的开发命令。都在 Node 中启动
 * （Playwright 由 Node 运行），状态根放在测试临时根下。
 */

import {spawn} from "node:child_process";
import type {ChildProcessWithoutNullStreams} from "node:child_process";
import {join, resolve} from "node:path";

import {expect} from "@playwright/test";

export const PACKAGE_ROOT = resolve(import.meta.dirname, "..");

export interface ProcessHandle {
    readonly child: ChildProcessWithoutNullStreams;
    readonly exit: Promise<number | null>;
    output(): string;
    /** 等输出里出现 `pattern`，返回匹配结果。 */
    waitFor(pattern: RegExp): Promise<RegExpExecArray>;
}

function track(child: ChildProcessWithoutNullStreams): ProcessHandle {
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
        output += chunk.toString("utf8");
    });
    const exit = new Promise<number | null>((resolveExit) => child.on("exit", (code) => resolveExit(code)));
    return {
        child,
        exit,
        output: () => output,
        async waitFor(pattern) {
            await expect.poll(() => pattern.test(output), {message: `进程输出 ${String(pattern)}`, timeout: 30_000}).toBe(true);
            return pattern.exec(output) as RegExpExecArray;
        },
    };
}

export interface ProductServer extends ProcessHandle {
    readonly url: string;
    /** 经标准输入有序停止，返回退出码。 */
    stop(): Promise<number | null>;
}

export async function startProductServer(stateRoot: string): Promise<ProductServer> {
    const child = spawn("bun", ["dist/server/main.js", "--stop-stdin"], {
        cwd: PACKAGE_ROOT,
        env: {...process.env, NBOOK_STATE_ROOT: stateRoot, NBOOK_PORT: "0", NBOOK_WEB_ROOT: "dist/web"},
    });
    const handle = track(child);
    const url = (await handle.waitFor(/Listening on (\S+)/u))[1] as string;
    return {
        ...handle,
        url,
        async stop() {
            child.stdin.end("stop\n");
            return handle.exit;
        },
    };
}

export interface ProbeServer extends ProductServer {
    /** 内核 RPC 端口。 */
    readonly rpcPort: number;
}

/**
 * 带测试插件 `test.remote-probe` 的后端（宿主测试入口，源码运行），提供 e2e 测试外壳（`bun run build:e2e` 的
 * `dist/e2e/web`）。`port` 给定时监听这个 HTTP 端口，用于“服务端换进程”：同一地址上起第二个进程。
 */
export async function startProbeServer(stateRoot: string, options: {readonly port?: number} = {}): Promise<ProbeServer> {
    const child = spawn("bun", [join("src", "server", "testing", "fixture-entry.ts"), "--stop-stdin"], {
        cwd: PACKAGE_ROOT,
        env: {...process.env, NBOOK_STATE_ROOT: stateRoot, NBOOK_PORT: String(options.port ?? 0), NBOOK_WEB_ROOT: join("dist", "e2e", "web"), NBOOK_TEST_PLUGINS: "test.remote-probe"},
    });
    const handle = track(child);
    const rpcUrl = (await handle.waitFor(/RPC listening on (\S+)/u))[1] as string;
    const url = (await handle.waitFor(/Listening on (\S+)/u))[1] as string;
    return {
        ...handle,
        url,
        rpcPort: Number(new URL(rpcUrl).port),
        async stop() {
            child.stdin.end("stop\n");
            return handle.exit;
        },
    };
}

export interface DevSession extends ProcessHandle {
    readonly pageUrl: string;
}

export async function startDevSession(stateRoot: string): Promise<DevSession> {
    const child = spawn("bun", [join("src", "server", "dev", "main.ts")], {
        cwd: PACKAGE_ROOT,
        env: {...process.env, NBOOK_STATE_ROOT: stateRoot, NBOOK_DEV_PORT: "0", NBOOK_DEV_BACKEND_PORT: "0"},
    });
    const handle = track(child);
    const pageUrl = (await handle.waitFor(/\[dev\] page-ready (\S+)/u))[1] as string;
    await handle.waitFor(/\[dev\] backend-ready/u);
    return {...handle, pageUrl};
}
