import type {
    StorySceneRefWithTargets,
    StorySceneWithDetails,
} from "nbook/server/plot/core/types";
import {PlotDtoAssembler} from "nbook/server/plot/assemblers/plot-dto.assembler";
import {describe, expect, it} from "vitest";

function createSceneRef(input: Partial<StorySceneRefWithTargets>): StorySceneRefWithTargets {
    return {
        id: 2,
        sceneId: 20,
        sortOrder: 0,
        relation: "推动",
        rawTarget: "lorebook/note/y/",
        targetKind: "content",
        targetThreadId: null,
        targetSceneId: null,
        visibility: "author",
        note: null,
        createdAt: new Date("2026-04-13T00:00:00.000Z"),
        updatedAt: new Date("2026-04-13T00:00:00.000Z"),
        targetThread: null,
        targetScene: null,
        ...input,
    };
}

describe("PlotDtoAssembler", () => {
    it("Scene World Anchor 默认把 subject 输出为占位解析状态", () => {
        const assembler = new PlotDtoAssembler();
        const scene = {
            id: 20,
            storyId: 1,
            threadId: 10,
            chapterId: null,
            chapter: null,
            threadSortOrder: 0,
            chapterSortOrder: null,
            title: "场景",
            status: "draft",
            summary: "",
            purpose: null,
            writingTip: null,
            note: null,
            startInstant: 100n,
            endInstant: 200n,
            subjectIdsJson: JSON.stringify([" hero ", "future-subject"]),
            locationSubjectId: "temple",
            createdAt: new Date("2026-04-13T00:00:00.000Z"),
            updatedAt: new Date("2026-04-13T00:00:00.000Z"),
        } satisfies Parameters<PlotDtoAssembler["toStorySceneSummaryDto"]>[0];

        expect(assembler.toStorySceneSummaryDto(scene).worldAnchor).toMatchObject({
            subjectIds: ["hero", "future-subject"],
            locationSubjectId: "temple",
            subjects: [
                {id: "hero", name: "hero", type: "unknown", resolved: false},
                {id: "future-subject", name: "future-subject", type: "unknown", resolved: false},
            ],
            locationSubject: {id: "temple", name: "temple", type: "unknown", resolved: false},
            unresolvedSubjectIds: ["hero", "future-subject", "temple"],
        });
    });

    it("会从 scene refs 组装 effectiveRefs，并输出 canonical target", () => {
        const assembler = new PlotDtoAssembler();
        const scene = {
            id: 20,
            storyId: 1,
            threadId: 10,
            chapterId: null,
            chapter: null,
            threadSortOrder: 0,
            chapterSortOrder: null,
            title: "场景",
            status: "draft",
            summary: "",
            purpose: null,
            writingTip: null,
            note: null,
            startInstant: null,
            endInstant: null,
            subjectIdsJson: "[]",
            locationSubjectId: null,
            createdAt: new Date("2026-04-13T00:00:00.000Z"),
            updatedAt: new Date("2026-04-13T00:00:00.000Z"),
            refs: [
                createSceneRef({
                    relation: "回收",
                    targetKind: "scene",
                    rawTarget: "scene://200",
                    targetScene: {id: 200},
                    targetSceneId: 200,
                }),
            ],
            thread: {
                id: 10,
                storyId: 1,
                storyPhaseId: null,
                sortOrder: 0,
                name: "main-thread",
                title: "主线",
                isMainThread: true,
                status: "draft",
                summary: "",
                tags: [],
                writingTip: null,
                note: null,
                createdAt: new Date("2026-04-13T00:00:00.000Z"),
                updatedAt: new Date("2026-04-13T00:00:00.000Z"),
                tagsJson: "[]",
            },
        } satisfies StorySceneWithDetails;

        expect(assembler.buildEffectiveSceneRefs(scene)).toEqual([
            {
                relation: "回收",
                target: "scene://200",
                visibility: "author",
                note: null,
                sourceType: "scene",
                sourceId: "20",
            },
        ]);
    });
});
