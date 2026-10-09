/**
 * 批量移动、复制、删除（docs/specs/workspace/files.md 的“文件操作”：批量预处理、逐项结果、停止与取消、大小上限）。
 *
 * - 预处理在任何副作用之前：解析全部源，按目录项（父目录真实路径加名字）去重，被另一源目录覆盖的只做最外层。
 * - 逐项执行，每项开始前检查业务取消、内核传来的终止信号（调用方断线、调用方或提供入口停止、项目代次结束）与根身份；
 *   正在执行的项按实际结果结算，已完成的项不回滚。
 * - 每项的清单维护与单项操作相同：涉及内容树时在所在内容根的操作锁里提交文件并改清单。复制只在最后改清单时持锁，复制
 *   过程本身不持锁（大目录的复制不挡住同一内容树里的其它操作）。
 * - 结果要装进一条 RPC 消息：编码后超过预算时清空范围里的路径并标 `truncated`。
 */

import {sep} from "node:path";

import type {BatchResult, ChangeSource, ItemResult, ManifestIssue} from "../shared/contracts";
import {encodedBytes, TEXT_BUDGET_BYTES} from "../shared/contracts";
import type {ChangeHub, OperationChange, OperationEvent} from "./changes";
import {copyEntry, deleteEntry, moveEntry} from "./entry-ops";
import type {EntryFailure} from "./entry-ops";
import type {Outcome} from "./files-service";
import {decodeText} from "./files-service";
import {itemAt, plainItem, renamedItem} from "./manifest-edit";
import type {ItemNode} from "./manifest-edit";
import {editManifest, listable, manifestOf, placeOf} from "./operations";
import type {ManifestWrite, TreePlace} from "./operations";
import {entryToken} from "./rooted";
import type {ResolvedEntry, RootedFailure, RootedRoot} from "./rooted";

/** 结果里的说明截到这么多字：1000 项的结果仍要装进一条消息。 */
const MAX_DETAIL = 200;
/** 清单文件的读取上限（复制时取源条目的子树）。 */
const MANIFEST_MAX_BYTES = 1024 * 1024;

export interface BatchOptions {
    readonly root: RootedRoot;
    readonly changes: ChangeHub;
    readonly diagnose: (event: string, detail: string, cause: string) => void;
    /** 批量因终止信号停下时记一条诊断。 */
    readonly stopped: (operation: string, detail: string) => void;
}

/** 一次批量的停止标记：业务取消由 `cancel` 方法置上。 */
export interface BatchControl {
    readonly operation: string;
    cancelled: boolean;
    readonly signal: AbortSignal;
}

export type TransferItem = {readonly source: string; readonly target: string; readonly expected?: string};
export type DeleteItem = {readonly path: string; readonly expected?: string};

export interface Batch {
    transfer(kind: "move" | "copy", items: ReadonlyArray<TransferItem>, source: ChangeSource, control: BatchControl): Promise<Outcome<BatchResult>>;
    remove(items: ReadonlyArray<DeleteItem>, source: ChangeSource, control: BatchControl): Promise<Outcome<BatchResult>>;
}

type Prepared = {readonly kind: "ready"; readonly entry: ResolvedEntry; readonly expected?: string} | {readonly kind: "settled"; readonly result: ItemResult};

