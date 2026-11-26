/**
 * 条目主文字的写入检查与三种渲染（docs/specs/canon/rendering.md），在真实的世界上：写入走 `World.publish`，渲染走按条目的入口。
 * 标签的读法与检查本身的细节在 grammar.test.ts；这里测内核把它们接到世界上以后调用方看得到的结果。
 */

import {createHash} from "node:crypto";

import {describe, expect, test} from "bun:test";

import {buildRegistry, ChapterOrder, editEntries, previewEntries, type ComponentDeclaration, type EntryEdits, type EntryOp, type Entry, type StoryChange, type WriteRequest} from "../src/index";
import {parseExpression, stripEntryText} from "../src/grammar/index";
import {normalizeBlockSource, blockProblem} from "../src/render/syntax";
import {renderEntryForAgent, renderEntryForAuthor, renderEntryPlain, renderSourceForAuthor, splitBlocks, type PlainOptions} from "../src/render/entry";
import {evaluate, renderBlockPlain, type AuthorValue, type PlainBlock, type PlainContext, type Resolve} from "../src/render/render";
import {analyzeBlock, analyzeDraft} from "../src/render/syntax";
import {World, type WriteResult} from "../src/world/world";
import {PROJECT, sign, verify} from "./fixtures/authorization";
import {PANEL, PERSON} from "./fixtures/world";

const BLOCK = '魔力 <V of="panel.魔力" />/<V of="panel.魔力上限" />，<If test="panel.魔力 >= 1000">能变身<Else />变不了身</If>';

const options = () => ({
    order: new ChapterOrder(["ch1", "ch2", "ch3", "ch4", "ch5"]),
    registry: buildRegistry([PANEL, PERSON]),
    reductions: () => undefined,
    chapterText: () => "",
    digest: (text: string) => createHash("sha256").update(text).digest("hex"),
});

let sequence = 0;
const id = () => `req-${String(++sequence)}`;
const author = {kind: "author"} as const;
const at = (chapter: string) => ({kind: "chapter" as const, chapter, edge: "end" as const, line: "main"});

function ok<T extends {ok: boolean}>(result: T): Extract<T, {ok: true}> {
    if (!result.ok) throw new Error(JSON.stringify((result as {failure?: unknown}).failure));
    return result as Extract<T, {ok: true}>;
}

/** 星瑕：面板第 3 章起生效，魔力 3110/12000；星瑾一句话。版本 2。 */
function world(blocks: string[] = [BLOCK]): World {
    const xia: Entry = {
        id: "tmp:xia", type: "人物", parent: null, folder: "", order: 0,
        init: {name: "星瑕", aliases: [], summary: "", text: blocks.map((source, index) => ({id: `b${String(index + 1)}`, source})), data: {
            panel: {type: PANEL.id, version: 1, enabled: false, fields: {存款: 0, 魔力上限: 12000, 魔力: 3110, 物品: []}},
        }},
    };
    const jin: Entry = {id: "tmp:jin", type: "人物", parent: null, folder: "", order: 1, init: {name: "星瑾", aliases: [], summary: "", text: [], data: {}}};
    const first = ok(World.empty(options()).publish({requestId: id(), by: author, what: "opening", title: "开局", baseVersion: 0, puts: [{ref: {kind: "entry", id: "tmp:xia"}, after: xia}, {ref: {kind: "entry", id: "tmp:jin"}, after: jin}]} as WriteRequest, "t") as WriteResult);
    return ok(first.world.publish({requestId: id(), by: author, what: "bookkeeping", title: "得到面板", baseVersion: 1, puts: [{ref: {kind: "change", id: "tmp:c"}, after: {id: "tmp:c", kind: "written", text: "得到面板", at: {kind: "chapter", chapter: "ch3", key: 0}, told: [], involves: ["e1"], lines: [], links: [], patches: [{op: "set", at: {entry: "e1", path: "panel.启用"}, value: true}], status: "active", by: author}}]} as WriteRequest, "t") as WriteResult).world;
}

/** 把星瑕的主文字整个换成 `blocks`（块 id 依次是 b1、b2…）发布。 */
function writeText(base: World, blocks: string[]): WriteResult {
    const next = structuredClone(base.data.entries.get("e1")!);
    next.init.text = blocks.map((source, index) => ({id: `b${String(index + 1)}`, source}));
    return base.publish({requestId: id(), by: author, what: "edit", title: "改", baseVersion: base.version, puts: [{ref: {kind: "entry", id: "e1"}, after: next}]}, "t");
}

/** 写入被拒时的问题（码与位置）；写入成功时是 "ok"。 */
const rejected = (result: WriteResult) => (result.ok ? "ok" : result.failure.code === "validation-failed" ? result.failure.problems.map((problem) => ({code: problem.code, path: problem.path})) : result.failure.code);

/** 绕过写入检查放进几块（旧数据、卸了插件的标签）：直接重放一次改它的修订。 */
function injected(base: World, blocks: ReadonlyArray<readonly [string, string]>): World {
    const order = base.data.entries.get("e1")!.init.text.map((block) => block.id);
    return World.replay([
        ...base.revisions,
        {...base.revisions.at(-1)!, id: "r9", version: base.version + 1, requestId: "legacy", ops: [{ref: {kind: "entry", id: "e1"}, kind: "modify", fields: [
            ...blocks.map(([block, source]) => ({path: `init.text[${block}]`, after: {id: block, source}})),
            {path: "init.text#order", before: order, after: [...order, ...blocks.map(([block]) => block)]},
        ]}]},
    ], base.options);
}

const textOf = (base: World) => base.data.entries.get("e1")!.init.text;

function agentBlocks(base: World, position: ReturnType<typeof at>, mode: "actual" | "planned" = "actual", entry = "e1"): string[] {
    const rendered = renderEntryForAgent(base, entry, position, mode);
    if (rendered === null || typeof rendered === "string") throw new Error("no render");
    return rendered.blocks.map((block) => block.text);
}

/** 给作者的一块的值表。 */
function authorValues(base: World, position: ReturnType<typeof at>, index = 0, entry = "e1", mode: "actual" | "planned" = "actual"): readonly AuthorValue[] {
    const rendered = renderEntryForAuthor(base, entry, position, mode);
    if (rendered === null || typeof rendered === "string") throw new Error("no render");
    const block = rendered.blocks[index]!;
    if (!("values" in block)) throw new Error(`block is an error block: ${JSON.stringify(block)}`);
    return block.values;
}

describe("canon.rendering 输出 1、3、18：写入时检查与规范写法", () => {
    test("整篇写入：不过检查的块拒收并指出块；只改别的块时，存下来的旧块不再查", () => {
        expect(rejected(writeText(world(), [BLOCK, '魔力 <V of="panel.魔力"']))).toEqual([{code: "tag-malformed", path: "init.text[b2]"}]);
        const result = writeText(world(), [BLOCK, "第二段"]);
        expect(rejected(result)).toBe("ok");
    });

    test.each([
        ["少了收尾的内置标签", '魔力 <V of="panel.魔力"', "tag-malformed"],
        ["原样 HTML", "<div>旧</div>", "unsupported-markdown"],
        ["带着装饰的 V（值是程序加的）", '<V of="panel.魔力">3110</V>', "unknown-tag"],
        ["带着装饰的 Ref", '<Ref id="e2" name="星瑾" />', "unknown-tag"],
        ["式子写错", '<V expr="panel.+" />', "forbidden-syntax"],
        ["If 没闭合", '<If test="panel.魔力 > 0">有', "cross-block"],
        ["嵌套深到读不出结构（几万层引用）", "> ".repeat(25_000), "unsupported-markdown"],
    ])("拒收：%s", (_name, source, code) => {
        expect(rejected(writeText(world(), [source]))).toEqual([{code, path: "init.text[b1]"}]);
    });

    test("一块正好 5 万个字符照常写入，多一个字拒收", () => {
        expect(rejected(writeText(world(), ["字".repeat(50_000)]))).toBe("ok");
        expect(rejected(writeText(world(), ["字".repeat(50_001)]))).toEqual([{code: "block-too-large", path: "init.text[b1]"}]);
    });

    test("变更里的整段替换也过检查", () => {
        const base = world();
        const result = base.publish({requestId: id(), by: author, what: "edit", title: "坏", baseVersion: base.version, puts: [{ref: {kind: "change", id: "tmp:b"}, after: {id: "tmp:b", kind: "written", text: "坏", at: {kind: "chapter", chapter: "ch4", key: 0}, told: [], involves: [], lines: [], links: [], patches: [{op: "set", at: {entry: "e1", path: "text[b1]"}, value: '<V of="panel.魔力"'}], status: "active", by: author}}]}, "t");
        expect(rejected(result)).toEqual([{code: "tag-malformed", path: "patches[0]"}]);
    });

    test("存下的是规范写法：去掉 BOM、换行成 LF、标签之间一个空格、自闭合写 ` />`；整段替换的变更也一样", () => {
        const bom = String.fromCharCode(0xfeff);
        const written = ok(writeText(world(), [`${bom}魔力 <V  of="panel.魔力"/>\r\n<If  test="panel.魔力 > 0" >有<Else/>无</If>`])).world;
        expect(textOf(written)).toEqual([{id: "b1", source: '魔力 <V of="panel.魔力" />\n<If test="panel.魔力 > 0">有<Else />无</If>'}]);
        const replaced = ok(written.publish({requestId: id(), by: author, what: "edit", title: "换", baseVersion: written.version, puts: [{ref: {kind: "change", id: "tmp:r"}, after: {id: "tmp:r", kind: "written", text: "换", at: {kind: "chapter", chapter: "ch4", key: 0}, told: [], involves: [], lines: [], links: [], patches: [{op: "set", at: {entry: "e1", path: "text[b1]"}, value: '<Ref   id="e2"/>'}], status: "active", by: author}}]}, "t"));
        const change = replaced.world.data.changes.get(replaced.ids["tmp:r"]!)!;
        expect(change.patches[0]!.value).toBe('<Ref id="e2" />');
    });

    test("splitBlocks 按顶层节点切块，新 id 不与已有的重复", () => {
        expect(splitBlocks('# 星瑕\n\n第一段 <V of="panel.魔力" />。\n\n- 一\n- 二', ["b3"])).toEqual([{id: "b4", source: "# 星瑕"}, {id: "b5", source: '第一段 <V of="panel.魔力" />。'}, {id: "b6", source: "- 一\n- 二"}]);
    });
});

