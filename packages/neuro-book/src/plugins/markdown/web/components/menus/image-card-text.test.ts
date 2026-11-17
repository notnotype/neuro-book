import {describe, expect, it} from "bun:test";

import {altOfName, altOfUrl, truncateMiddle, truncateStart} from "./image-card-text";

describe("truncateMiddle：名字过长截中间，扩展名留着", () => {
    it("不长的原样；长的变成 开头…结尾，总长不超过上限，结尾含扩展名", () => {
        expect(truncateMiddle("封面.png", 28)).toBe("封面.png");
        const long = `${"很长的名字".repeat(10)}.png`;
        const cut = truncateMiddle(long, 20);
        expect([...cut]).toHaveLength(20);
        expect(cut).toContain("…");
        expect(cut.endsWith(".png")).toBe(true);
        expect(cut.startsWith("很长的名字")).toBe(true);
    });

    it("按字符数算，不把代理对（emoji）切开", () => {
        const cut = truncateMiddle("😀".repeat(30), 10);
        expect([...cut]).toHaveLength(10);
        expect(cut.includes("�")).toBe(false);
    });
});

describe("truncateStart：目录过长截开头", () => {
    it("作品根是 /；不长的原样；长的留着靠近文件的部分", () => {
        expect(truncateStart("", 20)).toBe("/");
        expect(truncateStart("插图", 20)).toBe("插图");
        const cut = truncateStart("卷一/第一部/第二章/资源/插图/人物", 12);
        expect([...cut]).toHaveLength(12);
        expect(cut.startsWith("…")).toBe(true);
        expect(cut.endsWith("人物")).toBe(true);
    });
});

describe("说明", () => {
    it("文件名去掉扩展名；网址取路径最后一段", () => {
        expect(altOfName("林雪.png")).toBe("林雪");
        expect(altOfName("a.b.jpg")).toBe("a.b");
        expect(altOfName(".hidden")).toBe(".hidden");
        expect(altOfName("无扩展名")).toBe("无扩展名");
        expect(altOfUrl("https://example.com/图/%E6%9E%97%E9%9B%AA.png?x=1#y")).toBe("林雪");
        expect(altOfUrl("https://example.com/")).toBe("");
        expect(altOfUrl("不是网址")).toBe("");
    });
});
