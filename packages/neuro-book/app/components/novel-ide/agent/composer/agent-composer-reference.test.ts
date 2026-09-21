import {describe, expect, it} from "vitest";
import {completeProjectFileAddress} from "nbook/app/components/novel-ide/agent/agent-composer-reference";

describe("Composer Project File Address", () => {
    it("把当前 Project Workspace 相对引用补成完整地址", () => {
        expect(completeProjectFileAddress("./lorebook/角色/头像.png", "my-book"))
            .toBe("workspace/my-book/lorebook/角色/头像.png");
        expect(completeProjectFileAddress("manuscript\\第一章.md", "my-book"))
            .toBe("workspace/my-book/manuscript/第一章.md");
    });

    it("保留已完整的 managed 地址和绝对地址", () => {
        expect(completeProjectFileAddress("workspace/other-book/cover.png", "my-book"))
            .toBe("workspace/other-book/cover.png");
        expect(completeProjectFileAddress("C:\\My Files\\cover.png", "my-book"))
            .toBe("C:/My Files/cover.png");
        expect(completeProjectFileAddress("/mnt/images/cover.png", "my-book"))
            .toBe("/mnt/images/cover.png");
    });
});
