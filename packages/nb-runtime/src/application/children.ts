/**
 * 子实例与租约：父实例按键创建、停止并计数使用者的另一个运行实例（例如服务端为每个打开的项目创建的
 * 项目实例）。子实例可以在另一个进程里，所以这里只持记录与宿主回调，不持有子实例的作用域。
 *
 * 父实例停止时，接纳在 `stop()` 开始的同步段里关闭；子实例在父实例根作用域关闭之前停完，父实例的
 * 插件与资源在这期间仍可用，供子实例收口时调用。行为合同见 docs/specs/runtime/application.md。
 */

import {systemClock} from "../lifecycle/lifecycle";
import type {RuntimeClock} from "../lifecycle/lifecycle";

import {ApplicationImpl} from "./bootstrap";
import type {Application} from "./contracts";

export type ChildState = "creating" | "available" | "idle-grace" | "stopping" | "terminated";

export interface ChildInstancesOptions<Handle> {
    /** 创建子实例（例如启动子进程并等它的内核就绪）；抛错即创建失败。 */
    readonly create: (key: string, generation: number) => Promise<Handle>;
    /** 停止子实例并等它真正退出；`signal` 在 `stopDeadlineMs` 到时触发，宿主应强制结束并返回 `forced`。 */
    readonly stop: (handle: Handle, context: {readonly signal: AbortSignal}) => Promise<"closed" | "forced">;
    /** 最后一个租约释放后等多久再停止（毫秒）。 */
    readonly graceMs: number;
    /** 停止的截止（毫秒）。 */
    readonly stopDeadlineMs: number;
    readonly clock?: RuntimeClock;
}

export interface ChildLease {
    readonly key: string;
    readonly generation: number;
    readonly holder: string;
    /** 这一代结束（正常停止、强制结束或意外退出）时触发：租约随之失效。 */
    readonly revoked: AbortSignal;
    /** 释放租约；幂等。 */
    release(): void;
}

export type AcquireChildResult =
    | {readonly status: "acquired"; readonly lease: ChildLease}
    | {readonly status: "rejected"; readonly reason: "admission-closed" | "create-failed" | "generation-gone"; readonly detail: string | null};

export interface AcquireChildOptions {
    /**
     * 只取这一代：它是当前代次且处于 `available` 或 `idle-grace` 时取得，否则立即 `generation-gone`，不等待、
     * 不创建新代次。客户端按原代次重连用它，旧绑定因此不会改投新代次。
     */
    readonly generation?: number;
}

/** 代次的非正常结束：强制结束与意外退出是外部观察到的终止；停止回调抛错时不知道子实例是否已退出。 */
export type ChildAbnormalEnd = "forced" | "exited" | "stop-failed";

export interface ChildStatus {
    readonly key: string;
    readonly generation: number;
    readonly state: ChildState;
    readonly leases: number;
    readonly abnormal: ChildAbnormalEnd | null;
}

export interface ChildDiagnostic {
    readonly sequence: number;
    readonly key: string;
    readonly generation: number;
    readonly reason: "create-failed" | ChildAbnormalEnd;
    readonly detail: string | null;
}

export interface ChildInstances {
    acquire(key: string, holder: string, options?: AcquireChildOptions): Promise<AcquireChildResult>;
    /** 该键当前（最近一个）代次的状态；从未创建过为 null。 */
    state(key: string): ChildStatus | null;
    /** 每个键当前代次的状态。 */
    list(): ReadonlyArray<ChildStatus>;
    /** 某持有者是否持有该键该代次的有效租约（路由核对 `{project}` 目标时使用）。 */
    holds(key: string, generation: number, holder: string): boolean;
    /** 宿主报告子实例意外退出：这一代立即结束，租约失效。 */
    exited(key: string, generation: number): void;
    diagnostics(): ReadonlyArray<ChildDiagnostic>;
}

/** 句柄只在子实例确实在运行的阶段存在；宽限期带着取消关闭计时的函数。 */
type Phase<Handle> =
    | {readonly state: "creating"}
    | {readonly state: "available"; readonly handle: Handle}
    | {readonly state: "idle-grace"; readonly handle: Handle; readonly cancelGrace: () => void}
    | {readonly state: "stopping"}
    | {readonly state: "terminated"};

