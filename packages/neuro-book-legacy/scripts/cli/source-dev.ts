#!/usr/bin/env bun
import {randomBytes} from "node:crypto";
import {existsSync} from "node:fs";
import {homedir} from "node:os";
import {resolve} from "node:path";
import {spawnOwnedProcess, type OwnedProcessCompletion} from "@notnotype/owned-process";
import {shutdownNativeProduct} from "nbook/server/runtime/shutdown/product-shutdown-client";
import {
    PRODUCT_RUNTIME_EXIT_CODE_AGENT_SESSION_STORE_LEASE_COMPROMISED,
    PRODUCT_SHUTDOWN_TOKEN_ENVIRONMENT,
} from "@notnotype/neuro-book-contracts/product-runtime";
import {findRepositoryRoot, resolveWorkspaceRoots} from "#scripts/utils/workspace-roots";
import type {WorkspaceRoots} from "#scripts/utils/workspace-roots";

export type SourceDevOptions = {
    /** 显式 repository root；仅为测试和 Manager adapter 提供起点。 */
    repositoryRoot?: string;
    /** 显式 application source root；迁移后与 repository root 分离。 */
    applicationSourceRoot?: string;
    /** 兼容现有内部调用的显式 root，不再作为 cwd 猜测。 */
    cwd?: string;
    env?: NodeJS.ProcessEnv;
};

export type SourceDevUserRootsOptions = {
    platform?: NodeJS.Platform;
    environment?: NodeJS.ProcessEnv;
    homeDirectory?: string;
};

export type SourceDevUserRoots = Readonly<{
    stateRoot: string;
    cacheRoot: string;
}>;

/** Source Dev 未显式配置时使用的用户级 State/Cache 根；绝不落入 Source roots。 */
export function resolveSourceDevUserRoots(
    options: SourceDevUserRootsOptions = {},
): SourceDevUserRoots {
    const platform = options.platform ?? process.platform;
    const environment = options.environment ?? process.env;
    const home = options.homeDirectory ?? homedir();
    if (platform === "win32") {
        const localAppData = resolve(environment.LOCALAPPDATA ?? resolve(home, "AppData", "Local"));
        const base = resolve(localAppData, "NeuroBook");
        return {stateRoot: resolve(base, "data"), cacheRoot: resolve(base, "cache")};
    }
    if (platform === "darwin") {
        const support = resolve(environment.HOME ?? home, "Library", "Application Support", "NeuroBook");
        const cache = resolve(environment.HOME ?? home, "Library", "Caches", "NeuroBook");
        return {stateRoot: resolve(support, "data"), cacheRoot: cache};
    }
    const stateBase = resolve(environment.XDG_DATA_HOME ?? resolve(home, ".local", "share"), "NeuroBook");
    const cacheBase = resolve(environment.XDG_CACHE_HOME ?? resolve(home, ".cache"), "NeuroBook");
    return {stateRoot: resolve(stateBase, "data"), cacheRoot: cacheBase};
}

/**
 * 运行公开 Source Dev 入口。
 *
 * `dev:runtime` 负责安装、准备和 Nuxt 启动；本函数是唯一直接 CLI owner，负责
 * graceful shutdown、宿主断连兜底和真实退出码传播。Manager 会直接拥有内部入口。
 */
export async function runSourceDev(options: SourceDevOptions = {}): Promise<number> {
    const requestedCwd = options.cwd?.trim();
    const inherited = options.env ?? process.env;
    const requestedApplicationRoot = options.applicationSourceRoot
        ?? inherited.NEURO_BOOK_APPLICATION_ROOT?.trim()
        ?? (requestedCwd && existsSync(resolve(requestedCwd, "nuxt.config.ts")) ? requestedCwd : undefined);
    const roots: WorkspaceRoots = resolveWorkspaceRoots({
        repositoryRoot: options.repositoryRoot
            ?? inherited.NEURO_BOOK_REPOSITORY_ROOT?.trim()
            ?? findRepositoryRoot(requestedCwd),
        applicationSourceRoot: requestedApplicationRoot,
    });
    const cwd = roots.applicationSourceRoot;
    const token = randomBytes(32).toString("base64url");
    const configuredHost = inherited.NITRO_HOST?.trim() || inherited.HOST?.trim();
    const userRoots = resolveSourceDevUserRoots({environment: inherited});
    const stateRoot = inherited.NEURO_BOOK_STATE_ROOT?.trim()
        ? resolve(inherited.NEURO_BOOK_STATE_ROOT)
        : userRoots.stateRoot;
    const env = {
        ...inherited,
        ...configuredHost ? {} : {HOST: "127.0.0.1", NITRO_HOST: "127.0.0.1"},
        NEURO_BOOK_REPOSITORY_ROOT: roots.repositoryRoot,
        NEURO_BOOK_APPLICATION_ROOT: roots.applicationSourceRoot,
        NEURO_BOOK_STATE_ROOT: stateRoot,
        NEURO_BOOK_CACHE_ROOT: inherited.NEURO_BOOK_CACHE_ROOT?.trim()
            ? inherited.NEURO_BOOK_CACHE_ROOT
            : userRoots.cacheRoot,
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
    let shutdownPromise: Promise<"graceful" | "forced"> | null = null;
    let forcedShutdownPromise: Promise<"forced"> | null = null;
    let rejectShutdownFailure!: (error: unknown) => void;
    const shutdownFailure = new Promise<never>((_resolve, reject) => {
        rejectShutdownFailure = reject;
    });

    const requestShutdown = (): void => {
        signalCount += 1;
        if (signalCount === 1) {
            shutdownPromise = shutdownNativeProduct({
                port,
                token,
                host: sourceDevLoopbackHost(configuredHost),
                completion,
                forceTerminate: async () => {
                    await lease.terminate("shutdown");
                },
            });
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

/** 将Source Dev监听配置收窄为认证shutdown允许使用的loopback地址。 */
function sourceDevLoopbackHost(host: string | undefined): "127.0.0.1" | "localhost" | "[::1]" {
    const normalized = host?.toLocaleLowerCase("en-US").replace(/^\[|\]$/gu, "");
    if (normalized === "localhost") return "localhost";
    if (normalized === "::" || normalized === "::1") return "[::1]";
    return "127.0.0.1";
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
