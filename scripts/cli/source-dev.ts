#!/usr/bin/env bun
import {randomBytes} from "node:crypto";
import {resolve} from "node:path";
import {spawnOwnedProcess, type OwnedProcessCompletion} from "@notnotype/owned-process";
import {
    PRODUCT_RUNTIME_EXIT_CODE_AGENT_SESSION_STORE_LEASE_COMPROMISED,
    PRODUCT_SHUTDOWN_TOKEN_ENVIRONMENT,
} from "nbook/shared/product-runtime-contract";

export type SourceDevOptions = {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
};

/**
 * 运行公开 Source Dev 入口。
 *
 * `dev:runtime` 只负责既有准备和 Nuxt 启动；本函数是唯一直接 CLI owner，负责
 * graceful shutdown、宿主断连兜底和真实退出码传播。Manager 会直接拥有内部入口。
 */
export async function runSourceDev(options: SourceDevOptions = {}): Promise<number> {
    const cwd = options.cwd ?? process.cwd();
    const inherited = options.env ?? process.env;
    const token = randomBytes(32).toString("base64url");
    const configuredHost = inherited.NITRO_HOST?.trim() || inherited.HOST?.trim();
    const env = {
        ...inherited,
        ...configuredHost ? {} : {HOST: "127.0.0.1", NITRO_HOST: "127.0.0.1"},
        NEURO_BOOK_CACHE_ROOT: inherited.NEURO_BOOK_CACHE_ROOT?.trim()
            ? inherited.NEURO_BOOK_CACHE_ROOT
            : resolve(cwd, ".agent", "cache"),
        [PRODUCT_SHUTDOWN_TOKEN_ENVIRONMENT]: token,
    };
    const port = sourceDevPort(env);
    const lease = spawnOwnedProcess({
        command: process.execPath,
        args: ["--no-install", "run", "dev:runtime"],
        cwd,
        env,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
        windowsHide: false,
        graceMs: 2_000,
        hardKillWaitMs: 5_000,
    });
    const completion = lease.completion.then(productExit);
    let signalCount = 0;
    let shutdownPromise: Promise<"forced"> | null = null;
    let forcedShutdownPromise: Promise<"forced"> | null = null;
    let rejectShutdownFailure!: (error: unknown) => void;
    const shutdownFailure = new Promise<never>((_resolve, reject) => {
        rejectShutdownFailure = reject;
    });

    const requestShutdown = (): void => {
        signalCount += 1;
        if (signalCount === 1) {
            shutdownPromise = lease.terminate("shutdown").then(() => "forced" as const);
            void shutdownPromise.catch(rejectShutdownFailure);
            return;
        }
        if (!forcedShutdownPromise) {
            forcedShutdownPromise = lease.terminate("shutdown").then(() => "forced" as const);
            void forcedShutdownPromise.catch(rejectShutdownFailure);
        }
    };
    process.on("SIGINT", requestShutdown);
    process.on("SIGTERM", requestShutdown);

    try {
        const result = await Promise.race([lease.completion, shutdownFailure]);
        const requestedShutdown = forcedShutdownPromise ?? shutdownPromise;
        if (requestedShutdown) {
            await requestedShutdown;
            const terminal = await completion;
            return terminal.signal === null
                && terminal.code === PRODUCT_RUNTIME_EXIT_CODE_AGENT_SESSION_STORE_LEASE_COMPROMISED
                ? PRODUCT_RUNTIME_EXIT_CODE_AGENT_SESSION_STORE_LEASE_COMPROMISED
                : 0;
        }
        return ownedProcessExitCode(result);
    } finally {
        process.off("SIGINT", requestShutdown);
        process.off("SIGTERM", requestShutdown);
    }
}

/** Source Dev 继续沿用 Nuxt 的 NUXT_PORT/PORT/default 解析顺序。 */
function sourceDevPort(env: NodeJS.ProcessEnv): number {
    const raw = env.NUXT_PORT?.trim() || env.PORT?.trim() || "3000";
    const port = Number(raw);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
        throw new Error(`Source Dev端口无效：${raw}`);
    }
    return port;
}

/** 将 Owned Process 终态投影为共享 Product shutdown 合同。 */
function productExit(result: OwnedProcessCompletion): {code: number | null; signal: string | null} {
    return {code: result.exitCode, signal: result.signal};
}

/** 自然退出保留真实 code；signal/异常空终态使用失败码。 */
function ownedProcessExitCode(result: OwnedProcessCompletion): number {
    if (result.signal !== null) return 1;
    return result.exitCode ?? 1;
}

if (import.meta.main) {
    process.exitCode = await runSourceDev();
}
