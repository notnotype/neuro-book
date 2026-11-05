import {describe, expect, test} from "bun:test";
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {parseOptionsShorthand, parseQuestionMarkup, validateAnswerValue, validateQuestionDefinition, type MarkupProblem} from "./questions.js";

const EXAMPLE = resolve(import.meta.dirname, "../../docs/examples/questions.html");
const T03_BOARD = resolve(import.meta.dirname, "../../tests/fixtures/t03-review/index.html");

const codes = (problems: readonly MarkupProblem[]) => problems.map((problem) => [problem.code, problem.questionId, problem.line]);

describe("提问标记的解析", () => {
    test("文档里的例子页：四种类型、一行写法、@review、缺省选答与必答、推荐、data-nbdev-label 与 data-nbdev-skip", async () => {
        const parsed = await parseQuestionMarkup(await readFile(EXAMPLE, "utf8"), "questions.html");
        expect(parsed.problems).toEqual([]);
        expect(parsed.title).toBe("提问标记例子");
        expect(parsed.questions.map(({page: _page, line: _line, ...question}) => question)).toEqual([
            {id: "home-layout", type: "single", label: "首页的 Work 区用卡片还是表", required: false, recommend: ["cards"], options: [{value: "cards", label: "A 每个 Work 一张卡片"}, {value: "table", label: "B 一张表，按 Work 分组"}]},
            {id: "nav-groups", type: "multi", label: "左栏默认展开哪几组", required: false, recommend: [], options: [{value: "inbox", label: "收件箱"}, {value: "work", label: "工作"}, {value: "docs", label: "文档"}]},
            {id: "review-3", type: "single", label: "第 3 条：锁的接管没有核对持锁者", required: false, recommend: [], options: [{value: "fix", label: "改"}, {value: "skip", label: "不改"}, {value: "discuss", label: "要讨论"}]},
            {id: "naming-note", type: "text", label: "命名有没有别的想法", required: false, recommend: [], options: []},
            {id: "approve-spec", type: "confirm", label: "批准把草稿晋升为 Spec", required: true, recommend: [], options: []},
        ]);
        expect(parsed.questions.every((question) => question.page === "questions.html" && typeof question.line === "number")).toBe(true);
    });

    test("t03 评审板的拷贝：给两节加上标记，徽标跳过，选项名取选项里的标题而不是整段文字", async () => {
        const board = (await readFile(T03_BOARD, "utf8"))
            .replace('<section class="q" id="r3-home">\n        <h2><span class="badge success">', '<section class="q" id="r3-home" data-nbdev-question="home-layout" data-nbdev-type="single" data-nbdev-recommend="cards">\n        <h2><span class="badge success" data-nbdev-skip>')
            .replace('<div class="cand"><a class="pv" href="r3/home.html#A">', '<div class="cand" data-nbdev-option="cards"><a class="pv" href="r3/home.html#A">')
            .replace('<div class="cand"><a class="pv" href="r3/home.html#B">', '<div class="cand" data-nbdev-option="table"><a class="pv" href="r3/home.html#B">');
        const parsed = await parseQuestionMarkup(board, "index.html");
        expect(parsed.problems).toEqual([]);
        expect(parsed.questions).toEqual([expect.objectContaining({
            id: "home-layout",
            label: "首页（Work 视角）：A 卡片还是 B 表",
            options: [{value: "cards", label: "A 每个 Work 一张卡片"}, {value: "table", label: "B 一张表，按 Work 分组，每行一个 Task"}],
            line: 99,
        })]);
        expect(parsed.references.some((reference) => reference.target === "r3/home.html#A")).toBe(true);
    });

    test("没有显式结束标签的题报 question_not_closed；p 里放块级选项被挤到题外，报错提示是自动闭合", async () => {
        const html = [
            "<ul>",
            '<li data-nbdev-question="a" data-nbdev-type="text"><h3>甲</h3>',
            "<li>乙</li>",
            "</ul>",
            '<p data-nbdev-question="b" data-nbdev-type="single">丙',
            '<div data-nbdev-option="x">X</div><div data-nbdev-option="y">Y</div></p>',
        ].join("\n");
        const parsed = await parseQuestionMarkup(html, "page.html");
        expect(codes(parsed.problems)).toEqual([
            ["question_not_closed", "a", 2],
            ["question_not_closed", "b", 5],
            ["label_missing", "b", 5],
            ["options_missing", "b", 5],
            ["option_outside_question", null, 6],
            ["option_outside_question", null, 6],
        ]);
        expect(parsed.problems.find((problem) => problem.code === "option_outside_question")?.message).toContain("自动闭合");
    });

    test("各类写错都带题号与行号", async () => {
        const html = [
            '<section data-nbdev-question="outer" data-nbdev-type="text"><h2>外</h2>',
            '<div data-nbdev-question="inner" data-nbdev-type="text"><h3>里</h3></div></section>',
            '<section data-nbdev-question="Bad_Id" data-nbdev-type="text"><h2>题号不合规</h2></section>',
            '<section data-nbdev-question="no-label" data-nbdev-type="text"></section>',
            '<section data-nbdev-question="weird" data-nbdev-type="ranking"><h2>类型不认识</h2></section>',
            `<section data-nbdev-question="long" data-nbdev-type="single"><h2>选项名太长</h2><div data-nbdev-option="a">${"很长".repeat(50)}</div><div data-nbdev-option="b">B</div></section>`,
            '<section data-nbdev-question="both" data-nbdev-type="single" data-nbdev-options="a|b"><h2>两种写法</h2><div data-nbdev-option="c">C</div></section>',
            '<section data-nbdev-question="rec" data-nbdev-type="single" data-nbdev-options="a|b" data-nbdev-recommend="z"><h2>推荐不在选项里</h2></section>',
            '<section data-nbdev-question="rec" data-nbdev-type="text"><h2>重复的题号</h2></section>',
        ].join("\n");
        const parsed = await parseQuestionMarkup(html, "page.html");
        expect(codes(parsed.problems)).toEqual([
            ["nested_question", "inner", 2],
            ["invalid_question_id", "Bad_Id", 3],
            ["label_missing", "no-label", 4],
            ["invalid_question_type", "weird", 5],
            ["option_label_too_long", "long", 6],
            ["options_conflict", "both", 7],
            ["invalid_recommend", "rec", 8],
            ["duplicate_question", "rec", 9],
        ]);
    });

    test("写在内联脚本、模板或 noscript 里的标记标出 scriptMarkers，不当成题", async () => {
        for (const html of [
            '<script>document.body.innerHTML = `<section data-nbdev-question="x" data-nbdev-type="text">`;</script>',
            '<template><section data-nbdev-question="x" data-nbdev-type="text"><h2>t</h2></section></template>',
            '<noscript><section data-nbdev-question="x" data-nbdev-type="text"><h2>t</h2></section></noscript>',
        ]) {
            const parsed = await parseQuestionMarkup(html, "page.html");
            expect([parsed.scriptMarkers, parsed.questions, parsed.problems]).toEqual([true, [], []]);
        }
        expect((await parseQuestionMarkup("<script>console.log(1)</script>", "page.html")).scriptMarkers).toBe(false);
    });

    test("按属性查询标记的脚本与样式不算写了标记", async () => {
        for (const html of [
            "<style>[data-nbdev-question] { outline: 1px dashed red; }</style>",
            '<script>for (const section of document.querySelectorAll("[data-nbdev-question]")) section.classList.add("q");</script>',
            "<noscript>页面上的 data-nbdev-question 标记需要脚本增强</noscript>",
        ]) {
            expect((await parseQuestionMarkup(html, "page.html")).scriptMarkers).toBe(false);
        }
    });

    test("取文字：行内元素直接拼接，块级元素与 br 之间补空格；同一道题的选项名重复报 duplicate_option_label", async () => {
        const html = [
            '<section data-nbdev-question="inline" data-nbdev-type="single"><h2>用<code>nbdev</code>发<b>布</b>：选一个</h2>',
            '<div data-nbdev-option="a"><p>甲</p><p>说明</p></div><div data-nbdev-option="b">乙<br>二行</div></section>',
            '<section data-nbdev-question="twins" data-nbdev-type="single"><h2>同名</h2>',
            '<div data-nbdev-option="x"><a href="x.html">打开</a></div><div data-nbdev-option="y"><a href="y.html">打开</a></div></section>',
        ].join("\n");
        const parsed = await parseQuestionMarkup(html, "page.html");
        expect(parsed.questions[0]).toMatchObject({label: "用nbdev发布：选一个", options: [{value: "a", label: "甲 说明"}, {value: "b", label: "乙 二行"}]});
        expect(codes(parsed.problems)).toEqual([["duplicate_option_label", "twins", 3]]);
    });
});

