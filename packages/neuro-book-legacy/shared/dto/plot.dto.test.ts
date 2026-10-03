import {describe, expect, it} from "vitest";
import {
    StorySceneWorldAnchorDtoSchema,
    StorySceneWorldAnchorInputDtoSchema,
} from "nbook/shared/dto/plot.dto";

describe("StorySceneWorldAnchorDtoSchema", () => {
    it("写入 DTO 允许 Scene 暂未连接 World Engine 时间线", () => {
        expect(StorySceneWorldAnchorInputDtoSchema.safeParse({
            startTime: null,
            endTime: null,
            startInstant: null,
            endInstant: null,
            subjectIds: [],
            locationSubjectId: null,
        }).success).toBe(true);
    });

    it("读取 DTO 暴露 subject 解析状态", () => {
        expect(StorySceneWorldAnchorDtoSchema.safeParse({
            startTime: null,
            endTime: null,
            startInstant: null,
            endInstant: null,
            subjectIds: ["hero", "future-subject"],
            locationSubjectId: "temple",
            subjects: [
                {id: "hero", name: "主角", type: "character", resolved: true},
                {id: "future-subject", name: "future-subject", type: "unknown", resolved: false},
            ],
            locationSubject: {id: "temple", name: "神殿", type: "location", resolved: true},
            unresolvedSubjectIds: ["future-subject"],
        }).success).toBe(true);
    });
});
