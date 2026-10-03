/**
 * 开发监督进程的后端状态机（runtime.server-host 开发模式）：后端文件变化时有序重启后端，同一时刻至多一个后端
 * 持有端口与进程级资源；新进程启动失败或运行中退出时只报告，等下一次改动，不循环重启。
 *
 * 状态：starting → running；改动（去抖后）→ restarting：经标准输入停止旧进程、等它退出，再启动新进程；
 * 启动失败或意外退出 → waiting，下一次改动直接启动；stop() 之后 → stopped，不再启动。
 * restarting 期间的新改动不追加重启：新进程启动时读到的已经是最新文件。
 */

import type {BackendProcess} from "./backend-process";

export interface DevClock {
    schedule(task: () => void, milliseconds: number): () => void;
}

export type DevEvent =
    | {readonly type: "backend-starting"; readonly pid: number}
    | {readonly type: "backend-ready"; readonly pid: number; readonly url: string}
    | {readonly type: "backend-start-failed"; readonly pid: number; readonly exitCode: number | null}
    /** `expected` 为 false 表示后端在运行中自行退出（例如未处理异常）。 */
    | {readonly type: "backend-exited"; readonly pid: number; readonly exitCode: number | null; readonly expected: boolean}
    | {readonly type: "change"; readonly path: string};

/** 页面经代理访问后端前的判定：可用、不可用（等待改动），或开发会话正在结束。 */
export type GateDecision = "open" | "unavailable" | "stopping";

export type DevPhase = "starting" | "running" | "restarting" | "waiting" | "stopping" | "stopped";

export interface DevSupervisorOptions {
    readonly launch: () => BackendProcess;
    readonly clock: DevClock;
    readonly onEvent: (event: DevEvent) => void;
    /** 合并一次保存产生的多个文件事件；缺省 100 ms。 */
    readonly debounceMs?: number;
}

export interface DevSupervisor {
    readonly phase: DevPhase;
    start(): void;
    notifyChange(path: string): void;
    /** 后端启动或重启中时等它有结果；后端可用为 open。 */
    admit(): Promise<GateDecision>;
    /**
     * 有序停止当前后端并结束会话；结果为最近一个后端是否干净退出（0 或 1），等待改动时最近一个已失败，结果为 1。
     * 重复调用共享同一结果。
     */
    stop(): Promise<0 | 1>;
    /** 不等排空，直接结束当前后端。 */
    kill(): void;
}

export const DEFAULT_DEBOUNCE_MS = 100;

export function createDevSupervisor(options: DevSupervisorOptions): DevSupervisor {
    const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    let phase: DevPhase = "starting";
    let current: BackendProcess | null = null;
    let cancelDebounce: (() => void) | null = null;
    let stopping: Promise<0 | 1> | null = null;
    /** 等后端出结果的前置门请求；状态离开 starting/restarting 时统一结算。 */
    let waiters: Array<(decision: GateDecision) => void> = [];

    const settleWaiters = (decision: GateDecision): void => {
        const pending = waiters;
        waiters = [];
        for (const resolve of pending) resolve(decision);
    };

    const launch = (): void => {
        phase = "starting";
        const backend = options.launch();
        current = backend;
        options.onEvent({type: "backend-starting", pid: backend.pid});
        let ready = false;
        backend.ready.then((url) => {
            ready = true;
            if (current !== backend || phase !== "starting") return;
            phase = "running";
            options.onEvent({type: "backend-ready", pid: backend.pid, url});
            settleWaiters("open");
        }, () => undefined);
        void backend.exited.then((exitCode) => {
            if (current !== backend) return;
            current = null;
            if (phase === "restarting") {
                options.onEvent({type: "backend-exited", pid: backend.pid, exitCode, expected: true});
                launch();
                return;
            }
            if (phase === "stopping") {
                options.onEvent({type: "backend-exited", pid: backend.pid, exitCode, expected: true});
                return;
            }
            options.onEvent(ready
                ? {type: "backend-exited", pid: backend.pid, exitCode, expected: false}
                : {type: "backend-start-failed", pid: backend.pid, exitCode});
            phase = "waiting";
            settleWaiters("unavailable");
        });
    };

    const restart = (): void => {
        cancelDebounce = null;
        if (phase === "waiting") {
            launch();
            return;
        }
        if (phase !== "starting" && phase !== "running") return;
        // 启动中的进程也停掉重来：它可能读到了改动前的文件，或卡在一次失败的启动里。
        phase = "restarting";
        current?.requestStop();
    };

    return {
        get phase() {
            return phase;
        },
        start() {
            launch();
        },
        notifyChange(path) {
            if (phase === "stopping" || phase === "stopped") return;
            options.onEvent({type: "change", path});
            cancelDebounce?.();
            cancelDebounce = options.clock.schedule(restart, debounceMs);
        },
        admit() {
            switch (phase) {
                case "running":
                    return Promise.resolve("open");
                case "waiting":
                    return Promise.resolve("unavailable");
                case "stopping":
                case "stopped":
                    return Promise.resolve("stopping");
                case "starting":
                case "restarting": {
                    const decision = Promise.withResolvers<GateDecision>();
                    waiters.push(decision.resolve);
                    return decision.promise;
                }
            }
        },
        stop() {
            if (stopping !== null) return stopping;
            cancelDebounce?.();
            cancelDebounce = null;
            // 等待改动时没有当前后端：最近一个后端启动失败或运行中退出，会话不算干净结束。
            const lastFailed = phase === "waiting";
            phase = "stopping";
            settleWaiters("stopping");
            const backend = current;
            stopping = (async (): Promise<0 | 1> => {
                if (backend === null) {
                    phase = "stopped";
                    return lastFailed ? 1 : 0;
                }
                backend.requestStop();
                const exitCode = await backend.exited;
                phase = "stopped";
                return exitCode === 0 ? 0 : 1;
            })();
            return stopping;
        },
        kill() {
            current?.kill();
        },
    };
}
