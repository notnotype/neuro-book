/**
 * 提交一项文件操作（docs/specs/workspace/files.md 的“文件操作”，folder-kinds.md 的“操作锁”）：单项方法与批量的每一项
 * 都经这里，锁、身份复核、清单维护、回声与事件只有这一份做法。
 *
 * 一项的顺序：需要时取根的操作锁 → 在锁内重新解析源与目标（等锁期间可能变了）、核对源的身份 → 读源条目（与源清单能否
 * 写入无关）→ 核对锁仍在 → 提交文件 → 紧接着登记回声 → 改清单 → 在锁内发出精确事件。文件先改、清单后改：清单没改成
 * 时文件操作不回滚，结果带 `manifests`。
 *
 * 取锁的条件：源或目标在内容树里，或者移动的是目录（可能连带其中的内容根，树里的操作要等它）。复制只在读源条目与最后
 * 改目标清单时持锁，复制过程本身不持锁：大目录的复制不挡住其它操作。
 */

import type {ChangeSource, ManifestIssue} from "../shared/contracts";
import type {ChangeHub, OperationEvent} from "./changes";
import {copyEntry, deleteEntry, moveEntry} from "./entry-ops";
import type {EntryFailure} from "./entry-ops";
import {plainItem, renamedItem} from "./manifest-edit";
import type {ItemNode} from "./manifest-edit";
import {captureItem, editManifest, listedPlace, manifestOf, placeOf} from "./manifests";
import type {ManifestContext, ManifestWrite} from "./manifests";
import {entryToken} from "./rooted";
import type {ResolvedEntry, ResolvedSlot, RootedFailure, RootedRoot} from "./rooted";

/** 一项的结果：清单没改成的说明在两种结果里都可能有（文件已改、清单失败是部分完成）。 */
export type ItemOutcome = {readonly ok: true; readonly manifests: ReadonlyArray<ManifestIssue>} | {readonly ok: false; readonly failure: EntryFailure; readonly manifests: ReadonlyArray<ManifestIssue>};

export interface Committer {
    /** 需要时在根的操作锁里执行 `run`；`run` 在提交前调用 `held()`，锁失效时得到失败。 */
    locked<T>(needed: boolean, run: (held: () => Promise<RootedFailure | null>) => Promise<T>): Promise<T | RootedFailure>;
    /** 重新解析源并核对身份：与 `expected` 令牌比，缺省时与 `first`（预处理时的解析）比。 */
    source(path: string, first: ResolvedEntry, expected: string | undefined): Promise<ResolvedEntry | RootedFailure>;
    /**
     * 在锁内重新解析目标：等锁期间父目录可能被换掉（例如换成指向根外的链接），提交必须用这次的解析（包含与控制目录的
     * 检查都重做一遍）。清单位置也按这次的真实路径算。
     */
    target(path: string): Promise<ResolvedSlot | RootedFailure>;
    /** 改清单并收集结果；改成的清单记为 `changed` 事件。 */
    manifest(tree: string, edit: Parameters<typeof editManifest>[2], events: OperationEvent[], issues: ManifestIssue[]): Promise<ManifestWrite>;
    move(input: {readonly source: string; readonly target: string; readonly expected?: string}, first: ResolvedEntry, origin: ChangeSource): Promise<ItemOutcome>;
    copy(input: {readonly source: string; readonly target: string; readonly expected?: string}, first: ResolvedEntry, origin: ChangeSource): Promise<ItemOutcome>;
    remove(input: {readonly path: string; readonly expected?: string}, first: ResolvedEntry, origin: ChangeSource): Promise<ItemOutcome>;
}

