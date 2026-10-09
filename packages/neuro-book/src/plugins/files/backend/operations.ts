/**
 * 一个方案根上的单项文件操作（docs/specs/workspace/files.md 的“文件操作”、folder-kinds.md 的“清单编辑”“转换”）。
 * 改名与批量的移动是同一种提交，经 `commit.ts`；这里另有新建、创建内容、转换与只改清单的操作，锁、身份复核、清单与回声
 * 的做法与 `commit.ts` 相同。
 *
 * 路径一律用相对根的真实路径：内容树、清单与回声登记都按磁盘上的实际位置判定，经链接别名发起的操作也落到同一处。
 */

import {lstat, open, readdir} from "node:fs/promises";
import {join} from "node:path";

import type {ChangeSource, Identified, ManifestIssue, OperationDone} from "../shared/contracts";
import type {OperationEvent} from "./changes";
import {createCommitter} from "./commit";
import type {ItemOutcome} from "./commit";
import {createDirectory, createFile, moveEntry} from "./entry-ops";
import type {Outcome, ProviderFailureCode} from "./files-service";
import {BODY_NAME, compareEntries, folderKindOf, MANIFEST_NAME} from "./folder-kinds";
import {generateManifest, plainItem} from "./manifest-edit";
import type {Edit, Level} from "./manifest-edit";
import {listedPlace, manifestOf, placeOf} from "./manifests";
import type {ManifestContext} from "./manifests";
import {entryToken} from "./rooted";
import type {RootedFailure} from "./rooted";

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

