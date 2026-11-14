/**
 * 桌面壳的流程（docs/specs/runtime/desktop-shell.md 输出 1 到 24）：取桌面锁 → 问状态根上的服务端 → 拉起或连接 → 开窗 →
 * 关窗 → 停止 → 放锁退出。只依赖端口与时钟，Electrobun 的适配层（`packages/neuro-book/desktop/`）实现端口、把窗口事件送进来。
 *
 * 启动页与对话框都是壳自己的小窗口，开着时壳照常应答锁上的请求、计时与收页面的回答（审查过：系统消息框会同步阻塞主线程）。
 *
 * 更新（docs/specs/runtime/desktop-update.md）：取桌面锁之前先换上（`applyAtStartup`）、登记在用这份安装（共享锁，到进程退出）；
 * 取锁之后对账；进入运行中启动更新控制器，进入停止中封住它，放锁之前关掉它（`update.ts` 的模块头）。退出请求只在取桌面锁
 * 之前放行（`acceptsQuit`）：更新器换上时要经正常的退出流程结束进程。
 */

import {existsSync} from "node:fs";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import type {ClaimResult} from "@notnotype/nb-host/server";

import {queryNeuroBook} from "../server/instance";
import {decideConnection} from "./connect";
import {at} from "./deadline";
import type {DeadlineClock} from "./deadline";
import {acquireDesktopLock, askRunningShell} from "./lock";
import {startOwnedServer} from "./owned-server";
import type {OwnedServer, OwnedServerOptions} from "./owned-server";
import type {DesktopStateRoot} from "./state-root";
import {isNewer, UpdateController} from "./update";
import type {UpdateMode} from "./update";
import {acquireInstallUse, applyAtStartup, fileUpdateState, reconcileAtStartup} from "./update-install";
import type {UpdaterPort, UpdateStatePort} from "./update-install";
import {WindowCoordinator} from "./windows";
import type {WindowPort} from "./windows";

/** 启动页显示什么（输出 3、4、5、19、23、24）；`actions` 是可点的按钮。 */
export type StartupView =
    | {readonly kind: "starting"}
    | {readonly kind: "waiting-instance"; readonly status: "starting" | "stopping"}
    | {readonly kind: "waiting-close"}
    | {readonly kind: "waiting-exit"}
    | {readonly kind: "updating"; readonly version: string}
    | {readonly kind: "unclean-stop"; readonly logDir: string}
    | {readonly kind: "error"; readonly reason: StartupError; readonly detail: string; readonly actions: ReadonlyArray<StartupAction>};

export type StartupError = "portable-unwritable" | "version-mismatch-shell" | "shell-unresponsive" | "version-mismatch-server" | "not-product" | "server-unresponsive" | "wait-timeout" | "server-failed" | "lock-failed" | "install-busy";
export type StartupAction = "retry" | "exit" | "open-logs" | "continue";

export interface ShellPorts {
    readonly windows: WindowPort;
    /** 让所有显示启动页的窗口显示这个状态。 */
    startupView(view: StartupView): void;
    /** 自有服务端意外退出（输出 21）：在壳的对话框里问，交回用户的选择。 */
    askServerExited(exitCode: number | null, logDir: string): Promise<"restart" | "later">;
    /** 重新启动服务失败时在同一个对话框里说明，用户关掉为止。 */
    tellRestartFailed(detail: string): void;
    openPath(path: string): void;
    /** 进程退出：之前已放下锁。 */
    exit(code: number): void;
}

export interface ShellOptions {
    readonly root: DesktopStateRoot;
    readonly version: string;
    readonly server: Omit<OwnedServerOptions, "stateRoot" | "ports" | "report" | "clock">;
    readonly ports: ShellPorts;
    readonly clock: DeadlineClock;
    readonly report: (event: string, error: unknown) => void;
    /** 没有更新器的构建（开发构建）不给。 */
    readonly updates?: ShellUpdates;
}

export interface ShellUpdates {
    readonly updater: UpdaterPort;
    /** 受管安装的通道根（更新器的 `%LOCALAPPDATA%\<identifier>\<channel>\`）；不是受管安装（便携、开发构建）时 null，不建安装级文件。 */
    readonly channelRoot: string | null;
    readonly openDownloadPage: () => void;
    /** 共享锁拿不到时等多久（缺省 30 秒）。 */
    readonly installWaitMs?: number;
}

