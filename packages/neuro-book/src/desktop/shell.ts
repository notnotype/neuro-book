/**
 * 桌面壳的流程（docs/specs/runtime/desktop-shell.md 输出 1 到 24）：取桌面锁 → 问状态根上的服务端 → 拉起或连接 → 开窗 →
 * 关窗 → 停止 → 放锁退出。只依赖端口与时钟，Electrobun 的适配层（`packages/neuro-book/desktop/`）实现端口、把窗口事件送进来。
 *
 * 启动页与对话框都是壳自己的小窗口，开着时壳照常应答锁上的请求、计时与收页面的回答（审查过：系统消息框会同步阻塞主线程）。
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
import {WindowCoordinator} from "./windows";
import type {WindowPort} from "./windows";

/** 启动页显示什么（输出 3、4、5、19、23、24）；`actions` 是可点的按钮。 */
export type StartupView =
    | {readonly kind: "starting"}
    | {readonly kind: "waiting-instance"; readonly status: "starting" | "stopping"}
    | {readonly kind: "waiting-close"}
    | {readonly kind: "waiting-exit"}
    | {readonly kind: "unclean-stop"; readonly logDir: string}
    | {readonly kind: "error"; readonly reason: StartupError; readonly detail: string; readonly actions: ReadonlyArray<StartupAction>};

export type StartupError = "portable-unwritable" | "version-mismatch-shell" | "shell-unresponsive" | "version-mismatch-server" | "not-product" | "server-unresponsive" | "wait-timeout" | "server-failed" | "lock-failed";
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
    #server: OwnedServer | null = null;
    #lastPorts: {http: number; rpc: number} | undefined;
    #startupAction: ((action: StartupAction) => void) | null = null;
    /** 启动作废（启动中关掉了最后一个窗口，输出 23）或已开始退出。 */
    #finishing = false;
    #ready = false;

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
        if (!(await this.#takeLock(root.stateRoot))) return;
        await this.#noticeUncleanStop(root.stateRoot);
        if (this.#finishing) return;
        await this.#connect(root.stateRoot);
    }

    /** 取桌面锁；被同版本的壳持有时转交后退出（交回 false）。 */
    async #takeLock(stateRoot: string): Promise<boolean> {
        let waitedSince: number | null = null;
        for (;;) {
            if (this.#finishing) return false;
            const claimed = await acquireDesktopLock({stateRoot, version: this.#options.version, report: this.#options.report, onOpenWindow: () => this.#coordinator.openWindowRequested()});
            if (claimed.ok) {
                this.#lock = claimed.claim;
                return true;
            }
            if (claimed.reason !== "running") {
                const action = await this.#fail(claimed.reason === "unresponsive" ? "shell-unresponsive" : "lock-failed", claimed.detail, ["retry", "exit"]);
                if (action !== "retry") return false;
                continue;
            }
            const answer = await askRunningShell(stateRoot, this.#options.version);
            switch (answer.kind) {
                case "handed-off":
                    this.#exit(0);
                    return false;
                case "lock-free":
                    continue;
                case "closing":
                    this.#options.ports.startupView({kind: "waiting-close"});
                    waitedSince = null;
                    await this.#sleep(POLL_MS);
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
                this.#ready = true;
                this.#lock?.publish({url: null, rpcUrl: null, extra: {}});
                this.#coordinator.serverReady(decision.url, false);
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
        const server = startOwnedServer({...this.#options.server, stateRoot, ports: this.#lastPorts, report: this.#options.report, clock: this.#options.clock});
        this.#server = server;
        const started = await server.started;
        if (this.#finishing) return true;
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
        this.#ready = true;
        this.#lock?.publish({url: null, rpcUrl: null, extra: {}});
        server.onUnexpectedExit((code) => void this.#serverExited(stateRoot, code));
        this.#coordinator.serverReady(started.url, true);
        return true;
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
            const server = startOwnedServer({...this.#options.server, stateRoot, ports: this.#lastPorts, report: this.#options.report, clock: this.#options.clock});
            const started = await server.started;
            if (started.kind === "ready") {
                this.#server = server;
                server.onUnexpectedExit((code) => void this.#serverExited(stateRoot, code));
                return;
            }
            this.#options.ports.tellRestartFailed(started.kind === "failed" ? started.detail : "状态根已被别的实例认领");
        }
    }

    /** 最后一次关闭被同意：停自有服务端，等它真实结束，记录、放锁、退出（输出 18、19）。 */
    async #stopAndExit(): Promise<void> {
        if (this.#finishing) return;
        this.#finishing = true;
        this.#lock?.stopping();
        const server = this.#server;
        if (server !== null) {
            const outcome = await server.stop();
            if (outcome.forced || outcome.exitCode !== 0) await this.#recordUnclean(outcome.forced, outcome.exitCode);
        }
        await this.#releaseAndExit(0);
    }

    async #allClosed(): Promise<void> {
        if (this.#coordinator.stopping) return;
        // 没有经最后一次关闭就关完了：启动中关掉（输出 23）、服务端不归壳、或自有服务端已放弃（“稍后”）。
        this.#finishing = true;
        this.#startupAction?.("exit");
        const server = this.#server;
        if (server !== null) {
            this.#lock?.stopping();
            const outcome = await server.stop();
            if (this.#ready && (outcome.forced || outcome.exitCode !== 0)) await this.#recordUnclean(outcome.forced, outcome.exitCode);
        }
        await this.#releaseAndExit(0);
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

    async #releaseAndExit(code: number): Promise<void> {
        await this.#lock?.release();
        this.#lock = null;
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
