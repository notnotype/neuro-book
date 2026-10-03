/**
 * Shared OpenAPI operation builder.
 *
 * This Module is the seam between route-map entries and every OpenAPI adapter:
 * the canonical /_openapi.json spec and route-local defineRouteMeta generation.
 */

import type {ZodType} from "zod";
import type {RouteMetaEntry} from "./route-map";

type JsonObject = Record<string, unknown>;

type JsonSchemaConvertible = ZodType & {
    toJSONSchema?: (opts: {target: "openapi-3.0"; unrepresentable: "ignore"}) => unknown;
};

type OpenAPIParameter = {
    name: string;
    in: "path" | "query";
    required: boolean;
    schema: JsonObject;
    description?: string;
};

/**
 * Convert a route map entry into its public OpenAPI path.
 */
export function buildOpenAPIPath(entry: RouteMetaEntry): string {
    const publicPath = entry.path ?? derivePublicPathFromFile(entry.file);
    return normalizePublicPath(publicPath);
}

/**
 * Build one OpenAPI operation object from a route map entry.
 */
export function buildOpenAPIOperation(entry: RouteMetaEntry): JsonObject {
    const operation: JsonObject = {
        tags: entry.tags,
        summary: entry.summary,
    };

    const parameters = [
        ...extractPathParams(buildOpenAPIPath(entry)),
        ...extractQueryParams(entry),
    ];
    if (parameters.length > 0) {
        operation.parameters = parameters;
    }

    if (entry.requestBody) {
        operation.requestBody = {
            content: {
                "application/json": {schema: zodToJsonSchema(entry.requestBody)},
            },
        };
    }

    operation.responses = buildOpenAPIResponses(entry);
    return operation;
}

/**
 * Convert a Zod schema to an OpenAPI-compatible JSON Schema object.
 */
export function zodToJsonSchema(schema: ZodType): JsonObject {
    const converter = schema as JsonSchemaConvertible;
    try {
        const result = converter.toJSONSchema?.({
            target: "openapi-3.0",
            unrepresentable: "ignore",
        });
        if (result && typeof result === "object") {
            return result as JsonObject;
        }
    } catch {
        // Keep OpenAPI generation resilient when a Zod feature is not representable.
    }
    return {};
}

function derivePublicPathFromFile(file: string): string {
    let path = file.replace(/\.(get|post|put|patch|delete)\.ts$/, "");
    path = path.replace(/\[\.\.\.(\w+)\]/g, "{$1}");
    path = path.replace(/\[(\w+)\]/g, "{$1}");
    path = path.replace(/\/index$/, "");
    return path;
}

function normalizePublicPath(path: string): string {
    const withoutLeadingSlash = path.trim().replace(/^\/+/, "");
    const withoutApiPrefix = withoutLeadingSlash === "api"
        ? ""
        : withoutLeadingSlash.startsWith("api/")
          ? withoutLeadingSlash.slice("api/".length)
          : withoutLeadingSlash;
    return withoutApiPrefix ? `/api/${withoutApiPrefix}` : "/api";
}

function extractPathParams(path: string): OpenAPIParameter[] {
    const params: OpenAPIParameter[] = [];
    const re = /\{(\w+)\}/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(path)) !== null) {
        params.push({
            name: match[1]!,
            in: "path",
            required: true,
            schema: {type: "string"},
        });
    }
    return params;
}

function extractQueryParams(entry: RouteMetaEntry): OpenAPIParameter[] {
    if (!entry.queryParams) {
        return [];
    }

    const jsonSchema = zodToJsonSchema(entry.queryParams);
    const props = readSchemaProperties(jsonSchema);
    const required = Array.isArray(jsonSchema.required) ? jsonSchema.required.filter(isString) : [];

    return Object.entries(props).map(([name, schema]) => {
        const description = typeof schema.description === "string" ? schema.description : undefined;
        return {
            name,
            in: "query",
            required: required.includes(name),
            schema,
            ...(description ? {description} : {}),
        };
    });
}

function readSchemaProperties(schema: JsonObject): Record<string, JsonObject> {
    if (!schema.properties || typeof schema.properties !== "object") {
        return {};
    }
    return schema.properties as Record<string, JsonObject>;
}

function buildOpenAPIResponses(entry: RouteMetaEntry): JsonObject {
    const responses: JsonObject = {};

    if (entry.responseBody) {
        responses["200"] = {
            description: "OK",
            content: {
                "application/json": {schema: zodToJsonSchema(entry.responseBody)},
            },
        };
    } else {
        responses["200"] = {description: "OK"};
    }

    if (entry.requestBody && !responses["400"]) {
        responses["400"] = {description: "Bad Request — validation failed"};
    }

    return responses;
}

function isString(value: unknown): value is string {
    return typeof value === "string";
}