/** 等待已有实例或旧壳的截止（输出 3、4）。 */
const WAIT_MS = 60_000;
const POLL_MS = 1_000;
/** “没有正常停止”的记录（输出 19）。 */
const UNCLEAN_MARKER = "unclean-stop.json";

export class DesktopShell {
    readonly #options: ShellOptions;
    readonly #coordinator: WindowCoordinator;
    #lock: Extract<ClaimResult<Record<string, never>>, {ok: true}>["claim"] | null = null;
    /**
     * 壳拥有的服务端：拉起（含重新启动）时在创建租约的同一个同步段里登记，停止路径随时都能取到还在拉起中的那一个。拉起它的
     * 续体等完 `started` 之后核对它还是不是这一个（`#isCurrent`）、壳是否已开始停止，不是就不再登记或重试。
     */
    #server: OwnedServer | null = null;
    #lastPorts: {http: number; rpc: number} | undefined;
    #startupAction: ((action: StartupAction) => void) | null = null;
    /** 启动作废（启动中关掉了最后一个窗口，输出 23）或已开始退出。 */
    #finishing = false;
    /** 取到桌面锁之后为真：从此退出请求一律交给协调器询问（`acceptsQuit`）。 */
    #locked = false;
    /** 在用这份安装的登记（共享锁）；放桌面锁之后才放。 */
    #installUse: {release(): void} | null = null;
    #updates: UpdateController | null = null;

