/**
 * 一个方案根上的文件操作（docs/specs/workspace/files.md 的“文件操作”、folder-kinds.md 的“经文件服务的操作同步清单”
 * “清单编辑”“操作锁”）：落盘经 `entry-ops.ts`，清单经 `manifest-edit.ts`，事件与回声经 `changes.ts`。
 *
 * 一次涉及内容树的操作按这个顺序做：解析源与目标 → 取所在内容根的操作锁 → 重新解析并核对源还是同一个目录项（与
 * `expected` 令牌或第一次解析的身份）→ 提交文件 → 改清单 → 释放锁 → 登记回声并发出事件。文件先改、清单后改：清单没改成
 * 时文件操作不回滚，结果带 `manifests`。
 *
 * 路径一律用相对根的真实路径：内容树、清单与回声登记都按磁盘上的实际位置判定，经链接别名发起的操作也落到同一处。
 */

import {lstat, open, readdir} from "node:fs/promises";
import {join} from "node:path";

import type {ChangeSource, Identified, ManifestIssue, OperationDone} from "../shared/contracts";
import type {ChangeHub, OperationChange, OperationEvent} from "./changes";
import {createDirectory, createFile, moveEntry} from "./entry-ops";
import type {Outcome, ProviderFailureCode} from "./files-service";
import {decodeText} from "./files-service";
import {BODY_NAME, compareEntries, folderKindOf, MANIFEST_NAME} from "./folder-kinds";
import {applyEdit, generateManifest, plainItem} from "./manifest-edit";
import type {Edit, ItemNode, Level} from "./manifest-edit";
import {entryToken} from "./rooted";
import type {ResolvedEntry, RootedFailure, RootedRoot} from "./rooted";

export interface OperationsOptions {
    readonly root: RootedRoot;
    readonly changes: ChangeHub;
    /** 失败的操作系统原文（含绝对路径）只进诊断。 */
    readonly diagnose: (event: string, detail: string, cause: string) => void;
}

export interface Operations {
    identify(paths: ReadonlyArray<string>): Promise<Outcome<Identified>>;
    create(input: {readonly path: string; readonly kind: "file" | "directory"; readonly before?: string}, source: ChangeSource): Promise<Outcome<OperationDone>>;
    createContent(input: {readonly path: string}, source: ChangeSource): Promise<Outcome<OperationDone>>;
    rename(input: {readonly path: string; readonly name: string; readonly expected?: string}, source: ChangeSource): Promise<Outcome<OperationDone>>;
    convert(input: {readonly path: string; readonly to: "content" | "plain"; readonly expected?: string}, source: ChangeSource): Promise<Outcome<OperationDone>>;
    reorder(input: {readonly directory: string; readonly names: ReadonlyArray<string>}, source: ChangeSource): Promise<Outcome<OperationDone>>;
    display(input: {readonly path: string; readonly title?: string | null; readonly icon?: string | null}, source: ChangeSource): Promise<Outcome<OperationDone>>;
    include(input: {readonly path: string; readonly before?: string}, source: ChangeSource): Promise<Outcome<OperationDone>>;
    drop(input: {readonly path: string}, source: ChangeSource): Promise<Outcome<OperationDone>>;
}

/** 一个目录项在内容树里的位置：所属内容根、它所在的那一层与它的名字。 */
export interface TreePlace {
    readonly root: string;
    readonly level: Level;
    readonly name: string;
}

/** 目录项所在的内容树（最近的 `*.content` 祖先）；不在内容树里为 `null`。 */
export function placeOf(path: string): TreePlace | null {
    const segments = path.split("/");
    for (let at = segments.length - 2; at >= 0; at -= 1) {
        if (folderKindOf(segments[at] as string) === "content") return {root: segments.slice(0, at + 1).join("/"), level: segments.slice(at + 1, -1), name: segments[segments.length - 1] as string};
    }
    return null;
}

/** 这个目录项是否进清单：内容根上的 `content.xml` 与节点自己的 `index.md` 不进。 */
export function listable(place: TreePlace): boolean {
    return place.level.length === 0 ? place.name !== MANIFEST_NAME : place.name !== BODY_NAME;
}

