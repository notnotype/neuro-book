/**
 * 资源管理器的树模型（docs/specs/workbench/files-explorer.md）：两个根、按需列出的目录缓存、展开集合与经 `watch` 的
 * 增量刷新。只依赖文件客户端；呈现投影见 `rows.ts`。
 *
 * 目录槽的时序：
 * - 一个槽同一时刻至多一个列出在途；事件既能标脏已加载的槽，也能标脏正在列出的槽（标脏的在结果到达后再列一次）。
 * - 结果只在槽仍拥有这个请求时应用：槽被作废（目录被删、改名、换了类型）或又发了新请求，旧结果丢弃。
 * - 收起的目录不重列：收到变化只记为过期，再展开时重列。
 * - 订阅 `ready` 之前发出的列出可能漏掉其间的变化：`ready` 到达时把它们标脏。
 */

import {shallowRef, triggerRef} from "@vue/reactivity";
import type {ShallowRef} from "@vue/reactivity";

import type {FilesService, Listing, WatchMessage} from "nbook/plugins/files/shared/contracts";
import type {Scheme} from "nbook/plugins/files/shared/contracts";

import {childAddress, isWithin, parentAddress, rebase, rootAddress, schemeOf} from "./address";
import {invalidation} from "./invalidate";

export type RootStatus = {readonly kind: "unbound"} | {readonly kind: "live"} | {readonly kind: "ended"; readonly reason: string};

export interface RootState {
    readonly scheme: Scheme;
    readonly address: string;
    readonly status: RootStatus;
}

/** 一个目录的缓存：最后一份列出结果、最后一次失败、是否正在列出、收起期间是否过期。 */
export interface DirectorySlot {
    readonly listing: Listing | null;
    readonly error: {readonly code: string; readonly detail: string} | null;
    readonly loading: boolean;
    readonly stale: boolean;
}

/** 展开、选择与焦点要跟着改写或移除的地址（改名与删除事件）。 */
export interface PathChanges {
    readonly moves: ReadonlyArray<{readonly from: string; readonly to: string}>;
    readonly removed: ReadonlyArray<string>;
}

export interface TreeModelOptions {
    readonly files: FilesService;
    /** 窗口绑定了项目时才有 `project://` 根。 */
    readonly bound: boolean;
    /** 初始展开的目录（完整地址，含根）；缺省时项目根展开、用户资产根折叠。 */
    readonly expanded?: Iterable<string>;
    /** 展开集合变了：持久化据此保存。 */
    readonly onExpandedChange?: (expanded: ReadonlySet<string>) => void;
    /** 改名与删除改写了地址：选择与焦点据此跟随。 */
    readonly onPathsChanged?: (changes: PathChanges) => void;
    /** 监听者里抛出的异常等意外：交给诊断。 */
    readonly report: (error: unknown) => void;
}

export interface TreeModel {
    readonly roots: Readonly<ShallowRef<ReadonlyArray<RootState>>>;
    /** 目录地址 → 缓存。读它的 `computed` 随任何槽的变化重新求值。 */
    readonly slots: Readonly<ShallowRef<ReadonlyMap<string, DirectorySlot>>>;
    readonly expanded: Readonly<ShallowRef<ReadonlySet<string>>>;
    expand(address: string): void;
    collapse(address: string): void;
    /** 收起除根以外的全部目录。 */
    collapseAll(): void;
    /** 重列全部已加载的目录（用户点“刷新”）。 */
    refresh(): void;
    /** 重列一个目录（读取失败后的“重试”）。 */
    retry(address: string): void;
    /** 根的订阅结束后重新订阅并重列。 */
    reconnect(scheme: Scheme): void;
    dispose(): void;
}

interface Slot {
    listing: Listing | null;
    error: {code: string; detail: string} | null;
    request: {readonly seq: number; readonly abort: AbortController} | null;
    /** 请求在途期间又变了：结果到达后再列一次。 */
    dirty: boolean;
    stale: boolean;
    /** 请求在订阅 `ready` 之前发出。 */
    early: boolean;
}

