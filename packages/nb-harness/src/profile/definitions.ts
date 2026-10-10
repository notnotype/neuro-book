/**
 * 注册定义的校验（Spec 输出 1 的 invalid-definition）。节点、数据源与字段的定义由注册方写，这里只认形状，不认语义。
 */

import type {FieldDefinition, NodeTypeDefinition, SourceDefinition} from "./types";

export const TYPE_ID_PATTERN = /^[a-z0-9][a-z0-9.-]*\/[a-z0-9][a-z0-9._-]*$/u;
export const PROFILE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const CATEGORIES = new Set(["message", "content", "stateful"]);
const ROLES = new Set(["user", "developer", "assistant"]);
const PHASES = new Set(["invocation", "model-call"]);

const isObjectSchema = (value: unknown): boolean => typeof value === "object" && value !== null && (value as {type?: unknown}).type === "object";
const isStringList = (value: unknown): value is readonly string[] => Array.isArray(value) && value.every((item) => typeof item === "string");

export function nodeDefinitionProblem(definition: unknown): string | null {
    if (typeof definition !== "object" || definition === null) return "定义必须是对象";
    const d = definition as Partial<NodeTypeDefinition> & Record<string, unknown>;
    if (typeof d.id !== "string" || !TYPE_ID_PATTERN.test(d.id)) return "id 必须是 <命名空间>/<名称>";
    if (!CATEGORIES.has(d.category as string)) return "category 必须是 message、content 或 stateful";
    if (!isObjectSchema(d.props)) return "props 必须是对象 schema";
    if (!isStringList(d.parents) || d.parents.length === 0) return "parents 必须是非空的节点类型 id 列表";
    if (!(d.children === "none" || d.children === "content" || isStringList(d.children))) return "children 必须是 none、content 或节点类型 id 列表";
    if (d.sources !== undefined && !isStringList(d.sources)) return "sources 必须是数据源 id 列表";
    if (d.category === "message" && !ROLES.has(d.role as string)) return "消息节点必须给出 role：user、developer 或 assistant";
    if (d.category !== "message" && typeof d.render !== "function") return "内容与有状态节点必须给出 render 函数";
    if (d.category === "content" && d.layout !== undefined && d.layout !== "inline" && d.layout !== "block") return "layout 只能是 inline 或 block";
    if (d.category === "stateful") {
        const required = (d.props as {required?: unknown}).required;
        const properties = (d.props as {properties?: Record<string, unknown>}).properties;
        if (!Array.isArray(required) || !required.includes("id") || properties?.id === undefined) return "有状态节点的 props 必须有必填的 id";
    }
    return null;
}

export function sourceDefinitionProblem(definition: unknown): string | null {
    if (typeof definition !== "object" || definition === null) return "定义必须是对象";
    const d = definition as Partial<SourceDefinition>;
    if (typeof d.id !== "string" || !TYPE_ID_PATTERN.test(d.id)) return "id 必须是 <命名空间>/<名称>";
    if (typeof d.schema !== "object" || d.schema === null) return "schema 必须是 TypeBox schema";
    if (!PHASES.has(d.phase as string)) return "phase 必须是 invocation 或 model-call";
    if (typeof d.resolve !== "function") return "resolve 必须是函数";
    return null;
}

export function fieldDefinitionProblem(definition: unknown): string | null {
    if (typeof definition !== "object" || definition === null) return "定义必须是对象";
    const d = definition as Partial<FieldDefinition>;
    if (typeof d.id !== "string" || !TYPE_ID_PATTERN.test(d.id)) return "id 必须是 <命名空间>/<名称>";
    if (typeof d.schema !== "object" || d.schema === null) return "schema 必须是 TypeBox schema";
    return null;
}
