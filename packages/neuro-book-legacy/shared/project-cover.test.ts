import {describe, expect, it} from "vitest";
import {isProjectCoverPath, normalizeProjectCoverPath} from "nbook/shared/project-cover";

describe("Project cover path", () => {
    it("接受可携带的 Project Workspace 图片相对路径", () => {
        expect(normalizeProjectCoverPath("cover.webp")).toBe("cover.webp");
        expect(normalizeProjectCoverPath("assets/封面 01.jpg")).toBe("assets/封面 01.jpg");
        expect(normalizeProjectCoverPath("  images/cover.PNG  ")).toBe("images/cover.PNG");
        expect(isProjectCoverPath("images/cover.PNG")).toBe(true);
    });

    it("拒绝外部地址、控制目录、父目录与不支持的格式", () => {
        for (const value of [
            "/cover.png",
            "C:/cover.png",
            "https://example.com/cover.png",
            "../cover.png",
            "images/../cover.png",
            "images\\cover.png",
            ".nbook/cover.png",
            ".git/cover.png",
            "cover.gif",
            "cover.svg",
            "folder./cover.png",
            "con.png",
        ]) {
            expect(normalizeProjectCoverPath(value), value).toBeUndefined();
        }
        expect(isProjectCoverPath(" cover.png ")).toBe(false);
    });
});
