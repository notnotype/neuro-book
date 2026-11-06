import {describe, expect, test} from "bun:test";

import type {Mark, TellingDraft} from "@notnotype/nb-canon/schema";

import type {SelfReport} from "../../shared/checks";
import {CHECK_DIAGNOSTIC_IDS as CHECK, DECISION_DIAGNOSTIC_IDS as DECISION, FS_DIAGNOSTIC_IDS as FS, MARK_IDS} from "../../shared/declarations";
import type {InstructionSnapshot} from "../../shared/instructions";
import {addRow, chapter, drafts, PlotWorld, present} from "../../testing/world";
import {failure, planOf, reported, ruleIds, run, runOk, scripted, USAGE} from "../../testing/checks";
import {badQuotesOf, checkDiagnostics} from "./diagnostics";
import {createLimiter} from "./run";
import {isValid} from "./validity";
import {digest} from "../../testing/checks";

const CHAPTERS = Array.from({length: 22}, (_, index) => `ch${String(index + 1)}`);
const reveal = (point: string, mode: "hint" | "explicit"): Mark => ({kind: MARK_IDS.reveal, version: 1, point, mode});
const node = (foreshadow: string, role: string): Mark => ({kind: MARK_IDS.node, version: 1, foreshadow, role});
const inText = (w: PlotWorld, chapterId: string, quote: string, marks: Mark[] = []): TellingDraft => {
    w.texts.set(chapterId, `${w.texts.get(chapterId) ?? ""}${quote}。\n`);
    return {source: "chapter", chapter: chapterId, quote, ...(marks.length === 0 ? {} : {marks})};
};
const instruction = (chapterId: string, extra: Partial<InstructionSnapshot> = {}): InstructionSnapshot => ({chapter: chapterId, version: "v1", ...extra});
const selfReport = (chapterId: string, names: string[] = []): SelfReport => ({chapter: chapterId, brief: "写手的上下文", report: {names, unsure: [], deviations: []}});

const SLIP = "卫兵盯着旅人的左手，说：你是勇者吧";
function guardScene() {
    const w = new PlotWorld(CHAPTERS);
    const hero = w.person("勇者");
    const guard = w.person("卫兵");
    const k = w.point("勇者左手有星形的疤", hero, {保密: "secret"});
    w.texts.set("ch4", `${SLIP}。\n`);
    w.change(chapter("ch4"), {cast: [present(guard)]});
    return {w, hero, guard, k};
}
const presenceYes = (request: {user: string; answer: string}) => (request.answer === "yesNo" && request.user.includes("把这件事当真") ? {answer: "yes", quotes: [SLIP]} : undefined);

describe("验收 1：卫兵认出勇者", () => {
    test("在场层答“有”并引原句，进一条可能穿帮；改正文没重跑只报要重跑；重跑以后消失", async () => {
        const {w, guard, k} = guardScene();
        const first = await runOk(w, "ch4", scripted((_, request) => presenceYes(request)).models);
        const slips = reported(w, [first])[CHECK.possibleSlip]!;
        expect(slips.length).toBe(1);
        expect(slips[0]).toMatchObject({key: {objects: [{kind: "entry", id: k}], line: "main", range: {from: "ch4", to: "ch4"}, detail: "main#1"}, objects: [{kind: "entry", id: k}, {kind: "entry", id: guard}], params: {people: "卫兵", quotes: SLIP}});
        expect(reported(w, [first])[CHECK.stale]).toBeUndefined();

        w.texts.set("ch4", "卫兵例行盘问，放勇者进了城。\n");
        const stale = reported(w, [first]);
        expect(Object.keys(stale)).toEqual([CHECK.stale]);
        expect(stale[CHECK.stale]![0]!.key).toEqual({range: {from: "ch4", to: "ch4"}});

        const second = await runOk(w, "ch4", scripted().models);
        expect(reported(w, [second])).toEqual({});
    });

    test("本章之后的世界变了，记录仍有效；条件变了才过期；检查进行中世界变了，记录照存、判过期", async () => {
        const {w, guard, k} = guardScene();
        const record = await runOk(w, "ch4", scripted((_, request) => presenceYes(request)).models);
        const later = w.person("后来者");
        w.change(chapter("ch9"), {cast: [present(later), present(guard)], patches: [addRow(later, k, {程度: "knows", 怎么知道: "witnessed"})]});
        expect(reported(w, [record])[CHECK.possibleSlip]).toBeDefined();
        w.change(chapter("ch2"), {patches: [addRow(guard, k, {程度: "knows", 怎么知道: "witnessed"})]});
        expect(Object.keys(reported(w, [record]))).toEqual([CHECK.stale]);

        const moving = guardScene();
        const during = await runOk(moving.w, "ch4", scripted((_, request) => {
            if (request.answer === "fixed") moving.w.change(chapter("ch3"), {patches: [addRow(moving.guard, moving.k, {程度: "knows", 怎么知道: "witnessed"})]});
            return undefined;
        }).models);
        expect(during.chapter).toBe("ch4");
        expect(isValid({view: moving.w.view(), record: during, digest})).toBe(false);
    });

    test("同一段同一知识点的几条合成一项，列出各层与人；只在段的线上、不晚于读取位置的报；误信的另问单独算一个调用", async () => {
        const w = new PlotWorld(CHAPTERS);
        const hero = w.person("勇者");
        const [guard, maid, liar] = [w.person("卫兵"), w.person("侍女"), w.person("骗子")];
        const k = w.point("勇者左手有星形的疤", hero, {保密: "secret"});
        w.change(chapter("ch1"), {patches: [addRow(liar, k, {程度: "misbelieves", 他以为的: "疤在右手"})]});
        w.texts.set("ch4", `${SLIP}。\n`);
        w.change(chapter("ch4"), {cast: [present(guard), present(maid), present(liar), present(hero)]});
        const record = await runOk(w, "ch4", scripted((_, request) => (request.answer === "yesNo" && !request.user.includes("时间") ? {answer: "yes", quotes: [SLIP]} : undefined)).models);
        expect(record.calls.filter((call) => call.layer === "presence").length).toBe(5);
        expect(record.calls.filter((call) => call.contradicts === true).length).toBe(1);
        const slips = reported(w, [record])[CHECK.possibleSlip]!;
        expect(slips.length).toBe(1);
        expect(String(slips[0]!.params.people).split("、").sort()).toEqual(["侍女", "勇者", "卫兵", "骗子"].sort());
        expect(reported(w, [record], {}, "ch3")).toEqual({});
    });
});

