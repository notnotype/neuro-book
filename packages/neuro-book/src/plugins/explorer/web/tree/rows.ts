/**
 * 树的呈现投影（docs/specs/workbench/files-explorer.md 的“文件夹类型呈现”与“内容文件夹的呈现条件”）：把根、目录缓存
 * 与展开集合按深度优先展开成可见行。只用列出结果，不读正文。
 *
 * 一层目录按内容文件夹呈现，条件是它带内容根且清单状态为 `ok`；内容树里的子目录自身的文件夹类型是普通目录，不能只看
 * 类型。清单不是 `ok` 时退回普通目录的呈现，`index.md` 照常成行。
 */

import type {DirectoryEntry, FolderKind, Listing} from "nbook/plugins/files/shared/contracts";
import type {Scheme} from "nbook/plugins/files/shared/contracts";

import {childAddress, resourceOf} from "./address";
import type {DirectorySlot, RootState, RootStatus} from "./model";

export interface RootRow {
    readonly kind: "root";
    readonly id: string;
    readonly depth: 0;
    readonly scheme: Scheme;
    readonly address: string;
    readonly expanded: boolean;
    readonly status: RootStatus;
}

export interface EntryRow {
    readonly kind: "entry";
    readonly id: string;
    readonly depth: number;
    readonly address: string;
    readonly parent: string;
    readonly name: string;
    /** 显示的名字：内容文件夹里取清单的展示名，缺省真实名字。 */
    readonly label: string;
    /** 展示名与真实名字不同时给出真实名字，让路径可辨。 */
    readonly subtitle: string | null;
    readonly icon: string | null;
    readonly type: DirectoryEntry["kind"];
    readonly folder: FolderKind | null;
    /** 这一层按内容文件夹呈现：目录是节点，排序与展示名改清单。 */
    readonly content: boolean;
    /** 内容文件夹里的目录：节点行，打开区打开它的正文。 */
    readonly node: boolean;
    /** 节点有正文（`index.md`）。 */
    readonly body: boolean;
    /** 内容文件夹里是否列在清单中；不在内容文件夹里为 `null`。 */
    readonly listed: boolean | null;
    readonly manifest: boolean;
    /** 活页夹：本应用没有剧情插件，按普通目录显示并提示。 */
    readonly binder: boolean;
    readonly expandable: boolean;
    readonly expanded: boolean;
    /** 打开时的地址：文件本身，或节点的 `index.md`；不能打开为 `null`。 */
    readonly opens: string | null;
    /** 同层的位置（从 1 开始）与同层总数，按完整的同层集合计。 */
    readonly position: number;
    readonly siblings: number;
}

export type StatusKind = "loading" | "error" | "empty" | "manifest";

export interface StatusRow {
    readonly kind: "status";
    readonly id: string;
    readonly depth: number;
    readonly parent: string;
    readonly status: StatusKind;
    readonly code: string | null;
    readonly detail: string | null;
}

export type Row = RootRow | EntryRow | StatusRow;

export interface ProjectionInput {
    readonly roots: ReadonlyArray<RootState>;
    readonly slots: ReadonlyMap<string, DirectorySlot>;
    readonly expanded: ReadonlySet<string>;
    readonly showManifests: boolean;
}

export function contentLayer(listing: Listing): boolean {
    return listing.contentRoot !== null && listing.manifest?.status === "ok";
}

export function projectRows(input: ProjectionInput): Row[] {
    const rows: Row[] = [];
    for (const root of input.roots) {
        const expanded = root.status.kind !== "unbound" && input.expanded.has(root.address);
        rows.push({kind: "root", id: root.address, depth: 0, scheme: root.scheme, address: root.address, expanded, status: root.status});
        if (expanded) directory(input, root.address, 1, rows);
    }
    return rows;
}

function directory(input: ProjectionInput, address: string, depth: number, rows: Row[]): void {
    const slot = input.slots.get(address);
    const status = (kind: StatusKind, code: string | null = null, detail: string | null = null): void => {
        rows.push({kind: "status", id: `${address}#${kind}`, depth, parent: address, status: kind, code, detail});
    };
    if (slot === undefined || slot.listing === null) {
        if (slot?.error != null) status("error", slot.error.code, slot.error.detail);
        else status("loading");
        return;
    }
    const {listing} = slot;
    const content = contentLayer(listing);
    // 清单错误只在内容根那一层提示一次；清单缺失（absent）是普通情形，不提示。
    if (listing.contentRoot !== null && listing.contentRoot === resourceOf(address).path && listing.manifest !== undefined && listing.manifest.status !== "ok" && listing.manifest.status !== "absent") {
        status("manifest", listing.manifest.status, listing.manifest.detail);
    }
    if (slot.error !== null) status("error", slot.error.code, slot.error.detail);
    const shown = listing.entries.filter((entry) => (entry.role !== "body" || !content) && (entry.role !== "manifest" || input.showManifests));
    if (shown.length === 0 && slot.error === null) status("empty");
    shown.forEach((entry, index) => {
        const child = childAddress(address, entry.name);
        const isDirectory = entry.kind === "directory";
        const expanded = isDirectory && input.expanded.has(child);
        const node = content && isDirectory;
        const body = node && entry.body === true;
        const label = content ? (entry.title ?? entry.name) : entry.name;
        rows.push({
            kind: "entry",
            id: child,
            depth,
            address: child,
            parent: address,
            name: entry.name,
            label,
            subtitle: label === entry.name ? null : entry.name,
            icon: content ? (entry.icon ?? null) : null,
            type: entry.kind,
            folder: entry.folder ?? null,
            content,
            node,
            body,
            listed: content ? (entry.listed ?? null) : null,
            manifest: entry.role === "manifest",
            binder: entry.folder === "binder",
            expandable: isDirectory,
            expanded,
            opens: entry.kind === "file" ? child : body ? childAddress(child, "index.md") : null,
            position: index + 1,
            siblings: shown.length,
        });
        if (expanded) directory(input, child, depth + 1, rows);
    });
}
