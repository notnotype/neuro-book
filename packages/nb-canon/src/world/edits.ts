/**
 * 就地改、记一笔与文字替换（docs/specs/canon/revisions.md 输出 8、9、10）：把“在某个位置上看到的值改成新值”
 * 按来历转成写入请求，发布后核对这个位置上算出的值确实等于新值，不等就整次拒收。
 */

import {exactProblem, subtractExact} from "../core/decimal";
import {chapterEnd, compareRanks, positionRank} from "../core/position";
import {sameJson} from "../core/stable-json";
import type {Actor, Address, Entry, Patch, ReadPosition, StoryChange, WriteRequest} from "../core/schema";
import {fieldOf} from "../engine/reference";
import type {OriginStep} from "../engine/types";
import type {World, WriteFailure, WriteResult} from "./world";

export interface InPlaceEdit {
    readonly requestId: string;
    readonly by: Actor;
    readonly position: ReadPosition;
    readonly at: Address;
    readonly value: unknown;
    /** 读到的值与读取时的版本（输出 19：必须带）。 */
    readonly read: {readonly value: unknown; readonly version: number};
    readonly intent?: "creative" | "story";
    readonly title?: string;
}

export type EditFailure =
    | WriteFailure
    | {readonly code: "chapter-not-found"}
    | {readonly code: "value-conflict"; readonly current: unknown}
    | {readonly code: "accumulated-value"; readonly origins: readonly OriginStep[]}
    | {readonly code: "incomplete-field"}
    | {readonly code: "field-unavailable"}
    | {readonly code: "intent-not-allowed"}
    | {readonly code: "result-mismatch"; readonly got: unknown};

export type EditResult = (Extract<WriteResult, {ok: true}> & {readonly laterRecords: readonly string[]}) | {readonly ok: false; readonly failure: EditFailure};

/** 一个地址在某个位置上的值、是否不完整、所在命名空间是否可写。 */
function currentAt(world: World, position: ReadPosition, at: Address): {value: unknown; incomplete: boolean; available: boolean} | "chapter-not-found" {
    const view = world.engine.entry(at.entry, position, "actual");
    if (view === "chapter-not-found") return view;
    if (view === null || view.deleted) return {value: undefined, incomplete: false, available: false};
    const [root, rest] = splitRoot(at.path);
    if (root === "entry") return {value: structuredClone(view[rest as "name" | "aliases" | "summary"]), incomplete: false, available: true};
    if (root === "text") return {value: view.text.find((block) => `[${block.id}]` === rest)?.source, incomplete: false, available: true};
    const namespace = view.namespaces[root];
    if (namespace === undefined || namespace.readOnly !== undefined) return {value: undefined, incomplete: false, available: false};
    const field = namespace.fields[rest.split("[")[0]!];
    if (field === undefined) return {value: undefined, incomplete: false, available: false};
    let value = field.value;
    const element = /\[([^\]]+)\](?:\.(.+))?$/u.exec(rest);
    if (element !== null) {
        const item = Array.isArray(value) ? (value as Array<Record<string, unknown>>).find((candidate) => candidate.id === element[1]) : undefined;
        value = element[2] === undefined ? item : item?.[element[2]];
    }
    return {value: structuredClone(value), incomplete: field.incomplete !== undefined, available: true};
}

function splitRoot(path: string): [string, string] {
    if (path.startsWith("text[")) return ["text", path.slice(4)];
    const dot = path.indexOf(".");
    return [path.slice(0, dot), path.slice(dot + 1)];
}

/** 剧情变化在读取位置的排序键：开头落在本章最前（最小键减一），末尾落在本章最后（最大键加一）（输出 18）。 */
function keyAt(world: World, chapter: string, edge: "start" | "end"): number {
    const keys: number[] = [];
    for (const change of world.data.changes.values()) if (change.at.kind === "chapter" && change.at.chapter === chapter) keys.push(change.at.key);
    for (const check of world.data.checks.values()) if (check.place.kind === "chapter" && check.place.chapter === chapter) keys.push(check.place.key);
    if (keys.length === 0) return 0;
    return edge === "start" ? Math.min(...keys) - 1 : Math.max(...keys) + 1;
}

