import {describe, expect, test} from "bun:test";

import type {DiagnosticCompute, Mark, TellingDraft} from "@notnotype/nb-canon/schema";

import {FS_DIAGNOSTIC_IDS, MARK_IDS} from "../shared/declarations";
import {chapter, drafts, end, PlotWorld} from "../testing/world";
import {foreshadowDiagnostics, ForeshadowIndex, ledger, tellingPositionOf} from "./foreshadowing";

const CHAPTERS = Array.from({length: 20}, (_, index) => `ch${String(index + 1)}`);
const compute = foreshadowDiagnostics();
const run = (w: PlotWorld, id: string, at = end("ch20")) => (compute[id] as DiagnosticCompute)(w.view(), at, "actual");
const node = (foreshadow: string, role: string): Mark => ({kind: MARK_IDS.node, version: 1, foreshadow, role});
const reveal = (point: string, mode: "hint" | "explicit"): Mark => ({kind: MARK_IDS.reveal, version: 1, point, mode});
const inText = (w: PlotWorld, chapterId: string, quote: string, marks: Mark[] = []): TellingDraft => {
    w.texts.set(chapterId, `${w.texts.get(chapterId) ?? ""}${quote}。\n`);
    return {source: "chapter", chapter: chapterId, quote, ...(marks.length === 0 ? {} : {marks})};
};
const stageAt = (w: PlotWorld, foreshadow: string, at = end("ch20")) => new ForeshadowIndex(w.view(), at, "actual").stage(foreshadow, tellingPositionOf(at)).stage;

describe("plot.foreshadowing 验收场景 1：钟", () => {
    test("埋下、呼应、计划回收；物件被动过提示；第 15 章写完没回收报待处理；补上以后已回收；删掉那句退回呼应中、待处理回来", () => {
        const w = new PlotWorld(CHAPTERS);
        const clock = w.thing("那座钟");
        const fs = w.foreshadow("那座钟慢了一刻", {物件: [{id: clock}]});
        w.change(chapter("ch3"), {told: [inText(w, "ch3", "钟慢了一刻", [node(fs, "plant")])]});
        w.change(chapter("ch7"), {told: [inText(w, "ch7", "钟又响了", [node(fs, "echo")])]});
        const plan = w.change(chapter("ch15"), {kind: "plan", told: [{source: "outline", chapter: "ch15", anchor: "细纲第 15 章", marks: [node(fs, "payoff")]}]});
        w.change(chapter("ch10"), {patches: [{op: "set", at: {entry: clock, path: "character.状态"}, value: "拨回正点"}]});
        expect(run(w, FS_DIAGNOSTIC_IDS.objectTouched).map((finding) => finding.key.objects)).toEqual([[{kind: "entry", id: fs}, {kind: "entry", id: clock}, expect.objectContaining({kind: "change"})]]);
        expect(stageAt(w, fs)).toBe("echoing");

        w.change(chapter("ch15"), {told: [inText(w, "ch15", "天黑了")]});
        expect(run(w, FS_DIAGNOSTIC_IDS.plannedNodeMissing)).toMatchObject([{key: {objects: [{id: fs}, {id: plan}]}, params: {reason: "plan-unfulfilled"}}]);

        const written = w.change(chapter("ch15", 5), {told: [inText(w, "ch15", "钟停在三点", [node(fs, "payoff")])], links: [{kind: "fulfills", plan}]});
        expect(stageAt(w, fs)).toBe("paidOff");
        expect(run(w, FS_DIAGNOSTIC_IDS.plannedNodeMissing)).toEqual([]);
        expect(written).toBeDefined();

        w.texts.set("ch15", "天黑了。\n");
        expect(stageAt(w, fs)).toBe("echoing");
        expect(run(w, FS_DIAGNOSTIC_IDS.plannedNodeMissing)).toMatchObject([{params: {reason: "no-node-in-chapter"}}]);
    });
});

