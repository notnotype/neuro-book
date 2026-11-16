/**
 * 属性模型（docs/specs/workspace/markdown-dialect.md 输出 22，计划“属性模型”）：推断、写错的分类、各项编辑只换这一项的原文、
 * 改类型只做无损的。解析与读回都用真实的 `yaml`，1.1 的读法也用它（`version: "1.1"`）。种子固定，本地要换种子时设
 * `MARKDOWN_PROPERTY_SEED`。
 */

import {describe, expect, it} from "bun:test";
import fc from "fast-check";
import {isMap, isScalar, parseDocument} from "yaml";

import {isWholeFrontmatter} from "../../language/codec/source";
import {addProperty, convertKind, readProperties, removeProperty, renameProperty, replaceYaml, writeValue, yamlOf} from "./model";
import type {EditableValue, PropertyRow} from "./model";

const seed = Number(process.env.MARKDOWN_PROPERTY_SEED ?? 20261116);
const fm = (...lines: string[]): string => `---\n${lines.map((line) => `${line}\n`).join("")}---\n`;

function rows(raw: string): readonly PropertyRow[] {
    const read = readProperties(raw);
    if (!read.ok) throw new Error(`读不成属性：${read.problem} ${read.detail}`);
    return read.rows;
}
const only = (raw: string): PropertyRow => rows(raw)[0] as PropertyRow;

describe("读：按值推断类型", () => {
    it("文字、数字、勾选、日期、列表；引号与 YAML 1.1 的写法按 1.2 读", () => {
        const read = rows(fm("a: 长夜", "b: 12", "c: true", "d: 2025-12-21", "e: '2025-12-21'", "f: [甲, 乙]", "g:", "  - 渡口", "  - 'b'", "h: yes", "i: 0x1F", "j: ~", "k:", "l: \"\"", "m: 2025-12-21T10:00:00Z", "n: [2024, 小说]"));
        expect(read.map((row) => [row.name, row.kind, "value" in row ? row.value : null])).toEqual([
            ["a", "text", "长夜"],
            ["b", "number", 12],
            ["c", "checkbox", true],
            ["d", "date", "2025-12-21"],
            ["e", "date", "2025-12-21"],
            ["f", "list", ["甲", "乙"]],
            ["g", "list", ["渡口", "b"]],
            ["h", "text", "yes"],
            ["i", "number", 31],
            ["j", "text", null],
            ["k", "text", null],
            ["l", "text", ""],
            ["m", "text", "2025-12-21T10:00:00Z"],
            ["n", "list", ["2024", "小说"]],
        ]);
    });

    it("表示不了的是“复杂”：映射、含映射的序列、多行与块标量、锚点与别名、标签、合并键、显式键、非有限的数、带注释的列表（写回会丢注释）；不存在的日期按文字", () => {
        const read = rows(fm("a:", "  b: 1", "c: [{x: 1}]", "d: |", "  一行", "e: 第一行", "  第二行", "f: &x 1", "g: *x", "h: !!str 12", "<<: {z: 1}", "? k", ": v", "i: .inf", "j: 2025-02-30", "l: [甲, ~]", "m:", "  - x  # 注", "o:", "  - x", "  # 前", "  - y"));
        expect(read.map((row) => [row.name, row.kind])).toEqual([
            ["a", "complex"], ["c", "complex"], ["d", "complex"], ["e", "complex"], ["f", "complex"], ["g", "complex"], ["h", "complex"], ["<<", "complex"], ["k", "complex"], ["i", "complex"], ["j", "text"], ["l", "complex"], ["m", "complex"], ["o", "complex"],
        ]);
        expect(read.find((row) => row.name === "a")).toMatchObject({kind: "complex", source: "b: 1", line: 2});
    });

    it("键是数字、布尔时显示成字符串；行号按整段原文数", () => {
        expect(rows(fm("# 注释", "1: 一", "true: 是")).map((row) => [row.name, row.line, row.renamable])).toEqual([["1", 3, true], ["true", 4, true]]);
    });

    it("空 frontmatter、只有注释：零行，合法", () => {
        expect(readProperties("---\n---\n")).toEqual({ok: true, rows: []});
        expect(readProperties("---\r\n# 只有注释\r\n---")).toEqual({ok: true, rows: []});
    });
});

