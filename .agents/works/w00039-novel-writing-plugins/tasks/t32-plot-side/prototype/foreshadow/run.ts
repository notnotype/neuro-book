/**
 * w00039 t32 伏笔原型：在真实的 nb-canon 内核（分支 feat/w00039-t29-canon-kernel 的 worktree）上，按 t32 README
 * “3. 伏笔”的方案把例子跑一遍。一次性原型。运行：在本目录 bun run.ts。
 *
 * 内核做的：存伏笔条目、知识点、剧情变更与讲述（讲述上的标记 `marks` 原样存下）、计划与兑现（`progress`）。
 * 原型自己算的（产品里要进 nb-canon 或插件）：节点在读者章序上的位置、兑现计划时继承节点、悬念从揭示认领节点、
 * 阶段、两级检查、窄问题、写手简报。
 */

import {createHash} from "node:crypto";

import {buildRegistry, ChapterOrder, World} from "../../../../../../../.worktree/w00039-t29-canon-kernel/packages/nb-canon/src/index";
import type {ComponentDeclaration, Entry, ReadPosition, StoryChange, WriteRequest} from "../../../../../../../.worktree/w00039-t29-canon-kernel/packages/nb-canon/src/index";

const line = (text = "") => console.log(text);
const title = (text: string) => {
    line();
    line(`## ${text}`);
};

// ---------- Component ----------

const FORESHADOW: ComponentDeclaration = {
    id: "plot.foreshadow",
    label: "伏笔",
    namespace: "fs",
    version: 1,
    fields: [
        {id: "种类", label: "种类", kind: "enum", options: ["埋设回收", "悬念", "预言", "意象"]},
        {id: "重要程度", label: "重要程度", kind: "enum", options: ["主要", "一般", "次要"]},
        {id: "意图", label: "作者的意图", kind: "enum", options: ["进行", "放弃"]},
        {id: "放弃原因", label: "放弃原因", kind: "text"},
        // 缺“条目引用”字段：答案知识点只能存条目 id 的文字。
        {id: "答案", label: "答案（知识点）", kind: "text"},
        {id: "参考间隔", label: "至少每隔几章提一次", kind: "number"},
    ],
};
const POINT: ComponentDeclaration = {id: "know.point", label: "知识点", namespace: "point", version: 1, fields: [{id: "程度", label: "保密程度", kind: "enum", options: ["常识", "行内", "保密", "绝密"]}]};

// ---------- 正文 ----------

const CHAPTERS: Record<string, string> = Object.fromEntries(Array.from({length: 22}, (_, index) => [`ch${index + 1}`, ""]));
Object.assign(CHAPTERS, {
    ch1: "她想起当年，是彗的魔偶把她从那间屋子里背了出来。银白的长发垂到腰际。门口的老人喃喃道：银月升起之日，失去的会回来。",
    ch5: "地道尽头有一扇门，她推开门，王都的暗道通向城外。",
    ch9: "妹妹盯着她银白长发看了很久。",
    ch10: "清晨，女仆在书房发现了老爷的尸体。",
    ch12: "侦探在地毯下捡到一枚袖扣，和管家常戴的那对一模一样。",
    ch14: "窗下有一串靴印，园丁的靴子正好是这个尺码。",
    ch15: "危急关头，角落里那具旧魔偶忽然自己站了起来。",
    ch16: "老仆人叹气：其实管家就是凶手，大家心里都有数。",
    ch20: "",
});
const OUTLINE: Record<string, string> = {ch15: "魔偶在危急时刻自己动了，救下她。", ch20: "揭晓：管家就是凶手。", ch22: "（细纲）魔偶再次出现。"};
const order = new ChapterOrder(Object.keys(CHAPTERS).concat("ch22").filter((id, index, all) => all.indexOf(id) === index));
const options = {order, registry: buildRegistry([FORESHADOW, POINT]), reductions: () => undefined, chapterText: (id: string) => CHAPTERS[id] ?? "", digest: (text: string) => createHash("sha256").update(text).digest("hex")};
const author = {kind: "author"} as const;

type Mark = {kind: "beat"; foreshadow: string; role: "埋下" | "呼应" | "误导" | "部分回收" | "回收"; note?: string} | {kind: "reveal"; point: string; level: "暗示" | "明说"};
type Telling = {source: "chapter" | "outline"; chapter: string; quote: string; marks?: Mark[]};