export function createOperations(context: ManifestContext): Operations {
    const {root, changes} = context;
    const commit = createCommitter(context);

    const failed = (failure: RootedFailure, event: string): Outcome<never> => {
        if (failure.cause !== undefined) context.diagnose(event, failure.detail, failure.cause);
        return {ok: false, code: failure.code as ProviderFailureCode, detail: {detail: failure.detail}};
    };
    const rejected = (code: ProviderFailureCode, detail: string): Outcome<never> => ({ok: false, code, detail: {detail}});
    const done = (issues: ReadonlyArray<ManifestIssue>): Outcome<OperationDone> => ({ok: true, value: issues.length === 0 ? {} : {manifests: [...issues]}});
    const settled = (outcome: ItemOutcome, event: string): Outcome<OperationDone> => (outcome.ok ? done(outcome.manifests) : failed(outcome.failure, event));

    /**
     * 只改清单的操作：清单不存在、不合法、条目不对都是这次操作本身的失败；写不进时报底层的失败码（锁、权限、I/O）。
     */
    const manifestOnly = async (tree: string, edit: Edit, source: ChangeSource): Promise<Outcome<OperationDone>> => {
        const events: OperationEvent[] = [];
        const result = await commit.locked(true, async () => {
            const write = await commit.manifest(tree, edit, events, []);
            changes.emit(events, source);
            return write;
        });
        if ("ok" in result) return failed(result, "files.manifest.lock-failed");
        switch (result.kind) {
            case "issue":
                // 底层失败的原文已由 editManifest 记入诊断。
                return result.failure === null ? rejected("unsupported", `清单不合法，先修复：${result.issue.detail}`) : rejected(result.failure.code as ProviderFailureCode, result.failure.detail);
            case "untouched":
                if (result.reason === "no-manifest") return rejected("not-found", result.detail);
                if (result.reason === "absent") return rejected("invalid-order", result.detail);
                return done([]);
            case "written":
                return done([]);
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
            const result = await commit.locked(placeOf(slot.path) !== null, async (held): Promise<ItemOutcome> => {
                const fresh = await commit.target(input.path);
                if ("ok" in fresh) return {ok: false, failure: fresh, manifests: []};
                const lost = await held();
                if (lost !== null) return {ok: false, failure: lost, manifests: []};
                const made = input.kind === "file" ? await createFile(fresh) : await createDirectory(fresh);
                if (!made.ok) return {ok: false, failure: made, manifests: []};
                await changes.expect({present: [fresh.path]});
                const events: OperationEvent[] = [{type: "created", path: fresh.path}];
                const issues: ManifestIssue[] = [];
                const place = listedPlace(fresh.path);
                if (place !== null) await commit.manifest(place.root, {kind: "insert", level: place.level, item: plainItem(place.name), ...(input.before === undefined ? {} : {before: input.before})}, events, issues);
                changes.emit(events, source);
                return {ok: true, manifests: issues};
            });
            return "manifests" in result ? settled(result, "files.create.failed") : failed(result, "files.create.failed");
        },

        createContent: async (input, source) => {
            const entry = await root.resolveEntry(input.path);
            if ("ok" in entry) return failed(entry, "files.create-content.failed");
            if (!entry.stats.isDirectory()) return rejected("not-a-directory", `${input.path} 不是目录`);
            const place = placeOf(`${entry.path}/${BODY_NAME}`);
            if (place === null || place.level.length === 0) return rejected("unsupported", `${input.path} 不是内容文件夹里的节点目录`);
            // 正文不进清单，不必取操作锁。
            const slot = await root.resolveSlot(`${entry.path}/${BODY_NAME}`);
            if ("ok" in slot) return failed(slot, "files.create-content.failed");
            const made = await createFile(slot);
            if (!made.ok) return failed(made, "files.create-content.failed");
            await changes.expect({present: [slot.path]});
            changes.emit([{type: "created", path: slot.path}], source);
            return done([]);
        },

        rename: async (input, source) => {
            if (input.name.includes("/")) return rejected("invalid-address", `${JSON.stringify(input.name)} 不是单个名字`);
            const entry = await root.resolveEntry(input.path);
            if ("ok" in entry) return failed(input.expected !== undefined && entry.code === "not-found" ? {ok: false, code: "source-changed", detail: `${input.path} 已被替换或移走`} : entry, "files.rename.failed");
            const target = entry.parent.realPath === "" ? input.name : `${entry.parent.realPath}/${input.name}`;
            const moved = await commit.move({source: entry.path, target, ...(input.expected === undefined ? {} : {expected: input.expected})}, entry, source);
            return settled(moved, "files.rename.failed");
        },

        convert: async (input, source) => {
            const entry = await root.resolveEntry(input.path);
            if ("ok" in entry) return failed(entry, "files.convert.failed");
            if (!entry.stats.isDirectory()) return rejected("not-a-directory", `${input.path} 不是目录`);
            const isContent = folderKindOf(entry.name) === "content";
            if ((input.to === "content") === isContent) return rejected("unsupported", `${input.path} 已经是${isContent ? "内容" : "普通"}文件夹`);
            const name = input.to === "content" ? `${entry.name}.content` : entry.name.slice(0, -".content".length);
            if (name === "") return rejected("invalid-address", `${input.path} 去掉后缀后没有名字`);
            const targetPath = entry.parent.realPath === "" ? name : `${entry.parent.realPath}/${name}`;
            const slot = await root.resolveSlot(targetPath);
            if ("ok" in slot) return failed(slot, "files.convert.failed");
            const result = await commit.locked(true, async (held): Promise<ItemOutcome> => {
                const current = await commit.source(entry.path, entry, input.expected);
                if ("ok" in current) return {ok: false, failure: current, manifests: []};
                const fresh = await commit.target(targetPath);
                if ("ok" in fresh) return {ok: false, failure: fresh, manifests: []};
                const lost = await held();
                if (lost !== null) return {ok: false, failure: lost, manifests: []};
                const moved = moveEntry(current, fresh);
                if (!moved.ok) return {ok: false, failure: moved, manifests: []};
                await changes.expect({absent: [current.path], present: [fresh.path], moved: [fresh.path]});
                const events: OperationEvent[] = [{type: "renamed", path: fresh.path, from: current.path}];
                const issues: ManifestIssue[] = [];
                const place = listedPlace(current.path);
                if (place !== null) await commit.manifest(place.root, {kind: "rename", level: place.level, from: place.name, to: name}, events, issues);
                if (input.to === "content") {
                    const generated = await generateFor(fresh.path, fresh.absolute);
                    if (generated.kind === "issue") issues.push(generated.issue);
                    if (generated.kind === "created") events.push({type: "created", path: generated.path});
                }
                changes.emit(events, source);
                return {ok: true, manifests: issues};
            });
            return "manifests" in result ? settled(result, "files.convert.failed") : failed(result, "files.convert.failed");
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
            if (listedPlace(entry.path) === null) return rejected("invalid-order", `${input.path} 是正文或清单本身，不进清单`);
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
    async function generateFor(tree: string, absolute: string): Promise<{readonly kind: "created"; readonly path: string} | {readonly kind: "issue"; readonly issue: ManifestIssue} | {readonly kind: "kept"}> {
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
            await changes.expect({written: [{path, bytes}]});
            return {kind: "created", path};
        } catch (error) {
            context.diagnose("files.convert.manifest-failed", `无法生成 ${path}`, error instanceof Error ? error.message : String(error));
            return {kind: "issue", issue: {path, status: "failed", detail: `无法生成 ${path}`}};
        }
    }
}
