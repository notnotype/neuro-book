/**
 * 就地改、记一笔与文字替换（docs/specs/canon/revisions.md 输出 8、9、10、22 到 24）：把“在某个位置上看到的值改成新值”
 * 按来历转成写入请求，发布后核对这个位置上算出的值确实等于新值，不等就整次拒收。
 *
 * 三种入口（就地改、记一笔、语义档的记一笔）都分两步：先“定方案”（读当前的值、按来历路由、合成写入请求，`plan*`），再发布
 * 并核对。预览只是把第二步换成不落库的计算，所以预览与随后的写入走同一份方案。
 *
 * 请求 id（输出 24）：合成出来的写入请求随世界变（排序键、被改的那条变更），不能拿它判断“是不是同一次请求”。所以每个入口
 * 开头先按调用方输入的摘要查这个请求 id，发布时也存这份摘要；重发在读值之前就返回第一次的结果，不会因为值已经变了而报冲突。
 */

import {parsePath} from "../core/address";
import {addExact, exactProblem, subtractExact} from "../core/decimal";
import {chapterEnd, compareRanks, positionRank} from "../core/position";
import {sameJson, stableStringify} from "../core/stable-json";
import {valueAt, type ViewValue} from "../core/view-value";
import type {Actor, Address, Entry, FieldDeclaration, Patch, Placement, ReadPosition, StoryChange, WriteRequest} from "../core/schema";
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

/** 记一笔的输入（输出 9）。 */
export interface DeltaRecord {
    readonly requestId: string;
    readonly by: Actor;
    readonly position: ReadPosition;
    readonly at: Address;
    readonly delta: number;
    readonly reason: string;
    readonly read: {readonly value: unknown; readonly version: number};
}

/** 语义档的记一笔的输入（输出 23）：`text` 既是这条剧情变更的文字，也是给这个字段的事件。 */
export interface NoteRecord {
    readonly requestId: string;
    readonly by: Actor;
    readonly position: ReadPosition;
    readonly at: Address;
    readonly text: string;
    readonly read: {readonly value: unknown; readonly version: number};
}

/**
 * 这次会写回哪里（输出 22）：改条目的初值、改某条变更里的第 `patch` 个补丁，或在一个安放上新记一条变更。以后会再加种类
 * （例如改一个核对点），调用方要能处理不认识的 `kind`。
 */
export type EditRoute = {readonly kind: "init"} | {readonly kind: "patch"; readonly change: string; readonly patch: number} | {readonly kind: "change"; readonly at: Placement};

/** 预览的输入：三种入口之一。 */
export type EditPreviewInput = ({readonly kind: "edit"} & InPlaceEdit) | ({readonly kind: "delta"} & DeltaRecord) | ({readonly kind: "note"} & NoteRecord);

export type EditPreview = (Extract<WriteResult, {ok: true}> & {readonly laterRecords: readonly string[]; readonly route: EditRoute}) | {readonly ok: false; readonly failure: EditFailure};

/** 定好的方案：要发布的写入请求、路由，以及发布后要读回核对的值（事件没有可核对的值）。 */
interface Plan {
    readonly ok: true;
    readonly edit: Pick<InPlaceEdit, "position" | "at">;
    readonly request: WriteRequest;
    readonly route: EditRoute;
    readonly expect?: {readonly value: unknown};
}

type Planned = Plan | {readonly ok: false; readonly failure: EditFailure};

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

/**
 * 位置不写线时按那一章讲的线（worldlines 输出 12）；读、排序键、新记录的安放与“后面改过”的查找都用同一条线，不然读到子线的值、
 * 记录却落在主线上，改后读到的还是旧值。
 */
function onLine(world: World, position: ReadPosition): ReadPosition {
    const line = world.positionLine(position);
    const {line: _written, ...positionWithoutLine} = position;
    return line === MAIN_LINE ? positionWithoutLine : {...positionWithoutLine, line};
}

/** 在读取位置新记的一条已写变更：落在本章最前或最后（`keyAt`），只带这一个补丁。 */
function storyChange(world: World, position: ReadPosition & {readonly kind: "chapter"}, by: Actor, text: string, patch: Patch): StoryChange {
    return {
        id: "tmp:edit",
        kind: "written",
        text,
        at: {kind: "chapter", chapter: position.chapter, key: keyAt(world, position), ...(position.line === undefined || position.line === MAIN_LINE ? {} : {line: position.line})},
        told: [],
        involves: [patch.at.entry],
        lines: [],
        links: [],
        patches: [patch],
        status: "active",
        by,
    };
}

