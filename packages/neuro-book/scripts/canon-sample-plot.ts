/**
 * 星瑕样本的剧情数据（`canon-sample.ts --plot`，w00039 t31 第二批，docs/specs/plot/author-ui.md 的验收用）：在设定样本的十一次写入
 * 之后，用产品的剧情声明再发布几次作者写入。揭示与伏笔节点挂在现有正文的真实段落上，所以读者的程度与“从哪一段起”是正文算出来的：
 *
 * - 五个秘密：“哥哥就是星瑕”（第 1 章第 8 段明说）、“星瑕做过魔法少女”（第 1 章第 13 段明说）、“那几年哥哥是被软禁”（第 2 章
 *   第 10 段暗示，挂着一条第 3 章到期的决策）、“软禁处留着的是魔偶”（读者不知道、没打算怎么揭）四个保密，“父母没有死”绝密、第 3 章
 *   有揭示计划；
 * - 知情行：初值里知道、忘了（星瑾六岁时见过变身）、怀疑；第 2 章星瑾信错了；彗在前史的逃脱里在场推出；
 * - 伏笔六个：很久没提（参考间隔 1 章）、呼应中、已回收、未埋带计划、已放弃、刚埋下；
 * - 三个人的目标与态度：含隐秘、冲突、达成，第 2 章星瑾的目标受挫（动过）；
 * - 两条待定决策，一条第 3 章到期；
 * - 一条已写的回溯分叉：星瑕把第 2 章那个晚上倒回去（切口是变回哥哥的样子，触发处是星瑾那句话），子线的第 3 章她先说了那几年的事，
 *   所以子线上星瑾知道“那几年哥哥是被软禁”，主线上她信错了。
 *
 * 样本自带的剧情线条目（“做个好哥哥”等四条）原样留着。已有的几条剧情变更补记谁在场（经历要它），工资那条不补，留一条没记谁在场的。
 */

import type {Mark, Placement, StoryChangeDraft, TellingDraft, WriteRequest} from "@notnotype/nb-canon";
import type {WorldService} from "@notnotype/nb-canon/node";

import {COMPONENT_IDS, MARK_IDS} from "../src/plugins/plot/shared/declarations";

type Puts = WriteRequest["puts"];

/** 样本里按名字找条目 id（设定样本的名字在全书里唯一）。 */
export type NameIndex = (name: string) => string;

const reveal = (point: string, mode: "hint" | "explicit"): Mark => ({kind: MARK_IDS.reveal, version: 1, point, mode});
const node = (foreshadow: string, role: string): Mark => ({kind: MARK_IDS.node, version: 1, foreshadow, role});
const learns = (point: string): Mark => ({kind: MARK_IDS.presentLearns, version: 1, point});
const present = (who: string) => ({who, role: "present" as const});
const inChapter = (chapter: string, quote: string, marks: readonly Mark[]): TellingDraft => ({source: "chapter", chapter, quote, marks: [...marks]});
const chapter = (id: string, key: number, line?: string): Placement => ({kind: "chapter", chapter: id, key, ...(line === undefined ? {} : {line})});

/** 一条作者写的剧情变更。 */
function change(id: string, at: Placement, text: string, extra: Partial<StoryChangeDraft> = {}): Puts[number] {
    const draft: StoryChangeDraft = {id, kind: "written", text, at, told: [], involves: [], lines: [], links: [], patches: [], status: "active", by: {kind: "author"}, ...extra};
    return {ref: {kind: "change", id}, after: draft};
}

function point(id: string, name: string, subject: string, fields: Record<string, unknown>): Puts[number] {
    return {ref: {kind: "entry", id}, after: {id, type: "知识点", parent: subject, folder: "秘密", order: 0, init: {name, aliases: [], summary: "", text: [], data: {
        point: {type: COMPONENT_IDS.point, version: 1, enabled: true, fields: {保密: "secret", 规则: null, 表现: null, 揭穿: null, 读者问题: null, ...fields}},
    }}}};
}

function foreshadow(id: string, name: string, fields: Record<string, unknown>): Puts[number] {
    return {ref: {kind: "entry", id}, after: {id, type: "伏笔", parent: null, folder: "伏笔", order: 0, init: {name, aliases: [], summary: "", text: [], data: {
        fs: {type: COMPONENT_IDS.foreshadow, version: 1, enabled: true, fields: {种类: "setupPayoff", 重要程度: "side", 意图: "active", 答案: null, 物件: [], 参考间隔: null, ...fields}},
    }}}};
}

