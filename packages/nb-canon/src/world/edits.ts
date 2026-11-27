/**
 * 就地改、记一笔与文字替换（docs/specs/canon/revisions.md 输出 8、9、10、22 到 24）：把“在某个位置上看到的值改成新值”按来历转成
 * 写入请求，发布后核对这个位置上算出的值确实等于新值，不等就整次拒收。
 *
 * 三种入口都是一项操作的批量编辑（`entry-edits.ts`，输出 25）：路由、候选计算与读回核对共用那里的。这里只保留各入口自己的部分：
 * 输入的形状、缺省标题、`what`，以及请求 id 的判断（输出 24）。
 *
 * 请求 id（输出 24）：合成出来的写入请求随世界变（排序键、被改的那条变更），不能拿它判断“是不是同一次请求”。所以每个入口
 * 开头先按调用方输入的摘要查这个请求 id，发布时也存这份摘要；重发在读值之前就返回第一次的结果，不会因为值已经变了而报冲突。
 * 摘要的算法（入口名为键、位置先规整到它所在的线）与 t37 之前相同，已落盘的请求重发照旧得到第一次的结果。
 */

import {exactProblem, addExact} from "../core/decimal";
import {positionRank} from "../core/position";
import {stableStringify} from "../core/stable-json";
import type {Actor, Address, ReadPosition} from "../core/schema";
import {MAIN_LINE} from "../lines/table";
import {checkPlan, laterRecords, planEntries, type EditFailure, type EditRoute, type EntryEditFailure, type EntryEditResult, type EntryEdits, type EntryOp} from "./entry-edits";
import type {Problem, World, WriteResult} from "./world";

export type {EditFailure, EditRoute} from "./entry-edits";

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

/** 预览的输入：三种入口之一。 */
export type EditPreviewInput = ({readonly kind: "edit"} & InPlaceEdit) | ({readonly kind: "delta"} & DeltaRecord) | ({readonly kind: "note"} & NoteRecord);

export type EditPreview = (Extract<WriteResult, {ok: true}> & {readonly laterRecords: readonly string[]; readonly route: EditRoute}) | {readonly ok: false; readonly failure: EditFailure};

/**
 * 位置不写线时按那一章讲的线（worldlines 输出 12）。只给请求摘要用：写了主线也去掉线，与 t37 之前的摘要逐字相同。路由与核对用
 * `entry-edits.ts` 的 `resolveLine`，写了主线就按主线。
 */
function onLine(world: World, position: ReadPosition): ReadPosition {
    const line = world.positionLine(position);
    const {line: _written, ...positionWithoutLine} = position;
    return line === MAIN_LINE ? positionWithoutLine : {...positionWithoutLine, line};
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
    return {ok: true, world, revision: published, ids: published.idMap ?? {}, repeated: true, laterRecords: laterRecords(world, onLine(world, input.position), input.at)};
}

/** 批量编辑的失败交回单项入口的形状：去掉项的序号（只有一项），校验问题里的 `ops[0]` 与细项上的 `op` 也去掉。 */
function single(failure: EntryEditFailure): EditFailure {
    if (failure.code === "stale-read") throw new Error("single-entry edits do not carry a read stamp");
    if (failure.code === "validation-failed") return {code: "validation-failed", problems: failure.problems.map(({path, op: _op, ...rest}): Problem => (path === "ops[0]" ? rest : {path, ...rest}) as Problem)};
    if ("op" in failure) {
        const {op: _op, ...rest} = failure;
        return rest as EditFailure;
    }
    return failure;
}

/** 一项操作的批量编辑：就地改与记一笔都是“在读取位置把这个地址改成这个值”。 */
function batchOf(input: {readonly requestId: string; readonly by: Actor; readonly position: ReadPosition; readonly read: {readonly version: number}}, title: string, intent: "creative" | "story", op: EntryOp): EntryEdits {
    return {requestId: input.requestId, by: input.by, what: "edit", baseVersion: input.read.version, title, intent, position: input.position, ops: [op]};
}

