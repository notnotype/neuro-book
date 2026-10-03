import {describe, expect, it} from "vitest";
import {z} from "zod";
import {buildOpenAPIPath} from "./operation-builder";
import {buildOpenAPISpecForRoutes, generateOpenAPISpec} from "./generate-spec";
import type {RouteMetaEntry} from "./route-map";

type Operation = {
    parameters?: Array<{
        name: string;
        in: "path" | "query";
        required: boolean;
        schema: Record<string, unknown>;
        description?: string;
    }>;
};

type OpenAPISpec = {
    paths: Record<string, Record<string, Operation>>;
};

describe("buildOpenAPISpecForRoutes", () => {
    it("为同一个 physical file 生成多个 explicit public path", () => {
        const spec = buildOpenAPISpecForRoutes([
            route({
                file: "projects/plot/[...segments].ts",
                path: "projects/plot/scenes/{sceneId}/world-context",
                queryParams: z.object({
                    projectRoot: z.string().trim().min(1).describe("Project Workspace root"),
                }),
            }),
            route({
                file: "projects/plot/[...segments].ts",
                path: "projects/plot/chapter-writer-brief",
                queryParams: z.object({
                    projectRoot: z.string().trim().min(1),
                    chapterPath: z.string().trim().min(1),
                }),
            }),
        ]) as OpenAPISpec;

        const worldContext = spec.paths["/api/projects/plot/scenes/{sceneId}/world-context"]?.get;
        const chapterBrief = spec.paths["/api/projects/plot/chapter-writer-brief"]?.get;

        expect(worldContext?.parameters).toEqual(expect.arrayContaining([
            expect.objectContaining({name: "sceneId", in: "path", required: true}),
            expect.objectContaining({name: "projectRoot", in: "query", required: true}),
        ]));
        expect(chapterBrief?.parameters).toEqual(expect.arrayContaining([
            expect.objectContaining({name: "projectRoot", in: "query", required: true}),
            expect.objectContaining({name: "chapterPath", in: "query", required: true}),
        ]));
        expect(chapterBrief?.parameters).not.toEqual(expect.arrayContaining([
            expect.objectContaining({name: "sceneId"}),
        ]));
    });

    it("拒绝相同 public path 和 method 的重复 operation", () => {
        const entries = [
            route({
                file: "projects/plot/[...segments].ts",
                path: "projects/plot/scenes/{sceneId}/world-context",
            }),
            route({
                file: "projects/plot/world-context.get.ts",
                path: "/api/projects/plot/scenes/{sceneId}/world-context",
            }),
        ];

        expect(() => buildOpenAPISpecForRoutes(entries)).toThrow(
            "Duplicate OpenAPI operation: GET /api/projects/plot/scenes/{sceneId}/world-context",
        );
    });
});

describe("generateOpenAPISpec", () => {
    it("当前 route map 暴露 Project Plot explicit paths，不再暴露旧 Novel Plot paths", () => {
        const spec = generateOpenAPISpec() as OpenAPISpec;
        const paths = Object.keys(spec.paths);
        const worldContext = spec.paths["/api/projects/plot/scenes/{sceneId}/world-context"]?.get;
        const chapter = spec.paths["/api/projects/plot/chapter"]?.get;
        const chapterWriterBrief = spec.paths["/api/projects/plot/chapter-writer-brief"]?.get;

        expect(worldContext?.parameters).toEqual(expect.arrayContaining([
            expect.objectContaining({name: "sceneId", in: "path", required: true}),
            expect.objectContaining({name: "projectRoot", in: "query", required: true}),
        ]));
        expect(chapter?.parameters).toEqual(expect.arrayContaining([
            expect.objectContaining({name: "projectRoot", in: "query", required: true}),
            expect.objectContaining({name: "chapterId", in: "query", required: true}),
        ]));
        expect(chapterWriterBrief?.parameters).toEqual(expect.arrayContaining([
            expect.objectContaining({name: "projectRoot", in: "query", required: true}),
            expect.objectContaining({name: "chapterId", in: "query", required: true}),
        ]));
        expect(paths.some((path) => path.startsWith("/api/novels/{novelId}/plot"))).toBe(false);
        expect(paths).not.toContain("/api/projects/plot/{segments}");
    });
});

describe("buildOpenAPIPath", () => {
    it("保留旧 file 推导路径，同时支持 explicit path", () => {
        expect(buildOpenAPIPath(route({
            file: "novels/[novelId]/chapters/[chapterId].get.ts",
        }))).toBe("/api/novels/{novelId}/chapters/{chapterId}");

        expect(buildOpenAPIPath(route({
            file: "projects/plot/[...segments].ts",
            path: "projects/plot/scenes/{sceneId}/world-context",
        }))).toBe("/api/projects/plot/scenes/{sceneId}/world-context");
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
