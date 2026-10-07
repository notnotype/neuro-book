/**
 * 服务端的项目管理器：在服务端运行实例上用内核的子实例与租约（`createChildInstances`）管理项目实例，
 * 每个项目代次一个 Bun 子进程，经 IPC 链路接入路由。行为合同见 docs/specs/runtime/projects.md。
 *
 * 子进程的三种结局各自收口：
 * - 创建：起进程、把链路交给路由（带 `expect`），等它报告启动结果；截止、启动中退出、报告失败都按创建失败收口，
 *   子进程不残留。
 * - 停止（宽限期满或服务端停止）：发 `stop` 等它退出，到停止截止强制结束；非 0 退出写诊断。
 * - 意外退出：没有被要求停止时 IPC 断开或进程结束，立即结束这一代、租约失效；退出码要等进程真正结束才可靠，
 *   随后写进诊断。不自动重启。
 */

import type {Subprocess} from "bun";

import {createChildInstances} from "@notnotype/nb-runtime/application";
import type {Application, ChildInstances, ChildLease} from "@notnotype/nb-runtime/application";
import type {DiagnosticInput} from "@notnotype/nb-runtime/diagnostics";
import {systemClock} from "@notnotype/nb-runtime/lifecycle";
import type {RuntimeClock} from "@notnotype/nb-runtime/lifecycle";
import type {RemoteRouter} from "@notnotype/nb-runtime/remote";

import {PROJECT_ENV} from "nbook/project/config";
import {projectInstance} from "nbook/project/start";
import type {ProjectRecord, ProjectRegistryRead} from "nbook/shared/projects";
import type {SocketLink} from "nbook/shared/rpc-socket";

import {checkProjectDirectory, readProjectIdentity} from "./identity";
import {createEnvelopeLink, parseEnvelope} from "./ipc";
import type {ProjectEnvelope} from "./ipc";
import type {ProjectRegistry} from "./registry";

export interface ProjectManagerOptions {
    /** 服务端运行实例：项目实例是它的子实例，它停止时先停完全部项目子进程。 */
    readonly application: Application;
    readonly router: RemoteRouter;
    readonly registry: ProjectRegistry;
    readonly stateRoot: string;
    /** 解析相对路径与子进程的工作目录。 */
    readonly cwd: string;
    /** 项目宿主入口脚本：打包产物的 `project.js`，或开发、测试用的源码入口。 */
    readonly entry: string;
    readonly graceMs: number;
    /** 等子进程报告启动结果的截止。 */
    readonly startMs: number;
    /** 每个子进程的停止截止。 */
    readonly stopMs: number;
    readonly clock?: RuntimeClock;
    /** 子进程的基础环境变量；缺省继承本进程。 */
    readonly env?: Readonly<Record<string, string | undefined>>;
    readonly record: (record: DiagnosticInput) => void;
    /** 子进程输出的去处（每行已加前缀与换行）；缺省本进程的标准输出与标准错误。 */
    readonly output?: {readonly stdout: (text: string) => void; readonly stderr: (text: string) => void};
}

export type ProjectRunState = "stopped" | "starting" | "running" | "idle-grace" | "stopping";

export interface ProjectState extends ProjectRecord {
    readonly state: ProjectRunState;
    /** 运行中（含启动与停止中）的代次；没在运行为 null。 */
    readonly generation: number | null;
    /** 当前代次的子进程；没在运行为 null。 */
    readonly pid: number | null;
}

export interface ProjectLease {
    readonly id: string;
    readonly name: string;
    readonly generation: number;
    /** 这一代结束（停止、崩溃、强制结束）时触发。 */
    readonly revoked: AbortSignal;
    /** 释放租约；幂等。 */
    release(): void;
}

export type ProjectAcquireResult =
    | {readonly status: "acquired"; readonly lease: ProjectLease}
    | {readonly status: "rejected"; readonly reason: "unknown-project" | "registry-invalid" | "admission-closed" | "create-failed" | "generation-gone"; readonly detail: string};

