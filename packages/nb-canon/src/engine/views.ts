/**
 * 参照实现与增量引擎共用的“把一个条目在某个位置的折叠结果拼成读取结果”（docs/specs/canon/model.md 输出 5、9、11、14，
 * components.md 输出 6、11、12）。两种引擎只在“怎样得到这个位置上的状态”上不同，拼法共用，差分测试比较的就是前者。
 */

import type {ComponentRegistry} from "../components/registry";
import {semanticText} from "../components/values";
import {ENABLE_FIELD} from "../core/identifiers";
import {placementRank, rankBefore, type ChapterOrder, type Rank} from "../core/position";
import type {Address, Entry, EntryState, FieldDeclaration, Placement} from "../core/schema";
import {incompleteAt, namespaceAvailability, namespaceFields, type IncompleteEvent} from "../model/apply";
import type {EntryView, FieldState, NamespaceView, ReductionLookup, UpcomingNamespace} from "./types";

/** 一个条目在某个位置上的折叠结果。 */
export interface EntryFold {
    readonly state: EntryState;
    /** 语义档字段在当前起点之后的事件，按路径。 */
    readonly events: ReadonlyMap<string, readonly string[]>;
    readonly incomplete: readonly IncompleteEvent[];
}

export interface ViewContext {
    readonly order: ChapterOrder;
    readonly registry: ComponentRegistry;
    readonly reductions: ReductionLookup;
    /** 这个位置之前、对这个地址最近一次核对的结果；不符时返回正文写的数。 */
    readonly textSays: (at: Address) => number | undefined;
    /** 这个位置上没启用的命名空间之后由哪条变更启用、启用后的值（components.md 输出 6）。 */
    readonly upcoming: (namespace: string) => {readonly from: Placement; readonly fields: Readonly<Record<string, unknown>>} | null;
    /** 别的条目在同一个位置上的名字（以引用为键的列表的元素名，components.md 输出 19）；条目不存在时为 undefined。 */
    readonly nameOf: (entry: string) => {readonly name: string; readonly deleted: boolean} | undefined;
}

/** 以引用为键的列表的元素不存 `label`，读取时取被引用条目在这个位置上的名字；条目已删除时是“已删除的条目”。 */
export const DELETED_ENTRY_LABEL = "已删除的条目";

function labelKeyedElements(value: unknown, context: ViewContext): unknown {
    if (!Array.isArray(value)) return value;
    return (value as Array<Record<string, unknown>>).map((element) => {
        const referenced = context.nameOf(String(element.id));
        return {...element, label: referenced === undefined || referenced.deleted ? DELETED_ENTRY_LABEL : referenced.name};
    });
}

export function buildEntryView(entry: Entry, fold: EntryFold | undefined, position: Rank, context: ViewContext): EntryView {
    const appeared = entry.appears === undefined || (() => {
        const rank = placementRank(context.order, entry.appears);
        return rank !== null && rankBefore(rank, position);
    })();
    if (entry.deleted === true || fold === undefined) {
        return {id: entry.id, deleted: true, appeared, name: entry.init.name, aliases: [], summary: "", text: [], namespaces: {}, upcoming: [], components: []};
    }
    const {state} = fold;
    const namespaces: Record<string, NamespaceView> = {};
    const upcoming: UpcomingNamespace[] = [];
    for (const [namespace, data] of Object.entries(state.data)) {
        if (data.removed === true) continue;
        const availability = namespaceAvailability(context.registry, namespace, data);
        if (!data.enabled) {
            if (availability === "ok") {
                const next = context.upcoming(namespace);
                if (next !== null) upcoming.push({namespace, from: next.from, fields: next.fields});
            }
            continue;
        }
        const fields: Record<string, FieldState> = {};
        const declarations = namespaceFields(context.registry, namespace, data);
        const ids = availability === "ok" ? declarations.map((field) => field.id) : Object.keys(data.fields);
        for (const fieldId of ids) {
            const field = declarations.find((candidate) => candidate.id === fieldId);
            const path = `${namespace}.${fieldId}`;
            const incomplete = incompleteAt(fold.incomplete, path);
            const textSays = context.textSays({entry: entry.id, path});
            const raw = fieldValue(fold, namespace, data.type, field, data.fields[fieldId] ?? null, context.reductions);
            const base = field?.kind === "list" && field.keyedBy === "ref" ? {...raw, value: labelKeyedElements(raw.value, context)} : raw;
            fields[fieldId] = {...base, ...(incomplete === undefined ? {} : {incomplete}), ...(textSays === undefined ? {} : {textSays})};
        }
        namespaces[namespace] = {type: data.type, version: data.version, ...(availability === "ok" ? {} : {readOnly: availability}), fields};
    }
    return {
        id: entry.id,
        deleted: false,
        appeared,
        name: state.name,
        aliases: [...state.aliases],
        summary: state.summary,
        text: state.text.map((block) => ({...block})),
        namespaces,
        upcoming,
        components: [...(state.components ?? [])],
    };
}

