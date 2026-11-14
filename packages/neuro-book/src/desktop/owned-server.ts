/**
 * 壳自己拉起的服务端（docs/specs/runtime/desktop-shell.md 输出 4 到 7、18、19、21）。进程树归 `@notnotype/owned-process`：
 * Windows 在目标创建前建好 Job Object，POSIX 用监督进程的进程组，壳死了整棵树一起收掉（输出 22 的非合作结束）。
 *
 * 就绪只认认领应答里 `pid` 等于自己目标进程的那个 `ready`：问到“没有实例”到自己的服务端认领之间，`nbook start` 可能抢先
 * 认领；这时自己的服务端以“状态根已被认领”退出，这里交回 `taken`，由调用方连那个实例，不当作崩溃。
 *
 * 停止：写一行 `stop`，等进程树真实结束。截止是排空上限加项目子进程的停止截止再加余量（`stopDeadlineMs`），项目停止截止用
 * 服务端自己的配置解析（`readServerConfig`）从同一份环境变量算出；到时结束整棵树，等树真实结束才交回。
 *
 * “树已结束”只认两种证明：租约的 `completion` 完成，或 `completion` 失败之后壳自己看到目标已经不在（`treeGone`）。
 * `completion` 失败只说明 owned-process 没能确认收口（例如监督进程停住、失联），不说明树已经结束，所以那时继续确认，
 * 不交回（输出 19：不放桌面锁）。
 */

import {createServer} from "node:net";
import {join} from "node:path";

import {spawnOwnedProcess} from "@notnotype/owned-process";
import type {OwnedProcessLease} from "@notnotype/owned-process";

import {readServerConfig} from "../server/config";
import {queryNeuroBook} from "../server/instance";
import type {InstanceInfo} from "../server/instance";
import {at, stopDeadlineMs, systemClock} from "./deadline";
import type {DeadlineClock} from "./deadline";
import {drainInto, rotatingLog} from "./rotating-log";

/** 输出文件的上限（输出 7）。 */
const OUTPUT_LIMIT_BYTES = 10 * 1024 * 1024;
/** 结束进程树之后，过了这么久还没报告结束就写一条诊断（继续等）。 */
const FORCED_WAIT_REPORT_MS = 10_000;
const READY_POLL_MS = 100;
/** `completion` 失败后确认目标是否还在的间隔。 */
const TREE_POLL_MS = 200;

export interface OwnedServerOptions {
    /** 随包的 Bun。 */
    readonly bun: string;
    /** 托管入口 `server/main.js`（测试用源码入口）。 */
    readonly entry: string;
    readonly stateRoot: string;
    /** 应用包的 `web/`；null 时不给（只有测试这样）。 */
    readonly webRoot: string | null;
    /** 服务端继承的环境变量。 */
    readonly env: Readonly<Record<string, string | undefined>>;
    /** 重新启动时给上一次的两个端口（输出 6、21）；第一次拉起不给，用缺省与顺延。 */
    readonly ports?: {readonly http: number; readonly rpc: number};
    readonly report: (event: string, error: unknown) => void;
    readonly clock?: DeadlineClock;
    /** 只有测试给：替换按配置算出的停止截止。 */
    readonly stopDeadlineMs?: number;
}

export type StartOutcome =
    | {readonly kind: "ready"; readonly url: string; readonly ports: {readonly http: number; readonly rpc: number}; readonly pid: number}
    /** 自己的服务端没认领到，状态根上是别人的实例（例如抢先的 `nbook start`）。 */
    | {readonly kind: "taken"; readonly instance: InstanceInfo}
    /** 就绪前退出，或者根本没拉起来。 */
    | {readonly kind: "failed"; readonly exitCode: number | null; readonly detail: string};

export type StopOutcome = {readonly exitCode: number | null; readonly forced: boolean};

export interface OwnedServer {
    /** 就绪、被抢先或失败；`stop()` 之后也会结算（失败）。 */
    readonly started: Promise<StartOutcome>;
    /** 进程树结束时结算。 */
    readonly ended: Promise<StopOutcome>;
    /** 运行中（没有请求停止）退出时调用一次（输出 21）。 */
    onUnexpectedExit(listener: (exitCode: number | null) => void): void;
    /** 有序停止（输出 18、19）；重复调用得到同一个结果。 */
    stop(): Promise<StopOutcome>;
}

