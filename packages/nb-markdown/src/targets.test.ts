/**
 * 缺省的目标分类（docs/specs/workspace/markdown-dialect.md 输出 27；宿主不给自己的分类时用它）：只认外部链接，别的都是“其它”。
 */

import {describe, expect, it} from "bun:test";

import {classifyScheme, relativeAddress, relativeTarget, schemeTargets} from "./targets";

describe("缺省的目标分类", () => {
    it("http、https、mailto 是外部链接，方案不分大小写", () => {
        expect(["https://example.com/a?b#c", "HTTP://x", "mailto:a@b.c"].map((target) => classifyScheme(target).kind)).toEqual(["external", "external", "external"]);
    });

    it("别的方案与相对地址都是其它：nb-story 的出处 paragraph://41.20 显示成引用小块", () => {
        expect(classifyScheme("paragraph://41.20")).toEqual({kind: "other", name: ""});
        expect(classifyScheme("设定/%E6%9E%97%E9%9B%AA.md?x#y")).toEqual({kind: "other", name: "林雪.md"});
    });

    it("不认文件方案，插入引用时地址原样写", () => {
        expect(schemeTargets.encodeFile("设定/a#b.md")).toBe("设定/a#b.md");
    });
});

describe("相对地址（输出 57）", () => {
    it("同目录、子目录、上级目录、兄弟目录；方案不同或没有文件名没有相对写法", () => {
        expect(relativeAddress("project://章/一.md", "project://章/a.png")).toBe("a.png");
        expect(relativeAddress("project://章/一.md", "project://插图/a.png")).toBe("../插图/a.png");
        expect(relativeAddress("project://一.md", "project://插图/a.png")).toBe("插图/a.png");
        expect(relativeAddress("project://卷一/章/一.md", "project://卷一/插图/a.png")).toBe("../插图/a.png");
        expect(relativeAddress("project://卷一/章/一.md", "project://卷一/章/图/a.png")).toBe("图/a.png");
        expect(relativeAddress("project://a/b/c.md", "project://x.png")).toBe("../../x.png");
        expect(relativeAddress("project://一.md", "user://a.png")).toBeNull();
        expect(relativeAddress("project://一.md", "project://插图/")).toBeNull();
        expect(relativeAddress("一.md", "project://a.png")).toBeNull();
    });

    it("写进链接的地址：宿主编码 %、#、?，第一段含冒号的加 ./，没有所在文件时为 null", () => {
        const encode = {...schemeTargets, encodeFile: (target: string) => target.replace(/[%#?]/gu, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)};
        expect(relativeTarget("project://章/一.md", "project://插图/图#1 100%.png", encode)).toBe("../插图/图%231 100%25.png");
        expect(relativeTarget("project://一.md", "project://a:b.png", encode)).toBe("./a:b.png");
        expect(relativeTarget("project://一.md", "project://目录/a:b.png", encode)).toBe("目录/a:b.png");
        expect(relativeTarget(null, "project://a.png", encode)).toBeNull();
        expect(relativeTarget("project://一.md", "user://a.png", encode)).toBeNull();
    });
});