export function createBatch(options: BatchOptions): Batch {
    const {root, changes} = options;

    const failedItem = (failure: RootedFailure, event: string): ItemResult => {
        if (failure.cause !== undefined) options.diagnose(event, failure.detail, failure.cause);
        const partial = (failure as EntryFailure).partial;
        return {
            status: "failed",
            code: failure.code,
            detail: clip(failure.detail),
            ...(partial === undefined ? {} : {partial: {
                ...(partial.removed === undefined ? {} : {removed: {paths: [...partial.removed], truncated: false}}),
                ...(partial.residual === undefined ? {} : {residual: {paths: [...partial.residual], truncated: false}}),
            }}),
        };
    };

    /** 解析全部源并去重；解析失败的项直接结算为失败。 */
    const prepare = async (sources: ReadonlyArray<{readonly path: string; readonly expected?: string}>): Promise<Prepared[]> => {
        const prepared: Prepared[] = [];
        const seen = new Set<string>();
        for (const item of sources) {
            const entry = await root.resolveEntry(item.path);
            if ("ok" in entry) {
                prepared.push({kind: "settled", result: failedItem(entry, "files.batch.resolve-failed")});
                continue;
            }
            if (seen.has(entry.absolute)) {
                prepared.push({kind: "settled", result: {status: "skipped", reason: "duplicate"}});
                continue;
            }
            seen.add(entry.absolute);
            prepared.push({kind: "ready", entry, ...(item.expected === undefined ? {} : {expected: item.expected})});
        }
        // 被另一个源覆盖的源只做最外层。源的位置都是真实路径，只有目录会是别的源的前缀（链接的路径下面没有真实路径）。
        const directories = prepared.flatMap((item) => (item.kind === "ready" ? [item.entry.absolute] : []));
        return prepared.map((item) => {
            if (item.kind !== "ready") return item;
            const covered = directories.some((directory) => item.entry.absolute.startsWith(directory + sep));
            return covered ? {kind: "settled", result: {status: "skipped", reason: "covered"}} : item;
        });
    };

    /** 逐项执行；`run` 只处理通过预处理的项。 */
    const execute = async <T>(prepared: ReadonlyArray<Prepared>, inputs: ReadonlyArray<T>, control: BatchControl, run: (item: Extract<Prepared, {kind: "ready"}>, input: T) => Promise<ItemResult>): Promise<ItemResult[]> => {
        const results: ItemResult[] = [];
        let stop: ItemResult | null = null;
        for (const [index, item] of prepared.entries()) {
            if (stop === null) {
                if (control.cancelled) stop = {status: "cancelled"};
                else if (control.signal.aborted) {
                    stop = {status: "not-run", reason: "stopped"};
                    options.stopped(control.operation, `批量在第 ${String(index + 1)} 项之前停下：${String(control.signal.reason)}`);
                } else {
                    const gone = await root.resolve("");
                    if ("ok" in gone && gone.code === "root-gone") stop = {status: "not-run", reason: "root-gone"};
                }
            }
            if (stop !== null) {
                results.push(item.kind === "settled" && item.result.status === "skipped" ? item.result : stop);
                continue;
            }
            results.push(item.kind === "settled" ? item.result : await run(item, inputs[index] as T));
        }
        return results;
    };

    /** 取锁后重新解析源并核对身份（与 `expected` 或预处理时的身份）。 */
    const recheck = async (item: Extract<Prepared, {kind: "ready"}>, path: string): Promise<ResolvedEntry | RootedFailure> => {
        const again = await root.resolveEntry(path);
        if ("ok" in again) return again;
        if (entryToken(again.stats) !== (item.expected ?? entryToken(item.entry.stats))) return {ok: false, code: "source-changed", detail: `${path} 已被替换或移走`};
        return again;
    };

    const locked = async <T>(trees: ReadonlyArray<string | null>, run: () => Promise<T>): Promise<T | RootedFailure> => {
        const keys = trees.filter((tree): tree is string => tree !== null);
        if (keys.length === 0) return run();
        const lock = await root.lockTrees(keys);
        if (!lock.ok) return lock;
        try {
            return await run();
        } finally {
            await lock.release();
        }
    };

    /** 收集清单结果：改成的进事件与回声，改不成的进 `manifests`。 */
    const settleManifests = (writes: ReadonlyArray<ManifestWrite>, events: OperationEvent[], written: Array<{readonly path: string; readonly bytes: Uint8Array}>): ManifestIssue[] => {
        const issues: ManifestIssue[] = [];
        for (const write of writes) {
            if (write.kind === "written") {
                events.push({type: "changed", path: write.path});
                written.push({path: write.path, bytes: write.bytes});
            } else if (write.kind === "issue") issues.push({...write.issue, detail: clip(write.issue.detail)});
        }
        return issues;
    };

    /** 源条目（含展示名与嵌套条目）：复制与跨内容树移动时带到目标。 */
    const sourceItem = async (place: TreePlace): Promise<ItemNode | null> => {
        const read = await root.read(manifestOf(place.root), MANIFEST_MAX_BYTES);
        if (!("bytes" in read)) return null;
        const text = decodeText(read.bytes);
        return text === null ? null : itemAt(text, place.level, place.name);
    };

    const move = async (item: Extract<Prepared, {kind: "ready"}>, input: TransferItem, source: ChangeSource): Promise<ItemResult> => {
        const slot = await root.resolveSlot(input.target);
        if ("ok" in slot) return failedItem(slot, "files.move.failed");
        // 同目标移动无操作（docs/specs/workspace/files.md 的“批量预处理”）。
        if (slot.absolute === item.entry.absolute) return {status: "done"};
        const from = placeOf(item.entry.path);
        const to = placeOf(slot.path);
        const outcome = await locked([from?.root ?? null, to?.root ?? null], async () => {
            const current = await recheck(item, input.source);
            if ("ok" in current) return current;
            const moved = moveEntry(current, slot);
            if (!moved.ok) return moved;
            const writes: ManifestWrite[] = [];
            let carried: ItemNode | null = null;
            if (from !== null && listable(from)) {
                const removed = await editManifest(root, changes, from.root, {kind: "remove", level: from.level, name: from.name});
                writes.push(removed);
                if (removed.kind !== "issue") carried = removed.removed ?? null;
            }
            if (to !== null && listable(to)) {
                const node = carried === null ? plainItem(to.name) : renamedItem(carried, to.name);
                writes.push(await editManifest(root, changes, to.root, {kind: "insert", level: to.level, item: node}));
            }
            return {ok: true as const, writes, directory: current.stats.isDirectory()};
        });
        if (!outcome.ok) return failedItem(outcome, "files.move.failed");
        const events: OperationEvent[] = [{type: "renamed", path: slot.path, from: item.entry.path}];
        const written: Array<{readonly path: string; readonly bytes: Uint8Array}> = [];
        const issues = settleManifests(outcome.writes, events, written);
        await changes.operated({events, written, absent: [item.entry.path], present: [slot.path], moved: outcome.directory ? [slot.path] : []}, source);
        return issues.length === 0 ? {status: "done"} : {status: "done", manifests: issues};
    };

    const copy = async (item: Extract<Prepared, {kind: "ready"}>, input: TransferItem, source: ChangeSource): Promise<ItemResult> => {
        const slot = await root.resolveSlot(input.target);
        if ("ok" in slot) return failedItem(slot, "files.copy.failed");
        const current = await recheck(item, input.source);
        if ("ok" in current) return failedItem(current, "files.copy.failed");
        const from = placeOf(current.path);
        const carried = from !== null && listable(from) ? await sourceItem(from) : null;
        const created: string[] = [];
        const copied = await copyEntry(current, slot, {temporaryPath: changes.temporaryPath, created: (_absolute, path) => created.push(path)});
        const events: OperationEvent[] = [];
        const written: Array<{readonly path: string; readonly bytes: Uint8Array}> = [];
        let issues: ManifestIssue[] = [];
        if (copied.ok) {
            const to = placeOf(slot.path);
            if (to !== null && listable(to)) {
                const node = carried === null ? plainItem(to.name) : renamedItem(carried, to.name);
                const write = await locked([to.root], () => editManifest(root, changes, to.root, {kind: "insert", level: to.level, item: node}));
                issues = "ok" in write ? [{path: manifestOf(to.root), status: "failed", detail: clip(write.detail)}] : settleManifests([write], events, written);
            }
        }
        if (created.length > 0 || copied.ok) events.unshift({type: "created", path: slot.path});
        await changes.operated({events, written, present: created}, source);
        if (!copied.ok) return failedItem(copied, "files.copy.failed");
        return issues.length === 0 ? {status: "done"} : {status: "done", manifests: issues};
    };

    const remove = async (item: Extract<Prepared, {kind: "ready"}>, input: DeleteItem, source: ChangeSource): Promise<ItemResult> => {
        const from = placeOf(item.entry.path);
        const outcome = await locked([from?.root ?? null], async () => {
            const current = await recheck(item, input.path);
            if ("ok" in current) return {deleted: current, writes: [] as ManifestWrite[]};
            const deleted = await deleteEntry(current);
            // 目录还在（部分删除）时清单条目保留。
            const writes = deleted.ok && from !== null && listable(from) ? [await editManifest(root, changes, from.root, {kind: "remove", level: from.level, name: from.name})] : [];
            return {deleted, writes};
        });
        if ("ok" in outcome) return failedItem(outcome, "files.delete.failed");
        const events: OperationEvent[] = [];
        const written: Array<{readonly path: string; readonly bytes: Uint8Array}> = [];
        const removed = outcome.deleted.ok ? [item.entry.path] : ((outcome.deleted as EntryFailure).partial?.removed ?? []);
        for (const path of removed) events.push({type: "deleted", path});
        const issues = settleManifests(outcome.writes, events, written);
        const change: OperationChange = {events, written, absent: removed};
        await changes.operated(change, source);
        if (!outcome.deleted.ok) return failedItem(outcome.deleted, "files.delete.failed");
        return issues.length === 0 ? {status: "done"} : {status: "done", manifests: issues};
    };

    return {
        transfer: async (kind, items, source, control) => {
            if (encodedBytes(items) > TEXT_BUDGET_BYTES) return {ok: false, code: "too-large", detail: {detail: "批量的地址太长，超过一次请求的上限"}};
            const prepared = await prepare(items.map((item) => ({path: item.source, ...(item.expected === undefined ? {} : {expected: item.expected})})));
            const results = await execute(prepared, items, control, (item, input) => (kind === "move" ? move(item, input, source) : copy(item, input, source)));
            return {ok: true, value: {items: fit(results)}};
        },
        remove: async (items, source, control) => {
            if (encodedBytes(items) > TEXT_BUDGET_BYTES) return {ok: false, code: "too-large", detail: {detail: "批量的地址太长，超过一次请求的上限"}};
            const prepared = await prepare(items);
            const results = await execute(prepared, items, control, (item, input) => remove(item, input, source));
            return {ok: true, value: {items: fit(results)}};
        },
    };
}

function clip(detail: string): string {
    return detail.length <= MAX_DETAIL ? detail : `${detail.slice(0, MAX_DETAIL - 1)}…`;
}

/** 结果编码后超过预算：清空范围里的路径、标 `truncated`，调用方重新列出核对。说明已截短，项数有上限，这样一定装得下。 */
export function fit(results: ItemResult[]): ItemResult[] {
    if (encodedBytes(results) <= TEXT_BUDGET_BYTES) return results;
    return results.map((result) => {
        if (result.status !== "failed" || result.partial === undefined) return result;
        const {removed, residual} = result.partial;
        return {...result, partial: {
            ...(removed === undefined ? {} : {removed: {paths: [], truncated: true}}),
            ...(residual === undefined ? {} : {residual: {paths: [], truncated: true}}),
        }};
    });
}

