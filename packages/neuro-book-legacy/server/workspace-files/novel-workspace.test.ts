import {describe, expect, it} from "vitest";
import {buildWorkspaceSlugBase} from "nbook/server/workspace-files/novel-workspace";

describe("buildWorkspaceSlugBase", () => {
    it("生成可读的 Project slug 基础名", () => {
        expect(buildWorkspaceSlugBase("世界引擎试用 2026-06-20 22-30")).toBe("shi-jie-yin-qing-shi-yong-2026-06-20-22-30");
        expect(buildWorkspaceSlugBase("My Book 2026")).toBe("my-book-2026");
        expect(buildWorkspaceSlugBase("   ")).toBe("novel");
    });
});
