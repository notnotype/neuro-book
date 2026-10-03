import {describe, expect, it} from "vitest";
import {PlotInputParser} from "nbook/server/plot/http/plot-input.parser";

describe("PlotInputParser", () => {
    const parser = new PlotInputParser();

    it("会把线程创建输入解析成内部 number/null 结构", () => {
        const result = parser.parseCreateThread({
            storyPhaseId: "12",
            name: "main-thread",
            title: "主线",
        });

        expect(result).toEqual({
            storyPhaseId: 12,
            name: "main-thread",
            title: "主线",
        });
    });

    it("会把 Scene 更新输入解析成内部 ID", () => {
        const result = parser.parseUpdateScene({
            threadId: "8",
            chapterPath: null,
            title: "新场景",
        });

        expect(result).toEqual({
            threadId: 8,
            chapterPath: null,
            title: "新场景",
        });
    });

    it("会保留已解析的 Scene World Anchor", () => {
        const result = parser.parseCreateScene({
            threadId: "8",
            title: "连接世界的 Scene",
            worldAnchor: {
                startInstant: 1n,
                endInstant: 2n,
                subjectIds: ["hero"],
                locationSubjectId: "temple",
            },
        });

        expect(result.worldAnchor).toEqual({
            startInstant: 1n,
            endInstant: 2n,
            subjectIds: ["hero"],
            locationSubjectId: "temple",
        });
        expect(result.threadId).toBe(8);
    });
});
