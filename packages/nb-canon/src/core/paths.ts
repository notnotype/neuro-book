/**
 * 修订里的字段路径与“只存变了的叶子”（docs/specs/canon/revisions.md 输入与前置条件）。
 *
 * 路径的写法：
 * - 对象的键：标识符写 `.键`（第一段不带点），别的键（例如 `initBasis` 里以地址为键的 `"panel.存款"`）写 `["键"]`，
 *   方括号里是 JSON 字符串；
 * - 有 id 的列表：元素写 `[id]`，不用下标；顺序变了另记一个叶子 `<列表的路径>#order`，值是 id 的列表。哪些数组
 *   是有 id 的列表由调用方按对象的种类声明（`IdListMatcher`，清单见 id-lists.ts），不看元素长什么样：决策挂的
 *   对象、稳定键里的对象这类元素也带 `id` 的数组，按 Spec 整体是一个叶子，按结构猜会在重放时丢元素；
 * - 其余数组（别名、补丁、连接、参与者……）整体是一个叶子。
 *
 * 字段不存在用 `FieldChange` 里缺省的 `before`、`after` 表示；JSON 的 null 是“未知”，与不存在不同。
 */

import {isIdentifierName} from "./identifiers";
import {sameJson} from "./stable-json";

export interface FieldChange {
    readonly path: string;
    readonly before?: unknown;
    readonly after?: unknown;
}

type Segment = {readonly kind: "key"; readonly key: string} | {readonly kind: "id"; readonly id: string};

const ORDER_SUFFIX = "#order";

/** 给出一串对象键（从对象的根起，不含列表元素），答这里的数组是不是有 id 的列表。 */
export type IdListMatcher = (keys: readonly string[]) => boolean;

/** 算出从 `before` 到 `after` 变了哪些叶子。两者都是 JSON 值；`undefined` 表示不存在。 */
export function diffValues(before: unknown, after: unknown, isIdListAt: IdListMatcher): FieldChange[] {
    const changes: FieldChange[] = [];
    diffInto(changes, [], before, after, isIdListAt);
    return changes;
}

function diffInto(changes: FieldChange[], base: readonly Segment[], before: unknown, after: unknown, isIdListAt: IdListMatcher): void {
    if (before === undefined && after === undefined) return;
    if (sameJson(before, after)) return;
    if (isPlainObject(before) && isPlainObject(after)) {
        const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
        for (const key of [...keys].sort()) diffInto(changes, [...base, {kind: "key", key}], before[key], after[key], isIdListAt);
        return;
    }
    if (Array.isArray(before) && Array.isArray(after) && declaredIdList(base, isIdListAt) && isIdList(before, after)) {
        const beforeById = new Map(before.map((item) => [(item as {id: string}).id, item]));
        const afterById = new Map(after.map((item) => [(item as {id: string}).id, item]));
        const ids = new Set([...beforeById.keys(), ...afterById.keys()]);
        for (const id of ids) diffInto(changes, [...base, {kind: "id", id}], beforeById.get(id), afterById.get(id), isIdListAt);
        const beforeOrder = before.map((item) => (item as {id: string}).id);
        const afterOrder = after.map((item) => (item as {id: string}).id);
        // 只有共同元素的相对顺序变了才记顺序；纯增删时新元素的位置也要记，所以比的是整份顺序。
        if (!sameJson(beforeOrder, afterOrder)) changes.push({path: formatSegments(base) + ORDER_SUFFIX, before: beforeOrder, after: afterOrder});
        return;
    }
    const path = formatSegments(base);
    changes.push({path, ...(before === undefined ? {} : {before}), ...(after === undefined ? {} : {after})});
}

/**
 * 把一组改动套到一个值上，返回新值（不改原值）。`side` 为 `after` 是重放，为 `before` 是还原。
 * 顺序：先套元素与键，最后套 `#order`；新增的元素先追加到末尾，再由顺序叶子摆好。
 */
export function applyChanges(value: unknown, changes: readonly FieldChange[], side: "before" | "after"): unknown {
    let result = structuredClone(value);
    const orders: FieldChange[] = [];
    for (const change of changes) {
        if (change.path.endsWith(ORDER_SUFFIX)) {
            orders.push(change);
            continue;
        }
        const present = side in change;
        result = setAt(result, parseSegments(change.path), present ? structuredClone(change[side]) : undefined, present);
    }
    for (const change of orders) {
        const listPath = parseSegments(change.path.slice(0, -ORDER_SUFFIX.length));
        const order = change[side] as string[] | undefined;
        if (order === undefined) continue;
        result = setAt(result, listPath, reorder(getAt(result, listPath), order), true);
    }
    return result;
}