describe("读：写错与读不成属性", () => {
    it("语法错、重复的键、顶层不是映射、多个文档、文档标记、写在一行的映射：各有原因与行号", () => {
        const problem = (raw: string) => {
            const read = readProperties(raw);
            return read.ok ? null : [read.problem, read.line];
        };
        expect(problem(fm("a: [1, 2", "b: 3"))).toEqual(["syntax", 3]);
        expect(problem(fm("a: 1", "a: 2"))).toEqual(["duplicate-key", 3]);
        expect(problem(fm("只是一句话"))).toEqual(["not-mapping", 2]);
        expect(problem(fm("- a", "- b"))).toEqual(["not-mapping", 2]);
        expect(problem(fm("a: 1", "--- b: 2"))).toEqual(["multiple-documents", 3]);
        expect(problem(fm("--- a: 1"))).toEqual(["document-marker", 2]);
        expect(problem(fm("%YAML 1.2", "a: 1"))).toEqual(["document-marker", 2]);
        expect(problem(fm("a: 1", "..."))).toEqual(["document-marker", 3]);
        expect(problem(fm("{a: 1, b: 2}"))).toEqual(["flow-mapping", 2]);
    });
});

describe("写：只换这一项的原文", () => {
    const set = (raw: string, index: number, value: EditableValue): string => writeValue(raw, index, value);

    it("改文字：保留原来的引号；照字面会被读成别的（yes、数字、日期、带 # 或冒号）时加双引号", () => {
        const raw = fm("a: 甲", "b: '乙'", "c: \"丙\"  # 注");
        expect(set(raw, 0, {kind: "text", value: "长夜"})).toBe(fm("a: 长夜", "b: '乙'", "c: \"丙\"  # 注"));
        expect(set(raw, 1, {kind: "text", value: "it's"})).toBe(fm("a: 甲", "b: 'it''s'", "c: \"丙\"  # 注"));
        expect(set(raw, 2, {kind: "text", value: "a\"b"})).toBe(fm("a: 甲", "b: '乙'", "c: \"a\\\"b\"  # 注"));
        for (const [value, written] of [["yes", "\"yes\""], ["12", "\"12\""], ["2025-12-21", "\"2025-12-21\""], ["a #b", "\"a #b\""], ["a: b", "\"a: b\""], ["~", "\"~\""], [" 前后有空格 ", "\" 前后有空格 \""]]) {
            expect(set(fm("a: 甲"), 0, {kind: "text", value: value as string})).toBe(fm(`a: ${written as string}`));
        }
    });

    it("清空写成空值（名字:），原来是空引号的保持空引号；空值改成有值时冒号后补一个空格", () => {
        expect(set(fm("a: 甲  # 注", "b: x"), 0, {kind: "text", value: ""})).toBe(fm("a:  # 注", "b: x"));
        expect(set(fm("a: ''"), 0, {kind: "text", value: ""})).toBe(fm("a: ''"));
        expect(set(fm("a:", "b: x"), 0, {kind: "text", value: "甲"})).toBe(fm("a: 甲", "b: x"));
        expect(set(fm("a: ~"), 0, {kind: "number", value: 3})).toBe(fm("a: 3"));
    });

    it("数字、勾选、日期照字面写；带引号的日期保留引号", () => {
        expect(set(fm("a: 1"), 0, {kind: "number", value: 2.5})).toBe(fm("a: 2.5"));
        expect(set(fm("a: true"), 0, {kind: "checkbox", value: false})).toBe(fm("a: false"));
        expect(set(fm("a: 2025-12-21"), 0, {kind: "date", value: "2026-01-02"})).toBe(fm("a: 2026-01-02"));
        expect(set(fm("a: \"2025-12-21\""), 0, {kind: "date", value: "2026-01-02"})).toBe(fm("a: \"2026-01-02\""));
    });

    it("列表：没改的项保留原来的写法，新项写成字符串；块序列仍是块序列，按第一项的缩进；清空写成 []", () => {
        expect(set(fm("a: [x,   'y', 2024]", "b: 1"), 0, {kind: "list", value: ["x", "y", "2024", "2025", "a, b"]})).toBe(fm("a: [x, 'y', 2024, \"2025\", \"a, b\"]", "b: 1"));
        expect(set(fm("a:", "    - x", "    - y", "b: 1"), 0, {kind: "list", value: ["y", "新"]})).toBe(fm("a:", "    - y", "    - 新", "b: 1"));
        expect(set(fm("a:", "  - x", "b: 1"), 0, {kind: "list", value: []})).toBe(fm("a: []", "b: 1"));
    });

    it("换类型：块序列换成文字时从冒号后整段换掉", () => {
        expect(set(fm("a:", "  - 甲", "b: 1"), 0, {kind: "text", value: "甲"})).toBe(fm("a: 甲", "b: 1"));
        expect(set(fm("a: [甲]"), 0, {kind: "text", value: null})).toBe(fm("a:"));
    });

    it("沿用原文的换行符；闭栏后没有换行的仍没有", () => {
        // `y` 按 YAML 1.1 是布尔，新项要加引号。
        expect(set("---\r\na: 1\r\nb:\r\n  - x\r\n---", 1, {kind: "list", value: ["x", "z", "y"]})).toBe("---\r\na: 1\r\nb:\r\n  - x\r\n  - z\r\n  - \"y\"\r\n---");
        expect(addProperty("---\r\na: 1\r\n---", "b")).toBe("---\r\na: 1\r\nb:\r\n---");
    });

    it("复杂的一行不能改值", () => {
        expect(() => set(fm("a:", "  b: 1"), 0, {kind: "text", value: "x"})).toThrow();
    });
});

