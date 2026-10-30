/**
 * 内置问答的引擎（docs/specs/story/qa.md 输出 1 到 11、24、26，验收 1 到 3、5、7、13 到 15、17，F3、F4、F8）：真实 harness、真实书库与 100 章
 * 样例书，只把模型输出换成脚本。断言的是模型拿到的工具结果与一问的结果。
 */

import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {chmod, readdir, readFile, rm, stat, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {toolCall, type ScriptedInput} from "@notnotype/nb-harness/testing";

import {openTestBook, type TestBook} from "../../testing/api";
import {startEndpoint} from "../../testing/openai-endpoint";
import {askScripted, prepareScripted, TEST_KEY_ENV, testConfig, toolResults} from "../../testing/qa";
import {smallDataset} from "../../testing/sample";
import {newQaRecordId, QaRecords} from "../core/qa-records";
import {askQuestion, changePosition, continuationProblem, positionReminder, POSITION_META_KEY, withoutFullText} from "./engine";
import {QaError} from "./errors";
import {EVENT_RESULT_CHARS} from "./web-events";

let book: TestBook;
let chapter37Length = 0;

beforeAll(async () => {
    book = await openTestBook("qa-engine");
    chapter37Length = (await book.api.library.readMeta("fox")).paragraphs[36]!;
});

afterAll(async () => {
    await book.close();
});

const P = {chapter: 38, paragraph: 57};

function answer(fields: Record<string, unknown> = {}): ScriptedInput {
    return [toolCall(`a${Math.random()}`, "answer", {conclusion: "结论", conclusionType: "推断", explanation: "说明", evidence: ["38.55"], coverage: "第 38 章", ...fields})];
}

const read = (id: string, from: object, to?: object) => toolCall(id, "read", to === undefined ? {from} : {from, to});

describe("查询工具（输出 2、3）", () => {
    test("模型拿到命令行格式的结果；角色视角、数组筛选与第二页都可用", async () => {
        const {model} = await askScripted(
            book,
            [
                [
                    toolCall("c1", "card", {entity: "苏天晴"}),
                    toolCall("c2", "between", {entity: "苏天晴", other: "南嘉鱼"}),
                    toolCall("c3", "relations", {perspective: "苏天晴", kinds: ["person"]}),
                    toolCall("c4", "find", {query: "魔法少女", limit: 2}),
                ],
                [read("r1", {chapter: 38, paragraph: 55}, {chapter: 38, paragraph: 55})],
                answer(),
            ],
            {at: P},
        );
        const [card, between, relations, find] = toolResults(model, 1);
        expect(card!.text).toContain("心月狐〔8.48〕");
        expect(between!.text).toContain("南嘉鱼答应和苏天晴交朋友，两人互加了好友。");
        expect(relations!.isError).toBe(false);
        const cursor = /cursor 参数传 "([^"]+)"/u.exec(find!.text)?.[1];
        expect(cursor).toBeDefined();

        const second = await askScripted(book, [[toolCall("c5", "find", {query: "魔法少女", limit: 2, cursor})], [read("r1", {chapter: 38, paragraph: 55}, {chapter: 38, paragraph: 55})], answer()], {at: P});
        const firstIds = find!.text.split("\n").slice(0, 2).map(line => line.split(" ")[0]);
        const secondIds = toolResults(second.model, 1)[0]!.text.split("\n").slice(0, 2).map(line => line.split(" ")[0]);
        expect(secondIds.some(id => firstIds.includes(id))).toBe(false);
    });

    test("参数里写 at 或 book 被拒；查询失败带码与候选，这一问继续", async () => {
        const {model, outcome} = await askScripted(
            book,
            [[toolCall("c1", "card", {entity: "苏天晴", at: {chapter: 100}}), toolCall("c2", "card", {entity: "不存在的人"})], [read("r1", {chapter: 38, paragraph: 55}, {chapter: 38, paragraph: 55})], answer()],
            {at: P},
        );
        const [withAt, missing] = toolResults(model, 1);
        expect(withAt!.isError).toBe(true);
        expect(missing).toMatchObject({isError: true});
        expect(missing!.text).toContain("entity_not_found");
        expect(outcome.result.status).toBe("answered");
    });
});

describe("记录等级不进问答（输出 3）", () => {
    test("statements 工具没有 maxTier 参数，写了是工具错误；结果不带等级", async () => {
        const {model} = await askScripted(
            book,
            [[toolCall("c1", "statements", {entity: "苏天晴"}), toolCall("c2", "statements", {entity: "苏天晴", maxTier: 2})], [read("r1", {chapter: 38, paragraph: 55}, {chapter: 38, paragraph: 55})], answer()],
            {at: P},
        );
        const tool = model.requests[0]!.tools!.find(item => item.name === "statements");
        expect(JSON.stringify(tool)).not.toContain("maxTier");
        const [plain, filtered] = toolResults(model, 1);
        expect(plain!.isError).toBe(false);
        expect(plain!.text).not.toMatch(/级/u);
        expect(filtered!.isError).toBe(true);
    });
});

describe("按书的开关提供查询（输出 2，ingest.md 输出 18）", () => {
    test("关掉数值与秘密的书：模型拿不到 ledger、track、knows，提示词不提数值，调用它们是工具错误；同时问全开的书照旧", async () => {
        const dataset = await smallDataset(40, "小书");
        dataset.book.features = {ledger: false, secrets: false};
        dataset.ledger = [];
        dataset.secrets = [];
        const quiet = await openTestBook("qa-engine-quiet", dataset);
        try {
            const steps = (): ScriptedInput[] => [[toolCall("c1", "ledger", {}), toolCall("c2", "info", {}), toolCall("c3", "card", {entity: "苏天晴"})], [read("r1", {chapter: 38, paragraph: 55}, {chapter: 38, paragraph: 55})], answer()];
            const [closed, open] = await Promise.all([askScripted(quiet, steps(), {at: P}), askScripted(book, steps(), {at: P})]);
            const toolNames = (ask: typeof closed) => (ask.model.requests[0]!.tools ?? []).map(tool => tool.name);
            for (const name of ["ledger", "track", "knows"]) {
                expect({name, closed: toolNames(closed).includes(name), open: toolNames(open).includes(name)}).toEqual({name, closed: false, open: true});
            }
            const prompt = (ask: typeof closed) => [ask.model.requests[0]!.systemPrompt ?? []].flat().join("\n");
            expect(prompt(closed)).toContain("情节、悬念、时间线");
            expect(prompt(open)).toContain("情节、数值、悬念、时间线");
            const [closedLedger, closedInfo, closedCard] = toolResults(closed.model, 1);
            expect({ledger: closedLedger!.isError, info: closedInfo!.isError}).toEqual({ledger: true, info: false});
            const [openLedger, , openCard] = toolResults(open.model, 1);
            expect(openLedger!.isError).toBe(false);
            // 人物卡的文字（命令行与问答共用）：没有秘密时不出“秘密：”这一节。
            expect({closed: closedCard!.text.includes("秘密："), open: openCard!.text.includes("秘密：")}).toEqual({closed: false, open: true});
            expect([closed.outcome.result.status, open.outcome.result.status]).toEqual(["answered", "answered"]);
        } finally {
            await quiet.close();
        }
    });
});

