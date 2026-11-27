/**
 * 资源管理器零件的 Lab 数据：树的投影结果（`explorer/web/tree/rows.ts` 的 `Row`）写成固定的 JSON，覆盖三类文件夹、
 * 缺失与未列入、无正文与需要剧情插件、叶子节点、几种文件类型，以及挂在目录行上的状态（列出中、读取失败、清单不合法）。
 * 只是数据，不引用资源管理器的实现。
 */

import type {EntryRow, Row} from "nbook/plugins/explorer/web/tree/rows";

const entry = (address: string, depth: number, label: string, extra: Partial<EntryRow> = {}): EntryRow => {
    const name = address.slice(address.lastIndexOf("/") + 1);
    return {
        kind: "entry", id: address, depth, address, parent: address.slice(0, address.lastIndexOf("/")) || "project://", name, label, subtitle: label === name ? null : name, icon: null,
        type: "file", folder: null, content: false, node: false, body: false, listed: null, manifest: false, binder: false, expandable: false, expanded: false,
        opens: address, position: 1, siblings: 1, cut: false, problem: null, ...extra,
    };
};

const directory = {type: "directory", expandable: true, opens: null} as const;

export const EXPLORER_ROWS: Row[] = [
    {kind: "root", id: "project://", depth: 0, scheme: "project", address: "project://", expanded: true, status: {kind: "live"}, problem: null},
    entry("project://lore.content", 1, "lore", {...directory, subtitle: ".content", folder: "content", expanded: true, position: 1, siblings: 7}),
    entry("project://lore.content/alice", 2, "爱丽丝", {...directory, content: true, node: true, listed: true, position: 1, siblings: 5}),
    entry("project://lore.content/bob", 2, "鲍勃", {...directory, content: true, node: true, body: true, listed: true, expanded: true, opens: "project://lore.content/bob/index.md", position: 2, siblings: 5}),
    entry("project://lore.content/bob/portrait.png", 3, "立绘", {content: true, listed: true, position: 1, siblings: 1}),
    entry("project://lore.content/carol", 2, "卡萝", {type: "directory", content: true, node: true, body: true, listed: true, opens: "project://lore.content/carol/index.md", position: 3, siblings: 5}),
    entry("project://lore.content/gone", 2, "已删除的条目", {type: "missing", content: true, listed: true, opens: null, position: 4, siblings: 5}),
    entry("project://lore.content/stray.md", 2, "stray.md", {content: true, listed: false, position: 5, siblings: 5}),
    entry("project://broken.content", 1, "broken", {...directory, subtitle: ".content", folder: "content", expanded: true, position: 2, siblings: 7, problem: {kind: "manifest", code: "invalid", detail: "第 1 行不是合法的 XML"}}),
    entry("project://broken.content/index.md", 2, "index.md", {position: 1, siblings: 1}),
    entry("project://story.binder", 1, "story", {...directory, subtitle: ".binder", folder: "binder", binder: true, position: 3, siblings: 7}),
    entry("project://plain", 1, "plain", {...directory, expanded: true, position: 4, siblings: 7, problem: {kind: "loading"}}),
    entry("project://locked", 1, "locked", {...directory, expanded: true, position: 5, siblings: 7, problem: {kind: "error", code: "permission-denied", detail: "没有读取权限"}}),
    entry("project://索引.json", 1, "索引.json", {position: 6, siblings: 7}),
    entry("project://第三章.md", 1, "第三章.md", {position: 7, siblings: 7}),
    {kind: "root", id: "user://", depth: 0, scheme: "user", address: "user://", expanded: true, status: {kind: "live"}, problem: null},
];

/** 大目录：几百行，看虚拟滚动与长名字。 */
export function manyRows(count: number): Row[] {
    return [
        {kind: "root", id: "project://", depth: 0, scheme: "project", address: "project://", expanded: true, status: {kind: "live"}, problem: null},
        ...Array.from({length: count}, (_, index) => entry(`project://第${String(index + 1)}章 一个相当长的章节标题，用来看窄栏里的截断.md`, 1, `第${String(index + 1)}章 一个相当长的章节标题，用来看窄栏里的截断.md`, {position: index + 1, siblings: count})),
        {kind: "root", id: "user://", depth: 0, scheme: "user", address: "user://", expanded: false, status: {kind: "live"}, problem: null},
    ];
}

export const UNBOUND_ROWS: Row[] = [
    {kind: "root", id: "project://", depth: 0, scheme: "project", address: "project://", expanded: false, status: {kind: "unbound"}, problem: null},
    {kind: "root", id: "user://", depth: 0, scheme: "user", address: "user://", expanded: false, status: {kind: "ended", reason: "provider-stopped"}, problem: null},
];