describe("canon.rendering 输出 19：没登记的标签", () => {
    test("新写进去的拒收（unknown-tag）", () => {
        expect(rejected(writeText(world(), [BLOCK, '<Plot id="x" />']))).toEqual([{code: "unknown-tag", path: "init.text[b2]"}]);
    });

    test("条目里已经有规范写法相同的这个标签时放行（插件卸了以后还能写）；属性不同的照样拒收", () => {
        const base = injected(world(), [["b2", '<Plot id="x" />']]);
        expect(rejected(writeText(base, [BLOCK, '<Plot id="x" />', '又一处 <Plot  id="x"/>']))).toBe("ok");
        expect(rejected(writeText(base, [BLOCK, '<Plot id="x" />', '<Plot id="y" />']))).toEqual([{code: "unknown-tag", path: "init.text[b3]"}]);
    });

    test("作者看到“需要插件”，Agent 看到原样的标签，纯文字报 unknown-tag", () => {
        const base = injected(world(), [["b2", '前<Plot id="x" />后']]);
        expect(authorValues(base, at("ch5"), 1)).toEqual([{tag: "Plot", start: 1, needsPlugin: true}]);
        expect(agentBlocks(base, at("ch5"))[1]).toBe('前<Plot id="x" />后');
        const plain = renderEntryPlain(base, "e1", at("ch5"), "actual");
        if (plain === null || typeof plain === "string") throw new Error("no render");
        expect(plain.blocks[1]).toMatchObject({text: "前后", problems: ["unknown-tag"]});
    });
});

describe("canon.rendering 输出 5：三值逻辑", () => {
    const values: Record<string, unknown> = {"panel.真": true, "panel.假": false, "panel.未知": null, "panel.数": 5};
    const resolve: Resolve = (reference) => ({value: values[reference.path] ?? null});
    test.each([
        ["panel.数 > 3", true],
        ["panel.未知 > 3", null],
        ["panel.数 > '三'", null],
        ["!panel.未知", null],
        ["panel.假 && panel.未知", false],
        ["panel.真 && panel.未知", null],
        ["panel.真 || panel.未知", true],
        ["panel.假 || panel.未知", null],
        ["panel.未知 ? '是' : '否'", null],
        ["panel.数 === 5 ? '是' : '否'", "是"],
    ])("%s → %o", (source, expected) => {
        const parsed = parseExpression(source);
        if (!parsed.ok) throw new Error(source);
        expect(evaluate(parsed.expression, resolve).value).toBe(expected as never);
    });
});

describe("canon.rendering 场景 1：两种渲染与读不到的值（输出 6–9）", () => {
    const starts = (...tags: string[]) => tags.map((tag) => BLOCK.indexOf(tag));

    test("第 5 章末尾：作者的值表按标签的起点给值、显示名与千位分隔；Agent 读到带值写法", () => {
        const [magic, limit, condition] = starts('<V of="panel.魔力" />', '<V of="panel.魔力上限"', "<If");
        expect(authorValues(world(), at("ch5"))).toEqual([
            {tag: "V", start: magic!, path: "panel.魔力", entry: null, label: "魔力", raw: 3110, display: "3,110"},
            {tag: "V", start: limit!, path: "panel.魔力上限", entry: null, label: "魔力上限", raw: 12000, display: "12,000"},
            {tag: "If", start: condition!, result: true, taken: 0},
        ]);
        expect(agentBlocks(world(), at("ch5"))).toEqual(['魔力 <V of="panel.魔力">3110</V>/<V of="panel.魔力上限">12000</V>，<If test="panel.魔力 >= 1000" value="true">能变身<Else />变不了身</If>']);
    });

    test("第 1 章面板还没启用：作者看到未知与原因，没有生效的支；Agent 读到 null 加 unavailable，条件是 null", () => {
        const values = authorValues(world(), at("ch1"));
        expect(values.map((value) => [value.tag, "unavailable" in value ? value.unavailable : undefined])).toEqual([["V", "面板第 3 章起生效"], ["V", "面板第 3 章起生效"], ["If", "面板第 3 章起生效"]]);
        expect(values[0]).toMatchObject({raw: null, display: "未知", unknown: true});
        expect(values[2]).toMatchObject({result: null, taken: null});
        expect(agentBlocks(world(), at("ch1"))).toEqual(['魔力 <V of="panel.魔力" unavailable="面板第 3 章起生效">null</V>/<V of="panel.魔力上限" unavailable="面板第 3 章起生效">null</V>，<If test="panel.魔力 >= 1000" value="null">能变身<Else />变不了身</If>']);
    });

    test("条目引用补上这个位置的名字；源文里作者写的括注与源文逐字相同", () => {
        const base = world(['见<Ref id="e2" />（化名）<V of="panel.存款" />（未知）']);
        expect(agentBlocks(base, at("ch5"))).toEqual(['见<Ref id="e2" name="星瑾" />（化名）<V of="panel.存款">0</V>（未知）']);
    });
});

describe("canon.rendering 场景 3、输出 4、14：一块坏了", () => {
    test("存下来的旧数据过不了检查：这一块给纯文本与诊断，其余照常；改别的块照常写；交回合法文字后这一块被整段替换", () => {
        const broken = injected(world([BLOCK, "第三块"]), [["b3", "<div>旧</div>"]]);
        const forAuthor = renderEntryForAuthor(broken, "e1", at("ch5"), "actual");
        if (forAuthor === null || typeof forAuthor === "string") throw new Error("no render");
        expect(forAuthor.blocks.map((block) => ("error" in block ? block.error.code : "ok"))).toEqual(["ok", "ok", "unsupported-markdown"]);
        expect(forAuthor.blocks[2]).toMatchObject({id: "b3", error: {line: 1, column: 1}, text: "<div>旧</div>"});
        const agent = renderEntryForAgent(broken, "e1", at("ch5"), "actual");
        if (agent === null || typeof agent === "string") throw new Error("no render");
        expect(agent.blocks[2]).toMatchObject({id: "b3", text: "<div>旧</div>", error: {code: "unsupported-markdown"}});
        expect(rejected(writeText(broken, [BLOCK, "第三块改了", "<div>旧</div>"]))).toBe("ok");
        const fixed = ok(writeText(broken, [BLOCK, "第三块", "修好了"])).world;
        expect(textOf(fixed)[2]).toEqual({id: "b3", source: "修好了"});
    });
});

describe("canon.rendering 场景 6、输出 22：交回的文字去值", () => {
    test("渲染再去值得到源文；改了字与值以后去值，文字照改、字段照旧", () => {
        const base = world();
        const text = agentBlocks(base, at("ch5"))[0]!;
        expect(stripEntryText(text)).toBe(BLOCK);
        const edited = stripEntryText(text.replace("魔力 <V", "魔法力 <V").replace(">3110<", ">3000<"));
        expect(edited).toBe('魔法力 <V of="panel.魔力" />/<V of="panel.魔力上限" />，<If test="panel.魔力 >= 1000">能变身<Else />变不了身</If>');
        const after = ok(writeText(base, [edited])).world;
        expect(textOf(after)).toEqual([{id: "b1", source: edited}]);
        expect(after.line().engine.entry("e1", at("ch5"), "actual")).toMatchObject({namespaces: {panel: {fields: {魔力: {value: 3110}}}}});
    });
});