export function editInPlace(world: World, edit: InPlaceEdit, time: string): EditResult {
    const digest = inputDigest(world, "editInPlace", edit);
    return repeated(world, edit, digest) ?? finish(world, planEdit(world, edit), time, digest);
}

function planEdit(world: World, original: InPlaceEdit): Planned {
    const edit: InPlaceEdit = {...original, position: onLine(world, original.position)};
    const current = currentAt(world, edit.position, edit.at);
    if (current === "chapter-not-found" || current === "line-not-found") return {ok: false, failure: {code: current}};
    if (!current.available) return {ok: false, failure: {code: "field-unavailable"}};
    if (!sameJson(current.value, edit.read.value)) return {ok: false, failure: {code: "value-conflict", current: current.value}};
    const intent = edit.intent ?? "creative";
    const entry = world.data.entries.get(edit.at.entry)!;
    const field = declarationAt(world, entry, edit.at);
    const exactNumber = field?.kind === "number" && field.precision !== "semantic";

    let request: WriteRequest;
    let route: EditRoute;
    if (intent === "story") {
        if (edit.position.kind === "initial") return {ok: false, failure: {code: "intent-not-allowed"}};
        let patch: Patch;
        if (exactNumber && !current.incomplete && typeof edit.value === "number" && typeof current.value === "number") {
            const delta = subtractExact(edit.value, current.value);
            if (delta === null || exactProblem(edit.value) !== null) return {ok: false, failure: {code: "validation-failed", problems: [{code: "number-out-of-range", message: "value is out of range"}]}};
            patch = {op: "add", at: edit.at, value: delta, basis: {kind: "author"}};
        } else patch = {op: edit.at.path.startsWith("text[") ? "replaceBlock" : "set", at: edit.at, value: structuredClone(edit.value) as never, ...(typeof edit.value === "number" ? {basis: {kind: "author"} as const} : {})};
        const change = storyChange(world, edit.position, edit.by, edit.title ?? "就地改", patch);
        route = {kind: "change", at: change.at};
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
            route = {kind: "init"};
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
            route = {kind: "patch", change: change.id, patch: patches.findIndex((patch, index) => patch !== change.patches[index])};
            request = {requestId: edit.requestId, by: edit.by, what: "edit", title: edit.title ?? "改设定", baseVersion: edit.read.version, puts: [{ref: {kind: "change", id: change.id}, after: {...change, patches}}]};
        }
    }
    return {ok: true, edit, request, route, expect: {value: edit.value}};
}

/**
 * 语义档的记一笔（输出 23）：在读取位置记一条剧情变更，带一个给这个字段的事件。事件不改“起点”，发布后没有可以读回核对的值
 * （读到的是起点加事件，或归纳的一句话）。
 */
function planNote(world: World, original: NoteRecord): Planned {
    const input: NoteRecord = {...original, position: onLine(world, original.position)};
    const current = currentAt(world, input.position, input.at);
    if (current === "chapter-not-found" || current === "line-not-found") return {ok: false, failure: {code: current}};
    if (!current.available) return {ok: false, failure: {code: "field-unavailable"}};
    const field = declarationAt(world, world.data.entries.get(input.at.entry)!, input.at);
    if (field?.precision !== "semantic") return {ok: false, failure: {code: "validation-failed", problems: [{code: "type-mismatch", message: "the field is not a semantic field; record a delta or edit it in place"}]}};
    if (input.position.kind === "initial") return {ok: false, failure: {code: "intent-not-allowed"}};
    if (!sameJson(current.value, input.read.value)) return {ok: false, failure: {code: "value-conflict", current: current.value}};
    const change = storyChange(world, input.position, input.by, input.text, {op: "note", at: input.at, value: input.text});
    return {ok: true, edit: input, route: {kind: "change", at: change.at}, request: {requestId: input.requestId, by: input.by, what: "edit", title: input.text, baseVersion: input.read.version, chapter: input.position.chapter, puts: [{ref: {kind: "change", id: "tmp:edit"}, after: change}]}};
}

export function recordNote(world: World, input: NoteRecord, time: string): EditResult {
    const digest = inputDigest(world, "recordNote", input);
    return repeated(world, input, digest) ?? finish(world, planNote(world, input), time, digest);
}

/**
 * 调用方输入的摘要：同一个请求 id 重发时按它比（输出 24）。位置先换成读取用的那一条线（写不写线是同一次请求）；可选的键
 * 写成 undefined 与不写一样（`stableStringify` 略过它们），不因此抛错或判成另一次请求。
 */