let world = World.empty(options);
let requests = 0;
let ids: Record<string, string> = {};
const id = (tmp: string) => ids[tmp] ?? tmp;
const publish = (what: WriteRequest["what"], title: string, puts: WriteRequest["puts"], chapter?: string) => {
    const result = world.publish({requestId: `r${++requests}`, by: author, what, title, baseVersion: world.data.version, puts, ...(chapter === undefined ? {} : {chapter})} as WriteRequest, "2026-11-04T00:00:00Z");
    if (!result.ok) throw new Error(`${title}：${JSON.stringify(result.failure)}`);
    world = result.world;
    ids = {...ids, ...result.ids};
    return result;
};

const foreshadow = (tmp: string, face: string, truth: string, fields: Record<string, unknown>, aliases: string[] = []): Entry => ({
    id: tmp, type: "伏笔", parent: null, folder: "伏笔", order: 0,
    init: {name: face, aliases, summary: face, text: [{id: "b1", source: truth}], data: {fs: {type: FORESHADOW.id, version: 1, enabled: true, fields: {意图: "进行", 重要程度: "一般", ...fields}}}},
});
publish("opening", "开局", [
    {ref: {kind: "entry", id: "tmp:butler"}, after: {id: "tmp:butler", type: "人物", parent: null, folder: "", order: 0, init: {name: "管家", aliases: [], summary: "", text: [], data: {}}}},
    {ref: {kind: "entry", id: "tmp:murder"}, after: {id: "tmp:murder", type: "知识点", parent: "tmp:butler", folder: "", order: 0, init: {name: "管家是凶手", aliases: [], summary: "管家是凶手", text: [], data: {point: {type: POINT.id, version: 1, enabled: true, fields: {程度: "绝密"}}}}}},
    {ref: {kind: "entry", id: "tmp:doll"}, after: foreshadow("tmp:doll", "彗的魔偶还会再派上用场", "魔偶在第 15 章危急时刻自己动起来，救下她", {种类: "埋设回收", 重要程度: "主要"})},
    {ref: {kind: "entry", id: "tmp:who"}, after: foreshadow("tmp:who", "老爷是谁杀的", "管家；第 20 章由侦探当众揭晓", {种类: "悬念", 重要程度: "主要", 答案: "tmp:murder"})},
    {ref: {kind: "entry", id: "tmp:prophecy"}, after: foreshadow("tmp:prophecy", "银月升起之日，失去的会回来", "（还没想好怎么兑现）", {种类: "预言"})},
    {ref: {kind: "entry", id: "tmp:hair"}, after: foreshadow("tmp:hair", "银白长发", "原身的样子；每次出现都在提醒她回不去了", {种类: "意象", 参考间隔: 3}, ["银白长发", "银白的长发"])},
    {ref: {kind: "entry", id: "tmp:tunnel"}, after: foreshadow("tmp:tunnel", "王都有一条通向城外的暗道", "第 5 章用上", {种类: "埋设回收", 重要程度: "次要"})},
]);
const answerOf = (entry: string) => String(world.engine.entry(entry, {kind: "initial"}, "actual") !== null ? field(entry, "答案") ?? "" : "");
function field(entry: string, name: string): unknown {
    const view = world.engine.entry(entry, {kind: "initial"}, "actual");
    return view === null || view === "chapter-not-found" ? undefined : view.namespaces.fs?.fields[name]?.value;
}
// 答案里写的是临时 id：文字字段不会被换成真实 id（缺“条目引用”的又一个后果），这里手动换。
const answer = (entry: string) => id(answerOf(entry));

let changes = 0;
const write = (kind: "written" | "plan", at: StoryChange["at"], text: string, told: Telling[], extra: Partial<StoryChange> = {}) => {
    const draft: StoryChange = {
        id: `tmp:c${++changes}`, kind, text, at,
        told: told.map((telling) => ({...telling, marks: telling.marks?.map((mark) => (mark.kind === "beat" ? {...mark, foreshadow: id(mark.foreshadow)} : {...mark, point: id(mark.point)}))})) as StoryChange["told"],
        involves: [], lines: [], links: [], patches: [], status: "active", by: author, ...extra,
    };
    return publish(kind === "plan" ? "plan" : "bookkeeping", text, [{ref: {kind: "change", id: draft.id}, after: draft}], at.kind === "chapter" ? at.chapter : undefined).ids[draft.id]!;
};
const chapter = (chapterId: string, key = 10): StoryChange["at"] => ({kind: "chapter", chapter: chapterId, key});