describe("验收 2：试读与泄底", () => {
    function baron() {
        const w = new PlotWorld(CHAPTERS);
        const butler = w.person("管家");
        const k = w.point("管家是凶手", butler, {保密: "secret", 读者问题: "谁杀了男爵"});
        const fs = w.foreshadow("真凶之谜", {种类: "mystery", 答案: {ref: k}});
        w.change(chapter("ch3"), {told: [inText(w, "ch3", "男爵死在书房", [node(fs, "plant")])]});
        w.change(chapter("ch12"), {told: [inText(w, "ch12", "管家擦拭沾血的手套")]});
        w.change(chapter("ch20"), {kind: "plan", told: [{source: "outline", chapter: "ch20", anchor: "细纲", marks: [reveal(k, "explicit")]}]});
        return {w, k, butler};
    }
    const trial = (confidence: string) => (role: string, request: {answer: string}) => (role === "reader" ? {guess: "管家", confidence, quotes: ["管家擦拭沾血的手套"]} : request.answer === "judge" ? {verdict: "consistent"} : undefined);

    test("强烈倾向且判一致：提前泄底，附上读者守卫与挂在 K 上的决策；判一致的输入只有答案与命题", async () => {
        const {w, k} = baron();
        const guardDecision = w.decision("第 20 章之前不能让读者猜到", {about: [{kind: "entry", id: k}], conclusion: "瞒到第 20 章"});
        const {models, asked} = scripted(trial("strong"));
        const record = await runOk(w, "ch12", models);
        const [found] = reported(w, [record])[CHECK.earlyReveal]!;
        expect(found).toMatchObject({key: {objects: [{kind: "entry", id: k}], range: {from: "ch12", to: "ch12"}}, params: {guess: "管家", confidence: "strong", verdict: "consistent"}});
        expect(found!.objects).toContainEqual({kind: "decision", id: guardDecision});
        const judge = asked.find((call) => call.request.answer === "judge")!;
        expect(judge.role).toBe("ledger");
        expect(judge.request.user).toContain("管家是凶手");
        expect(judge.request.user).not.toContain("沾血的手套");
        expect(judge.request.user).not.toContain("男爵死在书房");
        expect(asked.find((call) => call.role === "reader")!.request.user).not.toContain("管家是凶手");
        expect(record.usage).toMatchObject({trial: 1, judge: 1, fixed: 1});
    });

    test("有点怀疑、判不一致、看不出的都不报；看不出的不判一致；引文对不上按看不出", async () => {
        const a = baron();
        const slight = await runOk(a.w, "ch12", scripted(trial("slight")).models);
        expect(reported(a.w, [slight])[CHECK.earlyReveal]).toBeUndefined();
        const b = baron();
        const wrong = await runOk(b.w, "ch12", scripted((role, request) => (role === "reader" ? {guess: "园丁", confidence: "certain", quotes: ["管家擦拭沾血的手套"]} : request.answer === "judge" ? {verdict: "inconsistent"} : undefined)).models);
        expect(reported(b.w, [wrong])[CHECK.earlyReveal]).toBeUndefined();
        const c = baron();
        const nothing = scripted();
        const none = await runOk(c.w, "ch12", nothing.models);
        expect(nothing.asked.some((call) => call.request.answer === "judge")).toBe(false);
        expect(none.usage.judge).toBe(0);
        const d = baron();
        const invented = await runOk(d.w, "ch12", scripted((role) => (role === "reader" ? {guess: "管家", confidence: "certain", quotes: ["没有这句话的引文"]} : undefined)).models);
        expect(badQuotesOf(invented)).toBe(1);
        expect(invented.usage.judge).toBe(0);
        expect(reported(d.w, [invented])[CHECK.badQuote]).toBeDefined();
    });

    test("判一致的记录校验有效：命题变了就过期", async () => {
        const {w, k} = baron();
        const record = await runOk(w, "ch12", scripted(trial("strong")).models);
        expect(isValid({view: w.view(), record, digest})).toBe(true);
        const stored = w.world.data.entries.get(k)!;
        w.publish([{ref: {kind: "entry", id: k}, after: {...stored, init: {...stored.init, summary: "管家用毒杀了男爵"}}}]);
        expect(isValid({view: w.view(), record, digest})).toBe(false);
    });
});

