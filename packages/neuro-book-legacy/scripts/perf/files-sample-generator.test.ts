import {describe, expect, it} from "vitest";
import {buildSamplePlan, renderSampleDocument} from "./files-sample-generator";

describe("Files 基线样本布局", () => {
    it("固定种子和参数生成相同路径、大小与标记", () => {
        const options = {fileCount: 50, seed: 1234, minBytes: 5_120, maxBytes: 7_168, wideDirectoryChildren: 10};
        const first = buildSamplePlan(options);
        const second = buildSamplePlan(options);

        expect(second).toEqual(first);
        expect(first.entries).toHaveLength(50);
        expect(new Set(first.entries.map((entry) => entry.relativePath)).size).toBe(50);
        expect(new Set(first.entries.map((entry) => entry.uniqueMarker)).size).toBe(50);
    });

    it("同时包含内容节点、章节、普通笔记和宽目录", () => {
        const plan = buildSamplePlan({fileCount: 50, seed: 1234, wideDirectoryChildren: 10});
        const lorebook = plan.entries.filter((entry) => entry.category === "lorebook");
        const manuscript = plan.entries.filter((entry) => entry.category === "manuscript");
        const notes = plan.entries.filter((entry) => entry.category === "notes");

        expect(lorebook.length).toBeGreaterThan(0);
        expect(manuscript.some((entry) => entry.type === "volume")).toBe(true);
        expect(manuscript.some((entry) => entry.type === "chapter")).toBe(true);
        expect(notes.filter((entry) => entry.relativePath.startsWith("notes/wide/")).length).toBe(10);
        expect(plan.entries[0]?.relativePath).toBe("index.md");
    });

    it("渲染正文保留 frontmatter、唯一标记和指定字节大小", () => {
        const plan = buildSamplePlan({fileCount: 20, seed: 7, minBytes: 5_120, maxBytes: 5_120, wideDirectoryChildren: 4});
        for (const entry of plan.entries) {
            const content = renderSampleDocument(entry);
            expect(Buffer.byteLength(content, "utf8")).toBe(entry.sizeBytes);
            expect(content).toContain("---\n");
            expect(content).toContain(entry.uniqueMarker);
        }
    });
});