export interface ProjectManager {
    readonly registry: ProjectRegistry;
    /** 已登记项目与运行状态，按登记顺序。 */
    list(): Promise<ProjectRegistryRead<ReadonlyArray<ProjectState>>>;
    /**
     * 取得租约；项目没在运行就以新代次启动它。给了 `generation` 时只取这一代（客户端重连），不等待、不创建。
     * 接纳关闭后（服务端开始停止）一律 `admission-closed`，在取得之后才关闭的，租约立即释放。
     */
    acquire(reference: string, holder: string, options?: {readonly generation?: number}): Promise<ProjectAcquireResult>;
    /** 某持有者是否持有该项目这一代的有效租约。 */
    holds(id: string, generation: number, holder: string): boolean;
    /** 该项目当前代次的状态；没在运行为 null。 */
    running(id: string): {readonly generation: number; readonly state: Exclude<ProjectRunState, "stopped">} | null;
    /** 同步关闭接纳；服务端停止序列的第一步调用。幂等。 */
    stopAdmission(): void;
    /** 服务端停止期间被强制结束或以非 0 退出的项目子进程；有则服务端以 1 退出。 */
    shutdownProblems(): ReadonlyArray<string>;
}

/** 一个项目代次的子进程。 */
interface ProjectChild {
    readonly record: ProjectRecord;
    readonly generation: number;
    readonly link: SocketLink;
    proc: Subprocess<"ignore", "pipe", "pipe"> | null;
    /** 子进程报告的启动结果，或启动中断开。 */
    readonly started: PromiseWithResolvers<{readonly status: "available"} | {readonly status: "failed"; readonly detail: string} | {readonly status: "disconnected"}>;
    /** 服务端已要求它停止（宽限期满、服务端停止或启动失败后的收口）：之后的断开是预期的。 */
    stopping: boolean;
    /** 已报告过结束（意外退出只处理一次）。 */
    lost: boolean;
    available: boolean;
}

function describeExit(proc: Subprocess): string {
    return proc.signalCode !== null ? `信号 ${proc.signalCode}` : `退出码 ${String(proc.exitCode)}`;
}

/** 逐行转发子进程的一路输出；最后不完整的一行在流结束时补上换行。 */
async function forwardLines(stream: ReadableStream<Uint8Array>, prefix: string, write: (text: string) => void): Promise<void> {
    const decoder = new TextDecoder();
    let pending = "";
    for await (const chunk of stream) {
        pending += decoder.decode(chunk, {stream: true});
        let newline = pending.indexOf("\n");
        while (newline >= 0) {
            write(`${prefix}${pending.slice(0, newline)}\n`);
            pending = pending.slice(newline + 1);
            newline = pending.indexOf("\n");
        }
    }
    pending += decoder.decode();
    if (pending !== "") write(`${prefix}${pending}\n`);
}

class ProjectManagerImpl implements ProjectManager {
    readonly registry: ProjectRegistry;
    readonly #options: ProjectManagerOptions;
    readonly #clock: RuntimeClock;
    readonly #children: ChildInstances;
    /** 项目 id → 当前代次的子进程。 */
    readonly #processes = new Map<string, ProjectChild>();
    readonly #shutdownProblems: string[] = [];
    #admission = true;