describe("验收 3：预算", () => {
    test("问 20 个，其余记没问；固定调用照跑；提示给出条数", async () => {
        const w = new PlotWorld(CHAPTERS);
        const hero = w.person("勇者");
        const people = Array.from({length: 25}, (_, index) => w.person(`人${String(index)}`));
        w.point("保密的事", hero, {保密: "secret"});
        w.texts.set("ch7", "勇者走进客栈。\n");
        w.change(chapter("ch7"), {cast: people.map(present)});
        const record = await runOk(w, "ch7", scripted().models);
        expect(record.usage.narrow).toBe(20);
        expect(record.usage.fixed).toBe(1);
        expect(record.unasked.length).toBe(6);
        expect(reported(w, [record])[CHECK.unasked]![0]!.params).toMatchObject({unasked: 6});
    });
});

describe("验收 4：新事实", () => {
    const quote = "十一点在桥头见";
    function bridge() {
        const w = new PlotWorld(CHAPTERS);
        w.person("小梅");
        w.texts.set("ch5", `小梅说：${quote}。\n陈老板点点头。\n`);
        return w;
    }
    const facts = (kind: "knowing" | "invention", name?: string) => (_role: string, request: {answer: string; user: string}) => (request.answer === "fixed" ? {items: ruleIds(request as never).map((item) => ({item, answer: "no", quotes: []})), newFacts: [{kind, text: "约定十一点在桥头见", ...(name === undefined ? {} : {name}), quotes: [quote]}]} : undefined);

    test("世界里没有、自陈里也没写：报；归第一处引文所在的段；带名字的查到世界或自陈就不算；自陈进了固定调用的材料", async () => {
        const w = bridge();
        const record = await runOk(w, "ch5", scripted(facts("knowing")).models);
        expect(reported(w, [record])[CHECK.unrecordedKnowing]).toMatchObject([{key: {line: "main", range: {from: "ch5", to: "ch5"}, detail: digest(quote)}, params: {text: "约定十一点在桥头见"}}]);
        expect(record.newFacts[0]).toMatchObject({segment: "main#1", line: "main"});

        // 没有自陈（作者自己写的）：没有写手，不报新编。
        const noWriter = await runOk(w, "ch5", scripted(facts("invention", "陈老板")).models);
        expect(reported(w, [noWriter])[CHECK.unreportedInvention]).toBeUndefined();
        // 有自陈、没写这一条：报。
        const invented = await runOk(w, "ch5", scripted(facts("invention", "陈老板")).models, {selfReport: selfReport("ch5")});
        expect(reported(w, [invented], {selfReport: selfReport("ch5")})[CHECK.unreportedInvention]!.length).toBe(1);

        const report = selfReport("ch5", ["陈老板：茶馆的老板"]);
        const {models, asked} = scripted(facts("invention", "陈老板"));
        const reportedName = await runOk(w, "ch5", models, {selfReport: report});
        expect(reportedName.newFacts).toEqual([]);
        expect(asked.find((call) => call.request.answer === "fixed")!.request.user).toContain("陈老板：茶馆的老板");

        const inWorld = await runOk(w, "ch5", scripted(facts("invention", "小梅")).models, {selfReport: selfReport("ch5")});
        expect(inWorld.newFacts).toEqual([]);
    });

    test("新事实的引文对不上丢掉并计数；超过 30 条记未列；规则项缺了记不完整；不是规则项的丢掉", async () => {
        const w = bridge();
        const many = Array.from({length: 35}, (_, index) => ({kind: "knowing" as const, text: `事${String(index)}`, quotes: [quote]}));
        const scene = {instruction: instruction("ch5", {ending: "他走了", avoid: ["写天气"]})};
        const record = await runOk(w, "ch5", scripted((_, request) => (request.answer === "fixed" ? {items: [{item: "ending", answer: "no", quotes: []}, {item: "不是规则项", answer: "yes", quotes: [quote]}], newFacts: [...many, {kind: "knowing", text: "假的", quotes: ["没有这句话的引文"]}]} : undefined)).models, scene);
        expect(record.newFacts.length).toBe(30);
        expect(record.unlisted).toBe(5);
        expect(badQuotesOf(record)).toBe(1);
        expect(record.incomplete).toEqual([planOf(w, "ch5", scene).rules.find((rule) => rule.item.startsWith("avoid:"))!.item]);
        expect(reported(w, [record], scene)[CHECK.unasked]![0]!.params).toMatchObject({unlisted: 5});
        expect(reported(w, [record], scene)[CHECK.instructionViolated]).toBeUndefined();
    });
});

