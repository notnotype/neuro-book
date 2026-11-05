/**
 * 把一条剧情变更套到状态上（docs/specs/canon/model.md 输出 6、7、8、9）。
 *
 * 一条变更整条套上或整条不套：补丁先写进被涉及条目的草稿（第一次碰到时复制），全部套完、约束也检查过才写回；
 * 中途有一个补丁套不上就丢掉草稿，并把这条变更本来要改的地址从它的位置起标为不完整。同一条变更里先处理
 * `<命名空间>.启用`，再处理数据字段（components.md 输出 5）。
 *
 * 本模块只管“在当前状态上套一条变更”；事件的先后、读取位置由引擎决定。参照实现与增量引擎共用它，所以
 * 两者对一条变更的判定天然一致，差分测试比的是它们怎样安排先后与缓存。
 */

import {effectiveFields, type ComponentRegistry} from "../components/registry";
import {semanticText, valueProblem, listItemProblem} from "../components/values";
import {addressKey, parsePath, type ParsedPath} from "../core/address";
import {addExact} from "../core/decimal";
import {ENABLE_FIELD} from "../core/identifiers";
import type {Address, Entry, EntryState, FieldDeclaration, NamespaceData, Patch, StoryChange} from "../core/schema";
import type {ApplyFailure, IncompleteMark} from "../engine/types";

/** 不完整的标记与解除，按发生的先后记在条目上（输出 8）。`mark` 为 null 是解除。 */
export interface IncompleteEvent {
    readonly path: string;
    readonly mark: IncompleteMark | null;
}

/** 折叠中的可变状态。 */
export interface FoldState {
    /** 没删除的条目在当前位置的状态。 */
    readonly entries: Map<string, EntryState>;
    /** 语义档字段在当前起点之后的事件，按地址。 */
    readonly events: Map<string, string[]>;
    readonly incomplete: Map<string, IncompleteEvent[]>;
}

export interface ApplyContext {
    readonly registry: ComponentRegistry;
    readonly entry: (id: string) => Entry | undefined;
}

/** 补丁的结果；不适用时带原因，写入时据此给出对应的失败码（revisions.md 输出 3）。 */
export type PatchResult = "applied" | {readonly notApplicable: NotApplicable};

export type NotApplicable = "disabled" | "removed" | "component-unknown" | "component-version-unsupported" | "undeclared";

export type ChangeResult =
    | {readonly applied: true; readonly patches: readonly PatchResult[]}
    | {readonly applied: false; readonly reason: ApplyFailure; readonly failedPatch: number; readonly constrained?: Address};

/** 初值复制成折叠起点（删除的条目不进状态，对它的补丁套不上，输出 14）。 */
export function initialFoldState(entries: Iterable<Entry>): FoldState {
    const state: FoldState = {entries: new Map(), events: new Map(), incomplete: new Map()};
    for (const entry of entries) if (entry.deleted !== true) state.entries.set(entry.id, structuredClone(entry.init));
    return state;
}