export function createTreeModel(options: TreeModelOptions): TreeModel {
    const {files} = options;
    const schemes: Scheme[] = options.bound ? ["project", "user"] : ["user"];
    const roots = shallowRef<RootState[]>([
        {scheme: "project", address: rootAddress("project"), status: options.bound ? {kind: "live"} : {kind: "unbound"}},
        {scheme: "user", address: rootAddress("user"), status: {kind: "live"}},
    ]);
    const store = new Map<string, Slot>();
    const slots = shallowRef<Map<string, DirectorySlot>>(new Map());
    const expanded = shallowRef<Set<string>>(new Set(options.expanded ?? [rootAddress("project")]));
    const ready = new Set<Scheme>();
    const watches = new Map<Scheme, () => void>();
    let seq = 0;
    let disposed = false;

    const publish = (address: string): void => {
        const slot = store.get(address);
        if (slot === undefined) slots.value.delete(address);
        else slots.value.set(address, {listing: slot.listing, error: slot.error, loading: slot.request !== null, stale: slot.stale});
        triggerRef(slots);
    };
    const expandedChanged = (): void => {
        triggerRef(expanded);
        options.onExpandedChange?.(expanded.value);
    };
    const live = (address: string): boolean => roots.value.find((root) => root.scheme === schemeOf(address))?.status.kind === "live";

    /** 目录在树上可见：它与全部祖先都展开、祖先都已列出。 */
    const visible = (address: string): boolean => {
        if (!expanded.value.has(address)) return false;
        const parent = parentAddress(address);
        return parent === null || (visible(parent) && store.get(parent)?.listing != null);
    };

    const request = (address: string): void => {
        let slot = store.get(address);
        if (slot === undefined) {
            slot = {listing: null, error: null, request: null, dirty: false, stale: false, early: false};
            store.set(address, slot);
        }
        slot.request?.abort.abort();
        const current = {seq: ++seq, abort: new AbortController()};
        slot.request = current;
        slot.dirty = false;
        slot.early = !ready.has(schemeOf(address));
        publish(address);
        void files.list(address, {signal: current.abort.signal}).then((result) => {
            const owner = store.get(address);
            if (disposed || owner === undefined || owner.request !== current) return;
            owner.request = null;
            if (result.ok) {
                owner.listing = result.value;
                owner.error = null;
                owner.stale = false;
                prune(address, result.value);
            } else {
                owner.error = {code: result.code, detail: result.detail};
            }
            const again = owner.dirty;
            owner.dirty = false;
            publish(address);
            if (again) relist(address);
            ensureVisible();
        });
    };

    /** 目录变了：在途的等结果后再列；可见的立即重列；收起的记为过期。 */
    const relist = (address: string): void => {
        const slot = store.get(address);
        if (slot === undefined) return;
        if (slot.request !== null) slot.dirty = true;
        else if (visible(address) && live(address)) request(address);
        else {
            slot.stale = true;
            publish(address);
        }
    };

    /** 展开集合里、父目录已列出但自己还没列出（或已过期）的目录：发出列出。 */
    const ensureVisible = (): void => {
        if (disposed) return;
        for (const address of expanded.value) {
            if (!live(address) || !visible(address)) continue;
            const slot = store.get(address);
            if (slot === undefined || (slot.stale && slot.request === null)) request(address);
        }
    };

    /** 父目录列出后，确认不在了的展开子目录连同后代从展开集合里去掉；没加载到的保留。 */
    const prune = (directory: string, listing: Listing): void => {
        const present = new Set(listing.entries.filter((entry) => entry.kind === "directory").map((entry) => childAddress(directory, entry.name)));
        const absent = [...expanded.value].filter((address) => parentAddress(address) === directory && !present.has(address));
        if (absent.length === 0) return;
        for (const address of [...expanded.value]) if (absent.some((gone) => isWithin(address, gone))) expanded.value.delete(address);
        expandedChanged();
    };

    const drop = (prefix: string): void => {
        for (const [address, slot] of [...store]) {
            if (!isWithin(address, prefix)) continue;
            slot.request?.abort.abort();
            store.delete(address);
            publish(address);
        }
    };

    const onMessage = (scheme: Scheme, message: WatchMessage): void => {
        if (disposed) return;
        if (message.kind === "ready") {
            ready.add(scheme);
            for (const [address, slot] of store) {
                if (schemeOf(address) !== scheme || !slot.early) continue;
                slot.early = false;
                relist(address);
            }
            return;
        }
        if (message.kind === "resync") {
            for (const address of [...store.keys()]) if (schemeOf(address) === scheme) relist(address);
            return;
        }
        if (message.kind === "ended") {
            ready.delete(scheme);
            watches.delete(scheme);
            roots.value = roots.value.map((root) => (root.scheme === scheme ? {...root, status: {kind: "ended", reason: message.reason}} : root));
            return;
        }
        const scoped = [...store.keys()].filter((address) => schemeOf(address) === scheme);
        const change = invalidation(scheme, message.events, scoped);
        for (const prefix of change.gone) drop(prefix);
        if (change.moves.length > 0 || change.removed.length > 0) {
            const next = new Set<string>();
            for (const address of expanded.value) {
                if (change.removed.some((prefix) => isWithin(address, prefix))) continue;
                next.add(change.moves.reduce((current, move) => rebase(current, move.from, move.to), address));
            }
            expanded.value = next;
            options.onExpandedChange?.(next);
            options.onPathsChanged?.({moves: change.moves, removed: change.removed});
        }
        for (const address of change.dirty) relist(address);
        ensureVisible();
    };

    const watch = (scheme: Scheme): void => {
        watches.get(scheme)?.();
        watches.set(scheme, files.watch(scheme, (message) => {
            try {
                onMessage(scheme, message);
            } catch (error) {
                options.report(error);
            }
        }));
    };

    for (const scheme of schemes) watch(scheme);
    ensureVisible();

    return {
        roots,
        slots,
        expanded,
        expand: (address) => {
            if (expanded.value.has(address)) return;
            expanded.value.add(address);
            expandedChanged();
            ensureVisible();
        },
        collapse: (address) => {
            if (!expanded.value.delete(address)) return;
            expandedChanged();
        },
        collapseAll: () => {
            const kept = new Set([...expanded.value].filter((address) => parentAddress(address) === null));
            if (kept.size === expanded.value.size) return;
            expanded.value = kept;
            options.onExpandedChange?.(kept);
        },
        refresh: () => {
            for (const address of [...store.keys()]) relist(address);
        },
        retry: (address) => {
            if (store.get(address)?.request == null && live(address)) request(address);
        },
        reconnect: (scheme) => {
            if (!schemes.includes(scheme) || watches.has(scheme)) return;
            roots.value = roots.value.map((root) => (root.scheme === scheme ? {...root, status: {kind: "live"}} : root));
            // 断开期间的变化都可能漏掉：已缓存的全部按订阅之前发出处理，`ready` 后重列。
            for (const [address, slot] of store) if (schemeOf(address) === scheme) slot.early = true;
            watch(scheme);
            ensureVisible();
        },
        dispose: () => {
            disposed = true;
            for (const release of watches.values()) release();
            watches.clear();
            for (const slot of store.values()) slot.request?.abort.abort();
        },
    };
}