function reorder(list: unknown, order: readonly string[]): unknown {
    if (!Array.isArray(list)) return list;
    const byId = new Map(list.map((item) => [(item as {id: string}).id, item]));
    const ordered = order.filter((id) => byId.has(id)).map((id) => byId.get(id));
    // 顺序叶子里没有的元素（理论上不会有）保留在末尾，不丢数据。
    for (const item of list) if (!order.includes((item as {id: string}).id)) ordered.push(item);
    return ordered;
}

function getAt(value: unknown, segments: readonly Segment[]): unknown {
    let current = value;
    for (const segment of segments) {
        if (segment.kind === "key") current = isPlainObject(current) ? current[segment.key] : undefined;
        else current = Array.isArray(current) ? current.find((item) => (item as {id?: string}).id === segment.id) : undefined;
    }
    return current;
}

function setAt(value: unknown, segments: readonly Segment[], next: unknown, present: boolean): unknown {
    if (segments.length === 0) return present ? next : undefined;
    const [head, ...rest] = segments as [Segment, ...Segment[]];
    if (head.kind === "key") {
        const object: Record<string, unknown> = isPlainObject(value) ? {...value} : {};
        const child = setAt(object[head.key], rest, next, present);
        if (child === undefined) delete object[head.key];
        else object[head.key] = child;
        return object;
    }
    const list = Array.isArray(value) ? [...value] : [];
    const index = list.findIndex((item) => (item as {id?: string}).id === head.id);
    const child = setAt(index >= 0 ? list[index] : undefined, rest, next, present);
    if (child === undefined) {
        if (index >= 0) list.splice(index, 1);
    } else if (index >= 0) list[index] = child;
    else list.push(child);
    return list;
}

/** 声明为有 id 的列表的位置：路径全是对象键（列表元素里面不再有有 id 的列表）且匹配声明。 */
function declaredIdList(base: readonly Segment[], isIdListAt: IdListMatcher): boolean {
    if (base.length === 0 || base.some((segment) => segment.kind !== "key")) return false;
    return isIdListAt(base.map((segment) => (segment as {key: string}).key));
}

function isIdList(a: readonly unknown[], b: readonly unknown[]): boolean {
    if (a.length === 0 && b.length === 0) return false;
    const hasId = (item: unknown) => isPlainObject(item) && typeof item.id === "string";
    return a.every(hasId) && b.every(hasId);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function formatSegments(segments: readonly Segment[]): string {
    let path = "";
    for (const segment of segments) {
        if (segment.kind === "id") path += `[${segment.id}]`;
        else if (isIdentifierName(segment.key)) path += path === "" ? segment.key : `.${segment.key}`;
        else path += `[${JSON.stringify(segment.key)}]`;
    }
    return path;
}

/** 解析路径；写法不对抛错（路径只由本模块写出，读到坏路径说明日志被改坏了，由调用方转成诊断）。 */
export function parseSegments(path: string): Segment[] {
    const segments: Segment[] = [];
    let index = 0;
    while (index < path.length) {
        const char = path[index]!;
        if (char === ".") {
            index += 1;
            continue;
        }
        if (char === "[") {
            if (path[index + 1] === "\"") {
                // JSON 字符串：找到不被转义的收尾引号。
                let end = index + 2;
                while (end < path.length && !(path[end] === "\"" && path[end - 1] !== "\\")) end += 1;
                segments.push({kind: "key", key: JSON.parse(path.slice(index + 1, end + 1)) as string});
                if (path[end + 1] !== "]") throw new Error(`bad path: ${path}`);
                index = end + 2;
            } else {
                const end = path.indexOf("]", index);
                if (end < 0) throw new Error(`bad path: ${path}`);
                segments.push({kind: "id", id: path.slice(index + 1, end)});
                index = end + 1;
            }
            continue;
        }
        let end = index;
        while (end < path.length && path[end] !== "." && path[end] !== "[") end += 1;
        segments.push({kind: "key", key: path.slice(index, end)});
        index = end;
    }
    return segments;
}

/** 修订路径的段，供依赖分析按段比较前缀。 */
export type PathSegment = Segment;