describe("防剧透（输出 4、验收 1）", () => {
    test("读原文只到 P；P 之后的章是工具错误；引用晚于 P 被退回", async () => {
        const {model, outcome} = await askScripted(
            book,
            [[read("r1", {chapter: 38, paragraph: 50}, {chapter: 38, paragraph: 81}), read("r2", {chapter: 39, paragraph: 1})], answer({evidence: ["38.60"]}), answer({evidence: ["38.55"]})],
            {at: P},
        );
        const [within, beyond] = toolResults(model, 1);
        expect(within!.text.split("\n").map(line => line.split("  ")[0])).toEqual(["38.50", "38.51", "38.52", "38.53", "38.54", "38.55", "38.56", "38.57"]);
        expect(beyond!.isError).toBe(true);
        expect(toolResults(model, 2)[0]!.text).toContain("晚于阅读位置 38.57");
        expect(outcome.result).toMatchObject({status: "answered", rejections: 1, chaptersRead: [38]});
    });
});

describe("章数上限（输出 5、验收 2）", () => {
    const config = testConfig({maxChapters: 2});

    test("读第 3 个新章被拒：正常结果写明没读、不给段落（决定 14）；已读的章照常再读；引用被拒的章交卷被退回", async () => {
        const {model, outcome} = await askScripted(
            book,
            [[read("r1", {chapter: 1, paragraph: 1}, {chapter: 1, paragraph: 2})], [read("r2", {chapter: 2, paragraph: 1}, {chapter: 2, paragraph: 2})], [read("r3", {chapter: 3, paragraph: 1})], [read("r4", {chapter: 1, paragraph: 3}, {chapter: 1, paragraph: 3})], answer({evidence: ["3.1"]}), answer({evidence: ["1.1"]})],
            {at: P, config},
        );
        const refused = toolResults(model, 3)[0]!;
        expect(refused.isError).toBe(false);
        expect(refused.text).toStartWith("没有读：一问最多读 2 个不同的章");
        expect(refused.text).not.toMatch(/^3\.1 /mu);
        expect(toolResults(model, 4)[0]!.text.startsWith("1.3  ")).toBe(true);
        expect(toolResults(model, 5)[0]!.isError).toBe(true);
        expect(outcome.result).toMatchObject({status: "answered", rejections: 1, chaptersRead: [1, 2]});
    });

    test("反复超限不绕过上限：每次都没读，已读的章不变", async () => {
        const {model, outcome} = await askScripted(
            book,
            [[read("r1", {chapter: 1, paragraph: 1}, {chapter: 1, paragraph: 1})], [read("r2", {chapter: 2, paragraph: 1}, {chapter: 2, paragraph: 1})], [read("r3", {chapter: 3, paragraph: 1})], [read("r4", {chapter: 4, paragraph: 1})], [read("r5", {chapter: 3, paragraph: 2}, {chapter: 3, paragraph: 2})], answer({evidence: ["1.1"]})],
            {at: P, config},
        );
        expect([3, 4, 5].map(request => toolResults(model, request)[0]!.text.startsWith("没有读："))).toEqual([true, true, true]);
        expect(outcome.result.chaptersRead).toEqual([1, 2]);
    });

    test("同一条消息里读两个新章：只有一次成功；跨章请求整次被拒、不计入已读", async () => {
        const batch = await askScripted(
            book,
            [[read("r1", {chapter: 1, paragraph: 1}, {chapter: 1, paragraph: 1})], [read("r2", {chapter: 2, paragraph: 1}, {chapter: 2, paragraph: 1}), read("r3", {chapter: 3, paragraph: 1}, {chapter: 3, paragraph: 1})], answer({evidence: ["1.1"]})],
            {at: P, config},
        );
        // 两次都是正常结果：一次真的读到（有段落），一次写明没读。
        expect(toolResults(batch.model, 2).map(result => [result.isError, result.text.startsWith("没有读：")])).toEqual([[false, false], [false, true]]);
        expect(batch.outcome.result.chaptersRead).toEqual([1, 2]);

        const span = await askScripted(
            book,
            [[read("r1", {chapter: 1, paragraph: 1}, {chapter: 1, paragraph: 1})], [read("r2", {chapter: 37, paragraph: chapter37Length - 1}, {chapter: 39, paragraph: 1})], answer({evidence: ["1.1"]})],
            {at: P, config},
        );
        expect(toolResults(span.model, 2)[0]!.text).toStartWith("没有读：");
        expect(span.outcome.result.chaptersRead).toEqual([1]);
    });

    test("跨章请求裁到 P：37 章末尾到 39.1 只给到 38.57", async () => {
        const {model} = await askScripted(book, [[read("r1", {chapter: 37, paragraph: chapter37Length}, {chapter: 39, paragraph: 1})], answer({evidence: [`37.${chapter37Length}—38.57`]})], {at: P});
        const refs = toolResults(model, 1)[0]!.text.split("\n").map(line => line.split("  ")[0]);
        expect(refs[0]).toBe(`37.${chapter37Length}`);
        expect(refs.at(-1)).toBe("38.57");
    });
});

describe("作答的校验与退回（输出 7、8、验收 3）", () => {
    test("三处问题一次列出；读了、改了再交即已答", async () => {
        const {model, outcome} = await askScripted(
            book,
            [
                [read("r1", {chapter: 37, paragraph: 8}, {chapter: 37, paragraph: 8})],
                answer({evidence: ["37.8", "37.9"], explanation: "第 38.60 段也提到", knowledge: [{who: "苏天晴", state: "知道", how: "在场", refs: []}]}),
                [read("r2", {chapter: 37, paragraph: 9}, {chapter: 37, paragraph: 9})],
                answer({evidence: ["37.8", "37.9"], knowledge: [{who: "苏天晴", state: "知道", how: "在场", refs: ["37.9"]}]}),
            ],
            {at: P},
        );
        const rejection = toolResults(model, 2)[0]!.text;
        expect(rejection).toContain("37.9");
        expect(rejection).toContain("没读过");
        expect(rejection).toContain("38.60");
        expect(rejection).toContain("knowledge[0]（苏天晴，知道）没有出处");
        expect(outcome.result).toMatchObject({status: "answered", rejections: 1});
        expect(outcome.result.answer?.knowledge?.[0]?.refs).toEqual(["37.9"]);
    });

    test("正文里的出处带句末点号或写成全角也照样校验；三段的版本号不当作出处", async () => {
        const {model, outcome} = await askScripted(
            book,
            [
                [read("r1", {chapter: 38, paragraph: 55}, {chapter: 38, paragraph: 55})],
                answer({explanation: "参考 39.1."}),
                answer({explanation: "参考 ３９．１"}),
                answer({explanation: "规则 3.5.0 版；见 38.55。"}),
            ],
            {at: P},
        );
        expect(toolResults(model, 2)[0]!.text).toContain("39.1");
        expect(toolResults(model, 3)[0]!.text).toContain("39.1");
        expect(outcome.result).toMatchObject({status: "answered", rejections: 2});
    });

    test("分两次读完的范围可以整段引用；留一段没读就被退回", async () => {
        const whole = await askScripted(book, [[read("r1", {chapter: 38, paragraph: 1}, {chapter: 38, paragraph: 20})], [read("r2", {chapter: 38, paragraph: 21}, {chapter: 38, paragraph: 40})], answer({evidence: ["38.1—38.40"]})], {at: P});
        expect(whole.outcome.result.rejections).toBe(0);

        const gap = await askScripted(
            book,
            [[read("r1", {chapter: 38, paragraph: 1}, {chapter: 38, paragraph: 20})], [read("r2", {chapter: 38, paragraph: 22}, {chapter: 38, paragraph: 40})], answer({evidence: ["38.1—38.40"]}), answer({evidence: ["38.1—38.20"]})],
            {at: P},
        );
        expect(toolResults(gap.model, 3)[0]!.text).toContain("38.21");
        expect(gap.outcome.result.rejections).toBe(1);
    });

    test("结论不是“无法确定”却没有依据被退回；“无法确定”可以不带依据", async () => {
        const {model, outcome} = await askScripted(book, [answer({evidence: []}), answer({evidence: [], conclusionType: "无法确定"})], {at: P});
        expect(toolResults(model, 1)[0]!.text).toContain("evidence 至少要有一个出处");
        expect(outcome.result).toMatchObject({status: "answered", chaptersRead: []});
    });

    test("和查询工具混在一批的交卷不算，这一问继续", async () => {
        const {model, outcome} = await askScripted(book, [[read("r1", {chapter: 38, paragraph: 55}, {chapter: 38, paragraph: 55}), toolCall("a1", "answer", {conclusion: "x", conclusionType: "推断", explanation: "e", evidence: ["38.55"], coverage: "c"})], answer()], {at: P});
        expect(toolResults(model, 1).map(result => result.isError)).toEqual([false, true]);
        expect(outcome.result.status).toBe("answered");
    });
});

