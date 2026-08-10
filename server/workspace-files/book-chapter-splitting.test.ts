import {describe, expect, it} from "vitest";
import {
    compileAiPatternRegex,
    decodeBookText,
    splitBookChapters,
    type ChapterPatternDescription,
} from "nbook/server/workspace-files/book-chapter-splitting";

const LONG_BODY = "她站在校门口，深吸一口气。九月的风带着桂花的香气，吹起她的发梢，她想起那个约定，然后她笑了。";
const REALISTIC_BODY = Array(20).fill(LONG_BODY).join("\n");

describe("decodeBookText", () => {
    it("UTF-8 文本正常解码", () => {
        const {text, encoding} = decodeBookText(Buffer.from("第一章 你好", "utf-8"));
        expect(encoding).toBe("utf-8");
        expect(text).toContain("第一章");
    });

    it("UTF-8 解码失败回退 GBK", () => {
        // 「第一章 你好」的 GBK 字节序列（Windows CP936）
        const gbkBytes = Buffer.from([0xb5, 0xda, 0xd2, 0xbb, 0xd5, 0xc2, 0x20, 0xc4, 0xe3, 0xba, 0xc3]);
        const {text, encoding} = decodeBookText(gbkBytes);
        expect(encoding).toBe("gbk");
        expect(text).toContain("第一章");
    });
});

describe("splitBookChapters 模式库", () => {
    const book = [
        "第一章 重生",
        REALISTIC_BODY,
        "第二章 入学",
        REALISTIC_BODY,
        "第三章 试探",
        REALISTIC_BODY,
    ].join("\n");

    it("中文「第X章」模式命中", () => {
        const result = splitBookChapters({text: book});
        expect(result.stats.mode).toBe("pattern");
        expect(result.stats.patternKey).toBe("chinese-chapter");
        expect(result.parts).toHaveLength(3);
        expect(result.parts[0]?.heading).toBe("第一章 重生");
        expect(result.stats.confidence).toBe("high");
    });

    it("Markdown 标题模式命中且不切碎章内小标题", () => {
        const mdBook = [
            "# 第一章",
            REALISTIC_BODY,
            "# 第二章",
            REALISTIC_BODY,
            "## 节内小标题",
            "小节内容。",
        ].join("\n");
        const result = splitBookChapters({text: mdBook});
        expect(result.stats.patternKey).toBe("markdown-heading");
        expect(result.parts).toHaveLength(2);
    });

    it("Chapter N 模式命中", () => {
        const latinBook = [
            "Chapter 1",
            REALISTIC_BODY,
            "Chapter 2",
            REALISTIC_BODY,
        ].join("\n");
        const result = splitBookChapters({text: latinBook});
        expect(result.stats.patternKey).toBe("latin-chapter");
        expect(result.parts).toHaveLength(2);
        expect(result.parts[0]?.heading).toBe("Chapter 1");
    });

    it("无章节标记时置信度 low 且整篇一块", () => {
        const result = splitBookChapters({text: "这是一本没有章节标记的书。\n只有一段连续的文字。"});
        expect(result.stats.confidence).toBe("low");
        expect(result.parts.length).toBeLessThan(2);
    });

    it("书名页（首块过短）被剔除", () => {
        const withTitlePage = [
            "书名",
            "第一章 开始",
            REALISTIC_BODY,
            "第二章 继续",
            REALISTIC_BODY,
        ].join("\n");
        const result = splitBookChapters({text: withTitlePage});
        expect(result.parts[0]?.heading).toBe("第一章 开始");
        expect(result.parts).toHaveLength(2);
    });

    it("章节字数异常被标记", () => {
        const uneven = [
            "第一章 短",
            "短短短短短短短短短短短短短短短短短短短短短短短短短短短短短短短短短短短短短短短短短短短短短短短短短短短短。",
            "第二章 长",
            REALISTIC_BODY,
            REALISTIC_BODY,
            REALISTIC_BODY,
        ].join("\n");
        const result = splitBookChapters({text: uneven});
        expect(result.stats.anomalies.some((item) => item.heading === "第一章 短")).toBe(true);
    });
});

describe("splitBookChapters 逃生口与 AI 产物", () => {
    const text = [
        "第1回 风起",
        REALISTIC_BODY,
        "第2回 云涌",
        REALISTIC_BODY,
        "第3回 雨落",
        REALISTIC_BODY,
    ].join("\n");

    it("--split-pattern 逃生口正则生效", () => {
        const result = splitBookChapters({text, regex: /^第\d+回/});
        expect(result.stats.mode).toBe("regex");
        expect(result.parts).toHaveLength(3);
        expect(result.parts[0]?.heading).toBe("第1回 风起");
    });

    it("AI 结构化描述组装正则", () => {
        const pattern: ChapterPatternDescription = {
            lineStart: true,
            prefix: "第",
            numbering: "arabic",
            suffix: "回",
            separator: " ",
            titleOptional: false,
        };
        const result = splitBookChapters({text, pattern});
        expect(result.stats.mode).toBe("ai-description");
        expect(result.parts).toHaveLength(3);
        expect(result.parts[0]?.heading).toBe("第1回 风起");
    });

    it("AI 起始行号切分", () => {
        const result = splitBookChapters({text, splitPoints: {startLines: [0, 2, 4]}});
        expect(result.stats.mode).toBe("split-points");
        expect(result.parts).toHaveLength(3);
    });
});

describe("compileAiPatternRegex", () => {
    it("组装常见「第X章」描述", () => {
        const regex = compileAiPatternRegex({
            lineStart: true,
            prefix: "第",
            numbering: "arabic",
            suffix: "章",
        });
        expect(regex.test("第123章 正文标题")).toBe(true);
        expect(regex.test("正文里提到第123章")).toBe(false);
    });

    it("无标题章节可匹配 titleOptional", () => {
        const regex = compileAiPatternRegex({
            lineStart: true,
            prefix: "第",
            numbering: "arabic",
            suffix: "章",
            titleOptional: true,
        });
        expect(regex.test("第1章")).toBe(true);
    });

    it("Chapter N 形态", () => {
        const regex = compileAiPatternRegex({
            lineStart: true,
            prefix: "Chapter",
            numbering: "arabic",
            separator: " ",
        });
        expect(regex.test("Chapter 12 标题")).toBe(true);
    });
});
