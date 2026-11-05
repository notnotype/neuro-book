/**
 * 引用（docs/specs/canon/components.md 输出 18、19）：对象里哪些位置指向别的对象，以及写入请求里的临时 id 怎样换成正式 id。
 *
 * 两件事走同一份引用位置的遍历（`walkReferences`），都要知道字段声明（一个字段是不是 `ref`、一个列表是不是以引用为键）：
 * - 列出引用：发布时对写入后的对象算，“这次新写或改过的引用”存进修订的 `refs`，依赖与改动记录按条目筛只读那一份，
 *   插件停用以后不变。
 * - 替换临时 id：在引用位置上，加上对象自己的 id、地址路径段与诊断稳定键这几个不算引用的位置；别处的 `tmp:` 文字原样存下。
 */

import {markReferences, type MarkRegistry, type MarkTarget} from "../components/marks";
import {effectiveFields, type ComponentRegistry} from "../components/registry";
import {parsePath} from "../core/address";
import type {Check, Decision, Entry, FieldDeclaration, Mark, ObjectKind, ObjectRef, Patch, StoryChange, Telling, WriteRequest} from "../core/schema";

export type RefTargetKind = "entry" | "change" | "line" | "decision" | "check";

export interface Reference {
    /** 对象里的位置，给诊断与作者看；同一对象里同一位置、同一目标是同一条引用。 */
    readonly path: string;
    readonly target: {readonly kind: RefTargetKind; readonly id: string};
    /**
     * 这个位置的目标在不在、种类对不对，由写入时的 `ref-invalid` 查；为 false 的位置另有专门的校验与失败码（条目树、
     * 剧情线、连接、依据、决策挂的对象），这里不重复报。
     */
    readonly checked: boolean;
    /** 允许的条目种类（只对指向条目的位置）；没有时任何种类都行。 */
    readonly targets?: readonly string[];
}

export interface ReferenceContext {
    readonly registry: ComponentRegistry;
    /** 标注种类的登记：标注载荷里哪些路径是引用由它声明（components.md 输出 17）。 */
    readonly marks: MarkRegistry;
    /** 写入以后的世界里的条目；补丁指到的字段声明从它取。 */
    readonly entry: (id: string) => Entry | undefined;
}

/**
 * 引用位置上的一个值：在 `holder[key]`。列出引用时只读它，替换临时 id 时就地改它（替换在复制出来的请求上做）。
 */
interface Slot {
    readonly path: string;
    readonly target: RefTargetKind;
    readonly checked: boolean;
    readonly targets?: readonly string[];
    readonly holder: Record<string | number, unknown>;
    readonly key: string | number;
}

type Visit = (slot: Slot) => void;

/**
 * 按 components.md 输出 18 的表走一遍对象里的引用位置（参与者、时间与分叉的位置随各自的能力加进来）。补丁的值与条目的
 * 字段要看字段声明，补丁指到的条目从 `context.entry` 取。
 */
