/**
 * 引用（docs/specs/canon/components.md 输出 18、19）：对象里哪些位置指向别的对象，以及写入请求里的临时 id 怎样换成正式 id。
 *
 * 两件事分开做，因为要的信息不同：
 * - 引用位置要知道字段声明（一个字段是不是 `ref`、一个列表是不是以引用为键），只在发布时、对写入后的对象算；
 *   算出来的“这次新写或改过的引用”存进修订的 `refs`，依赖与改动记录按条目筛只读那一份，插件停用以后不变。
 * - 临时 id 的替换不看声明：`tmp:` 开头的 id 是保留的写法，写入请求里任何一个与这次发出的临时 id 完全相同的字符串，
 *   以及地址路径里的 `[临时 id]` 段，都换成正式 id。替换的范围因此天然包含全部引用位置，也包含对象自己的 id、
 *   以引用为键的列表在地址路径里的元素 id 这些不算引用的位置。
 */

import {markReferences, type MarkRegistry, type MarkTarget} from "../components/marks";
import {effectiveFields, type ComponentRegistry} from "../components/registry";
import {parsePath} from "../core/address";
import type {Check, Decision, Entry, FieldDeclaration, Mark, ObjectKind, Patch, StoryChange, Telling} from "../core/schema";

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

/** 一个对象里的全部引用（components.md 输出 18 的表；参与者、时间与分叉的位置随各自的能力加进来）。 */
export function referencesOf(kind: ObjectKind, value: unknown, context: ReferenceContext): Reference[] {
    if (value === null || typeof value !== "object") return [];
    const found: Reference[] = [];
    const add = (path: string, target: RefTargetKind, id: unknown, checked: boolean, targets?: readonly string[]) => {
        if (typeof id === "string" && id !== "") found.push({path, target: {kind: target, id}, checked, ...(targets === undefined ? {} : {targets})});
    };
    const record = value as Record<string, unknown>;
    if (kind === "entry") {
        const entry = value as Entry;
        add("parent", "entry", entry.parent, false);
        add("sameAs", "entry", entry.sameAs, false);
        for (const [address, basis] of Object.entries(entry.initBasis ?? {})) if (basis.kind === "derived") add(`initBasis[${JSON.stringify(address)}].check`, "check", basis.check, false);
        for (const [namespace, data] of Object.entries(entry.init?.data ?? {})) {
            const fields = fieldsOf(context.registry, entry, namespace);
            if (fields === undefined) continue;
            for (const field of fields) fieldReferences(`init.data.${namespace}.fields.${field.id}`, field, data.fields[field.id], add);
        }
    }
    if (kind === "change") {
        for (const [index, id] of ((record.involves as unknown[] | undefined) ?? []).entries()) add(`involves[${String(index)}]`, "entry", id, true);
        for (const [index, id] of ((record.lines as unknown[] | undefined) ?? []).entries()) add(`lines[${String(index)}]`, "entry", id, false);
        for (const [index, link] of ((record.links as Array<Record<string, unknown>> | undefined) ?? []).entries()) {
            add(`links[${String(index)}].plan`, "change", link.plan, false);
            add(`links[${String(index)}].by`, "change", link.by, false);
        }
        for (const [index, patch] of ((record.patches as Patch[] | undefined) ?? []).entries()) {
            // 地址里的条目算引用（依赖、按条目筛），但它在不在由补丁能不能套上判断，不报 ref-invalid。
            add(`patches[${String(index)}].at.entry`, "entry", patch.at?.entry, false);
            if (patch.basis?.kind === "derived") add(`patches[${String(index)}].basis.check`, "check", patch.basis.check, false);
            patchReferences(`patches[${String(index)}].value`, patch, context, add);
        }
    }
    if (kind === "check") {
        add("at.entry", "entry", (record.at as {entry?: unknown} | undefined)?.entry, false);
        add("anchor.change", "change", (record.anchor as {change?: unknown} | undefined)?.change, false);
    }
    if (kind === "decision") {
        for (const [index, about] of ((record.about as Array<Record<string, unknown>> | undefined) ?? []).entries()) {
            const path = `about[${String(index)}]`;
            if (about.kind === "entry") add(`${path}.id`, "entry", about.id, false);
            if (about.kind === "address") add(`${path}.at.entry`, "entry", (about.at as {entry?: unknown} | undefined)?.entry, false);
            if (about.kind === "change") add(`${path}.id`, "change", about.id, false);
            if (about.kind === "decision") add(`${path}.id`, "decision", about.id, false);
        }
        add("supersededBy", "decision", record.supersededBy, false);
    }
    if (kind === "suggestion") {
        const target = record.target as {kind?: unknown; entry?: unknown} | undefined;
        if (target?.kind === "entryText") add("target.entry", "entry", target.entry, true);
    }
    // 标注载荷里的引用：只认种类登记着、版本对得上的标注；只读的标注不会是新写的，它的引用在写入它的那次修订里存过。
    for (const location of marksIn(kind, value)) {
        for (const [index, mark] of location.marks.entries()) {
            const type = context.marks.byKind(mark.kind);
            if (type === undefined || type.version !== mark.version) continue;
            for (const reference of markReferences(type, mark, `${location.path}[${String(index)}]`)) add(reference.path, reference.kind, reference.id, true, reference.targets);
        }
    }
    return found;
}

/** 对象里挂标注的位置（model.md 输出 28）：`key` 在改前改后之间认同一个位置（讲述按讲述 id），`path` 给诊断看。 */
export interface MarkLocation {
    readonly owner: MarkTarget;
    readonly key: string;
    readonly path: string;
    readonly marks: readonly Mark[];
}