export function editInPlace(world: World, edit: InPlaceEdit, time: string): EditResult {
    const current = currentAt(world, edit.position, edit.at);
    if (current === "chapter-not-found") return {ok: false, failure: {code: "chapter-not-found"}};
    if (!current.available) return {ok: false, failure: {code: "field-unavailable"}};
    if (!sameJson(current.value, edit.read.value)) return {ok: false, failure: {code: "value-conflict", current: current.value}};
    const intent = edit.intent ?? "creative";
    const entry = world.data.entries.get(edit.at.entry)!;
    const field = fieldOf(world.options.registry, entry, edit.at);
    const exactNumber = field?.kind === "number" && field.precision !== "semantic" && !edit.at.path.includes("[");

    let request: WriteRequest;
    if (intent === "story") {
        if (edit.position.kind === "initial") return {ok: false, failure: {code: "intent-not-allowed"}};
        let patch: Patch;
        if (exactNumber && !current.incomplete && typeof edit.value === "number" && typeof current.value === "number") {
            const delta = subtractExact(edit.value, current.value);
            if (delta === null || exactProblem(edit.value) !== null) return {ok: false, failure: {code: "validation-failed", problems: [{code: "number-out-of-range", message: "value is out of range"}]}};
            patch = {op: "add", at: edit.at, value: delta, basis: {kind: "author"}};
        } else patch = {op: edit.at.path.startsWith("text[") ? "replaceBlock" : "set", at: edit.at, value: structuredClone(edit.value) as never, ...(typeof edit.value === "number" ? {basis: {kind: "author"} as const} : {})};
        const change: StoryChange = {
            id: "tmp:edit",
            kind: "written",
            text: edit.title ?? "就地改",
            at: {kind: "chapter", chapter: edit.position.chapter, key: keyAt(world, edit.position.chapter, edit.position.edge)},
            told: [],
            involves: [edit.at.entry],
            lines: [],
            links: [],
            patches: [patch],
            status: "active",
            by: edit.by,
        };
        request = {requestId: edit.requestId, by: edit.by, what: "edit", title: edit.title ?? "就地改", baseVersion: edit.read.version, chapter: edit.position.chapter, puts: [{ref: {kind: "change", id: "tmp:edit"}, after: change}]};
    } else {
        if (current.incomplete) return {ok: false, failure: {code: "incomplete-field"}};
        const origins = world.engine.origins(edit.at, edit.position, "actual");
        if (origins === "chapter-not-found") return {ok: false, failure: {code: "chapter-not-found"}};
        const steps = origins.filter((step) => step.kind !== "check" || step.result === "anchor");
        const last = steps.at(-1)!;
        if (last.kind === "reduce" || last.kind === "check" || (last.kind === "patch" && (last.op === "add" || last.op === "note"))) {
            return {ok: false, failure: {code: "accumulated-value", origins}};
        }
        if (last.kind === "init") {
            const next = writeInit(entry, edit.at.path, edit.value);
            if (next === null) return {ok: false, failure: {code: "field-unavailable"}};
            request = {requestId: edit.requestId, by: edit.by, what: "edit", title: edit.title ?? "改设定", baseVersion: edit.read.version, puts: [{ref: {kind: "entry", id: entry.id}, after: next}]};
        } else {
            const change = world.data.changes.get(last.change)!;
            const patches = change.patches.map((patch) => {
                if (patch.at.entry !== edit.at.entry || patch.at.path !== edit.at.path) return patch;
                if (patch.op === "set" || patch.op === "replaceBlock") return {...patch, value: structuredClone(edit.value) as never};
                // 这一块是这条变更增进来的：改它带的文字。
                if (patch.op === "addBlock" && typeof edit.value === "string") return {...patch, value: {...(patch.value as object), source: edit.value}};
                return patch;
            });
            if (sameJson(patches, change.patches)) return {ok: false, failure: {code: "accumulated-value", origins}};
            request = {requestId: edit.requestId, by: edit.by, what: "edit", title: edit.title ?? "改设定", baseVersion: edit.read.version, puts: [{ref: {kind: "change", id: change.id}, after: {...change, patches}}]};
        }
    }

    const result = world.publish(request, time);
    if (!result.ok) return result;
    if (!result.repeated) {
        const after = currentAt(result.world, edit.position, edit.at);
        if (after === "chapter-not-found" || !sameJson(after.value, edit.value)) return {ok: false, failure: {code: "result-mismatch", got: after === "chapter-not-found" ? undefined : after.value}};
    }
    return {...result, laterRecords: laterRecords(result.world, edit)};
}