describe("验收 5：引文对不上", () => {
    test("引的原句不在正文里：按看不出，提示；空引文、太短的引文同样；含换行的逐行核对", async () => {
        for (const quotes of [["没有这句话的引文"], [], ["他"]]) {
            const {w} = guardScene();
            const record = await runOk(w, "ch4", scripted((_, request) => (request.answer === "yesNo" && request.user.includes("把这件事当真") ? {answer: "yes", quotes} : undefined)).models);
            expect(badQuotesOf(record)).toBe(1);
            expect(record.calls.find((call) => call.layer === "presence")!.answer).toEqual({answer: "unclear", quotes: []});
            expect(reported(w, [record])[CHECK.possibleSlip]).toBeUndefined();
            expect(reported(w, [record])[CHECK.badQuote]).toBeDefined();
        }
        const {w} = guardScene();
        w.texts.set("ch4", `${SLIP}。\n旅人没有回答。\n`);
        const record = await runOk(w, "ch4", scripted((_, request) => (request.answer === "yesNo" && request.user.includes("把这件事当真") ? {answer: "yes", quotes: [`${SLIP}。\n旅人没有回答。`]} : undefined)).models);
        expect(badQuotesOf(record)).toBe(0);
        expect(reported(w, [record])[CHECK.possibleSlip]).toBeDefined();
    });

    test("分段章：引文要落在这一段里，落在别的段算对不上", async () => {
        const w = new PlotWorld(CHAPTERS);
        const hero = w.person("勇者");
        const [guard, maid] = [w.person("卫兵"), w.person("侍女")];
        w.point("勇者左手有星形的疤", hero, {保密: "secret"});
        w.texts.set("ch1", "开头。\n");
        const cut = w.change(chapter("ch1"));
        const ids = w.publish([{ref: {kind: "change", id: "tmp:f"}, after: {...drafts.change("tmp:f", chapter("ch2")), nature: "fork", fork: {line: "tmp:r1", name: "回溯", parent: "main", cut, type: "branch"}}}]);
        const r1 = ids["tmp:r1"]!;
        w.texts.set("ch3", "勇者走进客栈，卫兵盘问。\n侍女端来茶，勇者接过。\n");
        w.world = w.world.withOptions({...w.world.options, chapterLines: new Map([["ch3", [{line: "main", from: 1}, {line: r1, from: 2}]]])});
        w.change(chapter("ch3"), {cast: [present(guard)], told: [{source: "chapter", chapter: "ch3", quote: "卫兵盘问"}]});
        w.change({kind: "chapter", chapter: "ch3", key: 0, line: r1}, {cast: [present(maid)], told: [{source: "chapter", chapter: "ch3", quote: "侍女端来茶"}]});
        const record = await runOk(w, "ch3", scripted((_, request) => (request.answer === "yesNo" && request.user.includes("把这件事当真") ? {answer: "yes", quotes: ["侍女端来茶，勇者接过"]} : undefined)).models);
        expect(badQuotesOf(record)).toBe(1);
        const onR1 = record.calls.find((call) => call.segment === `${r1}#1` && call.layer === "presence")!;
        expect((onR1.answer as {answer: string}).answer).toBe("yes");
        const view = w.view();
        expect(reported(w, [record])[CHECK.possibleSlip]).toBeUndefined();
        expect(view.line).toBe("main");
    });
});