interface Generation<Handle> {
    readonly key: string;
    readonly generation: number;
    phase: Phase<Handle>;
    /** 创建结算：兑现为 true 表示进入了 available。 */
    readonly created: Promise<boolean>;
    readonly leases: Map<symbol, string>;
    readonly revoke: AbortController;
    /** 进入 terminated 时兑现。 */
    readonly terminated: PromiseWithResolvers<void>;
    abnormal: ChildAbnormalEnd | null;
}

function message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

class ChildInstancesImpl<Handle> implements ChildInstances {
    readonly #options: ChildInstancesOptions<Handle>;
    readonly #clock: RuntimeClock;
    readonly #current = new Map<string, Generation<Handle>>();
    readonly #generations = new Map<string, number>();
    readonly #diagnostics: ChildDiagnostic[] = [];
    #admission = true;
    #sequence = 0;

    constructor(parent: ApplicationImpl, options: ChildInstancesOptions<Handle>) {
        this.#options = options;
        this.#clock = options.clock ?? systemClock;
        const stopping = parent.addStopStage(() => this.#stopAll());
        const close = (): void => {
            this.#admission = false;
        };
        if (stopping.aborted || parent.root.phase === "stopping" || parent.root.phase === "closed") {
            close();
            return;
        }
        stopping.addEventListener("abort", close, {once: true});
        // 父实例的截止先于停止阶段到达时，仍在停止的子实例以根作用域上的这项资源留在关闭报告里：
        // 父实例报 incomplete(deadline) 而不是 closed，之后的 recover() 再等它们。
        parent.root.register({kind: "child-instances", label: "child-instances", value: null, release: () => this.#stopAll()});
    }

    async acquire(key: string, holder: string, options: AcquireChildOptions = {}): Promise<AcquireChildResult> {
        if (options.generation !== undefined) {
            return this.#acquireGeneration(key, holder, options.generation);
        }
        // 每次等待之后回到循环开头：等待期间父实例可能开始停止，或这一代已经换掉。
        for (;;) {
            if (!this.#admission) {
                return {status: "rejected", reason: "admission-closed", detail: null};
            }
            const current = this.#current.get(key);
            if (current === undefined || current.phase.state === "terminated") {
                this.#create(key);
                continue;
            }
            const phase = current.phase;
            switch (phase.state) {
                case "creating":
                    if (!(await current.created)) {
                        return {status: "rejected", reason: "create-failed", detail: this.#detail(key, current.generation)};
                    }
                    continue;
                case "stopping":
                    // 正在停止的这一代不复活；等它真正结束后以新代次创建。
                    await current.terminated.promise;
                    continue;
                case "idle-grace":
                    phase.cancelGrace();
                    current.phase = {state: "available", handle: phase.handle};
                    return {status: "acquired", lease: this.#lease(current, holder)};
                case "available":
                    return {status: "acquired", lease: this.#lease(current, holder)};
            }
        }
    }

    #acquireGeneration(key: string, holder: string, generation: number): AcquireChildResult {
        if (!this.#admission) {
            return {status: "rejected", reason: "admission-closed", detail: null};
        }
        const current = this.#current.get(key);
        if (current === undefined || current.generation !== generation) {
            return {status: "rejected", reason: "generation-gone", detail: `${key} 的代次 ${String(generation)} 不是当前代次`};
        }
        const phase = current.phase;
        if (phase.state === "idle-grace") {
            phase.cancelGrace();
            current.phase = {state: "available", handle: phase.handle};
            return {status: "acquired", lease: this.#lease(current, holder)};
        }
        if (phase.state === "available") {
            return {status: "acquired", lease: this.#lease(current, holder)};
        }
        return {status: "rejected", reason: "generation-gone", detail: `${key} 的代次 ${String(generation)} 处于 ${phase.state}`};
    }

    state(key: string): ChildStatus | null {
        const current = this.#current.get(key);
        return current === undefined ? null : this.#status(current);
    }

    list(): ReadonlyArray<ChildStatus> {
        return [...this.#current.values()].map((current) => this.#status(current));
    }

    holds(key: string, generation: number, holder: string): boolean {
        const current = this.#current.get(key);
        return current !== undefined && current.generation === generation && current.phase.state !== "terminated" && [...current.leases.values()].includes(holder);
    }

    exited(key: string, generation: number): void {
        const current = this.#current.get(key);
        if (current === undefined || current.generation !== generation || current.phase.state === "terminated") {
            return;
        }
        this.#endAbnormally(current, "exited", null);
        this.#terminate(current);
    }

    diagnostics(): ReadonlyArray<ChildDiagnostic> {
        return [...this.#diagnostics];
    }

    /** 父实例的停止阶段与根作用域资源的释放都走这里：此时接纳已关闭，不会再有新代次加入；重复调用只等仍在停止的代次。 */
    async #stopAll(): Promise<void> {
        await Promise.all([...this.#current.values()].map(async (current) => {
            await current.created;
            const phase = current.phase;
            if (phase.state === "available" || phase.state === "idle-grace") {
                await this.#stop(current, phase.handle);
            } else if (phase.state === "stopping") {
                await current.terminated.promise;
            }
        }));
    }

    #create(key: string): void {
        const generation = (this.#generations.get(key) ?? 0) + 1;
        this.#generations.set(key, generation);
        const created = Promise.withResolvers<boolean>();
        const current: Generation<Handle> = {
            key,
            generation,
            phase: {state: "creating"},
            created: created.promise,
            leases: new Map(),
            revoke: new AbortController(),
            terminated: Promise.withResolvers<void>(),
            abnormal: null,
        };
        this.#current.set(key, current);
        void this.#options.create(key, generation).then(
            (handle) => {
                // 创建期间宿主已报告退出时这一代已经结束，不再进入 available。
                if (current.phase.state === "creating") {
                    current.phase = {state: "available", handle};
                }
                created.resolve(current.phase.state === "available");
            },
            (error: unknown) => {
                this.#record(key, generation, "create-failed", message(error));
                this.#terminate(current);
                created.resolve(false);
            },
        );
    }

    #lease(current: Generation<Handle>, holder: string): ChildLease {
        const token = Symbol(holder);
        current.leases.set(token, holder);
        return {
            key: current.key,
            generation: current.generation,
            holder,
            revoked: current.revoke.signal,
            release: () => {
                const phase = current.phase;
                if (!current.leases.delete(token) || current.leases.size > 0 || phase.state !== "available") {
                    return;
                }
                const cancelGrace = this.#clock.schedule(() => {
                    if (current.phase.state === "idle-grace") {
                        void this.#stop(current, current.phase.handle);
                    }
                }, this.#options.graceMs);
                current.phase = {state: "idle-grace", handle: phase.handle, cancelGrace};
            },
        };
    }

    async #stop(current: Generation<Handle>, handle: Handle): Promise<void> {
        if (current.phase.state === "idle-grace") {
            current.phase.cancelGrace();
        }
        current.phase = {state: "stopping"};
        const deadline = new AbortController();
        const cancelDeadline = this.#clock.schedule(() => deadline.abort(), this.#options.stopDeadlineMs);
        try {
            if ((await this.#options.stop(handle, {signal: deadline.signal})) === "forced") {
                this.#endAbnormally(current, "forced", null);
            }
        } catch (error) {
            this.#endAbnormally(current, "stop-failed", message(error));
        } finally {
            cancelDeadline();
            this.#terminate(current);
        }
    }

    #terminate(current: Generation<Handle>): void {
        if (current.phase.state === "terminated") {
            return;
        }
        if (current.phase.state === "idle-grace") {
            current.phase.cancelGrace();
        }
        current.phase = {state: "terminated"};
        current.leases.clear();
        current.revoke.abort();
        current.terminated.resolve();
    }

    #endAbnormally(current: Generation<Handle>, reason: ChildAbnormalEnd, detail: string | null): void {
        current.abnormal = reason;
        this.#record(current.key, current.generation, reason, detail);
    }

    #status(current: Generation<Handle>): ChildStatus {
        return {key: current.key, generation: current.generation, state: current.phase.state, leases: current.leases.size, abnormal: current.abnormal};
    }

    #detail(key: string, generation: number): string | null {
        return this.#diagnostics.findLast((diagnostic) => diagnostic.key === key && diagnostic.generation === generation)?.detail ?? null;
    }

    #record(key: string, generation: number, reason: ChildDiagnostic["reason"], detail: string | null): void {
        this.#sequence += 1;
        this.#diagnostics.push({sequence: this.#sequence, key, generation, reason, detail});
    }
}

/** 为父实例建立子实例管理；父实例 `stop()` 一开始即关闭接纳，子实例在父实例根作用域关闭前停完。 */
export function createChildInstances<Handle>(parent: Application, options: ChildInstancesOptions<Handle>): ChildInstances {
    if (!(parent instanceof ApplicationImpl)) {
        throw new TypeError("子实例需要 createApplication 创建的父实例");
    }
    return new ChildInstancesImpl(parent, options);
}
