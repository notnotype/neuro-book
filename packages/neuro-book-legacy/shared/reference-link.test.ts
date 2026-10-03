import {describe, expect, it} from "vitest";
import {
    buildReferenceMarkdown,
    filterChapterReferenceCandidates,
    findActiveTrigger,
    flattenChapterReferenceCandidates,
    flattenLorebookReferenceCandidates,
    groupChapterReferenceCandidates,
    parseReferenceLink,
    rankLorebookReferenceCandidates,
    replaceTriggerWithReference,
    type LorebookReferenceTreeEntry,
    type VolumeReferenceSource,
    tokenizeReferenceText,
} from "nbook/shared/reference-link";

const createVolumes = (): VolumeReferenceSource[] => [
    {
        id: "volume-1",
        title: "上卷",
        summary: "",
        sortOrder: 0,
        updatedAt: "2026-04-05T12:00:00.000Z",
        chapters: [
            {
                id: "chapter-1",
                volumeId: "volume-1",
                title: "雪夜来客",
                status: "DRAFT",
                summary: "顾寒第一次遇见青铜门。",
                characters: ["顾寒"],
                todos: [],
                sortOrder: 0,
                updatedAt: "2026-04-05T12:00:00.000Z",
            },
            {
                id: "chapter-2",
                volumeId: "volume-1",
                title: "铜门低语",
                status: "DRAFT",
                summary: "顾寒再次听见门后的声音。",
                characters: ["顾寒"],
                todos: ["补充门后的回声"],
                sortOrder: 1,
                updatedAt: "2026-04-06T12:00:00.000Z",
            },
            {
                id: "chapter-3",
                volumeId: "volume-1",
                title: "雾港晨钟",
                status: "DRAFT",
                summary: "顾寒抵达雾港。",
                characters: ["顾寒", "雾港守钟人"],
                todos: [],
                sortOrder: 2,
                updatedAt: "2026-04-07T12:00:00.000Z",
            },
        ],
    },
    {
        id: "volume-2",
        title: "下卷",
        summary: "",
        sortOrder: 1,
        updatedAt: "2026-04-05T12:00:00.000Z",
        chapters: [
            {
                id: "chapter-4",
                volumeId: "volume-2",
                title: "海风旧信",
                status: "DRAFT",
                summary: "顾寒拆开来自雾港的旧信。",
                characters: ["顾寒"],
                todos: [],
                sortOrder: 0,
                updatedAt: "2026-04-08T12:00:00.000Z",
            },
        ],
    },
];

const createLorebookTree = (): LorebookReferenceTreeEntry[] => [
    {
        id: "101",
        novelId: "novel-1",
        parentId: null,
        sortOrder: 0,
        name: "bronze-gate",
        path: "rule.bronze-gate",
        title: "青铜门",
        type: "rule",
        subtype: null,
        status: "active",
        summary: "一扇会低语的古老门扉。",
        createdAt: "2026-04-05T12:00:00.000Z",
        updatedAt: "2026-04-08T12:00:00.000Z",
        children: [],
    },
    {
        id: "102",
        novelId: "novel-1",
        parentId: null,
        sortOrder: 1,
        name: "fog-harbor",
        path: "location.fog-harbor",
        title: "雾港",
        type: "location",
        subtype: null,
        status: "active",
        summary: "终年有雾的海港。",
        createdAt: "2026-04-05T12:00:00.000Z",
        updatedAt: "2026-04-09T12:00:00.000Z",
        children: [],
    },
    {
        id: "220",
        novelId: "novel-1",
        parentId: null,
        sortOrder: 2,
        name: "cold-letter",
        path: "item.cold-letter",
        title: "旧信",
        type: "item",
        subtype: null,
        status: "draft",
        summary: "一封带有海盐味道的旧信。",
        createdAt: "2026-04-05T12:00:00.000Z",
        updatedAt: "2026-04-07T12:00:00.000Z",
        children: [],
    },
];

describe("reference-link", () => {
    it("解析与构造引用源码", () => {
        const raw = "[青铜门](lorebook://101)";
        expect(parseReferenceLink(raw)).toEqual({
            kind: "lorebook",
            title: "青铜门",
            targetId: "101",
        });
        expect(parseReferenceLink("[旧格式](@chapter://1)")).toEqual({
            kind: "chapter",
            title: "旧格式",
            targetId: "1",
        });
        expect(buildReferenceMarkdown({
            kind: "chapter",
            title: "雪夜来客",
            targetId: "chapter-1",
        })).toBe("[雪夜来客](chapter://chapter-1)");
    });

    it("切分文本中的引用 token", () => {
        const tokens = tokenizeReferenceText("前文 [青铜门](lorebook://101) 后文");
        expect(tokens).toHaveLength(3);
        expect(tokens[1]).toMatchObject({
            kind: "reference",
            raw: "[青铜门](lorebook://101)",
        });
    });

    it("识别当前光标前的 trigger", () => {
        expect(findActiveTrigger("测试 @chapter://12", 17)).toMatchObject({
            kind: "chapter",
            query: "12",
        });
        expect(findActiveTrigger("测试 @lo", 6)).toMatchObject({
            kind: "reference-root",
            query: "lo",
        });
        expect(findActiveTrigger("测试 /ne", 6)).toMatchObject({
            kind: "command",
            query: "ne",
        });
    });

    it("用引用替换 trigger", () => {
        const trigger = findActiveTrigger("查看 @chapter://2", 16);
        expect(trigger).not.toBeNull();
        const replaced = replaceTriggerWithReference("查看 @chapter://2", trigger!, {
            kind: "chapter",
            title: "铜门低语",
            targetId: "chapter-2",
        });
        expect(replaced.text).toBe("查看 [铜门低语](chapter://chapter-2) ");
        expect(replaced.caret).toBe(replaced.text.length);
    });

    it("支持章节数字搜索与三组分桶", () => {
        const volumes = createVolumes();
        const chapterCandidates = flattenChapterReferenceCandidates(volumes);
        expect(filterChapterReferenceCandidates(chapterCandidates, "第02章").map((item) => item.id)).toEqual(["chapter-2"]);
        expect(filterChapterReferenceCandidates(chapterCandidates, "2").map((item) => item.id)).toContain("chapter-2");

        const groups = groupChapterReferenceCandidates(volumes, "chapter-2", ["chapter-4", "chapter-1"], "");
        expect(groups.nearby.map((item) => item.id)).toEqual(["chapter-1", "chapter-2", "chapter-3"]);
        expect(groups.recent.map((item) => item.id)).toEqual(["chapter-4"]);
        expect(groups.ascending.map((item) => item.id)).toEqual([]);
    });

    it("按 query 与当前章节上下文排序 lorebook 候选", () => {
        const candidates = flattenLorebookReferenceCandidates(createLorebookTree());
        const rankedByQuery = rankLorebookReferenceCandidates(candidates, "102", null);
        expect(rankedByQuery[0]?.id).toBe("102");

        const rankedByContext = rankLorebookReferenceCandidates(candidates, "", {
            title: "雾港晨钟",
            summary: "顾寒抵达雾港，看见青铜门的影子。",
            characters: ["顾寒"],
            todos: ["补充雾港的钟声"],
        });
        expect(rankedByContext.map((item) => item.id).slice(0, 2)).toEqual(["102", "101"]);
    });

    it("path 查询会命中 lorebook 条目", () => {
        const candidates = flattenLorebookReferenceCandidates(createLorebookTree());
        const ranked = rankLorebookReferenceCandidates(candidates, "location.fog", null);
        expect(ranked[0]?.path).toBe("location.fog-harbor");
    });
});