describe("题的定义与答复取值", () => {
    test("一行写法：@review、值:名称、只有值", () => {
        expect(parseOptionsShorthand("@review").map((option) => option.value)).toEqual(["fix", "skip", "discuss"]);
        expect(parseOptionsShorthand("a:甲| b |c:丙")).toEqual([{value: "a", label: "甲"}, {value: "b", label: "b"}, {value: "c", label: "丙"}]);
    });

    test("定义的校验与页面标记共用", () => {
        expect(validateQuestionDefinition({id: "ok", type: "confirm", label: "批准", options: [], recommend: []})).toEqual([]);
        expect(validateQuestionDefinition({id: "ok", type: "multi", label: "选", options: [{value: "a", label: "A"}, {value: "a", label: "A2"}], recommend: []}).map((problem) => problem.code)).toEqual(["duplicate_option"]);
        expect(validateQuestionDefinition({id: "ok", type: "text", label: "x".repeat(201), options: [{value: "a", label: "A"}], recommend: ["a"]}).map((problem) => problem.code)).toEqual(["label_too_long", "options_not_allowed", "invalid_recommend"]);
    });

    test("答复取值按题的类型校验", () => {
        const single = {type: "single" as const, options: [{value: "a", label: "A"}, {value: "b", label: "B"}]};
        expect(validateAnswerValue(single, "a")).toBeNull();
        expect(validateAnswerValue(single, "z")).not.toBeNull();
        const multi = {...single, type: "multi" as const};
        expect(validateAnswerValue(multi, ["a", "b"])).toBeNull();
        for (const bad of [[], ["a", "a"], ["z"], "a"]) expect(validateAnswerValue(multi, bad)).not.toBeNull();
        expect(validateAnswerValue({type: "text", options: []}, "说明")).toBeNull();
        for (const bad of ["  ", 3, "x".repeat(10_001)]) expect(validateAnswerValue({type: "text", options: []}, bad)).not.toBeNull();
        expect(validateAnswerValue({type: "confirm", options: []}, false)).toBeNull();
        expect(validateAnswerValue({type: "confirm", options: []}, "yes")).not.toBeNull();
    });
});
