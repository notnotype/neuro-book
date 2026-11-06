import {createHash} from "node:crypto";

import {describe, expect, test} from "bun:test";
import type {Expression} from "estree";

import {buildRegistry, ChapterOrder, type Entry, type WriteRequest} from "../src/index";
import {renderEntryForAgent, renderEntryForAuthor, splitBlocks} from "../src/render/entry";
import {evaluate, type Resolve} from "../src/render/render";
import {parseBlock} from "../src/render/syntax";
import {scanAnnotations, writeBack} from "../src/render/writeback";
import {World, type WriteResult} from "../src/world/world";
import {PANEL, PERSON} from "./fixtures/world";

const BLOCK = '魔力 {panel.魔力}/{panel.魔力上限}，{panel.魔力 >= 1000 ? "能变身" : "变不了身"}';

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
const at = (chapter: string) => ({kind: "chapter" as const, chapter, edge: "end" as const});

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

describe("canon.rendering 输出 1、2、3：白名单、保留名与切块", () => {
    test.each([
        ["import x from \"y\"\n\n正文", "forbidden-syntax"],
        ["<Foo />", "unknown-tag"],
        ["<Ref id={x.y} />", "unknown-tag"],
        ["他说{+5}", "no-field-expression"],
        ["{panel.魔力 + 1}", "forbidden-syntax"],
        ["{ref(\"e1\")}", "no-field-expression"],
        ["他说{}", "no-field-expression"],
        ["{ }", "no-field-expression"],
        ["{panel.任务[3]}", "forbidden-syntax"],
        ["<Ref id=\"e1\">", "cross-block"],
    ])("%s → %s", (source, code) => {
        const result = parseBlock(source);
        expect(result.ok ? null : result.problem.code).toBe(code as never);
    });

    test("只含注释的表达式放行", () => {
        expect(parseBlock("{/* 以后补 */}").ok).toBe(true);
        expect(parseBlock("说明{// 行注释\n}").ok).toBe(true);
    });

    test("负数字面量、只含注释的表达式、转义与代码里的花括号放行", () => {
        for (const source of ["{panel.存款 > -100 ? \"有钱\" : \"欠债\"}", "{/* block:b7 */}", "他说\\{+5}，`代码{x}`", "见[设定][s1]。"]) expect(parseBlock(source).ok).toBe(true);
    });

    test("写入时检查：块不合规则就拒收并指出块与行列", () => {
        const base = world();
        const next = structuredClone(base.data.entries.get("e1")!);
        next.init.text.push({id: "b2", source: "他说{+5}"});
        const result = base.publish({requestId: id(), by: author, what: "edit", title: "改", baseVersion: 2, puts: [{ref: {kind: "entry", id: "e1"}, after: next}]}, "t");
        expect(result.ok === false && result.failure.code === "validation-failed" && result.failure.problems[0]).toMatchObject({code: "no-field-expression", path: "init.text[b2]"});
    });

    test("整篇写入按顶层节点切块，新 id 不与已有的重复", () => {
        expect(splitBlocks("# 星瑕\n\n第一段。\n\n- 一\n- 二", ["b3"])).toEqual([{id: "b4", source: "# 星瑕"}, {id: "b5", source: "第一段。"}, {id: "b6", source: "- 一\n- 二"}]);
    });
});

describe("canon.rendering 输出 5：三值逻辑", () => {
    const expression = (source: string) => {
        const parsed = parseBlock(`{${source}}`);
        if (!parsed.ok) throw new Error(parsed.problem.message);
        return parsed.block.expressions[0]!;
    };
    const values: Record<string, unknown> = {"panel.真": true, "panel.假": false, "panel.未知": null, "panel.数": 5};
    const resolve: Resolve = (reference) => ({value: values[reference.path] ?? null});
    test.each([
        ["panel.数 > 3", true],
        ["panel.未知 > 3", null],
        ["panel.数 > \"三\"", null],
        ["!panel.未知", null],
        ["panel.假 && panel.未知", false],
        ["panel.真 && panel.未知", null],
        ["panel.真 || panel.未知", true],
        ["panel.假 || panel.未知", null],
        ["panel.未知 ? \"是\" : \"否\"", null],
        ["panel.数 === 5 ? \"是\" : \"否\"", "是"],
    ])("%s → %o", (source, expected) => {
        const site = expression(source);
        expect(evaluate(site.expression as Expression, site.references, resolve).value).toBe(expected as never);
    });
});

