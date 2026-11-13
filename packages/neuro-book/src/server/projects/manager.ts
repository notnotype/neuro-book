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
 *
 * 取在跑的工作（`work`）只读，不碰租约与宽限计时：问的是已经在跑的子进程，不为取工作起进程或延长它的寿命。
 */

import {statSync} from "node:fs";

import type {Subprocess} from "bun";

import type {SocketLink} from "@notnotype/nb-host/socket";
import {createChildInstances} from "@notnotype/nb-runtime/application";
import type {Application, ChildInstances, ChildLease} from "@notnotype/nb-runtime/application";
import type {DiagnosticInput} from "@notnotype/nb-runtime/diagnostics";
import {systemClock} from "@notnotype/nb-runtime/lifecycle";
import type {RuntimeClock} from "@notnotype/nb-runtime/lifecycle";
import {leaseHolderOf} from "@notnotype/nb-runtime/remote";
import type {BindRequest, CallerFrame, InstanceDescriptor, ProjectBindResult, RemoteRouter} from "@notnotype/nb-runtime/remote";
import {perConsumer} from "@notnotype/nb-runtime/services";
import type {ConsumerIdentity, PerConsumerProvision} from "@notnotype/nb-runtime/services";

import type {InstalledPlugin} from "nbook/plugin-platform/backend/installed";
import type {ProjectsRunningWork, RunningWorkCollection} from "nbook/server/running-work";
import {PROJECT_ENV} from "nbook/project/config";
import {projectInstance} from "nbook/project/start";
import type {
    ProjectAcquireResult,
    ProjectLease,
    ProjectMetadataPatch,
    ProjectMetadataRead,
    ProjectRecord,
    ProjectRegistryRead,
    ProjectRunState,
    ProjectState,
    ProjectsService,
    ProjectUnregisterResult,
    ProjectUpdateResult,
} from "nbook/shared/projects";
import {projectFolderName} from "nbook/shared/projects";

import {checkProjectDirectory, readProjectIdentity, updateProjectMetadata} from "./identity";
import {createEnvelopeLink, parseEnvelope} from "./ipc";
import type {ProjectEnvelope} from "./ipc";
import type {ProjectRegistry} from "./registry";

export interface ProjectManagerOptions {
    /** 服务端运行实例：项目实例是它的子实例，它停止时先停完全部项目子进程。 */
    readonly application: Application;
    /** 服务端实例 id：它上面的插件可以不取租约访问运行中的项目（docs/specs/runtime/projects.md 输出第 9 条）。 */
    readonly serverInstanceId: string;
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
    /** 服务端本次启动登记的第三方插件；每个子进程都收到这份，自己挑出在项目实例登记的。 */
    readonly installed?: ReadonlyArray<InstalledPlugin>;
}