/** 语义档的值：没有事件时是起点，有事件时查归纳缓存，没有就写成“起点；之后：……”并标未归纳（model.md 输出 9）。 */
export function fieldValue(
    fold: Pick<EntryFold, "events">,
    namespace: string,
    type: string,
    field: FieldDeclaration | undefined,
    raw: unknown,
    reductions: ReductionLookup,
): {value: unknown; notReduced?: true; unreduced?: {anchor: string | null; events: number}} {
    if (field?.kind === "list" && Array.isArray(raw) && (field.item ?? []).some((sub) => sub.precision === "semantic")) return listValue(fold, namespace, type, field, raw as Array<Record<string, unknown>>, reductions);
    if (field?.precision !== "semantic") return {value: structuredClone(raw)};
    return semanticValue(fold.events.get(`${namespace}.${field.id}`) ?? [], type, field, field.id, raw, reductions);
}

/** 语义档的一个值（字段或列表元素的子字段）：起点加事件，有归纳取归纳，没有就写成“起点；之后：……”。 */
function semanticValue(events: readonly string[], type: string, field: FieldDeclaration, reductionField: string, raw: unknown, reductions: ReductionLookup): {value: unknown; notReduced?: true; unreduced?: {anchor: string | null; events: number}} {
    const anchor = raw === null || raw === undefined ? null : semanticText(field, raw as string | number);
    if (events.length === 0) return {value: anchor};
    const reduced = reductions({type, field: reductionField, label: field.label, kind: field.kind, ...(field.unit === undefined ? {} : {unit: field.unit}), anchor, events: [...events]});
    if (reduced !== undefined) return {value: reduced};
    return {value: `${anchor ?? "未知"}；之后：${events.join("；")}`, notReduced: true, unreduced: {anchor, events: events.length}};
}

/**
 * 带语义档子字段的列表（components.md 输出 20）：每个元素的语义档子字段按它自己的地址取事件与归纳。有一个还没归纳，
 * 整个字段标“未归纳”（列表的值里那个子字段是“起点；之后：……”的写法）。
 */
function listValue(fold: Pick<EntryFold, "events">, namespace: string, type: string, field: FieldDeclaration, raw: readonly Record<string, unknown>[], reductions: ReductionLookup): {value: unknown; notReduced?: true} {
    let notReduced = false;
    const value = raw.map((element) => {
        const next: Record<string, unknown> = structuredClone(element);
        for (const sub of field.item ?? []) {
            if (sub.precision !== "semantic") continue;
            const events = fold.events.get(`${namespace}.${field.id}[${String(element.id)}].${sub.id}`) ?? [];
            // 没写过、也没有事件的子字段照原样不出现，与别的子字段一样。
            if (!(sub.id in element) && events.length === 0) continue;
            const result = semanticValue(events, type, sub, `${field.id}.${sub.id}`, element[sub.id] ?? null, reductions);
            next[sub.id] = result.value;
            if (result.notReduced === true) notReduced = true;
        }
        return next;
    });
    return notReduced ? {value, notReduced: true} : {value};
}

/** 一个条目折叠状态里某个地址的值；不存在时为 undefined。 */
export function readEntryAddress(state: EntryState | undefined, path: string): unknown {
    if (state === undefined) return undefined;
    if (path.startsWith("entry.")) return state[path.slice(6) as "name" | "aliases" | "summary"];
    const block = /^text\[(.+)\]$/u.exec(path);
    if (block !== null) return state.text.find((candidate) => candidate.id === block[1])?.source;
    const match = /^([^.[\]]+)\.([^.[\]]+)(?:\[([^.[\]]+)\](?:\.([^.[\]]+))?)?$/u.exec(path);
    if (match === null) return undefined;
    const [, namespace, field, element, sub] = match as unknown as [string, string, string, string | undefined, string | undefined];
    const data = state.data[namespace];
    if (data === undefined) return undefined;
    if (field === ENABLE_FIELD) return data.enabled;
    const value = data.fields[field] ?? null;
    if (element === undefined) return value;
    const item = Array.isArray(value) ? (value as Array<Record<string, unknown>>).find((candidate) => candidate.id === element) : undefined;
    if (item === undefined) return undefined;
    return sub === undefined ? item : (item[sub] ?? null);
}