describe("写：注释、日期与特殊字符", () => {
    it("空值后面带注释：值插在冒号之后，注释与原来的空白留着；写成空值不改", () => {
        const raw = fm("a: # 备注", "b:   # 说明", "c: 1");
        expect(writeValue(raw, 0, {kind: "text", value: "x"})).toBe(fm("a: x # 备注", "b:   # 说明", "c: 1"));
        expect(writeValue(raw, 1, {kind: "list", value: ["p"]})).toBe(fm("a: # 备注", "b: [p]   # 说明", "c: 1"));
        expect(writeValue(raw, 1, {kind: "date", value: null})).toBe(raw);
        expect(rows(writeValue(raw, 0, {kind: "text", value: "x"}))[0]).toMatchObject({kind: "text", value: "x"});
    });

    it("写在一行里的列表带行尾注释：读成列表，加一项后注释还在", () => {
        const raw = fm("tags: [a, b] # 标签");
        expect(only(raw)).toMatchObject({kind: "list", value: ["a", "b"]});
        expect(writeValue(raw, 0, {kind: "list", value: ["a", "b", "c"]})).toBe(fm("tags: [a, b, c] # 标签"));
    });

    it("一百年以前的日期也是日期，写出读得回；不存在的日期不是", () => {
        expect(only(fm("时间: 0500-01-01"))).toMatchObject({kind: "date", value: "0500-01-01"});
        expect(only(writeValue(fm("时间: 2025-12-21"), 0, {kind: "date", value: "0002-12-21"}))).toMatchObject({kind: "date", value: "0002-12-21"});
        expect(only(fm("时间: 0002-02-30"))).toMatchObject({kind: "text"});
    });

    it("控制字符与换行写成双引号（原来是单引号的也是），读回同一段文字", () => {
        for (const text of ["a\u0001b", "甲\n乙"]) {
            for (const raw of [fm("a: 甲"), fm("a: '甲'")]) {
                const after = writeValue(raw, 0, {kind: "text", value: text});
                expect(after).toBe(fm(`a: ${JSON.stringify(text)}`));
                expect(only(after)).toMatchObject({kind: "text", value: text});
            }
        }
    });
});

