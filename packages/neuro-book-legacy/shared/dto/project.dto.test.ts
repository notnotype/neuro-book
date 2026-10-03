import {describe, expect, it} from "vitest";
import {
    ProjectCandidatesResponseDtoSchema,
    ProjectCloseRequestDtoSchema,
    ProjectCloseResponseDtoSchema,
    ProjectCreateRequestDtoSchema,
    ProjectDeleteRequestDtoSchema,
    ProjectDeleteResponseDtoSchema,
    ProjectListResponseDtoSchema,
    ProjectMetadataDtoSchema,
    ProjectOpenResponseDtoSchema,
    ProjectPresenceHeartbeatEventDtoSchema,
    ProjectPresenceReadyEventDtoSchema,
    ProjectUpdateRequestDtoSchema,
} from "nbook/shared/dto/project.dto";

describe("Project DTO", () => {
    it("create 只接受标题与摘要，由服务端派生 projectRoot", () => {
        expect(ProjectCreateRequestDtoSchema.safeParse({
            title: "Alpha",
        }).success).toBe(true);
        expect(ProjectCreateRequestDtoSchema.safeParse({
            projectRoot: "alpha",
            title: "Alpha",
        }).success).toBe(false);
        expect(ProjectCreateRequestDtoSchema.safeParse({
            projectPath: "workspace/alpha",
            title: "Alpha",
        }).success).toBe(false);
        expect(ProjectCreateRequestDtoSchema.safeParse({
            title: "Alpha",
            id: 7,
        }).success).toBe(false);
    });

    it("metadata 与 candidate snapshot 不接受统计或旧 identity 字段", () => {
        const metadata = {
            projectRoot: "alpha",
            kind: "novel",
            title: "Alpha",
            summary: "摘要",
            cover: "assets/cover.webp",
            manifestUpdatedAt: "2026-07-24T01:02:03.000Z",
        };
        expect(ProjectMetadataDtoSchema.parse(metadata)).toEqual(metadata);
        expect(ProjectMetadataDtoSchema.safeParse({...metadata, title: ""}).success).toBe(true);
        expect(ProjectMetadataDtoSchema.safeParse({...metadata, statistics: {words: 10}}).success).toBe(false);
        expect(ProjectMetadataDtoSchema.safeParse({...metadata, projectPath: "workspace/alpha"}).success).toBe(false);
        expect(ProjectCandidatesResponseDtoSchema.parse({
            revision: 3,
            candidates: [{projectRoot: "empty-directory"}],
        })).toEqual({revision: 3, candidates: [{projectRoot: "empty-directory"}]});
        expect(ProjectMetadataDtoSchema.safeParse({...metadata, manifestUpdatedAt: "yesterday"}).success).toBe(false);
        expect(ProjectMetadataDtoSchema.safeParse({...metadata, cover: "../cover.webp"}).success).toBe(false);
        expect(ProjectListResponseDtoSchema.safeParse({revision: 0, projects: []}).success).toBe(false);
        expect(ProjectListResponseDtoSchema.safeParse({revision: 1.5, projects: []}).success).toBe(false);
        expect(ProjectListResponseDtoSchema.safeParse({revision: 1, projects: [], statistics: {files: 0}}).success).toBe(false);
    });

    it("update 必须包含 title 或 summary，summary 允许显式清空", () => {
        expect(ProjectUpdateRequestDtoSchema.safeParse({}).success).toBe(false);
        expect(ProjectUpdateRequestDtoSchema.parse({summary: ""})).toEqual({summary: ""});
        expect(ProjectUpdateRequestDtoSchema.safeParse({title: "   "}).success).toBe(false);
        expect(ProjectUpdateRequestDtoSchema.safeParse({projectRoot: "alpha", title: "Alpha"}).success).toBe(false);
    });

    it("open 带回本次发布的精确 ready 标识，并只在 manifest 被修复时接受 recoveryPath", () => {
        const base = {
            revision: 4,
            project: {
                projectRoot: "alpha",
                kind: "novel" as const,
                title: "Alpha",
                summary: "",
            },
            publicId: "runtime-1:3",
        };
        expect(ProjectOpenResponseDtoSchema.parse({...base, change: "none"})).toEqual({...base, change: "none"});
        expect(ProjectOpenResponseDtoSchema.parse({
            ...base,
            change: "recovered",
            recoveryPath: "alpha/.nbook/recovery/project-manifest-2026-07-24T01-02-03.000Z-550e8400-e29b-41d4-a716-446655440000.yaml",
        })).toMatchObject({change: "recovered"});
        expect(ProjectOpenResponseDtoSchema.safeParse({revision: 4, project: base.project, change: "none"}).success).toBe(false);
        expect(ProjectOpenResponseDtoSchema.safeParse({...base, publicId: "", change: "none"}).success).toBe(false);
        expect(ProjectOpenResponseDtoSchema.safeParse({...base, change: "recovered"}).success).toBe(false);
        expect(ProjectOpenResponseDtoSchema.safeParse({
            ...base,
            change: "none",
            recoveryPath: "unexpected",
        }).success).toBe(false);
    });

    it("presence 事件必须回报 open 发布的同一 ready 标识", () => {
        expect(ProjectPresenceReadyEventDtoSchema.parse({
            type: "presence_ready",
            projectRoot: "alpha",
            publicId: "runtime-1:3",
        })).toEqual({type: "presence_ready", projectRoot: "alpha", publicId: "runtime-1:3"});
        expect(ProjectPresenceReadyEventDtoSchema.safeParse({
            type: "presence_ready",
            projectRoot: "alpha",
        }).success).toBe(false);
        expect(ProjectPresenceReadyEventDtoSchema.safeParse({
            type: "presence_ready",
            projectRoot: "alpha",
            publicId: "runtime-1:3",
            generation: 3,
        }).success).toBe(false);
        expect(ProjectPresenceHeartbeatEventDtoSchema.parse({type: "heartbeat"})).toEqual({type: "heartbeat"});
    });

    it("open recoveryPath 必须属于响应中的同一 Project", () => {
        const response = {
            revision: 4,
            project: {
                projectRoot: "alpha",
                kind: "novel" as const,
                title: "Alpha",
                summary: "",
            },
            publicId: "runtime-1:3",
            change: "recovered" as const,
        };
        const fileName = "project-manifest-2026-07-24T01-02-03.000Z-550e8400-e29b-41d4-a716-446655440000.yaml";
        const rejectedPaths = [
            `C:/workspace/alpha/.nbook/recovery/${fileName}`,
            `alpha\\.nbook\\recovery\\${fileName}`,
            `alpha/.nbook/recovery/../${fileName}`,
            `.nbook/recovery/${fileName}`,
            `beta/.nbook/recovery/${fileName}`,
            `alpha/.nbook/recovery/nested/${fileName}`,
            "alpha/.nbook/recovery/project-manifest-invalid.yaml",
        ];

        for (const recoveryPath of rejectedPaths) {
            expect(ProjectOpenResponseDtoSchema.safeParse({...response, recoveryPath}).success).toBe(false);
        }
    });

    it("close/delete 契约只接受 projectRoot 且保持 strict", () => {
        expect(ProjectCloseRequestDtoSchema.parse({projectRoot: "alpha"})).toEqual({projectRoot: "alpha"});
        expect(ProjectCloseRequestDtoSchema.safeParse({projectPath: "workspace/alpha"}).success).toBe(false);
        expect(ProjectCloseResponseDtoSchema.safeParse({
            success: true,
            projectRoot: "alpha",
            generation: 9,
        }).success).toBe(false);
        expect(ProjectDeleteRequestDtoSchema.safeParse({projectRoot: "alpha", id: "old-id"}).success).toBe(false);
        expect(ProjectDeleteResponseDtoSchema.parse({revision: 8, projectRoot: "alpha"})).toEqual({
            revision: 8,
            projectRoot: "alpha",
        });
        expect(ProjectDeleteResponseDtoSchema.safeParse({revision: -1, projectRoot: "alpha"}).success).toBe(false);
    });

    it("create/update 保留 title 与 summary 的输入上限", () => {
        expect(ProjectCreateRequestDtoSchema.safeParse({
            title: "a".repeat(121),
        }).success).toBe(false);
        expect(ProjectCreateRequestDtoSchema.safeParse({
            title: "Alpha",
            summary: "a".repeat(2_001),
        }).success).toBe(false);
        expect(ProjectUpdateRequestDtoSchema.safeParse({
            summary: "a".repeat(2_001),
        }).success).toBe(false);
    });
});