/** 记一笔（输出 9）：意图为剧情变化的一次加减。 */
export function recordDelta(world: World, input: {readonly requestId: string; readonly by: Actor; readonly position: ReadPosition; readonly at: Address; readonly delta: number; readonly reason: string; readonly read: {readonly value: unknown; readonly version: number}}, time: string): EditResult {
    if (typeof input.read.value !== "number") return {ok: false, failure: {code: "incomplete-field"}};
    const value = input.read.value + input.delta;
    return editInPlace(world, {requestId: input.requestId, by: input.by, position: input.position, at: input.at, value: Math.round(value * 1e4) / 1e4, read: input.read, intent: "story", title: input.reason}, time);
}

/** 文字替换（输出 10）：A 在当时的值里必须恰好出现一次。 */
export function replaceOnce(text: string, find: string, replacement: string): string | "replace-not-found" | "replace-not-unique" {
    const first = text.indexOf(find);
    if (find === "" || first < 0) return "replace-not-found";
    if (text.indexOf(find, first + 1) >= 0) return "replace-not-unique";
    return text.slice(0, first) + replacement + text.slice(first + find.length);
}

function writeInit(entry: Entry, path: string, value: unknown): Entry | null {
    const next = structuredClone(entry);
    if (path === "entry.name" || path === "entry.summary") {
        if (typeof value !== "string") return null;
        next.init[path === "entry.name" ? "name" : "summary"] = value;
        return next;
    }
    if (path === "entry.aliases") {
        if (!Array.isArray(value)) return null;
        next.init.aliases = value as string[];
        return next;
    }
    const block = /^text\[(.+)\]$/u.exec(path);
    if (block !== null) {
        const target = next.init.text.find((candidate) => candidate.id === block[1]);
        if (target === undefined || typeof value !== "string") return null;
        target.source = value;
        return next;
    }
    const match = /^([^.[\]]+)\.([^.[\]]+)(?:\[([^.[\]]+)\](?:\.([^.[\]]+))?)?$/u.exec(path);
    if (match === null) return null;
    const [, namespace, field, element, sub] = match as unknown as [string, string, string, string | undefined, string | undefined];
    const data = next.init.data[namespace];
    if (data === undefined) return null;
    if (element === undefined) data.fields[field] = structuredClone(value);
    else {
        const list = data.fields[field];
        const item = Array.isArray(list) ? (list as Array<Record<string, unknown>>).find((candidate) => candidate.id === element) : undefined;
        if (item === undefined) return null;
        if (sub === undefined) Object.assign(item, value);
        else item[sub] = structuredClone(value);
    }
    return next;
}

/** 后面改过同一地址的记录（输出 8 的结果另外列出）。 */
function laterRecords(world: World, edit: InPlaceEdit): string[] {
    const rank = positionRank(world.options.order, edit.position);
    if (rank === null) return [];
    const ids: string[] = [];
    const last = world.options.order.ids.at(-1);
    if (last === undefined) return ids;
    const origins = world.engine.origins(edit.at, chapterEnd(last), "actual");
    if (origins === "chapter-not-found") return ids;
    for (const step of origins) {
        if (step.kind !== "patch") continue;
        const change = world.data.changes.get(step.change);
        if (change === undefined || change.at.kind !== "chapter") continue;
        const index = world.options.order.index(change.at.chapter);
        if (index !== undefined && compareRanks([1, index, change.at.key], rank) > 0) ids.push(step.change);
    }
    return [...new Set(ids)];
}