describe("文字回复（输出 10、24，验收 13）与用量（输出 11）", () => {
    test("不调 answer、以一段文字停止：这一轮已答、带文字回复，只有一次请求，不提醒", async () => {
        const {model, outcome} = await askScripted(book, [{content: "  你好！想问这本书的什么？  ", usage: {input: 10, output: 2}}], {at: P, question: "你好"});
        expect(model.requests).toHaveLength(1);
        expect(outcome.result).toMatchObject({status: "answered", answer: null, reply: {text: "你好！想问这本书的什么？", truncated: false, unverifiedRefs: []}, turn: 1});
        expect(outcome.result.usage).toEqual({input: 10, output: 2, cacheRead: 0, cacheWrite: 0, cost: null, complete: true});
        expect(outcome.recordSaved).toBe(true);
    });

    test("没有出处、这一轮也没读原文：标为 ungrounded", async () => {
        const {outcome} = await askScripted(book, [{content: "南小风"}], {at: P, question: "这本书的主角叫什么？只回答名字。"});
        expect(outcome.result).toMatchObject({status: "answered", chaptersRead: [], reply: {text: "南小风", ungrounded: true}});
    });

    test("读过原文、只是没写出处：不算 ungrounded", async () => {
        const {outcome} = await askScripted(book, [[read("r1", {chapter: 38, paragraph: 55}, {chapter: 38, paragraph: 55})], "她是地狱猫。"], {at: P});
        expect(outcome.result.chaptersRead).toEqual([38]);
        expect(outcome.result.reply?.ungrounded).toBeUndefined();
    });

    test("文字里没读过的段与晚于 P 的出处列为没核实的，读过的不列", async () => {
        const {outcome} = await askScripted(book, [[read("r1", {chapter: 38, paragraph: 55}, {chapter: 38, paragraph: 55})], "见 38.55，另有 38.56 与 39.1；38.56 再提一次"], {at: P});
        expect(outcome.result.reply).toEqual({text: "见 38.55，另有 38.56 与 39.1；38.56 再提一次", truncated: false, unverifiedRefs: ["38.56", "39.1"]});
    });

    test("输出到上限而有文字：已答、标明截断", async () => {
        const {outcome} = await askScripted(book, [{content: "说到一半", stopReason: "length"}], {at: P});
        expect(outcome.result).toMatchObject({status: "answered", reply: {text: "说到一半", truncated: true}});
    });

    test("没有文字就是 no_answer：空串、只有空白、只有推理而输出到上限", async () => {
        const steps: ScriptedInput[][] = [[{content: ""}], [{content: "   \n "}], [{content: [{type: "thinking", thinking: "想了很久"}], stopReason: "length"}]];
        for (const step of steps) {
            const {outcome} = await askScripted(book, step, {at: P});
            expect(outcome.result).toMatchObject({status: "failed", answer: null, reply: null, error: {code: "no_answer"}});
        }
    });

    test("模型出错直接 model_failed", async () => {
        const {model, outcome} = await askScripted(book, [{content: "", error: {message: "上游不可用", status: 503}}], {at: P});
        expect(model.requests).toHaveLength(1);
        expect(outcome.result).toMatchObject({status: "failed", error: {code: "model_failed", kind: "network"}});
    });
});

describe("全读（输出 6、验收 5）", () => {
    test("原文超过上限：不发任何模型请求就以 full_read_unavailable 失败", async () => {
        let error: unknown;
        try {
            await askScripted(book, [], {at: {chapter: 100}, mode: "full", config: testConfig({fullReadMaxChars: 1000})});
        } catch (caught) {
            error = caught;
        }
        expect(error).toBeInstanceOf(QaError);
        expect((error as QaError).code).toBe("full_read_unavailable");
    });

    test("第一条消息带 P 以前每一段原文；引用其中任何段落都不因“没读过”被退回", async () => {
        const {model, outcome} = await askScripted(book, [answer({evidence: ["1.1", "20.3—20.5", "38.57"]})], {at: P, mode: "full", question: "全读的问题"});
        const first = model.requests[0]!.messages[0] as {content: string};
        expect(first.content).toContain("\n1.1 ");
        expect(first.content).toContain("\n38.57 ");
        expect(first.content).not.toContain("\n38.58 ");
        expect(first.content.endsWith("问题：全读的问题")).toBe(true);
        expect(outcome.result).toMatchObject({status: "answered", rejections: 0, mode: "full"});
        expect(outcome.result.chaptersRead).toHaveLength(38);
    });
});

describe("运行中删除书（“时序与寿命”、验收 7）", () => {
    async function freshBook(name: string): Promise<TestBook> {
        return openTestBook(name);
    }

    /** 第二次模型请求发出时先做 `during`，再让模型交卷。 */
    function stepsWith(during: () => Promise<void>): ScriptedInput[] {
        let release!: () => void;
        const gate = new Promise<void>(resolve => (release = resolve));
        return [
            [read("r1", {chapter: 38, paragraph: 55}, {chapter: 38, paragraph: 55})],
            {content: answer() as never, onRequest: () => void during().then(release), gate},
        ];
    }

    test("只删除：照常交卷，记录不保存，也不重新造出书目录", async () => {
        const target = await freshBook("qa-remove-only");
        try {
            const {outcome} = await askScripted(target, stepsWith(async () => void (await target.api.call("book.remove", {book: "fox"}))), {at: P});
            expect(outcome.result.status).toBe("answered");
            expect(outcome).toMatchObject({recordSaved: false, notSaved: {reason: "book_not_found"}});
            expect((await readdir(target.library)).filter(name => !name.startsWith(".") && name !== "library.json")).toEqual([]);
        } finally {
            await target.close();
        }
    });

    test("删除后同 id 重新导入；另一问先在新一代写下记录：旧问不保存，新一代只列另一问", async () => {
        const target = await freshBook("qa-remove-reimport");
        try {
            const small = join(target.root, "small.json");
            await writeFile(small, JSON.stringify(await smallDataset(40, "小书")));
            let other = "";
            const {outcome} = await askScripted(
                target,
                stepsWith(async () => {
                    await target.api.call("book.remove", {book: "fox"});
                    await target.api.call("book.import", {file: small, title: "小书", id: "fox"});
                    const another = await askScripted(target, [[read("r1", {chapter: 1, paragraph: 1}, {chapter: 1, paragraph: 1})], answer({evidence: ["1.1"]})], {at: {chapter: 2}});
                    other = another.outcome.result.id;
                }),
                {at: P},
            );
            expect(outcome.result.status).toBe("answered");
            expect(outcome.recordSaved).toBe(false);
            const {generation} = await target.api.library.readMeta("fox");
            expect((await new QaRecords(target.api.library, "fox").list(generation)).records.map(item => item.id)).toEqual([other]);
        } finally {
            await target.close();
        }
    });
});