export function startOwnedServer(options: OwnedServerOptions): OwnedServer {
    const clock = options.clock ?? systemClock;
    const env: Record<string, string | undefined> = {...options.env, NBOOK_STATE_ROOT: options.stateRoot};
    if (options.webRoot !== null) env.NBOOK_WEB_ROOT = options.webRoot;
    if (options.ports !== undefined) {
        env.NBOOK_PORT = String(options.ports.http);
        env.NBOOK_RPC_PORT = String(options.ports.rpc);
    }
    const log = rotatingLog(join(options.stateRoot, "logs", "desktop", "server-output.log"), OUTPUT_LIMIT_BYTES, options.report);
    let lease: OwnedProcessLease;
    try {
        lease = spawnOwnedProcess({command: options.bun, args: [options.entry, "--stop-stdin"], env, stdin: "pipe", stdout: "pipe", stderr: "pipe"});
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        const failed: StartOutcome = {kind: "failed", exitCode: null, detail};
        return {started: Promise.resolve(failed), ended: Promise.resolve({exitCode: null, forced: false}), onUnexpectedExit: () => undefined, stop: () => Promise.resolve({exitCode: null, forced: false})};
    }
    void drainInto(lease.stdout, log).catch((error: unknown) => options.report("desktop.server-output.read-failed", error));
    void drainInto(lease.stderr, log).catch((error: unknown) => options.report("desktop.server-output.read-failed", error));

    let stopping = false;
    let forced = false;
    const unexpected: Array<(exitCode: number | null) => void> = [];
    // 进程树结束：completion 完成即 owned-process 确认整棵树已经收掉；失败时自己确认目标不在了才算结束。
    const ended: Promise<StopOutcome> = lease.completion.then(
        (completion) => ({exitCode: completion.exitCode, forced}),
        async (error: unknown) => {
            options.report("desktop.server.completion-failed", error);
            await treeGone(lease, clock, options.report);
            return {exitCode: null, forced};
        },
    );
    let running = false;
    void ended.then((outcome) => {
        if (running && !stopping) for (const listener of unexpected) listener(outcome.exitCode);
    });

    const started = (async (): Promise<StartOutcome> => {
        const pid = await lease.rootPid;
        if (pid === null) {
            const outcome = await ended;
            return {kind: "failed", exitCode: outcome.exitCode, detail: "服务端进程没有创建成功"};
        }
        let exited = false;
        void ended.then(() => {
            exited = true;
        });
        for (;;) {
            const found = await queryNeuroBook(options.stateRoot);
            if (found.state === "running" && found.instance.pid === pid && found.instance.status === "ready" && found.instance.url !== null) {
                if (stopping) return {kind: "failed", exitCode: null, detail: "就绪前已请求停止"};
                running = true;
                return {kind: "ready", url: found.instance.url, ports: portsOf(found.instance), pid};
            }
            if (exited) {
                const outcome = await ended;
                // 自己退出了：看看状态根上是不是别人的实例（被抢先认领）。
                const after = await queryNeuroBook(options.stateRoot);
                if (after.state === "running" && after.instance.pid !== pid) return {kind: "taken", instance: after.instance};
                const busy = options.ports === undefined ? [] : await busyPorts([options.ports.http, options.ports.rpc]);
                if (busy.length > 0) return {kind: "failed", exitCode: outcome.exitCode, detail: `端口 ${busy.join("、")} 被别的程序占用，服务端没能启动`};
                return {kind: "failed", exitCode: outcome.exitCode, detail: "服务端在就绪前退出"};
            }
            await new Promise<void>((resolve) => at(clock, clock.now() + READY_POLL_MS, resolve));
        }
    })();

    let stopped: Promise<StopOutcome> | null = null;
    const stop = (): Promise<StopOutcome> => {
        if (stopped !== null) return stopped;
        stopping = true;
        stopped = (async () => {
            try {
                lease.stdin?.write("stop\n");
            } catch (error) {
                options.report("desktop.server.stop-write-failed", error);
            }
            const deadline = options.stopDeadlineMs ?? stopDeadlineMs(projectStopMs(env, options.stateRoot, options.report));
            // 强制结束后的诊断计时到树真实结束（`ended`）才取消；terminate 失败不算结束。
            let cancelSlowReport = (): void => undefined;
            const cancel = at(clock, clock.now() + deadline, () => {
                forced = true;
                cancelSlowReport = at(clock, clock.now() + FORCED_WAIT_REPORT_MS, () => options.report("desktop.server.forced-stop-slow", new Error(`进程树在强制结束 ${String(FORCED_WAIT_REPORT_MS / 1000)} 秒后还没有结束，继续等`)));
                void lease.terminate("timeout").catch((error: unknown) => options.report("desktop.server.terminate-failed", error));
            });
            const outcome = await ended;
            cancel();
            cancelSlowReport();
            return {exitCode: outcome.exitCode, forced};
        })();
        return stopped;
    };

    return {started, ended, onUnexpectedExit: (listener) => unexpected.push(listener), stop};
}

