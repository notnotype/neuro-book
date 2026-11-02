/**
 * 状态的地址（docs/specs/canon/model.md 术语“地址”）：条目 id 加路径。路径只有三种根：
 * - `entry.name`、`entry.aliases`、`entry.summary`；
 * - `text[<块 id>]`；
 * - `<命名空间>.<字段 id>`，可再接 `[<元素 id>]` 与 `.<子字段 id>`；`<命名空间>.启用` 是控制字段。
 * 存下来的路径只用 id。这里只管写法；字段在不在声明里由 components 判。
 */

import {isIdentifierName, isNamespaceName} from "./identifiers";
import type {Address} from "./schema";

export type {Address};

export type ParsedPath =
    | {readonly root: "entry"; readonly field: "name" | "aliases" | "summary"}
    | {readonly root: "text"; readonly block: string}
    | {readonly root: "namespace"; readonly namespace: string; readonly field: string; readonly element?: string; readonly sub?: string};

const ENTRY_FIELDS = new Set(["name", "aliases", "summary"]);
const NAMESPACE_PATH = /^([^.[\]]+)\.([^.[\]]+)(?:\[([^.[\]]+)\](?:\.([^.[\]]+))?)?$/u;
const TEXT_PATH = /^text\[([^.[\]]+)\]$/u;

/** 解析一条存下来的路径；不合写法返回 null。 */
export function parsePath(path: string): ParsedPath | null {
    const text = TEXT_PATH.exec(path);
    if (text !== null) return isIdentifierName(text[1]!) ? {root: "text", block: text[1]!} : null;
    const match = NAMESPACE_PATH.exec(path);
    if (match === null) return null;
    const [, root, field, element, sub] = match as unknown as [string, string, string, string | undefined, string | undefined];
    if (root === "entry") return element === undefined && ENTRY_FIELDS.has(field) ? {root: "entry", field: field as "name" | "aliases" | "summary"} : null;
    if (!isNamespaceName(root) || !isIdentifierName(field)) return null;
    if (element !== undefined && !isIdentifierName(element)) return null;
    if (sub !== undefined && !isIdentifierName(sub)) return null;
    return {root: "namespace", namespace: root, field, ...(element === undefined ? {} : {element}), ...(sub === undefined ? {} : {sub})};
}

export function formatPath(parsed: ParsedPath): string {
    if (parsed.root === "entry") return `entry.${parsed.field}`;
    if (parsed.root === "text") return `text[${parsed.block}]`;
    let path = `${parsed.namespace}.${parsed.field}`;
    if (parsed.element !== undefined) path += `[${parsed.element}]`;
    if (parsed.sub !== undefined) path += `.${parsed.sub}`;
    return path;
}

/** 两个地址是否重叠：同一条目，且一条路径是另一条的前缀（按段比较，`panel.任务` 盖住 `panel.任务[t3].奖励`）。 */
export function addressesOverlap(a: Address, b: Address): boolean {
    if (a.entry !== b.entry) return false;
    return pathCovers(a.path, b.path) || pathCovers(b.path, a.path);
}

function pathCovers(outer: string, inner: string): boolean {
    if (outer === inner) return true;
    if (!inner.startsWith(outer)) return false;
    const next = inner[outer.length];
    return next === "." || next === "[";
}

export function addressKey(address: Address): string {
    return `${address.entry}\u0000${address.path}`;
}
