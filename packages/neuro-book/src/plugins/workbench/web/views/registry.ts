/**
 * 视图注册表（docs/specs/workbench/views.md 输出 1–6、8）：两种输入分开。
 *
 * - 声明目录：工作台入口激活时从已接受的声明取得，之后不变（当前是静态清单）。未交付实现的视图也在目录里，导航不随
 *   交付先后跳动。第三方插件的视图没写 `order` 时，目录里补上 `THIRD_PARTY_VIEW_ORDER`，排在内置视图之后。
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

import {manifestFormat} from "nbook/plugin-platform-profile";
import type {WindowPluginRetry, WindowPlugins} from "nbook/shared/host";

import type {ViewContainerDeclaration, ViewDeclaration} from "../../shared/views";
import {VIEW_HEAD, VIEW_OWN_HEAD, VIEW_RAIL} from "../../shared/contracts";
import type {ViewHeadOptIn, ViewOwnHeadOptIn, ViewRailBounds, ViewRailOptIn} from "../../shared/contracts";
import type {ViewImplementation} from "../contracts";

/** 视图声明目录：视图 id 到声明。布局模型靠它决定视图的默认位置、尺寸约束与顺序。 */
export type ViewCatalog = ReadonlyMap<string, ViewDeclaration>;

export type ViewDelivery =
    | {readonly kind: "declared"}
    | {readonly kind: "entry-blocked"; readonly reason: string}
    | {readonly kind: "entry-failed"; readonly reason: string}
    | {readonly kind: "entry-stopped"; readonly reason: RevokeReason | "stopped"}
    | {readonly kind: "available"};

/** 一次加载的结果。stale：结果回来时句柄已撤回、换了或工作台已停止，这次结果作废，不算失败。 */
export type ViewLoad =
    /** `head`：实现申请了标题区（输出 19）；`ownHead`：还声明了浮动窗里自绘头（同条的“自绘头”）。Lab 的局部实现可以不给，按没申请。 */
    | {readonly status: "loaded"; readonly component: Component; readonly head?: boolean; readonly ownHead?: {readonly band: number}; readonly rail?: ViewRailBounds}
    | {readonly status: "failed"; readonly error: unknown}
    | {readonly status: "stale"};

type ViewHandle = ContributionHandle<ViewDeclaration, ViewImplementation>;

/** 实例层要的三件事；产品里是 `ViewRegistry`，Lab 场景给一份局部实现。 */
export interface ViewSource {
    /** 响应式：在 computed 里读会随交付变化重算。 */
    delivery(viewId: string): ViewDelivery;
    load(viewId: string): Promise<ViewLoad>;
    retry(viewId: string): Promise<WindowPluginRetry>;
    /** 标题后的计数（views.md 输出 17），响应式；Lab 的局部实现可以不给。 */
    badge?(viewId: string): number | null;
    /** 实现声明的视图段（views.md 输出 21），响应式，不加载视图；没声明、没交付时是 null。Lab 的局部实现可以不给。 */
    railOf?(viewId: string): ViewRailBounds | null;
}

/** 实现上的 `VIEW_RAIL`：形状合格才算声明了（都是有限正数，下限不高于上限，缺省在范围里）。 */
function railBoundsOf(implementation: ViewImplementation): ViewRailBounds | null {
    const bounds = (implementation as Partial<ViewRailOptIn>)[VIEW_RAIL];
    if (bounds === undefined) return null;
    const {width, minimum, maximum, chatMinimum} = bounds;
    const positive = [width, minimum, maximum, chatMinimum].every((value) => typeof value === "number" && Number.isFinite(value) && value > 0);
    return positive && minimum <= maximum && width >= minimum && width <= maximum ? {width, minimum, maximum, chatMinimum} : null;
}

function entryReason(state: EntryState): string {
    if (state.blocked !== null) return `${state.blocked.reason}：${state.blocked.key}`;
    return state.failure?.error?.message ?? state.failure?.reason ?? state.status;
}

/**
 * 第三方插件（发布者不是保留的发布者）的视图没写 `order` 时取的顺序：装上插件后工作台一打开，侧栏仍先显示内置视图
 * （docs/specs/workbench/views.md 输出 13）。内置视图的 `order` 都小于它。
 */
export const THIRD_PARTY_VIEW_ORDER = 1000;

