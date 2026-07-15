import {describe, expect, it} from "vitest";

import {shouldIncludePortableFile} from "nbook/scripts/build/portable-file-policy";

describe("Windows Portable 文件策略", () => {
    it("排除运行时 artifact cache", () => {
        expect(shouldIncludePortableFile(".agent/workspace/runtime-artifact-import-cache/profile-compiler/a.mjs")).toBe(false);
    });

    it("兼容 Windows 路径分隔符", () => {
        expect(shouldIncludePortableFile(".agent\\workspace\\runtime-artifact-import-cache\\profile-compiler\\a.mjs")).toBe(false);
    });

    it("保留正常的 tracked 文件", () => {
        expect(shouldIncludePortableFile("scripts/deploy/windows-portable-manager.ts")).toBe(true);
    });
});
