import type {TSchema} from "typebox";
import {Value} from "typebox/value";

/**
 * 格式化 TypeBox 严格校验错误。保留 JSON Pointer，避免把用户可修正的
 * schema 问题退化成 TypeBox 的通用 `Parse` 文案。
 */
export function formatTypeBoxValueErrors(schema: TSchema, value: unknown): string {
    const errors = [...Value.Errors(schema, value)];
    if (errors.length === 0) {
        return "值不符合 schema";
    }
    return errors
        .flatMap((error) => formatTypeBoxError(error as unknown as TypeBoxValueError))
        .join("；");
}

/** 严格校验，不执行 Parse/Convert 或默认值填充。 */
export function assertTypeBoxValue(schema: TSchema, value: unknown): void {
    if (!Value.Check(schema, value)) {
        throw new Error(formatTypeBoxValueErrors(schema, value));
    }
}

type TypeBoxValueError = {
    keyword?: string;
    instancePath?: string;
    path?: string;
    message: string;
    params?: {
        requiredProperties?: unknown;
        additionalProperties?: unknown;
    };
};

function formatTypeBoxError(error: TypeBoxValueError): string[] {
    const basePath = error.instancePath ?? error.path ?? "";
    if (error.keyword === "required" && Array.isArray(error.params?.requiredProperties)) {
        return error.params.requiredProperties
            .filter((field): field is string => typeof field === "string")
            .map((field) => `${joinPointer(basePath, field)}：缺少必填字段`);
    }
    if (error.keyword === "additionalProperties" && Array.isArray(error.params?.additionalProperties)) {
        return error.params.additionalProperties
            .filter((field): field is string => typeof field === "string")
            .map((field) => `${joinPointer(basePath, field)}：不允许的额外字段`);
    }
    const message = error.message === "Expected required property"
        ? "缺少必填字段"
        : error.message === "Unexpected property"
            ? "不允许的额外字段"
            : error.message;
    return [`${basePath || "/"}：${message}`];
}

function joinPointer(basePath: string, field: string): string {
    const escaped = field.replaceAll("~", "~0").replaceAll("/", "~1");
    return `${basePath}/${escaped}` || "/";
}