describe("对话中途改阅读位置（输出 41，t25）", () => {
    /** 第一轮：P 是 38.57，读第 26 章前三段并交卷；返回对话 id。 */
    async function firstTurn(options: {mode?: "graph" | "full"} = {}) {
        const steps = options.mode === "full" ? [answer({evidence: ["1.1"]})] : [[read("r1", {chapter: 26, paragraph: 1}, {chapter: 26, paragraph: 3})], answer({evidence: ["26.1"]})];
        const first = await askScripted(book, steps, {at: P, question: "第一问", ...(options.mode === undefined ? {} : {mode: options.mode}), config: testConfig({maxChapters: 3})});
        expect(first.outcome.recordSaved).toBe(true);
        return first.outcome.result.id;
    }
    const records = () => new QaRecords(book.api.library, "fox");
    const generation = async () => (await book.api.library.readMeta("fox")).generation;
    const textOf = (message: {content: unknown}) => (typeof message.content === "string" ? message.content : (message.content as {text?: string}[]).map(block => block.text ?? "").join(""));

    test("提醒文字：往后调说可以访问，往回调说之后不能访问或引用；停在章末写“第 N 章”，否则写“N.M”", () => {
        const paragraphs = Array.from({length: 40}, () => 10);
        expect(positionReminder({chapter: 27, paragraph: 10}, {chapter: 40, paragraph: 10}, paragraphs)).toBe("<system-reminder>\n阅读位置从第 27 章改为第 40 章。你可以访问第 40 章及之前的内容了。\n</system-reminder>");
        expect(positionReminder({chapter: 40, paragraph: 10}, {chapter: 27, paragraph: 4}, paragraphs)).toBe("<system-reminder>\n阅读位置从第 40 章改为27.4。27.4之后的内容现在不能访问或引用，即使前面的对话里出现过也不要再用。\n</system-reminder>");
    });

    test("往后调：会话日志追加完整形状的提醒消息与紧跟的 meta，不发模型请求；下一问的请求里提醒与问题是同一条用户消息，能读新位置之前的章", async () => {
        const id = await firstTurn();
        const changed = await changePosition({api: book.api, book: undefined, conversation: id, at: {chapter: 40}});
        expect(changed.changed).toBe(true);
        expect(changed.conversation).toMatchObject({positionChanges: 1, currentAt: {chapter: 40}});
        // 会话日志：最后两条是 agent_message（user）与 meta，meta 紧跟其后；原来的一对被换成新的。
        const stored = await records().getWithLog(id, await generation());
        expect(stored.log.ok).toBe(true);
        const lines = (stored.log as {jsonl: string}).jsonl.trim().split("\n").map(line => JSON.parse(line) as {kind: string; seq: number; key?: string; value?: {chapter: number; from: {chapter: number}}; message?: {role: string; content: {text: string}[]}});
        const [reminder, meta] = lines.slice(-2);
        expect(reminder).toMatchObject({kind: "agent_message", message: {role: "user"}});
        expect(reminder!.message!.content[0]!.text).toContain("阅读位置从38.57改为第 40 章");
        expect(meta).toMatchObject({kind: "meta", key: POSITION_META_KEY, seq: reminder!.seq + 1, value: {chapter: 40, from: {chapter: 38, paragraph: 57}}});
        expect(await readdir(join(book.api.library.bookDir("fox"), "qa")).then(names => names.filter(name => name.startsWith(id)))).toHaveLength(2);

        // 下一问：40 章的段本来晚于 38.57 会被拒，现在能读；请求里提醒与问题合成一条 user，前面是上一轮的回答。
        const {model, outcome} = await askScripted(book, [[read("r1", {chapter: 40, paragraph: 1}, {chapter: 40, paragraph: 1})], answer({evidence: ["40.1"]})], {continueFrom: id, question: "第二问"});
        expect(toolResults(model, 1)[0]!.text.startsWith("没有读：")).toBe(false);
        const messages = model.requests[0]!.messages as {role: string; content: unknown}[];
        const last = messages.at(-1)!;
        expect(last.role).toBe("user");
        expect(textOf(last)).toContain("<system-reminder>");
        expect(textOf(last).endsWith("第二问")).toBe(true);
        expect(messages.at(-2)!.role).not.toBe("user");
        expect(outcome.result).toMatchObject({status: "answered", turn: 2, at: {chapter: 40}});
        const after = await records().get(id, await generation());
        expect(after.turns.at(-1)!.at).toMatchObject({chapter: 40});
        expect(after).toMatchObject({positionChanges: 1, currentAt: {chapter: 40}});
        // 开始时的位置与第一轮的位置不被改写。
        expect(after.at).toEqual(P);
        expect(after.turns[0]!.at).toEqual(P);
    });

    test("往回调：晚于新位置的读取与出处被拒，上一轮读过的第 26 章不再算读过；位置没变不写、全读对话不能改", async () => {
        const id = await firstTurn();
        expect((await changePosition({api: book.api, book: undefined, conversation: id, at: {chapter: 20}})).changed).toBe(true);
        const {model, outcome} = await askScripted(book, [[read("r1", {chapter: 26, paragraph: 1}, {chapter: 26, paragraph: 1})], answer({evidence: ["26.1"]}), answer({evidence: ["20.1"]})], {continueFrom: id, question: "回到前面"});
        expect(toolResults(model, 1)[0]!.isError).toBe(true);
        expect(toolResults(model, 1)[0]!.text).toContain("在阅读位置 20.");
        // 26.1 是上一轮读过的，但现在晚于位置：答案被退回；改引 20.1 时它也没读过，再被退回或最终以第三份为准——至少一次退回。
        expect(outcome.result.rejections).toBeGreaterThanOrEqual(1);
        // 同一位置再改：没变，不写、次数不增。
        const again = await changePosition({api: book.api, book: undefined, conversation: id, at: {chapter: 20}});
        expect(again.changed).toBe(false);
        expect((await records().get(id, await generation())).positionChanges).toBe(1);
        // 全读对话：位置不能改。
        const full = await firstTurn({mode: "full"});
        await expect(changePosition({api: book.api, book: undefined, conversation: full, at: {chapter: 20}})).rejects.toMatchObject({code: "qa_position_fixed"});
    });

    test("续问带 at：先改位置再运行这一轮；运行期间位置被别处改了，这一轮保存得到 conflict，改位置的那一对保留", async () => {
        const id = await firstTurn();
        const viaAsk = await askScripted(book, [answer({evidence: ["26.1"]})], {continueFrom: id, at: {chapter: 30}, question: "带位置的追问"});
        expect(viaAsk.outcome.recordSaved).toBe(true);
        expect(viaAsk.outcome.result.at).toMatchObject({chapter: 30});
        expect(viaAsk.outcome.conversation).toMatchObject({positionChanges: 1, currentAt: {chapter: 30}});
        // 准备一轮（此时位置改动次数是 1），别处又改了位置，再运行：保存 conflict。
        const {prepared} = await prepareScripted(book, [answer({evidence: ["26.1"]})], {continueFrom: id, question: "撞车的追问"});
        await changePosition({api: book.api, book: undefined, conversation: id, at: {chapter: 35}});
        const outcome = await prepared.run();
        expect(outcome.recordSaved).toBe(false);
        expect(outcome).toMatchObject({notSaved: {reason: "conflict"}});
        const kept = await records().get(id, await generation());
        expect(kept).toMatchObject({positionChanges: 2, currentAt: {chapter: 35}});
        expect(kept.turns).toHaveLength(2);
    });

    test("续问带 at 的一问没开始就放弃：位置、提醒与记录都不变；带 at 准备后别处改了位置，这一问保存得到 conflict，不按别处的位置悄悄运行", async () => {
        const id = await firstTurn();
        const before = await records().getWithLog(id, await generation());
        const {prepared} = await prepareScripted(book, [answer({evidence: ["26.1"]})], {continueFrom: id, at: {chapter: 30}, question: "要放弃的追问"});
        expect(prepared.at).toMatchObject({chapter: 30});
        await prepared.abandon();
        const after = await records().getWithLog(id, await generation());
        expect(after.conversation).toEqual(before.conversation);
        expect(after.log).toEqual(before.log);

        const second = await prepareScripted(book, [answer({evidence: ["26.1"]})], {continueFrom: id, at: {chapter: 30}, question: "撞车的追问"});
        await changePosition({api: book.api, book: undefined, conversation: id, at: {chapter: 35}});
        const outcome = await second.prepared.run();
        expect(outcome).toMatchObject({recordSaved: false, notSaved: {reason: "conflict"}});
        const kept = await records().get(id, await generation());
        expect(kept).toMatchObject({positionChanges: 1, currentAt: {chapter: 35}});
        expect(kept.turns).toHaveLength(1);
    });
});

