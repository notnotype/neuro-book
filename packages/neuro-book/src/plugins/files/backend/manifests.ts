/**
 * 内容树里的清单维护（docs/specs/workspace/folder-kinds.md 的“经文件服务的操作同步清单”“清单编辑”）：目录项在哪个
 * 内容树、哪一层，读源条目，在 `content.xml` 的加锁替换里改清单。修改本身是 `manifest-edit.ts` 的纯函数。
 */

import type {ManifestIssue} from "../shared/contracts";
import type {ChangeHub} from "./changes";
import {decodeText} from "./files-service";
import {BODY_NAME, folderKindOf, MANIFEST_NAME, parseManifest} from "./folder-kinds";
import {applyEdit, itemAt} from "./manifest-edit";
import type {Edit, ItemNode, Level} from "./manifest-edit";
import type {RootedFailure, RootedRoot} from "./rooted";

/** 清单文件的读取上限。 */
const MANIFEST_MAX_BYTES = 1024 * 1024;

/** 一个目录项在内容树里的位置：所属内容根、它所在的那一层与它的名字。 */
export interface TreePlace {
    readonly root: string;
    readonly level: Level;
    readonly name: string;
}

/** 目录项所在的内容树（最近的 `*.content` 祖先）；不在内容树里为 `null`。路径是相对根的真实路径。 */
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

/** 进清单的位置：不在内容树里或不进清单时为 `null`。 */
export function listedPlace(path: string): TreePlace | null {
    const place = placeOf(path);
    return place !== null && listable(place) ? place : null;
}

export function manifestOf(tree: string): string {
    return `${tree}/${MANIFEST_NAME}`;
}

/**
 * 改清单的结果：改了；不必改（没有清单、或修改的对象不在清单里）；改不成（部分完成）。改不成时 `failure` 是底层的
 * 失败（锁、权限、I/O），清单不合法时为 `null`。
 */
export type ManifestWrite =
    | {readonly kind: "written"; readonly path: string; readonly removed?: ItemNode}
    | {readonly kind: "untouched"; readonly reason: "no-manifest" | "absent" | "unchanged"; readonly detail: string}
    | {readonly kind: "issue"; readonly issue: ManifestIssue; readonly failure: RootedFailure | null};

export interface ManifestContext {
    readonly root: RootedRoot;
    readonly changes: ChangeHub;
    readonly diagnose: (event: string, detail: string, cause: string) => void;
}

/**
 * 在 `content.xml` 的加锁替换里改清单（与文件服务的保存同一把文件锁），写成后立即登记回声。清单不存在时不建；不合法、
 * 不可写时不改，返回部分完成的说明，底层失败的原文进诊断。
 */
export async function editManifest(context: ManifestContext, tree: string, edit: Edit): Promise<ManifestWrite> {
    const {root, changes} = context;
    const path = manifestOf(tree);
    let removed: ItemNode | undefined;
    let untouched: {readonly reason: "absent" | "unchanged"; readonly detail: string} | null = null;
    let invalid: string | null = null;
    const replaced = await root.replace<"done">(path, (current) => {
        removed = undefined;
        untouched = null;
        invalid = null;
        if (current === null) {
            untouched = {reason: "absent", detail: `${path} 不存在`};
            return {done: "done"};
        }
        const text = decodeText(current.bytes);
        if (text === null) {
            invalid = `${path} 不是 UTF-8 文本`;
            return {done: "done"};
        }
        const outcome = applyEdit(text, edit);
        switch (outcome.status) {
            case "changed":
                removed = outcome.removed;
                return {write: outcome.text};
            case "unchanged":
                untouched = {reason: "unchanged", detail: `${path} 本来就是这样`};
                return {done: "done"};
            case "invalid":
                invalid = `${path}：${outcome.detail}`;
                return {done: "done"};
            case "absent":
                untouched = {reason: "absent", detail: outcome.detail};
                return {done: "done"};
        }
    }, changes.temporaryPath);
    if (!replaced.ok) {
        if (replaced.code === "not-found") return {kind: "untouched", reason: "no-manifest", detail: `${path} 不存在`};
        if (replaced.code === "not-a-file") return {kind: "issue", issue: {path, status: "invalid", detail: `${path} 不是普通文件`}, failure: null};
        if (replaced.cause !== undefined) context.diagnose("files.manifest.write-failed", replaced.detail, replaced.cause);
        return {kind: "issue", issue: {path, status: "failed", detail: replaced.detail}, failure: replaced};
    }
    if ("written" in replaced) {
        const bytes = typeof replaced.written === "string" ? new TextEncoder().encode(replaced.written) : replaced.written;
        await changes.expect({written: [{path, bytes}]});
        return removed === undefined ? {kind: "written", path} : {kind: "written", path, removed};
    }
    if (invalid !== null) return {kind: "issue", issue: {path, status: "invalid", detail: invalid}, failure: null};
    const settled = untouched as {readonly reason: "absent" | "unchanged"; readonly detail: string} | null;
    return {kind: "untouched", reason: settled?.reason ?? "unchanged", detail: settled?.detail ?? ""};
}

/** 读源条目（含展示名与嵌套条目）：复制与移动时带到目标。只读，与源清单能否写入无关；读不到时为 `null`。 */
export async function captureItem(root: RootedRoot, place: TreePlace): Promise<ItemNode | null> {
    const read = await root.read(manifestOf(place.root), MANIFEST_MAX_BYTES);
    if (!("bytes" in read)) return null;
    const text = decodeText(read.bytes);
    return text === null || !parseManifest(text).ok ? null : itemAt(text, place.level, place.name);
}
