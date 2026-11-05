/**
 * 就地改、记一笔与文字替换（docs/specs/canon/revisions.md 输出 8、9、10）：把“在某个位置上看到的值改成新值”
 * 按来历转成写入请求，发布后核对这个位置上算出的值确实等于新值，不等就整次拒收。
 */

import {parsePath} from "../core/address";
import {addExact, exactProblem, subtractExact} from "../core/decimal";
import {chapterEnd, compareRanks, positionRank} from "../core/position";
import {sameJson} from "../core/stable-json";
import {valueAt, type ViewValue} from "../core/view-value";
import type {Actor, Address, Entry, FieldDeclaration, Patch, ReadPosition, StoryChange, WriteRequest} from "../core/schema";
import {fieldOf} from "../engine/reference";
import type {OriginStep} from "../engine/types";
import {MAIN_LINE} from "../lines/table";
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
    | {readonly code: "line-not-found"}
    | {readonly code: "value-conflict"; readonly current: unknown}
    | {readonly code: "accumulated-value"; readonly origins: readonly OriginStep[]}
    | {readonly code: "incomplete-field"}
    | {readonly code: "field-unavailable"}
    | {readonly code: "intent-not-allowed"}
    | {readonly code: "result-mismatch"; readonly got: unknown};

export type EditResult = (Extract<WriteResult, {ok: true}> & {readonly laterRecords: readonly string[]}) | {readonly ok: false; readonly failure: EditFailure};

/** 一个地址在某个位置上的值、是否不完整、所在命名空间是否可写。 */
function currentAt(world: World, position: ReadPosition, at: Address): ViewValue | "chapter-not-found" | "line-not-found" {
    const line = world.lineAt(position);
    if (line === undefined) return "line-not-found";
    const view = line.engine.entry(at.entry, position, "actual");
    return view === "chapter-not-found" ? view : valueAt(view, at.path);
}

/**
 * 剧情变化在读取位置的排序键：开头落在本章最前（最小键减一），末尾落在本章最后（最大键加一）（输出 18）。只看读取位置那条线视图里的
 * 记录（worldlines 输出 19）：切口在本章时它在视图里，所以末尾的键必然晚于切口；开头落在切口之前的写入由线的规则拒收。
 */
function keyAt(world: World, position: ReadPosition & {readonly kind: "chapter"}): number {
    const {records} = world.lineAt(position)!;
    const keys: number[] = [];
    for (const change of records.changes.values()) if (change.at.kind === "chapter" && change.at.chapter === position.chapter) keys.push(change.at.key);
    for (const check of records.checks.values()) if (check.place.kind === "chapter" && check.place.chapter === position.chapter) keys.push(check.place.key);
    if (keys.length === 0) return 0;
    return position.edge === "start" ? Math.min(...keys) - 1 : Math.max(...keys) + 1;
}

export function editInPlace(world: World, original: InPlaceEdit, time: string): EditResult {
    // 位置不写线时按那一章讲的线（worldlines 输出 12）；读、排序键、新记录的安放与“后面改过”的查找都用同一条线，不然读到子线的值、
    // 记录却落在主线上，改后读到的还是旧值。
    const line = world.positionLine(original.position);
    const {line: _written, ...positionWithoutLine} = original.position;
    const edit: InPlaceEdit = {...original, position: line === MAIN_LINE ? positionWithoutLine : {...positionWithoutLine, line}};
    const current = currentAt(world, edit.position, edit.at);
    if (current === "chapter-not-found" || current === "line-not-found") return {ok: false, failure: {code: current}};
    if (!current.available) return {ok: false, failure: {code: "field-unavailable"}};
    if (!sameJson(current.value, edit.read.value)) return {ok: false, failure: {code: "value-conflict", current: current.value}};
    const intent = edit.intent ?? "creative";
    const entry = world.data.entries.get(edit.at.entry)!;
    const field = declarationAt(world, entry, edit.at);
    const exactNumber = field?.kind === "number" && field.precision !== "semantic";

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
            at: {kind: "chapter", chapter: edit.position.chapter, key: keyAt(world, edit.position), ...(edit.position.line === undefined || edit.position.line === MAIN_LINE ? {} : {line: edit.position.line})},
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
        const origins = world.lineAt(edit.position)!.engine.origins(edit.at, edit.position, "actual");
        if (origins === "chapter-not-found") return {ok: false, failure: {code: "chapter-not-found"}};
        const steps = origins.filter((step) => step.kind !== "check" || step.result === "anchor");
        const last = steps.at(-1)!;
        // 带过去的值不是哪条记录写的：要改它，在这条线上记一条剧情变化（worldlines 输出 19）。
        const view = world.lineAt(edit.position)!;
        if (last.kind === "patch" && view.synthetic.has(last.change)) return {ok: false, failure: {code: "validation-failed", problems: [{code: "carried-value", message: "the value was carried over from another world line; record a story change on this line instead"}]}};
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
        if (after === "chapter-not-found" || after === "line-not-found" || !sameJson(after.value, edit.value)) return {ok: false, failure: {code: "result-mismatch", got: typeof after === "string" ? undefined : after.value}};
    }
    return {...result, laterRecords: laterRecords(result.world, edit)};
}

/** 地址指向的字段声明；列表元素的子字段取列表的 `item` 里的声明（就地改与记一笔对它们一样记加减）。 */
function declarationAt(world: World, entry: Entry, at: Address): FieldDeclaration | undefined {
    const parsed = parsePath(at.path);
    if (parsed?.root !== "namespace" || parsed.element === undefined) return fieldOf(world.options.registry, entry, at);
    const list = fieldOf(world.options.registry, entry, {entry: at.entry, path: `${parsed.namespace}.${parsed.field}`});
    return parsed.sub === undefined ? undefined : list?.item?.find((item) => item.id === parsed.sub);
}

/** 记一笔（输出 9）：意图为剧情变化的一次加减。差额与结果都按精确档的数核对，不悄悄舍入（components.md 输出 14）。 */
export function recordDelta(world: World, input: {readonly requestId: string; readonly by: Actor; readonly position: ReadPosition; readonly at: Address; readonly delta: number; readonly reason: string; readonly read: {readonly value: unknown; readonly version: number}}, time: string): EditResult {
    if (typeof input.read.value !== "number") return {ok: false, failure: {code: "incomplete-field"}};
    const value = exactProblem(input.delta) === null ? addExact(input.read.value, input.delta) : null;
    if (value === null) return {ok: false, failure: {code: "validation-failed", problems: [{code: "number-out-of-range", message: "delta is out of range or has more than 4 decimals"}]}};
    return editInPlace(world, {requestId: input.requestId, by: input.by, position: input.position, at: input.at, value, read: input.read, intent: "story", title: input.reason}, time);
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
    const origins = world.lineAt(edit.position)?.engine.origins(edit.at, {...chapterEnd(last), ...(edit.position.line === undefined ? {} : {line: edit.position.line})}, "actual");
    if (origins === undefined) return ids;
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