describe("plot.foreshadowing 验收场景 2：悬念与答案", () => {
    test("答案上的暗示让阶段到呼应中，明说让它已回收；同一知识点被两个悬念指向：两个都算，并提示", () => {
        const w = new PlotWorld(CHAPTERS);
        const k = w.point("管家是凶手", null);
        const [first, second] = [w.foreshadow("谁杀了男爵", {种类: "mystery", 答案: {ref: k}}), w.foreshadow("管家的秘密", {种类: "mystery", 答案: {ref: k}})];
        w.change(chapter("ch5"), {told: [inText(w, "ch5", "管家的手在抖", [reveal(k, "hint")])]});
        expect([stageAt(w, first, end("ch5")), stageAt(w, second, end("ch5"))]).toEqual(["echoing", "echoing"]);
        w.change(chapter("ch20"), {told: [inText(w, "ch20", "凶手就是管家", [reveal(k, "explicit")])]});
        expect([stageAt(w, first), stageAt(w, second)]).toEqual(["paidOff", "paidOff"]);
        expect(run(w, FS_DIAGNOSTIC_IDS.sharedAnswer).map((finding) => finding.key.objects)).toEqual([[{kind: "entry", id: k}]]);
    });
});

describe("plot.foreshadowing 验收场景 3、输出 4：继承", () => {
    test("计划带呼应节点，兑现它的已写变更自己没标：节点继承到它第一处正文讲述上；它没有正文讲述时提示没有位置", () => {
        const w = new PlotWorld(CHAPTERS);
        const letter = w.foreshadow("信");
        w.change(chapter("ch2"), {told: [inText(w, "ch2", "桌上有封信", [node(letter, "plant")])]});
        const plan = w.change(chapter("ch9"), {kind: "plan", told: [{source: "outline", chapter: "ch9", anchor: "提一次那封信", marks: [node(letter, "echo")]}]});
        w.change(chapter("ch9"), {told: [inText(w, "ch9", "她又想起那封信")], links: [{kind: "fulfills", plan}]});
        const index = new ForeshadowIndex(w.view(), end("ch20"), "actual");
        expect(index.nodes.filter((item) => item.foreshadow === letter).map((item) => [item.role, item.source, item.occurrence.chapter])).toEqual([["plant", "node", "ch2"], ["echo", "inherited", "ch9"]]);

        const other = w.change(chapter("ch12"), {kind: "plan", told: [{source: "outline", chapter: "ch12", anchor: "再提", marks: [node(letter, "echo")]}]});
        const silent = w.change(chapter("ch12"), {links: [{kind: "fulfills", plan: other}]});
        expect(run(w, FS_DIAGNOSTIC_IDS.nodeWithoutTelling).map((finding) => finding.key.objects)).toEqual([[{kind: "entry", id: letter}, {kind: "change", id: silent}]]);
    });
});