    constructor(options: ProjectManagerOptions) {
        this.registry = options.registry;
        this.#options = options;
        this.#clock = options.clock ?? systemClock;
        this.#children = createChildInstances<ProjectChild>(options.application, {
            create: (id, generation) => this.#create(id, generation),
            stop: (child, {signal}) => this.#stop(child, signal),
            graceMs: options.graceMs,
            stopDeadlineMs: options.stopMs,
            clock: this.#clock,
        });
    }

    async list(): Promise<ProjectRegistryRead<ReadonlyArray<ProjectState>>> {
        const records = await this.registry.list();
        if (!records.ok) return records;
        return {
            ok: true,
            value: records.value.map((record) => {
                const running = this.running(record.id);
                const child = this.#processes.get(record.id);
                return {
                    ...record,
                    state: running?.state ?? "stopped",
                    generation: running?.generation ?? null,
                    pid: running !== null && child?.generation === running.generation ? (child.proc?.pid ?? null) : null,
                };
            }),
        };
    }

    async acquire(reference: string, holder: string, options: {readonly generation?: number} = {}): Promise<ProjectAcquireResult> {
        if (!this.#admission) return {status: "rejected", reason: "admission-closed", detail: "服务端正在停止"};
        const resolved = await this.registry.resolve(reference);
        if (!resolved.ok) {
            this.#options.record({level: "error", event: "project.registry.invalid", message: resolved.detail, data: {file: this.registry.file}});
            return {status: "rejected", reason: "registry-invalid", detail: resolved.detail};
        }
        if (resolved.value === null) return {status: "rejected", reason: "unknown-project", detail: `没有登记的项目：${reference}`};
        const record = resolved.value;
        const result = await this.#children.acquire(record.id, holder, options.generation === undefined ? {} : {generation: options.generation});
        if (result.status === "rejected") {
            return {status: "rejected", reason: result.reason, detail: result.detail ?? result.reason};
        }
        // 取得期间服务端开始停止（打开项目要等子进程启动，可能好几秒）：不交出这份租约。
        if (!this.#admission) {
            result.lease.release();
            return {status: "rejected", reason: "admission-closed", detail: "服务端正在停止"};
        }
        return {status: "acquired", lease: this.#projectLease(record, result.lease)};
    }

    holds(id: string, generation: number, holder: string): boolean {
        return this.#children.holds(id, generation, holder);
    }

    running(id: string): {readonly generation: number; readonly state: Exclude<ProjectRunState, "stopped">} | null {
        const status = this.#children.state(id);
        if (status === null) return null;
        switch (status.state) {
            case "terminated":
                return null;
            case "creating":
                return {generation: status.generation, state: "starting"};
            case "available":
                return {generation: status.generation, state: "running"};
            case "idle-grace":
            case "stopping":
                return {generation: status.generation, state: status.state};
        }
    }

    stopAdmission(): void {
        this.#admission = false;
    }

    shutdownProblems(): ReadonlyArray<string> {
        return [...this.#shutdownProblems];
    }

    #projectLease(record: ProjectRecord, lease: ChildLease): ProjectLease {
        return {id: record.id, name: record.name, generation: lease.generation, revoked: lease.revoked, release: () => lease.release()};
    }

    async #create(id: string, generation: number): Promise<ProjectChild> {
        const resolved = await this.registry.resolve(id);
        if (!resolved.ok) throw new Error(resolved.detail);
        if (resolved.value === null) throw new Error(`项目 ${id} 已不在登记表里`);
        const record = resolved.value;
        const checked = await checkProjectDirectory(record.path, {cwd: this.#options.cwd, stateRoot: this.#options.stateRoot});
        if (!checked.ok) throw new Error(checked.detail);
        const identity = await readProjectIdentity(checked.path);
        if (identity.status !== "found" || identity.id !== id) throw new Error(`目录 ${checked.path} 的项目身份与登记不符`);

        const child = this.#spawn({...record, path: checked.path}, generation);
        const deadline = Promise.withResolvers<"timeout">();
        const cancel = this.#clock.schedule(() => deadline.resolve("timeout"), this.#options.startMs);
        const outcome = await Promise.race([child.started.promise, deadline.promise]);
        cancel();
        const proc = child.proc!;
        if (outcome === "timeout") {
            child.stopping = true;
            proc.kill("SIGKILL");
            await proc.exited;
            throw new Error(`项目子进程在 ${String(this.#options.startMs)}ms 内没有报告启动结果，已强制结束`);
        }
        if (outcome.status === "disconnected") {
            await proc.exited;
            throw new Error(`项目子进程在启动中退出（${describeExit(proc)}）`);
        }
        if (outcome.status === "failed") {
            const forced = await this.#terminate(child, this.#options.stopMs);
            throw new Error(`${outcome.detail}${forced ? "；子进程没有按时退出，已强制结束" : ""}`);
        }
        child.available = true;
        return child;
    }

    /** 先把链路交给路由，再起进程：子进程的 hello 到达时路由已在听。 */
    #spawn(record: ProjectRecord, generation: number): ProjectChild {
        const label = `[project ${record.name}#${String(generation)}] `;
        const child: ProjectChild = {
            record,
            generation,
            proc: null,
            started: Promise.withResolvers(),
            stopping: false,
            lost: false,
            available: false,
            link: createEnvelopeLink(
                {send: (envelope) => this.#send(child, envelope), disconnect: () => child.proc?.disconnect()},
                (error) => this.#options.record({level: "warn", event: "project.ipc.send-failed", message: `${label}IPC 通道已断，帧没有发出`, error}),
            ),
        };
        this.#options.router.accept(child.link, {expect: projectInstance({id: record.id, generation})});
        const env = this.#options.env ?? process.env;
        const proc = Bun.spawn({
            cmd: [process.execPath, this.#options.entry],
            cwd: this.#options.cwd,
            env: {
                ...env,
                [PROJECT_ENV.stateRoot]: this.#options.stateRoot,
                [PROJECT_ENV.id]: record.id,
                [PROJECT_ENV.name]: record.name,
                [PROJECT_ENV.generation]: String(generation),
                [PROJECT_ENV.root]: record.path,
            },
            stdin: "ignore",
            stdout: "pipe",
            stderr: "pipe",
            serialization: "json",
            ipc: (message) => this.#receive(child, message),
            onDisconnect: () => this.#disconnected(child),
        });
        child.proc = proc;
        this.#processes.set(record.id, child);
        const output = this.#options.output ?? {stdout: (text: string) => void process.stdout.write(text), stderr: (text: string) => void process.stderr.write(text)};
        for (const [stream, write] of [[proc.stdout, output.stdout], [proc.stderr, output.stderr]] as const) {
            forwardLines(stream, label, write).catch((error: unknown) => this.#options.record({level: "warn", event: "project.output.failed", message: `${label}转发子进程输出失败`, error}));
        }
        // 断开事件之外的兜底：进程结束总能观察到。
        void proc.exited.then(() => this.#disconnected(child));
        return child;
    }

    #send(child: ProjectChild, envelope: ProjectEnvelope): void {
        const proc = child.proc;
        if (proc === null) throw new Error("项目子进程还没有启动");
        proc.send(envelope);
    }

    #receive(child: ProjectChild, message: unknown): void {
        const envelope = parseEnvelope(message);
        if (envelope === null || envelope.t === "stop") {
            this.#options.record({level: "warn", event: "project.ipc.invalid", message: `项目 ${child.record.name}#${String(child.generation)} 发来无法识别的 IPC 消息`});
            return;
        }
        if (envelope.t === "frame") child.link.receive(envelope.d);
        else child.started.resolve(envelope);
    }

    /** IPC 断开或进程结束（两者都会到达，只处理一次）。 */
    #disconnected(child: ProjectChild): void {
        child.link.closed();
        child.started.resolve({status: "disconnected"});
        if (child.lost || child.stopping || !child.available) return;
        child.lost = true;
        // 没有被要求停止却断开：这一代结束，租约失效，不自动重启。
        this.#children.exited(child.record.id, child.generation);
        void child.proc!.exited.then(() => {
            this.#options.record({
                level: "error",
                event: "project.exited",
                message: `项目子进程意外退出（${describeExit(child.proc!)}）`,
                data: {project: child.record.id, name: child.record.name, generation: child.generation, exitCode: child.proc!.exitCode, signal: child.proc!.signalCode},
            });
        });
    }

    async #stop(child: ProjectChild, signal: AbortSignal): Promise<"closed" | "forced"> {
        const forced = await this.#terminate(child, null, signal);
        const proc = child.proc!;
        const label = `${child.record.name}#${String(child.generation)}`;
        if (forced) {
            this.#options.record({level: "error", event: "project.stop.forced", message: `项目子进程 ${label} 没有在截止前退出，已强制结束`, data: {project: child.record.id, generation: child.generation}});
        } else if (proc.exitCode !== 0) {
            this.#options.record({level: "warn", event: "project.stop.incomplete", message: `项目子进程 ${label} 收口时出错（${describeExit(proc)}）`, data: {project: child.record.id, generation: child.generation, exitCode: proc.exitCode, signal: proc.signalCode}});
        }
        if (!this.#admission && (forced || proc.exitCode !== 0)) {
            this.#shutdownProblems.push(`项目 ${label}${forced ? " 被强制结束" : ` ${describeExit(proc)}`}`);
        }
        return forced ? "forced" : "closed";
    }

    /**
     * 请求子进程停止并等它退出。截止由 `deadlineMs`（自己计时）或 `signal`（内核的停止截止）给出，到时强制结束。
     * 返回是否强制结束。
     */
    async #terminate(child: ProjectChild, deadlineMs: number | null, signal?: AbortSignal): Promise<boolean> {
        child.stopping = true;
        const proc = child.proc!;
        try {
            this.#send(child, {t: "stop"});
        } catch (error) {
            // 通道已断：进程正在退出或已退出，照样等它结束。
            this.#options.record({level: "warn", event: "project.ipc.send-failed", message: "停止请求没有发出", error});
        }
        let forced = false;
        const kill = (): void => {
            if (proc.exitCode !== null || proc.signalCode !== null) return;
            forced = true;
            proc.kill("SIGKILL");
        };
        const cancel = deadlineMs === null ? () => undefined : this.#clock.schedule(kill, deadlineMs);
        signal?.addEventListener("abort", kill, {once: true});
        try {
            await proc.exited;
        } finally {
            cancel();
            signal?.removeEventListener("abort", kill);
        }
        return forced;
    }
}

export function createProjectManager(options: ProjectManagerOptions): ProjectManager {
    return new ProjectManagerImpl(options);
}
