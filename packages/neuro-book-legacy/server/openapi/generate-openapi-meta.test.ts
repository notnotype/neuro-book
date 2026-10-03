import {describe, expect, it} from "vitest";
import {z} from "zod";
import {
    generateDefineRouteMetaCall,
    selectRouteMetaRepresentatives,
} from "../../scripts/build/generate-openapi-meta";
import type {RouteMetaEntry} from "./route-map";

describe("selectRouteMetaRepresentatives", () => {
    it("按 physical file 选择唯一 route-local representative，并跳过 emitRouteMeta=false", () => {
        const first = route({file: "hello.get.ts"});
        const worldContext = route({
            file: "projects/plot/[...segments].ts",
            path: "projects/plot/scenes/{sceneId}/world-context",
            emitRouteMeta: true,
        });
        const chapterBrief = route({
            file: "projects/plot/[...segments].ts",
            path: "projects/plot/chapter-writer-brief",
            emitRouteMeta: false,
        });

        expect(selectRouteMetaRepresentatives([first, worldContext, chapterBrief])).toEqual([
            first,
            worldContext,
        ]);
    });

    it("同一 physical file 有多个候选时失败，避免 route-local metadata last-wins", () => {
        const entries = [
            route({
                file: "projects/plot/[...segments].ts",
                path: "projects/plot/scenes/{sceneId}/world-context",
            }),
            route({
                file: "projects/plot/[...segments].ts",
                path: "projects/plot/chapter-writer-brief",
            }),
        ];

        expect(() => selectRouteMetaRepresentatives(entries)).toThrow(
            "Multiple route-local OpenAPI metadata candidates for projects/plot/[...segments].ts",
        );
    });
});

describe("generateDefineRouteMetaCall", () => {
    it("复用共享 operation builder，生成 explicit path params 和 query params", () => {
        const metaCall = generateDefineRouteMetaCall(route({
            file: "projects/plot/[...segments].ts",
            path: "projects/plot/scenes/{sceneId}/world-context",
            queryParams: z.object({
                projectPath: z.string().trim().min(1).describe("Project Workspace path"),
            }),
        }));

        expect(metaCall).toContain('"name": "sceneId"');
        expect(metaCall).toContain('"in": "path"');
        expect(metaCall).toContain('"name": "projectPath"');
        expect(metaCall).toContain('"in": "query"');
    });
});

function route(input: Partial<RouteMetaEntry>): RouteMetaEntry {
    return {
        file: "hello.get.ts",
        method: "get",
        tags: ["Test"],
        summary: "Test route",
        responseBody: z.object({ok: z.boolean()}),
        ...input,
    };
}