function walkReferences(kind: ObjectKind, value: unknown, context: ReferenceContext, visit: Visit): void {
    if (value === null || typeof value !== "object") return;
    const add = (path: string, target: RefTargetKind, holder: unknown, key: string | number, checked: boolean, targets?: readonly string[]) => {
        if (holder === null || typeof holder !== "object") return;
        const id = (holder as Record<string | number, unknown>)[key];
        if (typeof id === "string" && id !== "") visit({path, target, checked, ...(targets === undefined ? {} : {targets}), holder: holder as Record<string | number, unknown>, key});
    };
    const list = (path: string, target: RefTargetKind, items: unknown, checked: boolean) => {
        if (Array.isArray(items)) for (const index of items.keys()) add(`${path}[${String(index)}]`, target, items, index, checked);
    };
    const record = value as Record<string, unknown>;
    if (kind === "entry") {
        const entry = value as Entry;
        add("parent", "entry", entry, "parent", false);
        add("sameAs", "entry", entry, "sameAs", false);
        for (const [address, basis] of Object.entries(entry.initBasis ?? {})) if (basis.kind === "derived") add(`initBasis[${JSON.stringify(address)}].check`, "check", basis, "check", false);
        for (const [namespace, data] of Object.entries(entry.init?.data ?? {})) {
            const fields = fieldsOf(context.registry, entry, namespace);
            if (fields === undefined) continue;
            for (const field of fields) fieldReferences(`init.data.${namespace}.fields.${field.id}`, field, data.fields, field.id, add);
        }
    }
    if (kind === "change") {
        // 安放的线（canon/worldlines.md）：要存在；分叉的父线、切口、触发处、结束点与带过去的人由分叉的校验报 invalid-fork。
        add("at.line", "line", record.at, "line", true);
        const fork = record.fork as Record<string, unknown> | undefined;
        add("fork.parent", "line", fork, "parent", false);
        add("fork.cut", "change", fork, "cut", false);
        add("fork.trigger", "change", fork, "trigger", false);
        add("fork.endAt", "change", fork, "endAt", false);
        add("fork.who", "entry", fork, "who", false);
        for (const [index, address] of objectItems(fork?.carry)) add(`fork.carry[${String(index)}].entry`, "entry", address, "entry", false);
        list("involves", "entry", record.involves, true);
        list("lines", "entry", record.lines, false);
        for (const [index, member] of objectItems(record.cast)) {
            add(`cast[${String(index)}].who`, "entry", member, "who", true);
            add(`cast[${String(index)}].as`, "entry", member, "as", true);
        }
        for (const [index, link] of objectItems(record.links)) {
            add(`links[${String(index)}].plan`, "change", link, "plan", false);
            add(`links[${String(index)}].by`, "change", link, "by", false);
        }
        // 时间说法指的变更与人（canon.time 输出 9）：存在与否由时间的校验报 invalid-time，这里不另报 ref-invalid。
        for (const [index, statement] of objectItems(record.when)) {
            add(`when[${String(index)}].of`, "change", statement, "of", false);
            add(`when[${String(index)}].who`, "entry", statement, "who", false);
        }
        for (const [index, item] of objectItems(record.patches)) {
            const patch = item as unknown as Patch;
            if (patch.at === null || typeof patch.at !== "object") continue;
            // 先按补丁指到的条目找字段声明，再访问地址里的条目：替换会把它改成正式 id。
            patchReferences(`patches[${String(index)}]`, patch, context, add);
            // 地址里的条目算引用（依赖、按条目筛），但它在不在由补丁能不能套上判断，不报 ref-invalid。
            add(`patches[${String(index)}].at.entry`, "entry", patch.at, "entry", false);
            if (patch.basis?.kind === "derived") add(`patches[${String(index)}].basis.check`, "check", patch.basis, "check", false);
        }
    }
    if (kind === "check") {
        add("place.line", "line", record.place, "line", true);
        add("at.entry", "entry", record.at, "entry", false);
        add("anchor.change", "change", record.anchor, "change", false);
    }
    if (kind === "decision") {
        for (const [index, about] of ((record.about as Array<Record<string, unknown>> | undefined) ?? []).entries()) {
            const path = `about[${String(index)}]`;
            if (about.kind === "entry") add(`${path}.id`, "entry", about, "id", false);
            if (about.kind === "address") add(`${path}.at.entry`, "entry", about.at, "entry", false);
            if (about.kind === "change") add(`${path}.id`, "change", about, "id", false);
            if (about.kind === "decision") add(`${path}.id`, "decision", about, "id", false);
        }
        add("supersededBy", "decision", record, "supersededBy", false);
    }
    if (kind === "suggestion") {
        const target = record.target as {kind?: unknown} | undefined;
        if (target?.kind === "entryText") add("target.entry", "entry", target, "entry", true);
    }
    // 标注载荷里的引用：只认种类登记着、版本对得上的标注；只读的标注不会是新写的，它的引用在写入它的那次修订里存过。
    for (const location of marksIn(kind, value)) {
        for (const [index, mark] of location.marks.entries()) {
            const type = context.marks.byKind(mark.kind);
            if (type === undefined || type.version !== mark.version) continue;
            for (const reference of markReferences(type, mark, `${location.path}[${String(index)}]`)) add(reference.path, reference.kind, reference.holder, reference.key, true, reference.targets);
        }
    }
}

