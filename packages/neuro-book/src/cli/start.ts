/**
 * `nbook start`（docs/specs/runtime/cli.md 的“start”）：前台运行服务端，终端拥有它的寿命；状态根上已有实例时打开它。
 *
 * 一轮一轮地问状态根上的实例：没有就认领并在本进程里运行服务端；已就绪就报告它的地址并以 0 退出；还在启动或正在停止就等
 * 它变化，至多 60 秒。认领与“问实例”之间可能被别人抢先：认领报 `running` 时回到下一轮去问，不当作失败。
 */

import {join} from "node:path";

import open from "open";

import {productPlugins} from "nbook/manifest";
import {readServerConfig, ServerConfigError} from "nbook/server/config";
import {claimNeuroBook, queryNeuroBook} from "nbook/server/instance";
import type {InstanceInfo, StateRootClaim} from "nbook/server/instance";
import {claimReport, runServerProcess} from "nbook/server/process";
import {desktopReach} from "nbook/shared/desktop";
import {PRODUCT_VERSION} from "nbook/shared/product";
import {RESUME_PATH} from "nbook/shared/resume-path";

import {CliFailure} from "./output";
import type {Output} from "./output";

export interface StartOptions {
    readonly port: number | undefined;
    readonly rpcPort: number | undefined;
    readonly open: boolean;
    readonly safeMode: boolean;
}

export interface StartContext {
    readonly stateRoot: string;
    readonly output: Output;
    readonly env: Readonly<Record<string, string | undefined>>;
    readonly cwd: string;
}

/** 等已有实例就绪（或停完）的上限。 */
const WAIT_MS = 60_000;
const POLL_MS = 200;

/** 打包产物里 Web 产物在 `server/` 旁的 `web/`；源码运行时用包里构建好的 `dist/web`。 */
function defaultWebRoot(): string {
    return import.meta.path.endsWith(".js") ? join(import.meta.dir, "..", "web") : join(import.meta.dir, "..", "..", "dist", "web");
}

/**
 * 打开浏览器（cli.md 输出 9）：打开的是“启动时打开”的路由（进上次的作品或书架），给人看的地址仍是根地址。`url` 以斜杠结尾，
 * 路由用 `new URL` 拼。
 */
async function openBrowser(url: string, context: StartContext, options: StartOptions): Promise<void> {
    if (!options.open) return;
    // 只在本机有桌面时打开浏览器（判据见 `shared/desktop.ts`）。
    const reachable = desktopReach(context.env, process.platform);
    if (reachable === "ssh") {
        const port = new URL(url).port;
        context.output.hint(`这是 SSH 会话，没有打开浏览器。在本机运行 ssh -L ${port}:127.0.0.1:${port} <这台机器>，再打开上面的地址。`);
        return;
    }
    if (reachable === "no-display") {
        context.output.hint("没有图形会话，没有打开浏览器；请手动打开上面的地址。");
        return;
    }
    try {
        await open(new URL(RESUME_PATH, url).href);
    } catch (error) {
        context.output.hint(`打不开浏览器（${error instanceof Error ? error.message : String(error)}），请手动打开上面的地址。`);
    }
}

function report(instance: {readonly url: string | null; readonly rpcUrl: string | null; readonly pid: number; readonly version: string}, started: boolean, context: StartContext): void {
    const text = started
        ? `NeuroBook 已启动：${instance.url ?? ""}\n状态根：${context.stateRoot}`
        : `NeuroBook 已在运行：${instance.url ?? ""}（pid ${String(instance.pid)}）\n状态根：${context.stateRoot}`;
    context.output.result(text, {url: instance.url, rpcUrl: instance.rpcUrl, pid: instance.pid, version: instance.version, stateRoot: context.stateRoot, started});
}

/** 已有实例：不能用的（开发服务、版本不同）直接失败；就绪的报告并打开；返回 false 表示还要等。 */
async function existing(instance: InstanceInfo, context: StartContext, options: StartOptions): Promise<boolean> {
    const fields = {pid: instance.pid, stateRoot: context.stateRoot};
    if (instance.kind === "development") {
        throw new CliFailure("development-instance", `状态根 ${context.stateRoot} 正由开发服务使用（pid ${String(instance.pid)}），请用开发服务打开的页面`, 1, fields);
    }
    if (instance.version !== PRODUCT_VERSION) {
        throw new CliFailure("version-mismatch", `运行中的是 NeuroBook ${instance.version}，已安装的是 ${PRODUCT_VERSION}：先停掉运行中的服务（pid ${String(instance.pid)}）再启动`, 1, {...fields, running: instance.version, installed: PRODUCT_VERSION});
    }
    if (instance.status !== "ready" || instance.url === null) return false;
    if (options.port !== undefined || options.rpcPort !== undefined) context.output.hint("已有实例在运行，忽略 --port 与 --rpc-port。");
    // 安全模式是插件拖垮应用时的出路：连上的实例没有以安全模式运行时要明说，否则用户以为进了安全模式。
    if (options.safeMode && instance.plugins?.safeMode !== true) context.output.hint("已在运行的实例没有以安全模式启动：要安全模式，先停掉它（在它的终端按 Ctrl-C），再运行 nbook start --safe-mode。");
    report(instance, false, context);
    await openBrowser(instance.url, context, options);
    return true;
}