describe("canon.rendering 场景 7、输出 17：字面与转义", () => {
    const LITERAL = '写法是 `<V of="panel.魔力" />`';
    const TABLE = '| 状态 |\n| --- |\n| <If test="panel.魔力 > 0 || panel.存款 > 0">有<Else />无</If> |';

    test("代码里的标签与不成标签的 `<A`：写得进去，作者没有值，Agent 读到的与源文相同", () => {
        const base = ok(writeText(world(), [LITERAL, "评级 <A 级"])).world;
        expect([authorValues(base, at("ch5"), 0), authorValues(base, at("ch5"), 1)]).toEqual([[], []]);
        expect(agentBlocks(base, at("ch5"))).toEqual([LITERAL, "评级 <A 级"]);
    });

    test("少了收尾的拒收；写进代码里的通过，纯文字报 syntax", () => {
        expect(rejected(writeText(world(), ['魔力 <V of="panel.魔力"']))).toEqual([{code: "tag-malformed", path: "init.text[b1]"}]);
        const base = ok(writeText(world(), ['`<V of="panel.魔力"`'])).world;
        const plain = renderEntryPlain(base, "e1", at("ch5"), "actual");
        if (plain === null || typeof plain === "string") throw new Error("no render");
        expect(plain.blocks[0]!.problems).toEqual(["syntax"]);
    });

    test("表格单元格里的条件：单元格不被切开，条件照常算", () => {
        const base = ok(writeText(world(), [TABLE])).world;
        expect(authorValues(base, at("ch5"))).toEqual([{tag: "If", start: TABLE.indexOf("<If"), result: true, taken: 0}]);
        expect(agentBlocks(base, at("ch5"))[0]).toContain('value="true">有<Else />无</If> |');
        const plain = renderEntryPlain(base, "e1", at("ch5"), "actual");
        if (plain === null || typeof plain === "string") throw new Error("no render");
        expect(plain.blocks[0]!.text).toBe("| 状态 |\n| --- |\n| 有 |");
    });
});

describe("canon.rendering 输出 16：按给的源文字渲染", () => {
    const DRAFT = '# 近况\n\n魔力 <V of="panel.魔力" />，同行的是 <Ref id="e2" />。';

    const sourceBlock = (base: World, source: string, chapter: string, mode: "actual" | "planned" = "actual") => {
        const rendered = renderSourceForAuthor(base, "e1", source, at(chapter), mode);
        if (rendered === null || typeof rendered === "string") throw new Error("no render");
        return rendered;
    };

    test("没存下的源文字按条目此刻的数据渲染成一块：源文与值表；世界不变", () => {
        const base = world();
        const rendered = sourceBlock(base, DRAFT, "ch5");
        expect([rendered.version, rendered.position, rendered.mode]).toEqual([base.version, at("ch5"), "actual"]);
        expect(rendered.blocks).toEqual([{id: "source", source: DRAFT, values: [
            {tag: "V", start: DRAFT.indexOf("<V"), path: "panel.魔力", entry: null, label: "魔力", raw: 3110, display: "3,110"},
            {tag: "Ref", start: DRAFT.indexOf("<Ref"), id: "e2", name: "星瑾", deleted: false},
        ]}]);
        expect([base.version, textOf(base)]).toEqual([2, [{id: "b1", source: BLOCK}]]);
    });

    test("读的是给的位置上的数据：第 1 章面板还没启用，值是未知", () => {
        expect(sourceBlock(world(), '魔力 <V of="panel.魔力" />', "ch1").blocks[0]).toMatchObject({values: [{tag: "V", unknown: true, unavailable: "面板第 3 章起生效"}]});
    });

    test("过不了写入检查的源文字：照出错的块给纯文本与行、列（按给的源文字算）", () => {
        const source = '第一段\n\n魔力 <V of="panel.魔力"';
        expect(sourceBlock(world(), source, "ch5").blocks).toEqual([{id: "source", error: expect.objectContaining({code: "tag-malformed", line: 3, column: 4}), text: source}]);
    });

    test("条目不存在是 null；那一章不在是 chapter-not-found；那条线不在是 line-not-found", () => {
        expect(renderSourceForAuthor(world(), "nobody", "字", at("ch5"), "actual")).toBeNull();
        expect(renderSourceForAuthor(world(), "e1", "字", at("ch9"), "actual")).toBe("chapter-not-found");
        expect(renderSourceForAuthor(world(), "e1", "字", {...at("ch5"), line: "nowhere"}, "actual")).toBe("line-not-found");
    });

    test("读的是给的模式：别的条目的字段按实际与按计划各是各的值；引用不存在的条目写“已删除的条目”", () => {
        const base = cast([]);
        const values = (mode: "actual" | "planned") => {
            const block = sourceBlock(base, '存款 <V entry="e2" of="panel.存款" />，同行的是 <Ref id="e404" />', "ch3", mode).blocks[0]!;
            if (!("values" in block)) throw new Error("error block");
            return block.values.map((value) => ("raw" in value ? value.raw : "name" in value ? [value.name, value.deleted] : null));
        };
        expect([values("actual"), values("planned")]).toEqual([[800, ["已删除的条目", true]], [900, ["已删除的条目", true]]]);
    });

    test("解析的结果不留：同一段没存过的源文字每次都重新解析；与存下来的块相同时用留着的那一份", () => {
        const draft = '只在预览里出现过的一段 <V of="panel.魔力" />';
        sourceBlock(world(), draft, "ch5");
        expect(analyzeDraft(draft)).not.toBe(analyzeDraft(draft));
        renderEntryForAuthor(world(), "e1", at("ch5"), "actual");
        expect(analyzeDraft(BLOCK)).toBe(analyzeBlock(BLOCK));
    });

    test("没登记的标签按写入时的基线查：条目里没有的照出错的块给（写入会拒收），已有的给“需要插件”", () => {
        expect(sourceBlock(world(), '新写的 <Plot id="x" />', "ch5").blocks[0]).toMatchObject({error: {code: "unknown-tag", line: 1, column: 5}});
        expect(sourceBlock(injected(world(), [["b2", '<Plot id="x" />']]), '新写的 <Plot id="x" />', "ch5").blocks[0]).toEqual({id: "source", source: '新写的 <Plot id="x" />', values: [{tag: "Plot", start: 4, needsPlugin: true}]});
    });

    test("嵌套深到读不出结构的源文字（几万层引用）：照出错的块给，不抛；超过一块的长度上限照常渲染（上限只管写入）", () => {
        const deep = "> ".repeat(25_000);
        expect(sourceBlock(world(), deep, "ch5").blocks).toEqual([{id: "source", error: expect.objectContaining({code: "unsupported-markdown", line: 1}), text: deep}]);
        const long = `${"字".repeat(52_000)}<V of="panel.魔力" />`;
        expect(sourceBlock(world(), long, "ch5").blocks[0]).toMatchObject({id: "source", values: [{tag: "V", raw: 3110}]});
    });
});