/** 一个对象里的全部引用（components.md 输出 18）。 */
export function referencesOf(kind: ObjectKind, value: unknown, context: ReferenceContext): Reference[] {
    const found: Reference[] = [];
    walkReferences(kind, value, context, (slot) => {
        found.push({path: slot.path, target: {kind: slot.target, id: slot.holder[slot.key] as string}, checked: slot.checked, ...(slot.targets === undefined ? {} : {targets: slot.targets})});
    });
    return found;
}

/** 对象里挂标注的位置（model.md 输出 28）：`key` 在改前改后之间认同一个位置（讲述按讲述 id），`path` 给诊断看。 */
export interface MarkLocation {
    readonly owner: MarkTarget;
    readonly key: string;
    readonly path: string;
    readonly marks: readonly Mark[];
    /** 挂在讲述上时，那条讲述的 id。 */
    readonly telling?: string;
}

export function marksIn(kind: ObjectKind, value: unknown): MarkLocation[] {
    if (value === null || typeof value !== "object") return [];
    const found: MarkLocation[] = [];
    const tellings = (base: string, list: readonly Telling[] | undefined) => {
        for (const [, telling] of objectItems(list) as [number, Telling][]) if (telling.marks !== undefined) found.push({owner: "telling", key: `${base}[${telling.id}]`, path: `${base}[${telling.id}].marks`, marks: telling.marks, telling: telling.id});
    };
    if (kind === "change") {
        const change = value as StoryChange;
        if (change.marks !== undefined) found.push({owner: "change", key: "", path: "marks", marks: change.marks});
        tellings("told", change.told);
    }
    if (kind === "check") {
        const told = (value as Check).told;
        if (told?.marks !== undefined) found.push({owner: "telling", key: "told", path: "told.marks", marks: told.marks, telling: told.id});
    }
    const retold = (value as Entry).retold;
    if (kind === "entry" && retold !== null && typeof retold === "object") for (const [address, list] of Object.entries(retold)) tellings(`retold[${JSON.stringify(address)}]`, list);
    if (kind === "decision") {
        const decision = value as Decision;
        if (decision.marks !== undefined) found.push({owner: "decision", key: "", path: "marks", marks: decision.marks});
    }
    return found;
}

type Add = (path: string, target: RefTargetKind, holder: unknown, key: string | number, checked: boolean, targets?: readonly string[]) => void;

/** 一个字段的值（在 `holder[key]`）里的引用：`ref` 字段、以引用为键的列表的元素、列表元素里的 `ref` 子字段。 */
function fieldReferences(path: string, field: FieldDeclaration, holder: unknown, key: string | number, add: Add): void {
    const value = holder !== null && typeof holder === "object" ? (holder as Record<string | number, unknown>)[key] : undefined;
    if (field.kind === "ref") add(`${path}.ref`, "entry", value, "ref", true, field.targets);
    if (field.kind !== "list" || !Array.isArray(value)) return;
    for (const element of value as Array<Record<string, unknown>>) elementReferences(`${path}[${String(element.id)}]`, field, element, add);
}

function elementReferences(path: string, field: FieldDeclaration, element: Record<string, unknown>, add: Add): void {
    if (field.keyedBy === "ref") add(path, "entry", element, "id", true, field.targets);
    for (const sub of field.item ?? []) if (sub.kind === "ref") add(`${path}.${sub.id}.ref`, "entry", element[sub.id], "ref", true, sub.targets);
}