describe("对话与追问（输出 5、26，验收 14、15、17）", () => {
    /** 第一轮：`maxChapters` 为 1 的对话，读第 26 章前三段并交卷。 */
    async function firstTurn() {
        const first = await askScripted(book, [[read("r1", {chapter: 26, paragraph: 1}, {chapter: 26, paragraph: 3})], answer({evidence: ["26.1"], conclusion: "第一轮独有的结论"})], {at: P, question: "第一问", config: testConfig({maxChapters: 1})});
        expect(first.outcome.recordSaved).toBe(true);
        return first.outcome.result.id;
    }
    // 建对话之后把上限改成 2：续问仍按对话开始时的 1 计。
    const later = testConfig({maxChapters: 2});

    test("第二轮不读原文，直接引用第一轮读过的段交卷；请求里有第一轮的问答", async () => {
        const id = await firstTurn();
        const {model, outcome} = await askScripted(book, [answer({evidence: ["26.2"]})], {continueFrom: id, question: "她后来呢", config: later});
        // 第二轮第一次请求的历史：第一轮的问题、read 调用与结果、answer 调用（带第一轮的结论）与它的结果，按原样配对。
        const messages = model.requests[0]!.messages as {role: string; content: unknown; toolCallId?: string}[];
        const calls = messages.flatMap(message => (message.role === "assistant" && Array.isArray(message.content) ? (message.content as {type: string; id: string; name: string; arguments: Record<string, unknown>}[]) : [])).filter(block => block.type === "toolCall");
        const resultOf = (id: string) => messages.find(message => message.role === "toolResult" && message.toolCallId === id);
        expect(messages[0]).toMatchObject({role: "user", content: "第一问"});
        expect(calls.map(call => call.name)).toEqual(["read", "answer"]);
        expect(calls[1]!.arguments).toMatchObject({conclusion: "第一轮独有的结论", evidence: ["26.1"]});
        expect(calls.every(call => resultOf(call.id) !== undefined)).toBe(true);
        expect(messages.at(-1)).toMatchObject({role: "user", content: "她后来呢"});
        expect(outcome.result).toMatchObject({status: "answered", rejections: 0, turn: 2, id, chaptersRead: []});
        const records = new QaRecords(book.api.library, "fox");
        const stored = await records.get(id, (await book.api.library.readMeta("fox")).generation);
        expect(stored.turns.map(turn => turn.question)).toEqual(["第一问", "她后来呢"]);
    });

    test("第二轮再读上一轮的章照常、读一个新章照常，第二个新章被拒（上限仍是 1）", async () => {
        const id = await firstTurn();
        const {model, outcome} = await askScripted(
            book,
            [[read("r1", {chapter: 26, paragraph: 4}, {chapter: 26, paragraph: 4})], [read("r2", {chapter: 25, paragraph: 1}, {chapter: 25, paragraph: 1})], [read("r3", {chapter: 24, paragraph: 1}, {chapter: 24, paragraph: 1})], answer({evidence: ["25.1", "26.4"]})],
            {continueFrom: id, config: later},
        );
        expect([1, 2, 3].map(request => toolResults(model, request)[0]!.text.startsWith("没有读："))).toEqual([false, false, true]);
        expect(toolResults(model, 3)[0]!.text).toContain("前几轮读过的 26 章不算");
        expect(outcome.result).toMatchObject({status: "answered", chaptersRead: [25]});
    });

    test("第二轮取消：中断的一轮记下来，之后还能第三轮追问", async () => {
        const id = await firstTurn();
        const controller = new AbortController();
        let release!: () => void;
        const gate = new Promise<void>(resolve => (release = resolve));
        const second = await askScripted(book, [{content: "不会到这里", onRequest: () => (controller.abort(), release()), gate}], {continueFrom: id, signal: controller.signal});
        expect(second.outcome.result).toMatchObject({status: "interrupted", turn: 2});
        expect(second.outcome.recordSaved).toBe(true);

        const third = await askScripted(book, ["还在"], {continueFrom: id, question: "第三问"});
        expect(third.outcome.result).toMatchObject({status: "answered", turn: 3, reply: {text: "还在"}});
    });

    test("读过的段跨轮：同章只读了第 1、3 段，第二轮引用第 2 段被退回", async () => {
        const first = await askScripted(book, [[read("r1", {chapter: 38, paragraph: 1}, {chapter: 38, paragraph: 1})], [read("r2", {chapter: 38, paragraph: 3}, {chapter: 38, paragraph: 3})], answer({evidence: ["38.1"]})], {at: P});
        const {model, outcome} = await askScripted(book, [answer({evidence: ["38.2"]}), answer({evidence: ["38.1", "38.3"]})], {continueFrom: first.outcome.result.id});
        expect(toolResults(model, 1)[0]!.text).toContain("38.2");
        expect(outcome.result).toMatchObject({status: "answered", rejections: 1});
    });

    test("全读的第二轮不读原文：引用 P 以前任意段通过，晚于 P 被退回", async () => {
        const first = await askScripted(book, [answer({evidence: ["1.1"]})], {at: P, mode: "full"});
        const {model, outcome} = await askScripted(book, [answer({evidence: ["38.58"]}), answer({evidence: ["20.3—20.5", "38.57"]})], {continueFrom: first.outcome.result.id});
        expect(toolResults(model, 1)[0]!.text).toContain("晚于阅读位置 38.57");
        expect(outcome.result).toMatchObject({status: "answered", rejections: 1, mode: "full"});
    });

    test("不能续问（F8）：Profile 版本 1 的旧记录、日志被改过、日志不在了，都不发请求、文件不变", async () => {
        const first = await askScripted(book, ["第一轮"], {at: P});
        const conversation = first.outcome.conversation;
        const dir = join(book.api.library.bookDir("fox"), "qa");
        const logPath = join(dir, conversation.log!.file);
        const original = await readFile(logPath, "utf8");

        // 目录里每个文件的名字、大小与修改时间（没有读权限的文件也能 stat）：失败的续问不改任何文件。
        const files = async () => Promise.all((await readdir(dir)).sort().map(async name => {
            const info = await stat(join(dir, name));
            return [name, info.size, info.mtimeMs] as const;
        }));
        const attempt = async () => {
            const before = await files();
            let error: unknown;
            const model = {requests: 0};
            try {
                await askScripted(book, [{content: "不该请求", onRequest: () => void (model.requests += 1)}], {continueFrom: conversation.id});
            } catch (caught) {
                error = caught;
            }
            expect(error).toBeInstanceOf(QaError);
            expect((error as QaError).code).toBe("qa_not_continuable");
            expect(model.requests).toBe(0);
            expect(await files()).toEqual(before);
        };

        await chmod(logPath, 0o000);
        try {
            await attempt();
        } finally {
            await chmod(logPath, 0o644);
        }
        await writeFile(logPath, original.replace("第一轮", "第一轮。"));
        await attempt();
        await rm(logPath);
        await attempt();

        // 这项改动之前的一问一条的记录：会话快照是 Profile 版本 1。
        const legacyId = newQaRecordId(new Date("2026-10-16T10:00:00Z"));
        const {reply: _reply, ...turn} = conversation.turns[0]!;
        await writeFile(join(dir, `${legacyId}.json`), JSON.stringify({id: legacyId, book: "fox", generation: conversation.generation, at: conversation.at, mode: "graph", ...turn, answer: null, status: "failed", error: {code: "no_answer", message: "旧"}}));
        await writeFile(join(dir, `${legacyId}.session.jsonl`), original.replace(/"key":"story-qa","version":"\d+"/u, '"key":"story-qa","version":"1"'));
        const before = await readFile(join(dir, `${legacyId}.json`), "utf8");
        let error: unknown;
        try {
            await askScripted(book, ["不该请求"], {continueFrom: legacyId});
        } catch (caught) {
            error = caught;
        }
        expect((error as QaError).code).toBe("qa_not_continuable");
        expect(await readFile(join(dir, `${legacyId}.json`), "utf8")).toBe(before);
    });
});