// 第 1 章：回忆里讲到当年的事（安放在前史），在第 1 章讲到，埋下魔偶；银白长发；老人的预言。
write("written", {kind: "prehistory", order: 1}, "当年靠彗的魔偶逃出软禁", [{source: "chapter", chapter: "ch1", quote: "是彗的魔偶把她从那间屋子里背了出来", marks: [{kind: "beat", foreshadow: "tmp:doll", role: "埋下"}]}]);
write("written", chapter("ch1", 20), "她的长发（只是提了一句）", [{source: "chapter", chapter: "ch1", quote: "银白的长发垂到腰际", marks: [{kind: "beat", foreshadow: "tmp:hair", role: "埋下"}]}]);
write("written", chapter("ch1", 30), "门口老人的预言", [{source: "chapter", chapter: "ch1", quote: "银月升起之日，失去的会回来", marks: [{kind: "beat", foreshadow: "tmp:prophecy", role: "埋下"}]}]);
// 第 5 章：暗道没埋就用上了。
write("written", chapter("ch5"), "她从王都的暗道逃出城", [{source: "chapter", chapter: "ch5", quote: "王都的暗道通向城外", marks: [{kind: "beat", foreshadow: "tmp:tunnel", role: "回收"}]}]);
// 第 9 章：长发又出现了，但记账没标节点（窄问题会问）。
write("written", chapter("ch9"), "妹妹看她的头发", [{source: "chapter", chapter: "ch9", quote: "妹妹盯着她银白长发看了很久"}]);
// 命案：第 10 章发现尸体（提出悬念）；第 12 章袖扣是对答案的暗示；第 14 章靴印是误导；第 20 章计划明说。
write("written", chapter("ch10"), "女仆发现老爷的尸体", [{source: "chapter", chapter: "ch10", quote: "女仆在书房发现了老爷的尸体", marks: [{kind: "beat", foreshadow: "tmp:who", role: "埋下"}]}]);
write("written", chapter("ch12"), "侦探捡到袖扣", [{source: "chapter", chapter: "ch12", quote: "和管家常戴的那对一模一样", marks: [{kind: "reveal", point: "tmp:murder", level: "暗示"}]}]);
write("written", chapter("ch14"), "窗下的靴印", [{source: "chapter", chapter: "ch14", quote: "园丁的靴子正好是这个尺码", marks: [{kind: "beat", foreshadow: "tmp:who", role: "误导", note: "让读者怀疑园丁"}]}]);
const revealPlan = write("plan", chapter("ch20"), "揭晓凶手", [{source: "outline", chapter: "ch20", quote: OUTLINE.ch20!, marks: [{kind: "reveal", point: "tmp:murder", level: "明说"}]}]);
// 魔偶：第 15 章计划回收（细纲带节点与给写手的指示）。
const dollPlan = write("plan", chapter("ch15"), "魔偶救下她", [{source: "outline", chapter: "ch15", quote: OUTLINE.ch15!, marks: [{kind: "beat", foreshadow: "tmp:doll", role: "回收", note: "魔偶自己动起来，不要写成她召唤的"}]}]);

// ---------- 读者章序上的节点 ----------

const chapterIndex = (chapterId: string) => order.ids.indexOf(chapterId);
type Beat = {foreshadow: string; role: Mark extends never ? never : "埋下" | "呼应" | "误导" | "部分回收" | "回收"; chapter: string; plan: boolean; change: string; quote: string; note?: string; source: "标记" | "揭示" | "继承"};