describe("决策、写作指示、时间与物件", () => {
    test("违反写作指示、违反约束、写死未定的事：各自成待处理；同一决策两条约束合成一条", async () => {
        const {w, hero} = guardScene();
        const decided = w.decision("卫兵的立场", {about: [{kind: "chapter", id: "ch4"}], conclusion: "不让他认出来", constraints: ["卫兵不认识勇者", "别提星形"]});
        const pending = w.decision("勇者的来历", {about: [{kind: "chapter", id: "ch4"}]});
        const scene = {instruction: instruction("ch4", {pov: {kind: "entry", id: hero}, povMode: "limited", ending: "他走了", avoid: ["写天气"]})};
        const record = await runOk(w, "ch4", scripted((_, request) => (request.answer === "fixed" ? {items: ruleIds(request).map((item) => ({item, answer: "yes", quotes: [SLIP]})), newFacts: []} : undefined)).models, scene);
        const found = reported(w, [record], scene);
        expect(found[CHECK.instructionViolated]!.map((item) => String(item.key.detail).split(":")[0]).sort()).toEqual(["avoid", "ending", "pov"]);
        expect(found[DECISION.constraintViolated]).toMatchObject([{key: {objects: [{kind: "decision", id: decided}], range: {from: "ch4", to: "ch4"}}}]);
        expect(String(found[DECISION.constraintViolated]![0]!.params.rule)).toContain("别提星形");
        expect(String(found[DECISION.constraintViolated]![0]!.params.rule)).toContain("卫兵不认识勇者");
        expect(found[DECISION.decidedInText]).toMatchObject([{key: {objects: [{kind: "decision", id: pending}]}}]);
    });

    test("时间层答有：本章没有分叉才报；物件层答动了：本章没有改它的变更才报", async () => {
        const w = new PlotWorld(CHAPTERS);
        const clock = w.thing("那座钟");
        const fs = w.foreshadow("那座钟慢了一刻", {物件: [{id: clock}]});
        w.change(chapter("ch3"), {told: [inText(w, "ch3", "钟慢了一刻", [node(fs, "plant")])]});
        const text = "她把那座钟拨回了正点";
        w.texts.set("ch5", `${text}。\n时光倒回到了清晨。\n`);
        const script = (_: string, request: {answer: string; user: string}) => (request.answer === "object" ? {moved: "yes", quotes: [text], before: "慢一刻", after: "正点", who: "她"} : request.answer === "yesNo" && request.user.includes("时间有没有") ? {answer: "yes", quotes: ["时光倒回到了清晨"]} : undefined);
        const record = await runOk(w, "ch5", scripted(script).models);
        const found = reported(w, [record]);
        expect(found[CHECK.forkSuspected]).toMatchObject([{key: {line: "main", range: {from: "ch5", to: "ch5"}, detail: "main#1"}}]);
        expect(found[FS.objectTouchedInText]).toMatchObject([{key: {objects: [{kind: "entry", id: fs}, {kind: "entry", id: clock}], line: "main", range: {from: "ch5", to: "ch5"}, detail: digest(text)}, params: {before: "慢一刻", after: "正点", who: "她"}}]);

        const touched = new PlotWorld(CHAPTERS);
        const clock2 = touched.thing("那座钟");
        const fs2 = touched.foreshadow("那座钟慢了一刻", {物件: [{id: clock2}]});
        touched.change(chapter("ch3"), {told: [inText(touched, "ch3", "钟慢了一刻", [node(fs2, "plant")])]});
        touched.texts.set("ch5", `${text}。\n`);
        touched.change(chapter("ch5"), {patches: [{op: "set", at: {entry: clock2, path: "character.状态"}, value: "正点"}]});
        const record2 = await runOk(touched, "ch5", scripted(script).models);
        expect(reported(touched, [record2])[FS.objectTouchedInText]).toBeUndefined();
    });

    test("同一个知识点几章都没写读者问题：键相同，合成一条，不撞键", async () => {
        const w = new PlotWorld(CHAPTERS);
        const hero = w.person("管家");
        const k = w.point("管家是凶手", hero, {保密: "secret"});
        w.change(chapter("ch20"), {kind: "plan", told: [{source: "outline", chapter: "ch20", anchor: "细纲", marks: [reveal(k, "explicit")]}]});
        w.texts.set("ch5", "管家端茶。\n");
        w.texts.set("ch6", "管家扫地。\n");
        const records = [await runOk(w, "ch5", scripted().models), await runOk(w, "ch6", scripted().models)];
        const found = reported(w, records)[CHECK.noReaderQuestion]!;
        expect(found.length).toBe(1);
        expect(String(found[0]!.params.chapters).split("、").sort()).toEqual(["ch5", "ch6"]);
    });
});

