/**
 * 回执（docs/specs/canon/author-ui.md 输出 20）：把一次修订存下的操作（canon.revisions 的“存下来的修订”）折成给作者看的几节。
 * 新建、修改、删除各一节，章序调整只有一节；修改列出每个字段的显示名与改前、改后。修订里的路径是存下来的对象的路径
 * （`init.data.panel.fields.存款`），这里换成界面上的名字：字段用条目的字段声明，别的键用固定的几个词；认不出的写“别的设置”。
 * 名字与显示名经调用方给的 `ReceiptLookups` 取（回执页按需读），这里都是纯函数。
 */

import type {Placement, Revision, StoryChange} from "@notnotype/nb-canon";

import {impactLines} from "./impact";
import type {CanonBoundText} from "./positions";
import {patchLine, shownValue} from "./rows";

export interface ReceiptLookups {
    /** 条目在缺省位置上的名字；读不到时为 undefined。 */
    entryName(id: string): string | undefined;
    /** “星瑕的存款”这样的一句。 */
    address(at: {readonly entry: string; readonly path: string}): string;
    /** 字段显示名（`<命名空间>.<字段>` 起头的路径）。 */
    label(path: string, entry: string): string;
    /** 剧情变更现在的文字；读不到时为 undefined。 */
    changeText(id: string): string | undefined;
    place(at: Placement): string;
    /** 一章写成“第 N 章：标题”；章表里没有时写“已删除的一章”。 */
    chapter(id: string): string;
}

export interface ReceiptField {
    readonly label: string;
    readonly before: string;
    readonly after: string;
    /** 同一个显示名的几行并成一行时把 `after` 连起来（“添加了一项：种族、生日”），不写成“改了几处”。 */
    readonly joins?: boolean;
}

export interface ReceiptItem {
    readonly key: string;
    /** 条目与剧情变更的名字可以点，打开它的页面。 */
    readonly ref: {readonly kind: "entry" | "change"; readonly id: string} | null;
    readonly name: string;
    readonly fields: readonly ReceiptField[];
}

export type ReceiptSectionKind = "create" | "modify" | "delete" | "chapters";

export interface ReceiptSection {
    readonly kind: ReceiptSectionKind;
    readonly items: readonly ReceiptItem[];
}

export interface ReceiptModel {
    readonly title: string;
    /** 谁、什么时候、种类。 */
    readonly by: string;
    readonly time: string;
    readonly what: string;
    readonly sections: readonly ReceiptSection[];
    readonly impact: readonly string[];
    /** 这次是一次还原：还原的是哪几次（从旧到新）。 */
    readonly reverts: readonly string[];
}

type Op = Revision["ops"][number];
type ObjectOp = Exclude<Op, {kind: "chapters"}>;

/** 回执页要读名字的条目：被改的、带来的变化里的、改动与引用指向的。 */
export function receiptEntryIds(revision: Revision): string[] {
    const ids = new Set<string>();
    for (const op of revision.ops) {
        if (op.kind === "chapters") continue;
        if (op.ref.kind === "entry") ids.add(op.ref.id);
        if (op.ref.kind === "change") {
            if (op.kind !== "modify") for (const id of mentionedEntries(op.kind === "create" ? op.after : op.before)) ids.add(id);
            else {
                for (const field of op.fields) {
                    for (const value of [field.before, field.after]) {
                        // 涉及的条目是 id 的列表，整个是一个叶子；补丁列表整个是一个叶子。
                        if (field.path === "involves" && Array.isArray(value)) for (const id of value) if (typeof id === "string") ids.add(id);
                        if (field.path === "patches" && Array.isArray(value)) for (const patch of value as StoryChange["patches"]) ids.add(patch.at.entry);
                    }
                }
            }
        }
        if (op.kind === "modify" && op.ref.kind === "entry") {
            for (const field of op.fields) {
                if (/^(?:parent|sameAs)$/u.test(field.path)) for (const value of [field.before, field.after]) if (typeof value === "string") ids.add(value);
            }
        }
    }
    for (const value of revision.impact.values) ids.add(value.at.entry);
    return [...ids];
}

/** 修改了而文字没变的剧情变更：名字要另读。 */
export function receiptChangeIds(revision: Revision): string[] {
    return revision.ops.flatMap((op) => (op.kind === "modify" && op.ref.kind === "change" && !op.fields.some((field) => field.path === "text") ? [op.ref.id] : []));
}

/** 一整条剧情变更里提到的条目：补丁的地址、涉及的条目。 */
function mentionedEntries(value: unknown): string[] {
    if (typeof value !== "object" || value === null) return [];
    const change = value as Partial<StoryChange>;
    return [...(change.patches ?? []).map((patch) => patch.at.entry), ...(change.involves ?? [])];
}