describe("canon.rendering 输出 6、7、9：读不到的值、引用与显示名", () => {
    const LINK = {id: "test.link", label: "关系", namespace: "link", version: 1, instanceFields: true, fields: [{id: "友", label: "朋友", kind: "ref"}, {id: "n", label: "n", kind: "number"}]} as const;
    /** 星瑕带引用字段与一个实例字段；星瑾被她引用。 */
    function linked(): World {
        const order = new ChapterOrder(["ch1"]);
        const base = {order, registry: buildRegistry([LINK as never]), reductions: () => undefined, chapterText: () => "", digest: options().digest};
        const person = (tmp: string, name: string, data: Entry["init"]["data"], text: string[]): Entry => ({id: tmp, type: "人物", parent: null, folder: "", order: 0, init: {name, aliases: [], summary: "", text: text.map((source, index) => ({id: `b${String(index + 1)}`, source})), data}});
        const jin = ok(World.empty(base).publish({requestId: id(), by: author, what: "opening", title: "开局", baseVersion: 0, puts: [{ref: {kind: "entry", id: "tmp:j"}, after: person("tmp:j", "星瑾", {}, [])}]}, "t"));
        return ok(jin.world.publish({requestId: id(), by: author, what: "opening", title: "开局", baseVersion: 1, puts: [{ref: {kind: "entry", id: "tmp:x"}, after: person("tmp:x", "星瑕", {link: {type: LINK.id, version: 1, enabled: true, declared: [{id: "额外", label: "额 外", kind: "number"}], fields: {友: {ref: "e1"}, n: 1, 额外: 7}}}, ['朋友 <V of="link.友" />，额外 <V of="link.额外" />，n <V of="link.n" />'])}]}, "t")).world;
    }
    const position = {kind: "chapter" as const, chapter: "ch1", edge: "end" as const, line: "main"};

    test("给作者：引用字段的显示文字是当时的名字，id 不在显示文字里；实例字段带显示名", () => {
        const values = authorValues(linked(), position, 0, "e2");
        expect(values[0]).toMatchObject({path: "link.友", display: "星瑾", ref: {id: "e1", name: "星瑾", deleted: false}});
        expect(values[1]).toMatchObject({path: "link.额外", label: "额 外", raw: 7, display: "7"});
    });

    test("给 Agent：显示名与 id 不同时带 label，相同时不带；读取结果里也有显示名", () => {
        const base = linked();
        expect(agentBlocks(base, position, "actual", "e2")).toEqual(['朋友 <V of="link.友" label="朋友">{"ref":"e1"}</V>，额外 <V of="link.额外" label="额 外">7</V>，n <V of="link.n">1</V>']);
        expect(base.line().engine.entry("e2", position, "actual")).toMatchObject({namespaces: {link: {fields: {额外: {label: "额 外", value: 7}, n: {value: 1}}}}});
    });

    test("类型不在：作者看到未知与原因，Agent 看到 null 加 unavailable；存下的值不丢", () => {
        const base = linked();
        const gone = base.withOptions({...base.options, registry: buildRegistry([])});
        expect(agentBlocks(gone, position, "actual", "e2")[0]).toContain('<V of="link.n" unavailable="类型不可用">null</V>');
        expect(authorValues(gone, position, 0, "e2")[2]).toMatchObject({unknown: true, unavailable: "类型不可用"});
        expect(gone.line().engine.entry("e2", position, "actual")).toMatchObject({namespaces: {link: {readOnly: "component-unknown", fields: {n: {value: 1}}}}});
    });

    test("给 Agent（列表字段）：显示名与 id 不同时带 label，列表元素的地址不带", () => {
        expect(agentBlocks(plainWorld(['<V of="rel.清单" /> <V of="rel.清单[x1].数量" />']), at("ch1"))).toEqual(['<V of="rel.清单" label="随身物品">[{"id":"x1","label":"短剑","数量":1}]</V> <V of="rel.清单[x1].数量">1</V>']);
    });

    test("版本对不上：照常给值", () => {
        const base = linked();
        const moved = base.withOptions({...base.options, registry: buildRegistry([{...LINK, version: 2} as never])});
        expect(agentBlocks(moved, position, "actual", "e2")[0]).toContain('<V of="link.n">1</V>');
    });
});

/** 图片字段与文字字段各一：渲染里的图片项靠它们。 */
const PIC: ComponentDeclaration = {
    id: "test.pic",
    label: "图",
    namespace: "pic",
    version: 1,
    fields: [{id: "图", label: "图", kind: "image"}, {id: "路径", label: "路径", kind: "text"}],
};

/**
 * 一群人，e1 星瑕的主文字是 `blocks`：e2 星瑾第 2 章末尾存款 800（第 3 章的计划里是 900）；e3 第 3 章才出场；e4 已删除；
 * e5 的面板已去掉。版本 2。
 */
function cast(blocks: string[]): World {
    const base = {...options(), registry: buildRegistry([PANEL, PERSON, PIC])};
    const panel = (存款: number, extra: Record<string, unknown> = {}) => ({type: PANEL.id, version: 1, enabled: true, ...extra, fields: {存款, 魔力上限: null, 魔力: null, 物品: []}});
    const person = (tmp: string, name: string, data: Entry["init"]["data"], extra: Partial<Entry> = {}, text: string[] = []): Entry => ({id: tmp, type: "人物", parent: null, folder: "", order: 0, ...extra, init: {name, aliases: [], summary: "", text: text.map((source, index) => ({id: `b${String(index + 1)}`, source})), data}});
    const first = ok(World.empty(base).publish({requestId: id(), by: author, what: "opening", title: "开局", baseVersion: 0, puts: [
        {ref: {kind: "entry", id: "tmp:1"}, after: person("tmp:1", "星瑕", {panel: panel(5), pic: {type: PIC.id, version: 1, enabled: true, fields: {图: {"图片": "assets/a.png", "说明": "原身"}, 路径: "assets/b.png"}}}, {}, blocks)},
        {ref: {kind: "entry", id: "tmp:2"}, after: person("tmp:2", "星瑾", {panel: panel(500)})},
        {ref: {kind: "entry", id: "tmp:3"}, after: person("tmp:3", "阿七", {panel: panel(1)}, {appears: {kind: "chapter", chapter: "ch3", key: 0}})},
        {ref: {kind: "entry", id: "tmp:4"}, after: person("tmp:4", "旧人", {panel: panel(1)})},
        {ref: {kind: "entry", id: "tmp:5"}, after: person("tmp:5", "无面板", {panel: panel(1, {removed: true})})},
    ]} as WriteRequest, "t"));
    const change = (tmp: string, kind: "written" | "plan", chapter: string, value: number) => ({ref: {kind: "change" as const, id: tmp}, after: {id: tmp, kind, text: tmp, at: {kind: "chapter", chapter, key: 10}, told: [], involves: ["e2"], lines: [], links: [], patches: [{op: "set", at: {entry: "e2", path: "panel.存款"}, value}], status: "active", by: author}});
    return ok(first.world.publish({requestId: id(), by: author, what: "bookkeeping", title: "收尾", baseVersion: 1, puts: [
        {ref: {kind: "entry", id: "e4"}, after: {...structuredClone(first.world.data.entries.get("e4")!), deleted: true}},
        change("tmp:now", "written", "ch2", 800),
        change("tmp:later", "plan", "ch3", 900),
    ]} as WriteRequest, "t")).world;
}

describe("canon.rendering 输出 5、6：引用别的条目与读不到的值", () => {
    test("V 的 entry 取那个条目在同一位置、同一模式上的值", () => {
        const base = cast(['<V entry="e2" of="panel.存款" />']);
        const value = (chapter: string, mode: "actual" | "planned" = "actual") => agentBlocks(base, at(chapter), mode)[0];
        expect([value("ch1"), value("ch2"), value("ch3"), value("ch3", "planned")]).toEqual(["500", "800", "800", "900"].map((n) => `<V entry="e2" of="panel.存款">${n}</V>`));
        expect(authorValues(base, at("ch3"), 0, "e1", "planned")[0]).toMatchObject({entry: "e2", raw: 900, display: "900"});
    });

    test.each([
        ["尚未出场", '<V entry="e3" of="panel.存款" />'],
        ["已删除", '<V entry="e4" of="panel.存款" />'],
        ["没有这个字段", '<V of="panel.不存在" />'],
        ["命名空间已去掉", '<V entry="e5" of="panel.存款" />'],
    ])("%s：Agent 读到 null 加 unavailable，作者看到未知与原因，同一块里读得到的值照常", (_name, tag) => {
        const base = cast([`前 ${tag} 后 <V of="panel.存款" />`]);
        const [text] = agentBlocks(base, at("ch1"));
        const opening = tag.slice(0, -3).replace(/[.[\]()]/gu, "\\$&");
        expect(text).toMatch(new RegExp(`^前 ${opening} unavailable="[^"]+">null</V> 后 <V of="panel\\.存款">5</V>$`, "u"));
        const values = authorValues(base, at("ch1"));
        expect(values[0]).toMatchObject({raw: null, display: "未知", unknown: true});
        expect(typeof (values[0] as {unavailable?: unknown}).unavailable === "string").toBe(true);
        expect(values[1]).toMatchObject({path: "panel.存款", raw: 5});
    });

    test("读不到的值参与判断：结果是未知，没有生效的支", () => {
        const base = cast(["<If test=\"ref('e3').panel.存款 >= 1\">有<Else />无</If>"]);
        expect(agentBlocks(base, at("ch1"))[0]).toContain('value="null"');
        expect(authorValues(base, at("ch1"))[0]).toMatchObject({tag: "If", result: null, taken: null, unavailable: expect.any(String)});
    });
});