describe("网页问答用的观察与轮次（t13）", () => {
    async function storedLog(id: string): Promise<{seq: number; kind: string; text: string}[]> {
        const generation = (await book.api.library.readMeta("fox")).generation;
        const {log} = await new QaRecords(book.api.library, "fox").getWithLog(id, generation);
        if (!log.ok) throw new Error(log.problem);
        return log.jsonl.split("\n").filter(Boolean).map(line => {
            const entry = JSON.parse(line) as {seq: number; kind: string};
            return {seq: entry.seq, kind: entry.kind, text: line};
        });
    }

    test("新对话用给定的 id；日志条目按写入顺序转发、与保存的日志一致；事件只留网页用的几种、不带半截消息的副本；logFrom 是 1", async () => {
        const id = newQaRecordId(new Date());
        const entries: number[] = [];
        const events: string[] = [];
        const {outcome} = await askScripted(book, [[read("r1", {chapter: 38, paragraph: 1}, {chapter: 38, paragraph: 57})], answer()], {
            at: P,
            conversationId: id,
            onLogEntries: batch => entries.push(...batch.map(entry => entry.seq)),
            onAgentEvent: event => events.push(JSON.stringify(event)),
        });
        expect(outcome.result).toMatchObject({id, status: "answered", logFrom: 1});
        expect(entries).toEqual((await storedLog(id)).map(entry => entry.seq));
        const types = new Set(events.map(event => (JSON.parse(event) as {type: string}).type));
        expect([...types].every(type => ["agent_start", "agent_end", "message_start", "message_update", "tool_execution_start", "tool_execution_end"].includes(type))).toBe(true);
        expect(types.has("tool_execution_end")).toBe(true);
        expect(events.some(event => event.includes("assistantMessageEvent"))).toBe(false);
        // 工具结果只留开头一段：读原文的结果整份在日志里。
        const ends = events.map(event => JSON.parse(event) as {type: string; result?: {content: {text: string}[]}}).filter(event => event.type === "tool_execution_end");
        expect(ends.every(event => event.result!.content[0]!.text.length <= EVENT_RESULT_CHARS + 1)).toBe(true);
        expect(ends.some(event => event.result!.content[0]!.text.endsWith("…"))).toBe(true);
    });

    test("缺密钥的首轮在写用户消息之前就失败，也记 logFrom；续问的一轮按 logFrom 对得上它自己的提问", async () => {
        const base = testConfig();
        const unset = {...base, providers: {test: {...base.providers!.test!, apiKeyEnv: "NBSTORY_QA_TEST_UNSET_CREDENTIAL"}}};
        const first = await askScripted(book, [answer()], {at: P, question: "缺密钥的第一问", config: unset});
        expect(first.outcome.result).toMatchObject({status: "failed", logFrom: 1});
        const id = first.outcome.result.id;
        const before = (await storedLog(id)).length;
        const continued: number[] = [];
        const second = await askScripted(book, [answer({evidence: [], conclusionType: "无法确定"})], {continueFrom: id, question: "第二问", onLogEntries: batch => continued.push(...batch.map(entry => entry.seq))});
        expect(second.outcome.result).toMatchObject({status: "answered", logFrom: before + 1});
        // 只转发这一轮新写的条目；这一轮的第一条用户消息是“第二问”。
        expect(continued[0]).toBe(before + 1);
        const log = await storedLog(id);
        const firstUser = log.find(entry => entry.seq >= before + 1 && entry.kind === "agent_message" && entry.text.includes("\"role\":\"user\""));
        expect(firstUser?.text).toContain("第二问");
        expect(log.filter(entry => entry.seq < before + 1).some(entry => entry.text.includes("\"role\":\"user\""))).toBe(false);
    });

    test("观察者抛错不影响这一轮的结果与保存", async () => {
        const {outcome} = await askScripted(book, [answer({evidence: [], conclusionType: "无法确定"})], {
            at: P,
            onLogEntries: () => {
                throw new Error("页面断开了");
            },
            onAgentEvent: () => {
                throw new Error("页面断开了");
            },
        });
        expect(outcome.result.status).toBe("answered");
        expect(outcome.recordSaved).toBe(true);
    });

    test("先准备再运行：准备好就知道 id、第几轮与日志起点，和运行结果一致；放弃的一轮不发请求、不写记录，也不能再运行", async () => {
        const first = await askScripted(book, [answer({evidence: [], conclusionType: "无法确定"})], {at: P});
        const id = first.outcome.result.id;
        const before = (await storedLog(id)).length;

        const abandoned = await prepareScripted(book, ["不该请求"], {continueFrom: id, question: "放弃的一问"});
        expect({id: abandoned.prepared.id, turn: abandoned.prepared.turn, logFrom: abandoned.prepared.logFrom}).toEqual({id, turn: 2, logFrom: before + 1});
        await abandoned.prepared.abandon();
        expect(abandoned.model.requests).toHaveLength(0);
        expect(await abandoned.prepared.run().then(() => "ran", () => "rejected")).toBe("rejected");
        expect((await storedLog(id)).length).toBe(before);

        const {prepared} = await prepareScripted(book, [answer({evidence: [], conclusionType: "无法确定"})], {continueFrom: id, question: "第二问"});
        const outcome = await prepared.run();
        expect(outcome.result).toMatchObject({id: prepared.id, turn: prepared.turn, logFrom: prepared.logFrom, status: "answered"});
    });

    test("全读去原文按“开头 + 原文 + 这一轮的问题”整个对上才换：段落里有空行也不截错，问题对不上的原样留着", () => {
        const user = (text: string) => ({kind: "agent_message", seq: 2, at: "2026-10-23T00:00:00.000Z", message: {role: "user", content: [{type: "text", text}], timestamp: 1}}) as const;
        const text = "以下是阅读位置以前的全部原文：\n1.1 第一段\n1.2 引用里写着\n\n问题：不是真问题\n1.3 第三段\n\n问题：真问题";
        const projected = withoutFullText(user(text), "真问题") as unknown as {message: {content: {text: string}[]}};
        expect(projected.message.content[0]!.text).toBe("真问题\n\n（已附阅读位置以前的全部原文，共 3 段，这里不显示）");
        expect(withoutFullText(user(text), "别的问题")).toEqual(user(text));
    });
});