export function applyChange(fold: FoldState, change: StoryChange, context: ApplyContext): ChangeResult {
    const drafts = new Map<string, EntryState>();
    const eventDrafts = new Map<string, string[]>();
    const results: PatchResult[] = new Array(change.patches.length);
    const touchedNamespaces = new Set<string>();
    const order = change.patches.map((patch, index) => ({patch, index})).sort((a, b) => Number(!isEnable(a.patch)) - Number(!isEnable(b.patch)));

    const draftOf = (id: string): EntryState | undefined => {
        let draft = drafts.get(id);
        if (draft === undefined) {
            const current = fold.entries.get(id);
            if (current === undefined) return undefined;
            draft = structuredClone(current);
            drafts.set(id, draft);
        }
        return draft;
    };
    const eventsOf = (key: string): string[] => {
        let list = eventDrafts.get(key);
        if (list === undefined) {
            list = [...(fold.events.get(key) ?? [])];
            eventDrafts.set(key, list);
        }
        return list;
    };

    for (const {patch, index} of order) {
        const entry = context.entry(patch.at.entry);
        const state = entry === undefined || entry.deleted === true ? undefined : draftOf(patch.at.entry);
        if (state === undefined) return fail(fold, change, "entry-missing", index);
        const parsed = parsePath(patch.at.path);
        if (parsed === null) return fail(fold, change, "type-mismatch", index);
        const outcome = applyPatch(state, parsed, patch, context.registry, (path) => eventsOf(addressKey({entry: patch.at.entry, path})));
        if (typeof outcome === "string" && outcome !== "applied") return fail(fold, change, outcome, index);
        results[index] = outcome;
        if (outcome === "applied" && parsed.root === "namespace") touchedNamespaces.add(`${patch.at.entry}\u0000${parsed.namespace}`);
    }

    for (const key of touchedNamespaces) {
        const [entryId, namespace] = key.split("\u0000") as [string, string];
        const violated = constraintViolation(drafts.get(entryId)!, namespace, context.registry);
        if (violated !== null) return fail(fold, change, "constraint-violated", -1, {entry: entryId, path: `${namespace}.${violated}`});
    }

    for (const [id, draft] of drafts) fold.entries.set(id, draft);
    for (const [key, list] of eventDrafts) fold.events.set(key, list);
    for (const [index, patch] of change.patches.entries()) {
        if (results[index] === "applied" && clearsIncomplete(patch)) recordIncomplete(fold, patch.at, null);
    }
    return {applied: true, patches: results};
}

function isEnable(patch: Patch): boolean {
    return patch.at.path.endsWith(`.${ENABLE_FIELD}`);
}

/** 不依赖旧值的写法解除不完整（输出 8）：赋值、整段替换、增删块；加减与事件不解除。 */
function clearsIncomplete(patch: Patch): boolean {
    return patch.op === "set" || patch.op === "replaceBlock" || patch.op === "addBlock" || patch.op === "removeBlock";
}

function fail(fold: FoldState, change: StoryChange, reason: ApplyFailure, failedPatch: number, constrained?: Address): ChangeResult {
    const mark: IncompleteMark = {change: change.id, reason};
    for (const patch of change.patches) recordIncomplete(fold, patch.at, mark);
    if (constrained !== undefined) recordIncomplete(fold, constrained, mark);
    return {applied: false, reason, failedPatch, ...(constrained === undefined ? {} : {constrained})};
}

function recordIncomplete(fold: FoldState, at: Address, mark: IncompleteMark | null): void {
    const list = fold.incomplete.get(at.entry);
    const event: IncompleteEvent = {path: at.path, mark};
    if (list === undefined) fold.incomplete.set(at.entry, [event]);
    else list.push(event);
}

/**
 * 一个地址在这些事件之后是否不完整：按先后看每个事件，覆盖它的标记设为不完整、覆盖它的解除设为完整；
 * 它下面的子地址被标记时它也算不完整（列表里有一个元素不可信，整个列表就不可信），子地址的解除不影响它。
 */
export function incompleteAt(events: readonly IncompleteEvent[] | undefined, path: string): IncompleteMark | undefined {
    if (events === undefined) return undefined;
    let current: IncompleteMark | undefined;
    for (const event of events) {
        if (covers(event.path, path)) current = event.mark ?? undefined;
        else if (event.mark !== null && covers(path, event.path)) current = event.mark;
    }
    return current;
}

function covers(outer: string, inner: string): boolean {
    if (outer === inner) return true;
    if (!inner.startsWith(outer)) return false;
    const next = inner[outer.length];
    return next === "." || next === "[";
}

/** 命名空间在注册表里的状态；不可用时对它的补丁“不适用”（类型不在、版本不对时数据只读，components.md 输出 11、12）。 */
export function namespaceAvailability(registry: ComponentRegistry, namespace: string, data: NamespaceData): "ok" | "component-unknown" | "component-version-unsupported" {
    const type = registry.byNamespace(namespace);
    if (type === undefined || type.id !== data.type) return "component-unknown";
    if (type.version !== data.version) return "component-version-unsupported";
    return "ok";
}