describe("canon.rendering 输出 7、8：值表各项与带值写法", () => {
    test("图片：Image 标签给路径与说明；值是图片的 V 带图片的路径与说明", () => {
        const values = authorValues(cast(['<Image src="assets/c.png" alt="立绘" />\n\n<V of="pic.图" />']), at("ch1"));
        expect(values[0]).toEqual({tag: "Image", start: 0, path: "assets/c.png", caption: "立绘"});
        expect(values[1]).toMatchObject({tag: "V", path: "pic.图", image: {path: "assets/a.png", caption: "原身"}});
    });

    test("图片字段写成 Image of：作者拿到字段里的路径，Agent 读到 path", () => {
        const base = cast(['<Image of="pic.图" alt="立绘" />']);
        expect(authorValues(base, at("ch1"))).toEqual([{tag: "Image", start: 0, path: "assets/a.png", caption: "立绘"}]);
        expect(agentBlocks(base, at("ch1"))).toEqual(['<Image of="pic.图" alt="立绘" path="assets/a.png" />']);
    });

    test("图片值写成 {\"图片\": 路径, \"说明\": 文字}", () => {
        expect(agentBlocks(cast(['<V of="pic.图" />']), at("ch1"))).toEqual(['<V of="pic.图">{"图片":"assets/a.png","说明":"原身"}</V>']);
    });

    test("条目引用：当时的名字；已删除的条目写“已删除的条目”并标 deleted", () => {
        const base = cast(['见<Ref id="e2" />与<Ref id="e4" />']);
        expect(authorValues(base, at("ch1"))).toEqual([
            {tag: "Ref", start: 1, id: "e2", name: "星瑾", deleted: false},
            {tag: "Ref", start: 17, id: "e4", name: "已删除的条目", deleted: true},
        ]);
        expect(agentBlocks(base, at("ch1"))).toEqual(['见<Ref id="e2" name="星瑾" />与<Ref id="e4" name="已删除的条目" />']);
    });

    test("转义的、行内代码与代码块里的标签原样输出，值表里没有它们", () => {
        const source = '他说 \\<V of="panel.存款" />，`<V of="panel.存款" />` 与 <V of="panel.存款" />\n\n```\n<V of="panel.存款" />\n```';
        expect(agentBlocks(cast([source]), at("ch1"))).toEqual(['他说 \\<V of="panel.存款" />，`<V of="panel.存款" />` 与 <V of="panel.存款">5</V>\n\n```\n<V of="panel.存款" />\n```']);
        expect(authorValues(cast([source]), at("ch1"))).toHaveLength(1);
    });

    test("没生效的支里的标签照样有项、照样求值；Else 与 </If> 没有项", () => {
        const source = '<If test="panel.存款 > 100">多<ElseIf test="panel.存款 > 1" /><V of="panel.存款" /><Else />无</If>';
        const values = authorValues(cast([source]), at("ch1"));
        expect(values.map((value) => [value.tag, "result" in value ? value.result : "raw" in value ? value.raw : null])).toEqual([["If", false], ["ElseIf", true], ["V", 5]]);
        expect(values[0]).toMatchObject({taken: 1});
        expect(agentBlocks(cast([source]), at("ch1"))).toEqual(['<If test="panel.存款 > 100" value="false">多<ElseIf test="panel.存款 > 1" value="true" /><V of="panel.存款">5</V><Else />无</If>']);
    });
});

/** 星瑕存款 1000，第 3 章花 2000：套不上，存款从这里起不完整。版本 3。 */
function strained(blocks: string[]): World {
    const base = cast(blocks);
    const withDeposit = (world: World, 存款: number) => {
        const entry = structuredClone(world.data.entries.get("e1")!);
        entry.init.data.panel!.fields.存款 = 存款;
        return {ref: {kind: "entry" as const, id: "e1"}, after: entry};
    };
    const spend = {id: "tmp:spend", kind: "written", text: "花两千", at: {kind: "chapter", chapter: "ch3", key: 10}, told: [], involves: ["e1"], lines: [], links: [], patches: [{op: "add", at: {entry: "e1", path: "panel.存款"}, value: -2000}], status: "active", by: author};
    // 先在够花的初值下写入这笔，再把初值改小：改初值不拒收，这笔从此套不上。
    const spent = ok(base.publish({requestId: id(), by: author, what: "bookkeeping", title: "花两千", baseVersion: base.version, puts: [withDeposit(base, 40000), {ref: {kind: "change", id: "tmp:spend"}, after: spend}]} as WriteRequest, "t")).world;
    return ok(spent.publish({requestId: id(), by: author, what: "edit", title: "改初值", baseVersion: spent.version, puts: [withDeposit(spent, 1000)]} as WriteRequest, "t")).world;
}

describe("canon.rendering 输出 9：不完整的装饰", () => {
    test("地址的值不完整：带 incomplete（变更 id 与原因码）；算出来的结果依赖它时也带", () => {
        const base = strained(['<V of="panel.存款" /> 与 <V expr="panel.存款 >= 500" />']);
        expect(agentBlocks(base, at("ch4"))[0]).toMatch(/^<V of="panel\.存款" incomplete="c\d+ [a-z-]+">1000<\/V> 与 <V expr="panel\.存款 >= 500" incomplete="c\d+ [a-z-]+">true<\/V>$/u);
        expect(authorValues(base, at("ch4"))[0]).toMatchObject({raw: 1000, incomplete: {change: expect.any(String), reason: expect.any(String)}});
        expect(agentBlocks(base, at("ch2"))[0]).toBe('<V of="panel.存款">1000</V> 与 <V expr="panel.存款 >= 500">true</V>');
    });
});

const REL: ComponentDeclaration = {
    id: "test.rel",
    label: "关系",
    namespace: "rel",
    version: 1,
    fields: [
        {id: "对象", label: "对象", kind: "ref"},
        {id: "关系", label: "关系", kind: "list", keyedBy: "ref", item: [{id: "态度", label: "态度", kind: "text"}, {id: "起因", label: "起因", kind: "ref"}]},
        {id: "清单", label: "随身物品", kind: "list", item: [{id: "数量", label: "数量", kind: "number"}]},
    ],
};

/**
 * 纯文字渲染的场地：e1 星瑕的主文字是 `blocks`，别名“小瑕”“阿瑕”，`rel.对象` 指 e2，`rel.关系` 有一行对 e2（崇敬，起因 e3），
 * `rel.清单` 有一行作者写的“短剑”，`pic.图` 的说明是“原身”；e2 星瑾；e3 阿七第 3 章才出场；e4 旧人已删除。
 */
function plainWorld(blocks: string[]): World {
    const base = {...options(), registry: buildRegistry([PANEL, PERSON, PIC, REL])};
    const person = (tmp: string, name: string, extra: Partial<Entry> = {}, text: string[] = []): Entry => ({id: tmp, type: "人物", parent: null, folder: "", order: 0, ...extra, init: {name, aliases: [], summary: "", text: text.map((source, index) => ({id: `b${String(index + 1)}`, source})), data: {}}});
    const first = ok(World.empty(base).publish({requestId: id(), by: author, what: "opening", title: "开局", baseVersion: 0, puts: [
        {ref: {kind: "entry", id: "tmp:1"}, after: person("tmp:1", "星瑕", {}, blocks)},
        {ref: {kind: "entry", id: "tmp:2"}, after: person("tmp:2", "星瑾")},
        {ref: {kind: "entry", id: "tmp:3"}, after: person("tmp:3", "阿七", {appears: {kind: "chapter", chapter: "ch3", key: 0}})},
        {ref: {kind: "entry", id: "tmp:4"}, after: person("tmp:4", "旧人")},
    ]} as WriteRequest, "t"));
    const xia = first.world.data.entries.get("e1")!;
    const data = {
        rel: {type: REL.id, version: 1, enabled: true, fields: {对象: {ref: "e2"}, 关系: [{id: "e2", 态度: "崇敬", 起因: {ref: "e3"}}], 清单: [{id: "x1", label: "短剑", 数量: 1}]}},
        pic: {type: PIC.id, version: 1, enabled: true, fields: {图: {图片: "assets/a.png", 说明: "原身"}, 路径: "assets/b.png"}},
    };
    return ok(first.world.publish({requestId: id(), by: author, what: "bookkeeping", title: "补数据", baseVersion: 1, puts: [
        {ref: {kind: "entry", id: "e1"}, after: {...structuredClone(xia), init: {...structuredClone(xia.init), aliases: ["小瑕", "阿瑕"], data}}},
        {ref: {kind: "entry", id: "e4"}, after: {...structuredClone(first.world.data.entries.get("e4")!), deleted: true}},
    ]} as WriteRequest, "t")).world;
}

function plainBlocks(base: World, options: PlainOptions = {}): PlainBlock[] {
    const rendered = renderEntryPlain(base, "e1", at("ch1"), "actual", options);
    if (rendered === null || typeof rendered === "string") throw new Error("no render");
    return [...rendered.blocks];
}

const shape = (block: PlainBlock) => ({text: block.text, reads: [...block.reads].sort(), mentions: [...block.mentions].sort(), problems: [...block.problems].sort() as string[]});