describe("失败与重试", () => {
    test("角色用不了：不花钱，plot-check-unavailable", async () => {
        const {w} = guardScene();
        const {models, asked} = scripted(() => undefined, "role-unbound");
        expect(await run(w, "ch4", models)).toMatchObject({ok: false, code: "plot-check-unavailable", resolution: "role-unbound"});
        expect(asked).toEqual([]);
    });

    test("可重试的、结构不对的重试一次；重试后好了不算失败，用量都计；还是不行就 plot-check-failed，带类别与用量", async () => {
        const {w} = guardScene();
        const once = await runOk(w, "ch4", scripted((_, request, attempt) => (request.answer === "yesNo" && attempt === 1 ? failure("retryable") : undefined)).models);
        expect(once.calls.length).toBe(3);
        expect(once.usage.total.input).toBe(USAGE.input * 5);
        const structure = await runOk(w, "ch4", scripted((_, request, attempt) => (request.answer === "yesNo" && attempt === 1 ? {乱写: true} : undefined)).models);
        expect(structure.calls.length).toBe(3);
        const failed = await run(w, "ch4", scripted((_, request) => (request.answer === "yesNo" ? failure("retryable", "rate_limit") : undefined)).models);
        expect(failed).toMatchObject({ok: false, code: "plot-check-failed", kind: "rate_limit"});
        expect((failed as {usage: {input: number}}).usage.input).toBeGreaterThan(0);
        expect(await run(w, "ch4", scripted((_, request) => (request.answer === "fixed" ? {乱写: true} : undefined)).models)).toMatchObject({ok: false, code: "plot-check-failed", kind: "invalid-answer"});
    });

    test("立即放弃的不重试，同批的不再问", async () => {
        const w = new PlotWorld(CHAPTERS);
        const hero = w.person("勇者");
        const people = Array.from({length: 18}, (_, index) => w.person(`人${String(index)}`));
        w.point("保密的事", hero, {保密: "secret"});
        w.texts.set("ch7", "勇者走进客栈。\n");
        w.change(chapter("ch7"), {cast: people.map(present)});
        const {models, asked} = scripted(() => failure("fatal", "auth"));
        const result = await run(w, "ch7", models);
        expect(result).toMatchObject({ok: false, code: "plot-check-failed", kind: "auth"});
        expect(asked.length).toBeLessThan(6);
    });

    test("撞上输出上限：加大上限重试，半截不当答案；两次都撞上算失败", async () => {
        const {w} = guardScene();
        const {models, asked} = scripted((_, request, attempt) => (request.answer === "fixed" && attempt === 1 ? failure("length", "length") : undefined));
        await runOk(w, "ch4", models);
        const fixed = asked.filter((call) => call.request.answer === "fixed");
        expect(fixed.map((call) => call.request.maxTokens)).toEqual([fixed[0]!.request.maxTokens, fixed[0]!.request.maxTokens * 2]);
        expect(await run(w, "ch4", scripted((_, request) => (request.answer === "fixed" ? failure("length", "length") : undefined)).models)).toMatchObject({ok: false, code: "plot-check-failed", kind: "length"});
    });

    test("取消：plot-check-cancelled，不存记录，带到此为止的用量", async () => {
        const {w} = guardScene();
        const controller = new AbortController();
        const {models} = scripted((_, request) => {
            if (request.answer === "yesNo") controller.abort();
            return failure("cancelled", "cancelled");
        });
        expect(await run(w, "ch4", models, {signal: controller.signal})).toMatchObject({ok: false, code: "plot-check-cancelled"});
        const stopped = new AbortController();
        stopped.abort();
        expect(await run(w, "ch4", scripted().models, {signal: stopped.signal})).toMatchObject({ok: false, code: "plot-check-cancelled"});
    });
});

