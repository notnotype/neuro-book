/**
 * 装上（extensions.md 输出 19–22）：会话打开或新建之后按装配序调用各扩展的 `mount`，全部完成才受理指令。
 *
 * - `mount` 有时限（缺省 30 秒）；超时或抛错写 `extensionFailed{entry: "mount"}`，这个扩展标为失败、不再派发给它，会话照常。
 * - `mount` 里写的是外部事实：每次 `emit`、`set` 是一个写入批。空闲时排进队列立刻写，运行中先放进收件箱，
 *   到下一个边界按到达顺序写（`run/loop.ts` 的边界第 1 步）。
 * - 返回的清理函数在关闭会话时按装配序的逆序调用并等待（同样有时限），之后 `ctx.signal` 触发、`ctx.callback` 包的回调不再调用。
 */

import type {JsonValue} from "../api/index.js";
import type {Assembled} from "../extension/assemble.js";
import {mountCtx, stateOf, type ViewEnvironment} from "../extension/ctx.js";
import type {EventDraft} from "../state/draft.js";
import {STATE_SET} from "../state/snapshot.js";
import type {SessionCore} from "./core.js";
import {writeAndReact, type ReactHost} from "./reactions.js";

export const MOUNT_TIMEOUT_MS = 30_000;

export interface MountHost extends ReactHost {
    /** 有运行在进行（外部事实要等到边界）。 */
    running(): boolean;
}

interface Mounted {
    readonly item: Assembled;
    readonly controller: AbortController;
    cleanup: (() => void | Promise<void>) | null;
}

export class Mounts {
    readonly #mounted: Mounted[] = [];
    constructor(private readonly core: SessionCore, private readonly host: MountHost) {}

    /** 一个外部事实变成写入批：空闲时写，运行中进收件箱。 */
    #external(item: Assembled, write: {emit?: {name: string; data: JsonValue; key?: string}; set?: {slice: string; value: unknown}}): void {
        const {core} = this;
        const id = item.definition.id;
        let draft: EventDraft | null = null;
        if (write.emit !== undefined) {
            if (write.emit.key !== undefined && core.hasKey(id, write.emit.key)) return;
            const spec = (item.definition.events as Record<string, {scope: "path" | "session"; kind: "conv" | "ext"; version: number}>)[write.emit.name]!;
            draft = {type: `${id}/${write.emit.name}`, kind: spec.kind, scope: spec.scope, version: spec.version, data: write.emit.data, source: id, ...(write.emit.key === undefined ? {} : {key: write.emit.key})};
        } else if (write.set !== undefined) {
            const scope = (item.definition.state as Record<string, {scope: "path" | "session"}>)[write.set.slice]!.scope;
            if (JSON.stringify(stateOf(core.stateAt(), id)[write.set.slice]) === JSON.stringify(write.set.value)) return;
            draft = {type: `${id}/${STATE_SET}`, kind: "ext", scope, data: {slice: write.set.slice, value: write.set.value as JsonValue}, source: id};
        }
        if (draft === null || core.broken) return;
        if (this.host.running()) {
            core.inbox.push([draft]);
            return;
        }
        const batch = [draft];
        core.queue.run(() => writeAndReact(core, batch, this.host)).catch((error: unknown) => {
            core.diagnostics.add({code: "handler-threw", extension: id, entry: "mount", message: `${id} wrote an external fact that could not be written`, cause: error}, core.head);
        });
    }

    async mountAll(environment: Omit<ViewEnvironment, "now">): Promise<void> {
        const {core} = this;
        for (const item of core.assembly.order) {
            const mount = item.definition.mount as ((ctx: unknown) => unknown) | undefined;
            if (mount === undefined) continue;
            const id = item.definition.id;
            const controller = new AbortController();
            const entry: Mounted = {item, controller, cleanup: null};
            const ctx = mountCtx({
                assembly: core.assembly,
                item,
                state: () => core.stateAt(),
                environment,
                resources: this.host.resources,
                signal: controller.signal,
                external: (write) => this.#external(item, write),
                invalid: (problem) => core.diagnostics.add({code: "handler-invalid-output", extension: id, entry: "mount", message: problem}, core.head),
                callbackFailed: (error) => core.diagnostics.add({code: "handler-threw", extension: id, entry: "mount", message: `a callback of ${id} threw`, cause: error}, core.head),
            });
            const timeout = item.definition.timeoutMs ?? MOUNT_TIMEOUT_MS;
            const timerController = new AbortController();
            const timer = core.clock.wait(timeout, timerController.signal).then(() => "timeout" as const, () => "cancelled" as const);
            const work = (async () => {
                try {
                    return {ok: true as const, value: await mount(ctx)};
                } catch (error) {
                    return {ok: false as const, error};
                }
            })();
            const settled = await Promise.race([work, timer]);
            timerController.abort();
            if (settled === "timeout" || settled === "cancelled" || !settled.ok) {
                controller.abort();
                core.failedExtensions.add(id);
                const code = settled === "timeout" || settled === "cancelled" ? "timeout" : "threw";
                await core.queue.run(() => core.write([{type: "extensionFailed", kind: "ctrl", scope: "path", data: {extension: id, entry: "mount", code}}]));
                core.diagnostics.add({code: code === "timeout" ? "mount-timeout" : "mount-failed", extension: id, entry: "mount", params: {timeoutMs: timeout}, message: code === "timeout" ? `mount of ${id} did not finish within ${timeout} ms; the extension is disabled for this session` : `mount of ${id} threw; the extension is disabled for this session`, ...(typeof settled === "object" && !settled.ok ? {cause: settled.error} : {}), persisted: true}, core.head);
                continue;
            }
            if (typeof settled.value === "function") entry.cleanup = settled.value as () => void | Promise<void>;
            this.#mounted.push(entry);
        }
    }

    /** 关闭会话时：逆序调用清理函数并等待（各有时限），触发各自的信号。 */
    async unmountAll(): Promise<void> {
        const {core} = this;
        for (const entry of this.#mounted.reverse()) {
            entry.controller.abort();
            if (entry.cleanup === null) continue;
            const id = entry.item.definition.id;
            const timerController = new AbortController();
            const timer = core.clock.wait(entry.item.definition.timeoutMs ?? MOUNT_TIMEOUT_MS, timerController.signal).then(() => "timeout" as const, () => "cancelled" as const);
            const cleanup = entry.cleanup;
            const work = (async () => {
                try {
                    await cleanup();
                    return "done" as const;
                } catch (error) {
                    core.diagnostics.add({code: "handler-threw", extension: id, entry: "mount", message: `cleanup of ${id} threw`, cause: error}, core.head);
                    return "done" as const;
                }
            })();
            const settled = await Promise.race([work, timer]);
            timerController.abort();
            if (settled === "timeout") core.diagnostics.add({code: "mount-timeout", extension: id, entry: "mount", message: `cleanup of ${id} did not finish in time`}, core.head);
        }
        this.#mounted.length = 0;
    }
}