describe("canon.rendering 输出 15、场景 5：纯文字的渲染", () => {
    const REVERED = "rel.关系[e2].态度 == '崇敬'";
    test.each([
        ["引用字段的值写名字，<Ref> 写名字", '<V of="rel.对象" />与<Ref id="e2" />', {text: "星瑾与星瑾", reads: [], mentions: ["e2"], problems: []}],
        ["别的条目的字段：读了它", '<V entry="e2" of="entry.name" />', {text: "星瑾", reads: ["e2"], mentions: [], problems: []}],
        ["按条目选出的一行的子字段：读了那个条目", '<V of="rel.关系[e2].态度" />', {text: "崇敬", reads: ["e2"], mentions: [], problems: []}],
        ["行里的引用：写名字", '<V of="rel.关系[e2].起因" />', {text: "阿七", reads: ["e2"], mentions: ["e3"], problems: []}],
        ["取出单个列表行：没有写法", '前<V of="rel.关系[e2]" />后', {text: "前后", reads: ["e2"], mentions: [], problems: ["raw-value"]}],
        ["引别的条目的一块原文", '<V entry="e2" of="text[b1]" />', {text: "", reads: ["e2"], mentions: [], problems: ["quoted-block"]}],
        ["引本条目一块原文：不写源文", '前<Ref id="e2" /><V of="rel.对象" />，引：<V of="text[b1]" />后', {text: "前星瑾星瑾，引：后", reads: [], mentions: ["e2"], problems: ["quoted-block"]}],
        ["条件写生效的那一支，算出来的引用写名字", `<If test="${REVERED}"><V of="rel.对象" /><Else /><V of="rel.清单" /></If>`, {text: "星瑾", reads: ["e2"], mentions: ["e2"], problems: []}],
        ["没生效的支里读到的条目照样记进 reads，读不到也不报（那一支不写）", `<If test="${REVERED}">有<Else /><V entry="e3" of="entry.name" /></If>`, {text: "有", reads: ["e2", "e3"], mentions: [], problems: []}],
        ["判断因读不到值而未知：同取值一样报 unavailable，不写文字", "<If test=\"ref('e3').entry.name == '阿七'\">有<Else />无</If>", {text: "", reads: ["e3"], mentions: [], problems: ["unavailable"]}],
        ["没有一支生效：不写", "前<If test=\"rel.关系[e2].态度 == '鄙视'\">有</If>后", {text: "前后", reads: ["e2"], mentions: [], problems: []}],
        ["以引用为键的列表：行写名字，不用读取时补的 label", '<V of="rel.关系" />', {text: "星瑾", reads: [], mentions: ["e2"], problems: []}],
        ["作者写的列表：行写 label", '<V of="rel.清单" />', {text: "短剑", reads: [], mentions: [], problems: []}],
        ["字符串列表：顿号连起来", '又名<V of="entry.aliases" />', {text: "又名小瑕、阿瑕", reads: [], mentions: [], problems: []}],
        ["图片字段：写说明", '<V of="pic.图" />', {text: "原身", reads: [], mentions: [], problems: []}],
        ["图片标签：写说明", '<Image src="a.png" alt="脚印图" />后面<Image of="pic.图" alt="x" />', {text: "脚印图后面x", reads: [], mentions: [], problems: []}],
        ["还没出场：读不到值", '<V entry="e3" of="entry.name" />', {text: "", reads: ["e3"], mentions: [], problems: ["unavailable"]}],
        ["已删除：名字写“已删除的条目”，读它的值读不到", '<Ref id="e4" />，<V entry="e4" of="entry.name" />', {text: "已删除的条目，", reads: ["e4"], mentions: ["e4"], problems: ["unavailable"]}],
        ["行内代码里的标签：照原文，读到的条目照记，报 syntax", '见 `<V entry="e2" of="panel.秘密" />`', {text: '见 `<V entry="e2" of="panel.秘密" />`', reads: ["e2"], mentions: [], problems: ["syntax"]}],
        ["转义的 <Ref>：照原文，记进 mentions，报 syntax", '见 \\<Ref id="e2" />', {text: '见 \\<Ref id="e2" />', reads: [], mentions: ["e2"], problems: ["syntax"]}],
        ["代码里不成标签的内置标签名：报 syntax", '`<V of="panel.魔力"`', {text: '`<V of="panel.魔力"`', reads: [], mentions: [], problems: ["syntax"]}],
    ])("%s", (_name, block, expected) => {
        expect(shape(plainBlocks(plainWorld([block]))[0]!)).toEqual(expected);
    });

    test("调用方给名字：<Ref>、引用的值、以引用为键的列表行都经它写", () => {
        const base = plainWorld(['<Ref id="e2" />、<V of="rel.对象" />、<V of="rel.关系" />']);
        const block = plainBlocks(base, {entryName: (target) => (target === "e2" ? "旅人" : null)})[0]!;
        expect(block.text).toBe("旅人、旅人、旅人");
        expect(block.mentions).toEqual(["e2"]);
    });

    const context: PlainContext = {resolve: () => ({value: null}), entryName: () => null, isEntry: () => true};

    test("块出错（存下来的旧数据过不了检查）：原样源文，标 syntax，不给读取与名字", () => {
        expect(renderBlockPlain("b1", '<div><Ref id="e2" /></div>', context)).toEqual({id: "b1", text: '<div><Ref id="e2" /></div>', reads: [], mentions: [], problems: ["syntax"]});
    });

    test("判断读得到、值是空的：写“未知”，不报问题", () => {
        expect(renderBlockPlain("b1", '前<If test="panel.空 > 1">有<Else />无</If>后', context)).toEqual({id: "b1", text: "前未知后", reads: [], mentions: [], problems: []});
    });

    test("没登记的标签：不写文字，报 unknown-tag", () => {
        expect(renderBlockPlain("b1", '前<Plot id="x" />后', context)).toEqual({id: "b1", text: "前后", reads: [], mentions: [], problems: ["unknown-tag"]});
    });
});

/** 一条第 4 章的写下或计划的变更，补丁整段替换星瑕的 b1。 */
const textChange = (tmp: string, value: string, status: StoryChange["status"] = "active", extra: Array<StoryChange["patches"][number]> = []) => ({ref: {kind: "change" as const, id: tmp}, after: {id: tmp, kind: "written", text: tmp, at: {kind: "chapter", chapter: "ch4", key: 0}, told: [], involves: ["e1"], lines: [], links: [], patches: [...extra, {op: "set", at: {entry: "e1", path: "text[b1]"}, value}], status, by: author}}) as WriteRequest["puts"][number];

const publishPuts = (base: World, puts: WriteRequest["puts"]) => base.publish({requestId: id(), by: author, what: "edit", title: "改", baseVersion: base.version, puts}, "t");

/**
 * 存下一条补丁文字过不了现在的检查的变更（旧数据、卸了插件）：先用“占位”写下，再把最后一次修订里的“占位”换成 `source` 重放。
 */
function storedChange(base: World, source: string, status: StoryChange["status"]): {readonly world: World; readonly id: string} {
    const written = ok(publishPuts(base, [textChange("tmp:old", "占位", status)]));
    const last = JSON.parse(JSON.stringify(written.world.revisions.at(-1)).replaceAll("占位", JSON.stringify(source).slice(1, -1)));
    return {world: World.replay([...written.world.revisions.slice(0, -1), last], base.options), id: written.ids["tmp:old"]!};
}

const editsOf = (base: World, ops: EntryOp[]): EntryEdits => ({requestId: id(), by: author, what: "edit", title: "改", baseVersion: base.version, ops} as EntryEdits);