const beats = (): Beat[] => {
    const out: Beat[] = [];
    const fulfilled = new Map<string, StoryChange>();
    for (const item of world.data.changes.values()) for (const link of item.links) if (link.kind === "fulfills" && item.status === "active") fulfilled.set(link.plan, item);
    const suspenseOf = new Map([...world.data.entries.values()].filter((entry) => entry.type === "伏笔" && field(entry.id, "种类") === "悬念").map((entry) => [answer(entry.id), entry.id]));
    for (const item of world.data.changes.values()) {
        if (item.status !== "active") continue;
        // 已兑现的计划不再算计划（canon.model 输出 13）；它的节点由兑现它的已写变更继承。
        if (item.kind === "plan" && fulfilled.has(item.id)) continue;
        const own = item.told.flatMap((telling) => ((telling as Telling).marks ?? []).map((mark) => ({mark, telling: telling as Telling})));
        let marks = own;
        if (item.kind === "written" && own.length === 0) {
            const plan = item.links.find((link) => link.kind === "fulfills");
            const first = item.told.find((telling) => telling.source === "chapter");
            const planned = plan === undefined ? undefined : world.data.changes.get(plan.plan);
            if (planned !== undefined && first !== undefined) marks = planned.told.flatMap((telling) => ((telling as Telling).marks ?? []).map((mark) => ({mark, telling: {...(first as Telling), marks: undefined}, inherited: true})));
        }
        for (const {mark, telling, inherited} of marks as Array<{mark: Mark; telling: Telling; inherited?: boolean}>) {
            const base = {chapter: telling.chapter, plan: item.kind === "plan", change: item.id, quote: telling.quote};
            if (mark.kind === "beat") out.push({...base, foreshadow: mark.foreshadow, role: mark.role, note: mark.note, source: inherited ? "继承" : "标记"});
            else {
                const claimed = suspenseOf.get(mark.point);
                if (claimed !== undefined) out.push({...base, foreshadow: claimed, role: mark.level === "明说" ? "回收" : "呼应", source: "揭示"});
            }
        }
    }
    return out.sort((a, b) => chapterIndex(a.chapter) - chapterIndex(b.chapter));
};

const name = (entry: string) => world.data.entries.get(entry)?.init.name ?? entry;
const foreshadows = () => [...world.data.entries.values()].filter((entry) => entry.type === "伏笔");

/** 读到某章末尾时的账本：阶段、上次出现、检查。 */
const ledger = (at: string, mode: "actual" | "planned" = "actual") => {
    const all = beats().filter((beat) => (mode === "planned" || !beat.plan) && chapterIndex(beat.chapter) <= chapterIndex(at));
    const planned = beats().filter((beat) => beat.plan);
    const pending: string[] = [];
    const hints: string[] = [];
    const rows = foreshadows().map((entry) => {
        const mine = all.filter((beat) => beat.foreshadow === entry.id);
        const kind = String(field(entry.id, "种类"));
        const abandoned = field(entry.id, "意图") === "放弃";
        const planted = mine.find((beat) => beat.role === "埋下");
        const paid = mine.find((beat) => beat.role === "回收");
        const stage = paid !== undefined ? "已回收" : mine.some((beat) => beat.role === "部分回收") ? "部分回收" : mine.some((beat) => beat.role === "呼应" || beat.role === "误导") ? "呼应中" : planted !== undefined ? "已埋" : "未埋";
        if (paid !== undefined && (planted === undefined || chapterIndex(planted.chapter) > chapterIndex(paid.chapter))) pending.push(`没埋就回收：“${entry.init.name}”在第 ${paid.chapter.slice(2)} 章回收，之前没有埋下`);
        if (paid !== undefined && mine.some((beat) => beat.role === "埋下" && chapterIndex(beat.chapter) > chapterIndex(paid.chapter))) pending.push(`回收以后又埋：“${entry.init.name}”`);
        const futurePayoff = planned.find((beat) => beat.foreshadow === entry.id && beat.role === "回收" && chapterIndex(beat.chapter) > chapterIndex(at));
        if (paid !== undefined && paid.source === "揭示" && futurePayoff !== undefined && chapterIndex(paid.chapter) < chapterIndex(futurePayoff.chapter)) pending.push(`泄底：“${entry.init.name}”计划第 ${futurePayoff.chapter.slice(2)} 章回收，第 ${paid.chapter.slice(2)} 章已经明说`);
        if (!abandoned && planted !== undefined && paid === undefined && kind !== "意象" && !planned.some((beat) => beat.foreshadow === entry.id && beat.role === "回收")) hints.push(`已埋没排回收：“${entry.init.name}”（第 ${planted.chapter.slice(2)} 章埋下）`);
        const cadence = Number(field(entry.id, "参考间隔") ?? 0);
        const last = mine.at(-1);
        if (cadence > 0 && last !== undefined && chapterIndex(at) - chapterIndex(last.chapter) > cadence) hints.push(`太久没提：“${entry.init.name}”上次在第 ${last.chapter.slice(2)} 章，已经 ${chapterIndex(at) - chapterIndex(last.chapter)} 章`);
        if (abandoned && planted !== undefined) hints.push(`放弃了但正文还留着埋下的句子：“${entry.init.name}”——第 ${planted.chapter.slice(2)} 章“${planted.quote}”`);
        return {entry: entry.init.name, kind, stage: abandoned ? `放弃（${stage}）` : stage, last: last === undefined ? "—" : `第 ${last.chapter.slice(2)} 章${last.source === "揭示" ? "（由揭示认领）" : last.source === "继承" ? "（继承自计划）" : ""}`};
    });
    // 计划的节点那一章写完了却没有：读取位置已经过了那一章，计划还没兑现。
    for (const beat of planned) if (chapterIndex(beat.chapter) < chapterIndex(at) && world.engine.progress(beat.change, {kind: "chapter", chapter: at, edge: "end"}) === "unfulfilled" && beat.source !== "揭示") pending.push(`计划的节点没写出来：“${name(beat.foreshadow)}”计划第 ${beat.chapter.slice(2)} 章${beat.role}`);
    // 没有悬念认领的暗示。
    for (const item of world.data.changes.values()) for (const telling of item.told) for (const mark of (telling as Telling).marks ?? []) if (mark.kind === "reveal" && mark.level === "暗示" && !foreshadows().some((entry) => answer(entry.id) === mark.point) && chapterIndex(telling.chapter!) <= chapterIndex(at)) hints.push(`没有悬念认领的暗示：第 ${telling.chapter!.slice(2)} 章“${telling.quote}”`);
    return {rows, pending, hints};
};

