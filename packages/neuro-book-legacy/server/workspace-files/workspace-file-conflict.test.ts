import {describe, expect, it} from "vitest";
import {buildWorkspaceWriteConflict} from "nbook/server/workspace-files/workspace-file-conflict";

describe("workspace file conflict", () => {
    it("会基于 base/local/remote 生成 Git 风格冲突内容", async () => {
        const conflict = await buildWorkspaceWriteConflict({
            path: "manuscript/chapter-1.md",
            expectedMtimeMs: 1,
            actualMtimeMs: 2,
            baseContent: "开头\n旧句子\n结尾\n",
            localContent: "开头\n网页句子\n结尾\n",
            remoteContent: "开头\n真实句子\n结尾\n",
            remoteExists: true,
            node: null,
        });

        expect(conflict.kind).toBe("workspace_write_conflict");
        expect(conflict.mergedContent).toContain("<<<<<<< 网页编辑");
        expect(conflict.mergedContent).toContain(">>>>>>> 真实文件");
        expect(conflict.localDiff).toContain("网页句子");
        expect(conflict.remoteDiff).toContain("真实句子");
    });
});