const isTombstone = (op: Op): boolean => op.kind === "modify" && op.ref.kind === "entry" && op.fields.some((field) => field.path === "deleted" && field.after === true);

function sectionOf(op: Op): ReceiptSectionKind {
    if (op.kind === "chapters") return "chapters";
    if (op.kind === "create") return "create";
    if (op.kind === "delete" || isTombstone(op)) return "delete";
    return "modify";
}

/** 存下来的对象里的名字：新建与删除的操作自带。 */
function storedName(op: ObjectOp): string | undefined {
    const value = op.kind === "create" ? op.after : op.kind === "delete" ? op.before : undefined;
    if (typeof value !== "object" || value === null) return undefined;
    if (op.ref.kind === "entry") return (value as {init?: {name?: string}}).init?.name;
    if (op.ref.kind === "change") return (value as {text?: string}).text;
    return undefined;
}

function itemName(op: ObjectOp, lookups: ReceiptLookups, text: CanonBoundText): string {
    if (op.ref.kind === "entry") return lookups.entryName(op.ref.id) ?? storedName(op) ?? text("names.someEntry");
    if (op.ref.kind === "change") {
        const changed = op.kind === "modify" ? op.fields.find((field) => field.path === "text")?.after : undefined;
        return (typeof changed === "string" ? changed : undefined) ?? storedName(op) ?? lookups.changeText(op.ref.id) ?? text("names.someChange");
    }
    if (op.ref.kind === "check") return text("receipt.kinds.check");
    if (op.ref.kind === "decision") return text("receipt.kinds.decision");
    return text("receipt.kinds.suggestion");
}

/** 一个值写成一小段：不存在写“（没有）”，结构化的值不展开。 */
function plain(value: unknown, text: CanonBoundText): string {
    if (value === undefined) return text("receipt.absent");
    if (value === null || typeof value !== "object" || (value as {notReduced?: unknown}).notReduced === true) return shownValue(value, text);
    if (Array.isArray(value) && value.every((item) => typeof item === "string")) return value.length === 0 ? text("receipt.absent") : value.join(text("value.listSeparator"));
    const labelled = value as {label?: unknown; name?: unknown; source?: unknown};
    if (typeof labelled.label === "string") return labelled.label;
    if (typeof labelled.name === "string") return labelled.name;
    if (typeof labelled.source === "string") return labelled.source;
    return text("receipt.complex");
}

/** 值写不出来的几种改动（模块、初值的依据、认不出的键）：只写“改了”。 */
const unshown = (label: string, text: CanonBoundText): ReceiptField => ({label, before: "", after: text("receipt.changed")});

