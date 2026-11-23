/**
 * 一次改几处（docs/specs/canon/revisions.md 输出 25）：一批对条目的操作合成一次写入请求、发布成一次修订。就地改、记一笔与语义档的
 * 记一笔（`edits.ts`）是一项操作的批，路由与候选计算都在这里。
 *
 * 两步：先“定方案”（`planEntries`）：按原世界给每项操作定路由，在受影响对象的工作副本上合成写入请求；再算候选世界（`world.publish`
 * 或 `world.preview`，都不落库）并在候选上逐项读回核对。只有核对都过的候选才交给世界服务追加日志，所以核对失败时日志、版本、请求
 * id 与事件都不动。
 *
 * 路由只看原世界：同一批里不允许两项改同一处（地址相同或一个是另一个的前缀），这一批新建的东西（条目、设定组、元素）后面的项也不能
 * 再改，所以各项的路由互不影响，不用在中间结果上重算来历。
 *
 * 线：读取位置的线 id 一路明确传下去（`resolveLine`），只在构造存下来的安放时省略主线。位置不写线才按那一章讲的线（worldlines 输出
 * 12）；显式写主线就按主线。
 */

import {parsePath} from "../core/address";
import {addExact, exactProblem, subtractExact} from "../core/decimal";
import {chapterEnd, compareRanks, positionRank} from "../core/position";
import {sameJson, stableStringify} from "../core/stable-json";
import {valueAt, type ViewValue} from "../core/view-value";
import type {Actor, Address, Entry, EntryEdits, EntryOp, FieldDeclaration, NamespaceData, NewEntry, Patch, Placement, ReadPosition, StoryChange, WriteRequest} from "../core/schema";
import {LOCAL_ID_PREFIX} from "../core/ids";
import {fieldOf} from "../engine/reference";
import type {OriginStep} from "../engine/types";
import {MAIN_LINE} from "../lines/table";
import {textTouches, writeBack} from "./text-blocks";
import type {Problem, World, WriteFailure, WriteResult} from "./world";

/**
 * 这一项会写回哪里（输出 22）：改条目的初值、改某条变更里的第 `patch` 个补丁、在一个安放上新记一条变更，或者改条目对象本身
 * （新建、移动、设定组的加去、删除与恢复）。以后会再加种类，调用方要能处理不认识的 `kind`。
 */
export type EditRoute =
    | {readonly kind: "init"}
    | {readonly kind: "patch"; readonly change: string; readonly patch: number}
    | {readonly kind: "change"; readonly at: Placement}
    | {readonly kind: "entry"};

/** 就地改与批量编辑共用的失败；批量编辑里带 `op`（第几项，从 0 起）。 */
export type EditFailure =
    | WriteFailure
    | {readonly code: "chapter-not-found"}
    | {readonly code: "line-not-found"}
    | {readonly code: "value-conflict"; readonly current: unknown; readonly op?: number}
    | {readonly code: "accumulated-value"; readonly origins: readonly OriginStep[]; readonly op?: number}
    | {readonly code: "incomplete-field"; readonly op?: number}
    | {readonly code: "field-unavailable"; readonly op?: number}
    | {readonly code: "intent-not-allowed"}
    | {readonly code: "result-mismatch"; readonly got: unknown; readonly op?: number};

/** 读取戳不对（输出 25）：之间有新修订，或版本没变而读取的输入变了。 */
export type StaleRead = {readonly code: "stale-read"; readonly revisions: readonly {readonly id: string; readonly title: string; readonly by: Actor}[]; readonly inputChanged: boolean};

export type EntryEditFailure = EditFailure | StaleRead;

export type {EntryEdits, EntryOp, NewEntry} from "../core/schema";

export const ENTRY_EDITS_MAX = 50;
/** 剧情变化合成的那条变更在请求里的临时 id；就地改沿用它，修订的 `idMap` 里看得到。 */
export const STORY_CHANGE_TMP = "tmp:edit";

/** 读回核对：发布后这一项该看到什么。剧情变化在新变更之后的那一点读（输出 25），改设定在读取位置读。 */
type Expect =
    | {readonly op: number; readonly at: Address; readonly story: boolean; readonly value: unknown}
    | {readonly op: number; readonly at: Address; readonly story: boolean; readonly has: string; readonly present: boolean};

/** 一项操作写下的东西在候选对象里的位置：发布前的校验按对象与路径报问题，靠它对回是第几项（输出 25）。 */
interface Target {
    readonly op: number;
    readonly ref: {readonly kind: "entry" | "change"; readonly id: string};
    readonly path: string;
}

export interface EntryPlan {
    readonly ok: true;
    readonly position: ReadPosition;
    readonly request: WriteRequest;
    readonly routes: readonly EditRoute[];
    readonly expects: readonly Expect[];
    readonly targets: readonly Target[];
    /**
     * 这个变更 id 在原世界里还没有：发布前的校验报新变更的问题时用的是候选里刚发的 id，不是请求里的临时 id，靠它认出
     * “这一批合成的那条剧情变更”。
     */
    readonly isNewChange: (id: string) => boolean;
    /** 改了值的地址：结果里列出后面改过它们的记录。 */
    readonly addresses: readonly Address[];
}

export type EntryPlanned = EntryPlan | {readonly ok: false; readonly failure: EntryEditFailure};

/** 读取位置换成明确写线的位置（worldlines 输出 12）：之后读、来历、排序键与核对都用同一条线。 */
export function resolveLine(world: World, position: ReadPosition): ReadPosition {
    return {...position, line: world.positionLine(position)};
}

/** 读取位置的缺省：最后一章末尾，没有章时是初值。 */
function defaultPosition(world: World): ReadPosition {
    const last = world.options.order.ids.at(-1);
    return last === undefined ? {kind: "initial"} : chapterEnd(last);
}

