/**
 * 后端进程的启动与退出：解析启动参数，认领状态根，按给定清单启动唯一的运行实例，等停止结算后以约定的退出码结束进程。
 * 产品入口（`main.ts`）、开发入口（`development-main.ts`）与 `nbook start` 只差加载的清单与配置从哪里来。
 *
 * 顺序：认领状态根先于任何写状态根的动作（插件的待生效变化、日志、登记表、项目子进程）。认领不到时写致命诊断、以 1 退出，
 * 不动状态根。
 *
 * 监听成功后在标准输出打印一行 `Listening on <地址>`，开发监督进程与 smoke 据此取得实际端口；内核 RPC 端口
 * 另打印一行 `RPC listening on <ws 地址>`。
 */

import {writeSync} from "node:fs";
import {join} from "node:path";

import {prepareInstalledPlugins, safeModeOf} from "nbook/plugin-platform/backend/startup";
import type {PluginsPreparation} from "nbook/plugin-platform/backend/startup";
import type {PluginDescriptor} from "nbook/manifest";
import {NEUROBOOK_PROFILE} from "nbook/plugin-platform-profile";
import {PRODUCT_VERSION} from "nbook/shared/product";

import {readServerConfig, ServerConfigError} from "./config";
import type {ServerConfig} from "./config";
import {claimStateRoot} from "./instance";
import type {ClaimResult, InstanceKind, StateRootClaim} from "./instance";
import {ompProcess} from "./omp-process";
import {ServerAssemblyError, ServerStartupError, startServer} from "./start";
import type {RunningServer, StartServerOptions} from "./start";

function fatal(event: string, fields: Record<string, unknown>): void {
    writeSync(2, `${JSON.stringify({level: "fatal", event, ...fields})}\n`);
}

function writeStderr(text: string): void {
    process.stderr.write(text);
}

function readConfigOrExit(): ServerConfig {
    try {
        return readServerConfig(process.argv.slice(2), process.env, process.cwd());
    } catch (error) {
        if (!(error instanceof ServerConfigError)) throw error;
        fatal("runtime.config.invalid", {code: error.code, message: error.message});
        process.exit(1);
    }
}

/** 认领失败的致命诊断（docs/specs/runtime/server-host.md 的失败表）。 */
export function reportClaimFailure(result: Exclude<ClaimResult, {ok: true}>, stateRoot: string): void {
    switch (result.reason) {
        case "running": {
            const {pid, url, kind, status} = result.instance;
            fatal("runtime.state-root.busy", {message: `状态根 ${stateRoot} 已有实例在运行（pid ${String(pid)}）`, stateRoot, instance: {pid, url, kind, status}});
            return;
        }
        case "unresponsive":
            fatal("runtime.state-root.busy", {message: `状态根 ${stateRoot} 已有实例，但它没有应答（被暂停或卡住）`, stateRoot, detail: result.detail});
            return;
        case "unwritable":
            fatal("runtime.state-root.unwritable", {message: `状态根 ${stateRoot} 不可写`, stateRoot, detail: result.detail});
            return;
        case "failed":
            fatal("runtime.state-root.claim-failed", {message: `无法认领状态根 ${stateRoot}`, stateRoot, detail: result.detail});
    }
}

function startOrExit(config: ServerConfig, claim: StateRootClaim, manifest: ReadonlyArray<PluginDescriptor>, prepared: PluginsPreparation, options: ServerProcessOptions): RunningServer | null {
    try {
        return startServer({
            config,
            claim,
            manifest,
            prepared,
            projectEntry: options.projectEntry,
            devTask: options.devTask,
            // 安静模式下标准输出只留给调用方的结果：项目子进程转发来的输出也写标准错误。
            projectOutput: options.quiet === true ? {stdout: writeStderr, stderr: writeStderr} : undefined,
            stopInput: config.stopStdin ? process.stdin : null,
            onListening: (url) => {
                if (options.quiet !== true) console.log(`Listening on ${url}`);
            },
            onRpcListening: (url) => {
                if (options.quiet !== true) console.log(`RPC listening on ${url}`);
            },
        });
    } catch (error) {
        // 致命诊断已由 startServer 同步写出。
        if (!(error instanceof ServerAssemblyError)) throw error;
        options.onStartupFailed?.(startupFailureReport(error));
        return null;
    }
}