function catalogDeclaration(descriptor: ContributionDescriptor<ViewDeclaration>): ViewDeclaration {
    if (descriptor.declaration.order !== undefined || manifestFormat.isBuiltinId(descriptor.plugin)) return descriptor.declaration;
    return {...descriptor.declaration, order: THIRD_PARTY_VIEW_ORDER};
}

/**
 * 容器声明目录（docs/specs/workbench/views.md 输出 15）：容器 id 到声明，工作台入口激活时从已接受的声明取得，之后不变。第三方插件的容器没写 `order` 时
 * 同视图一样补上 `THIRD_PARTY_VIEW_ORDER`（输出 13）。
 */
export function viewContainerCatalog(declarations: ReadonlyArray<ContributionDescriptor<ViewContainerDeclaration>>): ReadonlyMap<string, ViewContainerDeclaration> {
    return new Map(declarations.map((descriptor) => [descriptor.id, descriptor.declaration.order !== undefined || manifestFormat.isBuiltinId(descriptor.plugin) ? descriptor.declaration : {...descriptor.declaration, order: THIRD_PARTY_VIEW_ORDER}]));
}

export class ViewRegistry implements ViewSource {
    readonly catalog: ViewCatalog;
    readonly #owners: ReadonlyMap<string, {readonly plugin: string; readonly entry: string | null}>;
    readonly #plugins: WindowPlugins | null;
    readonly #handles = new Map<string, ViewHandle>();
    readonly #revoked = new Map<string, RevokeReason>();
    readonly #report: (message: string) => void;
    /** `badge()` 抛过错的句柄：同一个句柄只记一次诊断。 */
    readonly #badgeReported = new WeakSet<ViewHandle>();
    /** 交付状态的响应式版本号：句柄或入口状态变了就加一，读交付状态的 computed 因此重算。 */
    readonly #version = shallowRef(0);
    #stopped = false;

    constructor(declarations: ReadonlyArray<ContributionDescriptor<ViewDeclaration>>, plugins: WindowPlugins | null, signal: AbortSignal, report: (message: string) => void = () => undefined) {
        this.#report = report;
        this.catalog = new Map(declarations.map((descriptor) => [descriptor.id, catalogDeclaration(descriptor)]));
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

    /** 读贡献方的 `badge()`，不加载视图；正整数才交回，抛错按没有计数并记一次诊断。 */
    badge(viewId: string): number | null {
        void this.#version.value;
        const handle = this.#handles.get(viewId);
        if (handle === undefined || !handle.published || this.#stopped) return null;
        try {
            const count = handle.implementation().badge?.() ?? null;
            return typeof count === "number" && Number.isInteger(count) && count > 0 ? count : null;
        } catch (error) {
            if (!this.#badgeReported.has(handle)) {
                this.#badgeReported.add(handle);
                this.#report(`view ${viewId}: badge() failed: ${error instanceof Error ? error.message : String(error)}`);
            }
            return null;
        }
    }

    /** 实现声明的视图段（views.md 输出 21）：同 `badge()` 从句柄同步读、不加载视图；形状不合（不是有限正数、下限高于上限、缺省不在范围里）按没声明。 */
    railOf(viewId: string): ViewRailBounds | null {
        void this.#version.value;
        const handle = this.#handles.get(viewId);
        if (handle === undefined || !handle.published || this.#stopped) return null;
        try {
            return railBoundsOf(handle.implementation());
        } catch {
            // 撤回后 `implementation()` 抛 PluginStateError：句柄正在失去 published，按没交付处理；撤回到了会再 bump 一次。
            return null;
        }
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
            const implementation = handle.implementation();
            const component = await implementation.load();
            const head = (implementation as Partial<ViewHeadOptIn>)[VIEW_HEAD] === true;
            // 自绘头只和标题区一起读：视图经 `ViewHead.ownHead` 得知此刻在自绘。
            const ownHead = head ? (implementation as Partial<ViewOwnHeadOptIn>)[VIEW_OWN_HEAD] : undefined;
            const rail = railBoundsOf(implementation);
            return this.#current(viewId, handle) ? {status: "loaded", component, ...(head ? {head} : {}), ...(ownHead === undefined ? {} : {ownHead: {band: ownHead.band}}), ...(rail === null ? {} : {rail})} : {status: "stale"};
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