const ENTRY_FIELD = /^init\.data\.([^.[\]#]+)\.fields\.([^.[\]#]+)/u;
/** 条目自己的字段声明上的一处改动：整条（`declared[id]`）、它的显示名、“已去掉”的标记，或整个列表与列表的顺序。 */
const DECLARED = /^init\.data\.([^.[\]#]+)\.declared(?:\[([^\]]+)\](\.label|\.removed)?)?(#order)?$/u;

/**
 * 字段声明的改动写成“添加了一项”“去掉了一项”“恢复了一项”“一项改名”（输出 20）；同一类的几处并成一行、名字连起来。
 * 列表的顺序跟着增删变，不另写一行（null）。
 */
function declaredField(match: RegExpExecArray, entry: string, before: unknown, after: unknown, lookups: ReceiptLookups, text: CanonBoundText): ReceiptField | null {
    const [, namespace, id, leaf, order] = match;
    if (order !== undefined) return null;
    const labelOf = (value: unknown): string | undefined => (typeof value === "object" && value !== null && typeof (value as {label?: unknown}).label === "string" ? (value as {label: string}).label : undefined);
    const names = (value: unknown): string => (Array.isArray(value) ? value.map(labelOf).filter((name) => name !== undefined).join(text("value.listSeparator")) : "");
    const joined = (key: "fieldAdded" | "fieldRemoved" | "fieldRestored", name: string): ReceiptField => ({label: text(`receipt.fields.${key}`), before: "", after: name, joins: true});
    // 旧条目的数据里原来没有声明的列表：第一次加的时候整个列表是一处改动。
    if (id === undefined) return joined(names(after) !== "" || before === undefined ? "fieldAdded" : "fieldRemoved", names(after) !== "" ? names(after) : names(before));
    const known = lookups.label(`${namespace!}.${id}`, entry);
    // 改名也连起来：一次改了几项的名字时每一对都写出来，不合成“改了几处”。
    if (leaf === ".label") return {label: text("receipt.fields.fieldRenamed"), before: "", after: `${plain(before, text)} → ${plain(after, text)}`, joins: true};
    if (leaf === ".removed") return joined(after === true ? "fieldRemoved" : "fieldRestored", known);
    return after === undefined ? joined("fieldRemoved", labelOf(before) ?? known) : before === undefined ? joined("fieldAdded", labelOf(after) ?? known) : unshown(text("receipt.fields.other"), text);
}

/** 条目上一处改动的显示名与两侧的值。 */
function entryField(entry: string, path: string, before: unknown, after: unknown, lookups: ReceiptLookups, text: CanonBoundText): ReceiptField | null {
    const declared = DECLARED.exec(path);
    if (declared !== null) return declaredField(declared, entry, before, after, lookups, text);
    const field = ENTRY_FIELD.exec(path);
    const both = (show: (value: unknown) => string, label: string): ReceiptField => ({label, before: show(before), after: show(after)});
    const shown = (value: unknown): string => plain(value, text);
    // 新加的字段还没填值（从没有这个键到“未知”）不是一处改动：加了哪一项已经另写一行。
    if (field !== null && before === undefined && after === null) return null;
    if (field !== null) return both(shown, lookups.label(`${field[1]!}.${field[2]!}`, entry));
    const head = /^[^.[#]+(?:\.[^.[#]+)?/u.exec(path)?.[0] ?? path;
    const named = (value: unknown): string => (typeof value === "string" ? lookups.entryName(value) ?? text("names.someEntry") : text("receipt.absent"));
    switch (head) {
        case "init.name": return both(shown, text("receipt.fields.name"));
        case "init.summary": return both(shown, text("receipt.fields.summary"));
        case "init.aliases": return both(shown, text("receipt.fields.aliases"));
        // 主文字是带字段引用的源文，不写给作者。
        case "init.text": return unshown(text("receipt.fields.text"), text);
        case "init.data":
        case "init.components": return unshown(text("receipt.fields.data"), text);
        case "type": return both(shown, text("receipt.fields.type"));
        case "folder": return both(shown, text("receipt.fields.folder"));
        case "order": return both(shown, text("receipt.fields.order"));
        case "parent": return both((value) => (value === null ? text("newEntry.root") : named(value)), text("receipt.fields.parent"));
        case "sameAs": return both(named, text("receipt.fields.sameAs"));
        case "appears": return both((value) => (value === undefined ? text("newEntry.fromStart") : lookups.place(value as Placement)), text("receipt.fields.appears"));
        case "deleted": return both((value) => shownValue(value === true, text), text("receipt.fields.deleted"));
        case "initBasis": return unshown(text("receipt.fields.initBasis"), text);
        default: return unshown(text("receipt.fields.other"), text);
    }
}

/** 剧情变更上一处改动的显示名与两侧的值。 */
function changeField(path: string, before: unknown, after: unknown, lookups: ReceiptLookups, text: CanonBoundText): ReceiptField {
    const head = /^[^.[#]+/u.exec(path)?.[0] ?? path;
    const both = (show: (value: unknown) => string, label: string): ReceiptField => ({label, before: show(before), after: show(after)});
    const shown = (value: unknown): string => plain(value, text);
    switch (head) {
        case "text": return both(shown, text("receipt.fields.changeText"));
        case "at": return both((value) => (value === undefined ? text("receipt.absent") : lookups.place(value as Placement)), text("receipt.fields.at"));
        case "kind": return both((value) => text(value === "plan" ? "plot.plan" : "receipt.written"), text("receipt.fields.kind"));
        case "status": return both((value) => text(value === "held" ? "plot.held" : value === "undone" ? "plot.undone" : "receipt.active"), text("receipt.fields.status"));
        case "held": return both((value) => (typeof value === "object" && value !== null ? String((value as {note?: unknown}).note ?? "") : text("receipt.absent")), text("receipt.fields.held"));
        case "undoneReason": return both(shown, text("receipt.fields.undoneReason"));
        case "patches": return both((value) => (Array.isArray(value) && value.length > 0 ? (value as StoryChange["patches"]).map((patch) => patchLine(patch, lookups.address(patch.at), text)).join(text("receipt.patchSeparator")) : text("receipt.absent")), text("receipt.fields.patches"));
        case "involves": return both((value) => (Array.isArray(value) && value.length > 0 ? (value as string[]).map((id) => lookups.entryName(id) ?? text("names.someEntry")).join(text("value.listSeparator")) : text("receipt.absent")), text("receipt.fields.involves"));
        case "told": return both((value) => (Array.isArray(value) && value.length > 0 ? (value as {quote?: string}[]).map((telling) => telling.quote ?? "").filter((quote) => quote !== "").join(text("value.listSeparator")) || text("receipt.complex") : text("receipt.absent")), text("receipt.fields.told"));
        default: return unshown(text("receipt.fields.other"), text);
    }
}

/** 同一个显示名的几处改动（一个列表字段的几个元素、主文字的几块）只列一行；值写不出来的那几种只写显示名。`joins` 的几行把值连起来。 */
function merged(fields: readonly ReceiptField[], text: CanonBoundText): ReceiptField[] {
    const byLabel = new Map<string, ReceiptField>();
    for (const field of fields) {
        const known = byLabel.get(field.label);
        if (known === undefined) byLabel.set(field.label, field);
        else if (known.joins === true && field.joins === true) byLabel.set(field.label, {...known, after: `${known.after}${text("value.listSeparator")}${field.after}`});
        else byLabel.set(field.label, {label: field.label, before: "", after: text("receipt.several")});
    }
    return [...byLabel.values()];
}

function itemOf(op: ObjectOp, index: number, lookups: ReceiptLookups, text: CanonBoundText): ReceiptItem {
    const linkable = op.ref.kind === "entry" || op.ref.kind === "change";
    const deletedChange = op.kind === "delete" && op.ref.kind === "change";
    const fieldOf = (field: {readonly path: string; readonly before?: unknown; readonly after?: unknown}): ReceiptField[] => {
        const shown = op.ref.kind === "entry"
            ? entryField(op.ref.id, field.path, field.before, field.after, lookups, text)
            : op.ref.kind === "change" ? changeField(field.path, field.before, field.after, lookups, text) : unshown(text("receipt.fields.other"), text);
        if (shown === null) return [];
        // 列表的顺序叶子，值是元素 id 的列表：只写顺序变了。
        return [field.path.endsWith("#order") ? {label: shown.label, before: "", after: text("receipt.reordered")} : shown];
    };
    const fields = op.kind === "modify" && !isTombstone(op) ? merged(op.fields.flatMap(fieldOf), text) : [];
    return {
        key: `${String(index)}:${op.ref.kind}:${op.ref.id}`,
        // 删掉的剧情变更没有页面可开（删掉的条目还有墓碑，页面写“已删除”）。
        ref: linkable && !deletedChange ? {kind: op.ref.kind as "entry" | "change", id: op.ref.id} : null,
        name: itemName(op, lookups, text),
        fields,
    };
}

const SECTION_ORDER: readonly ReceiptSectionKind[] = ["create", "modify", "delete", "chapters"];

/** 谁写的（输出 20 的“谁”）。 */
export function actorText(by: Revision["by"], text: CanonBoundText): string {
    if (by.kind === "author") return text("receipt.by.author");
    if (by.kind === "agent") return text("receipt.by.agent");
    if (by.kind === "task") return text("receipt.by.task", {name: by.name});
    return text("receipt.by.system");
}

/** 修订的种类（`what`，nb-canon 的 `RevisionWhatSchema`）；不认识的种类写“改动”，不把代码写给作者。 */
const WHATS: Readonly<Record<string, Parameters<CanonBoundText>[0]>> = {
    opening: "receipt.what.opening",
    plan: "receipt.what.plan",
    bookkeeping: "receipt.what.bookkeeping",
    edit: "receipt.what.edit",
    creative: "receipt.what.creative",
    resolve: "receipt.what.resolve",
    suggest: "receipt.what.suggest",
    revert: "receipt.what.revert",
    reorder: "receipt.what.reorder",
};

export function whatText(what: string, text: CanonBoundText): string {
    return text(Object.hasOwn(WHATS, what) ? WHATS[what]! : "receipt.what.other");
}

/** 时间写成本地的“年-月-日 时:分”。 */
export function timeText(time: string): string {
    const date = new Date(time);
    if (Number.isNaN(date.getTime())) return time;
    const two = (value: number): string => String(value).padStart(2, "0");
    return `${String(date.getFullYear())}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

export function receiptModel(revision: Revision, lookups: ReceiptLookups, text: CanonBoundText): ReceiptModel {
    const grouped = new Map<ReceiptSectionKind, ReceiptItem[]>();
    for (const [index, op] of revision.ops.entries()) {
        const kind = sectionOf(op);
        const items = grouped.get(kind) ?? [];
        if (op.kind === "chapters") items.push({key: `${String(index)}:chapters`, ref: null, name: "", fields: [{label: text("receipt.chapterOrder"), before: op.before.map((id) => lookups.chapter(id)).join(text("value.listSeparator")), after: op.after.map((id) => lookups.chapter(id)).join(text("value.listSeparator"))}]});
        else items.push(itemOf(op, index, lookups, text));
        grouped.set(kind, items);
    }
    return {
        title: revision.title,
        by: actorText(revision.by, text),
        time: timeText(revision.time),
        what: whatText(revision.what, text),
        sections: SECTION_ORDER.filter((kind) => grouped.has(kind)).map((kind) => ({kind, items: grouped.get(kind)!})),
        impact: impactLines(revision.impact, {values: "change", address: lookups.address}, text),
        reverts: revision.reverts ?? [],
    };
}