/**
 * 补丁的值里的引用：按它指到的字段的声明判断（字段不在声明里的补丁由补丁的校验报，这里不管）。以引用为键的列表上，
 * `listRemove` 的值是元素 id，也就是条目 id：算引用，但去掉一行时那个条目在不在不要紧，不报 ref-invalid。
 */
function patchReferences(base: string, patch: Patch, context: ReferenceContext, add: Add): void {
    const parsed = parsePath(patch.at?.path ?? "");
    if (parsed === null || parsed.root !== "namespace") return;
    const target = context.entry(patch.at.entry);
    const field = target === undefined ? undefined : fieldsOf(context.registry, target, parsed.namespace)?.find((candidate) => candidate.id === parsed.field);
    if (field === undefined) return;
    const path = `${base}.value`;
    if (parsed.element === undefined) {
        if (patch.op === "set") fieldReferences(path, field, patch, "value", add);
        if (patch.op === "listAdd" && patch.value !== null && typeof patch.value === "object") elementReferences(path, field, patch.value as Record<string, unknown>, add);
        if (patch.op === "listRemove" && field.keyedBy === "ref") add(path, "entry", patch, "value", false);
        return;
    }
    if (patch.op !== "set") return;
    if (parsed.sub === undefined && patch.value !== null && typeof patch.value === "object") {
        elementReferences(path, field, patch.value as Record<string, unknown>, add);
        return;
    }
    const sub = field.item?.find((candidate) => candidate.id === parsed.sub);
    if (sub?.kind === "ref") add(`${path}.ref`, "entry", patch.value, "ref", true, sub.targets);
}

function fieldsOf(registry: ComponentRegistry, entry: Entry, namespace: string): readonly FieldDeclaration[] | undefined {
    const data = entry.init?.data?.[namespace];
    const type = registry.byNamespace(namespace);
    if (data === undefined || type === undefined || type.id !== data.type) return undefined;
    return effectiveFields(type, data.declared);
}

/** 同一位置、同一目标是同一条引用；用来算“这次新写或改过的引用”。 */
export function referenceKey(reference: Reference): string {
    return `${reference.path}\u0000${reference.target.kind}\u0000${reference.target.id}`;
}

/** `after` 里有、`before` 里没有的引用（新写的，或同一位置改成指向别处的）。 */
export function newReferences(before: readonly Reference[], after: readonly Reference[]): Reference[] {
    const old = new Set(before.map(referenceKey));
    return after.filter((reference) => !old.has(referenceKey(reference)));
}

/**
 * 把写入请求里的临时 id 换成正式 id（components.md 输出 18）：只换引用位置上的、对象自己的 id、地址路径里的
 * `[临时 id]` 段（以引用为键的列表的元素，`know.知情[tmp:k].程度`）、地址做键的地方（`retold`、`initBasis`）与
 * 决策挂的诊断稳定键里的对象。不在这些位置上的 `tmp:` 文字原样存下。`context.entry` 按请求里写的 id（临时 id 也行）
 * 取条目，补丁的值要按它的字段声明判断是不是引用。
 */