function editBatch(edit: InPlaceEdit): EntryEdits {
    const intent = edit.intent ?? "creative";
    return batchOf(edit, edit.title ?? (intent === "story" ? "就地改" : "改设定"), intent, {op: "set", at: edit.at, value: edit.value, read: edit.read.value});
}

/** 记一笔（输出 9）：意图为剧情变化的一次加减，差额与结果都按精确档的数核对，不悄悄舍入（components.md 输出 14）。 */
function deltaBatch(input: DeltaRecord): EntryEdits | EditFailure {
    if (typeof input.read.value !== "number") return {code: "incomplete-field"};
    const value = exactProblem(input.delta) === null ? addExact(input.read.value, input.delta) : null;
    if (value === null) return {code: "validation-failed", problems: [{code: "number-out-of-range", message: "delta is out of range or has more than 4 decimals"}]};
    return batchOf(input, input.reason, "story", {op: "set", at: input.at, value, read: input.read.value});
}

function noteBatch(input: NoteRecord): EntryEdits {
    return batchOf(input, input.text, "story", {op: "note", at: input.at, text: input.text, read: input.read.value});
}

/** 发布并核对；结果交回单项入口的形状。 */
function finish(world: World, batch: EntryEdits | EditFailure, time: string, digest: string): EditResult {
    if (!("ops" in batch)) return {ok: false, failure: batch};
    const planned = planEntries(world, batch);
    if (!planned.ok) return {ok: false, failure: single(planned.failure)};
    return unbatch(checkPlan(planned, world.publish(planned.request, time, digest), world));
}

function unbatch(result: EntryEditResult): EditResult {
    if (!result.ok) return {ok: false, failure: single(result.failure)};
    const {routes: _routes, ...rest} = result;
    return rest;
}

export function editInPlace(world: World, edit: InPlaceEdit, time: string): EditResult {
    const digest = inputDigest(world, "editInPlace", edit);
    return repeated(world, edit, digest) ?? finish(world, editBatch(edit), time, digest);
}

export function recordDelta(world: World, input: DeltaRecord, time: string): EditResult {
    const digest = inputDigest(world, "recordDelta", input);
    return repeated(world, input, digest) ?? finish(world, deltaBatch(input), time, digest);
}

export function recordNote(world: World, input: NoteRecord, time: string): EditResult {
    const digest = inputDigest(world, "recordNote", input);
    return repeated(world, input, digest) ?? finish(world, noteBatch(input), time, digest);
}

/**
 * 就地改与记一笔的预览（输出 22）：与写入走同一份方案，只算不发布。不看也不记请求 id：预览用一个没人用过的 id 去算，
 * 所以这个请求 id 用没用过结果都一样。
 */
export function previewEdit(world: World, input: EditPreviewInput, time: string): EditPreview {
    const batch = input.kind === "note" ? noteBatch(input) : input.kind === "delta" ? deltaBatch(input) : editBatch(input);
    if (!("ops" in batch)) return {ok: false, failure: batch};
    const planned = planEntries(world, batch);
    if (!planned.ok) return {ok: false, failure: single(planned.failure)};
    let requestId = `preview:${planned.request.requestId}`;
    while (world.requested(requestId) !== undefined) requestId = `preview:${requestId}`;
    const result = checkPlan(planned, world.preview({...planned.request, requestId}, time), world);
    if (!result.ok) return {ok: false, failure: single(result.failure)};
    const {routes, ...rest} = result;
    // 交出去的修订写回调用方的请求 id：算的时候用的那个只是为了绕开去重。
    return {...rest, revision: {...rest.revision, requestId: planned.request.requestId}, route: routes[0]!};
}

/** 文字替换（输出 10）：A 在当时的值里必须恰好出现一次。 */
export function replaceOnce(text: string, find: string, replacement: string): string | "replace-not-found" | "replace-not-unique" {
    const first = text.indexOf(find);
    if (find === "" || first < 0) return "replace-not-found";
    if (text.indexOf(find, first + 1) >= 0) return "replace-not-unique";
    return text.slice(0, first) + replacement + text.slice(first + find.length);
}