const show = (at: string) => {
    const {rows, pending, hints} = ledger(at);
    line(`读到第 ${at.slice(2)} 章末：`);
    for (const row of rows) line(`- ${row.entry}（${row.kind}）：${row.stage}，上次 ${row.last}`);
    line(`  待处理：${pending.join("；") || "无"}`);
    line(`  提示：${hints.join("；") || "无"}`);
};

/** 写某章之前给写手的简报。 */
const briefing = (chapterId: string) => {
    const planned = beats().filter((beat) => beat.plan && beat.chapter === chapterId && beat.source !== "揭示");
    const out: string[] = [];
    for (const beat of planned) {
        const entry = world.data.entries.get(beat.foreshadow)!;
        out.push(`本章要${beat.role}：“${entry.init.name}”${beat.role === "回收" ? `——怎么回收：${entry.init.text[0]?.source}` : ""}${beat.note === undefined ? "" : `（指示：${beat.note}）`}`);
    }
    const previous = order.ids[chapterIndex(chapterId) - 1]!;
    for (const row of ledger(previous).rows) {
        const entry = foreshadows().find((item) => item.init.name === row.entry)!;
        if (planned.some((beat) => beat.foreshadow === entry.id) || row.stage === "已回收" || row.stage.startsWith("放弃") || row.stage === "未埋") continue;
        const secret = answer(entry.id) !== "" ? "；答案是绝密知识点，不给内容" : "";
        if (row.kind === "意象") out.push(`意象“${row.entry}”：上次 ${row.last}，可以自然地带一笔`);
        else out.push(`进行中：“${row.entry}”——不要回收、不要点破${secret}`);
    }
    return out;
};