export interface ProjectManager {
    readonly registry: ProjectRegistry;
    /** 已登记项目与运行状态，按登记顺序。 */
    list(): Promise<ProjectRegistryRead<ReadonlyArray<ProjectState>>>;
    /**
     * 取得租约；项目没在运行就以新代次启动它。给了 `generation` 时只取这一代（客户端重连），不等待、不创建。
     * 接纳关闭后（服务端开始停止）一律 `admission-closed`，在取得之后才关闭的，租约立即释放。
     */
    acquire(reference: string, holder: string, options?: {readonly generation?: number}): Promise<ProjectAcquireResult>;
    /** 按项目引用（短名或 id）取界面上的显示名：书名，没有时是目录原名；没有登记时为 null。 */
    displayTitle(reference: string): Promise<string | null>;
    /** 读已登记项目的作品信息（按 id，不按短名）。 */
    readMetadata(id: string): Promise<ProjectMetadataRead>;
    /** 修改已登记项目的作品信息（按 id），核对身份文件里的 id 与登记表一致。 */
    updateMetadata(id: string, patch: ProjectMetadataPatch): Promise<ProjectUpdateResult>;
    /**
     * 移出书架（按 id）：与同一 id 的打开串行；项目不在 `stopped` 时拒绝为 `project-running`。只看本服务端进程管理的
     * 代次，别的进程打开着同一个项目时照样移出（docs/specs/runtime/projects.md 输出第 15 条）。
     */
    unregister(id: string): Promise<ProjectUnregisterResult>;
    /** 某持有者是否持有该项目这一代的有效租约。 */
    holds(id: string, generation: number, holder: string): boolean;
    /** 该项目当前代次的状态；没在运行为 null。 */
    running(id: string): {readonly generation: number; readonly state: Exclude<ProjectRunState, "stopped">} | null;
    /** 同步关闭接纳；服务端停止序列的第一步调用。幂等。 */
    stopAdmission(): void;
    /** 服务端停止期间被强制结束或以非 0 退出的项目子进程；有则服务端以 1 退出。 */
    shutdownProblems(): ReadonlyArray<string>;
    /** 路由的绑定回调：为客户端取得项目租约，持有者是这个客户端实例。 */
    bind(request: Exclude<BindRequest, null>, client: InstanceDescriptor): Promise<ProjectBindResult>;
    /** 路由的 `{project}` 访问回调：持有这一代租约的调用方，或运行中项目的服务端插件，放行。 */
    access(caller: CallerFrame, id: string, generation: number): "allowed" | "denied";
    /** 宿主能力 `projectsKey` 的提供：每个调用方入口的每次激活一个门面，入口停止时释放它取得的租约。 */
    provision(): PerConsumerProvision<ProjectsService>;
    /**
     * 各项目此刻在跑的工作（docs/specs/runtime/server-host.md 的“在跑的工作”）。只问 `running` 与 `idle-grace` 的子进程，
     * 启动中的记进 `failed`，停止中与已停下的不问也不记。不会失败：某个项目取不到只让它进 `failed`。
     */
    work(): Promise<ProjectsRunningWork>;
}

/** 一个项目子进程交回在跑的工作的截止（docs/specs/runtime/server-host.md 的“在跑的工作”）。 */
export const PROJECT_WORK_QUERY_MS = 5000;

type AcquireRejected = Extract<ProjectAcquireResult, {readonly status: "rejected"}>;

/** 取不到一个项目在跑的工作的原因；进诊断。 */
type WorkUnavailable = "starting" | "timeout" | "send-failed" | "disconnected";

/** 一次 `work-query` 的结局：子进程的应答，或取不到的原因。 */
type WorkAnswer = {readonly ok: true; readonly collection: RunningWorkCollection} | {readonly ok: false; readonly reason: Exclude<WorkUnavailable, "starting">; readonly error?: unknown};

/** 打开在项目 id 队列里的那一段的结果：已进入 starting（`pending` 是内核子实例的取得结果），或被拒。 */
type AcquireEntered = {readonly status: "entered"; readonly record: ProjectRecord; readonly pending: ReturnType<ChildInstances["acquire"]>} | AcquireRejected;