export function createCommitter(context: ManifestContext): Committer {
    const {root, changes} = context;

    const locked = async <T>(needed: boolean, run: (held: () => Promise<RootedFailure | null>) => Promise<T>): Promise<T | RootedFailure> => {
        if (!needed) return run(() => Promise.resolve(null));
        const acquired = await root.lockOperations();
        if (!acquired.ok) return acquired;
        const held = async (): Promise<RootedFailure | null> => {
            const lost = await acquired.lock.stillHeld();
            return lost === null ? null : {ok: false, code: "busy", detail: `操作锁在等待期间失效，没有提交：${lost}`};
        };
        try {
            return await run(held);
        } finally {
            await acquired.lock.release();
        }
    };

    const source = async (path: string, first: ResolvedEntry, expected: string | undefined): Promise<ResolvedEntry | RootedFailure> => {
        const again = await root.resolveEntry(path);
        if ("ok" in again) {
            // 冻结过的源不在了也是“身份变了”：调用方要知道旧意图失效，而不是这个地址不存在。
            return expected !== undefined && again.code === "not-found" ? sourceChanged(path) : again;
        }
        return entryToken(again.stats) === (expected ?? entryToken(first.stats)) ? again : sourceChanged(path);
    };

    const target = (path: string): Promise<ResolvedSlot | RootedFailure> => root.resolveSlot(path);

    const manifest = async (tree: string, edit: Parameters<typeof editManifest>[2], events: OperationEvent[], issues: ManifestIssue[]): Promise<ManifestWrite> => {
        const write = await editManifest(context, tree, edit);
        if (write.kind === "written") events.push({type: "changed", path: write.path});
        else if (write.kind === "issue") issues.push(write.issue);
        return write;
    };

    const failed = (failure: EntryFailure, issues: ReadonlyArray<ManifestIssue> = []): ItemOutcome => ({ok: false, failure, manifests: issues});

    return {
        locked,
        source,
        target,
        manifest,

        move: async (input, first, origin) => {
            const slot = await root.resolveSlot(input.target);
            if ("ok" in slot) return failed(slot);
            const needed = placeOf(first.path) !== null || placeOf(slot.path) !== null || first.stats.isDirectory();
            const outcome = await locked(needed, async (held): Promise<ItemOutcome> => {
                const entry = await source(input.source, first, input.expected);
                if ("ok" in entry) return failed(entry);
                const fresh = await target(input.target);
                if ("ok" in fresh) return failed(fresh);
                // 同目标移动无操作（身份已核对过）。
                if (fresh.absolute === entry.absolute) return {ok: true, manifests: []};
                const from = listedPlace(entry.path);
                const to = listedPlace(fresh.path);
                const carried = from !== null && to !== null ? await captureItem(root, from) : null;
                const lost = await held();
                if (lost !== null) return failed(lost);
                const moved = moveEntry(entry, fresh);
                if (!moved.ok) return failed(moved);
                await changes.expect({absent: [entry.path], present: [fresh.path], moved: entry.stats.isDirectory() ? [fresh.path] : []});
                const events: OperationEvent[] = [{type: "renamed", path: fresh.path, from: entry.path}];
                const issues: ManifestIssue[] = [];
                if (from !== null && to !== null && from.root === to.root && from.level.join("/") === to.level.join("/")) {
                    await manifest(from.root, {kind: "rename", level: from.level, from: from.name, to: to.name}, events, issues);
                } else {
                    if (from !== null) await manifest(from.root, {kind: "remove", level: from.level, name: from.name}, events, issues);
                    if (to !== null) await manifest(to.root, {kind: "insert", level: to.level, item: carry(carried, to.name)}, events, issues);
                }
                changes.emit(events, origin);
                return {ok: true, manifests: issues};
            });
            return "manifests" in outcome ? outcome : failed(outcome);
        },

        copy: async (input, first, origin) => {
            const slot = await root.resolveSlot(input.target);
            if ("ok" in slot) return failed(slot);
            const from = listedPlace(first.path);
            const captured = await locked(from !== null, async () => {
                const entry = await source(input.source, first, input.expected);
                if ("ok" in entry) return entry;
                const item = from === null ? null : await captureItem(root, from);
                return {entry, item};
            });
            if ("ok" in captured) return failed(captured);
            const fresh = await target(input.target);
            if ("ok" in fresh) return failed(fresh);
            let created = false;
            const copied = await copyEntry(captured.entry, fresh, {temporaryPath: changes.temporaryPath, created: async (path) => {
                created = true;
                await changes.expect({present: [path]});
            }});
            const to = listedPlace(fresh.path);
            const events: OperationEvent[] = created ? [{type: "created", path: fresh.path}] : [];
            const issues: ManifestIssue[] = [];
            const settled = await locked(copied.ok && to !== null, async () => {
                if (copied.ok && to !== null) await manifest(to.root, {kind: "insert", level: to.level, item: carry(captured.item, to.name)}, events, issues);
                changes.emit(events, origin);
                return null;
            });
            if (settled !== null && to !== null) {
                // 等不到锁：副本已在，清单没改成；事件照样发出。
                issues.push({path: manifestOf(to.root), status: "failed", detail: settled.detail});
                changes.emit(events, origin);
            }
            return copied.ok ? {ok: true, manifests: issues} : failed(copied, issues);
        },

        remove: async (input, first, origin) => {
            const from = listedPlace(first.path);
            // 删除只为清单条目的先后取锁：与树里的其它操作交错时，删掉的东西无论先后都不在了。
            const outcome = await locked(from !== null, async (held): Promise<ItemOutcome> => {
                const entry = await source(input.path, first, input.expected);
                if ("ok" in entry) return failed(entry);
                const lost = await held();
                if (lost !== null) return failed(lost);
                const deleted = await deleteEntry(entry, (path) => changes.expect({absent: [path]}));
                const removed = deleted.ok ? [entry.path] : (deleted.partial?.removed ?? []);
                const events: OperationEvent[] = removed.map((path) => ({type: "deleted", path}));
                const issues: ManifestIssue[] = [];
                // 目录还在（部分删除）时清单条目保留。
                if (deleted.ok && from !== null) await manifest(from.root, {kind: "remove", level: from.level, name: from.name}, events, issues);
                changes.emit(events, origin);
                return deleted.ok ? {ok: true, manifests: issues} : failed(deleted, issues);
            });
            return "manifests" in outcome ? outcome : failed(outcome);
        },
    };
}

/** 带到目标的条目：读到了源条目就换个名字带过去（展示名与嵌套条目不变），否则是只有名字的新条目。 */
function carry(item: ItemNode | null, name: string): ItemNode {
    return item === null ? plainItem(name) : renamedItem(item, name);
}

function sourceChanged(path: string): RootedFailure {
    return {ok: false, code: "source-changed", detail: `${path} 已被替换或移走`};
}