async function storedEntries(id: string): Promise<{seq: number; kind: string; key?: string; value?: unknown; tools?: {name: string}[]}[]> {
    const generation = (await book.api.library.readMeta("fox")).generation;
    const {log} = await new QaRecords(book.api.library, "fox").getWithLog(id, generation);
    if (!log.ok) throw new Error(log.problem);
    return log.jsonl.split("\n").filter(Boolean).map(line => JSON.parse(line) as never);
}

describe("过程里不剧透（输出 12，issue 265）", () => {
    // 夏桃桃第 60 章之后才出场，阅读位置 38.57 之前搜不到；苏天晴在位置之前就有。
    const later = "夏桃桃";
    const steps = (): ScriptedInput[] => [
        [toolCall("s1", "search", {query: later}), toolCall("s2", "card", {entity: later}), toolCall("s3", "search", {query: `苏天晴 ${later}`}), toolCall("s4", "search", {query: "苏天晴"})],
        [read("r1", {chapter: 38, paragraph: 55}, {chapter: 38, paragraph: 55})],
        answer(),
    ];
    const toolTexts = (progress: {kind: string; text?: string}[]) => progress.filter(event => event.kind === "tool").map(event => event.text);

    test("设了阅读位置：进度、网页的日志与事件里没有位置之前搜不到的词；位置之前搜得到的照常显示；模型与存下的日志不变", async () => {
        const id = newQaRecordId(new Date());
        const entries: string[] = [];
        const events: string[] = [];
        const {progress, model} = await askScripted(book, steps(), {at: P, conversationId: id, onLogEntries: batch => entries.push(...batch.map(entry => JSON.stringify(entry))), onAgentEvent: event => events.push(JSON.stringify(event))});
        expect(toolTexts(progress).slice(0, 4)).toEqual(["搜索：（阅读位置之前没有结果）", "查人物卡：（阅读位置之前没有结果）", "搜索：（阅读位置之前没有结果）", "搜索：苏天晴"]);
        expect(JSON.stringify(progress)).not.toContain(later);
        expect(entries.join("")).not.toContain(later);
        expect(events.join("")).not.toContain(later);
        // 模型自己写的参数它自己看得到，续问也要原样交回；只改了给人看的那一份。
        expect(JSON.stringify(model.requests[1]!.messages)).toContain(later);
        const stored = await new QaRecords(book.api.library, "fox").getWithLog(id, (await book.api.openBook("fox")).generation);
        expect(stored.log.ok && stored.log.jsonl.includes(later)).toBe(true);
    });

    test("没设阅读位置（默认在最后一段）：没有可剧透的内容，进度原样", async () => {
        const {progress} = await askScripted(book, steps(), {});
        expect(toolTexts(progress).slice(0, 2)).toEqual([`搜索：${later}`, `查人物卡：${later}`]);
    });

    test("思考块不给网页：设了阅读位置时日志与事件里没有思考文字", async () => {
        const entries: string[] = [];
        const events: string[] = [];
        await askScripted(book, [[{type: "thinking", thinking: "这是六耳猕猴的事"} as never, read("r1", {chapter: 38, paragraph: 55}, {chapter: 38, paragraph: 55})], answer()], {at: P, onLogEntries: batch => entries.push(...batch.map(entry => JSON.stringify(entry))), onAgentEvent: event => events.push(JSON.stringify(event))});
        expect(entries.join("")).not.toContain("六耳猕猴");
        expect(events.join("")).not.toContain("六耳猕猴");
    });
});

