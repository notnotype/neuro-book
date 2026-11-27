/**
 * Agent 工具里名字与地址的解析（docs/specs/canon/agent-tools.md 输出 7）：模块、字段、列表元素与子字段写 id 或名字，换成内核的
 * 地址。只看传进来的条目读取与登记的类型，不调世界；重名时不替调用方选，回话列出候选的 id。
 */

import type {ComponentType, EntryView, FieldDeclaration} from "@notnotype/nb-canon/schema";

/** “模块.字段[元素].子字段”换成内核的地址：模块写命名空间或类型名，字段、元素、子字段写 id 或名字。 */
export function resolveField(given: string, view: EntryView, declarations: Readonly<Record<string, readonly FieldDeclaration[]>>, components: readonly ComponentType[]): {readonly path: string; readonly field?: FieldDeclaration; readonly item?: FieldDeclaration} | {readonly problem: string} {
    if (given === "名字" || given === "entry.name") return {path: "entry.name"};
    if (given === "简介" || given === "entry.summary") return {path: "entry.summary"};
    if (given === "别名" || given === "entry.aliases") return {path: "entry.aliases"};
    if (/^text\[[^\]]+\]$/u.test(given)) return {path: given};
    const match = /^([^.[\]]+)\.([^.[\]]+)(?:\[([^\]]+)\](?:\.([^.[\]]+))?)?$/u.exec(given.trim());
    if (match === null) return {problem: `field 写“模块.字段”或“模块.字段[元素].子字段”，不是“${given}”。`};
    const [, group, name, element, sub] = match as unknown as [string, string, string, string | undefined, string | undefined];
    const present = components.filter((type) => declarations[type.namespace] !== undefined);
    const groups = Object.keys(declarations).map((key) => `${components.find((type) => type.namespace === key)?.label ?? key}（${key}）`).join("、") || "无";
    const named = declarations[group] !== undefined ? group : uniqueNamed(present, group, (type) => type.namespace, (type) => type.label);
    if (typeof named !== "string" && "problem" in named) return {problem: named.problem === "none" ? `条目上没有模块“${group}”；有：${groups}。先 addComponent。` : `“${group}”对应几个模块：${named.candidates.join("、")}，写命名空间。`};
    const namespace = typeof named === "string" ? named : named.namespace;
    const fields = declarations[namespace]!;
    const field = uniqueNamed(fields, name, (candidate) => candidate.id, (candidate) => candidate.label);
    if ("problem" in field) return {problem: field.problem === "none" ? `模块 ${namespace} 里没有字段“${name}”；有：${fields.map((candidate) => candidate.label).join("、")}。` : `“${name}”对应几个字段：${field.candidates.join("、")}，写字段 id。`};
    if (element === undefined) return {path: `${namespace}.${field.id}`, field};
    const value = view.namespaces[namespace]?.fields[field.id]?.value;
    const items = (Array.isArray(value) ? value : []) as Array<{id?: unknown; label?: unknown}>;
    const item = uniqueNamed(items, element, (candidate) => String(candidate.id), (candidate) => (typeof candidate.label === "string" ? candidate.label : undefined));
    if ("problem" in item) return {problem: item.problem === "none" ? `列表 ${namespace}.${field.id} 里没有元素“${element}”。` : `列表 ${namespace}.${field.id} 里有几项叫“${element}”：${item.candidates.join("、")}，写元素 id。`};
    if (sub === undefined) return {path: `${namespace}.${field.id}[${String(item.id)}]`, field};
    const subField = uniqueNamed(field.item ?? [], sub, (candidate) => candidate.id, (candidate) => candidate.label);
    if ("problem" in subField) return {problem: subField.problem === "none" ? `元素没有字段“${sub}”；有：${(field.item ?? []).map((candidate) => candidate.label).join("、")}。` : `“${sub}”对应几个子字段：${subField.candidates.join("、")}，写子字段 id。`};
    return {path: `${namespace}.${field.id}[${String(item.id)}].${subField.id}`, field, item: subField};
}

/** 按 id 或显示名找唯一的一项：id 全等的优先；显示名重名时不替调用方选，交回几个候选的 id。 */
export function uniqueNamed<T extends object>(items: readonly T[], given: string, idOf: (item: T) => string, labelOf: (item: T) => string | undefined): T | {readonly problem: "none" | "many"; readonly candidates: readonly string[]} {
    const byId = items.find((item) => idOf(item) === given);
    if (byId !== undefined) return byId;
    const byLabel = items.filter((item) => labelOf(item) === given);
    if (byLabel.length === 1) return byLabel[0]!;
    return {problem: byLabel.length === 0 ? "none" : "many", candidates: byLabel.map(idOf)};
}

/** 模块写类型 id、命名空间或名字（`create` 的 `components` 与 `fields`）；名字重名时列出几个类型。 */
export function componentNamed(components: readonly ComponentType[], given: string): ComponentType | {readonly problem: string} {
    const byKey = components.find((type) => type.id === given || type.namespace === given);
    if (byKey !== undefined) return byKey;
    const found = uniqueNamed(components, given, (type) => type.id, (type) => type.label);
    if (!("problem" in found)) return found;
    return {problem: found.problem === "none" ? `没有模块“${given}”；有：${components.map((type) => type.label).join("、")}。` : `“${given}”对应几个模块：${components.filter((type) => type.label === given).map((type) => `${type.id}（${type.namespace}）`).join("、")}，写类型 id 或命名空间。`};
}