export function marksIn(kind: ObjectKind, value: unknown): MarkLocation[] {
    if (value === null || typeof value !== "object") return [];
    const found: MarkLocation[] = [];
    const tellings = (base: string, list: readonly Telling[] | undefined) => {
        for (const telling of list ?? []) if (telling.marks !== undefined) found.push({owner: "telling", key: `${base}[${telling.id}]`, path: `${base}[${telling.id}].marks`, marks: telling.marks});
    };
    if (kind === "change") {
        const change = value as StoryChange;
        if (change.marks !== undefined) found.push({owner: "change", key: "", path: "marks", marks: change.marks});
        tellings("told", change.told);
    }
    if (kind === "check") {
        const told = (value as Check).told;
        if (told?.marks !== undefined) found.push({owner: "telling", key: "told", path: "told.marks", marks: told.marks});
    }
    if (kind === "entry") for (const [address, list] of Object.entries((value as Entry).retold ?? {})) tellings(`retold[${JSON.stringify(address)}]`, list);
    if (kind === "decision") {
        const decision = value as Decision;
        if (decision.marks !== undefined) found.push({owner: "decision", key: "", path: "marks", marks: decision.marks});
    }
    return found;
}

type Add = (path: string, target: RefTargetKind, id: unknown, checked: boolean, targets?: readonly string[]) => void;

/** 一个字段的值里的引用：`ref` 字段、以引用为键的列表的元素、列表元素里的 `ref` 子字段。 */
function fieldReferences(path: string, field: FieldDeclaration, value: unknown, add: Add): void {
    if (field.kind === "ref") add(`${path}.ref`, "entry", (value as {ref?: unknown} | null)?.ref, true, field.targets);
    if (field.kind !== "list" || !Array.isArray(value)) return;
    for (const element of value as Array<Record<string, unknown>>) elementReferences(`${path}[${String(element.id)}]`, field, element, add);
}

function elementReferences(path: string, field: FieldDeclaration, element: Record<string, unknown>, add: Add): void {
    if (field.keyedBy === "ref") add(path, "entry", element.id, true, field.targets);
    for (const sub of field.item ?? []) if (sub.kind === "ref") add(`${path}.${sub.id}.ref`, "entry", (element[sub.id] as {ref?: unknown} | null | undefined)?.ref, true, sub.targets);
}

/** 补丁的值里的引用：按它指到的字段的声明判断（字段不在声明里的补丁由补丁的校验报，这里不管）。 */
function patchReferences(path: string, patch: Patch, context: ReferenceContext, add: Add): void {
    const parsed = parsePath(patch.at.path);
    if (parsed === null || parsed.root !== "namespace") return;
    const target = context.entry(patch.at.entry);
    const field = target === undefined ? undefined : fieldsOf(context.registry, target, parsed.namespace)?.find((candidate) => candidate.id === parsed.field);
    if (field === undefined) return;
    if (parsed.element === undefined) {
        if (patch.op === "set") fieldReferences(path, field, patch.value, add);
        if (patch.op === "listAdd" && patch.value !== null && typeof patch.value === "object") elementReferences(path, field, patch.value as Record<string, unknown>, add);
        return;
    }
    if (patch.op !== "set") return;
    if (parsed.sub === undefined && patch.value !== null && typeof patch.value === "object") {
        elementReferences(path, field, patch.value as Record<string, unknown>, add);
        return;
    }
    const sub = field.item?.find((candidate) => candidate.id === parsed.sub);
    if (sub?.kind === "ref") add(`${path}.ref`, "entry", (patch.value as {ref?: unknown} | null)?.ref, true, sub.targets);
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
 * 把临时 id 换成正式 id：与 `ids` 里某个临时 id 完全相同的字符串换掉；地址（同时有 `entry` 与 `path` 的对象）的路径里，
 * 方括号里的临时 id 段换掉（以引用为键的列表的元素，`know.知情[tmp:k].程度`）。别的文字里碰巧包含临时 id 的不换。
 */
export function replaceTempIds<T>(value: T, ids: Readonly<Record<string, string>>): T {
    if (Object.keys(ids).length === 0) return value;
    const walk = (item: unknown): unknown => {
        if (typeof item === "string") return ids[item] ?? item;
        if (Array.isArray(item)) return item.map(walk);
        if (item === null || typeof item !== "object") return item;
        const record = item as Record<string, unknown>;
        const isAddress = typeof record.entry === "string" && typeof record.path === "string";
        return Object.fromEntries(Object.entries(record).map(([key, child]) => [key, isAddress && key === "path" ? replacePathSegments(child as string, ids) : walk(child)]));
    };
    return walk(value) as T;
}

function replacePathSegments(path: string, ids: Readonly<Record<string, string>>): string {
    return path.replace(/\[([^\]]+)\]/gu, (whole, id: string) => (ids[id] === undefined ? whole : `[${ids[id]}]`));
}

/** 写入时校验一条新写或改过的、由本模块负责的引用（components.md 输出 18 的 `ref-invalid`）；合格返回 null。 */
export function referenceProblem(reference: Reference, exists: {readonly entry: (id: string) => Entry | undefined; readonly change: (id: string) => boolean; readonly decision: (id: string) => boolean; readonly check: (id: string) => boolean}): string | null {
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
    // 分叉还没有实现，只有主线（canon/worldlines.md 输出 1）。
    return id === "main" ? null : "line-not-found";
}