/** 命名空间里的字段声明（类型固定的加实例声明的）；类型不可用时为空。 */
export function namespaceFields(registry: ComponentRegistry, namespace: string, data: NamespaceData): readonly FieldDeclaration[] {
    const type = registry.byNamespace(namespace);
    if (type === undefined || type.id !== data.type) return [];
    return effectiveFields(type, data.declared);
}

type PatchOutcome = PatchResult | ApplyFailure;

function applyPatch(state: EntryState, parsed: ParsedPath, patch: Patch, registry: ComponentRegistry, events: (path: string) => string[]): PatchOutcome {
    if (parsed.root === "entry") return applyEntryPatch(state, parsed.field, patch);
    if (parsed.root === "text") return applyBlockPatch(state, parsed.block, patch);
    const data = state.data[parsed.namespace];
    if (data === undefined) return "type-mismatch";
    if (data.removed === true) return {notApplicable: "removed"};
    const availability = namespaceAvailability(registry, parsed.namespace, data);
    if (availability !== "ok") return {notApplicable: availability};
    if (parsed.field === ENABLE_FIELD) {
        if (patch.op !== "set" || typeof patch.value !== "boolean" || parsed.element !== undefined) return "type-mismatch";
        data.enabled = patch.value;
        return "applied";
    }
    if (!data.enabled) return {notApplicable: "disabled"};
    const field = namespaceFields(registry, parsed.namespace, data).find((candidate) => candidate.id === parsed.field);
    // 删除了声明的字段：数据保留、读取时看不到，对它的补丁不适用（components.md 输出 4）。
    if (field === undefined) return {notApplicable: "undeclared"};
    // 语义档的事件按地址记：字段是 `命名空间.字段`，列表元素的子字段是 `命名空间.字段[元素].子字段`（components.md 输出 20）。
    const elementEvents = (element: string, sub: string) => events(`${parsed.namespace}.${parsed.field}[${element}].${sub}`);
    if (parsed.element !== undefined) return applyElementPatch(data, field, parsed.element, parsed.sub, patch, (sub) => elementEvents(parsed.element!, sub));
    return applyFieldPatch(data, field, patch, () => events(`${parsed.namespace}.${parsed.field}`), elementEvents);
}

function applyEntryPatch(state: EntryState, field: "name" | "aliases" | "summary", patch: Patch): PatchOutcome {
    if (field === "aliases") {
        if (patch.op === "aliasAdd" && typeof patch.value === "string") {
            if (!state.aliases.includes(patch.value)) state.aliases.push(patch.value);
            return "applied";
        }
        if (patch.op === "aliasRemove" && typeof patch.value === "string") {
            const index = state.aliases.indexOf(patch.value);
            if (index < 0) return "element-missing";
            state.aliases.splice(index, 1);
            return "applied";
        }
        if (patch.op === "set" && Array.isArray(patch.value) && patch.value.every((alias) => typeof alias === "string")) {
            state.aliases = [...(patch.value as string[])];
            return "applied";
        }
        return "type-mismatch";
    }
    if (patch.op !== "set" || typeof patch.value !== "string") return "type-mismatch";
    state[field] = patch.value;
    return "applied";
}

function applyBlockPatch(state: EntryState, block: string, patch: Patch): PatchOutcome {
    const index = state.text.findIndex((candidate) => candidate.id === block);
    if (patch.op === "addBlock") {
        const value = patch.value as {after?: unknown; source?: unknown} | null;
        if (index >= 0 || value === null || typeof value !== "object" || typeof value.source !== "string") return "type-mismatch";
        const after = value.after;
        if (after === null || after === undefined) state.text.unshift({id: block, source: value.source});
        else {
            const anchor = state.text.findIndex((candidate) => candidate.id === after);
            if (anchor < 0) return "element-missing";
            state.text.splice(anchor + 1, 0, {id: block, source: value.source});
        }
        return "applied";
    }
    if (index < 0) return "element-missing";
    if (patch.op === "removeBlock") {
        state.text.splice(index, 1);
        return "applied";
    }
    if ((patch.op === "replaceBlock" || patch.op === "set") && typeof patch.value === "string") {
        state.text[index] = {id: block, source: patch.value};
        return "applied";
    }
    return "type-mismatch";
}