describe("plot.foreshadowing 验收场景 4、输出 6、7：其余检查", () => {
    test("第一个节点是回收：没埋就回收；回收以后又埋；放弃了还留着；没有悬念认领的暗示；太久没提；没排回收；悬念回收那章没明说答案", () => {
        const w = new PlotWorld(CHAPTERS);
        const early = w.foreshadow("早收");
        const payoff = w.change(chapter("ch2"), {told: [inText(w, "ch2", "原来如此", [node(early, "payoff")])]});
        expect(run(w, FS_DIAGNOSTIC_IDS.payoffBeforePlant)).toHaveLength(1);
        w.change(chapter("ch4"), {told: [inText(w, "ch4", "又埋了一次", [node(early, "plant")])]});
        expect(run(w, FS_DIAGNOSTIC_IDS.replantAfterPayoff)).toHaveLength(1);
        expect(payoff).toBeDefined();

        const dropped = w.foreshadow("不要了", {意图: "dropped", 重要程度: "minor"});
        w.change(chapter("ch3"), {told: [inText(w, "ch3", "一只猫", [node(dropped, "plant")])]});
        expect(run(w, FS_DIAGNOSTIC_IDS.droppedButPlanted).map((finding) => finding.key.objects)).toEqual([[{kind: "entry", id: dropped}]]);
        // 次要的伏笔缺省间隔 10 章：第 3 章埋下，到第 20 章 17 章没提。
        expect(run(w, FS_DIAGNOSTIC_IDS.longSilence).map((finding) => (finding.key.objects as unknown[])[0])).toContainEqual({kind: "entry", id: dropped});
        expect(run(w, FS_DIAGNOSTIC_IDS.noPayoffPlanned).map((finding) => (finding.key.objects as {id: string}[])[0]!.id)).toContain(dropped);

        const lonely = w.point("雨会停", null);
        w.change(chapter("ch6"), {told: [inText(w, "ch6", "天色发亮", [reveal(lonely, "hint")])]});
        expect(run(w, FS_DIAGNOSTIC_IDS.orphanHint).map((finding) => finding.key.objects)).toEqual([[{kind: "entry", id: lonely}]]);

        const answer = w.point("钥匙在井里", null);
        const mystery = w.foreshadow("钥匙去哪了", {种类: "mystery", 答案: {ref: answer}});
        w.change(chapter("ch8"), {told: [inText(w, "ch8", "钥匙不见了", [node(mystery, "plant")])]});
        w.change(chapter("ch18"), {told: [inText(w, "ch18", "终于找到了", [node(mystery, "payoff")])]});
        expect(run(w, FS_DIAGNOSTIC_IDS.payoffWithoutReveal).map((finding) => finding.key.objects)).toEqual([[{kind: "entry", id: mystery}]]);
    });

    test("账本：阶段、节点、计划的节点、最后一次被提到的章、物件最近一次被改的变更；按阶段筛", () => {
        const w = new PlotWorld(CHAPTERS);
        const clock = w.thing("那座钟");
        const fs = w.foreshadow("那座钟慢了一刻", {物件: [{id: clock}]});
        w.change(chapter("ch3"), {told: [inText(w, "ch3", "钟慢了一刻", [node(fs, "plant")])]});
        w.change(chapter("ch15"), {kind: "plan", told: [{source: "outline", chapter: "ch15", anchor: "回收", marks: [node(fs, "payoff")]}]});
        const touched = w.change(chapter("ch10"), {patches: [{op: "set", at: {entry: clock, path: "character.状态"}, value: "拨回正点"}]});
        expect(ledger(w.view(), end("ch20"), "actual")).toEqual([{
            id: fs, name: "那座钟慢了一刻", kind: "setupPayoff", importance: "main", intent: "active", stage: "planted", dropped: false,
            nodes: [{role: "plant", chapter: "ch3", paragraph: 1, telling: expect.any(String), source: "node"}],
            planned: [{role: "payoff", chapter: "ch15", plan: expect.any(String)}],
            lastMentioned: "ch3",
            objects: [{id: clock, lastChange: touched}],
        }]);
        expect(ledger(w.view(), end("ch20"), "actual", {stage: "paidOff"})).toEqual([]);
    });
});

