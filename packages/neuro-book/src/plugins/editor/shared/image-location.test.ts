import {describe, expect, it} from "bun:test";

import {IMAGE_FOLDER_DEFAULT, imageDirectory, normalizeImageFolder, projectPathOf} from "./image-location";

describe("normalizeImageFolder（Spec 输出 56：不合规时按缺省）", () => {
    it("合规的原样用：几级目录、中文、空格；首尾空白与末尾的斜杠去掉", () => {
        expect(normalizeImageFolder("插图")).toBe("插图");
        expect(normalizeImageFolder("资源/插图")).toBe("资源/插图");
        expect(normalizeImageFolder("  my images/第 1 卷/ ")).toBe("my images/第 1 卷");
        expect(normalizeImageFolder("a..b")).toBe("a..b");
        expect(normalizeImageFolder("图/")).toBe("图");
    });

    it("不合规的退回缺省：空、以 / 开头、含 ..、在控制目录下（不分大小写）、空段、反斜杠", () => {
        for (const bad of ["", "   ", "/abs", "../外", "a/../b", "a/./b", ".nbook", ".nbook/x", ".NBOOK/staging", "a//b", "a\\b", "//"]) {
            expect([bad, normalizeImageFolder(bad)]).toEqual([bad, IMAGE_FOLDER_DEFAULT]);
        }
        // 只有第一段是控制目录才算：别处叫 .nbook 的子目录由写入链按它自己的规则处理，这里不替它判。
        expect(normalizeImageFolder("a/.nbook")).toBe("a/.nbook");
    });
});

describe("imageDirectory（四种位置）", () => {
    const current = "project://卷一/章节/第一章.md";
    it("folder 是根下的指定目录，root 是作品根，same 是当前文件所在目录，sibling 是它下面的指定子目录", () => {
        expect(imageDirectory("folder", "插图", current)).toBe("插图");
        expect(imageDirectory("root", "插图", current)).toBe("");
        expect(imageDirectory("same", "插图", current)).toBe("卷一/章节");
        expect(imageDirectory("sibling", "插图", current)).toBe("卷一/章节/插图");
        expect(imageDirectory("sibling", "资源/图", current)).toBe("卷一/章节/资源/图");
    });

    it("当前文件在作品根下：same 是根，sibling 是根下的子目录", () => {
        expect(imageDirectory("same", "插图", "project://简介.md")).toBe("");
        expect(imageDirectory("sibling", "插图", "project://简介.md")).toBe("插图");
    });

    it("设置里的目录名不合规：folder 与 sibling 退回缺省", () => {
        expect(imageDirectory("folder", "../外", current)).toBe("插图");
        expect(imageDirectory("sibling", "/abs", current)).toBe("卷一/章节/插图");
    });

    it("当前文件不在作品里（user://、没有地址）：没有存放目录", () => {
        for (const location of ["folder", "root", "same", "sibling"] as const) {
            expect(imageDirectory(location, "插图", "user://笔记.md")).toBeNull();
            expect(imageDirectory(location, "插图", null)).toBeNull();
        }
        expect(projectPathOf("project://a/b.md")).toBe("a/b.md");
        expect(projectPathOf("user://a")).toBeNull();
    });
});
