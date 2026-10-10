/**
 * Profile 注册字段 harness/model（docs/specs/harness/models.md 输出 3）：Profile 声明偏好的模型或缺省角色。
 * 字段值的校验归 Profile 主机（按这里的 schema）；本模块只把已校验的值变成选择链的 profile 段。
 */

import Type from "typebox";
import type {SelectRequest} from "./types";

/** 与 config 的 MODEL_REF_PATTERN 同一语法（各自声明，不跨模块导入）。 */
const MODEL_REF_SOURCE = "^[A-Za-z0-9._-]+/[^\\s\\p{Cc}]+$";

const ModelField = Type.Object(
    {
        model: Type.Optional(Type.String({pattern: MODEL_REF_SOURCE})),
        role: Type.Optional(Type.String({minLength: 1})),
    },
    {additionalProperties: false},
);

export const MODEL_FIELD = Object.freeze({id: "harness/model", schema: ModelField});

export function selectionFromProfile(profile: {id: string; fields: Readonly<Record<string, unknown>>}): NonNullable<SelectRequest["profile"]> {
    const field = profile.fields[MODEL_FIELD.id];
    const given = typeof field === "object" && field !== null && !Array.isArray(field) ? (field as {model?: unknown; role?: unknown}) : {};
    return {
        id: profile.id,
        ...(typeof given.model === "string" ? {model: given.model} : {}),
        ...(typeof given.role === "string" ? {defaultRole: given.role} : {}),
    };
}
