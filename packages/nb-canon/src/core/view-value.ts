/**
 * 条目在某个位置上的样子（`EntryView`）里一个地址的值：就地改与记一笔要带“读到的值”（revisions.md 输出 8、9），
 * 调用方用它从读取结果里取，与世界核对时用的是同一份取法，不会因为各写一份而对不上（value-conflict）。
 * 只看读取结果，不碰引擎；前后端共用。
 */

import type {EntryView} from "../engine/types";

/** 地址的值、是否不完整（输出 model 10）、所在命名空间是否可写；条目已删除或命名空间只读时 `available` 为假。 */
export interface ViewValue {
    readonly value: unknown;
    readonly incomplete: boolean;
    readonly available: boolean;
}

export function valueAt(view: EntryView | null, path: string): ViewValue {
    if (view === null || view.deleted) return {value: undefined, incomplete: false, available: false};
    const [root, rest] = splitRoot(path);
    if (root === "entry") return {value: structuredClone(view[rest as "name" | "aliases" | "summary"]), incomplete: false, available: true};
    if (root === "text") return {value: view.text.find((block) => `[${block.id}]` === rest)?.source, incomplete: false, available: true};
    const namespace = view.namespaces[root];
    if (namespace === undefined || namespace.readOnly !== undefined) return {value: undefined, incomplete: false, available: false};
    const field = namespace.fields[rest.split("[")[0]!];
    if (field === undefined) return {value: undefined, incomplete: false, available: false};
    let value = field.value;
    const element = /\[([^\]]+)\](?:\.(.+))?$/u.exec(rest);
    if (element !== null) {
        const item = Array.isArray(value) ? (value as Array<Record<string, unknown>>).find((candidate) => candidate.id === element[1]) : undefined;
        value = element[2] === undefined ? item : item?.[element[2]];
    }
    return {value: structuredClone(value), incomplete: field.incomplete !== undefined, available: true};
}

function splitRoot(path: string): [string, string] {
    if (path.startsWith("text[")) return ["text", path.slice(4)];
    const dot = path.indexOf(".");
    return [path.slice(0, dot), path.slice(dot + 1)];
}