describe("审查找到的（各是一个真实的反例）", () => {
    test("判一致挂起时取消：信号传到判一致，马上收口，不等模型", async () => {
        const w = new PlotWorld(CHAPTERS);
        const butler = w.person("管家");
        const k = w.point("管家是凶手", butler, {保密: "secret", 读者问题: "谁杀了男爵"});
        w.change(chapter("ch12"), {told: [inText(w, "ch12", "管家擦拭沾血的手套")]});
        w.change(chapter("ch20"), {kind: "plan", told: [{source: "outline", chapter: "ch20", anchor: "细纲", marks: [reveal(k, "explicit")]}]});
        const controller = new AbortController();
        const {models} = scripted((role) => (role === "reader" ? {guess: "管家", confidence: "strong", quotes: ["管家擦拭沾血的手套"]} : undefined));
        const hanging: typeof models = {
            available: models.available,
            ask: (role, request, signal) => {
                if (request.answer !== "judge") return models.ask(role, request, signal);
                return new Promise((resolve) => {
                    signal.addEventListener("abort", () => resolve(failure("cancelled", "cancelled")), {once: true});
                    controller.abort();
                });
            },
        };
        expect(await run(w, "ch12", hanging, {signal: controller.signal})).toMatchObject({ok: false, code: "plot-check-cancelled"});
    });

    test("排队时取消：不等别的章腾出名额", async () => {
        const limiter = createLimiter(1);
        const release = Promise.withResolvers<void>();
        const held = limiter.run(() => release.promise, new AbortController().signal);
        const controller = new AbortController();
        let ran = false;
        const queued = limiter.run(() => {
            ran = true;
            return Promise.resolve();
        }, controller.signal);
        controller.abort();
        expect(await queued).toBeNull();
        expect(ran).toBe(false);
        release.resolve();
        await held;
    });

    test("名额腾出来时轮到排在前面的；取消的不占名额", async () => {
        const limiter = createLimiter(1);
        const first = Promise.withResolvers<void>();
        const held = limiter.run(() => first.promise, new AbortController().signal);
        const order: string[] = [];
        const a = limiter.run(() => Promise.resolve(void order.push("a")), new AbortController().signal);
        const b = limiter.run(() => Promise.resolve(void order.push("b")), new AbortController().signal);
        first.resolve();
        await Promise.all([held, a, b]);
        expect(order).toEqual(["a", "b"]);
    });

    test("模型调用抛错：同批取消，算确定失败，不让别的调用继续花钱", async () => {
        const w = new PlotWorld(CHAPTERS);
        const hero = w.person("勇者");
        const people = Array.from({length: 18}, (_, index) => w.person(`人${String(index)}`));
        w.point("保密的事", hero, {保密: "secret"});
        w.texts.set("ch7", "勇者走进客栈。\n");
        w.change(chapter("ch7"), {cast: people.map(present)});
        let calls = 0;
        const signals: AbortSignal[] = [];
        const result = await run(w, "ch7", {available: () => Promise.resolve(null), ask: (_role, _request, signal) => {
            calls += 1;
            signals.push(signal);
            return Promise.reject(new Error("坏了"));
        }});
        expect(result).toMatchObject({ok: false, code: "plot-check-failed"});
        expect(calls).toBeLessThan(6);
        expect(signals[0]!.aborted).toBe(true);
    });

    test("失败的用量等在途的调用都结束才取；调用次数含重试", async () => {
        const {w} = guardScene();
        const gate = Promise.withResolvers<void>();
        const failed = await run(w, "ch4", {available: () => Promise.resolve(null), ask: async (_role, request) => {
            if (request.answer === "fixed") {
                await gate.promise;
                return {ok: true, answer: {items: [], newFacts: []}, usage: USAGE};
            }
            if (request.user.includes("时间有没有")) {
                gate.resolve();
                return failure("fatal", "auth");
            }
            return {ok: true, answer: {answer: "no", quotes: []}, usage: USAGE};
        }});
        expect(failed).toMatchObject({ok: false, code: "plot-check-failed", kind: "auth"});
        expect((failed as {usage: {input: number}}).usage.input).toBe(USAGE.input * 3);
        const once = await runOk(w, "ch4", scripted((_, request, attempt) => (request.answer === "yesNo" && attempt === 1 ? failure("retryable") : undefined)).models);
        expect(once.usage.narrow).toBe(4);
    });

    test("新事实：knowing 带世界里有的名字不丢（那个人当然在世界里）；invention 的 name 写涉及的人时不算查到新名字：报不报只看 name 是不是这个新名字；自陈按整项比，短名字不靠子串误中", async () => {
        const w = new PlotWorld(CHAPTERS);
        w.person("小梅");
        w.texts.set("ch5", "小梅说十一点在桥头见。\n");
        const fact = (kind: "knowing" | "invention", name: string) => (_role: string, request: {answer: string; user: string}) => (request.answer === "fixed" ? {items: [], newFacts: [{kind, text: "约定", name, quotes: ["小梅说十一点在桥头见"]}]} : undefined);
        const knowing = await runOk(w, "ch5", scripted(fact("knowing", "小梅")).models);
        expect(knowing.newFacts.length).toBe(1);
        const scene = {selfReport: selfReport("ch5", ["断桥残雪的故事"])};
        const short = await runOk(w, "ch5", scripted(fact("invention", "桥")).models, scene);
        expect(short.newFacts.length).toBe(1);
        const exact = await runOk(w, "ch5", scripted(fact("invention", "断桥残雪的故事")).models, scene);
        expect(exact.newFacts).toEqual([]);
    });

    test("引文拆成单字逐行：不算有效；真的跨两行的算；夹一行短的不算错", async () => {
        const answerWith = (quote: string) => (_: string, request: {answer: string; user: string}) => (request.answer === "yesNo" && request.user.includes("把这件事当真") ? {answer: "yes", quotes: [quote]} : undefined);
        const scene = () => {
            const made = guardScene();
            made.w.texts.set("ch4", `${SLIP}。\n嗯。\n旅人没有回答。\n`);
            return made.w;
        };
        const a = scene();
        const scattered = await runOk(a, "ch4", scripted(answerWith("卫\n兵\n勇\n者\n吧")).models);
        expect(badQuotesOf(scattered)).toBe(1);
        const b = scene();
        const real = await runOk(b, "ch4", scripted(answerWith(`${SLIP}。\n嗯。\n旅人没有回答。`)).models);
        expect(badQuotesOf(real)).toBe(0);
    });

    test("沿用答案时引文对不上的提示不消失", async () => {
        const w = new PlotWorld(CHAPTERS);
        const hero = w.person("勇者");
        const people = Array.from({length: 22}, (_, index) => w.person(`人${String(index)}`));
        w.point("保密的事", hero, {保密: "secret"});
        w.texts.set("ch7", "勇者走进客栈。\n");
        w.change(chapter("ch7"), {cast: people.map(present)});
        const first = await runOk(w, "ch7", scripted((_, request) => (request.answer === "yesNo" && request.user.includes("把这件事当真") ? {answer: "yes", quotes: ["没有这句话的引文"]} : undefined)).models);
        expect(badQuotesOf(first)).toBeGreaterThan(0);
        const second = await runOk(w, "ch7", scripted().models, {followUps: [first.unasked[0]!.id], reuse: first});
        expect(badQuotesOf(second)).toBe(badQuotesOf(first));
        expect(reported(w, [second], {followUps: [first.unasked[0]!.id]})[CHECK.badQuote]).toBeDefined();
    });

    test("回溯段在子线、分叉安放在主线：登记过分叉，时间层答有也不报疑似回溯", async () => {
        const w = new PlotWorld(CHAPTERS);
        w.texts.set("ch1", "开头。\n");
        const cut = w.change(chapter("ch1"));
        w.texts.set("ch5", "前一段。\n时光倒回到了清晨。\n");
        const ids = w.publish([{ref: {kind: "change", id: "tmp:f"}, after: {...drafts.change("tmp:f", chapter("ch5")), nature: "fork", fork: {line: "tmp:r1", name: "回溯", parent: "main", cut, type: "branch"}}}]);
        const r1 = ids["tmp:r1"]!;
        w.world = w.world.withOptions({...w.world.options, chapterLines: new Map([["ch5", [{line: "main", from: 1}, {line: r1, from: 2}]]])});
        const record = await runOk(w, "ch5", scripted((_, request) => (request.answer === "yesNo" && request.user.includes("时间有没有") && request.user.includes("时光倒回") ? {answer: "yes", quotes: ["时光倒回到了清晨"]} : undefined)).models);
        const view = w.view().onLine(r1) as ReturnType<PlotWorld["view"]>;
        const compute = checkDiagnostics({all: () => [record], valid: () => true}, digest)[CHECK.forkSuspected]!;
        expect(compute(view, {kind: "chapter", chapter: "ch5", edge: "end"}, "actual")).toEqual([]);
    });

    test("物件层：已回收的伏笔不报（圈候选时定的，诊断只读记录）", async () => {
        const w = new PlotWorld(CHAPTERS);
        const clock = w.thing("那座钟");
        const open = w.foreshadow("钟慢了", {物件: [{id: clock}]});
        const paid = w.foreshadow("钟的来历", {物件: [{id: clock}]});
        w.change(chapter("ch2"), {told: [inText(w, "ch2", "钟慢了一刻", [node(open, "plant"), node(paid, "plant")])]});
        w.change(chapter("ch3"), {told: [inText(w, "ch3", "钟的来历说破了", [node(paid, "payoff")])]});
        const text = "她把那座钟拨回了正点";
        w.texts.set("ch5", `${text}。\n`);
        const record = await runOk(w, "ch5", scripted((_, request) => (request.answer === "object" ? {moved: "yes", quotes: [text], before: "慢", after: "准", who: "她"} : undefined)).models);
        expect(reported(w, [record])[FS.objectTouchedInText]!.map((item) => (item.key.objects as {id: string}[])[0]!.id)).toEqual([open]);
    });

    test("被替代的揭示计划不算后面的揭示", () => {
        const w = new PlotWorld(CHAPTERS);
        const butler = w.person("管家");
        const k = w.point("管家是凶手", butler, {保密: "secret", 读者问题: "谁杀了男爵"});
        w.texts.set("ch8", "管家端着茶。\n");
        const old = w.change(chapter("ch20"), {kind: "plan", told: [{source: "outline", chapter: "ch20", anchor: "细纲", marks: [reveal(k, "explicit")]}]});
        expect(planOf(w, "ch8").trials.length).toBe(1);
        w.change(chapter("ch21"), {kind: "plan", links: [{kind: "replaces", plan: old}]});
        expect(planOf(w, "ch8").trials).toEqual([]);
    });

    test("没有正文的段不问：不白花一次时间层", () => {
        const w = new PlotWorld(CHAPTERS);
        w.texts.set("ch1", "开头。\n");
        const cut = w.change(chapter("ch1"));
        const ids = w.publish([{ref: {kind: "change", id: "tmp:f"}, after: {...drafts.change("tmp:f", chapter("ch2")), nature: "fork", fork: {line: "tmp:r1", name: "回溯", parent: "main", cut, type: "branch"}}}]);
        w.world = w.world.withOptions({...w.world.options, chapterLines: new Map([["ch5", [{line: "main", from: 1}, {line: ids["tmp:r1"]!, from: 9}]]])});
        w.texts.set("ch5", "只有一段。\n");
        expect(planOf(w, "ch5").calls.filter((call) => call.layer === "time").map((call) => call.segment)).toEqual(["main#1"]);
    });
});