describe("改名、删除、添加", () => {
    it("改名：与别的项重名、为空时拒绝；照字面会被读成别的（数字、带冒号）时加引号；原来的引号保留", () => {
        const raw = fm("a: 1", "b: 2");
        expect(renameProperty(raw, 0, "b")).toBeNull();
        expect(renameProperty(raw, 0, "  ")).toBeNull();
        expect(renameProperty(raw, 0, " 标题 ")).toBe(fm("标题: 1", "b: 2"));
        expect(renameProperty(raw, 0, "1")).toBe(fm("\"1\": 1", "b: 2"));
        expect(renameProperty(raw, 0, "a: b")).toBe(fm("\"a: b\": 1", "b: 2"));
        expect(renameProperty(fm("'a': 1"), 0, "c")).toBe(fm("'c': 1"));
        expect(renameProperty(fm("<<: {z: 1}"), 0, "c")).toBeNull();
    });

    it("删除：删掉这一项的各行与行尾注释，上方紧贴的注释留着", () => {
        expect(removeProperty(fm("a: 1", "# 关于 b", "b: 2  # 尾注", "c: 3"), 1)).toBe(fm("a: 1", "# 关于 b", "c: 3"));
        expect(removeProperty(fm("a:", "  - x", "  - y", "b: 2"), 0)).toBe(fm("b: 2"));
        expect(removeProperty(fm("a:", "  b: 1", "c:"), 1)).toBe(fm("a:", "  b: 1"));
        expect(removeProperty(fm("a: 1"), 0)).toBe(fm());
        expect(removeProperty(fm("  a: 1", "  b: 2"), 0)).toBe(fm("  b: 2"));
    });

    it("添加：在闭栏前加一行“名字:”；重名、为空时拒绝；空 frontmatter 也能加", () => {
        expect(addProperty(fm("a: 1", "# 尾部注释"), "b")).toBe(fm("a: 1", "# 尾部注释", "b:"));
        expect(addProperty(fm("a: 1"), "a")).toBeNull();
        expect(addProperty(fm("a: 1"), "")).toBeNull();
        expect(addProperty("---\n---\n", "yes")).toBe(fm("\"yes\":"));
        expect(addProperty(fm("a: 1", "a: 2"), "b")).toBeNull();
    });
});

describe("源码区", () => {
    it("显示开栏与闭栏之间的 YAML，换行是 \\n；写回时开栏、闭栏原样，换行符换回原文的，最后一行补换行", () => {
        const crlf = "---  \r\na: 1\r\n# 注\r\n---\r\n";
        expect(yamlOf(crlf)).toBe("a: 1\n# 注\n");
        expect(replaceYaml(crlf, "a: 2\n# 注")).toBe("---  \r\na: 2\r\n# 注\r\n---\r\n");
        expect(replaceYaml(fm("a: 1"), "")).toBe("---\n---\n");
        expect(yamlOf("---\n---")).toBe("");
        expect(replaceYaml("---\na: 1\n---", "b: 2")).toBe("---\nb: 2\n---");
    });

    it("YAML 里有独占一行的 --- 时写不回；YAML 写错照样写回", () => {
        expect(replaceYaml(fm("a: 1"), "a: 1\n---\nb: 2\n")).toBeNull();
        expect(replaceYaml(fm("a: 1"), "a: [1\n")).toBe(fm("a: [1"));
    });
});

