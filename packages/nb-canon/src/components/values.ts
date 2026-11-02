/**
 * 字段值按声明校验（docs/specs/canon/components.md 输入与前置条件的值表、输出 14、15）。
 * 所有种类的值都可以是未知（null）。语义档的值是文字；赋值时可以给数或文字，数按十进制写成文字、声明了单位的加单位。
 */

import {exactProblem} from "../core/decimal";
import {isIdentifierName} from "../core/identifiers";
import type {FieldDeclaration} from "../core/schema";

export type ValueProblem = "type-mismatch" | "number-out-of-range" | "invalid-asset-path";

/** 合格返回 null。`value` 是字段的整值（列表是整个元素列表）。 */
export function valueProblem(field: FieldDeclaration, value: unknown): ValueProblem | null {
    if (value === null) return null;
    if (field.precision === "semantic") return typeof value === "string" || typeof value === "number" ? numberProblem(value) : "type-mismatch";
    switch (field.kind) {
        case "number":
            return typeof value === "number" ? numberProblem(value) : "type-mismatch";
        case "text":
            return typeof value === "string" ? null : "type-mismatch";
        case "enum":
            return typeof value === "string" && (field.options ?? []).includes(value) ? null : "type-mismatch";
        case "boolean":
            return typeof value === "boolean" ? null : "type-mismatch";
        case "image":
            return imageProblem(value);
        case "list": {
            if (!Array.isArray(value)) return "type-mismatch";
            const ids = new Set<string>();
            for (const item of value) {
                const problem = listItemProblem(field, item);
                if (problem !== null) return problem;
                const id = (item as {id: string}).id;
                if (ids.has(id)) return "type-mismatch";
                ids.add(id);
            }
            return null;
        }
    }
}

/** 列表的一个元素：`{id, label, …子字段}`，子字段按 `item` 声明校验。 */
export function listItemProblem(field: FieldDeclaration, item: unknown): ValueProblem | null {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return "type-mismatch";
    const record = item as Record<string, unknown>;
    if (typeof record.id !== "string" || !isIdentifierName(record.id) || typeof record.label !== "string") return "type-mismatch";
    for (const sub of field.item ?? []) {
        if (!(sub.id in record)) continue;
        const problem = valueProblem(sub, record[sub.id]);
        if (problem !== null) return problem;
    }
    return null;
}

function numberProblem(value: string | number): ValueProblem | null {
    if (typeof value !== "number") return null;
    return exactProblem(value) === null ? null : "number-out-of-range";
}

function imageProblem(value: unknown): ValueProblem | null {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return "type-mismatch";
    const record = value as Record<string, unknown>;
    if (typeof record["图片"] !== "string" || typeof (record["说明"] ?? "") !== "string") return "type-mismatch";
    return assetPathProblem(record["图片"]);
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/iu;

/** 作品内路径：相对作品根、不带协议、不以 `/` 开头、没有 `..` 段、不在 `.nbook/` 下（components.md 输出 15）。 */
export function assetPathProblem(path: string): "invalid-asset-path" | null {
    if (path === "" || SCHEME.test(path) || path.startsWith("/") || path.includes("\\")) return "invalid-asset-path";
    const segments = path.split("/");
    if (segments.some((segment) => segment === ".." || segment === "")) return "invalid-asset-path";
    if (segments[0]!.toLowerCase() === ".nbook") return "invalid-asset-path";
    return null;
}

/** 语义档赋值时给的数写成文字：十进制，声明了单位的加单位（components.md 值表）。 */
export function semanticText(field: FieldDeclaration, value: string | number): string {
    if (typeof value === "string") return value;
    return field.unit === undefined ? String(value) : `${String(value)} ${field.unit}`;
}