describe("补问与费用", () => {
    test("带补问清单：输入摘要相同的沿用答案不再调模型，只问新的；用量只算实际调的；记录带清单", async () => {
        const w = new PlotWorld(CHAPTERS);
        const hero = w.person("勇者");
        const people = Array.from({length: 22}, (_, index) => w.person(`人${String(index)}`));
        w.point("保密的事", hero, {保密: "secret"});
        w.texts.set("ch7", "勇者走进客栈。\n");
        w.change(chapter("ch7"), {cast: people.map(present)});
        const first = await runOk(w, "ch7", scripted().models);
        expect(first.usage).toMatchObject({narrow: 20, fixed: 1, reused: 0});
        const named = first.unasked[0]!.id;
        const {models, asked} = scripted();
        const second = await runOk(w, "ch7", models, {followUps: [named], reuse: first});
        expect(asked.length).toBe(1);
        expect(second.usage).toMatchObject({narrow: 1, fixed: 0, reused: 21});
        expect(second.followUps).toEqual([named]);
        expect(second.calls.some((call) => call.id === named)).toBe(true);
        expect(isValid({view: w.view(), record: second, digest})).toBe(true);
    });

    test("记下各种调用的次数与合计用量", async () => {
        const {w} = guardScene();
        const record = await runOk(w, "ch4", scripted().models);
        expect(record.usage).toMatchObject({narrow: 2, fixed: 1, trial: 0, judge: 0, reused: 0, total: {input: USAGE.input * 3, output: USAGE.output * 3, cost: null}});
    });
});