describe("canon.rendering 场景 1：两种渲染与读不到的值（输出 6–9）", () => {
    test("第 5 章末尾：作者看到值与千位分隔，Agent 读到带值写法", () => {
        const base = world();
        const forAuthor = renderEntryForAuthor(base, "e1", at("ch5"), "actual");
        if (forAuthor === null || typeof forAuthor === "string") throw new Error("no render");
        const paragraph = (forAuthor.blocks[0] as unknown as {tree: {children: Array<{children: Array<Record<string, unknown>>}>}}).tree.children[0]!.children;
        expect(paragraph.filter((node) => node.type !== "text")).toEqual([
            {type: "canonValue", path: "panel.魔力", entry: null, label: "魔力", raw: 3110, display: "3,110"},
            {type: "canonValue", path: "panel.魔力上限", entry: null, label: "魔力上限", raw: 12000, display: "12,000"},
            {type: "canonComputed", source: "panel.魔力 >= 1000 ? \"能变身\" : \"变不了身\"", raw: "能变身", display: "能变身"},
        ]);
        const agent = renderEntryForAgent(base, "e1", at("ch5"), "actual");
        if (agent === null || typeof agent === "string") throw new Error("no render");
        expect(agent.blocks[0]!.text).toBe('魔力 {panel.魔力 = 3110}/{panel.魔力上限 = 12000}，{panel.魔力 >= 1000 ? "能变身" : "变不了身" -> "能变身"}');
    });

    test("第 1 章面板还没启用：作者看到占位，Agent 读到 null 与不可用的装饰，条件是 null", () => {
        const agent = renderEntryForAgent(world(), "e1", at("ch1"), "actual");
        if (agent === null || typeof agent === "string") throw new Error("no render");
        expect(agent.blocks[0]!.text).toBe('魔力 {panel.魔力 = null # 不可用：面板第 3 章起生效}/{panel.魔力上限 = null # 不可用：面板第 3 章起生效}，{panel.魔力 >= 1000 ? "能变身" : "变不了身" -> null # 不可用：面板第 3 章起生效}');
    });

    test("条目引用补上这个位置的名字；源文里作者写的括注是注记以外的字", () => {
        const base = world(['见<Ref id="e2" />（化名）{panel.存款}（未知）']);
        const agent = renderEntryForAgent(base, "e1", at("ch5"), "actual");
        if (agent === null || typeof agent === "string") throw new Error("no render");
        expect(agent.blocks[0]!.text).toBe('见<Ref id="e2" name="星瑾" />（化名）{panel.存款 = 0}（未知）');
    });
});