function goal(id: string, name: string, holder: string, fields: Record<string, unknown>): Puts[number] {
    return {ref: {kind: "entry", id}, after: {id, type: "目标", parent: holder, folder: "目标", order: 0, init: {name, aliases: [], summary: "", text: [], data: {
        goal: {type: COMPONENT_IDS.goal, version: 1, enabled: true, fields: {状态: "active", 轻重: "major", 层次: "want", 为什么: null, 基于: [], 冲突: [], 后继: null, 隐秘: null, ...fields}},
    }}}};
}

/** 发布一次作者写入，返回临时 id 到正式 id 的对照。 */
async function publish(service: WorldService, title: string, puts: Puts): Promise<Readonly<Record<string, string>>> {
    const result = await service.publish({requestId: `xingxia-plot-${title}`, by: {kind: "author"}, what: "edit", title, baseVersion: service.status().version, puts});
    if (!result.ok) throw new Error(`剧情样本“${title}”发布失败：${JSON.stringify(result.failure)}`);
    return result.ids;
}

/** 已存的对象原样取出来（改它再写回）。 */
function stored<T>(service: WorldService, ref: {readonly kind: "entry" | "change"; readonly id: string}): T {
    return service.object(ref).object as T;
}

/** 写剧情数据；`changeOf` 按设定样本里剧情变更的文字找它的 id。 */
export async function writePlotSample(service: WorldService, idOf: NameIndex, changeOf: (text: string) => string): Promise<void> {
    const xia = idOf("星瑕");
    const jin = idOf("星瑾");
    const parents = idOf("父母");
    const hui = idOf("彗");
    const sprite = idOf("魔法精灵（名字未定）");
    const relatives = idOf("刻薄的亲戚");

    const points = await publish(service, "秘密", [
        point("tmp:k1", "哥哥就是星瑕", xia, {表现: "在星瑾面前一直是哥哥的样子", 读者问题: "哥哥到底是谁"}),
        point("tmp:k2", "星瑕做过魔法少女", xia, {规则: "官方明面上还维持着她的魔法少女身份"}),
        point("tmp:k3", "那几年哥哥是被软禁", xia, {读者问题: "哥哥走的那几年去了哪"}),
        point("tmp:k4", "父母没有死", parents, {保密: "topSecret"}),
        point("tmp:k5", "软禁处留着的是魔偶", xia, {规则: "官方以为她还被关着"}),
    ]);
    const [k1, k2, k3, k4, k5] = ["tmp:k1", "tmp:k2", "tmp:k3", "tmp:k4", "tmp:k5"].map((id) => points[id]!) as [string, string, string, string, string];

    // 人物启用知情与态度：初值里谁知道什么、对谁什么态度。
    type StoredEntry = {init: {data: Record<string, unknown>}} & Record<string, unknown>;
    const withPlot = (id: string, known: readonly Record<string, unknown>[], attitudes: readonly Record<string, unknown>[]): Puts[number] => {
        const entry = stored<StoredEntry>(service, {kind: "entry", id});
        return {ref: {kind: "entry", id}, after: {...entry, init: {...entry.init, data: {
            ...entry.init.data,
            know: {type: COMPONENT_IDS.knowing, version: 1, enabled: true, fields: {知情: known, 听过的说法: null}},
            att: {type: COMPONENT_IDS.attitude, version: 1, enabled: true, fields: {态度: attitudes}},
        }}}} as Puts[number];
    };
    await publish(service, "知情与态度", [
        withPlot(xia, [{id: k1, 程度: "knows"}, {id: k2, 程度: "knows"}, {id: k3, 程度: "knows"}, {id: k5, 程度: "knows"}], [{id: jin, 态度: "想补偿她，又不知道怎么开口", 起因: null, 称呼: "星瑾"}]),
        withPlot(jin, [{id: k2, 程度: "forgot", 备注: "六岁那年见过哥哥变身，后来忘了"}], [{id: xia, 态度: "还在生气，不肯领情", 起因: {ref: k3}, 称呼: "哥哥"}]),
        withPlot(hui, [{id: k1, 程度: "knows", 怎么知道: "witnessed"}, {id: k2, 程度: "knows"}, {id: k5, 程度: "knows"}], [{id: xia, 态度: "嘴上看热闹，真有事第一个到", 起因: null, 称呼: "瑕"}]),
        withPlot(parents, [{id: k4, 程度: "knows"}], []),
        withPlot(sprite, [{id: k2, 程度: "knows"}, {id: k4, 程度: "suspects"}], []),
        withPlot(relatives, [], []),
    ]);

    // 已有的剧情变更补记谁在场；前史的逃脱另带“揭示给在场的人”，彗因此知道那几年是被软禁（在场推出）。
    type StoredChange = StoryChangeDraft & Record<string, unknown>;
    const cast = (text: string, members: StoryChangeDraft["cast"], marks?: readonly Mark[]): Puts[number] => {
        const id = changeOf(text);
        const before = stored<StoredChange>(service, {kind: "change", id});
        return {ref: {kind: "change", id}, after: {...before, cast: members, ...(marks === undefined ? {} : {marks: [...marks]})}};
    };
    await publish(service, "谁在场", [
        cast("被软禁，靠彗做的魔偶逃脱", [present(xia), present(hui)], [learns(k3)]),
        cast("以哥哥的样子回到家，把星瑾接回来同住；钱大多花在研究上，剩下的够用", [present(xia), present(jin)]),
        cast("早餐，星瑾还在生气，不吃煎蛋，出门上学", [present(xia), present(jin)]),
        cast("回房松开认知滤镜，变回原身", [present(xia)]),
        cast("在阳台读《如何做个好哥哥》", [present(xia)]),
        cast("问彗怎么做一个好姐姐，得到五条建议，划掉了第五条", [present(xia), {who: hui, role: "mentioned"}]),
        cast("办了一张卡，存进两万给星瑾当零花钱", [present(xia)]),
        cast("订了星瑾小时候最喜欢的那家店的草莓蛋糕，写了“给星瑾”", [present(xia)]),
        cast("回家前变回哥哥的样子", [present(xia)]),
        cast("星瑾没碰那张卡，说“你走的那几年，一个电话都没有”，回了房间", [present(jin), present(xia)]),
    ]);

    // 读者读到的揭示，与第 2 章星瑾信错了的那一行。
    await publish(service, "揭示", [
        change("tmp:r1", chapter("1", 21), "滤镜散开，镜子里是银白长发的女孩", {told: [inChapter("1", "镜子里那个瘦高的少年像水面一样晃了晃，散开了", [reveal(k1, "explicit")])], cast: [present(xia)]}),
        change("tmp:r2", chapter("1", 35), "银行的月度提醒里提到做魔法少女那几年", {told: [inChapter("1", "做魔法少女那几年赚的钱", [reveal(k2, "explicit")])], cast: [present(xia)]}),
        change("tmp:r3", chapter("2", 41), "星瑾以为哥哥那几年是不想回家", {
            told: [inChapter("2", "你走的那几年，一个电话都没有", [reveal(k3, "hint")])],
            cast: [present(jin), present(xia)],
            patches: [{op: "listAdd", at: {entry: jin, path: "know.知情"}, value: {id: k3, 程度: "misbelieves", 他以为的: "哥哥那几年不想回家，也不想管她"}}],
        }),
        change("tmp:r4", chapter("3", 20), "揭开父母的下落", {kind: "plan", told: [{source: "outline", chapter: "3", anchor: "父母的下落", marks: [reveal(k4, "explicit")]}], cast: [present(xia)]}),
    ]);

    const threads = await publish(service, "伏笔", [
        foreshadow("tmp:f1", "星瑾不吃煎蛋", {重要程度: "minor", 参考间隔: 1}),
        foreshadow("tmp:f2", "那张卡", {重要程度: "main"}),
        foreshadow("tmp:f3", "彗的五条建议", {}),
        foreshadow("tmp:f4", "彗做的魔偶", {重要程度: "main", 答案: {ref: k5}, 物件: [{id: idOf("魔偶")}]}),
        foreshadow("tmp:f5", "被划掉的第五条", {意图: "dropped"}),
        foreshadow("tmp:f6", "淡金色的头发", {种类: "mystery"}),
    ]);
    const [f1, f2, f3, f4, f5, f6] = ["tmp:f1", "tmp:f2", "tmp:f3", "tmp:f4", "tmp:f5", "tmp:f6"].map((id) => threads[id]!) as [string, string, string, string, string, string];
    const cardPlan = changeOf("星瑾把卡推回来");
    const plan = stored<StoredChange>(service, {kind: "change", id: cardPlan});
    await publish(service, "伏笔节点", [
        change("tmp:n1", chapter("1", 11), "星瑾说过不吃煎蛋", {told: [
            inChapter("1", "我说过不吃煎蛋", [node(f1, "plant")]),
            inChapter("1", "用钱说话，用行动办事", [node(f3, "plant")]),
            inChapter("1", "星瑕盯着第五条看了很久，把它划掉了", [node(f5, "plant")]),
        ]}),
        change("tmp:n2", chapter("2", 42), "那张卡与淡金色的头发", {told: [
            inChapter("2", "压在蛋糕旁边的那张卡", [node(f2, "plant")]),
            inChapter("2", "星瑾没去碰那张卡", [node(f2, "echo")]),
            inChapter("2", "淡金色的长发拢进帽子", [node(f6, "plant")]),
            inChapter("2", "第二条，好像也不太对", [node(f3, "payoff")]),
        ]}),
        // 设定样本里第 3 章“星瑾把卡推回来”的计划：讲述带上那张卡的回收节点。
        {ref: {kind: "change", id: cardPlan}, after: {...plan, told: plan.told.map((telling, index) => (index === 0 ? {...telling, marks: [node(f2, "payoff")]} : telling))}},
        change("tmp:n3", chapter("3", 30), "星瑾在自己房间发现那只魔偶", {kind: "plan", told: [{source: "outline", chapter: "3", anchor: "魔偶", marks: [node(f4, "plant")]}], cast: [present(jin)]}),
    ]);

    const goals = await publish(service, "目标", [
        goal("tmp:g1", "做个好哥哥", xia, {隐秘: {ref: k1}, 为什么: "欠她的那几年"}),
        goal("tmp:g2", "不让星瑾知道那几年的事", xia, {隐秘: {ref: k3}, 基于: [{id: k3}]}),
        goal("tmp:g3", "把星瑾接回家", xia, {状态: "achieved"}),
        goal("tmp:g5", "帮星瑕当好姐姐", hui, {轻重: "minor"}),
    ]);
    const finding = await publish(service, "星瑾的目标", [goal("tmp:g4", "弄清哥哥那几年去了哪", jin, {冲突: [{id: goals["tmp:g2"]!}]})]);
    // 第 2 章星瑾问不出来：她的目标受挫（目标表写“第 2 章动过”）。
    await publish(service, "目标受挫", [change("tmp:m1", chapter("2", 43), "星瑾问不出来，回了房间", {
        told: [inChapter("2", "她回了房间，门又关上了", [])],
        cast: [present(jin)],
        patches: [{op: "set", at: {entry: finding["tmp:g4"]!, path: "goal.状态"}, value: "blocked"}],
    })]);

    await publish(service, "决策", [
        {ref: {kind: "decision", id: "tmp:d1"}, after: {id: "tmp:d1", text: "什么时候让星瑾知道那几年的事", status: "pending", about: [{kind: "entry", id: k3}], due: "3", hints: []}},
        {ref: {kind: "decision", id: "tmp:d2"}, after: {id: "tmp:d2", text: "父母以什么身份回来", status: "pending", about: [{kind: "entry", id: k4}], candidates: ["双王", "失忆的普通人"], hints: []}},
    ]);

    // 回溯：切口是变回哥哥的样子（第 2 章），触发处是星瑾那句话；子线第 3 章星瑕先说了那几年的事。
    const fork = await publish(service, "回溯", [
        change("tmp:fork", chapter("2", 50), "星瑕把那个晚上倒回去重来", {
            cast: [present(xia)],
            nature: "fork",
            fork: {line: "tmp:line", name: "重来的那个晚上", parent: "main", cut: changeOf("回家前变回哥哥的样子"), trigger: changeOf("星瑾没碰那张卡，说“你走的那几年，一个电话都没有”，回了房间"), type: "rollback", who: xia},
        } as Partial<StoryChangeDraft>),
    ]);
    await publish(service, "回溯线上", [change("tmp:told", chapter("3", 10, fork["tmp:line"]!), "这一次星瑕没拿出卡，先说了那几年的事", {
        cast: [present(xia), present(jin)],
        patches: [{op: "listAdd", at: {entry: jin, path: "know.知情"}, value: {id: k3, 程度: "knows", 怎么知道: "told", 谁告诉的: {ref: xia}}}],
    })]);
}