/** 写完某章后的窄问题：计划里本章有节点的；进行中伏笔的名字或别名出现在本章、却没有标节点的。 */
const narrowQuestions = (chapterId: string) => {
    const out: string[] = [];
    for (const beat of beats().filter((item) => item.plan && item.chapter === chapterId && item.source !== "揭示")) out.push(`计划第 ${chapterId.slice(2)} 章${beat.role}“${name(beat.foreshadow)}”：引出做到它的原句，或者答没写。`);
    const marked = new Set(beats().filter((beat) => !beat.plan && beat.chapter === chapterId).map((beat) => beat.foreshadow));
    for (const entry of foreshadows()) {
        if (marked.has(entry.id)) continue;
        const word = entry.init.aliases.find((alias) => (CHAPTERS[chapterId] ?? "").includes(alias));
        if (word !== undefined) out.push(`第 ${chapterId.slice(2)} 章出现了“${word}”：这是不是“${entry.init.name}”的呼应？是的话引原句。`);
    }
    return out;
};

// ---------- 例子 ----------

title("1. 读到第 14 章：账本");
show("ch14");

title("2. 第 9 章写完后的窄问题（长发出现了，但没标节点）");
for (const item of narrowQuestions("ch9")) line(`- ${item}`);

title("3. 写第 15 章之前给写手的简报");
for (const item of briefing("ch15")) line(`- ${item}`);

title("4. 第 15 章写出来了、兑现了计划（节点从计划继承）");
write("written", chapter("ch15"), "魔偶救下她", [{source: "chapter", chapter: "ch15", quote: "角落里那具旧魔偶忽然自己站了起来"}], {links: [{kind: "fulfills", plan: dollPlan}]});
show("ch15");

title("5. 第 16 章有人把凶手说破了（明说早于计划的第 20 章）");
write("written", chapter("ch16"), "老仆人说破凶手", [{source: "chapter", chapter: "ch16", quote: "其实管家就是凶手", marks: [{kind: "reveal", point: "tmp:murder", level: "明说"}]}]);
show("ch16");

title("6. 预言放弃了");
{
    // 放弃是作者改伏笔条目的初值（创作修改），不随章变。
    const prophecy = world.data.entries.get(id("tmp:prophecy"))!;
    const fs = prophecy.init.data.fs!;
    const changed: Entry = {...prophecy, init: {...prophecy.init, data: {...prophecy.init.data, fs: {...fs, fields: {...fs.fields, 意图: "放弃", 放弃原因: "和结局冲突"}}}}};
    publish("edit", "放弃预言", [{ref: {kind: "entry", id: prophecy.id}, after: changed}]);
}
show("ch16");

title("7. 换一种走向：第 15 章写了，但没有兑现魔偶的计划");
{
    // 撤销刚才第 15 章兑现计划的那条已写变更，看完再换回来。
    const saved = world;
    const fifteen = [...world.data.changes.values()].find((item) => item.kind === "written" && item.text === "魔偶救下她")!;
    publish("edit", "撤销第 15 章那条", [{ref: {kind: "change", id: fifteen.id}, after: {...fifteen, status: "undone", undoneReason: "试另一种写法"}}]);
    show("ch16");
    world = saved;
}

title("8. 内核的缺口（实测）");
{
    const stored = [...world.data.changes.values()].find((item) => item.text === "窗下的靴印")!.told[0] as Telling;
    line(`- 讲述上的节点标记原样存下：${JSON.stringify(stored.marks)}`);
    line(`- 伏笔“老爷是谁杀的”的答案字段存的是：${JSON.stringify(field(id("tmp:who"), "答案"))}（同一次写入里的临时 id，文字字段里不换成真实 id ${id("tmp:murder")}）`);
    const created = publish("edit", "建伏笔：钟楼的钥匙", [{ref: {kind: "entry", id: "tmp:key"}, after: foreshadow("tmp:key", "钟楼的钥匙", "第 30 章用上", {种类: "埋设回收"})}]);
    write("written", chapter("ch9", 20), "她把钥匙收进口袋", [{source: "chapter", chapter: "ch9", quote: "妹妹盯着她银白长发看了很久", marks: [{kind: "beat", foreshadow: "tmp:key", role: "埋下"}]}]);
    const reverted = world.revert(created.revision.id, false, {requestId: "rv", by: author}, "t");
    line(`- 还原“建伏笔”那次修订（讲述上的节点引用它）：${reverted.ok ? "直接还原成功，没有列出依赖，留下一个指向被撤掉的伏笔的节点" : `被拒：${JSON.stringify(reverted.failure).slice(0, 160)}`}`);
    void revealPlan;
}