describe("canon.rendering 输出 10、12、13 与场景 2、3、4：回写", () => {
    const agentText = (base: World) => {
        const agent = renderEntryForAgent(base, "e1", at("ch5"), "actual");
        if (agent === null || typeof agent === "string") throw new Error("no render");
        return agent.blocks[0]!.text;
    };

    test("按计划模式读到的块原样交回：拒收 planned-not-writable，世界不变（输出 12）", () => {
        const base = world();
        const planned = renderEntryForAgent(base, "e1", at("ch5"), "planned");
        if (planned === null || typeof planned === "string") throw new Error("no render");
        expect(planned.mode).toBe("planned");
        const result = writeBack(base, {requestId: id(), by: author, entry: "e1", block: "b1", position: planned.position, version: planned.version, mode: planned.mode, text: planned.blocks[0]!.text}, "t");
        expect(result).toEqual({ok: false, failure: {code: "planned-not-writable"}});
    });

    test("值改了、文字也改了，剧情变化：一次修订里记一条差额并整段替换这一块", () => {
        const base = world();
        const text = agentText(base).replace("{panel.魔力 = 3110}", "{panel.魔力 = 3000}").replace("魔力 {", "魔法力 {");
        const result = ok(writeBack(base, {requestId: id(), by: author, entry: "e1", block: "b1", position: at("ch5"), version: base.version, mode: "actual", text, intent: "story"}, "t"));
        expect(result.world.version).toBe(base.version + 1);
        const view = result.world.line().engine.entry("e1", at("ch5"), "actual");
        expect(view).toMatchObject({namespaces: {panel: {fields: {魔力: {value: 3000}}}}});
        expect(view !== null && view !== "chapter-not-found" && view.text[0]!.source).toBe('魔法力 {panel.魔力}/{panel.魔力上限}，{panel.魔力 >= 1000 ? "能变身" : "变不了身"}');
        expect(result.world.line().engine.entry("e1", at("ch4"), "actual")).toMatchObject({namespaces: {panel: {fields: {魔力: {value: 3110}}}}});
    });

    test("改了 -> 的部分得到 computed-edited；删掉注记得到 annotation-mismatch；同一字段两个不同值得到 conflicting-values", () => {
        const base = world(["{panel.魔力} 与 {panel.魔力}，{panel.魔力 >= 1000 ? \"能\" : \"不能\"}"]);
        const text = agentText(base);
        const write = (changed: string) => writeBack(base, {requestId: id(), by: author, entry: "e1", block: "b1", position: at("ch5"), version: base.version, mode: "actual", text: changed}, "t");
        const failure = (changed: string) => {
            const result = write(changed);
            return result.ok ? "ok" : result.failure.code;
        };
        expect(failure(text.replace('-> "能"', '-> "不能"'))).toBe("computed-edited");
        expect(failure(text.replace("{panel.魔力 = 3110} 与 ", ""))).toBe("annotation-mismatch");
        expect(failure(text.replace("{panel.魔力 = 3110} 与 {panel.魔力 = 3110}", "{panel.魔力 = 1} 与 {panel.魔力 = 2}"))).toBe("conflicting-values");
        // 只改其中一处时按改了的那处。
        expect(failure(text.replace("{panel.魔力 = 3110} 与 {panel.魔力 = 3110}", "{panel.魔力 = 3110} 与 {panel.魔力 = 2000}"))).toBe("ok");
    });

    test("装饰在回写时忽略：删掉或改掉都不影响", () => {
        const base = world();
        const text = agentText(base).replace("{panel.魔力 = 3110}", "{panel.魔力 = 3110 # 随便写}");
        const result = writeBack(base, {requestId: id(), by: author, entry: "e1", block: "b1", position: at("ch5"), version: base.version, mode: "actual", text}, "t");
        expect(result.ok).toBe(true);
        expect(result.ok && result.world.version).toBe(base.version);
    });

    test("注记的值按 JSON 读出边界，字符串里的花括号与 -> 不切断", () => {
        const items = scanAnnotations('{entry.name = "a}b -> c"} 与 {panel.x >= 1 ? "{" : "}" -> "}"}');
        expect(items?.map((item) => [item.kind, item.left, item.value])).toEqual([["assign", "entry.name", "a}b -> c"], ["computed", "panel.x >= 1 ? \"{\" : \"}\"", "}"]]);
    });

    test("一块坏了：作者看到纯文本与诊断，Agent 读到原样源文与出错标记，交回合法文字后整段替换（场景 3、输出 14）", () => {
        const base = world([BLOCK]);
        // 绕过写入检查放进一块旧数据：直接重放一次修改它的修订。
        const broken = World.replay([
            ...base.revisions,
            {...base.revisions.at(-1)!, id: "r9", version: base.version + 1, requestId: "legacy", ops: [{ref: {kind: "entry", id: "e1"}, kind: "modify", fields: [{path: "init.text[b2]", after: {id: "b2", source: "<Foo />"}}, {path: "init.text#order", before: ["b1"], after: ["b1", "b2"]}]}]},
        ], options());
        const forAuthor = renderEntryForAuthor(broken, "e1", at("ch5"), "actual");
        if (forAuthor === null || typeof forAuthor === "string") throw new Error("no render");
        expect(forAuthor.blocks[1]).toMatchObject({id: "b2", error: {code: "unknown-tag"}, text: "<Foo />"});
        const agent = renderEntryForAgent(broken, "e1", at("ch5"), "actual");
        if (agent === null || typeof agent === "string") throw new Error("no render");
        expect(agent.blocks[1]).toMatchObject({id: "b2", text: "<Foo />", error: {code: "unknown-tag"}});
        const fixed = ok(writeBack(broken, {requestId: id(), by: author, entry: "e1", block: "b2", position: at("ch5"), version: broken.version, mode: "actual", text: "修好了"}, "t"));
        expect(fixed.world.data.entries.get("e1")!.init.text[1]).toEqual({id: "b2", source: "修好了"});
    });
});