export interface ServerProcessOptions {
    /** 认领时报告的身份；缺省 `product`。 */
    readonly kind?: InstanceKind;
    /** 配置；缺省从命令行与环境变量读（`main.ts`）。`nbook start` 自己组出配置。 */
    readonly config?: ServerConfig;
    /** 已认领的状态根；缺省由本函数认领，认领不到以 1 退出。`nbook start` 先自己认领，认领不到时改为打开已有实例。 */
    readonly claim?: StateRootClaim;
    /** 项目宿主入口；缺省为产品入口，开发入口给开发用的项目入口。 */
    readonly projectEntry?: string;
    /** 只有开发入口给出（样例作品）。 */
    readonly devTask?: StartServerOptions["devTask"];
    /**
     * 标准输出只留给调用方：不打印 `Listening on` 与 `RPC listening on` 两行，项目子进程的输出改写到标准错误。`nbook start`
     * 自己报告地址，`--json` 时标准输出只留一个对象。
     */
    readonly quiet?: boolean;
    /** 运行实例可用之后（health 返回 200 起）；启动失败时不调用。 */
    readonly onReady?: (server: {readonly url: string | null; readonly rpcUrl: string}) => void;
    /**
     * 启动失败（装配失败或运行实例启动失败）时，在以 1 退出之前调用；致命诊断照样写标准错误。`nbook start` 用它把失败换成
     * 命令行自己的输出。
     */
    readonly onStartupFailed?: (failure: StartupFailureReport) => void;
    /** 服务端停止结算之后、进程退出之前调用（启动中被停下也算；启动失败时不调）：给前台运行的命令行写一句“已停止”。 */
    readonly onStopped?: (exitCode: number) => void;
}

/** 启动失败的摘要：每个失败入口的来源、原因与错误消息。 */
export interface StartupFailureReport {
    readonly message: string;
    readonly causes: ReadonlyArray<{readonly source: string; readonly reason: string; readonly message: string | null}>;
}

function startupFailureReport(error: unknown): StartupFailureReport {
    if (error instanceof ServerStartupError) {
        return {message: error.message, causes: error.failures.map((failure) => ({source: failure.source, reason: failure.reason, message: failure.error?.message ?? null}))};
    }
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : null;
    return {message: error instanceof Error ? error.message : String(error), causes: [{source: "server", reason: "assembly", message: cause}]};
}

export async function runServerProcess(manifest: ReadonlyArray<PluginDescriptor>, options: ServerProcessOptions = {}): Promise<never> {
    const config = options.config ?? readConfigOrExit();
    let claim = options.claim;
    if (claim === undefined) {
        const claimed = await claimStateRoot({stateRoot: config.stateRoot, kind: options.kind ?? "product", version: PRODUCT_VERSION, report: claimReport});
        if (!claimed.ok) {
            reportClaimFailure(claimed, config.stateRoot);
            return exitAfterOmpCleanup(1);
        }
        claim = claimed.claim;
    }
    // 第三方插件集合在装配之前确定：要处理上次留下的待生效变化，并取跨进程的写入锁。认领交给 startServer 之前出错由这里放下。
    let prepared: PluginsPreparation;
    try {
        prepared = await prepareInstalledPlugins({root: join(config.stateRoot, "plugins"), profile: NEUROBOOK_PROFILE, safeMode: safeModeOf(process.env, NEUROBOOK_PROFILE)});
    } catch (error) {
        await claim.release();
        await ompProcess.cleanup();
        throw error;
    }
    const server = startOrExit(config, claim, manifest, prepared, options);
    if (server === null) {
        await claim.release();
        return exitAfterOmpCleanup(1);
    }
    // 启动失败时 startServer 已写出致命诊断，随后经 stopped 以 1 退出。
    let ran = false;
    server.ready.then(
        () => {
            ran = true;
            options.onReady?.({url: server.url, rpcUrl: server.rpcUrl});
        },
        (error: unknown) => {
            // 启动中被请求停止（Ctrl-C）不算启动失败：照常是一次停止，停完也报“已停止”。
            if (error instanceof ServerStartupError && error.status !== "failed") ran = true;
            else options.onStartupFailed?.(startupFailureReport(error));
        },
    );
    const {exitCode} = await server.stopped;
    if (ran) options.onStopped?.(exitCode);
    return exitAfterOmpCleanup(exitCode);
}

/**
 * 服务端进程的每个退出出口都经这里：先跑 OMP 登记的清理（凭据与用量缓存的刷写等）再退出。OMP 装的进程级处理已被摘掉
 * （omp-process.ts），剩下的 `exit` 监听不等异步的清理，所以要宿主自己等。
 */
async function exitAfterOmpCleanup(code: number): Promise<never> {
    await ompProcess.cleanup();
    process.exit(code);
}

/** 认领期间的次要错误：此时诊断存储还没建，直接写标准错误。 */
export function claimReport(event: string, error: unknown): void {
    writeSync(2, `${JSON.stringify({level: "warn", event, message: error instanceof Error ? error.message : String(error)})}\n`);
}