export function replaceRequestTempIds(request: WriteRequest, ids: Readonly<Record<string, string>>, context: ReferenceContext): WriteRequest {
    if (Object.keys(ids).length === 0) return request;
    const copy = structuredClone(request) as {puts: {ref: ObjectRef; after: unknown}[]; reads?: {at: {entry: string; path: string}}[]};
    const swap = (id: unknown) => (typeof id === "string" ? (ids[id] ?? id) : id);
    const swapAddress = (at: {entry?: unknown; path?: unknown} | undefined) => {
        if (at === undefined || at === null || typeof at !== "object") return;
        at.entry = swap(at.entry);
        if (typeof at.path === "string") at.path = replacePathSegments(at.path, ids);
    };
    const swapKeys = (record: Record<string, unknown> | undefined) => (record === undefined ? undefined : Object.fromEntries(Object.entries(record).map(([key, value]) => [replacePathSegments(key, ids), value])));
    for (const put of copy.puts) {
        put.ref = {...put.ref, id: swap(put.ref.id) as string};
        const after = put.after as Record<string, unknown> | null;
        if (after === null || typeof after !== "object") continue;
        // 地址路径段与诊断稳定键不是引用位置，先换；引用位置随后按声明换（补丁要先按原来的条目 id 找字段声明）。
        if (put.ref.kind === "change") {
            for (const [, patch] of objectItems(after.patches)) {
                const at = patch.at as {path?: unknown} | null | undefined;
                if (at !== null && typeof at === "object" && typeof at.path === "string") patch.at = {...at, path: replacePathSegments(at.path, ids)};
            }
        }
        if (put.ref.kind === "check") swapAddress(after.at as {entry?: unknown; path?: unknown});
        // 分叉的 `fork.line` 是线的定义而不是引用，单独换。
        const fork = put.ref.kind === "change" ? (after.fork as {line?: unknown} | null | undefined) : undefined;
        if (fork !== null && typeof fork === "object" && typeof fork.line === "string") fork.line = swap(fork.line);
        if (put.ref.kind === "entry") {
            if (after.retold !== undefined) after.retold = swapKeys(after.retold as Record<string, unknown>);
            if (after.initBasis !== undefined) after.initBasis = swapKeys(after.initBasis as Record<string, unknown>);
        }
        if (put.ref.kind === "decision") {
            for (const [, about] of objectItems(after.about)) {
                if (about.kind === "address") swapAddress(about.at as {entry?: unknown; path?: unknown});
                const objects = (about.key as {objects?: Array<{id?: unknown}>} | undefined)?.objects;
                if (about.kind === "diagnostic" && Array.isArray(objects)) for (const object of objects) if (object !== null && typeof object === "object") object.id = swap(object.id);
            }
        }
        walkReferences(put.ref.kind, after, context, (slot) => {
            slot.holder[slot.key] = swap(slot.holder[slot.key]);
        });
        after.id = swap(after.id);
    }
    for (const read of copy.reads ?? []) swapAddress(read.at);
    return copy as unknown as WriteRequest;
}

function replacePathSegments(path: string, ids: Readonly<Record<string, string>>): string {
    return path.replace(/\[([^\]]+)\]/gu, (whole, id: string) => (ids[id] === undefined ? whole : `[${ids[id]}]`));
}

/** 写入时校验一条新写或改过的、由本模块负责的引用（components.md 输出 18 的 `ref-invalid`）；合格返回 null。 */
export function referenceProblem(reference: Reference, exists: {readonly entry: (id: string) => Entry | undefined; readonly change: (id: string) => boolean; readonly decision: (id: string) => boolean; readonly check: (id: string) => boolean; readonly line: (id: string) => boolean}): string | null {
    const {kind, id} = reference.target;
    if (kind === "entry") {
        const entry = exists.entry(id);
        if (entry === undefined) return "entry-missing";
        if (entry.deleted === true) return "entry-deleted";
        if (reference.targets !== undefined && !reference.targets.includes(entry.type)) return "ref-type-mismatch";
        return null;
    }
    if (kind === "change") return exists.change(id) ? null : "change-missing";
    if (kind === "decision") return exists.decision(id) ? null : "decision-missing";
    if (kind === "check") return exists.check(id) ? null : "check-missing";
    // 线至少在按计划模式下存在（components.md 输出 18）；已写的记录落在计划线上另由线的规则报 line-planned。
    return exists.line(id) ? null : "line-not-found";
}

/** 列表里是对象的那些项与它们的下标。形状不对的输入（列表本身不是数组，或项是 `null`、字符串）在这里跳过，由之后的形状校验报 `type-mismatch`。 */
export function objectItems(items: unknown): [number, Record<string, unknown>][] {
    return Array.isArray(items) ? [...items.entries()].filter((pair): pair is [number, Record<string, unknown>] => pair[1] !== null && typeof pair[1] === "object") : [];
}