/**
 * 重新启动服务时给定的端口里，此刻在回环地址上已被占用的那些（输出 21 要说明“端口被占用”）。服务端自己退出之后再试着监听：
 * 它的端口已经放掉，还监听不了就是别人占着。不读服务端输出的文字（输出 5）。只判 `EADDRINUSE`；别的监听错误不当作占用。
 */
async function busyPorts(ports: ReadonlyArray<number>): Promise<number[]> {
    const busy: number[] = [];
    for (const port of ports) {
        const inUse = await new Promise<boolean>((resolve) => {
            const probe = createServer();
            probe.once("error", (error: NodeJS.ErrnoException) => resolve(error.code === "EADDRINUSE"));
            probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(false)));
        });
        if (inUse) busy.push(port);
    }
    return busy;
}

/**
 * `completion` 失败之后，等进程树真的不在了。目标是否创建过看 `rootPid`：它在 `completion` 结算前已 resolve，为 null 说明目标
 * 没有创建成功，没有要等的树。
 *
 * - POSIX：目标由监督进程以独立进程组拉起（它就是组长），看整个进程组。
 * - Windows：子孙归 Job Object，只看目标 pid 证明不了它们已经结束（根先退出、后代还在跑时根 pid 已不在）。Job 唯一的句柄在
 *   监督进程手里，所以先结束监督进程：句柄一关，Job 结束全部成员。之后等监督进程与目标都不在了才算结束。
 */
async function treeGone(lease: OwnedProcessLease, clock: DeadlineClock, report: (event: string, error: unknown) => void): Promise<void> {
    const pid = await lease.rootPid;
    if (pid === null) return;
    const windows = process.platform === "win32";
    const supervisor = lease.supervisorPid;
    if (windows && supervisor !== null) {
        try {
            process.kill(supervisor);
        } catch (error) {
            // 已经不在（ESRCH）正是要的结果；别的失败记下，下面照样等。
            if ((error as NodeJS.ErrnoException).code !== "ESRCH") report("desktop.server.supervisor-kill-failed", error);
        }
    }
    const targets = windows ? [pid, ...(supervisor === null ? [] : [supervisor])] : [-pid];
    let probeFailed = false;
    for (;;) {
        if (targets.every((target) => gone(target, (error) => {
            if (probeFailed) return;
            probeFailed = true;
            report("desktop.server.tree-probe-failed", error);
        }))) return;
        await new Promise<void>((resolve) => at(clock, clock.now() + TREE_POLL_MS, resolve));
    }
}

/** 进程（负数为进程组）已不在。EPERM 说明还在、只是无权发信号；别的错误证明不了它已经结束，当作还在。 */
function gone(target: number, probeFailed: (error: unknown) => void): boolean {
    try {
        process.kill(target, 0);
        return false;
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ESRCH") return true;
        if (code !== "EPERM") probeFailed(error);
        return false;
    }
}

function portsOf(instance: InstanceInfo): {http: number; rpc: number} {
    return {http: Number(new URL(instance.url as string).port), rpc: Number(new URL(instance.rpcUrl as string).port)};
}

/** 服务端会用的项目停止截止：用它自己的配置解析读同一份环境变量；解析失败时服务端也起不来，按缺省算。 */
function projectStopMs(env: Readonly<Record<string, string | undefined>>, stateRoot: string, report: (event: string, error: unknown) => void): number {
    try {
        return readServerConfig(["--stop-stdin"], {...env, NBOOK_STATE_ROOT: stateRoot}, stateRoot).projects.stopMs;
    } catch (error) {
        report("desktop.server.config-invalid", error);
        return 20_000;
    }
}