function inputDigest(world: World, method: string, input: Pick<InPlaceEdit, "position"> & object): string {
    return world.options.digest(stableStringify({[method]: {...input, position: positionRank(world.options.order, input.position) === null ? input.position : onLine(world, input.position)}}));
}

/** 这个请求 id 已经发布过：输入相同返回第一次的结果，不同拒收；没发布过返回 null。 */
function repeated(world: World, input: Pick<InPlaceEdit, "requestId" | "position" | "at">, digest: string): EditResult | null {
    const published = world.requested(input.requestId);
    if (published === undefined) return null;
    if (published.requestDigest !== digest) return {ok: false, failure: {code: "request-id-reused"}};
    return {ok: true, world, revision: published, ids: published.idMap ?? {}, repeated: true, laterRecords: laterRecords(world, {position: onLine(world, input.position), at: input.at})};
}

/** 发布定好的方案并核对读回的值；`digest` 是调用方输入的摘要，存进修订给重发比较。 */
function finish(world: World, planned: Planned, time: string, digest: string): EditResult {
    if (!planned.ok) return planned;
    return checked(planned, world.publish(planned.request, time, digest));
}

function checked(planned: Plan, result: WriteResult): EditResult {
    if (!result.ok) return result;
    if (planned.expect !== undefined) {
        const after = currentAt(result.world, planned.edit.position, planned.edit.at);
        if (after === "chapter-not-found" || after === "line-not-found" || !sameJson(after.value, planned.expect.value)) return {ok: false, failure: {code: "result-mismatch", got: typeof after === "string" ? undefined : after.value}};
    }
    return {...result, laterRecords: laterRecords(result.world, planned.edit)};
}

/**
 * 就地改与记一笔的预览（输出 22）：与写入走同一份方案，只算不发布。不看也不记请求 id：预览用一个没人用过的 id 去算，
 * 所以这个请求 id 用没用过结果都一样。
 */
export function previewEdit(world: World, input: EditPreviewInput, time: string): EditPreview {
    const planned = input.kind === "note" ? planNote(world, input) : input.kind === "delta" ? planDelta(world, input) : planEdit(world, input);
    if (!planned.ok) return planned;
    let requestId = `preview:${planned.request.requestId}`;
    while (world.requested(requestId) !== undefined) requestId = `preview:${requestId}`;
    const result = checked(planned, world.preview({...planned.request, requestId}, time));
    // 交出去的修订写回调用方的请求 id：算的时候用的那个只是为了绕开去重。
    return result.ok ? {...result, revision: {...result.revision, requestId: planned.request.requestId}, route: planned.route} : result;
}

/** 地址指向的字段声明；列表元素的子字段取列表的 `item` 里的声明（就地改与记一笔对它们一样记加减）。 */
function declarationAt(world: World, entry: Entry, at: Address): FieldDeclaration | undefined {
    const parsed = parsePath(at.path);
    if (parsed?.root !== "namespace" || parsed.element === undefined) return fieldOf(world.options.registry, entry, at);
    const list = fieldOf(world.options.registry, entry, {entry: at.entry, path: `${parsed.namespace}.${parsed.field}`});
    return parsed.sub === undefined ? undefined : list?.item?.find((item) => item.id === parsed.sub);
}

/** 记一笔（输出 9）：意图为剧情变化的一次加减。差额与结果都按精确档的数核对，不悄悄舍入（components.md 输出 14）。 */
export function recordDelta(world: World, input: DeltaRecord, time: string): EditResult {
    const digest = inputDigest(world, "recordDelta", input);
    return repeated(world, input, digest) ?? finish(world, planDelta(world, input), time, digest);
}

function planDelta(world: World, input: DeltaRecord): Planned {
    if (typeof input.read.value !== "number") return {ok: false, failure: {code: "incomplete-field"}};
    const value = exactProblem(input.delta) === null ? addExact(input.read.value, input.delta) : null;
    if (value === null) return {ok: false, failure: {code: "validation-failed", problems: [{code: "number-out-of-range", message: "delta is out of range or has more than 4 decimals"}]}};
    return planEdit(world, {requestId: input.requestId, by: input.by, position: input.position, at: input.at, value, read: input.read, intent: "story", title: input.reason});
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
function laterRecords(world: World, edit: Pick<InPlaceEdit, "position" | "at">): string[] {
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
