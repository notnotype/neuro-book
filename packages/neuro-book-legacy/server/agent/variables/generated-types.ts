import type {TSchema} from "typebox";
import {builtinVariableDefinitions} from "nbook/server/agent/variables/registry";
import type {VariableDefinition} from "nbook/server/agent/variables/types";

export type VariableTypeGenerationDiagnostic = {
    severity: "warning";
    path: string;
    message: string;
};

export type GeneratedVariableTypes = {
    text: string;
    diagnostics: VariableTypeGenerationDiagnostic[];
};

export const VARIABLE_TYPES_FILE_NAME = "types.d.ts";

export const PROFILE_VARIABLE_IDE_TYPES_FILE = "server/agent/variables/generated-profile-variable-types.d.ts";

/**
 * 生成给 TSX profile authoring 使用的变量类型 declaration。
 * 这是运行时 registry 的派生产物，不参与变量读写真相源。
 */
export function generateVariableTypes(definitions: readonly VariableDefinition[], options: {
    header?: string;
} = {}): GeneratedVariableTypes {
    const diagnostics: VariableTypeGenerationDiagnostic[] = [];
    const lines = [
        "/* eslint-disable */",
        "// This file is generated. Runtime variable truth stays in compiled definitions and registry.",
        options.header ? `// ${options.header}` : "",
        "import type {JsonValue} from \"nbook/server/agent/messages/types\";",
        "",
        "declare module \"nbook/server/agent/variables/types\" {",
        "    interface ProfileVariableValueMap {",
    ].filter(Boolean);

    for (const definition of [...definitions].sort((left, right) => fullPath(left).localeCompare(fullPath(right)))) {
        const path = fullPath(definition);
        const converted = schemaToTypeScript(definition.schema, path);
        diagnostics.push(...converted.diagnostics);
        lines.push(`        ${JSON.stringify(path)}: ${converted.type};`);
    }

    lines.push(
        "    }",
        "}",
        "",
        "export {};",
        "",
    );

    return {
        text: lines.join("\n"),
        diagnostics,
    };
}

export function generateBuiltinVariableTypes(): GeneratedVariableTypes {
    return generateVariableTypes(builtinVariableDefinitions(), {
        header: "Built-in client variable authoring types.",
    });
}

function fullPath(definition: VariableDefinition): string {
    return `${definition.namespace}.${definition.key}`;
}

function schemaToTypeScript(schema: TSchema, path: string): {type: string; diagnostics: VariableTypeGenerationDiagnostic[]} {
    const diagnostics: VariableTypeGenerationDiagnostic[] = [];
    const type = convertSchema(schema, path, diagnostics);
    return {type, diagnostics};
}

function convertSchema(schema: TSchema, path: string, diagnostics: VariableTypeGenerationDiagnostic[]): string {
    const record = schema as Record<string, unknown>;
    if (Object.keys(record).length === 0) {
        return "JsonValue";
    }
    if ("const" in record) {
        return JSON.stringify(record.const);
    }
    if (Array.isArray(record.enum)) {
        const values = record.enum.map((item) => JSON.stringify(item)).join(" | ");
        return values || fallback(path, diagnostics, "empty enum");
    }
    if (Array.isArray(record.anyOf) || Array.isArray(record.oneOf)) {
        const variants = (record.anyOf ?? record.oneOf) as unknown[];
        return variants.map((variant) => convertUnknownSchema(variant, path, diagnostics)).join(" | ");
    }
    if (Array.isArray(record.allOf)) {
        const variants = record.allOf as unknown[];
        return variants.map((variant) => convertUnknownSchema(variant, path, diagnostics)).join(" & ");
    }
    switch (record.type) {
        case "string":
            return "string";
        case "number":
        case "integer":
            return "number";
        case "boolean":
            return "boolean";
        case "null":
            return "null";
        case "array": {
            if (!record.items || typeof record.items !== "object" || Array.isArray(record.items)) {
                return fallback(path, diagnostics, "array items schema is unsupported");
            }
            const itemType = convertSchema(record.items as TSchema, `${path}[]`, diagnostics);
            return `Array<${itemType}>`;
        }
        case "object":
            return objectSchemaToType(record, path, diagnostics);
        default:
            return fallback(path, diagnostics, `unsupported schema type ${String(record.type ?? "unknown")}`);
    }
}

function convertUnknownSchema(value: unknown, path: string, diagnostics: VariableTypeGenerationDiagnostic[]): string {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return fallback(path, diagnostics, "schema variant is not an object");
    }
    return convertSchema(value as TSchema, path, diagnostics);
}

function objectSchemaToType(record: Record<string, unknown>, path: string, diagnostics: VariableTypeGenerationDiagnostic[]): string {
    const properties = record.properties;
    const additional = record.additionalProperties;
    const patternProperties = record.patternProperties;
    if (properties && typeof properties === "object" && !Array.isArray(properties)) {
        const required = new Set(Array.isArray(record.required) ? record.required.filter((item): item is string => typeof item === "string") : []);
        const fields = Object.entries(properties as Record<string, unknown>).map(([key, value]) => {
            const optional = required.has(key) ? "" : "?";
            return `${JSON.stringify(key)}${optional}: ${convertUnknownSchema(value, `${path}.${key}`, diagnostics)}`;
        });
        if (additional && typeof additional === "object" && !Array.isArray(additional)) {
            fields.push(`[key: string]: ${convertSchema(additional as TSchema, `${path}.*`, diagnostics)}`);
        }
        return fields.length > 0 ? `{${fields.join("; ")}}` : "{}";
    }
    if (additional && typeof additional === "object" && !Array.isArray(additional)) {
        return `Record<string, ${convertSchema(additional as TSchema, `${path}.*`, diagnostics)}>`;
    }
    if (patternProperties && typeof patternProperties === "object" && !Array.isArray(patternProperties)) {
        const entries = Object.values(patternProperties as Record<string, unknown>).filter((item) => item && typeof item === "object" && !Array.isArray(item));
        if (entries.length === 1) {
            return `Record<string, ${convertSchema(entries[0] as TSchema, `${path}.*`, diagnostics)}>`;
        }
        return fallback(path, diagnostics, "patternProperties must contain exactly one supported schema");
    }
    return "{}";
}

function fallback(path: string, diagnostics: VariableTypeGenerationDiagnostic[], reason: string): string {
    diagnostics.push({
        severity: "warning",
        path,
        message: `变量 ${path} 的 schema 无法精确生成 TypeScript 类型，已降级为 JsonValue：${reason}`,
    });
    return "JsonValue";
}