export function manifestOf(tree: string): string {
    return `${tree}/${MANIFEST_NAME}`;
}

/** 改清单的结果：改了（字节用于回声登记）、不必改（没有清单或条目本来就对）、改不成（部分完成）。 */
export type ManifestWrite =
    | {readonly kind: "written"; readonly path: string; readonly bytes: Uint8Array; readonly removed?: ItemNode}
    | {readonly kind: "untouched"; readonly removed?: ItemNode; readonly reason?: "no-manifest" | "absent"; readonly detail?: string}
    | {readonly kind: "issue"; readonly issue: ManifestIssue};

/**
 * 在 `content.xml` 的加锁替换里改清单（与文件服务的保存同一把文件锁）。清单不存在时不建；不合法、不可写时不改，返回
 * 部分完成的说明。
 */
export async function editManifest(root: RootedRoot, changes: ChangeHub, tree: string, edit: Edit): Promise<ManifestWrite> {
    const path = manifestOf(tree);
    let removed: ItemNode | undefined;
    let absent: string | null = null;
    let invalid: string | null = null;
    const replaced = await root.replace<"untouched">(path, (current) => {
        removed = undefined;
        absent = null;
        invalid = null;
        if (current === null) {
            absent = `${path} 不存在`;
            return {done: "untouched"};
        }
        const text = decodeText(current.bytes);
        if (text === null) {
            invalid = `${path} 不是 UTF-8 文本`;
            return {done: "untouched"};
        }
        const outcome = applyEdit(text, edit);
        switch (outcome.status) {
            case "changed":
                removed = outcome.removed;
                return {write: outcome.text};
            case "unchanged":
                removed = outcome.removed;
                return {done: "untouched"};
            case "invalid":
                invalid = `${path}：${outcome.detail}`;
                return {done: "untouched"};
            case "absent":
                absent = outcome.detail;
                return {done: "untouched"};
        }
    }, changes.temporaryPath);
    if (!replaced.ok) {
        // 清单本身不在，或不是普通文件：前者没有清单可改，后者按不合法报告。
        if (replaced.code === "not-found") return {kind: "untouched", reason: "no-manifest", detail: `${path} 不存在`};
        if (replaced.code === "not-a-file") return {kind: "issue", issue: {path, status: "invalid", detail: `${path} 不是普通文件`}};
        return {kind: "issue", issue: {path, status: "failed", detail: replaced.detail}};
    }
    if ("written" in replaced) {
        const bytes = typeof replaced.written === "string" ? new TextEncoder().encode(replaced.written) : replaced.written;
        return removed === undefined ? {kind: "written", path, bytes} : {kind: "written", path, bytes, removed};
    }
    if (invalid !== null) return {kind: "issue", issue: {path, status: "invalid", detail: invalid}};
    if (absent !== null) return {kind: "untouched", reason: "absent", detail: absent};
    return removed === undefined ? {kind: "untouched"} : {kind: "untouched", removed};
}