describe("Markdown 作答与出处复查（t16）", () => {
    const markdown = {answer: "markdown" as const};
    const read55 = [read("r1", {chapter: 38, paragraph: 55}, {chapter: 38, paragraph: 55})];
    const toolNames = (model: {requests: readonly {tools?: readonly {name: string}[]}[]}, request: number) => (model.requests[request]!.tools ?? []).map(tool => tool.name);

    test("Markdown 对话：模型看不到 answer，规则写 Markdown；出处都读过时不复查；续问仍没有 answer", async () => {
        const {model, outcome, progress} = await askScripted(book, [read55, "结论：她就是地狱猫（38.55）。"], {at: P, ...markdown});
        expect(toolNames(model, 0)).not.toContain("answer");
        expect(toolNames(model, 0)).toContain("read");
        const system = [model.requests[0]!.systemPrompt ?? []].flat().join("\n");
        expect(system).toContain("直接用 Markdown 写回答");
        expect(system).not.toContain("用 answer 工具交答案");
        expect(outcome.result).toMatchObject({status: "answered", answer: null, reply: {text: "结论：她就是地狱猫（38.55）。", unverifiedRefs: []}});
        expect(outcome.result).not.toHaveProperty("recheck");
        expect(outcome.conversation.answer).toBe("markdown");
        expect(model.requests).toHaveLength(2);
        expect(progress.some(event => event.kind === "recheck")).toBe(false);
        const entries = await storedEntries(outcome.result.id);
        expect(entries[0]!.tools!.map(tool => tool.name)).not.toContain("answer");

        const second = await askScripted(book, ["接着说（38.55）。"], {continueFrom: outcome.result.id, question: "然后呢"});
        expect(toolNames(second.model, 0)).not.toContain("answer");
        expect(second.outcome.result).toMatchObject({status: "answered", turn: 2, reply: {unverifiedRefs: []}});
    });

    test("结构化对话照旧有 answer；配置的 qa.answer 决定新对话的作答方式", async () => {
        const structured = await askScripted(book, [read55, answer()], {at: P});
        expect(toolNames(structured.model, 0)).toContain("answer");
        expect(structured.outcome.conversation.answer).toBe("structured");
        const byConfig = await askScripted(book, ["你好，我能回答这本书的问题。"], {at: P, config: testConfig({answer: "markdown"})});
        expect(toolNames(byConfig.model, 0)).not.toContain("answer");
    });

    test("复查后改对：同一个 harness 再跑一次，第二次的回复是结果；日志里有复查的 meta；事件只处理一遍", async () => {
        const {model, outcome, progress} = await askScripted(
            book,
            [read55, {content: "她是地狱猫（38.55、38.56）。", usage: {input: 10, output: 5}}, [read("r2", {chapter: 38, paragraph: 56}, {chapter: 38, paragraph: 56})], {content: "她是地狱猫（38.55、38.56），核对过了。", usage: {input: 20, output: 7}}],
            {at: P, ...markdown},
        );
        expect(outcome.result).toMatchObject({status: "answered", reply: {text: "她是地狱猫（38.55、38.56），核对过了。", unverifiedRefs: []}, recheck: {unverified: 1, outcome: "rewritten"}});
        expect(progress.filter(event => event.kind === "recheck")).toEqual([{kind: "recheck", refs: ["38.56"]}]);
        // 两次 read 各一条进度：订阅不随第二次 turn 叠加。
        expect(progress.filter(event => event.kind === "tool")).toHaveLength(2);
        const recheck = model.requests[2]!.messages.at(-1) as {role: string; content: string};
        expect(recheck.role).toBe("user");
        expect(recheck.content).toContain("出处检查");
        expect(recheck.content).toContain("38.56");
        expect(outcome.result.usage.input).toBeGreaterThanOrEqual(30);
        const entries = await storedEntries(outcome.result.id);
        expect(entries.filter(entry => entry.kind === "meta")).toMatchObject([{key: "nb-story.reply-check", value: {unverified: ["38.56"]}}]);
    });

    test("复查后仍不对：照旧标出没核实的出处；只复查一次", async () => {
        const {model, outcome} = await askScripted(book, [read55, "她是地狱猫（38.56）。", "她还是地狱猫（38.56）。"], {at: P, ...markdown});
        expect(outcome.result).toMatchObject({status: "answered", reply: {text: "她还是地狱猫（38.56）。", unverifiedRefs: ["38.56"]}, recheck: {unverified: 1, outcome: "rewritten"}});
        expect(model.requests).toHaveLength(3);
    });

    test("复查那一次出错：保留第一次的回复，记下复查没完成", async () => {
        const {outcome} = await askScripted(book, [read55, "她是地狱猫（38.56）。", {content: "", stopReason: "error", error: {message: "上游断开"}}], {at: P, ...markdown});
        expect(outcome.result).toMatchObject({status: "answered", error: null, reply: {text: "她是地狱猫（38.56）。", unverifiedRefs: ["38.56"]}, recheck: {unverified: 1, outcome: "failed"}});
        expect(outcome.recordSaved).toBe(true);
    });

    test("复查那一次被取消：保留第一次的回复，记下取消", async () => {
        const controller = new AbortController();
        let release = (): void => undefined;
        const gate = new Promise<void>(resolve => (release = resolve));
        const {outcome} = await askScripted(book, [read55, "她是地狱猫（38.56）。", {content: "不会到这里", onRequest: () => (controller.abort(), release()), gate}], {at: P, ...markdown, signal: controller.signal});
        expect(outcome.result).toMatchObject({status: "answered", reply: {text: "她是地狱猫（38.56）。"}, recheck: {unverified: 1, outcome: "aborted"}});
    });

    test("结构化对话的文字回复不复查", async () => {
        const {model, outcome} = await askScripted(book, ["她是地狱猫（38.56）。"], {at: P});
        expect(outcome.result).toMatchObject({status: "answered", reply: {unverifiedRefs: ["38.56"]}});
        expect(outcome.result).not.toHaveProperty("recheck");
        expect(model.requests).toHaveLength(1);
    });
});

describe("每一轮的模型（t16）", () => {
    const two = (() => {
        const base = testConfig();
        return {...base, providers: {test: {...base.providers!.test!, models: [{id: "scripted"}, {id: "other"}]}}, models: ["test/scripted", "test/other"]};
    })();

    test("这一轮按选的模型跑，记录写引用；续问没选就接着用上一轮的（只给推理档也是），选了就换", async () => {
        const first = await askScripted(book, [answer()], {at: P, config: two, model: {model: "test/other"}});
        expect(first.outcome.result.model).toBe("test/other");
        const second = await askScripted(book, [answer()], {continueFrom: first.outcome.result.id, config: two});
        expect(second.outcome.result.model).toBe("test/other");
        const thinkingOnly = await askScripted(book, [answer()], {continueFrom: first.outcome.result.id, config: two, model: {thinking: "high"}});
        expect(thinkingOnly.outcome.result.model).toBe("test/other");
        const third = await askScripted(book, [answer()], {continueFrom: first.outcome.result.id, config: two, model: {model: "test/scripted"}});
        expect(third.outcome.result.model).toBe("test/scripted");
    });

    test("不在候选里的模型：开始前报 qa_unconfigured，不发请求", async () => {
        const failure = await askScripted(book, [answer()], {at: P, config: two, model: {model: "test/missing"}}).catch((error: unknown) => error);
        expect((failure as QaError).code).toBe("qa_unconfigured");
    });

    test("早先版本的 Profile 开始的对话不能续问", () => {
        const snapshot = {kind: "session_snapshot", seq: 1, at: "2026-10-01T00:00:00.000Z", profile: {key: "story-qa", version: "3"}, initial: {}, tools: []} as const;
        expect(continuationProblem(snapshot)).toContain("早先版本");
        expect(continuationProblem({...snapshot, profile: {key: "story-qa", version: "4"}})).toBeNull();
        expect(continuationProblem(undefined)).toContain("没有快照");
    });

    test("同一对话来回换接口：Chat Completions、Responses、再回 Chat，请求照发，第一轮的日志不变", async () => {
        const endpoint = startEndpoint([{kind: "text", text: "第一轮"}, {kind: "text", text: "第二轮"}, {kind: "text", text: "第三轮"}]);
        try {
            process.env[TEST_KEY_ENV] ??= "scripted-model-placeholder";
            const provider = {baseUrl: endpoint.url, apiKeyEnv: TEST_KEY_ENV, models: [{id: "m"}]};
            const config = {providers: {chat: {...provider, api: "openai-completions" as const}, resp: {...provider, api: "openai-responses" as const}}, models: ["chat/m", "resp/m"], model: {use: "chat/m"}, qa: {answer: "markdown" as const}};
            const ask = (question: string, ref: string, continueFrom?: string) => askQuestion({api: book.api, at: P, mode: "graph", question, config, model: {model: ref}, ...(continueFrom === undefined ? {} : {continueFrom, at: undefined})});
            const first = await ask("一", "chat/m");
            const id = first.result.id;
            const afterFirst = await storedEntries(id);
            const second = await ask("二", "resp/m", id);
            const third = await ask("三", "chat/m", id);
            expect([first, second, third].map(outcome => outcome.result.reply?.text)).toEqual(["第一轮", "第二轮", "第三轮"]);
            expect(endpoint.bodies.map(body => ("input" in body ? "responses" : "messages" in body ? "chat" : "?"))).toEqual(["chat", "responses", "chat"]);
            expect((await storedEntries(id)).slice(0, afterFirst.length)).toEqual(afterFirst);
        } finally {
            endpoint.stop();
        }
    });
});