/** 一个元素的语义档子字段的事件清空：元素加进来、去掉、整个换掉时，旧的事件不再参与归纳（components.md 输出 20）。 */
function clearElementEvents(field: FieldDeclaration, element: string, elementEvents: (element: string, sub: string) => string[]): void {
    for (const sub of field.item ?? []) if (sub.precision === "semantic") elementEvents(element, sub.id).length = 0;
}

function applyFieldPatch(data: NamespaceData, field: FieldDeclaration, patch: Patch, events: () => string[], elementEvents: (element: string, sub: string) => string[]): PatchOutcome {
    const current = data.fields[field.id] ?? null;
    if (field.precision === "semantic") {
        if (patch.op === "set") {
            if (patch.value !== null && typeof patch.value !== "string" && typeof patch.value !== "number") return "type-mismatch";
            data.fields[field.id] = patch.value === null ? null : semanticText(field, patch.value as string | number);
            events().length = 0;
            return "applied";
        }
        if (patch.op === "note" && typeof patch.value === "string") {
            events().push(patch.value);
            return "applied";
        }
        return "type-mismatch";
    }
    switch (patch.op) {
        case "set":
        case "replaceBlock": {
            if (patch.op === "replaceBlock" && field.kind !== "text") return "type-mismatch";
            const problem = valueProblem(field, patch.value);
            if (problem !== null) return problem === "number-out-of-range" ? problem : "type-mismatch";
            data.fields[field.id] = structuredClone(patch.value);
            return "applied";
        }
        case "add": {
            if (field.kind !== "number" || typeof patch.value !== "number") return "type-mismatch";
            if (current === null) return "unknown-value";
            const sum = addExact(current as number, patch.value);
            if (sum === null) return "number-out-of-range";
            data.fields[field.id] = sum;
            return "applied";
        }
        case "listAdd": {
            if (field.kind !== "list" || listItemProblem(field, patch.value) !== null) return "type-mismatch";
            const list = (current as Array<{id: string}> | null) ?? [];
            const item = patch.value as {id: string};
            if (list.some((existing) => existing.id === item.id)) return "type-mismatch";
            data.fields[field.id] = [...list, structuredClone(item)];
            clearElementEvents(field, item.id, elementEvents);
            return "applied";
        }
        case "listRemove": {
            if (field.kind !== "list" || typeof patch.value !== "string") return "type-mismatch";
            const list = (current as Array<{id: string}> | null) ?? [];
            if (!list.some((existing) => existing.id === patch.value)) return "element-missing";
            data.fields[field.id] = list.filter((existing) => existing.id !== patch.value);
            clearElementEvents(field, patch.value, elementEvents);
            return "applied";
        }
        default:
            return "type-mismatch";
    }
}