export function createOperations(options: OperationsOptions): Operations {
    const {root, changes} = options;

    const failed = (failure: RootedFailure, event: string): Outcome<never> => {
        if (failure.cause !== undefined) options.diagnose(event, failure.detail, failure.cause);
        return {ok: false, code: failure.code as ProviderFailureCode, detail: {detail: failure.detail}};
    };
    const rejected = (code: ProviderFailureCode, detail: string): Outcome<never> => ({ok: false, code, detail: {detail}});

    /** 取锁后重新解析源，核对它还是同一个目录项；`expected` 是调用方冻结的令牌，缺省时与第一次解析比。 */
    const recheck = async (path: string, first: ResolvedEntry, expected: string | undefined): Promise<ResolvedEntry | RootedFailure> => {
        const again = await root.resolveEntry(path);
        if ("ok" in again) return again;
        if (entryToken(again.stats) !== (expected ?? entryToken(first.stats))) return {ok: false, code: "source-changed", detail: `${path} 已被替换或移走`};
        return again;
    };

    /** 在内容树的操作锁里执行 `run`；不涉及内容树时不取锁。 */
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

    /** 收集清单的结果：改成的进回声登记与事件，改不成的进 `manifests`。 */
    const settle = (writes: ReadonlyArray<ManifestWrite>, change: {events: OperationEvent[]; written: Array<{readonly path: string; readonly bytes: Uint8Array}>}): OperationDone => {
        const issues: ManifestIssue[] = [];
        for (const write of writes) {
            if (write.kind === "written") {
                change.events.push({type: "changed", path: write.path});
                change.written.push({path: write.path, bytes: write.bytes});
            } else if (write.kind === "issue") issues.push(write.issue);
        }
        return issues.length === 0 ? {} : {manifests: issues};
    };

    /** 只改清单的操作：清单不存在、不合法、条目不对都是这次操作本身的失败。 */
    const manifestOnly = async (tree: string, edit: Edit, source: ChangeSource): Promise<Outcome<OperationDone>> => {
        const result = await locked([tree], () => editManifest(root, changes, tree, edit));
        if ("ok" in result) return failed(result, "files.manifest.lock-failed");
        switch (result.kind) {
            case "issue":
                return result.issue.status === "invalid" ? rejected("unsupported", `清单不合法，先修复：${result.issue.detail}`) : rejected("permission-denied", result.issue.detail);
            case "untouched":
                if (result.reason === "no-manifest") return rejected("not-found", result.detail ?? `${manifestOf(tree)} 不存在`);
                if (result.reason === "absent") return rejected("invalid-order", result.detail ?? "条目不在清单里");
                return {ok: true, value: {}};
            case "written":
                await changes.operated({events: [{type: "changed", path: result.path}], written: [{path: result.path, bytes: result.bytes}]}, source);
                return {ok: true, value: {}};
        }
    };

    /** 目录（真实路径）所在的清单层：目录本身是内容根时为根这一层。 */
    const levelOfDirectory = (directory: string): {readonly tree: string; readonly level: Level} | null => {
        if (directory === "") return null;
        const segments = directory.split("/");
        for (let at = segments.length - 1; at >= 0; at -= 1) {
            if (folderKindOf(segments[at] as string) === "content") return {tree: segments.slice(0, at + 1).join("/"), level: segments.slice(at + 1)};
        }
        return null;
    };

    /** 一个条目的父目录（解析到真实路径）所在的清单层与它的名字；条目本身可以不在磁盘上（缺失条目）。 */
    const itemPlace = async (path: string): Promise<{readonly tree: string; readonly level: Level; readonly name: string} | RootedFailure> => {
        const slot = await root.resolveSlot(path);
        if ("ok" in slot) return slot;
        const place = levelOfDirectory(slot.parent.realPath);
        if (place === null) return {ok: false, code: "unsupported", detail: `${path} 不在内容文件夹里`};
        return {...place, name: slot.name};
    };

    return {
        identify: async (paths) => {
            const items: Identified["items"] = [];
            for (const path of paths) {
                const entry = await root.resolveEntry(path);
                if ("ok" in entry) {
                    items.push({code: entry.code, detail: entry.detail});
                    continue;
                }
                const kind = entry.stats.isFile() ? "file" : entry.stats.isDirectory() ? "directory" : entry.stats.isSymbolicLink() ? "link" : "other";
                items.push({kind, token: entryToken(entry.stats)});
            }
            return {ok: true, value: {items}};
        },

        create: async (input, source) => {
            const slot = await root.resolveSlot(input.path);
            if ("ok" in slot) return failed(slot, "files.create.failed");
            const place = placeOf(slot.path);
            const result = await locked([place?.root ?? null], async () => {
                const made = input.kind === "file" ? await createFile(slot) : await createDirectory(slot);
                if (!made.ok) return made;
                const writes = place !== null && listable(place) ? [await editManifest(root, changes, place.root, {kind: "insert", level: place.level, item: plainItem(place.name), ...(input.before === undefined ? {} : {before: input.before})})] : [];
                return {ok: true as const, writes};
            });
            if (!result.ok) return failed(result, "files.create.failed");
            const change = {events: [{type: "created", path: slot.path}] as OperationEvent[], written: [] as Array<{readonly path: string; readonly bytes: Uint8Array}>};
            const done = settle(result.writes, change);
            await changes.operated({...change, present: [slot.path]}, source);
            return {ok: true, value: done};
        },

        createContent: async (input, source) => {
            const entry = await root.resolveEntry(input.path);
            if ("ok" in entry) return failed(entry, "files.create-content.failed");
            if (!entry.stats.isDirectory()) return rejected("not-a-directory", `${input.path} 不是目录`);
            const place = placeOf(`${entry.path}/${BODY_NAME}`);
            if (place === null || place.level.length === 0) return rejected("unsupported", `${input.path} 不是内容文件夹里的节点目录`);
            const slot = await root.resolveSlot(`${entry.path}/${BODY_NAME}`);
            if ("ok" in slot) return failed(slot, "files.create-content.failed");
            const made = await createFile(slot);
            if (!made.ok) return failed(made, "files.create-content.failed");
            await changes.operated({events: [{type: "created", path: slot.path}], present: [slot.path]}, source);
            return {ok: true, value: {}};
        },

        rename: async (input, source) => {
            const entry = await root.resolveEntry(input.path);
            if ("ok" in entry) return failed(entry, "files.rename.failed");
            const target = entry.parent.realPath === "" ? input.name : `${entry.parent.realPath}/${input.name}`;
            if (input.name.includes("/")) return rejected("invalid-address", `${JSON.stringify(input.name)} 不是单个名字`);
            const slot = await root.resolveSlot(target);
            if ("ok" in slot) return failed(slot, "files.rename.failed");
            const place = placeOf(entry.path);
            const result = await locked([place?.root ?? null], async () => {
                const current = await recheck(input.path, entry, input.expected);
                if ("ok" in current) return current;
                const moved = moveEntry(current, slot);
                if (!moved.ok) return moved;
                const writes = place !== null && listable(place) ? [await editManifest(root, changes, place.root, {kind: "rename", level: place.level, from: place.name, to: input.name})] : [];
                return {ok: true as const, writes, directory: current.stats.isDirectory()};
            });
            if (!result.ok) return failed(result, "files.rename.failed");
            const change = {events: [{type: "renamed", path: slot.path, from: entry.path}] as OperationEvent[], written: [] as Array<{readonly path: string; readonly bytes: Uint8Array}>};
            const done = settle(result.writes, change);
            await changes.operated({...change, absent: [entry.path], present: [slot.path], moved: result.directory ? [slot.path] : []}, source);
            return {ok: true, value: done};
        },

        convert: async (input, source) => {
            const entry = await root.resolveEntry(input.path);
            if ("ok" in entry) return failed(entry, "files.convert.failed");
            if (!entry.stats.isDirectory()) return rejected("not-a-directory", `${input.path} 不是目录`);
            const isContent = folderKindOf(entry.name) === "content";
            if ((input.to === "content") === isContent) return rejected("unsupported", `${input.path} 已经是${isContent ? "内容" : "普通"}文件夹`);
            const name = input.to === "content" ? `${entry.name}.content` : entry.name.slice(0, -".content".length);
            if (name === "") return rejected("invalid-address", `${input.path} 去掉后缀后没有名字`);
            const slot = await root.resolveSlot(entry.parent.realPath === "" ? name : `${entry.parent.realPath}/${name}`);
            if ("ok" in slot) return failed(slot, "files.convert.failed");
            const place = placeOf(entry.path);
            const result = await locked([place?.root ?? null, entry.path, slot.path], async () => {
                const current = await recheck(input.path, entry, input.expected);
                if ("ok" in current) return current;
                const moved = moveEntry(current, slot);
                if (!moved.ok) return moved;
                const writes: ManifestWrite[] = [];
                if (place !== null && listable(place)) writes.push(await editManifest(root, changes, place.root, {kind: "rename", level: place.level, from: place.name, to: name}));
                const generated = input.to === "content" ? await generateFor(slot.path, slot.absolute) : null;
                if (generated?.kind === "issue") writes.push(generated);
                return {ok: true as const, writes, generated: generated?.kind === "created" ? generated : null};
            });
            if (!result.ok) return failed(result, "files.convert.failed");
            const change = {events: [{type: "renamed", path: slot.path, from: entry.path}] as OperationEvent[], written: [] as Array<{readonly path: string; readonly bytes: Uint8Array}>};
            if (result.generated !== null) {
                change.events.push({type: "created", path: result.generated.path});
                change.written.push({path: result.generated.path, bytes: result.generated.bytes});
            }
            const done = settle(result.writes, change);
            await changes.operated({...change, absent: [entry.path], present: [slot.path], moved: [slot.path]}, source);
            return {ok: true, value: done};
        },

        reorder: async (input, source) => {
            const directory = await root.resolve(input.directory);
            if ("ok" in directory) return failed(directory, "files.reorder.failed");
            if (!directory.stats.isDirectory()) return rejected("not-a-directory", `${input.directory} 不是目录`);
            const place = levelOfDirectory(directory.realPath);
            if (place === null) return rejected("unsupported", `${input.directory} 不在内容文件夹里`);
            return manifestOnly(place.tree, {kind: "reorder", level: place.level, names: input.names}, source);
        },

        display: async (input, source) => {
            const place = await itemPlace(input.path);
            if ("ok" in place) return failed(place, "files.display.failed");
            return manifestOnly(place.tree, {kind: "display", level: place.level, name: place.name, ...(input.title === undefined ? {} : {title: input.title}), ...(input.icon === undefined ? {} : {icon: input.icon})}, source);
        },

        include: async (input, source) => {
            const entry = await root.resolveEntry(input.path);
            if ("ok" in entry) return failed(entry, "files.include.failed");
            const place = placeOf(entry.path);
            if (place === null) return rejected("unsupported", `${input.path} 不在内容文件夹里`);
            if (!listable(place)) return rejected("invalid-order", `${input.path} 是正文或清单本身，不进清单`);
            return manifestOnly(place.root, {kind: "insert", level: place.level, item: plainItem(place.name), strict: true, ...(input.before === undefined ? {} : {before: input.before})}, source);
        },

        drop: async (input, source) => {
            const place = await itemPlace(input.path);
            if ("ok" in place) return failed(place, "files.drop.failed");
            return manifestOnly(place.tree, {kind: "remove", level: place.level, name: place.name}, source);
        },
    };

    /**
     * 转为内容文件夹时的清单：没有 `content.xml` 就按现有子项排他新建；已有就原样保留（不论合法与否），见 folder-kinds.md
     * 的“转换”。
     */
    async function generateFor(tree: string, absolute: string): Promise<{readonly kind: "created"; readonly path: string; readonly bytes: Uint8Array} | {readonly kind: "issue"; readonly issue: ManifestIssue} | {readonly kind: "kept"}> {
        const path = manifestOf(tree);
        const existing = await lstat(join(absolute, MANIFEST_NAME)).then(() => true, () => false);
        if (existing) return {kind: "kept"};
        try {
            const entries = (await readdir(absolute, {withFileTypes: true})).filter((entry) => entry.name !== MANIFEST_NAME).map((entry) => ({name: entry.name, kind: entry.isDirectory() ? "directory" : "file"}));
            const bytes = new TextEncoder().encode(generateManifest(entries.sort(compareEntries).map((entry) => entry.name)));
            const handle = await open(join(absolute, MANIFEST_NAME), "wx");
            try {
                await handle.writeFile(bytes);
            } finally {
                await handle.close();
            }
            return {kind: "created", path, bytes};
        } catch (error) {
            options.diagnose("files.convert.manifest-failed", `无法生成 ${path}`, error instanceof Error ? error.message : String(error));
            return {kind: "issue", issue: {path, status: "failed", detail: `无法生成 ${path}`}};
        }
    }
}