describe("改类型只做无损的", () => {
    const convert = (line: string, kind: EditableValue["kind"]) => convertKind(only(fm(line)), kind);

    it("文字与数字：能精确换回的才换；数字换文字", () => {
        expect(convert("a: '12'", "number")).toEqual({kind: "number", value: 12});
        expect(convert("a: '012'", "number")).toBeNull();
        expect(convert("a: 长夜", "number")).toBeNull();
        expect(convert("a: 2.5", "text")).toEqual({kind: "text", value: "2.5"});
    });

    it("文字与列表：文字换成一项的列表；不超过一项的列表换回文字", () => {
        expect(convert("a: 长夜", "list")).toEqual({kind: "list", value: ["长夜"]});
        expect(convert("a: [长夜]", "text")).toEqual({kind: "text", value: "长夜"});
        expect(convert("a: []", "text")).toEqual({kind: "text", value: null});
        expect(convert("a: [甲, 乙]", "text")).toBeNull();
    });

    it("勾选与文字：true、false 两种文字才换成勾选", () => {
        expect(convert("a: 'true'", "checkbox")).toEqual({kind: "checkbox", value: true});
        expect(convert("a: 是", "checkbox")).toBeNull();
        expect(convert("a: false", "text")).toEqual({kind: "text", value: "false"});
    });

    it("空值随便换；有值的日期换不成文字（文字里的日期按日期推断）；复杂的换不了", () => {
        expect(convert("a:", "date")).toEqual({kind: "date", value: null});
        expect(convert("a:", "checkbox")).toEqual({kind: "checkbox", value: false});
        expect(convert("a:", "list")).toEqual({kind: "list", value: []});
        expect(convert("a: 2025-12-21", "text")).toBeNull();
        expect(convert("a: 12", "date")).toBeNull();
        expect(convertKind(only(fm("a:", "  b: 1")), "text")).toBeNull();
    });

    it("换出来的值写回去，读回是那个类型与值", () => {
        const raw = fm("a: '12'");
        const next = convert("a: '12'", "number") as EditableValue;
        expect(only(writeValue(raw, 0, next))).toMatchObject({kind: "number", value: 12});
        expect(only(writeValue(fm("a: [x]"), 0, convert("a: [x]", "text") as EditableValue))).toMatchObject({kind: "text", value: "x"});
    });
});

/** 随机的映射：各种写法（引号、注释、块与流式序列、多余的空格、复杂的值），换行符随机。 */
const entry = fc.oneof(
    fc.constantFrom("v", "'单引号'", "\"双引号\"", "12", "0x1F", "true", "yes", "2025-12-21", "~", "", "长夜 # 注", "[a,   b]", "[]", "\"\"").map((value) => [value === "" ? ":" : `: ${value}`]),
    fc.constant([":", "  - x", "  - 'y'"]),
    fc.constant([":", "    nested: 1"]),
    fc.constant([": |", "  块"]),
);
const mapping = fc.tuple(fc.uniqueArray(fc.constantFrom("a", "b", "c", "标题", "tags", "1", "'q'", "date"), {minLength: 1, maxLength: 6}), fc.array(entry, {minLength: 6, maxLength: 6}), fc.array(fc.boolean(), {minLength: 6, maxLength: 6}), fc.constantFrom("\n", "\r\n"))
    .map(([keys, entries, comments, eol]) => {
        const lines = keys.flatMap((key, index) => {
            const [first, ...rest] = entries[index] as string[];
            return [...(comments[index] === true ? [`# 关于 ${key}`] : []), `${key}${first as string}`, ...rest];
        });
        return `---${eol}${lines.map((line) => line + eol).join("")}---${eol}`;
    })
    .filter((raw) => readProperties(raw).ok);