/** 客户端绑定的租约记在客户端实例名下，不分插件：窗口里的插件都用这一份绑定。 */
function bindingHolder(instanceId: string): string {
    return leaseHolderOf({instanceId, plugin: null, entry: null, generation: null});
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
    /** 在等应答的 `work-query`：请求 id → 结算函数。结算时先从表里删掉，所以每次查询只结算一次，之后到的应答找不到它。 */
    readonly workQueries: Map<number, (answer: WorkAnswer) => void>;
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

function entryStamp(entry: string): string | null {
    try {
        const stats = statSync(entry);
        return `${String(stats.size)}:${String(stats.mtimeMs)}`;
    } catch {
        return null;
    }
}

class ProjectManagerImpl implements ProjectManager {
    readonly registry: ProjectRegistry;
    readonly #options: ProjectManagerOptions;
    readonly #clock: RuntimeClock;
    readonly #children: ChildInstances;
    /** 项目 id → 当前代次的子进程。 */
    readonly #processes = new Map<string, ProjectChild>();
    readonly #shutdownProblems: string[] = [];
    /**
     * 按项目 id 串行的队列尾：打开的“解析登记表并进入 starting”与移出的“检查状态并写表”在同一 id 上互斥，
     * 不会出现写表中被打开、或打开中被移出的半状态（输出第 15 条）。只覆盖到进入 starting 为止，等子进程启动不在里面。
     */
    readonly #serial = new Map<string, Promise<void>>();
    /** 交给每个子进程的第三方插件，服务端启动时就定了。 */
    readonly #installed: ReadonlyArray<InstalledPlugin>;
    /** 启动时项目宿主入口的大小与修改时间；入口当时不存在为 null（起子进程时照常报错）。 */
    readonly #entryStamp: string | null;
    #admission = true;
    /** `work-query` 的请求 id，整个管理器递增：换代后的子进程不会收到与旧代次相同的 id。 */
    #workQuery = 0;

    constructor(options: ProjectManagerOptions) {
        this.registry = options.registry;
        this.#options = options;
        this.#clock = options.clock ?? systemClock;
        this.#installed = options.installed ?? [];
        this.#entryStamp = entryStamp(options.entry);
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
        if (options.generation !== undefined) return this.#acquireGeneration(reference, holder, options.generation);
        // 先解析一次得到 id（引用可能是短名），再在这个 id 的队列里按 id 重新解析：排队期间它可能已被移出。
        const resolved = await this.#resolve(reference);
        if (resolved.status === "rejected") return resolved;
        const entered = await this.#serialized(resolved.record.id, async (): Promise<AcquireEntered> => {
            const current = await this.#resolve(resolved.record.id);
            if (current.status === "rejected") return current;
            if (current.record.id !== resolved.record.id) return {status: "rejected", reason: "unknown-project", detail: `没有登记的项目：${reference}`};
            // 不在这里等：`#children.acquire` 同步进入 starting（或从 idle-grace 回到 running），队列到此为止。
            return {status: "entered", record: current.record, pending: this.#children.acquire(current.record.id, holder)};
        });
        if (entered.status === "rejected") return entered;
        const record = entered.record;
        const result = await entered.pending;
        if (result.status === "rejected") {
            return {status: "rejected", reason: result.reason, detail: result.detail ?? result.reason};
        }
        return this.#admitted(record, result.lease);
    }

    /** 取得期间服务端开始停止（打开项目要等子进程启动，可能好几秒；按代次重连也有一次等待）：不交出这份租约。 */
    #admitted(record: ProjectRecord, lease: ChildLease): ProjectAcquireResult {
        if (!this.#admission) {
            lease.release();
            return {status: "rejected", reason: "admission-closed", detail: "服务端正在停止"};
        }
        return {status: "acquired", lease: this.#projectLease(record, lease)};
    }

    async #resolve(reference: string): Promise<{readonly status: "resolved"; readonly record: ProjectRecord} | AcquireRejected> {
        const resolved = await this.registry.resolve(reference);
        if (!resolved.ok) {
            this.#options.record({level: "error", event: "project.registry.invalid", message: resolved.detail, data: {file: this.registry.file}});
            return {status: "rejected", reason: "registry-invalid", detail: resolved.detail};
        }
        if (resolved.value === null) return {status: "rejected", reason: "unknown-project", detail: `没有登记的项目：${reference}`};
        return {status: "resolved", record: resolved.value};
    }

    /** 在项目 id 的队列里执行 `task`；前一个任务失败不影响后一个。 */
    #serialized<T>(id: string, task: () => Promise<T>): Promise<T> {
        const result = (this.#serial.get(id) ?? Promise.resolve()).then(task);
        const tail = result.then(() => undefined, () => undefined);
        this.#serial.set(id, tail);
        // 队列空了就删掉这一项，登记过又移出的 id 不在表里留着。
        void tail.then(() => {
            if (this.#serial.get(id) === tail) this.#serial.delete(id);
        });
        return result;
    }

    /** 按 id 找登记项；短名不算（书架与远程合同都按 id 指明项目）。 */
    async #record(id: string): Promise<{readonly ok: true; readonly record: ProjectRecord} | {readonly ok: false; readonly reason: "unknown-project" | "registry-invalid"; readonly detail: string}> {
        const resolved = await this.registry.resolve(id);
        if (!resolved.ok) return resolved;
        if (resolved.value === null || resolved.value.id !== id) return {ok: false, reason: "unknown-project", detail: `没有登记的项目：${id}`};
        return {ok: true, record: resolved.value};
    }

    /**
     * 按项目引用（短名或 id）取界面上的显示名：书名，没有书名时是目录原名；没有登记或登记表读不出时为 null。给引导接口用，
     * 窗口在连上服务端之前就能显示书名（docs/specs/runtime/browser-host.md 启动序列第 2 步）。
     */
    async displayTitle(reference: string): Promise<string | null> {
        const resolved = await this.registry.resolve(reference);
        if (!resolved.ok || resolved.value === null) return null;
        const record = resolved.value;
        try {
            const identity = await readProjectIdentity(record.path);
            if (identity.status === "found" && identity.id === record.id && identity.metadata.title !== null) return identity.metadata.title;
        } catch (error) {
            this.#options.record({level: "warn", event: "project.identity.read-failed", message: "读不出身份文件，显示名退回目录名", error, data: {project: record.id}});
        }
        return projectFolderName(record.path);
    }

    async readMetadata(id: string): Promise<ProjectMetadataRead> {
        const found = await this.#record(id);
        if (!found.ok) return found;
        let identity;
        try {
            identity = await readProjectIdentity(found.record.path);
        } catch (error) {
            return {ok: false, reason: "read-failed", detail: `读不出 ${found.record.path} 的身份文件：${error instanceof Error ? error.message : String(error)}`};
        }
        switch (identity.status) {
            case "missing":
                return {ok: false, reason: "identity-invalid", detail: `${found.record.path} 里没有身份文件`};
            case "invalid":
                return {ok: false, reason: "identity-invalid", detail: identity.detail};
            case "found":
                if (identity.id !== id) return {ok: false, reason: "identity-conflict", detail: `${found.record.path} 的身份文件里是另一个 id ${identity.id}`};
                return {ok: true, metadata: identity.metadata, problems: identity.problems};
        }
    }

    async updateMetadata(id: string, patch: ProjectMetadataPatch): Promise<ProjectUpdateResult> {
        const found = await this.#record(id);
        if (!found.ok) return found;
        return updateProjectMetadata(found.record.path, id, patch, {
            report: (event, error) => this.#options.record({level: "warn", event, message: "修改作品信息的收尾步骤出错，修改结果不受影响", error, data: {project: id}}),
        });
    }

    unregister(id: string): Promise<ProjectUnregisterResult> {
        return this.#serialized(id, async () => {
            const running = this.running(id);
            if (running !== null) return {ok: false, reason: "project-running", state: running.state, detail: `项目正在运行（${running.state}），关掉全部窗口、等宽限期结束后再移出`};
            return this.registry.unregister(id);
        });
    }

    /** 按代次取得只认正在运行的那一代，不读登记表：登记表坏了也不影响已打开项目的重连。 */
    async #acquireGeneration(id: string, holder: string, generation: number): Promise<ProjectAcquireResult> {
        const child = this.#processes.get(id);
        if (child === undefined || child.generation !== generation) return {status: "rejected", reason: "generation-gone", detail: `项目 ${id} 的代次 ${String(generation)} 已结束`};
        const result = await this.#children.acquire(id, holder, {generation});
        if (result.status === "rejected") return {status: "rejected", reason: result.reason, detail: result.detail ?? result.reason};
        return this.#admitted(child.record, result.lease);
    }

    async bind(request: Exclude<BindRequest, null>, client: InstanceDescriptor): Promise<ProjectBindResult> {
        const result = await this.acquire(request.project, bindingHolder(client.id), "generation" in request ? {generation: request.generation} : {});
        if (result.status === "acquired") {
            const {lease} = result;
            return {ok: true, binding: {id: lease.id, name: lease.name, generation: lease.generation}, revoked: lease.revoked, release: () => lease.release()};
        }
        if (result.reason === "generation-gone") return {ok: false, reason: "project-gone", message: result.detail};
        return {ok: false, reason: "project-unavailable", message: result.reason === "admission-closed" ? "服务端正在停止" : result.detail};
    }

    access(caller: CallerFrame, id: string, generation: number): "allowed" | "denied" {
        if (this.holds(id, generation, leaseHolderOf(caller)) || this.holds(id, generation, bindingHolder(caller.instanceId))) return "allowed";
        // 服务端插件可以不取租约访问运行中的项目；宽限期中不行，访问也不会取消宽限期。
        const running = this.running(id);
        const serverPlugin = caller.instanceId === this.#options.serverInstanceId && caller.plugin !== null;
        return serverPlugin && running?.generation === generation && running.state === "running" ? "allowed" : "denied";
    }

    provision(): PerConsumerProvision<ProjectsService> {
        const held = new Map<ProjectsService, Set<ProjectLease>>();
        return perConsumer(
            (consumer: ConsumerIdentity): ProjectsService => {
                const leases = new Set<ProjectLease>();
                const facade: ProjectsService = {
                    list: () => this.list(),
                    register: (path) => this.registry.register(path),
                    resolve: (reference) => this.registry.resolve(reference),
                    readMetadata: (id) => this.readMetadata(id),
                    create: (input) => this.registry.create(input),
                    updateMetadata: (id, patch) => this.updateMetadata(id, patch),
                    unregister: (id) => this.unregister(id),
                    acquire: async (reference) => {
                        // 持有者是这个调用方入口的这次激活（经代理时也是原调用方，见 leaseHolderOf）。
                        const result = await this.acquire(reference, leaseHolderOf(consumer));
                        if (result.status !== "acquired") return result;
                        const {lease} = result;
                        const tracked: ProjectLease = {...lease, release: () => {
                            leases.delete(tracked);
                            lease.release();
                        }};
                        leases.add(tracked);
                        return {status: "acquired", lease: tracked};
                    },
                };
                held.set(facade, leases);
                return facade;
            },
            // 调用方入口停止：它没释放的租约一并释放。
            (facade) => {
                for (const lease of [...(held.get(facade) ?? [])]) lease.release();
                held.delete(facade);
            },
        );
    }

    holds(id: string, generation: number, holder: string): boolean {
        return this.#children.holds(id, generation, holder);
    }

    async work(): Promise<ProjectsRunningWork> {
        const failed: Array<ProjectsRunningWork["failed"][number]> = [];
        const queries: Array<Promise<ProjectsRunningWork>> = [];
        for (const status of this.#children.list()) {
            if (status.state === "stopping" || status.state === "terminated") continue;
            const project = status.key;
            if (status.state === "creating") {
                // 启动中的项目里插件可能已在跑长任务；查不到不能当成没有。
                this.#workUnavailable(project, status.generation, "starting");
                failed.push({plugin: null, project});
                continue;
            }
            const child = this.#processes.get(project);
            if (child === undefined || child.generation !== status.generation || child.lost || child.stopping) {
                this.#workUnavailable(project, status.generation, "disconnected");
                failed.push({plugin: null, project});
                continue;
            }
            queries.push(this.#queryWork(child));
        }
        // 每个查询自己收口、不会失败，汇合时一个项目出事不影响别的。
        const answers = await Promise.all(queries);
        return {
            items: answers.flatMap((answer) => answer.items),
            failed: [...failed, ...answers.flatMap((answer) => answer.failed)],
        };
    }

    #queryWork(child: ProjectChild): Promise<ProjectsRunningWork> {
        this.#workQuery += 1;
        const id = this.#workQuery;
        const project = child.record.id;
        const answered = Promise.withResolvers<WorkAnswer>();
        let cancel = (): void => undefined;
        const settle = (answer: WorkAnswer): void => {
            if (!child.workQueries.delete(id)) return;
            cancel();
            answered.resolve(answer);
        };
        child.workQueries.set(id, settle);
        try {
            cancel = this.#clock.schedule(() => settle({ok: false, reason: "timeout"}), PROJECT_WORK_QUERY_MS);
            this.#send(child, {t: "work-query", id});
        } catch (error) {
            // 通道在断开事件到达之前已断（例如 ERR_IPC_CHANNEL_CLOSED）：这个项目取不到，不等截止。
            settle({ok: false, reason: "send-failed", error});
        }
        return answered.promise.then((answer) => {
            if (answer.ok) {
                return {
                    items: answer.collection.items.map(({plugin, text}) => ({plugin, project, text})),
                    failed: answer.collection.failed.map((plugin) => ({plugin, project})),
                };
            }
            this.#workUnavailable(project, child.generation, answer.reason, answer.error);
            return {items: [], failed: [{plugin: null, project}]};
        });
    }

    #workUnavailable(project: string, generation: number, reason: WorkUnavailable, error?: unknown): void {
        this.#options.record({level: "warn", event: "project.work.unavailable", message: `取不到项目 ${project}#${String(generation)} 在跑的工作`, error, data: {project, generation, reason}});
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
        // 全局包原地升级会在运行中的服务端脚下换掉 project.js：新的项目宿主与内存里的旧服务端版本不一致，不起它。
        if (this.#entryStamp !== null && entryStamp(this.#options.entry) !== this.#entryStamp) {
            throw new Error(`应用文件 ${this.#options.entry} 在服务端运行期间被更换（升级了？），重启服务后再打开作品`);
        }

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
            workQueries: new Map(),
            link: createEnvelopeLink(
                {send: (envelope) => this.#send(child, envelope), disconnect: () => child.proc?.disconnect()},
                (error) => this.#options.record({level: "warn", event: "project.ipc.send-failed", message: `${label}IPC 通道已断，帧没有发出`, error}),
            ),
        };
        this.#options.router.accept(child.link, {expect: projectInstance({id: record.id, generation})});
        const env = this.#options.env ?? process.env;
        let proc: Subprocess<"ignore", "pipe", "pipe">;
        try {
            proc = Bun.spawn({
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
        } catch (error) {
            // 链路已交给路由：进程没起来就关掉它，不留一条永远等不到 hello 的链路。
            child.link.closed();
            throw error;
        }
        child.proc = proc;
        this.#processes.set(record.id, child);
        // 第一条消息：子进程等到它才装配插件（ipc.ts 的 `plugins`）。
        this.#send(child, {t: "plugins", installed: this.#installed});
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
        if (envelope === null || envelope.t === "stop" || envelope.t === "plugins" || envelope.t === "work-query") {
            this.#options.record({level: "warn", event: "project.ipc.invalid", message: `项目 ${child.record.name}#${String(child.generation)} 发来无法识别的 IPC 消息`});
            return;
        }
        if (envelope.t === "frame") child.link.receive(envelope.d);
        else if (envelope.t === "work") this.#workAnswered(child, envelope);
        else child.started.resolve(envelope);
    }

    #workAnswered(child: ProjectChild, envelope: Extract<ProjectEnvelope, {readonly t: "work"}>): void {
        const settle = child.workQueries.get(envelope.id);
        if (settle === undefined) {
            // 那次查询已按超时结算并交回了结果；这份应答不再算进任何汇总。
            this.#options.record({level: "debug", event: "project.work.late", message: `项目 ${child.record.name}#${String(child.generation)} 的在跑的工作应答晚于截止，已丢弃`, data: {project: child.record.id, generation: child.generation, query: envelope.id}});
            return;
        }
        settle({ok: true, collection: {items: envelope.items, failed: envelope.failed}});
    }

    /** IPC 断开或进程结束（两者都会到达，只处理一次）。 */
    #disconnected(child: ProjectChild): void {
        child.link.closed();
        child.started.resolve({status: "disconnected"});
        for (const settle of [...child.workQueries.values()]) settle({ok: false, reason: "disconnected"});
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