describe("canon.rendering 输出 1、18、19（审查补）：规范化与基线的边界", () => {
    test("editEntries 的整段替换、替换、增块、新建都存规范写法", () => {
        const base = world(["甲乙"]);
        const set = ok(editEntries(base, editsOf(base, [{op: "set", at: {entry: "e1", path: "text[b1]"}, value: '名 <V of="entry.name"/>'}]), "t"));
        expect(textOf(set.world)[0]!.source).toBe('名 <V of="entry.name" />');
        const replaced = ok(editEntries(base, editsOf(base, [{op: "replace", at: {entry: "e1", path: "text[b1]"}, find: "甲", with: '<V of="entry.name"/>'}]), "t"));
        expect(textOf(replaced.world)[0]!.source).toBe('<V of="entry.name" />乙');
        const added = ok(editEntries(base, editsOf(base, [{op: "addBlock", entry: "e1", source: '<Ref  id="e2"/>', after: "b1"}]), "t"));
        expect(textOf(added.world).map((block) => block.source)).toEqual(["甲乙", '<Ref id="e2" />']);
        const created = ok(editEntries(base, editsOf(base, [{op: "create", id: "tmp:n", entry: {name: "乙", kind: "人物", text: ['<V of="entry.name"/>']}} as EntryOp]), "t"));
        expect(created.world.data.entries.get(created.ids["tmp:n"]!)!.init.text.map((block) => block.source)).toEqual(['<V of="entry.name" />']);
    });

    test("开头几个 BOM 都去掉：直接发布与 editEntries 存下同一份", () => {
        const bom = String.fromCharCode(0xfeff);
        const base = world(["甲"]);
        expect(textOf(ok(writeText(base, [`${bom}${bom}正文`])).world)[0]!.source).toBe("正文");
        expect(textOf(ok(editEntries(base, editsOf(base, [{op: "set", at: {entry: "e1", path: "text[b1]"}, value: `${bom}${bom}正文`}]), "t")).world)[0]!.source).toBe("正文");
    });

    test("规范化不改作者签过的请求：签名按原样的请求算，含非规范写法的照常发布", () => {
        const empty = World.empty({...options(), project: PROJECT, verifyAuthorSource: verify});
        const opened = ok(empty.publish({requestId: id(), by: author, what: "opening", title: "开局", baseVersion: 0, puts: [{ref: {kind: "entry", id: "tmp:e"}, after: {id: "tmp:e", type: "人物", parent: null, folder: "", order: 0, init: {name: "人", aliases: [], summary: "", text: [{id: "b1", source: "原来"}], data: {}}}}]}, "t")).world;
        const entry = structuredClone(opened.data.entries.get("e1")!);
        entry.init.text = [{id: "b1", source: '同行 <Ref id="e1"/>'}];
        const request: WriteRequest = {requestId: id(), by: author, what: "edit", title: "定", baseVersion: opened.version, puts: [{ref: {kind: "entry", id: "e1"}, after: entry}, {ref: {kind: "decision", id: "tmp:d"}, after: {id: "tmp:d", text: "第几章揭开", status: "decided", conclusion: "第 2 章", about: [], hints: []}}]} as WriteRequest;
        const published = ok(opened.publish({...request, authorizations: [sign(request, "tmp:d", "new→decided")]}, "t"));
        expect(published.world.data.entries.get("e1")!.init.text[0]!.source).toBe('同行 <Ref id="e1" />');
    });

    test("补偿修订照原样恢复改前的文字：旧文字不是规范写法也不改写", () => {
        const old = injected(world(), [["b2", '<Ref  id="e2"/>']]);
        const edited = ok(writeText(old, [BLOCK, "新的"]));
        const reverted = ok(edited.world.revert(edited.revision.id, false, {requestId: id(), by: author}, "t"));
        expect(textOf(reverted.world)[1]).toEqual({id: "b2", source: '<Ref  id="e2"/>'});
    });

    test("变更里的整段替换：没登记的标签按基线放行；基线收生效的变更里的标签，不收撤回的", () => {
        const withPlot = injected(world(), [["b2", '<Plot id="x" />']]);
        expect(rejected(publishPuts(withPlot, [textChange("tmp:a", '<Plot id="x" />')]))).toBe("ok");
        expect(rejected(publishPuts(withPlot, [textChange("tmp:a", '<Plot id="y" />')]))).toEqual([{code: "unknown-tag", path: "patches[0]"}]);
        expect(rejected(writeText(storedChange(world(), '<Plot id="z" />', "active").world, [BLOCK, '<Plot id="z" />']))).toBe("ok");
        expect(rejected(writeText(storedChange(world(), '<Plot id="z" />', "undone").world, [BLOCK, '<Plot id="z" />']))).toEqual([{code: "unknown-tag", path: "init.text[b2]"}]);
    });

    test("基线只认自闭合的写法：已有 <Plot id=\"x\" /> 时写带内容的 <Plot id=\"x\">…</Plot> 照样拒收；旧块里非规范的没登记标签 Agent 看到原样", () => {
        const base = injected(world(), [["b2", '<Plot  id="x"/>']]);
        expect(rejected(writeText(base, [BLOCK, '<Plot  id="x"/>', '<Plot id="x">作者打的字</Plot>']))).toEqual([{code: "unknown-tag", path: "init.text[b3]"}]);
        expect(agentBlocks(base, at("ch5"))[1]).toBe('<Plot  id="x"/>');
    });

    test("原样留着的旧补丁不再查，按内容认：前面插一条别的补丁也算原样，文字不被改写；撤回的变更重新生效要查", () => {
        const stored = storedChange(world(), "<div>旧</div>", "active");
        const change = structuredClone(stored.world.data.changes.get(stored.id)!);
        const extra = {op: "set", at: {entry: "e1", path: "panel.存款"}, value: 1} as StoryChange["patches"][number];
        const kept = ok(publishPuts(stored.world, [{ref: {kind: "change", id: stored.id}, after: {...change, patches: [extra, ...change.patches]}}]));
        expect(kept.world.data.changes.get(stored.id)!.patches[1]!.value).toBe("<div>旧</div>");
        const undone = storedChange(world(), "<div>旧</div>", "undone");
        const again = structuredClone(undone.world.data.changes.get(undone.id)!);
        expect(rejected(publishPuts(undone.world, [{ref: {kind: "change", id: undone.id}, after: {...again, status: "active"}}]))).toEqual([{code: "unsupported-markdown", path: "patches[0]"}]);
    });

    test("同一请求里新建的条目：主文字里用临时 id 引它，存下的是正式 id", () => {
        const base = world();
        const person = (tmp: string, name: string, text: string[]): Entry => ({id: tmp, type: "人物", parent: null, folder: "", order: 0, init: {name, aliases: [], summary: "", text: text.map((source, index) => ({id: `b${String(index + 1)}`, source})), data: {}}});
        const created = ok(publishPuts(base, [
            {ref: {kind: "entry", id: "tmp:a"}, after: person("tmp:a", "甲", ['见 <Ref id="tmp:b" />，<V entry="tmp:b" of="entry.name" />，<V expr="ref(\'tmp:b\').entry.name" />'])},
            {ref: {kind: "entry", id: "tmp:b"}, after: person("tmp:b", "乙", [])},
        ]));
        const [a, b] = [created.ids["tmp:a"]!, created.ids["tmp:b"]!];
        expect(created.world.data.entries.get(a)!.init.text[0]!.source).toBe(`见 <Ref id="${b}" />，<V entry="${b}" of="entry.name" />，<V expr="ref('${b}').entry.name" />`);
        expect(agentBlocks(created.world, at("ch1"), "actual", a)[0]).toBe(`见 <Ref id="${b}" name="乙" />，<V entry="${b}" of="entry.name">"乙"</V>，<V expr="ref('${b}').entry.name">"乙"</V>`);
    });

    test("editEntries 同一批里新建的条目：别的条目整段替换、增块、新建的主文字里用它的临时 id，存下的是正式 id", () => {
        const base = world(["甲"]);
        const result = editEntries(base, editsOf(base, [
            {op: "create", id: "tmp:n", entry: {name: "新人", kind: "人物", text: ['见 <Ref id="tmp:m" />']}},
            {op: "create", id: "tmp:m", entry: {name: "另一人", kind: "人物", text: ['见 <Ref id="tmp:n" />']}},
            {op: "set", at: {entry: "e1", path: "text[b1]"}, value: '同行 <Ref id="tmp:n" />'},
            {op: "addBlock", entry: "e1", source: '<V entry="tmp:n" of="entry.name" />', after: "b1"},
        ] as EntryOp[]), "t");
        const done = ok(result);
        const [n, m] = [done.ids["tmp:n"]!, done.ids["tmp:m"]!];
        expect(textOf(done.world).map((block) => block.source)).toEqual([`同行 <Ref id="${n}" />`, `<V entry="${n}" of="entry.name" />`]);
        expect([done.world.data.entries.get(n)!.init.text[0]!.source, done.world.data.entries.get(m)!.init.text[0]!.source]).toEqual([`见 <Ref id="${m}" />`, `见 <Ref id="${n}" />`]);
    });

    test("写了临时 id 又超过长度上限的块：照常拒收，不为换 id 去解析它", () => {
        const base = world();
        const deep = `${"> ".repeat(25_000)}<Ref id="tmp:b" />`;
        const person = (tmp: string, text: string[]): Entry => ({id: tmp, type: "人物", parent: null, folder: "", order: 0, init: {name: tmp, aliases: [], summary: "", text: text.map((source, index) => ({id: `b${String(index + 1)}`, source})), data: {}}});
        expect(rejected(publishPuts(base, [{ref: {kind: "entry", id: "tmp:a"}, after: person("tmp:a", [deep])}, {ref: {kind: "entry", id: "tmp:b"}, after: person("tmp:b", [])}]))).toEqual([{code: "block-too-large", path: "init.text[b1]"}]);
    });

    test("式子里的引用按语法树认：带空格的 ref ( '…' ) 换，字符串里写着的 ref('…') 不换", () => {
        const base = world();
        const person = (tmp: string, text: string[]): Entry => ({id: tmp, type: "人物", parent: null, folder: "", order: 0, init: {name: tmp, aliases: [], summary: "", text: text.map((source, index) => ({id: `b${String(index + 1)}`, source})), data: {}}});
        const created = ok(publishPuts(base, [
            {ref: {kind: "entry", id: "tmp:a"}, after: person("tmp:a", ["<V expr=\"ref ( 'tmp:b' ).entry.name == 'ref(tmp:b)'\" />"])},
            {ref: {kind: "entry", id: "tmp:b"}, after: person("tmp:b", [])},
        ]));
        const b = created.ids["tmp:b"]!;
        expect(created.world.data.entries.get(created.ids["tmp:a"]!)!.init.text[0]!.source).toBe(`<V expr="ref ( '${b}' ).entry.name == 'ref(tmp:b)'" />`);
    });

    test("式子超过 1000 个字符拒收（嵌套的深度因此有界，写入与渲染不会栈溢出）；splitBlocks 读不出结构的整段作为一块", () => {
        expect(rejected(writeText(world(), [`<V expr="${"1+".repeat(600)}entry.name" />`]))).toEqual([{code: "forbidden-syntax", path: "init.text[b1]"}]);
        expect(rejected(writeText(world(), [`<V expr="${"1+".repeat(400)}panel.魔力" />`]))).toBe("ok");
        const deep = "> ".repeat(25_000);
        expect(splitBlocks(deep)).toEqual([{id: "b1", source: deep}]);
    });

    test("单元树超过 100 层拒收（98 层引用加段落与文字是 100 层，照常；99 层拒收），存下的旧数据照出错的块给（与运行时的栈深无关）", () => {
        const quotes = (levels: number) => `${"> ".repeat(levels)}字`;
        expect(rejected(writeText(world(), [quotes(98)]))).toBe("ok");
        expect(rejected(writeText(world(), [quotes(99)]))).toEqual([{code: "unsupported-markdown", path: "init.text[b1]"}]);
        expect(blockProblem(quotes(99))?.message).toBe("nested more than 100 levels deep; flatten the quotes, lists or emphasis");
        const stored = injected(world(), [["b2", quotes(99)]]);
        expect(agentBlocks(stored, at("ch5"))[1]).toBe(quotes(99));
        const rendered = renderEntryForAuthor(stored, "e1", at("ch5"), "actual");
        if (rendered === null || typeof rendered === "string") throw new Error("no render");
        expect(rendered.blocks[1]).toMatchObject({error: {code: "unsupported-markdown"}, text: quotes(99)});
    });

    test("原样的 HTML（块级与行内）的诊断写 raw HTML，不写内部的单元名", () => {
        for (const source of ["<div>旧</div>", "前 <span>旧</span> 后"]) expect(blockProblem(source)?.message).toBe("raw HTML or an HTML comment is not supported in entry text");
    });

    test("旧块里存着没新建的临时 id：之后的请求新建同名的临时 id，原样留着的旧块不被改绑；新写的块照换（发布、editEntries 与它的预览）", () => {
        const stored = ok(writeText(world(), ['提到 <Ref id="tmp:x" />。'])).world;
        expect(textOf(stored)[0]!.source).toBe('提到 <Ref id="tmp:x" />。');
        const newcomer = {id: "tmp:x", type: "人物", parent: null, folder: "", order: 5, init: {name: "新来的", aliases: [], summary: "", text: [], data: {}}} as Entry;
        const renamed = {...structuredClone(stored.data.entries.get("e1")!), init: {...stored.data.entries.get("e1")!.init, name: "星瑕二"}};
        const published = ok(publishPuts(stored, [{ref: {kind: "entry", id: "tmp:x"}, after: newcomer}, {ref: {kind: "entry", id: "e1"}, after: renamed}]));
        expect(textOf(published.world)[0]!.source).toBe('提到 <Ref id="tmp:x" />。');
        const edits = editsOf(stored, [
            {op: "create", id: "tmp:x", entry: {name: "新来的", kind: "人物"}},
            {op: "set", at: {entry: "e1", path: "entry.name"}, value: "星瑕二"},
            {op: "set", at: {entry: "e1", path: "text[b1]"}, value: '提到 <Ref id="tmp:x" />。'},
            {op: "addBlock", entry: "e1", source: '又提到 <Ref id="tmp:x" />。', after: "b1"},
        ] as EntryOp[]);
        for (const result of [editEntries(stored, edits, "t"), previewEntries(stored, edits, "t")]) {
            const done = ok(result);
            const x = done.ids["tmp:x"]!;
            expect(textOf(done.world).map((block) => block.source)).toEqual(['提到 <Ref id="tmp:x" />。', `又提到 <Ref id="${x}" />。`]);
        }
        // 变更的补丁一侧同样：原样留着的旧补丁不换，新加的补丁照换。
        const withPatch = ok(publishPuts(world(), [textChange("tmp:c1", '第 4 章 <Ref id="tmp:x" />')]));
        const change = withPatch.ids["tmp:c1"]!;
        const old = structuredClone(withPatch.world.data.changes.get(change)!);
        const added = {op: "set", at: {entry: "e1", path: "text[b1]"}, value: '新 <Ref id="tmp:x" />'} as StoryChange["patches"][number];
        const again = ok(publishPuts(withPatch.world, [{ref: {kind: "entry", id: "tmp:x"}, after: newcomer}, {ref: {kind: "change", id: change}, after: {...old, patches: [...old.patches, added]}}]));
        const patches = again.world.data.changes.get(change)!.patches;
        expect([patches[0]!.value, patches[1]!.value]).toEqual(['第 4 章 <Ref id="tmp:x" />', `新 <Ref id="${again.ids["tmp:x"]!}" />`]);
    });

    test("按块渲染（Agent 写回一块时用）：只给那一块，给 Agent 的另带存下的源文；没有那块时没有块", () => {
        const base = injected(world(), [["b2", '魔力 <V  of="panel.魔力"/>。']]);
        expect(renderEntryForAgent(base, "e1", at("ch5"), "actual", {block: "b2"})).toMatchObject({blocks: [{id: "b2", text: '魔力 <V of="panel.魔力">3110</V>。', source: '魔力 <V  of="panel.魔力"/>。'}]});
        expect(renderEntryForAgent(base, "e1", at("ch5"), "actual", {block: "b9"})).toMatchObject({blocks: []});
        expect(renderEntryForAuthor(base, "e1", at("ch5"), "actual", {block: "b2"})).toMatchObject({blocks: [{id: "b2"}]});
    });

    test("非规范写法的旧块：读到的带值写法去值，规范化以后与存下的源文规范化以后相同（Agent 原样交回算没有改动）", () => {
        const base = injected(world(), [["b2", '魔力 <V  of="panel.魔力"/>，<Plot  id="x"/>。']]);
        const read = agentBlocks(base, at("ch5"))[1]!;
        expect(normalizeBlockSource(stripEntryText(read))).toBe(normalizeBlockSource('魔力 <V  of="panel.魔力"/>，<Plot  id="x"/>。'));
        // 去值时活的标签已写成规范写法：Agent 工具比“有没有改动”时交回的一侧不再规范化（只差 BOM 与换行）。
        expect(stripEntryText(read)).toBe('魔力 <V of="panel.魔力" />，<Plot id="x" />。');
    });

    test("预览的行列：CR、CRLF、LF 都算一个换行", () => {
        for (const newline of ["\r", "\r\n", "\n"]) {
            const rendered = renderSourceForAuthor(world(), "e1", `第一段${newline}${newline}魔力 <V of="panel.魔力"`, at("ch5"), "actual");
            if (rendered === null || typeof rendered === "string") throw new Error("no render");
            expect(rendered.blocks[0]).toMatchObject({error: {code: "tag-malformed", line: 3, column: 4}});
        }
    });
});