const newValue = (row: PropertyRow): fc.Arbitrary<EditableValue> => {
    switch (row.kind) {
        case "text": return fc.option(fc.constantFrom("新", "yes", "a: b", "#x", "", "2025-12-21", "it's", "x, y"), {nil: null}).map((value) => ({kind: "text", value}));
        case "number": return fc.option(fc.integer({min: -1000, max: 1000}), {nil: null}).map((value) => ({kind: "number", value}));
        case "checkbox": return fc.boolean().map((value) => ({kind: "checkbox", value}));
        case "date": return fc.option(fc.constantFrom("2026-01-02", "1999-12-31"), {nil: null}).map((value) => ({kind: "date", value}));
        case "list": return fc.array(fc.constantFrom("x", "y", "新", "2024", "a, b", "yes"), {maxLength: 3}).map((value) => ({kind: "list", value: [...new Set(value)]}));
        case "complex": throw new Error("unreachable");
    }
};

/** 第 i 项的原文切片：从键所在行的行首到这一项的结尾（含行尾），按真实解析器的范围取。 */
function slices(raw: string): string[] {
    const content = raw.slice(raw.indexOf("\n") + 1);
    const doc = parseDocument(content);
    if (!isMap(doc.contents)) return [];
    return doc.contents.items.map((pair) => {
        const key = pair.key as {range: [number, number, number]};
        const value = pair.value as {range: [number, number, number]} | null;
        return content.slice(content.lastIndexOf("\n", key.range[0] - 1) + 1, value?.range[2] ?? key.range[2]);
    });
}

describe("随机映射", () => {
    it("改一项：别的项的原文切片逐字节相同，这一项读回新值，结果仍是完整的 frontmatter", () => {
        fc.assert(fc.property(mapping.chain((raw) => {
            const editable = rows(raw).filter((row) => row.kind !== "complex");
            return editable.length === 0 ? fc.constant(null) : fc.constantFrom(...editable).chain((row) => newValue(row).map((value) => ({raw, row, value})));
        }), (input) => {
            fc.pre(input !== null);
            const {raw, row, value} = input as {raw: string; row: PropertyRow; value: EditableValue};
            const after = writeValue(raw, row.index, value);
            expect(isWholeFrontmatter(after)).toBe(true);
            const before = slices(raw);
            const changed = slices(after);
            before.forEach((slice, index) => {
                if (index !== row.index) expect(changed[index]).toBe(slice);
            });
            const read = rows(after)[row.index] as PropertyRow;
            const empty = value.value === null || (value.kind === "list" && value.value.length === 0) || (value.kind === "text" && value.value === "");
            if (value.kind === "text" && value.value === "2025-12-21") expect(read).toMatchObject({kind: "date", value: "2025-12-21"});
            else if (!empty || value.kind === "list") expect(read).toMatchObject(value);
            else expect(read).toMatchObject({kind: "text"});
        }), {seed, numRuns: 300});
    });

    it("文字值写出后按 YAML 1.1 与 1.2 都读回同一个字符串", () => {
        const tricky = fc.oneof(fc.constantFrom("yes", "No", "on", "y", "~", "null", "true", "1:20", "012", "1_000", "0x1F", ".inf", "2025-12-21", "a: b", "a #b", "#x", "- a", "[x]", "{x}", "x, y", "it's", "\"q\"", "<<", "%x", "@x", "`x", "!x", "&x", "*x", "|x", ">x", "?x", " 前", "后 ", "长夜"), fc.string({minLength: 1, maxLength: 6}).filter((text) => !/[\r\n\t\u0085\u2028\u2029]/u.test(text)));
        fc.assert(fc.property(tricky, (text) => {
            const after = writeValue(fm("a: 甲"), 0, {kind: "text", value: text});
            for (const version of ["1.2", "1.1"] as const) {
                const doc = parseDocument(after.slice(4, -4), {version});
                expect(doc.errors).toEqual([]);
                const node = isMap(doc.contents) ? doc.contents.items[0]?.value : null;
                expect(isScalar(node) ? node.value : undefined).toBe(text);
            }
        }), {seed, numRuns: 300});
    });
});