export async function start(context: StartContext, options: StartOptions): Promise<void> {
    const deadline = Date.now() + WAIT_MS;
    let waitingFor: InstanceInfo | null = null;
    for (;;) {
        const found = await queryNeuroBook(context.stateRoot);
        if (found.state === "unresponsive") {
            throw new CliFailure("instance-unresponsive", `状态根 ${context.stateRoot} 上已有实例，但它没有应答（被暂停或卡住）；结束它之后再启动`, 1, {stateRoot: context.stateRoot, detail: found.detail});
        }
        if (found.state === "running") {
            if (await existing(found.instance, context, options)) return;
            if (waitingFor?.status !== found.instance.status) {
                const pid = String(found.instance.pid);
                context.output.hint(found.instance.status === "stopping" ? `已有实例正在停止（pid ${pid}），等它停完再启动…` : `已有实例正在启动（pid ${pid}），等它就绪…`);
            }
            waitingFor = found.instance;
        } else {
            const claimed = await claimNeuroBook({stateRoot: context.stateRoot, kind: "product", report: claimReport});
            if (claimed.ok) return serve(claimed.claim, context, options);
            if (claimed.reason === "unresponsive") continue;
            if (claimed.reason === "unwritable") throw new CliFailure("state-root-unwritable", `状态根 ${context.stateRoot} 不可写：${claimed.detail}`, 1, {stateRoot: context.stateRoot});
            if (claimed.reason === "failed") throw new CliFailure("claim-failed", `无法认领状态根 ${context.stateRoot}：${claimed.detail}`, 1, {stateRoot: context.stateRoot});
            // 被别人抢先认领了：下一轮去问它。
        }
        if (Date.now() > deadline) {
            const what = waitingFor?.status === "stopping" ? "停止" : "启动";
            throw new CliFailure("instance-busy", `状态根 ${context.stateRoot} 上的实例（pid ${String(waitingFor?.pid ?? "?")}）${String(WAIT_MS / 1000)} 秒内没有${what}完`, 1, {stateRoot: context.stateRoot});
        }
        await Bun.sleep(POLL_MS);
    }
}

async function serve(claim: StateRootClaim, context: StartContext, options: StartOptions): Promise<never> {
    const env: Record<string, string | undefined> = {...context.env, NBOOK_STATE_ROOT: context.stateRoot, NBOOK_WEB_ROOT: context.env.NBOOK_WEB_ROOT?.trim() || defaultWebRoot()};
    if (options.port !== undefined) {
        env.NBOOK_PORT = String(options.port);
        // 只给 HTTP 端口时 RPC 端口跟着它走：固定的 4218 可能正被另一个状态根的实例占着。
        if (options.rpcPort === undefined) env.NBOOK_RPC_PORT = String(options.port === 0 ? 0 : options.port + 1);
    }
    if (options.rpcPort !== undefined) env.NBOOK_RPC_PORT = String(options.rpcPort);
    let config;
    try {
        config = readServerConfig([], env, context.cwd);
    } catch (error) {
        await claim.release();
        if (error instanceof ServerConfigError) throw new CliFailure(`config-${error.code}`, error.message, 2);
        throw error;
    }
    // 安全模式与服务端入口同一个开关：插件准备读进程环境（plugin-install 的“输入与前置条件”）。
    if (options.safeMode) process.env.NEURO_BOOK_SAFE_MODE = "1";
    return runServerProcess(productPlugins, {
        config,
        claim,
        quiet: true,
        onReady: ({url, rpcUrl}) => {
            report({url, rpcUrl, pid: process.pid, version: PRODUCT_VERSION}, true, context);
            context.output.hint("前台运行中，按 Ctrl-C 停止。");
            if (url !== null) void openBrowser(url, context, options);
        },
        onStopped: (exitCode) => context.output.hint(exitCode === 0 ? "NeuroBook 已停止。" : `NeuroBook 已停止（退出码 ${String(exitCode)}，详情见 ${join(context.stateRoot, "logs")}）。`),
        onStartupFailed: ({message, causes}) => {
            const first = causes.find((cause) => cause.message !== null)?.message ?? message;
            context.output.failure(new CliFailure("startup-failed", `服务端启动失败：${first}（详情见上面的致命诊断与 ${join(context.stateRoot, "logs")}）`, 1, {stateRoot: context.stateRoot, causes}));
        },
    });
}
