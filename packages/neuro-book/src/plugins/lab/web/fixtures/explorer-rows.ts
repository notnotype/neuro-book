/**
 * 资源管理器零件的 Lab 数据：树的投影结果（`explorer/web/tree/rows.ts` 的 `Row`）写成固定的 JSON，覆盖三类文件夹、
 * 缺失与未列入、无正文与需要剧情插件、各种状态行。只是数据，不引用资源管理器的实现。
 */

import type {EntryRow, Row} from "nbook/plugins/explorer/web/tree/rows";

const entry = (address: string, depth: number, label: string, extra: Partial<EntryRow> = {}): EntryRow => {
    const name = address.slice(address.lastIndexOf("/") + 1);
    return {
        kind: "entry", id: address, depth, address, parent: address.slice(0, address.lastIndexOf("/")) || "project://", name, label, subtitle: label === name ? null : name, icon: null,
        type: "file", folder: null, content: false, node: false, body: false, listed: null, manifest: false, binder: false, expandable: false, expanded: false,
        opens: address, position: 1, siblings: 1, cut: false, ...extra,
    };
};

const directory = {type: "directory", expandable: true, opens: null} as const;

export const EXPLORER_ROWS: Row[] = [
    {kind: "root", id: "project://", depth: 0, scheme: "project", address: "project://", expanded: true, status: {kind: "live"}},
    entry("project://lore.content", 1, "lore.content", {...directory, folder: "content", expanded: true, position: 1, siblings: 5}),
    entry("project://lore.content/alice", 2, "爱丽丝", {...directory, content: true, node: true, listed: true, position: 1, siblings: 4}),
    entry("project://lore.content/bob", 2, "鲍勃", {...directory, content: true, node: true, body: true, listed: true, opens: "project://lore.content/bob/index.md", position: 2, siblings: 4}),
    entry("project://lore.content/gone", 2, "已删除的条目", {type: "missing", content: true, listed: true, opens: null, position: 3, siblings: 4}),
    entry("project://lore.content/stray.md", 2, "stray.md", {content: true, listed: false, position: 4, siblings: 4}),
    entry("project://broken.content", 1, "broken.content", {...directory, folder: "content", expanded: true, position: 2, siblings: 5}),
    {kind: "status", id: "project://broken.content#manifest", depth: 2, parent: "project://broken.content", status: "manifest", code: "invalid", detail: "第 1 行不是合法的 XML"},
    entry("project://broken.content/index.md", 2, "index.md", {position: 1, siblings: 1}),
    entry("project://story.binder", 1, "story.binder", {...directory, folder: "binder", binder: true, position: 3, siblings: 5}),
    entry("project://plain", 1, "plain", {...directory, expanded: true, position: 4, siblings: 5}),
    {kind: "status", id: "project://plain#loading", depth: 2, parent: "project://plain", status: "loading", code: null, detail: null},
    entry("project://locked", 1, "locked", {...directory, expanded: true, position: 5, siblings: 5}),
    {kind: "status", id: "project://locked#error", depth: 2, parent: "project://locked", status: "error", code: "permission-denied", detail: "没有读取权限"},
    {kind: "root", id: "user://", depth: 0, scheme: "user", address: "user://", expanded: true, status: {kind: "live"}},
    {kind: "status", id: "user://#empty", depth: 1, parent: "user://", status: "empty", code: null, detail: null},
];

/** 大目录：几百行，看虚拟滚动与长名字。 */
export function manyRows(count: number): Row[] {
    return [
        {kind: "root", id: "project://", depth: 0, scheme: "project", address: "project://", expanded: true, status: {kind: "live"}},
        ...Array.from({length: count}, (_, index) => entry(`project://第${String(index + 1)}章 一个相当长的章节标题，用来看窄栏里的截断.md`, 1, `第${String(index + 1)}章 一个相当长的章节标题，用来看窄栏里的截断.md`, {position: index + 1, siblings: count})),
        {kind: "root", id: "user://", depth: 0, scheme: "user", address: "user://", expanded: false, status: {kind: "live"}},
    ];
}

export const UNBOUND_ROWS: Row[] = [
    {kind: "root", id: "project://", depth: 0, scheme: "project", address: "project://", expanded: false, status: {kind: "unbound"}},
    {kind: "root", id: "user://", depth: 0, scheme: "user", address: "user://", expanded: false, status: {kind: "ended", reason: "provider-stopped"}},
];
