/**
 * w00039 t32 剧情侧提案的深入审查：用真实的 nb-canon 内核（分支 feat/w00039-t29-canon-kernel 的 worktree）搭审查用的
 * 世界，生成 F1 要用的写手简报与窄问题。一次性脚本。
 *
 * 运行：bun build.ts <输出目录>（审查材料在 git 忽略的 .local/agent/works/w00039-novel-writing-plugins/tasks/t32-plot-side/review/）。
 *
 * 简报里“知情”一段由内核里的数据按 t32 README“2. 知情”的规则算出；写作指示、细纲照抄材料；其余几段（目标、态度、
 * 伏笔、决策）按材料手写成同样的格式，文件里标明。
 */

import {createHash} from "node:crypto";
import {mkdir, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {buildRegistry, ChapterOrder, World} from "../../../../../../../.worktree/w00039-t29-canon-kernel/packages/nb-canon/src/index";
import type {ComponentDeclaration, Entry, Patch, ReadPosition, StoryChange, WriteRequest} from "../../../../../../../.worktree/w00039-t29-canon-kernel/packages/nb-canon/src/index";

const output = process.argv[2];
if (output === undefined) throw new Error("用法：bun build.ts <输出目录>");

const POINT: ComponentDeclaration = {id: "know.point", label: "知识点", namespace: "point", version: 1, fields: [{id: "程度", label: "保密程度", kind: "enum", options: ["常识", "行内", "保密", "绝密"]}, {id: "规则", label: "谁可能知道", kind: "text"}]};
const MIND: ComponentDeclaration = {
    id: "know.mind", label: "知情", namespace: "know", version: 1,
    fields: [{id: "知情", label: "知道的事", kind: "list", item: [
        {id: "程度", label: "程度", kind: "enum", options: ["知道", "误信", "怀疑", "不知道", "忘了"]},
        {id: "以为", label: "他以为的", kind: "text"},
        {id: "怎么知道", label: "怎么知道", kind: "enum", options: ["亲历", "听说", "推断", "读到", "传闻", "本人"]},
        {id: "谁告诉的", label: "谁告诉的", kind: "text"},
    ]}],
};

const CHAPTERS: Record<string, string> = Object.fromEntries(Array.from({length: 20}, (_, index) => [`ch${index + 1}`, ""]));
Object.assign(CHAPTERS, {
    ch3: "国王屏退了侍从，压低声音对贤者说：预言里的勇者已经出发了。勇者的额头上有一枚星印，这件事不能让任何人知道。",
    ch10: "经过走廊时她想起来，昨夜十一点前后，她起来关窗，看见一个穿着园丁外套的背影从走廊尽头闪过。",
    ch14: "老爷上个月改了遗嘱，庄园留给了小梅。",
});
const order = new ChapterOrder(Object.keys(CHAPTERS));
let world = World.empty({order, registry: buildRegistry([POINT, MIND]), reductions: () => undefined, chapterText: (id: string) => CHAPTERS[id], digest: (text: string) => createHash("sha256").update(text).digest("hex")});
const author = {kind: "author"} as const;
let ids: Record<string, string> = {};
let requests = 0;
const id = (tmp: string) => ids[tmp] ?? tmp;
const publish = (what: WriteRequest["what"], title: string, puts: WriteRequest["puts"], chapter?: string) => {
    const result = world.publish({requestId: `r${++requests}`, by: author, what, title, baseVersion: world.data.version, puts, ...(chapter === undefined ? {} : {chapter})} as WriteRequest, "2026-11-04T00:00:00Z");
    if (!result.ok) throw new Error(`${title}：${JSON.stringify(result.failure)}`);
    world = result.world;
    ids = {...ids, ...result.ids};
};

const person = (tmp: string, name: string): Entry => ({id: tmp, type: "人物", parent: null, folder: "", order: 0, init: {name, aliases: [], summary: "", text: [], data: {know: {type: MIND.id, version: 1, enabled: true, fields: {知情: []}}}}});
const point = (tmp: string, about: string, claim: string, level: string, rule: string): Entry => ({id: tmp, type: "知识点", parent: about, folder: "", order: 0, init: {name: claim, aliases: [], summary: claim, text: [], data: {point: {type: POINT.id, version: 1, enabled: true, fields: {程度: level, 规则: rule}}}}});
const people: Array<[string, string]> = [["tmp:hero", "勇者"], ["tmp:king", "国王"], ["tmp:sage", "贤者"], ["tmp:guard", "卫兵"], ["tmp:xia", "星瑕"], ["tmp:jin", "星瑾"], ["tmp:butler", "管家"], ["tmp:mei", "小梅"], ["tmp:zhou", "园丁老周"], ["tmp:lin", "侦探林默"], ["tmp:xu", "律师许先生"], ["tmp:fu", "福伯"], ["tmp:master", "老爷"]];
publish("opening", "开局", [
    ...people.map(([tmp, name]) => ({ref: {kind: "entry" as const, id: tmp}, after: person(tmp, name)})),
    {ref: {kind: "entry", id: "tmp:star"}, after: point("tmp:star", "tmp:hero", "勇者的额头有星印", "保密", "只有国王、贤者与勇者本人知道")},
    {ref: {kind: "entry", id: "tmp:confined"}, after: point("tmp:confined", "tmp:xia", "哥哥那几年是被软禁", "保密", "只有星瑕自己知道")},
    {ref: {kind: "entry", id: "tmp:girl"}, after: point("tmp:girl", "tmp:xia", "星瑕就是魔法少女", "保密", "官方知道“魔法少女”这个公开身份（代号与变身形态），不知道她的原身是星瑕；家里没人知道")},
    {ref: {kind: "entry", id: "tmp:k1"}, after: point("tmp:k1", "tmp:butler", "管家是凶手", "绝密", "")},
    {ref: {kind: "entry", id: "tmp:k2"}, after: point("tmp:k2", "tmp:master", "老爷生前改了遗嘱，把庄园留给小梅", "保密", "只有律师与偷听到的管家知道")},
]);

const listAdd = (who: string, pointTmp: string, fields: Record<string, unknown>): Patch => ({op: "listAdd", at: {entry: id(who), path: "know.知情"}, value: {id: id(pointTmp), label: world.data.entries.get(id(pointTmp))!.init.name, ...fields}});
let changes = 0;
const write = (at: StoryChange["at"], text: string, patches: Patch[], told: StoryChange["told"] = []) => {
    const draft: StoryChange = {id: `tmp:c${++changes}`, kind: "written", text, at, told, involves: [], lines: [], links: [], patches, status: "active", by: author};
    publish("bookkeeping", text, [{ref: {kind: "change", id: draft.id}, after: draft}], at.kind === "chapter" ? at.chapter : undefined);
};
const prehistory = (order: number): StoryChange["at"] => ({kind: "prehistory", order});
const chapter = (chapterId: string): StoryChange["at"] => ({kind: "chapter", chapter: chapterId, key: 10});

write(prehistory(1), "星瑕本人的秘密", [listAdd("tmp:xia", "tmp:confined", {程度: "知道", 怎么知道: "本人"}), listAdd("tmp:xia", "tmp:girl", {程度: "知道", 怎么知道: "本人"})]);
write(prehistory(2), "哥哥走后音讯全无", [listAdd("tmp:jin", "tmp:confined", {程度: "误信", 以为: "哥哥这些年不想回家", 怎么知道: "推断"})]);
write(prehistory(3), "管家偷听到遗嘱", [listAdd("tmp:butler", "tmp:k2", {程度: "知道", 怎么知道: "亲历"}), listAdd("tmp:xu", "tmp:k2", {程度: "知道", 怎么知道: "本人"})]);
write(prehistory(4), "管家杀了老爷", [listAdd("tmp:butler", "tmp:k1", {程度: "知道", 怎么知道: "亲历"})]);
write(prehistory(5), "勇者从小就知道自己额头有星印，但不知道它意味着什么", [listAdd("tmp:hero", "tmp:star", {程度: "知道", 怎么知道: "本人"})]);
write(chapter("ch3"), "国王与贤者谈勇者的星印", [listAdd("tmp:king", "tmp:star", {程度: "知道", 怎么知道: "本人"}), listAdd("tmp:sage", "tmp:star", {程度: "知道", 怎么知道: "听说", 谁告诉的: id("tmp:king")})], [{source: "chapter", chapter: "ch3", quote: "勇者的额头上有一枚星印"}]);
write(chapter("ch10"), "小梅想起昨夜看见穿园丁外套的背影", [listAdd("tmp:mei", "tmp:k1", {程度: "误信", 以为: "凶手是园丁老周", 怎么知道: "亲历"})], [{source: "chapter", chapter: "ch10", quote: "看见一个穿着园丁外套的背影从走廊尽头闪过"}]);
write(chapter("ch14"), "律师把遗嘱的事告诉林默", [listAdd("tmp:lin", "tmp:k2", {程度: "知道", 怎么知道: "听说", 谁告诉的: id("tmp:xu")})], [{source: "chapter", chapter: "ch14", quote: "老爷上个月改了遗嘱，庄园留给了小梅"}]);

type Row = {id: string; label: string; 程度: string; 以为?: string};
const rows = (who: string, position: ReadPosition): Row[] => {
    const view = world.engine.entry(who, position, "actual");
    return view === null || view === "chapter-not-found" ? [] : ((view.namespaces.know?.fields.知情?.value as Row[] | null) ?? []);
};
const name = (entry: string) => world.data.entries.get(entry)!.init.name;
const field = (entry: string, key: string) => {
    const view = world.engine.entry(entry, {kind: "initial"}, "actual");
    return view === null || view === "chapter-not-found" ? "" : String(view.namespaces.point?.fields[key]?.value ?? "");
};
const points = () => [...world.data.entries.values()].filter((entry) => entry.type === "知识点");

/** 和这场戏有关的知识点：说的是在场的人，或者在场的人对它有行。 */
const relevant = (position: ReadPosition, present: string[]) => points().filter((item) => present.map(id).includes(item.parent!) || present.some((who) => rows(id(who), position).some((row) => row.id === item.id)));

/** 简报的知情一段（给写手）。 */
const knowledgeBrief = (chapterId: string, present: string[], pov: string) => {
    const position: ReadPosition = {kind: "chapter", chapter: chapterId, edge: "start"};
    const lines: string[] = [];
    for (const item of relevant(position, present)) {
        const level = field(item.id, "程度");
        if (level === "常识") continue;
        if (level === "行内") {
            lines.push(`- 行内：“${item.init.name}”——${field(item.id, "规则")}。按这条推，推出来的会被记成“推断”。`);
            continue;
        }
        const content = level === "绝密" ? `一件涉及${name(item.parent!)}的绝密设定（不给内容）` : `“${item.init.name}”（${field(item.id, "规则")}）`;
        const states = present.map((who) => {
            const row = rows(id(who), position).find((candidate) => candidate.id === item.id);
            return `${name(id(who))}：${row === undefined ? "不知道" : `${row.程度}${row.以为 === undefined ? "" : `（以为：${row.以为}）`}`}`;
        });
        lines.push(`- ${level}：${content}。${states.join("；")}。没列为知道的人一律当作不知道，不得写成知道。`);
    }
    const povRows = rows(id(pov), position);
    const unknown = relevant(position, present).filter((item) => ["保密", "绝密"].includes(field(item.id, "程度")) && !povRows.some((row) => row.id === item.id && row.程度 === "知道"));
    lines.push(`- 视角：${name(id(pov))}（有限）。叙述只写${name(id(pov))}知道、看到、想到的；${unknown.length === 0 ? "" : `叙述里不能写出${name(id(pov))}不知道的：${unknown.map((item) => (field(item.id, "程度") === "绝密" ? `涉及${name(item.parent!)}的绝密设定` : `“${item.init.name}”`)).join("、")}。`}`);
    return lines.join("\n");
};

/** 写完以后的窄问题（给记账 Agent，不是给写手，所以绝密的内容照给）。 */
const narrowQuestions = (chapterId: string, present: string[], pov: string) => {
    const position: ReadPosition = {kind: "chapter", chapter: chapterId, edge: "start"};
    const out: string[] = [];
    for (const item of relevant(position, present).filter((candidate) => ["保密", "绝密"].includes(field(candidate.id, "程度")))) {
        for (const who of present) {
            const row = rows(id(who), position).find((candidate) => candidate.id === item.id);
            if (row?.程度 === "知道") continue;
            out.push(`- 对白层：${name(id(who))}（对“${item.init.name}”是${row === undefined ? "不知道" : row.程度 + (row.以为 === undefined ? "" : `，以为：${row.以为}`)}）在这一章有没有按这件事说话或行动？有就引原句，没有就答“没有”。`);
        }
        const povRow = rows(id(pov), position).find((candidate) => candidate.id === item.id);
        if (povRow?.程度 !== "知道") out.push(`- 叙述层：这一章是${name(id(pov))}的有限视角，${name(id(pov))}对“${item.init.name}”是${povRow === undefined ? "不知道" : povRow.程度}。叙述有没有写出${name(id(pov))}不知道、看不到的、和这件事有关的内容？有就引原句。`);
    }
    return out.join("\n");
};

await mkdir(output, {recursive: true});
const header = "（由 t32 prototype/review-fixture/build.ts 用分支上的 nb-canon 生成：“知情”一段按内核里的数据算出；其余几段按材料手写成同样的格式。）\n\n";

await writeFile(join(output, "ch4-guard.txt"), `${header}# 写手的上下文：第 4 章

## 写作指示
视角：勇者（有限）。语气：轻松。结尾：旅店老板娘多看了他一眼，留个小钩子，不点破。不写：任何人认出勇者。

## 细纲
勇者第一次进王都。傍晚，他戴着兜帽在城门口被卫兵拦下盘查。卫兵例行公事地问了来历，收了入城税，放他进去。勇者在城里找到一家旅店住下，旅店老板娘多看了他一眼。

## 本章计划
- 勇者进入王都，在旅店住下。

## 简报
### 知情
${knowledgeBrief("ch4", ["tmp:hero", "tmp:guard"], "tmp:hero")}
### 在场的人（手写）
- 勇者：想先在王都站稳脚跟、不引人注意（进行）。
- 卫兵：只想早点交班（这一场的临时人物，没有条目）。
### 决策（手写）
- 已定：“勇者的身份在第一卷里不能被认出”（作者原话）。

## 涉及的条目（第 4 章开头）
- 勇者：年轻的旅人，戴兜帽，额头的星印平时看不见，只有月光下才会发亮。
`);

await writeFile(join(output, "ch7-xingjin.txt"), `${header}# 写手的上下文：第 7 章（星瑾视角的一场）

## 写作指示
视角：星瑾（有限）。语气：克制，不煽情。结尾：星瑾回房，没有和哥哥说晚安。不写：星瑾知道哥哥是魔法少女；兄妹和好。

## 细纲
星瑾放学回家，哥哥做了她小时候最爱吃的糖醋排骨。她嘴上冷淡，心里动摇了一下。吃完饭她经过哥哥的房间，门锁着，里面传出一个女孩子的声音在打电话。她站了一会儿，回了自己房间。

## 本章计划
- 星瑾对哥哥的态度：记一句“吃到小时候的菜，心里动摇了一下”。

## 简报
### 知情
${knowledgeBrief("ch7", ["tmp:jin", "tmp:xia"], "tmp:jin")}
### 在场的人（手写）
- 星瑾：想要哥哥先开口认错（进行，主要）。为什么：她以为哥哥这些年不想回家（误信，此刻不要让她知道真相）。对星瑕：冷淡，最近松动了一点。
- 星瑕：不让妹妹发现自己是魔法少女（进行，主要）；修复和妹妹的关系（进行，主要）。对星瑾：想亲近，又怕说错话。（房间里打电话的女孩子声音，其实是星瑕用原身在和朋友彗通话；这是她的秘密，只有她自己知道。）
### 决策（手写）
- 已定：“第一卷不让星瑾发现哥哥是魔法少女，让读者跟着她慢慢发现。”（作者原话）

## 涉及的条目（第 7 章开头）
- 星瑾：星瑕的妹妹，高中生，嘴硬。
- 星瑕：以哥哥的样子在家；私下用原身（女性）活动；房门常锁。
`);

await writeFile(join(output, "ch16-narrow-questions.txt"), `${header}# 第 16 章写完后的窄问题（给记账 Agent）

在场：小梅、福伯、管家。视角：小梅（有限）。下面的问题由程序按“本章涉及的保密以上知识点 × 在场且不知道的人”与“视角人物不知道的”圈出；逐条回答，引原句。

${narrowQuestions("ch16", ["tmp:mei", "tmp:fu", "tmp:butler"], "tmp:mei")}
`);
console.log(`写到 ${output}`);


// ---------- 第二版的简报（剧情侧提案第二版第 12、13 小节） ----------

/** 第二版的窄问题：在场层分真相与误信、叙述层、读者层、伏笔物件层。 */
const narrowQuestionsV2 = (chapterId: string, present: string[], pov: string, extra: string[]) => {
    const position: ReadPosition = {kind: "chapter", chapter: chapterId, edge: "start"};
    const out: string[] = [];
    for (const item of relevant(position, present).filter((candidate) => ["保密", "绝密"].includes(field(candidate.id, "程度")))) {
        for (const who of present) {
            const row = rows(id(who), position).find((candidate) => candidate.id === item.id);
            if (row?.程度 === "知道") continue;
            out.push(`- 在场层（按真相）：${name(id(who))}对“${item.init.name}”是${row === undefined ? "不知道" : row.程度}。这一章${name(id(who))}有没有说出或做出只有知道这件事才会说、才会做的？有就引原句，没有就答“没有”。`);
            if (row?.以为 !== undefined) out.push(`- 在场层（按误信）：${name(id(who))}以为“${row.以为}”。这一章${name(id(who))}的言行和这个误信一致吗？不一致的引原句；这个误信是从哪一章、怎么来的，正文里有没有交代？`);
        }
        const povRow = rows(id(pov), position).find((candidate) => candidate.id === item.id);
        if (povRow?.程度 !== "知道") out.push(`- 叙述层：这一章是${name(id(pov))}的有限视角，${name(id(pov))}对“${item.init.name}”是${povRow === undefined ? "不知道" : povRow.程度}。叙述有没有写出${name(id(pov))}不知道、看不到、听不到的和这件事有关的内容？有就引原句。`);
    }
    out.push(...extra);
    return out.join("\n");
};

const headerV2 = "（第二版格式。由 t32 prototype/review-fixture/build.ts 用分支上的 nb-canon 生成：“知情”一段按内核里的数据算出；“称呼”“读者已知”“在场的人”“伏笔”“决策”按提案第二版第 12 小节的规则手写成同样的格式（这几段的计算还没做）。）\n\n";
const allowed = `## 本章允许新增什么
- 可以编：场景里的小细节（天气、陈设、路人、动作、对话的措辞）。
- 不许新增：有名字的人物、地点、物品，世界设定（规则、历史、能力），数值（钱、税额、数量），以及改变细纲写定的结果。真要用到，写进自陈，用泛称（“几个铜板”）。

## 交回时附自陈
- 新出现的名字与事实：……
- 拿不准的：……
- 偏离细纲的：……
`;

await writeFile(join(output, "ch4-guard-v2.txt"), `${headerV2}# 写手的上下文：第 4 章（约 800 字）

## 写作指示
视角：勇者（有限）。语气：轻松。结尾：停在旅店老板娘多看了他一眼，只写她看了，不解释为什么。不写：任何人认出勇者。

## 细纲
勇者第一次进王都。傍晚，他戴着兜帽在城门口被卫兵拦下盘查。卫兵例行公事地问了来历，收了入城税，放他进去。勇者在城里找到一家旅店住下，旅店老板娘多看了他一眼。

## 本章计划（细纲之外的）
- 没有状态变化；没有人新知道什么。

## 简报
### 知情
${knowledgeBrief("ch4", ["tmp:hero", "tmp:guard"], "tmp:hero")}
- 视角人物自己知道的秘密可以写进他的心理，但不能让在场的人看出来。
- 星印只在月光下发亮；这一场是傍晚、月亮还没上来，额头没有异样。
### 读者已知
- 读者在第 3 章读到了国王与贤者的对话，已经知道勇者额头有星印、只在月光下发亮；卫兵不知道。这一场的紧张来自读者知道而卫兵不知道，不要再向读者解释星印。
### 称呼
- 叙述称他“勇者”或“他”；卫兵与老板娘不知道他是谁，对白里叫他“小子”“客官”之类。
### 在场的人
- 勇者：想先在王都站稳脚跟、不引人注意（进行）。来历对外只说“从东边来”，不说村名。
- 卫兵：只想早点交班（这一场的临时人物，没有条目，不写名字）。
### 决策
- 已定：“勇者的身份在第一卷里不能被认出”（作者原话）。

## 涉及的条目（第 4 章开头）
- 勇者：年轻的旅人，戴兜帽，背一个旧包袱；额头的星印平时看不见，只有月光下才会发亮。

## 上一章末尾
窗外，一只乌鸦扑棱着翅膀飞走了。

${allowed}`);

await writeFile(join(output, "ch7-xingjin-v2.txt"), `${headerV2}# 写手的上下文：第 7 章（星瑾视角的一场，约 800 字）

## 写作指示
视角：星瑾（有限）。语气：克制，不煽情；她的动摇用动作与细节表现，不直接写“心里动摇了”。结尾：星瑾回房，没有和哥哥说晚安。不写：星瑾知道或猜到哥哥是魔法少女；兄妹和好。

## 细纲
星瑾放学回家，哥哥做了她小时候最爱吃的糖醋排骨。她嘴上冷淡，心里动摇了一下。吃完饭她经过哥哥的房间，门锁着，里面传出一个女孩子的声音在打电话。她站了一会儿，回了自己房间。

## 本章计划（细纲之外的）
- 星瑾对哥哥的态度：记一句“吃到小时候的菜，有一点松动”（这是给记账看的，不要照抄进正文）。

## 简报
### 知情
${knowledgeBrief("ch7", ["tmp:jin", "tmp:xia"], "tmp:jin")}
- 房间里打电话的女孩子声音，是哥哥用原身在和朋友彗通话。星瑾不知道，也听不出是谁：声音隔着门、字句不清、她不觉得耳熟；哥哥不知道她站在门外。叙述与星瑾的心理里都不能出现“原身”“魔法少女”“哥哥的声音”，也不要让她猜到。
### 读者已知
- 读者知道哥哥就是魔法少女、私下用原身活动，所以门里的声音对读者是反讽；星瑾不知道。
### 称呼
- 星瑾只知道“哥哥”这个身份：叙述与她的心理里一律称“哥哥”或“他”，不出现“星瑕”这个名字。
### 在场的人
- 星瑾：想要哥哥先开口认错（进行，主要）。为什么：她以为哥哥这些年不想回家（误信）。哥哥不在的那几年她被安置在一个刻薄的亲戚家；这一章不要展开那几年。对哥哥：冷淡，最近松动了一点。
- 哥哥：不让妹妹发现自己是魔法少女（进行，主要）；修复和妹妹的关系（进行，主要）。对星瑾：想亲近，又怕说错话。
### 决策
- 已定：“第一卷不让星瑾发现哥哥是魔法少女，让读者跟着她慢慢发现。”（作者原话）

## 涉及的条目（第 7 章开头，按星瑾的视角）
- 星瑾：高中生，嘴硬。
- 哥哥：回家没多久，房门常锁。

## 上一章末尾
（示意：第 6 章停在哥哥在厨房问她明天想吃什么，她没回答。）

${allowed}`);

await writeFile(join(output, "ch16-narrow-questions-v2.txt"), `${headerV2}# 第 16 章写完后的窄问题（第二版，给记账 Agent）

在场：小梅、福伯、管家。视角：小梅（有限）。

${narrowQuestionsV2("ch16", ["tmp:mei", "tmp:fu", "tmp:butler"], "tmp:mei", [
    "- 读者层：“管家是凶手”计划第 20 章向读者揭示，已定决策 D1 是“第 20 章之前不要让读者确定凶手是谁”。读完这一章，读者能不能确定凶手是管家？能的话引出让读者确定的原句。",
    "- 伏笔物件层：伏笔 F2“书房的钟停在十一点”打算第 20 章用来证明管家十一点在书房。这一章有没有动到这座钟？动了的话引原句，并说第 20 章的用法还成不成立。",
])}
`);
console.log(`第二版简报写到 ${output}`);