function applyElementPatch(data: NamespaceData, field: FieldDeclaration, element: string, sub: string | undefined, patch: Patch, events: (sub: string) => string[]): PatchOutcome {
    if (field.kind !== "list") return "type-mismatch";
    const list = [...((data.fields[field.id] as Array<Record<string, unknown>> | null) ?? [])];
    const index = list.findIndex((item) => item.id === element);
    if (index < 0) return "element-missing";
    const item = {...list[index]!};
    if (sub === undefined) {
        if (patch.op !== "set" || listItemProblem(field, patch.value) !== null || (patch.value as {id: string}).id !== element) return "type-mismatch";
        list[index] = structuredClone(patch.value as Record<string, unknown>);
        for (const candidate of field.item ?? []) if (candidate.precision === "semantic") events(candidate.id).length = 0;
    } else {
        const subField = sub === "label" ? ({id: "label", label: "label", kind: "text"} as FieldDeclaration) : field.item?.find((candidate) => candidate.id === sub);
        if (subField === undefined) return "type-mismatch";
        const current = item[sub] ?? null;
        if (subField.precision === "semantic") {
            if (patch.op === "set") {
                if (patch.value !== null && typeof patch.value !== "string" && typeof patch.value !== "number") return "type-mismatch";
                item[sub] = patch.value === null ? null : semanticText(subField, patch.value as string | number);
                events(sub).length = 0;
            } else if (patch.op === "note" && typeof patch.value === "string") events(sub).push(patch.value);
            else return "type-mismatch";
        } else if (patch.op === "set") {
            const problem = valueProblem(subField, patch.value);
            if (problem !== null) return problem === "number-out-of-range" ? problem : "type-mismatch";
            item[sub] = structuredClone(patch.value);
        } else if (patch.op === "add") {
            if (subField.kind !== "number" || typeof patch.value !== "number") return "type-mismatch";
            if (current === null) return "unknown-value";
            const sum = addExact(current as number, patch.value);
            if (sum === null) return "number-out-of-range";
            item[sub] = sum;
        } else return "type-mismatch";
        list[index] = item;
    }
    data.fields[field.id] = list;
    return "applied";
}

/** 精确档数值字段的 min、max；返回第一个不满足的字段 id。值或上限是未知时不检查（components.md 输出 9）。 */
function constraintViolation(state: EntryState, namespace: string, registry: ComponentRegistry): string | null {
    const data = state.data[namespace];
    if (data === undefined) return null;
    const fields = namespaceFields(registry, namespace, data);
    for (const field of fields) {
        if (field.kind !== "number" || field.precision === "semantic") continue;
        const value = data.fields[field.id];
        if (typeof value !== "number") continue;
        if (field.min !== undefined && value < field.min) return field.id;
        if (field.max === undefined) continue;
        const limit = typeof field.max === "number" ? field.max : data.fields[field.max];
        if (typeof limit === "number" && value > limit) return field.id;
    }
    return null;
}

/**
 * 回放：已知一条变更在这个位置整条套上了，只把它对一个条目的补丁套到这个条目的状态上（增量引擎读一个条目时用）。
 * 一条变更里各条目的补丁互不依赖，所以单独回放一个条目得到的状态与整条一起套时相同；`启用` 照样先处理。
 * `events` 是这个条目的语义档事件，按路径；调用方传进可变的副本。
 */
export function replayChangeOnEntry(state: EntryState, events: Map<string, string[]>, change: StoryChange, entryId: string, registry: ComponentRegistry): void {
    const patches = change.patches.filter((patch) => patch.at.entry === entryId).sort((a, b) => Number(!isEnable(a)) - Number(!isEnable(b)));
    for (const patch of patches) {
        const parsed = parsePath(patch.at.path);
        if (parsed === null) continue;
        applyPatch(state, parsed, patch, registry, (path) => {
            let list = events.get(path);
            if (list === undefined) events.set(path, (list = []));
            return list;
        });
    }
}

/** 语义档的核对点在 `place` 上成为新的起点（model.md 输出 9、11）。 */
export function replayAnchor(state: EntryState, events: Map<string, string[]>, path: string, value: number, field: FieldDeclaration): void {
    const parsed = parsePath(path);
    if (parsed?.root !== "namespace") return;
    const data = state.data[parsed.namespace];
    if (data === undefined) return;
    if (parsed.element === undefined) data.fields[parsed.field] = semanticText(field, value);
    else {
        // 列表元素的子字段：元素还在时把起点写进它（components.md 输出 20）；元素不在时没有可写的地方。
        if (parsed.sub === undefined) return;
        const list = data.fields[parsed.field];
        if (!Array.isArray(list)) return;
        const index = (list as Array<{id?: unknown}>).findIndex((item) => item.id === parsed.element);
        if (index < 0) return;
        const next = [...list] as Array<Record<string, unknown>>;
        next[index] = {...next[index], [parsed.sub]: semanticText(field, value)};
        data.fields[parsed.field] = next;
    }
    events.set(path, []);
}