    constructor(options: ShellOptions) {
        this.#options = options;
        this.#coordinator = new WindowCoordinator({
            port: options.ports.windows,
            clock: options.clock,
            onQuit: () => void this.#stopAndExit(),
            onAllClosed: () => void this.#allClosed(),
        });
    }

    get windows(): WindowCoordinator {
        return this.#coordinator;
    }

    /** 更新控制器：页面交回的选择与“已显示”交给它。进入运行中之前是 null。 */
    get updates(): UpdateController | null {
        return this.#updates;
    }

    /**
     * 框架的退出请求能不能直接放行：取桌面锁之前可以（那时没有服务端、没有页面；换上时更新器要经它结束进程），之后一律否决、
     * 交给协调器询问（输出 19）。
     */
    get acceptsQuit(): boolean {
        return !this.#locked;
    }

    /** 启动页或对话框上的按钮。 */
    startupAction(action: StartupAction): void {
        this.#startupAction?.(action);
    }

    async run(): Promise<void> {
        const root = this.#options.root;
        this.#coordinator.openWindow();
        if (!root.ok) {
            await this.#fail("portable-unwritable", root.path, ["exit"]);
            return;
        }
        if (!(await this.#prepareInstall(root.source))) return;
        if (!(await this.#takeLock(root.stateRoot))) return;
        await this.#setUpUpdates(root.source);
        if (this.#finishing) return;
        await this.#noticeUncleanStop(root.stateRoot);
        if (this.#finishing) return;
        await this.#connect(root.stateRoot);
    }

    /** 取桌面锁；被同版本的壳持有时转交后退出（交回 false）。 */
    async #takeLock(stateRoot: string): Promise<boolean> {
        let waitedSince: number | null = null;
        // 显示“正在确认关闭”期间用户点了“退出”（输出 3、场景 5）。按钮在等待的任何时刻都可能来，包括一次询问还没返回时，
        // 所以从进入这个状态起一直接着，每次 await 之后都看它。
        let exitWhileClosing = false;
        let wakeClosingPoll: (() => void) | null = null;
        /** 离开“正在确认关闭”：不再由它接按钮（之后的错误页由 `#fail` 自己接）。 */
        const leaveClosing = (): void => {
            this.#startupAction = null;
        };
        for (;;) {
            if (this.#finishing) return false;
            if (exitWhileClosing) {
                this.#exit(0);
                return false;
            }
            const claimed = await acquireDesktopLock({stateRoot, version: this.#options.version, report: this.#options.report, onOpenWindow: () => this.#coordinator.openWindowRequested()});
            if (claimed.ok) {
                this.#locked = true;
                leaveClosing();
                if (this.#finishing || exitWhileClosing) {
                    // 取锁的同时已决定退出：放下刚取到的锁再走。
                    await claimed.claim.release();
                    if (!this.#finishing) this.#exit(0);
                    return false;
                }
                this.#lock = claimed.claim;
                return true;
            }
            if (claimed.reason !== "running") {
                leaveClosing();
                // 取锁在途时用户已点了“退出”：不再转成错误页让他再点一次。
                if (this.#finishing) return false;
                if (exitWhileClosing) {
                    this.#exit(0);
                    return false;
                }
                const action = await this.#fail(claimed.reason === "unresponsive" ? "shell-unresponsive" : "lock-failed", claimed.detail, ["retry", "exit"]);
                if (action !== "retry") return false;
                continue;
            }
            const answer = await askRunningShell(stateRoot, this.#options.version);
            if (this.#finishing) return false;
            if (exitWhileClosing) continue;
            if (answer.kind !== "closing" && answer.kind !== "lock-free") leaveClosing();
            switch (answer.kind) {
                case "handed-off":
                    this.#exit(0);
                    return false;
                case "lock-free":
                    continue;
                case "closing":
                    this.#options.ports.startupView({kind: "waiting-close"});
                    waitedSince = null;
                    this.#startupAction = (action) => {
                        if (action !== "exit") return;
                        exitWhileClosing = true;
                        wakeClosingPoll?.();
                    };
                    await new Promise<void>((resolve) => {
                        const cancel = at(this.#options.clock, this.#options.clock.now() + POLL_MS, resolve);
                        wakeClosingPoll = () => {
                            cancel();
                            resolve();
                        };
                    });
                    wakeClosingPoll = null;
                    continue;
                case "stopping":
                    this.#options.ports.startupView({kind: "waiting-exit"});
                    waitedSince ??= this.#options.clock.now();
                    if (this.#options.clock.now() - waitedSince > WAIT_MS) {
                        const action = await this.#fail("wait-timeout", "上一个 NeuroBook 在 60 秒内没有退出", ["retry", "exit"]);
                        if (action !== "retry") return false;
                        waitedSince = null;
                        continue;
                    }
                    await this.#sleep(POLL_MS);
                    continue;
                case "version-mismatch":
                    await this.#fail("version-mismatch-shell", answer.running, ["exit"]);
                    return false;
                case "unresponsive":
                    await this.#fail("shell-unresponsive", answer.detail, ["exit"]);
                    return false;
            }
        }
    }

    /** 自动更新只在受管安装、没设 `NBOOK_STATE_ROOT` 时（便携标记与环境变量都没有，状态根取缺省）。 */
    #autoUpdates(source: "env" | "portable" | "default"): {readonly channelRoot: string; readonly state: UpdateStatePort} | null {
        const channelRoot = this.#options.updates?.channelRoot ?? null;
        if (channelRoot === null || source !== "default") return null;
        return {channelRoot, state: fileUpdateState(channelRoot, this.#options.report)};
    }

    /**
     * 取桌面锁之前（desktop-update 输出 8）：`auto` 模式先看要不要换上；受管安装再登记在用（共享锁）。共享锁拿不到说明别人
     * 正在发起换上，等至多 30 秒，还拿不到就报启动错误（不无锁启动）。交回 false 时这次启动到此为止（在换上或用户点了退出）。
     */
    async #prepareInstall(source: "env" | "portable" | "default"): Promise<boolean> {
        const updates = this.#options.updates;
        const channelRoot = updates?.channelRoot ?? null;
        if (updates === undefined || channelRoot === null) return true;
        const auto = this.#autoUpdates(source);
        if (auto !== null) {
            const outcome = await applyAtStartup({
                channelRoot,
                updater: updates.updater,
                state: auto.state,
                newer: isNewer,
                now: () => this.#options.clock.now(),
                onApplying: (version) => this.#options.ports.startupView({kind: "updating", version}),
                report: this.#options.report,
            });
            if (outcome === "exiting") {
                // 更新器正在结束这个进程，由它启动新版本接着完成这次启动；壳什么都不再做。
                this.#finishing = true;
                return false;
            }
        }
        for (;;) {
            if (this.#finishing) return false;
            const lease = await acquireInstallUse({channelRoot, clock: this.#options.clock, waitMs: updates.installWaitMs, report: this.#options.report});
            if (this.#finishing) {
                lease?.release();
                return false;
            }
            if (lease !== null) {
                this.#installUse = lease;
                return true;
            }
            const action = await this.#fail("install-busy", "", ["retry", "exit"]);
            if (action !== "retry") return false;
        }
    }

    /** 取桌面锁之后：`auto` 模式对账（单写者从这里开始），再建更新控制器，进入运行中时启动。 */
    async #setUpUpdates(source: "env" | "portable" | "default"): Promise<void> {
        const updates = this.#options.updates;
        if (updates === undefined) return;
        const auto = this.#autoUpdates(source);
        const mode: UpdateMode =
            auto === null
                ? {kind: "notify-only", envRoot: source === "env"}
                : {kind: "auto", state: auto.state, initial: await reconcileAtStartup(auto.state, updates.updater, this.#options.clock.now(), this.#options.report)};
        this.#updates = new UpdateController({
            mode,
            updater: updates.updater,
            clock: this.#options.clock,
            onHint: (current, endPrevious) => this.#coordinator.setUpdateHint(current, endPrevious),
            openDownloadPage: updates.openDownloadPage,
            report: this.#options.report,
        });
    }

    async #noticeUncleanStop(stateRoot: string): Promise<void> {
        const logDir = join(stateRoot, "logs", "desktop");
        const marker = join(logDir, UNCLEAN_MARKER);
        if (!existsSync(marker)) return;
        for (;;) {
            this.#options.ports.startupView({kind: "unclean-stop", logDir});
            const action = await this.#waitAction();
            if (action === "open-logs") {
                this.#options.ports.openPath(logDir);
                continue;
            }
            break;
        }
        await rm(marker, {force: true});
    }

    async #connect(stateRoot: string): Promise<void> {
        let waitedSince: number | null = null;
        for (;;) {
            if (this.#finishing) return;
            const decision = decideConnection(await queryNeuroBook(stateRoot), this.#options.version);
            if (decision.kind === "connect") {
                this.#lock?.publish({url: null, rpcUrl: null, extra: {}});
                this.#coordinator.serverReady(decision.url, false);
                this.#updates?.start();
                return;
            }
            if (decision.kind === "wait") {
                this.#options.ports.startupView({kind: "waiting-instance", status: decision.status});
                waitedSince ??= this.#options.clock.now();
                if (this.#options.clock.now() - waitedSince > WAIT_MS) {
                    const action = await this.#fail("wait-timeout", `状态根上的实例 60 秒内没有${decision.status === "starting" ? "就绪" : "停完"}`, ["retry", "exit"]);
                    if (action !== "retry") return;
                    waitedSince = null;
                    continue;
                }
                await this.#sleep(POLL_MS);
                continue;
            }
            if (decision.kind === "refuse") {
                const detail = decision.reason === "version-mismatch" ? `${decision.running}|${decision.installed}` : decision.reason === "unresponsive" ? decision.detail : decision.instance.kind;
                await this.#fail(decision.reason === "version-mismatch" ? "version-mismatch-server" : decision.reason === "unresponsive" ? "server-unresponsive" : "not-product", detail, ["exit"]);
                return;
            }
            this.#options.ports.startupView({kind: "starting"});
            if (await this.#spawn(stateRoot)) return;
        }
    }

    /** 拉起自有服务端；就绪或交给外部实例时交回 true，被抢先时交回 false 让调用方重问。 */
    async #spawn(stateRoot: string): Promise<boolean> {
        const server = this.#startServer(stateRoot);
        const started = await server.started;
        // 等待期间已开始停止：这个服务端归停止路径收尾。
        if (this.#finishing || !this.#isCurrent(server)) return true;
        if (started.kind === "taken") {
            this.#server = null;
            return false;
        }
        if (started.kind === "failed") {
            this.#server = null;
            const action = await this.#fail("server-failed", `退出码 ${String(started.exitCode)}：${started.detail}`, ["retry", "open-logs", "exit"]);
            return action !== "retry";
        }
        this.#lastPorts = started.ports;
        this.#lock?.publish({url: null, rpcUrl: null, extra: {}});
        server.onUnexpectedExit((code) => void this.#serverExited(stateRoot, code));
        this.#coordinator.serverReady(started.url, true);
        this.#updates?.start();
        return true;
    }

    /** 拉起自有服务端，并在同一个同步段里登记为壳拥有的那一个。 */
    #startServer(stateRoot: string): OwnedServer {
        const server = startOwnedServer({...this.#options.server, stateRoot, ports: this.#lastPorts, report: this.#options.report, clock: this.#options.clock});
        this.#server = server;
        return server;
    }

    /** 拉起 `server` 的续体在 await 之后用它核对自己还是不是壳拥有的那一个。 */
    #isCurrent(server: OwnedServer): boolean {
        return this.#server === server;
    }

    async #serverExited(stateRoot: string, exitCode: number | null): Promise<void> {
        this.#server = null;
        const logDir = join(stateRoot, "logs", "desktop");
        for (;;) {
            const choice = await this.#options.ports.askServerExited(exitCode, logDir);
            if (choice === "later" || this.#finishing) {
                this.#coordinator.serverAbandoned();
                return;
            }
            const server = this.#startServer(stateRoot);
            const started = await server.started;
            // 重新启动还在拉起中时最后一次关闭被同意：这个服务端已由停止路径收尾，不再登记或重试（输出 18、19）。
            if (this.#finishing || !this.#isCurrent(server)) return;
            if (started.kind === "ready") {
                server.onUnexpectedExit((code) => void this.#serverExited(stateRoot, code));
                return;
            }
            this.#server = null;
            this.#options.ports.tellRestartFailed(started.kind === "failed" ? started.detail : "状态根已被别的实例认领");
        }
    }

    /** 最后一次关闭被同意：停自有服务端，等它真实结束，记录、放锁、退出（输出 18、19）。 */
    async #stopAndExit(): Promise<void> {
        if (this.#finishing) return;
        this.#finishing = true;
        this.#updates?.stop();
        await this.#stopOwnedServer();
        await this.#releaseAndExit(0);
    }

    async #allClosed(): Promise<void> {
        if (this.#coordinator.stopping) return;
        // 没有经最后一次关闭就关完了：启动中关掉（输出 23）、服务端不归壳、或自有服务端已放弃（“稍后”）。
        this.#finishing = true;
        this.#updates?.stop();
        this.#startupAction?.("exit");
        await this.#stopOwnedServer();
        await this.#releaseAndExit(0);
    }

    /**
     * 停止壳拥有的服务端（含还在拉起中的），等进程树真实结束；超时、强制结束或非 0 退出都记“没有正常停止”（输出 19、23），
     * 不论它有没有就绪过：还在拉起中的服务端也可能已经写过设置、登记表。
     */
    async #stopOwnedServer(): Promise<void> {
        this.#lock?.stopping();
        const server = this.#server;
        if (server === null) return;
        const outcome = await server.stop();
        if (outcome.forced || outcome.exitCode !== 0) await this.#recordUnclean(outcome.forced, outcome.exitCode);
    }

    async #recordUnclean(forced: boolean, exitCode: number | null): Promise<void> {
        const root = this.#options.root;
        if (!root.ok) return;
        const dir = join(root.stateRoot, "logs", "desktop");
        try {
            await mkdir(dir, {recursive: true});
            await writeFile(join(dir, UNCLEAN_MARKER), `${JSON.stringify({at: new Date(this.#options.clock.now()).toISOString(), forced, exitCode})}\n`);
        } catch (error) {
            this.#options.report("desktop.unclean-stop.write-failed", error);
        }
    }

    /** 先关更新控制器（它在桌面锁下写状态文件），再放桌面锁，最后放安装的登记（共享锁要比桌面锁持有得久，见 `update-install.ts`）。 */
    async #releaseAndExit(code: number): Promise<void> {
        await this.#updates?.close();
        await this.#lock?.release();
        this.#lock = null;
        this.#installUse?.release();
        this.#installUse = null;
        this.#exit(code);
    }

    #exit(code: number): void {
        this.#finishing = true;
        this.#options.ports.exit(code);
    }

    /** 启动页显示错误、等用户点按钮；点“退出”时放锁退出。 */
    async #fail(reason: StartupError, detail: string, actions: ReadonlyArray<StartupAction>): Promise<StartupAction> {
        for (;;) {
            this.#options.ports.startupView({kind: "error", reason, detail, actions});
            const action = await this.#waitAction();
            if (action === "open-logs" && this.#options.root.ok) {
                this.#options.ports.openPath(join(this.#options.root.stateRoot, "logs"));
                continue;
            }
            if (action === "exit" || this.#finishing) {
                // 窗口都关掉时（`#allClosed`）也会送来“退出”，那时由它负责停服务端、放锁，这里不再退一次。
                if (!this.#finishing) await this.#releaseAndExit(0);
                return "exit";
            }
            return action;
        }
    }

    #waitAction(): Promise<StartupAction> {
        return new Promise((resolve) => {
            this.#startupAction = (action) => {
                this.#startupAction = null;
                resolve(action);
            };
        });
    }

    #sleep(ms: number): Promise<void> {
        return new Promise((resolve) => at(this.#options.clock, this.#options.clock.now() + ms, resolve));
    }
}

/** 读回“没有正常停止”的记录（测试与诊断用）。 */
export async function readUncleanStop(stateRoot: string): Promise<unknown> {
    const path = join(stateRoot, "logs", "desktop", UNCLEAN_MARKER);
    return existsSync(path) ? (JSON.parse(await readFile(path, "utf8")) as unknown) : null;
}
