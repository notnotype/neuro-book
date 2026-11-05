import {describe, expect, test} from "bun:test";

import {
    addExact,
    addressesOverlap,
    allPositions,
    applyChanges,
    ChapterOrder,
    compareIds,
    compareRanks,
    compareTie,
    defaultPosition,
    idListsOf,
    diffValues,
    exactProblem,
    formatPath,
    IdAllocator,
    parseChineseNumber,
    parsePath,
    placementRank,
    positionRank,
    rankBefore,
    readNumbers,
    stableStringify,
} from "../src/index";

describe("中文数字（canon.revisions 输出 3 的依据核验）", () => {
    test.each([
        ["两千", 2000],
        ["三千五", 3500],
        ["一万两千", 12000],
        ["四万", 40000],
        ["四万五", 45000],
        ["四万一千八", 41800],
        ["十二", 12],
        ["二十", 20],
        ["一百零五", 105],
        ["一百二", 120],
        ["两千零五十", 2050],
        ["两万三千四百", 23400],
        ["十万", 100000],
        ["四万零五", 40005],
        ["三亿五", 350000000],
    ])("%s 读成 %d", (text, expected) => {
        expect(parseChineseNumber(text)).toBe(expected);
    });

    test("读不出的写法跳过", () => {
        expect(parseChineseNumber("一二三")).toBeNull();
    });

    test("原文里的阿拉伯数字、全角数字、千分位、带万的写法都读出来", () => {
        expect(readNumbers("卡里还有四万，花了2,000，又存进１２００，还剩3.5万")).toEqual(expect.arrayContaining([40000, 2000, 1200, 35000]));
    });
});

describe("精确档的数（canon.components 输出 14）", () => {
    test("边界内的数合格，加减没有浮点误差", () => {
        expect(exactProblem(99999999999.9999)).toBeNull();
        expect(exactProblem(-99999999999.9999)).toBeNull();
        expect(addExact(0.1, 0.2)).toBe(0.3);
        expect(addExact(41800, -2000)).toBe(39800);
    });

    test("超出范围、超过 4 位小数、非有限的数不合格", () => {
        expect(exactProblem(1e11)).toBe("out-of-range");
        expect(exactProblem(0.00001)).toBe("too-many-decimals");
        expect(exactProblem(1.00001)).toBe("too-many-decimals");
        expect(exactProblem(Number.NaN)).toBe("not-finite");
        expect(addExact(99999999999.9999, 0.0001)).toBeNull();
    });

    test("合格的数经 JSON 读写不变", () => {
        for (const value of [99999999999.9999, 12345678901.2345, 0.0001, -4.5]) expect(JSON.parse(JSON.stringify(value))).toBe(value);
    });
});

describe("id（canon.model 输出 2 的次序、canon.revisions 输出 20）", () => {
    test("按数值部分比较，c9 在 c10 之前", () => {
        expect(compareIds("c9", "c10")).toBeLessThan(0);
        expect(["c10", "c2", "c9"].sort(compareIds)).toEqual(["c2", "c9", "c10"]);
    });

    test("编号取见过的最大号加一，删掉的也算，不复用", () => {
        const ids = new IdAllocator();
        for (const id of ["e1", "e7", "c3"]) ids.observe(id);
        expect(ids.next("e")).toBe("e8");
        expect(ids.next("e")).toBe("e9");
        expect(ids.next("k")).toBe("k1");
    });
});

describe("地址（canon.model 术语）", () => {
    test.each([
        ["entry.name", true],
        ["entry.aliases", true],
        ["text[b3]", true],
        ["panel.存款", true],
        ["panel.任务[t3].奖励", true],
        ["panel.启用", true],
        ["entry.text", false],
        ["text.b3", false],
        ["panel.任务[3]", false],
        ["class.x", false],
    ])("%s 合法：%s", (path, ok) => {
        const parsed = parsePath(path);
        expect(parsed !== null).toBe(ok);
        if (parsed !== null) expect(formatPath(parsed)).toBe(path);
    });

    test("一条路径是另一条的前缀时重叠，按段比较", () => {
        expect(addressesOverlap({entry: "e1", path: "panel.任务"}, {entry: "e1", path: "panel.任务[t3].奖励"})).toBe(true);
        expect(addressesOverlap({entry: "e1", path: "panel.存"}, {entry: "e1", path: "panel.存款"})).toBe(false);
        expect(addressesOverlap({entry: "e1", path: "panel.存款"}, {entry: "e2", path: "panel.存款"})).toBe(false);
    });
});