describe("canon.rendering 输出 12、13：读取之后世界前进过", () => {
    const later = (base: World) => ok(base.publish({requestId: id(), by: author, what: "bookkeeping", title: "加 50", baseVersion: base.version, puts: [{ref: {kind: "change", id: "tmp:d"}, after: {id: "tmp:d", kind: "written", text: "加 50", at: {kind: "chapter", chapter: "ch4", key: 0}, told: [], involves: [], lines: [], links: [], patches: [{op: "add", at: {entry: "e1", path: "panel.魔力"}, value: 50, basis: {kind: "author"}}], status: "active", by: author}}]}, "t")).world;
    const blockOf = (base: World) => {
        const rendered = renderEntryForAgent(base, "e1", at("ch5"), "actual");
        if (rendered === null || typeof rendered === "string") throw new Error("no render");
        return rendered.blocks[0]!.text;
    };
    const send = (now: World, read: World, text: string, intent?: "creative" | "story") => writeBack(now, {requestId: id(), by: author, entry: "e1", block: "b1", position: at("ch5"), version: read.version, mode: "actual", text, ...(intent === undefined ? {} : {intent})}, "t");

    test("别的修订改了值，Agent 把旧文字原样交回：value-conflict，值不被改回去，也不发布", () => {
        const base = world();
        const now = later(base);
        for (const intent of ["story", "creative"] as const) {
            const result = send(now, base, blockOf(base), intent);
            expect(result).toEqual({ok: false, failure: {code: "value-conflict", current: 3160}});
        }
        expect(now.line().engine.entry("e1", at("ch5"), "actual")).toMatchObject({namespaces: {panel: {fields: {魔力: {value: 3160}}}}});
    });

    test("`->` 的值因为别的修订变了：是过期，不是 computed-edited", () => {
        const base = world(['{panel.魔力 >= 3150 ? "够" : "不够"}']);
        const now = later(base);
        const result = send(now, base, blockOf(base));
        expect(result).toEqual({ok: false, failure: {code: "value-conflict", current: "够"}});
    });

    test("世界前进过、交回的值与现在相同：没有改动，什么都不发布；有文字改动：version-conflict", () => {
        const base = world();
        const now = later(base);
        const fresh = blockOf(now);
        const same = send(now, base, fresh);
        expect(same.ok && same.repeated).toBe(true);
        expect(now.version).toBe(base.version + 1);
        expect(send(now, base, fresh.replace("魔力 {", "魔法力 {"))).toMatchObject({ok: false, failure: {code: "version-conflict"}});
    });

    test("重新读到新版本后再交回：照常发布", () => {
        const now = later(world());
        const result = send(now, now, blockOf(now).replace("{panel.魔力 = 3160}", "{panel.魔力 = 3000}"), "story");
        expect(result.ok).toBe(true);
    });
});

