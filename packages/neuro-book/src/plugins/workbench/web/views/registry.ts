/**
 * 视图注册表（docs/specs/workbench/views.md 输出 1–6、8）：两种输入分开。
 *
 * - 声明目录：工作台入口激活时从已接受的声明取得，之后不变（当前是静态清单）。未交付实现的视图也在目录里，导航不随
 *   交付先后跳动。
 * - 交付句柄：接收者在 `published` 时记下句柄、`revoke` 时去掉。每次加载都经句柄的 `implementation()` 取实现，不缓存，
 *   这样撤回之后不会再用旧实现。
 *
 * 句柄之外的状态（入口受阻、激活失败、已停止）从宿主能力 `window.plugins` 查；它的变化通知不精确，所以交付状态每次
 * 都重新求，句柄优先：有仍 published 的句柄才是 `available`。入口开始停止时句柄先失去 published、撤回稍后才到，
 * 这段时间按已停止呈现（停止开始时内核会记诊断，变化通知随之到达）。
 */

import {shallowRef} from "@vue/reactivity";
import type {Component} from "vue";

import type {ContributionDescriptor, ContributionHandle, ContributionReceiver, EntryState, RevokeReason} from "@notnotype/nb-runtime/plugins";

import type {WindowPluginRetry, WindowPlugins} from "nbook/shared/host";

import type {ViewDeclaration} from "../../shared/views";
import type {ViewImplementation} from "../contracts";
import type {ViewCatalog} from "./placement";

export type ViewDelivery =
    | {readonly kind: "declared"}
    | {readonly kind: "entry-blocked"; readonly reason: string}
    | {readonly kind: "entry-failed"; readonly reason: string}
    | {readonly kind: "entry-stopped"; readonly reason: RevokeReason | "stopped"}
    | {readonly kind: "available"};

/** 一次加载的结果。stale：结果回来时句柄已撤回、换了或工作台已停止，这次结果作废，不算失败。 */
export type ViewLoad =
    | {readonly status: "loaded"; readonly component: Component}
    | {readonly status: "failed"; readonly error: unknown}
    | {readonly status: "stale"};

type ViewHandle = ContributionHandle<ViewDeclaration, ViewImplementation>;

/** 实例层要的三件事；产品里是 `ViewRegistry`，Lab 场景给一份局部实现。 */
export interface ViewSource {
    /** 响应式：在 computed 里读会随交付变化重算。 */
    delivery(viewId: string): ViewDelivery;
    load(viewId: string): Promise<ViewLoad>;
    retry(viewId: string): Promise<WindowPluginRetry>;
}

function entryReason(state: EntryState): string {
    if (state.blocked !== null) return `${state.blocked.reason}：${state.blocked.key}`;
    return state.failure?.error?.message ?? state.failure?.reason ?? state.status;
}

export class ViewRegistry implements ViewSource {
    readonly catalog: ViewCatalog;
    readonly #owners: ReadonlyMap<string, {readonly plugin: string; readonly entry: string | null}>;
    readonly #plugins: WindowPlugins | null;
    readonly #handles = new Map<string, ViewHandle>();
    readonly #revoked = new Map<string, RevokeReason>();
    /** 交付状态的响应式版本号：句柄或入口状态变了就加一，读交付状态的 computed 因此重算。 */
    readonly #version = shallowRef(0);
    #stopped = false;

    constructor(declarations: ReadonlyArray<ContributionDescriptor<ViewDeclaration>>, plugins: WindowPlugins | null, signal: AbortSignal) {
        this.catalog = new Map(declarations.map((descriptor) => [descriptor.id, descriptor.declaration]));
        this.#owners = new Map(declarations.map((descriptor) => [descriptor.id, {plugin: descriptor.plugin, entry: descriptor.entry}]));
        this.#plugins = plugins;
        const unsubscribe = plugins?.onChange(() => this.#bump());
        signal.addEventListener("abort", () => {
            this.#stopped = true;
            unsubscribe?.();
            this.#bump();
        }, {once: true});
    }

    delivery(viewId: string): ViewDelivery {
        void this.#version.value;
        if (this.#stopped) return {kind: "entry-stopped", reason: "receiver-closed"};
        const handle = this.#handles.get(viewId);
        if (handle?.published === true) return {kind: "available"};
        // 句柄还在表里但已不 published：入口开始停止、撤回还在排队（接收者的串行锁）。按已停止呈现，实例层不再拿它加载。
        if (handle !== undefined) return {kind: "entry-stopped", reason: "stopped"};
        const owner = this.#owners.get(viewId);
        const state = owner?.entry === null || owner === undefined ? null : this.#plugins?.entryState({plugin: owner.plugin, entry: owner.entry}) ?? null;
        if (state?.status === "blocked") return {kind: "entry-blocked", reason: entryReason(state)};
        if (state?.status === "failed") return {kind: "entry-failed", reason: entryReason(state)};
        const revoked = this.#revoked.get(viewId);
        if (revoked !== undefined) return {kind: "entry-stopped", reason: revoked};
        if (state?.status === "stopping" || state?.status === "closed") return {kind: "entry-stopped", reason: "stopped"};
        return {kind: "declared"};
    }

    receiver(): ContributionReceiver<ViewDeclaration, ViewImplementation> {
        return {
            published: (handle) => {
                this.#handles.set(handle.id, handle);
                this.#revoked.delete(handle.id);
                this.#bump();
            },
            revoke: (handle, _prepared, reason) => {
                if (this.#handles.get(handle.id) !== handle) return;
                this.#handles.delete(handle.id);
                this.#revoked.set(handle.id, reason);
                this.#bump();
            },
        };
    }

    /**
     * 加载一次组件定义。结果回来时句柄已不是当前句柄、已不处于 published，或工作台已停止，就作废这次结果；视图代际由
     * 调用方（实例层）另外核对。
     */
    async load(viewId: string): Promise<ViewLoad> {
        const handle = this.#handles.get(viewId);
        if (handle === undefined || this.#stopped) return {status: "stale"};
        try {
            const component = await handle.implementation().load();
            return this.#current(viewId, handle) ? {status: "loaded", component} : {status: "stale"};
        } catch (error) {
            // implementation() 在撤回后抛 PluginStateError：那也是“已作废”，不是加载失败。
            return this.#current(viewId, handle) ? {status: "failed", error} : {status: "stale"};
        }
    }

    /** 视图所属入口激活失败时，恢复并重新激活它；只经视图 id，拿不到别的入口。 */
    async retry(viewId: string): Promise<WindowPluginRetry> {
        const owner = this.#owners.get(viewId);
        if (owner === undefined || owner.entry === null) return {status: "failed", reason: `未登记的视图 ${viewId}`};
        if (this.#plugins === null) return {status: "failed", reason: "宿主没有提供入口状态"};
        const result = await this.#plugins.retry({plugin: owner.plugin, entry: owner.entry});
        this.#bump();
        return result;
    }

    #current(viewId: string, handle: ViewHandle): boolean {
        return !this.#stopped && this.#handles.get(viewId) === handle && handle.published;
    }

    #bump(): void {
        this.#version.value += 1;
    }
}
