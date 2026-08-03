import {describe, expect, it} from "vitest";

import {extractReleaseNotes} from "nbook/scripts/release/release-notes";

describe("extractReleaseNotes", () => {
    it("提取第一个二级标题之后到文末的内容", () => {
        const markdown = [
            "# 更新日志",
            "",
            "历史版本见 docs/changelog/。",
            "",
            "## 0.9.0-canary - 2026-08-02",
            "",
            "本版本聚焦发布链路收口。",
            "",
            "### 新功能",
            "",
            "- 支持整书导入。",
        ].join("\n");
        expect(extractReleaseNotes(markdown)).toBe([
            "本版本聚焦发布链路收口。",
            "",
            "### 新功能",
            "",
            "- 支持整书导入。",
        ].join("\n"));
    });

    it("没有二级标题时返回空字符串", () => {
        expect(extractReleaseNotes("# 更新日志\n\n只有引言。")).toBe("");
    });

    it("二级标题后无正文时返回空字符串", () => {
        expect(extractReleaseNotes("# 更新日志\n\n## 0.9.0 - 2026-08-02\n\n")).toBe("");
    });

    it("兼容 CRLF 换行", () => {
        const markdown = "# 更新日志\r\n\r\n## 0.9.0 - 2026-08-02\r\n\r\n正文。\r\n";
        expect(extractReleaseNotes(markdown)).toBe("正文。");
    });

    it("不把三级标题当作版本标题", () => {
        expect(extractReleaseNotes("# 更新日志\n\n### 不是版本\n\n内容。")).toBe("");
    });
});
