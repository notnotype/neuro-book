/**
 * Builds the full OpenAPI 3.0 spec object at runtime from the route map.
 *
 * Converts Zod schemas → JSON Schema via Zod v4's toJSONSchema()
 * and assembles paths, tags, parameters, requestBodies, and responses.
 */

import { routeMetaMap, type RouteMetaEntry } from "./route-map";
import {buildOpenAPIOperation, buildOpenAPIPath} from "./operation-builder";

// ─── Spec metadata ──────────────────────────────────────────────

const SPEC_INFO = {
    title: "Neuro Book API",
    version: "1.0.0",
    description:
        "AI-powered novel writing platform — novels, chapters, plot management, settings, and workspace files",
};

// ─── Spec assembly ──────────────────────────────────────────────

export function buildOpenAPISpecForRoutes(entries: RouteMetaEntry[]): Record<string, unknown> {
    const paths: Record<string, Record<string, Record<string, unknown>>> = {};

    for (const entry of entries) {
        const path = buildOpenAPIPath(entry);
        const operation = buildOpenAPIOperation(entry);
        if (!paths[path]) {
            paths[path] = {};
        }
        if (paths[path][entry.method]) {
            throw new Error(`Duplicate OpenAPI operation: ${entry.method.toUpperCase()} ${path}`);
        }
        paths[path][entry.method] = operation;
    }

    // Collect unique tags in order of first appearance
    const seenTags = new Set<string>();
    const tags: { name: string }[] = [];
    for (const entry of entries) {
        for (const tag of entry.tags) {
            if (!seenTags.has(tag)) {
                seenTags.add(tag);
                tags.push({ name: tag });
            }
        }
    }

    return {
        openapi: "3.0.3",
        info: SPEC_INFO,
        servers: [
            {
                url: "http://localhost:3000",
                description: "Development server",
            },
        ],
        tags,
        paths,
    };
}

// ─── Cached export ──────────────────────────────────────────────

let cachedSpec: Record<string, unknown> | null = null;

export function generateOpenAPISpec(): Record<string, unknown> {
    if (!cachedSpec) {
        cachedSpec = buildOpenAPISpecForRoutes(routeMetaMap);
    }
    return cachedSpec;
}