describe("canon.rendering 输出 5、6、7（审查补）：结果确定时不标读不到；字符串列表的显示", () => {
    test("`false && 读不到的`是确定的假：Agent 与作者都不带 unavailable", () => {
        const base = cast(["<V expr=\"false && ref('e3').entry.name\" />"]);
        expect(agentBlocks(base, at("ch1"))).toEqual(["<V expr=\"false && ref('e3').entry.name\">false</V>"]);
        expect(authorValues(base, at("ch1"))[0]).toEqual({tag: "V", start: 0, expr: "false && ref('e3').entry.name", raw: false, display: "否"});
    });

    test("判断的结果确定时作者的值表也不带读不到；条件未知时按第一个未知的判断报：读不到的报 unavailable 不写字，值为空的写“未知”", () => {
        const base = cast(["<If test=\"false && ref('e3').entry.name == 'x'\">甲<Else />乙</If>"]);
        expect(authorValues(base, at("ch1"))[0]).toEqual({tag: "If", start: 0, result: false, taken: 1});
        const context: PlainContext = {resolve: (reference) => (reference.entry === "e3" ? {value: null, unavailable: "还没出场"} : {value: null}), entryName: () => null, isEntry: () => true};
        const missingFirst = "前<If test=\"ref('e3').entry.name == '阿七'\">甲<ElseIf test=\"panel.空 > 1\" />乙</If>后";
        const emptyFirst = "前<If test=\"panel.空 > 1\">甲<ElseIf test=\"ref('e3').entry.name == '阿七'\" />乙</If>后";
        expect([renderBlockPlain("b1", missingFirst, context), renderBlockPlain("b1", emptyFirst, context)].map((block) => [block.text, block.problems])).toEqual([["前后", ["unavailable"]], ["前未知后", []]]);
    });

    test("作者看到的字符串列表写各项，用顿号连", () => {
        expect(authorValues(plainWorld(['<V of="entry.aliases" />']), at("ch1"))[0]).toMatchObject({raw: ["小瑕", "阿瑕"], display: "小瑕、阿瑕"});
    });
});