describe("plot.foreshadowing 输出 3、4、6 到 8：继承、截取与模式", () => {
    test("兑现计划的已写变更自己只标了答案的暗示：不继承计划的回收，阶段停在呼应中", () => {
        const w = new PlotWorld(CHAPTERS);
        const k = w.point("管家是凶手", null);
        const mystery = w.foreshadow("谁杀了男爵", {种类: "mystery", 答案: {ref: k}});
        w.change(chapter("ch2"), {told: [inText(w, "ch2", "男爵死了", [node(mystery, "plant")])]});
        const plan = w.change(chapter("ch9"), {kind: "plan", told: [{source: "outline", chapter: "ch9", anchor: "揭开", marks: [node(mystery, "payoff")]}]});
        w.change(chapter("ch9"), {told: [inText(w, "ch9", "管家的手在抖", [reveal(k, "hint")])], links: [{kind: "fulfills", plan}]});
        expect(stageAt(w, mystery)).toBe("echoing");
    });

    test("兑现变更套不上（改的物件删了）：计划回到未兑现，不继承它的节点", () => {
        const w = new PlotWorld(CHAPTERS);
        const clock = w.thing("那座钟");
        const fs = w.foreshadow("那座钟慢了一刻");
        w.change(chapter("ch3"), {told: [inText(w, "ch3", "钟慢了一刻", [node(fs, "plant")])]});
        const plan = w.change(chapter("ch15"), {kind: "plan", told: [{source: "outline", chapter: "ch15", anchor: "回收", marks: [node(fs, "payoff")]}]});
        w.change(chapter("ch15"), {told: [inText(w, "ch15", "钟停在三点")], links: [{kind: "fulfills", plan}], patches: [{op: "set", at: {entry: clock, path: "character.状态"}, value: "停了"}]});
        expect(stageAt(w, fs)).toBe("paidOff");
        w.publish([{ref: {kind: "entry", id: clock}, after: {...structuredClone(w.world.data.entries.get(clock)!), deleted: true}}]);
        expect(stageAt(w, fs)).toBe("planted");
    });

    test("同一句上继承来的埋下（讲述 id 小）排在显式的回收（讲述 id 大）前面，不报没埋就回收", () => {
        const w = new PlotWorld(CHAPTERS);
        const fs = w.foreshadow("钟");
        const plan = w.change(chapter("ch3"), {kind: "plan", told: [{source: "outline", chapter: "ch3", anchor: "埋", marks: [node(fs, "plant")]}]});
        w.change(chapter("ch3"), {told: [inText(w, "ch3", "钟慢了一刻")], links: [{kind: "fulfills", plan}]});
        w.change(chapter("ch3", 5), {told: [{source: "chapter", chapter: "ch3", quote: "钟慢了一刻", marks: [node(fs, "payoff")]}]});
        expect(new ForeshadowIndex(w.view(), end("ch20"), "actual").nodes.map((item) => [item.role, item.source])).toEqual([["plant", "inherited"], ["payoff", "node"]]);
        expect(run(w, FS_DIAGNOSTIC_IDS.payoffBeforePlant)).toEqual([]);
    });

    test("读第 1 章末尾时，第 3 章才埋的、第 6 章才有的暗示都还没发生：放弃了还留着、没有悬念认领的暗示不报", () => {
        const w = new PlotWorld(CHAPTERS);
        const dropped = w.foreshadow("不要了", {意图: "dropped"});
        w.change(chapter("ch3"), {told: [inText(w, "ch3", "一只猫", [node(dropped, "plant")])]});
        const lonely = w.point("雨会停", null);
        w.change(chapter("ch6"), {told: [inText(w, "ch6", "天色发亮", [reveal(lonely, "hint")])]});
        expect([run(w, FS_DIAGNOSTIC_IDS.droppedButPlanted, end("ch1")), run(w, FS_DIAGNOSTIC_IDS.orphanHint, end("ch1"))]).toEqual([[], []]);
        expect([run(w, FS_DIAGNOSTIC_IDS.droppedButPlanted).length, run(w, FS_DIAGNOSTIC_IDS.orphanHint).length]).toEqual([1, 1]);
    });

    test("按计划模式：伏笔条目自己的意图按计划折叠（计划把它改成放弃），账本与检查都按这个模式", () => {
        const w = new PlotWorld(CHAPTERS);
        const fs = w.foreshadow("要放弃的");
        w.change(chapter("ch1"), {told: [inText(w, "ch1", "埋下", [node(fs, "plant")])]});
        w.change(chapter("ch2"), {kind: "plan", patches: [{op: "set", at: {entry: fs, path: "fs.意图"}, value: "dropped"}]});
        expect([ledger(w.view(), end("ch20"), "actual")[0]!.dropped, ledger(w.view(), end("ch20"), "planned")[0]!.dropped]).toEqual([false, true]);
        expect((compute[FS_DIAGNOSTIC_IDS.droppedButPlanted] as DiagnosticCompute)(w.view(), end("ch20"), "planned")).toHaveLength(1);
    });
});