describe("修订路径与只存变了的叶子（canon.revisions 输入与前置条件）", () => {
    const before = {
        id: "e1",
        init: {
            name: "星瑕",
            aliases: ["哥哥"],
            text: [{id: "b1", source: "一"}, {id: "b2", source: "二"}],
            data: {panel: {type: "p.panel", version: 1, enabled: true, fields: {存款: 40000, 魔力: null}}},
        },
        initBasis: {"panel.存款": {kind: "quote", quote: "卡里还有四万"}},
    };

    test("改前改后往返：套 after 得到新值，套 before 得到旧值", () => {
        const after = structuredClone(before) as typeof before & {sameAs?: string};
        after.init.data.panel.fields.存款 = 41800;
        after.init.text = [{id: "b2", source: "二改"}, {id: "b1", source: "一"}, {id: "b3", source: "三"}];
        after.init.aliases = ["哥哥", "夜王"];
        after.sameAs = "e9";
        delete (after.initBasis as Record<string, unknown>)["panel.存款"];
        const changes = diffValues(before, after, idListsOf("entry"));
        expect(applyChanges(before, changes, "after")).toEqual(after);
        expect(applyChanges(after, changes, "before")).toEqual(before);
    });

    test("有 id 的列表按 [id] 寻址、顺序另记；没有 id 的数组整体是叶子；非标识符的键写成 JSON 字符串", () => {
        const after = structuredClone(before);
        after.init.text[1]!.source = "二改";
        after.init.aliases.push("夜王");
        (after.initBasis as Record<string, unknown>)["panel.存款"] = {kind: "estimate", note: "估"};
        const paths = diffValues(before, after, idListsOf("entry")).map((change) => change.path);
        expect(paths).toContain("init.text[b2].source");
        expect(paths).toContain("init.aliases");
        expect(paths).toContain("initBasis[\"panel.存款\"].kind");
        expect(paths.some((path) => path.includes("#order"))).toBe(false);
    });

    test("null 是未知，与字段不存在不同", () => {
        const after = structuredClone(before) as Record<string, unknown>;
        (after.init as typeof before.init).data.panel.fields.魔力 = 3200 as unknown as null;
        const [change] = diffValues(before, after, idListsOf("entry"));
        expect(change).toEqual({path: "init.data.panel.fields.魔力", before: null, after: 3200});
        const removed = structuredClone(before) as Record<string, unknown>;
        delete (removed.init as {data: {panel: {fields: Record<string, unknown>}}}).data.panel.fields.魔力;
        expect(diffValues(before, removed, idListsOf("entry"))).toEqual([{path: "init.data.panel.fields.魔力", before: null}]);
    });

    test("稳定序列化与键的顺序无关", () => {
        expect(stableStringify({b: 1, a: {d: 2, c: [3, {f: 4, e: 5}]}})).toBe(stableStringify({a: {c: [3, {e: 5, f: 4}], d: 2}, b: 1}));
    });
});

describe("位置与先后（canon.model 输出 2、21）", () => {
    const order = new ChapterOrder(["ch1", "ch2", "ch3"]);

    test("初值 < 前史 < 第 1 章开头 < 第 1 章的安放 < 第 1 章末尾 < 第 2 章开头", () => {
        const initial = positionRank(order, {kind: "initial"})!;
        const prehistory = placementRank(order, {kind: "prehistory", order: 5})!;
        const start1 = positionRank(order, {kind: "chapter", chapter: "ch1", edge: "start"})!;
        const inside1 = placementRank(order, {kind: "chapter", chapter: "ch1", key: 30})!;
        const end1 = positionRank(order, {kind: "chapter", chapter: "ch1", edge: "end"})!;
        const start2 = positionRank(order, {kind: "chapter", chapter: "ch2", edge: "start"})!;
        const ranks = [initial, prehistory, start1, inside1, end1, start2];
        for (let index = 1; index < ranks.length; index += 1) expect(compareRanks(ranks[index - 1]!, ranks[index]!)).toBeLessThan(0);
        expect(rankBefore(prehistory, initial)).toBe(false);
        expect(rankBefore(prehistory, start1)).toBe(true);
    });

    test("未排章与已删除章上的安放不在序里；指向不存在的章的读取位置没有键", () => {
        expect(placementRank(order, {kind: "unscheduled"})).toBeNull();
        expect(placementRank(order, {kind: "chapter", chapter: "gone", key: 0})).toBeNull();
        expect(positionRank(order, {kind: "chapter", chapter: "gone", edge: "start"})).toBeNull();
    });

    test("排序键相同时按写入版本、再按 id 的数值部分", () => {
        expect(compareTie({version: 3, id: "c10"}, {version: 3, id: "c9"})).toBeGreaterThan(0);
        expect(compareTie({version: 2, id: "c10"}, {version: 3, id: "c9"})).toBeLessThan(0);
    });

    test("缺省位置：有章时是最新一章末尾，没有章时是初值", () => {
        expect(defaultPosition(order)).toEqual({kind: "chapter", chapter: "ch3", edge: "end"});
        expect(defaultPosition(new ChapterOrder([]))).toEqual({kind: "initial"});
        expect(allPositions(order)).toHaveLength(7);
    });
});

describe("修订路径：哪些数组按 id 拆（canon.revisions 输入的“路径的写法”）", () => {
    test("决策挂的对象有同一个 id 的两项时整体是一个叶子，往返以后两项都在", () => {
        const before = {id: "d1", about: [{kind: "diagnostic", id: "plot.x", key: {objects: [{kind: "entry", id: "e1"}]}, version: 1}]};
        const after = {id: "d1", about: [...before.about, {kind: "diagnostic", id: "plot.x", key: {objects: [{kind: "entry", id: "e2"}]}, version: 1}]};
        const changes = diffValues(before, after, idListsOf("decision"));
        expect(changes.map((change) => change.path)).toEqual(["about"]);
        expect(applyChanges(before, changes, "after")).toEqual(after);
    });

    test("讲述按 id 拆，加一条讲述记成新元素与顺序两个叶子；连接这类数组整体一个叶子", () => {
        const before = {id: "c1", told: [{id: "t1", source: "chapter", chapter: "ch1", quote: "甲"}], links: [{kind: "fulfills", plan: "c2"}]};
        const after = {...before, told: [...before.told, {id: "t2", source: "chapter", chapter: "ch1", quote: "乙"}]};
        const changes = diffValues(before, after, idListsOf("change"));
        expect(changes.map((change) => change.path)).toEqual(["told[t2]", "told#order"]);
        expect(applyChanges(before, changes, "after")).toEqual(after);
    });
});