/** 一个地址在某个位置上的值、是否不完整、所在命名空间是否可写。 */
export function currentAt(world: World, position: ReadPosition, at: Address): ViewValue | "chapter-not-found" | "line-not-found" {
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

/** 剧情变化落在哪：读取位置那一章的最前或最后。安放里省略主线（存下来的形状），别的线照写。 */
function storyPlacement(world: World, position: ReadPosition & {readonly kind: "chapter"}): Placement {
    return {kind: "chapter", chapter: position.chapter, key: keyAt(world, position), ...(position.line === undefined || position.line === MAIN_LINE ? {} : {line: position.line})};
}

/** 在读取位置新记的一条已写变更，带这一批的补丁。 */
function storyChange(world: World, position: ReadPosition & {readonly kind: "chapter"}, by: Actor, text: string, patches: readonly Patch[]): StoryChange {
    return {
        id: STORY_CHANGE_TMP,
        kind: "written",
        text,
        at: storyPlacement(world, position),
        told: [],
        involves: [...new Set(patches.map((patch) => patch.at.entry))],
        lines: [],
        links: [],
        patches: [...patches],
        status: "active",
        by,
    };
}

/** 地址指向的字段声明；列表元素的子字段取列表的 `item` 里的声明。 */
function declarationAt(world: World, entry: Entry, at: Address): FieldDeclaration | undefined {
    const parsed = parsePath(at.path);
    if (parsed?.root !== "namespace" || parsed.element === undefined) return fieldOf(world.options.registry, entry, at);
    const list = fieldOf(world.options.registry, entry, {entry: at.entry, path: `${parsed.namespace}.${parsed.field}`});
    return parsed.sub === undefined ? undefined : list?.item?.find((item) => item.id === parsed.sub);
}

/** 改初值里的一个地址（名字、简介、别名、主文字的块、字段、列表元素与子字段）；地址不在初值里时为 false。改的是传进来的副本。 */
function writeInit(entry: Entry, path: string, value: unknown): boolean {
    if (path === "entry.name" || path === "entry.summary") {
        if (typeof value !== "string") return false;
        entry.init[path === "entry.name" ? "name" : "summary"] = value;
        return true;
    }
    if (path === "entry.aliases") {
        if (!Array.isArray(value)) return false;
        entry.init.aliases = value as string[];
        return true;
    }
    const block = /^text\[(.+)\]$/u.exec(path);
    if (block !== null) {
        const target = entry.init.text.find((candidate) => candidate.id === block[1]);
        if (target === undefined || typeof value !== "string") return false;
        target.source = value;
        return true;
    }
    const match = /^([^.[\]]+)\.([^.[\]]+)(?:\[([^.[\]]+)\](?:\.([^.[\]]+))?)?$/u.exec(path);
    if (match === null) return false;
    const [, namespace, field, element, sub] = match as unknown as [string, string, string, string | undefined, string | undefined];
    const data = entry.init.data[namespace];
    if (data === undefined) return false;
    if (element === undefined) data.fields[field] = structuredClone(value);
    else {
        const list = data.fields[field];
        const item = Array.isArray(list) ? (list as Array<Record<string, unknown>>).find((candidate) => candidate.id === element) : undefined;
        if (item === undefined) return false;
        if (sub === undefined) Object.assign(item, value);
        else item[sub] = structuredClone(value);
    }
    return true;
}

/** 后面改过同一地址的记录（输出 8 的结果另外列出）。 */
export function laterRecords(world: World, position: ReadPosition, at: Address): string[] {
    const rank = positionRank(world.options.order, position);
    if (rank === null) return [];
    const ids: string[] = [];
    const last = world.options.order.ids.at(-1);
    if (last === undefined) return ids;
    const origins = world.lineAt(position)?.engine.origins(at, {...chapterEnd(last), ...(position.line === undefined ? {} : {line: position.line})}, "actual");
    if (origins === undefined || origins === "chapter-not-found") return ids;
    for (const step of origins) {
        if (step.kind !== "patch") continue;
        const change = world.data.changes.get(step.change);
        if (change === undefined || change.at.kind !== "chapter") continue;
        const index = world.options.order.index(change.at.chapter);
        if (index !== undefined && compareRanks([1, index, change.at.key], rank) > 0) ids.push(step.change);
    }
    return [...new Set(ids)];
}

/**
 * 碰过初值里某一项（列表元素、别名、主文字的块）的变更（输出 25 的“只写初值”）：这条线的记录里没撤销的变更，补丁加过、去过、
 * 整个换过它，或改过它下面的地址。按全部变更算、不看先后：后面的变更改过它，从初值去掉它会让那些变更套不上。
 */
function touchedBy(world: World, position: ReadPosition, entry: string, matches: (patch: Patch) => boolean): string[] {
    const view = world.lineAt(position);
    if (view === undefined) return [];
    const ids: string[] = [];
    for (const change of view.records.changes.values()) {
        if (change.status === "undone") continue;
        if (change.patches.some((patch) => patch.at.entry === entry && matches(patch))) ids.push(change.id);
    }
    return ids;
}

/** 列表元素被碰过：增删这个 id、整表赋值、改它下面的地址；子线上从父线带过来的（来历里有带过去的一步）也算。 */
function elementTouchedBy(world: World, position: ReadPosition, entry: string, list: string, element: string): string[] {
    const own = touchedBy(world, position, entry, (patch) => {
        if (patch.at.path === list) {
            if (patch.op === "set") return true;
            if (patch.op === "listAdd") return (patch.value as {id?: unknown} | null)?.id === element;
            if (patch.op === "listRemove") return patch.value === element;
            return false;
        }
        return patch.at.path.startsWith(`${list}[${element}]`);
    });
    const view = world.lineAt(position);
    const origins = view?.engine.origins({entry, path: list}, position, "actual");
    const carried = Array.isArray(origins) && origins.some((step) => step.kind === "carried" || (step.kind === "patch" && view!.synthetic.has(step.change)));
    return carried ? [...own, "carried"] : own;
}

function problem(index: number, code: string, message: string, extra: Partial<Problem> = {}): {readonly ok: false; readonly failure: EntryEditFailure} {
    return {ok: false, failure: {code: "validation-failed", problems: [{code, path: `ops[${String(index)}]`, message, ...extra}]}};
}

/** 一项操作改到的地址（判断同一批里有没有改同一处）；结构操作写条目自己的几个位置。 */
function addressesOf(op: EntryOp, index: number): readonly Address[] {
    switch (op.op) {
        case "create":
            return [];
        case "set":
        case "replace":
        case "listRemove":
        case "removeBlock":
        case "add":
        case "note":
            return [op.at];
        case "listAdd":
            return [{entry: op.at.entry, path: `${op.at.path}[+${String(index)}]`}];
        case "aliases":
            return [{entry: op.entry, path: "entry.aliases"}];
        case "addBlock":
            return [{entry: op.entry, path: `text[+${String(index)}]`}];
        case "component":
            return [{entry: op.entry, path: `$component.${op.type}`}];
        case "place":
            return [{entry: op.entry, path: "$place"}];
        case "delete":
        case "restore":
            return [{entry: op.entry, path: "$"}];
    }
}

/** 两个地址是同一处，或一个在另一个下面（字段与它的元素、元素与它的子字段；`$` 是整个条目）。 */
function overlaps(a: Address, b: Address): boolean {
    if (a.entry !== b.entry) return false;
    if (a.path === "$" || b.path === "$") return true;
    const under = (outer: string, inner: string) => inner === outer || inner.startsWith(`${outer}[`) || inner.startsWith(`${outer}.`);
    return under(a.path, b.path) || under(b.path, a.path);
}

/** 这一批受影响的对象：按对象克隆一次，之后的项在副本上改；结束时每个改过的对象出一份 put。 */
class Draft {
    readonly entries = new Map<string, Entry>();
    readonly changes = new Map<string, StoryChange>();
    readonly created = new Set<string>();
    /** 这一批新加的设定组（`条目/命名空间`）与元素（`条目/命名空间.字段[元素]`）：后面的项不能再改它们。 */
    readonly fresh = new Set<string>();

    constructor(private readonly world: World) {}

    entry(id: string): Entry | undefined {
        const existing = this.entries.get(id);
        if (existing !== undefined) return existing;
        const stored = this.world.data.entries.get(id);
        if (stored === undefined) return undefined;
        const copy = structuredClone(stored) as Entry;
        this.entries.set(id, copy);
        return copy;
    }

    change(id: string): StoryChange | undefined {
        const existing = this.changes.get(id);
        if (existing !== undefined) return existing;
        const stored = this.world.data.changes.get(id);
        if (stored === undefined) return undefined;
        const copy = structuredClone(stored) as StoryChange;
        this.changes.set(id, copy);
        return copy;
    }
}

/** 一个列表里用过的元素 id：初值与全部变更里加过的，生成新 id 时避开（输出 25）。 */
function usedElementIds(world: World, entry: Entry | undefined, entryId: string, listPath: string): Set<string> {
    const taken = new Set<string>();
    const parsed = parsePath(listPath);
    if (parsed?.root === "namespace") {
        const list = entry?.init.data[parsed.namespace]?.fields[parsed.field];
        if (Array.isArray(list)) for (const item of list as Array<{id?: unknown}>) if (typeof item.id === "string") taken.add(item.id);
    }
    for (const change of world.data.changes.values()) {
        for (const patch of change.patches) {
            if (patch.at.entry !== entryId || patch.at.path !== listPath || patch.op !== "listAdd") continue;
            const id = (patch.value as {id?: unknown} | null)?.id;
            if (typeof id === "string") taken.add(id);
        }
    }
    return taken;
}

/** 列表元素与块的新 id：前缀加序号（`LOCAL_ID_PREFIX`），比用过的同前缀 id 里最大的序号大一。 */
function nextLocalId(prefix: string, taken: ReadonlySet<string>): string {
    let max = 0;
    for (const id of taken) {
        const match = new RegExp(`^${prefix}(\\d+)$`, "u").exec(id);
        if (match !== null) max = Math.max(max, Number(match[1]));
    }
    let next = max + 1;
    while (taken.has(`${prefix}${String(next)}`)) next += 1;
    return `${prefix}${String(next)}`;
}

/** 主文字里用过的块 id：初值与全部变更里加过的。 */
function usedBlockIds(world: World, entry: Entry | undefined, entryId: string): Set<string> {
    const taken = new Set<string>(entry?.init.text.map((block) => block.id) ?? []);
    for (const change of world.data.changes.values()) {
        for (const patch of change.patches) {
            if (patch.at.entry !== entryId || patch.op !== "addBlock") continue;
            const block = /^text\[(.+)\]$/u.exec(patch.at.path);
            if (block !== null) taken.add(block[1]!);
        }
    }
    return taken;
}

/** 一层里排在最后的顺序：同层（同一个上级、没删除的）最大的 `order` 加 1。 */
function lastOrder(world: World, draft: Draft, parent: string | null, except?: string): number {
    let max = -1;
    for (const entry of world.data.entries.values()) {
        if (entry.id === except) continue;
        const current = draft.entries.get(entry.id) ?? entry;
        if (current.parent === parent && current.deleted !== true) max = Math.max(max, current.order);
    }
    for (const id of draft.created) {
        const entry = draft.entries.get(id)!;
        if (entry.id !== except && entry.parent === parent) max = Math.max(max, entry.order);
    }
    return max + 1;
}

/** 放在某项之后：取它与下一个兄弟的中数；落不进两者之间（数用尽）时为 null。`after` 为 null 是放在最前。 */
function orderAfter(world: World, draft: Draft, parent: string | null, after: string | null, moving: string): number | null {
    const siblings = [...world.data.entries.values()]
        .map((entry) => draft.entries.get(entry.id) ?? entry)
        .filter((entry) => entry.parent === parent && entry.deleted !== true && entry.id !== moving)
        .sort((a, b) => a.order - b.order);
    const index = after === null ? -1 : siblings.findIndex((entry) => entry.id === after);
    if (after !== null && index < 0) return null;
    const before = index < 0 ? undefined : siblings[index]!.order;
    const next = siblings[index + 1]?.order;
    if (before === undefined && next === undefined) return 0;
    if (before === undefined) return next! - 1;
    if (next === undefined) return before + 1;
    const middle = (before + next) / 2;
    return middle > before && middle < next ? middle : null;
}

/** 照登记的类型建一个设定组的数据：字段先都是未知，再填上给的。 */
function namespaceData(world: World, type: string, fields: Readonly<Record<string, unknown>> | undefined): {readonly namespace: string; readonly data: NamespaceData} | null {
    const declared = world.options.registry.types.find((candidate) => candidate.id === type);
    if (declared === undefined) return null;
    return {
        namespace: declared.namespace,
        data: {type: declared.id, version: declared.version, enabled: true, fields: {...Object.fromEntries(declared.fields.map((field) => [field.id, null])), ...structuredClone(fields ?? {})}, ...(declared.instanceFields ? {declared: []} : {})},
    };
}

/** 照 `NewEntry` 建条目对象（id 是临时 id）。 */
function buildEntry(world: World, draft: Draft, id: string, input: NewEntry): Entry | string {
    const data: Record<string, NamespaceData> = {};
    const queryOnly: string[] = [];
    for (const component of input.components ?? []) {
        if (world.options.registry.queryOnly.has(component.type)) {
            queryOnly.push(component.type);
            continue;
        }
        const built = namespaceData(world, component.type, component.fields);
        if (built === null) return component.type;
        data[built.namespace] = built.data;
    }
    const parent = input.parent ?? null;
    const kind = input.kind.trim();
    return {
        id,
        type: kind,
        parent,
        folder: (input.folder ?? kind).trim(),
        order: lastOrder(world, draft, parent),
        ...(input.sameAs === undefined || input.sameAs === null ? {} : {sameAs: input.sameAs}),
        ...(input.appears === undefined || input.appears === null ? {} : {appears: input.appears}),
        init: {
            name: input.name.trim(),
            aliases: [...(input.aliases ?? [])],
            summary: input.summary ?? "",
            text: (input.text ?? []).map((source, index) => ({id: `b${String(index + 1)}`, source})),
            data,
            ...(queryOnly.length === 0 ? {} : {components: queryOnly}),
        },
    };
}

/**
 * 定方案（输出 25）：按原世界给每项定路由，在工作副本上合成写入请求。不发布、不核对；`checkPlan` 在候选世界上核对。
 */
export function planEntries(world: World, input: EntryEdits): EntryPlanned {
    if (input.ops.length === 0 || input.ops.length > ENTRY_EDITS_MAX) return {ok: false, failure: {code: "validation-failed", problems: [{code: "type-mismatch", path: "ops", message: `a batch has 1 to ${String(ENTRY_EDITS_MAX)} operations`}]}};
    const intent = input.intent ?? "creative";
    const position = resolveLine(world, input.position ?? defaultPosition(world));
    const line = world.lineAt(position);
    if (line === undefined) return {ok: false, failure: {code: "line-not-found"}};
    if (positionRank(world.options.order, position) === null && position.kind === "chapter") return {ok: false, failure: {code: "chapter-not-found"}};
    const storyAt = position.kind === "chapter" ? position : null;
    if (intent === "story" && storyAt === null) return {ok: false, failure: {code: "intent-not-allowed"}};
    const allCreate = input.ops.every((op) => op.op === "create");
    if (input.baseVersion === undefined && !allCreate) return {ok: false, failure: {code: "validation-failed", problems: [{code: "type-mismatch", path: "baseVersion", message: "baseVersion is required unless every operation creates an entry"}]}};

    const draft = new Draft(world);
    const story: Patch[] = [];
    const routes: EditRoute[] = [];
    const expects: Expect[] = [];
    const addresses: Address[] = [];
    const seen: Address[] = [];
    const targets: Target[] = [];
    /** 这一批里上一个落在同一处的新块（键是条目加锚点）：下一项接在它后面，同一处的几项才按写的先后排。 */
    const placed = new Map<string, string>();
    /** 剧情变化加块时，这个条目在读取位置上此刻的最后一块（算上这一批前面加在末尾的）：不写 `after` 的项接在它后面。 */
    const tails = new Map<string, string | null>();
    /** 改设定的一项写下的块在候选对象里的位置。 */
    const locate = (index: number, route: EditRoute, at: Address): void => {
        if (route.kind === "patch") targets.push({op: index, ref: {kind: "change", id: route.change}, path: `patches[${String(route.patch)}]`});
        else if (route.kind === "change") targets.push({op: index, ref: {kind: "change", id: STORY_CHANGE_TMP}, path: `patches[${String(story.length - 1)}]`});
        else if (route.kind === "init" && at.path.startsWith("text[")) targets.push({op: index, ref: {kind: "entry", id: at.entry}, path: `init.${at.path}`});
    };

    const current = (at: Address, index: number): ViewValue | {readonly ok: false; readonly failure: EntryEditFailure} => {
        const value = currentAt(world, position, at);
        if (value === "chapter-not-found" || value === "line-not-found") return {ok: false, failure: {code: value}};
        if (!value.available) return {ok: false, failure: {code: "field-unavailable", op: index}};
        return value;
    };
    const isFailure = (value: unknown): value is {readonly ok: false; readonly failure: EntryEditFailure} => typeof value === "object" && value !== null && (value as {ok?: unknown}).ok === false;

    for (const [index, op] of input.ops.entries()) {
        // 这一批新建的东西：初值只能在建它的那一项里给（输出 25 的 `created-in-batch`）。
        const target = "at" in op ? op.at.entry : "entry" in op && typeof op.entry === "string" ? op.entry : undefined;
        if (target !== undefined && draft.created.has(target)) return problem(index, "created-in-batch", "this entry is created in the same batch; give its initial values in the create operation");
        if ("at" in op) {
            const parsed = parsePath(op.at.path);
            const freshBlock = parsed?.root === "text" && draft.fresh.has(`${op.at.entry}/text[${parsed.block}]`);
            if (freshBlock || (parsed?.root === "namespace" && (draft.fresh.has(`${op.at.entry}/${parsed.namespace}`) || (parsed.element !== undefined && draft.fresh.has(`${op.at.entry}/${parsed.namespace}.${parsed.field}[${parsed.element}]`))))) {
                return problem(index, "created-in-batch", "this component or element is added in the same batch; give its initial values in the operation that adds it");
            }
        }
        for (const address of addressesOf(op, index)) {
            const earlier = seen.find((candidate) => overlaps(candidate, address));
            if (earlier !== undefined) return problem(index, "duplicate-address", `an earlier operation in this batch already changes ${earlier.path}`);
            seen.push(address);
        }
        if ((op.op === "add" || op.op === "note") && intent !== "story") return problem(index, "op-not-in-intent", `${op.op} records a story change; use intent "story"`);

        switch (op.op) {
            case "create": {
                if (!op.id.startsWith("tmp:")) return problem(index, "type-mismatch", "a new entry needs a tmp: id");
                // 同一个临时 id 建两次时，后一项会盖掉前一项、整批照样发布（只落下一个条目）：拒收。
                if (draft.created.has(op.id)) return problem(index, "id-taken", `an earlier operation in this batch already creates ${op.id}`);
                const types = (op.entry.components ?? []).map((component) => component.type);
                const repeated = types.find((type, at) => types.indexOf(type) !== at);
                // 同一类型列两次写的是同一个命名空间，后一份的初值盖掉前一份。
                if (repeated !== undefined) return problem(index, "duplicate-address", `component type "${repeated}" is listed twice`);
                const built = buildEntry(world, draft, op.id, op.entry);
                if (typeof built === "string") return problem(index, "component-unknown", `component type "${built}" is not registered`);
                draft.entries.set(op.id, built);
                draft.created.add(op.id);
                routes.push({kind: "entry"});
                break;
            }
            case "set":
            case "replace": {
                const value = current(op.at, index);
                if (isFailure(value)) return value;
                let next: unknown;
                if (op.op === "replace") {
                    if (typeof value.value !== "string") return problem(index, "type-mismatch", "replace works on text");
                    const first = value.value.indexOf(op.find);
                    if (op.find === "" || first < 0) return problem(index, "replace-not-found", "the text to replace is not in the current value");
                    if (value.value.indexOf(op.find, first + 1) >= 0) return problem(index, "replace-not-unique", "the text to replace appears more than once");
                    next = value.value.slice(0, first) + op.with + value.value.slice(first + op.find.length);
                } else {
                    if (op.read !== undefined && !sameJson(value.value, op.read)) return {ok: false, failure: {code: "value-conflict", current: value.value, op: index}};
                    next = op.value;
                }
                const routed = routeSet(world, draft, position, intent, index, op.at, value, next);
                if (isFailure(routed)) return routed;
                if (routed.patch !== undefined) story.push(routed.patch);
                routes.push(routed.route);
                locate(index, routed.route, op.at);
                expects.push({op: index, at: op.at, story: intent === "story", value: next});
                addresses.push(op.at);
                break;
            }
            case "add": {
                const value = current(op.at, index);
                if (isFailure(value)) return value;
                if (op.read !== undefined && !sameJson(value.value, op.read)) return {ok: false, failure: {code: "value-conflict", current: value.value, op: index}};
                if (typeof value.value !== "number" || value.incomplete) return {ok: false, failure: {code: "incomplete-field", op: index}};
                const sum = exactProblem(op.delta) === null ? addExact(value.value, op.delta) : null;
                if (sum === null) return problem(index, "number-out-of-range", "delta is out of range or has more than 4 decimals");
                story.push({op: "add", at: op.at, value: op.delta, basis: {kind: "author"}});
                routes.push({kind: "change", at: storyPlacement(world, storyAt!)});
                expects.push({op: index, at: op.at, story: true, value: sum});
                addresses.push(op.at);
                break;
            }
            case "note": {
                const value = current(op.at, index);
                if (isFailure(value)) return value;
                const entry = world.data.entries.get(op.at.entry)!;
                if (declarationAt(world, entry, op.at)?.precision !== "semantic") return problem(index, "type-mismatch", "the field is not a semantic field; record a delta or edit it in place");
                if (op.read !== undefined && !sameJson(value.value, op.read)) return {ok: false, failure: {code: "value-conflict", current: value.value, op: index}};
                story.push({op: "note", at: op.at, value: op.text});
                routes.push({kind: "change", at: storyPlacement(world, storyAt!)});
                addresses.push(op.at);
                break;
            }
            case "listAdd": {
                const parsed = parsePath(op.at.path);
                const entry = draft.entry(op.at.entry);
                if (entry === undefined || parsed?.root !== "namespace" || parsed.element !== undefined) return problem(index, "type-mismatch", "listAdd needs the address of a list field");
                const field = fieldOf(world.options.registry, entry, op.at);
                if (field?.kind !== "list") return problem(index, "type-mismatch", "listAdd needs the address of a list field");
                const element = {...(op.element as Record<string, unknown>)};
                if (typeof element.id !== "string") {
                    if (field.keyedBy === "ref") return problem(index, "type-mismatch", "an element of a list keyed by reference needs the id of the referenced entry");
                    const taken = usedElementIds(world, world.data.entries.get(op.at.entry), op.at.entry, op.at.path);
                    // 这一批里刚分配给同一个列表的也要避开。
                    const prefix = `${op.at.entry}/${parsed.namespace}.${parsed.field}[`;
                    for (const key of draft.fresh) if (key.startsWith(prefix)) taken.add(key.slice(prefix.length, -1));
                    element.id = nextLocalId(LOCAL_ID_PREFIX.item, taken);
                }
                draft.fresh.add(`${op.at.entry}/${parsed.namespace}.${parsed.field}[${element.id as string}]`);
                if (intent === "story") {
                    story.push({op: "listAdd", at: op.at, value: element as never});
                    routes.push({kind: "change", at: storyPlacement(world, storyAt!)});
                } else {
                    const data = entry.init.data[parsed.namespace];
                    if (data === undefined || data.removed === true) return {ok: false, failure: {code: "field-unavailable", op: index}};
                    const list = Array.isArray(data.fields[parsed.field]) ? (data.fields[parsed.field] as unknown[]) : [];
                    data.fields[parsed.field] = [...list, element];
                    routes.push({kind: "init"});
                }
                expects.push({op: index, at: op.at, story: intent === "story", has: element.id as string, present: true});
                addresses.push(op.at);
                break;
            }
            case "listRemove": {
                const parsed = parsePath(op.at.path);
                if (parsed?.root !== "namespace" || parsed.element === undefined || parsed.sub !== undefined) return problem(index, "type-mismatch", "listRemove needs the address of a list element");
                const list: Address = {entry: op.at.entry, path: `${parsed.namespace}.${parsed.field}`};
                const value = current(list, index);
                if (isFailure(value)) return value;
                if (!Array.isArray(value.value) || !(value.value as Array<{id?: unknown}>).some((item) => item.id === parsed.element)) return problem(index, "element-missing", "the element is not in the list at this position");
                if (intent === "story") {
                    story.push({op: "listRemove", at: list, value: parsed.element});
                    routes.push({kind: "change", at: storyPlacement(world, storyAt!)});
                } else {
                    const touched = elementTouchedBy(world, position, op.at.entry, list.path, parsed.element);
                    const entry = draft.entry(op.at.entry)!;
                    const initList = entry.init.data[parsed.namespace]?.fields[parsed.field];
                    const inInit = Array.isArray(initList) && (initList as Array<{id?: unknown}>).some((item) => item.id === parsed.element);
                    if (touched.length > 0 || !inInit) return problem(index, "element-from-change", "this element was added or changed by a story change; remove it as a story change instead", {reason: touched.join(",")});
                    entry.init.data[parsed.namespace]!.fields[parsed.field] = (initList as Array<{id?: unknown}>).filter((item) => item.id !== parsed.element);
                    routes.push({kind: "init"});
                }
                expects.push({op: index, at: list, story: intent === "story", has: parsed.element, present: false});
                addresses.push(op.at);
                break;
            }
            case "aliases": {
                const entry = draft.entry(op.entry);
                if (entry === undefined) return problem(index, "not-found", "the entry does not exist");
                const at: Address = {entry: op.entry, path: "entry.aliases"};
                if (intent === "story") {
                    for (const alias of op.add ?? []) story.push({op: "aliasAdd", at, value: alias});
                    for (const alias of op.remove ?? []) story.push({op: "aliasRemove", at, value: alias});
                    routes.push({kind: "change", at: storyPlacement(world, storyAt!)});
                } else {
                    for (const alias of op.remove ?? []) {
                        const touched = touchedBy(world, position, op.entry, (patch) => patch.at.path === "entry.aliases" && (patch.op === "set" || patch.value === alias));
                        if (touched.length > 0 || !entry.init.aliases.includes(alias)) return problem(index, "element-from-change", `the alias "${alias}" was added or changed by a story change; remove it as a story change instead`, {reason: touched.join(",")});
                    }
                    entry.init.aliases = [...entry.init.aliases.filter((alias) => !(op.remove ?? []).includes(alias)), ...(op.add ?? []).filter((alias) => !entry.init.aliases.includes(alias))];
                    routes.push({kind: "init"});
                }
                for (const alias of op.add ?? []) expects.push({op: index, at, story: intent === "story", has: alias, present: true});
                for (const alias of op.remove ?? []) expects.push({op: index, at, story: intent === "story", has: alias, present: false});
                addresses.push(at);
                break;
            }
            case "addBlock": {
                const entry = draft.entry(op.entry);
                if (entry === undefined) return problem(index, "not-found", "the entry does not exist");
                if (entry.deleted === true) return {ok: false, failure: {code: "field-unavailable", op: index}};
                const taken = usedBlockIds(world, world.data.entries.get(op.entry), op.entry);
                for (const key of draft.fresh) if (key.startsWith(`${op.entry}/text[`)) taken.add(key.slice(`${op.entry}/text[`.length, -1));
                const id = nextLocalId(LOCAL_ID_PREFIX.block, taken);
                draft.fresh.add(`${op.entry}/text[${id}]`);
                const at: Address = {entry: op.entry, path: `text[${id}]`};
                if (intent === "story") {
                    // 补丁里不写 `after` 是插在最前（apply.ts）。操作里不写是放在这个位置上最后一块之后，写 `null` 才是最前。
                    if (!tails.has(op.entry)) {
                        const view = line.engine.entry(op.entry, position, "actual");
                        tails.set(op.entry, view !== null && view !== "chapter-not-found" ? view.text.at(-1)?.id ?? null : null);
                    }
                    const tail = tails.get(op.entry)!;
                    // 补丁照旧一条条套、每条都插在自己的锚点正后面，所以要排成写的先后，后一项得挂在这一批里上一项后面：不写 `after`
                    // 的挂在此刻的最后一块后面，写了的挂在同一处上一项后面。这样两种意图排出来的顺序相同，已有日志的重放也不受影响。
                    let anchor: string | null;
                    if (op.after === undefined) anchor = tail;
                    else {
                        const slot = `${op.entry}\n${op.after ?? ""}`;
                        anchor = placed.get(slot) ?? op.after;
                        placed.set(slot, id);
                    }
                    story.push({op: "addBlock", at, value: {source: op.source, after: anchor} as never});
                    if (anchor === tail) tails.set(op.entry, id);
                    routes.push({kind: "change", at: storyPlacement(world, storyAt!)});
                    targets.push({op: index, ref: {kind: "change", id: STORY_CHANGE_TMP}, path: `patches[${String(story.length - 1)}]`});
                } else if (op.after === undefined) {
                    entry.init.text.push({id, source: op.source});
                    routes.push({kind: "init"});
                    targets.push({op: index, ref: {kind: "entry", id: op.entry}, path: `init.${at.path}`});
                } else {
                    if (op.after !== null && !entry.init.text.some((block) => block.id === op.after)) return problem(index, "element-missing", "the block to insert after is not in the initial text");
                    const slot = `${op.entry}\n${op.after ?? ""}`;
                    // 同一处的后一项接在这一批里上一项后面（它刚放进初值，一定找得到）。
                    const after = placed.get(slot) ?? op.after;
                    entry.init.text.splice(after === null ? 0 : entry.init.text.findIndex((block) => block.id === after) + 1, 0, {id, source: op.source});
                    placed.set(slot, id);
                    routes.push({kind: "init"});
                    targets.push({op: index, ref: {kind: "entry", id: op.entry}, path: `init.${at.path}`});
                }
                expects.push({op: index, at, story: intent === "story", value: op.source});
                addresses.push(at);
                break;
            }
            case "removeBlock": {
                const block = /^text\[(.+)\]$/u.exec(op.at.path)?.[1];
                const entry = draft.entry(op.at.entry);
                if (block === undefined || entry === undefined) return problem(index, "type-mismatch", "removeBlock needs the address of a block");
                if (entry.deleted === true) return {ok: false, failure: {code: "field-unavailable", op: index}};
                if (intent === "story") {
                    story.push({op: "removeBlock", at: op.at, value: null as never});
                    routes.push({kind: "change", at: storyPlacement(world, storyAt!)});
                } else {
                    // 被碰过也包括被当作锚点：有变更把新块挂在它后面时删它，那条变更就套不上（`textTouches`）。
                    const touched = textTouches(world, op.at.entry).get(block) ?? [];
                    if (touched.length > 0 || !entry.init.text.some((candidate) => candidate.id === block)) return problem(index, "element-from-change", "this block was added or changed by a story change, or a story change adds a block after it; remove it as a story change instead", {reason: touched.join(",")});
                    entry.init.text = entry.init.text.filter((candidate) => candidate.id !== block);
                    routes.push({kind: "init"});
                }
                expects.push({op: index, at: op.at, story: intent === "story", value: undefined});
                addresses.push(op.at);
                break;
            }
            case "component": {
                const entry = draft.entry(op.entry);
                if (entry === undefined) return problem(index, "not-found", "the entry does not exist");
                if (world.options.registry.queryOnly.has(op.type)) {
                    const listed = entry.init.components ?? [];
                    if (op.action === "add" && listed.includes(op.type)) return problem(index, "id-taken", "the component is already on this entry");
                    entry.init.components = op.action === "add" ? [...listed, op.type] : listed.filter((type) => type !== op.type);
                } else {
                    const declared = world.options.registry.types.find((candidate) => candidate.id === op.type);
                    if (declared === undefined) return problem(index, "component-unknown", `component type "${op.type}" is not registered`);
                    const existing = entry.init.data[declared.namespace];
                    if (op.action === "remove") {
                        if (existing === undefined || existing.removed === true) return problem(index, "element-missing", "the component is not on this entry");
                        existing.removed = true;
                    } else if (existing !== undefined && existing.removed !== true) {
                        return problem(index, "id-taken", "the component is already on this entry");
                    } else if (existing !== undefined) {
                        // 去掉过的加回来：数据还在，去掉标记（components.md 输出 7）。
                        delete existing.removed;
                        for (const [field, value] of Object.entries(op.fields ?? {})) existing.fields[field] = structuredClone(value);
                    } else {
                        const built = namespaceData(world, op.type, op.fields)!;
                        entry.init.data[built.namespace] = built.data;
                        draft.fresh.add(`${op.entry}/${built.namespace}`);
                    }
                }
                routes.push({kind: "entry"});
                break;
            }
            case "place": {
                const entry = draft.entry(op.entry);
                if (entry === undefined) return problem(index, "not-found", "the entry does not exist");
                const parent = op.parent === undefined ? entry.parent : op.parent;
                if (op.kind !== undefined) entry.type = op.kind.trim();
                if (op.folder !== undefined) entry.folder = op.folder.trim();
                if (op.after !== undefined) {
                    const order = orderAfter(world, draft, parent, op.after, entry.id);
                    if (order === null) return problem(index, "order-exhausted", "there is no room between the two siblings; move another sibling first");
                    entry.order = order;
                } else if (parent !== entry.parent) entry.order = lastOrder(world, draft, parent, entry.id);
                entry.parent = parent;
                if (op.appears === null) delete entry.appears;
                else if (op.appears !== undefined) entry.appears = op.appears;
                if (op.sameAs === null) delete entry.sameAs;
                else if (op.sameAs !== undefined) entry.sameAs = op.sameAs;
                routes.push({kind: "entry"});
                break;
            }
            case "delete":
            case "restore": {
                const entry = draft.entry(op.entry);
                if (entry === undefined) return problem(index, "not-found", "the entry does not exist");
                if (op.op === "delete") entry.deleted = true;
                else delete entry.deleted;
                routes.push({kind: "entry"});
                break;
            }
        }
    }

    const puts: WriteRequest["puts"][number][] = [];
    for (const id of draft.created) puts.push({ref: {kind: "entry", id}, after: draft.entries.get(id)!});
    for (const [id, entry] of draft.entries) if (!draft.created.has(id)) puts.push({ref: {kind: "entry", id}, after: entry});
    for (const [id, change] of draft.changes) puts.push({ref: {kind: "change", id}, after: change});
    if (story.length > 0) puts.push({ref: {kind: "change", id: STORY_CHANGE_TMP}, after: storyChange(world, storyAt!, input.by, input.title, story)});
    const request: WriteRequest = {
        requestId: input.requestId,
        by: input.by,
        what: input.what,
        title: input.title,
        ...(input.why === undefined ? {} : {why: input.why}),
        baseVersion: input.baseVersion ?? world.version,
        ...(intent === "story" ? {chapter: storyAt!.chapter} : {}),
        puts,
    };
    return {ok: true, position, request, routes, expects, targets, isNewChange: (id) => !world.data.changes.has(id), addresses};
}

/**
 * `set` 的路由（输出 8 的路由表）：剧情变化给出一个补丁；改设定按来历写回初值或给出这个值的那条变更的补丁（改的是工作副本）。
 * 列表元素另有规则：完全来自初值、这条线上没有变更碰过它才按初值改（输出 25），否则 `element-from-change`。
 */
function routeSet(world: World, draft: Draft, position: ReadPosition, intent: "creative" | "story", index: number, at: Address, value: ViewValue, next: unknown): {readonly route: EditRoute; readonly patch?: Patch} | {readonly ok: false; readonly failure: EntryEditFailure} {
    const stored = world.data.entries.get(at.entry)!;
    const field = declarationAt(world, stored, at);
    if (intent === "story") {
        let patch: Patch;
        const exactNumber = field?.kind === "number" && field.precision !== "semantic";
        if (exactNumber && !value.incomplete && typeof next === "number" && typeof value.value === "number") {
            const delta = subtractExact(next, value.value);
            if (delta === null || exactProblem(next) !== null) return problem(index, "number-out-of-range", "value is out of range");
            patch = {op: "add", at, value: delta, basis: {kind: "author"}};
        } else patch = {op: at.path.startsWith("text[") ? "replaceBlock" : "set", at, value: structuredClone(next) as never, ...(typeof next === "number" ? {basis: {kind: "author"} as const} : {})};
        return {route: {kind: "change", at: storyPlacement(world, position as ReadPosition & {kind: "chapter"})}, patch};
    }
    if (value.incomplete) return {ok: false, failure: {code: "incomplete-field", op: index}};
    const parsed = parsePath(at.path);
    if (parsed?.root === "namespace" && parsed.element !== undefined) {
        const list = `${parsed.namespace}.${parsed.field}`;
        const touched = elementTouchedBy(world, position, at.entry, list, parsed.element);
        if (touched.length > 0) return problem(index, "element-from-change", "this element was added or changed by a story change; change it as a story change instead", {reason: touched.join(",")});
        if (!writeInit(draft.entry(at.entry)!, at.path, next)) return {ok: false, failure: {code: "field-unavailable", op: index}};
        return {route: {kind: "init"}};
    }
    const back = writeBack(world, position, at);
    if (back.kind === "chapter-not-found" || back.kind === "line-not-found") return {ok: false, failure: {code: back.kind}};
    // 带过去的值不是哪条记录写的：要改它，在这条线上记一条剧情变化（worldlines 输出 19）。
    if (back.kind === "carried") return {ok: false, failure: {code: "validation-failed", problems: [{code: "carried-value", path: `ops[${String(index)}]`, message: "the value was carried over from another world line; record a story change on this line instead"}]}};
    if (back.kind === "accumulated") return {ok: false, failure: {code: "accumulated-value", origins: back.origins, op: index}};
    if (back.kind === "init") {
        if (!writeInit(draft.entry(at.entry)!, at.path, next)) return {ok: false, failure: {code: "field-unavailable", op: index}};
        return {route: {kind: "init"}};
    }
    const change = draft.change(back.change)!;
    const before = structuredClone(change.patches);
    let patchIndex = -1;
    change.patches = change.patches.map((patch, position) => {
        if (patch.at.entry !== at.entry || patch.at.path !== at.path) return patch;
        let replaced: Patch = patch;
        if (patch.op === "set" || patch.op === "replaceBlock") replaced = {...patch, value: structuredClone(next) as never};
        // 这一块是这条变更增进来的：改它带的文字。
        else if (patch.op === "addBlock" && typeof next === "string") replaced = {...patch, value: {...(patch.value as object), source: next} as never};
        if (replaced !== patch && patchIndex < 0) patchIndex = position;
        return replaced;
    });
    if (sameJson(change.patches, before)) return {ok: false, failure: {code: "accumulated-value", origins: back.origins, op: index}};
    return {route: {kind: "patch", change: change.id, patch: patchIndex}};
}

/** 在候选世界上逐项读回核对（输出 25）：剧情变化在新变更之后的那一点读，改设定在读取位置读。 */
export function checkPlan(plan: EntryPlan, result: WriteResult): EntryEditResult {
    if (!result.ok) {
        if (result.failure.code !== "validation-failed" || plan.targets.length === 0) return result;
        // 发布前的校验按候选对象与路径报问题：对得上某一项写下的位置时带上它的序号。
        const located = result.failure.problems.map((item) => {
            const ref = item.ref;
            const found = ref === undefined ? undefined : plan.targets.find((candidate) => candidate.ref.kind === ref.kind && candidate.path === item.path
                && (candidate.ref.id === ref.id || (candidate.ref.id === STORY_CHANGE_TMP && ref.kind === "change" && plan.isNewChange(ref.id))));
            return found === undefined ? item : {...item, op: found.op};
        });
        return {ok: false, failure: {...result.failure, problems: located}};
    }
    const changeId = result.ids[STORY_CHANGE_TMP];
    for (const expect of plan.expects) {
        let got: unknown;
        if (expect.story) {
            const slot = changeId === undefined ? null : result.world.lineAt(plan.position)?.engine.slotAfter(changeId, expect.at) ?? null;
            got = slot?.value;
        } else {
            const after = currentAt(result.world, plan.position, expect.at);
            got = after === "chapter-not-found" || after === "line-not-found" ? undefined : after.value;
        }
        const matches = "value" in expect
            ? sameJson(got ?? null, expect.value ?? null) || (expect.value === undefined && got === undefined)
            : Array.isArray(got) && (got as unknown[]).some((item) => (typeof item === "string" ? item : (item as {id?: unknown} | null)?.id) === expect.has) === expect.present;
        if (!matches) return {ok: false, failure: {code: "result-mismatch", got, op: expect.op}};
    }
    const later = [...new Set(plan.addresses.flatMap((at) => laterRecords(result.world, plan.position, at)))];
    return {...result, routes: plan.routes, laterRecords: later};
}

export type EntryEditResult = (Extract<WriteResult, {ok: true}> & {readonly routes: readonly EditRoute[]; readonly laterRecords: readonly string[]}) | {readonly ok: false; readonly failure: EntryEditFailure};

/** 当前的读取戳（世界服务给）：比 `readStamp` 用。 */
export interface CurrentStamp {
    readonly version: number;
    readonly inputDigest: string;
}

/** 读取戳没变就是 null；变了给出 `stale-read`（之间的修订从世界的修订表里取）。 */
export function staleRead(wanted: {readonly version: number; readonly input: string}, now: CurrentStamp, revisions: readonly {readonly id: string; readonly version: number; readonly title: string; readonly by: Actor}[]): StaleRead | null {
    const inputChanged = !now.inputDigest.startsWith(wanted.input);
    if (now.version === wanted.version && !inputChanged) return null;
    return {code: "stale-read", inputChanged: now.version === wanted.version && inputChanged, revisions: revisions.filter((revision) => revision.version > wanted.version).map(({id, title, by}) => ({id, title, by}))};
}

/** 世界服务给的读取戳与修订表：比 `readStamp` 用（输出 25）。不给时不比。 */
export interface EntryEditsOptions {
    readonly stamp?: () => {readonly now: CurrentStamp; readonly revisions: readonly {readonly id: string; readonly version: number; readonly title: string; readonly by: Actor}[]};
}

/** 调用方输入的摘要：同一个请求 id 重发时按它比（输出 16、24）。 */
function entriesDigest(world: World, input: EntryEdits): string {
    return world.options.digest(stableStringify({editEntries: input}));
}

/**
 * 发布（候选世界，不落库）并核对（输出 25）。先后：请求 id 已发布过就按输入摘要返回第一次的结果或拒收，不读值、不比读取戳；
 * 再比读取戳；最后定方案、算候选、读回核对。世界服务在写队列里调用它，核对通过的候选才追加日志。
 */
export function editEntries(world: World, input: EntryEdits, time: string, options: EntryEditsOptions = {}): EntryEditResult {
    const digest = entriesDigest(world, input);
    const published = world.requested(input.requestId);
    if (published !== undefined) {
        if (published.requestDigest !== digest) return {ok: false, failure: {code: "request-id-reused"}};
        return {ok: true, world, revision: published, ids: published.idMap ?? {}, repeated: true, routes: [], laterRecords: []};
    }
    if (input.readStamp !== undefined && options.stamp !== undefined) {
        const {now, revisions} = options.stamp();
        const stale = staleRead(input.readStamp, now, revisions);
        if (stale !== null) return {ok: false, failure: stale};
    }
    const planned = planEntries(world, input);
    if (!planned.ok) return planned;
    return checkPlan(planned, world.publish(planned.request, time, digest));
}

/** 只算不发布（输出 25 与 22）：与写入同一份方案；用一个没人用过的请求 id 去算，返回时写回调用方的请求 id。 */
export function previewEntries(world: World, input: EntryEdits, time: string): EntryEditResult {
    const planned = planEntries(world, input);
    if (!planned.ok) return planned;
    let requestId = `preview:${planned.request.requestId}`;
    while (world.requested(requestId) !== undefined) requestId = `preview:${requestId}`;
    const result = checkPlan(planned, world.preview({...planned.request, requestId}, time));
    return result.ok ? {...result, revision: {...result.revision, requestId: planned.request.requestId}} : result;
}