describe("canon.rendering 输出 1、8、10：写入检查与注记的扫描", () => {
    test("`set` 整段替换一块也过白名单", () => {
        const base = world();
        const result = base.publish({requestId: id(), by: author, what: "edit", title: "坏", baseVersion: base.version, puts: [{ref: {kind: "change", id: "tmp:b"}, after: {id: "tmp:b", kind: "written", text: "坏", at: {kind: "chapter", chapter: "ch4", key: 0}, told: [], involves: [], lines: [], links: [], patches: [{op: "set", at: {entry: "e1", path: "text[b1]"}, value: "他说{+5}"}], status: "active", by: author}}]}, "t");
        expect(result.ok === false && result.failure.code === "validation-failed" && result.failure.problems.map((problem) => problem.code)).toEqual(["no-field-expression"]);
    });

    test.each([
        ["波浪线围栏", "~~~\n{x}\n~~~\n\n魔力 {panel.魔力}"],
        ["开头带空格的围栏", "  ```\n{x}\n  ```\n\n魔力 {panel.魔力}"],
        ["长围栏里有短围栏", "````\n```\n{x}\n```\n````\n\n魔力 {panel.魔力}"],
        ["行内代码", "`{x}` 魔力 {panel.魔力}"],
        ["转义", "\\{x} 魔力 {panel.魔力}"],
    ])("%s里的花括号不当注记：原样交回没有改动，改值照常", (_name, source) => {
        const base = world([source]);
        const rendered = renderEntryForAgent(base, "e1", at("ch5"), "actual");
        if (rendered === null || typeof rendered === "string") throw new Error("no render");
        const text = rendered.blocks[0]!.text;
        const send = (changed: string) => writeBack(base, {requestId: id(), by: author, entry: "e1", block: "b1", position: at("ch5"), version: base.version, mode: "actual", text: changed, intent: "story"}, "t");
        const same = send(text);
        expect(same.ok && same.repeated).toBe(true);
        const edited = ok(send(text.replace("{panel.魔力 = 3110}", "{panel.魔力 = 3000}")));
        expect(edited.world.line().engine.entry("e1", at("ch5"), "actual")).toMatchObject({namespaces: {panel: {fields: {魔力: {value: 3000}}}}});
    });

    test("`->` 的左边按 JS 词法跳过注释：注释里的 `->` 不算分隔", () => {
        const base = world(['{panel.魔力 /* a -> b */ >= 1 ? "a" : "b"}']);
        const rendered = renderEntryForAgent(base, "e1", at("ch5"), "actual");
        if (rendered === null || typeof rendered === "string") throw new Error("no render");
        const same = writeBack(base, {requestId: id(), by: author, entry: "e1", block: "b1", position: at("ch5"), version: base.version, mode: "actual", text: rendered.blocks[0]!.text}, "t");
        expect(same.ok && same.repeated).toBe(true);
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
        return ok(jin.world.publish({requestId: id(), by: author, what: "opening", title: "开局", baseVersion: 1, puts: [{ref: {kind: "entry", id: "tmp:x"}, after: person("tmp:x", "星瑕", {link: {type: LINK.id, version: 1, enabled: true, declared: [{id: "额外", label: "额 外", kind: "number"}], fields: {友: {ref: "e1"}, n: 1, 额外: 7}}}, ["朋友 {link.友}，额外 {link.额外}，n {link.n}"])}]}, "t")).world;
    }
    const position = {kind: "chapter" as const, chapter: "ch1", edge: "end" as const};

    test("给作者：引用字段显示当时的名字，id 不出现；实例字段带显示名", () => {
        const rendered = renderEntryForAuthor(linked(), "e2", position, "actual");
        if (rendered === null || typeof rendered === "string") throw new Error("no render");
        const text = JSON.stringify(rendered.blocks[0]);
        expect(text).toContain('"type":"canonRef","id":"e1","name":"星瑾","deleted":false');
        expect(text).toContain('"label":"额 外"');
    });

    test("给 Agent：显示名与 id 不同时带装饰，相同时不带；读取结果里也有显示名", () => {
        const world = linked();
        const rendered = renderEntryForAgent(world, "e2", position, "actual");
        if (rendered === null || typeof rendered === "string") throw new Error("no render");
        expect(rendered.blocks[0]!.text).toBe('朋友 {link.友 = {"ref":"e1"} # 显示名：朋友}，额外 {link.额外 = 7 # 显示名：额 外}，n {link.n = 1}');
        expect(world.line().engine.entry("e2", position, "actual")).toMatchObject({namespaces: {link: {fields: {额外: {label: "额 外", value: 7}, n: {value: 1}}}}});
    });

    test("类型不在：作者看到占位，Agent 看到 null 加不可用；存下的值不丢", () => {
        const world = linked();
        const gone = world.withOptions({...world.options, registry: buildRegistry([])});
        const agent = renderEntryForAgent(gone, "e2", position, "actual");
        if (agent === null || typeof agent === "string") throw new Error("no render");
        expect(agent.blocks[0]!.text).toContain("{link.n = null # 不可用：类型不可用}");
        const shown = renderEntryForAuthor(gone, "e2", position, "actual");
        if (shown === null || typeof shown === "string") throw new Error("no render");
        expect(JSON.stringify(shown.blocks[0])).toContain('"type":"canonPlaceholder","reason":"类型不可用"');
        expect(gone.line().engine.entry("e2", position, "actual")).toMatchObject({namespaces: {link: {readOnly: "component-unknown", fields: {n: {value: 1}}}}});
    });

    test("版本对不上：照常给值", () => {
        const world = linked();
        const moved = world.withOptions({...world.options, registry: buildRegistry([{...LINK, version: 2} as never])});
        const agent = renderEntryForAgent(moved, "e2", position, "actual");
        if (agent === null || typeof agent === "string") throw new Error("no render");
        expect(agent.blocks[0]!.text).toContain("{link.n = 1}");
    });
});