describe("输出 5：读者那一边的阶段按活页夹正文算，不分线", () => {
    test("活页夹第 9 章讲回溯线，节点写在子线的讲述上：主线视图上也算埋下，没讲到的子线不算", () => {
        const w = new PlotWorld(CHAPTERS);
        const fs = w.foreshadow("钟");
        w.texts.set("ch9", "第一段。\n原来如此。");
        const cut = w.change(chapter("ch7"));
        const trigger = w.change(chapter("ch8", 50));
        const fork = (tmp: string, lineTmp: string, key: number) => ({ref: {kind: "change" as const, id: tmp}, after: {...drafts.change(tmp, chapter("ch8", key)), nature: "fork" as const, fork: {line: lineTmp, name: "回溯", parent: "main", cut, trigger, type: "rollback" as const}}});
        const telling = {source: "chapter" as const, chapter: "ch9", quote: "原来如此", marks: [node(fs, "plant")]};
        const ids = w.publish([
            fork("tmp:f", "tmp:r1", 60),
            fork("tmp:g", "tmp:r2", 70),
            {ref: {kind: "change", id: "tmp:own"}, after: drafts.change("tmp:own", {...chapter("ch9", 1), line: "tmp:r1"}, {told: [telling]})},
            {ref: {kind: "change", id: "tmp:other"}, after: drafts.change("tmp:other", {...chapter("ch9", 1), line: "tmp:r2"}, {told: [{...telling, marks: [node(fs, "payoff")]}]})},
        ]);
        w.world = w.world.withOptions({...w.world.options, chapterLines: new Map([["ch9", [{line: ids["tmp:r1"]!, from: 1}]]])});
        // 活页夹讲的是 r1：r1 上的埋下算数，同一句写在没讲到的 r2 上的回收不算。
        expect(stageAt(w, fs, end("ch10"))).toBe("planted");
    });
});

describe("plot.foreshadowing 输出 2、8：账本的筛选与放弃的显示", () => {
    /** 四个伏笔：主要的、次要的放弃了的（第 5 章埋下）、旁支的（第 8 章埋下）、只在第 15 章有计划的节点。 */
    function ledgerWorld() {
        const w = new PlotWorld(CHAPTERS);
        const main = w.foreshadow("主线伏笔", {重要程度: "main"});
        const dropped = w.foreshadow("放弃的伏笔", {重要程度: "minor", 意图: "dropped"});
        const side = w.foreshadow("旁支伏笔", {重要程度: "side"});
        const planned = w.foreshadow("只有计划的伏笔", {重要程度: "side"});
        w.change(chapter("ch3"), {told: [inText(w, "ch3", "主线埋下", [node(main, "plant")])]});
        w.change(chapter("ch5"), {told: [inText(w, "ch5", "放弃的埋下", [node(dropped, "plant")])]});
        w.change(chapter("ch8"), {told: [inText(w, "ch8", "旁支埋下", [node(side, "plant")])]});
        w.change(chapter("ch15"), {kind: "plan", told: [{source: "outline", chapter: "ch15", anchor: "计划", marks: [node(planned, "plant")]}]});
        const names = (filter: Parameters<typeof ledger>[3]) => ledger(w.view(), end("ch20"), "actual", filter).map((item) => item.name).sort();
        return {w, names};
    }

    test("按重要程度、意图、章的范围筛；章的范围算节点或计划的节点落在范围里的伏笔，边界章包含在内", () => {
        const {names} = ledgerWorld();
        expect(names({})).toEqual(["只有计划的伏笔", "主线伏笔", "旁支伏笔", "放弃的伏笔"].sort());
        expect(names({importance: "side"})).toEqual(["只有计划的伏笔", "旁支伏笔"].sort());
        expect(names({importance: "minor"})).toEqual(["放弃的伏笔"]);
        expect(names({intent: "dropped"})).toEqual(["放弃的伏笔"]);
        expect(names({intent: "active"})).toEqual(["只有计划的伏笔", "主线伏笔", "旁支伏笔"].sort());
        expect(names({from: "ch5", to: "ch8"})).toEqual(["旁支伏笔", "放弃的伏笔"].sort());
        expect(names({to: "ch3"})).toEqual(["主线伏笔"]);
        expect(names({from: "ch9"})).toEqual(["只有计划的伏笔"]);
        // 几个条件同时给：都要满足。
        expect(names({importance: "side", from: "ch5", to: "ch8"})).toEqual(["旁支伏笔"]);
    });

    test("意图为放弃：已埋的阶段仍是已埋、标放弃（“放弃（已埋）”），没埋的阶段是未埋、标放弃（“放弃”）；没放弃的不标", () => {
        const {w} = ledgerWorld();
        w.foreshadow("放弃但没埋", {意图: "dropped"});
        const items = ledger(w.view(), end("ch20"), "actual");
        const shown = Object.fromEntries(items.map((item) => [item.name, [item.stage, item.dropped]]));
        expect(shown).toMatchObject({"放弃的伏笔": ["planted", true], "放弃但没埋": ["unplanted", true], "主线伏笔": ["planted", false]});
    });
});
