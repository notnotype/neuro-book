/**
 * w00039 t32 知情原型：在真实的 nb-canon 内核（分支 feat/w00039-t29-canon-kernel 的 worktree）上，按 t32 README
 * “2. 知情”的草稿把例子跑一遍，看现有的条目、Component、补丁与计划能不能拼出来，缺什么。一次性原型。
 *
 * 运行：在本目录 bun run.ts（要有 .worktree/w00039-t29-canon-kernel）。
 *
 * 内核做的：存知识点条目与人物上的知情列表、讲述上的揭示标记（讲述的 schema 不限多出来的键，原样存下）、按章折叠、
 * 计划、还原。原型自己算的（产品里要进内核或插件）：读者的知情、给写手的简报、穿帮候选、传话链、提前泄底、反讽。
 */

import {createHash} from "node:crypto";

import {buildRegistry, ChapterOrder, World} from "../../../../../../../.worktree/w00039-t29-canon-kernel/packages/nb-canon/src/index";
import type {ComponentDeclaration, Entry, Patch, ReadPosition, StoryChange, WriteRequest} from "../../../../../../../.worktree/w00039-t29-canon-kernel/packages/nb-canon/src/index";

const line = (text = "") => console.log(text);
const title = (text: string) => {
    line();
    line(`## ${text}`);
};

// ---------- 两个 Component ----------

const POINT: ComponentDeclaration = {
    id: "know.point",
    label: "知识点",
    namespace: "point",
    version: 1,
    fields: [
        {id: "程度", label: "保密程度", kind: "enum", options: ["常识", "行内", "保密", "绝密"]},
        {id: "规则", label: "谁可能知道", kind: "text"},
    ],
};
const MIND: ComponentDeclaration = {
    id: "know.mind",
    label: "知情",
    namespace: "know",
    version: 1,
    fields: [
        {
            id: "知情",
            label: "知道的事",
            kind: "list",
            // 元素 id 用知识点的条目 id：一个人对一个知识点只有一行（再加一次同一个 id，内核报套不上）。
            item: [
                {id: "程度", label: "程度", kind: "enum", options: ["知道", "误信", "怀疑", "不知道", "忘了"]},
                {id: "以为", label: "他以为的", kind: "text"},
                {id: "怎么知道", label: "怎么知道", kind: "enum", options: ["亲历", "听说", "推断", "读到", "传闻", "本人"]},
                // 缺“条目引用”字段：谁告诉的只能存条目 id 的文字。
                {id: "谁告诉的", label: "谁告诉的", kind: "text"},
            ],
        },
    ],
};

// ---------- 世界 ----------

const CHAPTERS: Record<string, string> = {
    ch1: "星瑕回到家。星瑾冷冷地说：你走的那几年，一个电话都没有。",
    ch3: "国王压低声音对贤者说：勇者的额头上有一枚星印，这件事不能让任何人知道。",
    ch4: "勇者戴着兜帽走到城门口，卫兵拦住了他。",
    ch5: "药师接过那株草，说：这是月见草，能止血。铁匠在一旁挠头。",
    ch6: "女仆对星瑾说：听说你哥哥那几年是被关起来了。",
    ch12: "侦探在书房的地毯下捡到一枚袖扣，和管家常戴的那对一模一样。",
    ch18: "侦探放下茶杯：我知道是谁了。",
    ch20: "（细纲）揭晓：管家就是凶手。",
};
const order = new ChapterOrder(Object.keys(CHAPTERS));
const options = {order, registry: buildRegistry([POINT, MIND]), reductions: () => undefined, chapterText: (id: string) => CHAPTERS[id], digest: (text: string) => createHash("sha256").update(text).digest("hex")};
const author = {kind: "author"} as const;
const end = (chapter: string): ReadPosition => ({kind: "chapter", chapter, edge: "end"});

const person = (tmp: string, name: string, rows: Record<string, unknown>[] = []): Entry => ({
    id: tmp, type: "人物", parent: null, folder: "", order: 0,
    init: {name, aliases: [], summary: "", text: [], data: {know: {type: MIND.id, version: 1, enabled: true, fields: {知情: rows}}}},
});
const thing = (tmp: string, name: string, type: string): Entry => ({id: tmp, type, parent: null, folder: "", order: 0, init: {name, aliases: [], summary: "", text: [], data: {}}});
const point = (tmp: string, about: string, claim: string, level: string, rule: string): Entry => ({
    id: tmp, type: "知识点", parent: about, folder: "", order: 0,
    init: {name: claim, aliases: [], summary: claim, text: [], data: {point: {type: POINT.id, version: 1, enabled: true, fields: {程度: level, 规则: rule}}}},
});

let world = World.empty(options);
let requests = 0;
let ids: Record<string, string> = {};
const publish = (what: WriteRequest["what"], title: string, puts: WriteRequest["puts"], chapter?: string) => {
    const result = world.publish({requestId: `r${++requests}`, by: author, what, title, baseVersion: world.data.version, puts, ...(chapter === undefined ? {} : {chapter})} as WriteRequest, "2026-11-04T00:00:00Z");
    if (!result.ok) throw new Error(`${title}：${JSON.stringify(result.failure)}`);
    world = result.world;
    ids = {...ids, ...result.ids};
    return result;
};
const id = (tmp: string) => ids[tmp] ?? tmp;

// 开局：人物、物品与知识点。星瑕在初值里就写了一行“本人知道被软禁”，元素 id 用的是同一次写入里的临时 id。
publish("opening", "开局", [
    ...[["tmp:hero", "勇者"], ["tmp:king", "国王"], ["tmp:sage", "贤者"], ["tmp:guard", "卫兵"], ["tmp:healer", "药师"], ["tmp:smith", "铁匠"], ["tmp:xia", "星瑕"], ["tmp:jin", "星瑾"], ["tmp:butler", "管家"], ["tmp:maid", "女仆"], ["tmp:detective", "侦探"]].map(([tmp, name]) => ({ref: {kind: "entry" as const, id: tmp!}, after: tmp === "tmp:xia" ? person(tmp!, name!, [{id: "tmp:confined", label: "哥哥那几年是被软禁", 程度: "知道", 怎么知道: "本人"}]) : person(tmp!, name!)})),
    {ref: {kind: "entry", id: "tmp:herb"}, after: thing("tmp:herb", "月见草", "物品")},
    {ref: {kind: "entry", id: "tmp:star"}, after: point("tmp:star", "tmp:hero", "勇者的额头有星印", "保密", "只有国王与贤者知道")},
    {ref: {kind: "entry", id: "tmp:heal"}, after: point("tmp:heal", "tmp:herb", "月见草能止血", "行内", "药师、草药商认识，普通人不认识")},
    {ref: {kind: "entry", id: "tmp:confined"}, after: point("tmp:confined", "tmp:xia", "哥哥那几年是被软禁", "保密", "只有星瑕自己知道")},
    {ref: {kind: "entry", id: "tmp:murder"}, after: point("tmp:murder", "tmp:butler", "管家是凶手", "绝密", "")},
]);

const listAdd = (who: string, pointTmp: string, fields: Record<string, unknown>): Patch => ({op: "listAdd", at: {entry: id(who), path: "know.知情"}, value: {id: id(pointTmp), label: world.data.entries.get(id(pointTmp))!.init.name, ...fields}});
let changes = 0;
type Reveal = {readonly point: string; readonly level: "plain" | "hint"};
const change = (kind: "written" | "plan", at: StoryChange["at"], text: string, patches: Patch[], told: Array<{chapter: string; quote: string; reveals?: Reveal[]}>, involves: string[]): StoryChange => ({
    id: `tmp:c${++changes}`, kind, text, at,
    // 讲述上的揭示标记 `reveals`：讲述的 schema 不限多出来的键，内核原样存下，但不校验、也不当作引用（见“缺口”）。
    told: told.map(({chapter, quote, reveals}) => ({source: chapter === "ch20" ? "outline" as const : "chapter" as const, chapter, quote, ...(reveals === undefined ? {} : {reveals})})),
    involves: involves.map(id), lines: [], links: [], patches, status: "active", by: author,
});
const write = (kind: "written" | "plan", chapter: string | null, text: string, patches: Patch[], told: Array<{chapter: string; quote: string; reveals?: Reveal[]}>, involves: string[], what: WriteRequest["what"] = kind === "plan" ? "plan" : "bookkeeping") => {
    const draft = change(kind, chapter === null ? {kind: "prehistory", order: changes} : {kind: "chapter", chapter, key: 10}, text, patches, told.map((item) => ({...item, reveals: item.reveals?.map((reveal) => ({...reveal, point: id(reveal.point)}))})), involves);
    const result = publish(what, text, [{ref: {kind: "change", id: draft.id}, after: draft}], chapter ?? undefined);
    return result.ids[draft.id]!;
};
/** 从内核存下的剧情变更里取讲述上的揭示标记。 */
const revealsOf = () => [...world.data.changes.values()].flatMap((item) => item.status === "undone" ? [] : item.told.flatMap((telling) => ((telling as {reveals?: Reveal[]}).reveals ?? []).map((reveal) => ({...reveal, chapter: telling.chapter!, plan: item.kind === "plan"}))));

// 前史：管家杀了人，女仆看见背影；星瑾以为哥哥不想回家。
write("written", null, "管家杀了老爷，女仆看见一个背影", [listAdd("tmp:butler", "tmp:murder", {程度: "知道", 怎么知道: "亲历"}), listAdd("tmp:maid", "tmp:murder", {程度: "误信", 以为: "凶手是园丁", 怎么知道: "亲历"})], [], ["tmp:butler", "tmp:maid"]);
write("written", null, "哥哥走后音讯全无", [listAdd("tmp:jin", "tmp:confined", {程度: "误信", 以为: "哥哥不想回家", 怎么知道: "推断"})], [], ["tmp:jin"]);
// 第 3 章：国王告诉贤者星印；这处讲述向读者明说。
write("written", "ch3", "国王与贤者谈勇者的星印", [listAdd("tmp:king", "tmp:star", {程度: "知道", 怎么知道: "本人"}), listAdd("tmp:sage", "tmp:star", {程度: "知道", 怎么知道: "听说", 谁告诉的: id("tmp:king")})], [{chapter: "ch3", quote: "勇者的额头上有一枚星印", reveals: [{point: "tmp:star", level: "plain"}]}], ["tmp:king", "tmp:sage", "tmp:hero"]);
// 第 4 章的计划：勇者进城，卫兵盘查（先记后写）。
write("plan", "ch4", "勇者进城，卫兵盘查", [], [], ["tmp:hero", "tmp:guard"]);
// 第 6 章：女仆告诉星瑾“被关起来了”——女仆自己并不知道这件事（传话链断）。
write("written", "ch6", "女仆告诉星瑾哥哥被关过", [{op: "set", at: {entry: id("tmp:jin"), path: `know.知情[${id("tmp:confined")}].程度`}, value: "怀疑"}, {op: "set", at: {entry: id("tmp:jin"), path: `know.知情[${id("tmp:confined")}].谁告诉的`}, value: id("tmp:maid")}], [{chapter: "ch6", quote: "听说你哥哥那几年是被关起来了"}], ["tmp:maid", "tmp:jin"]);
// 第 12 章：袖扣，向读者暗示；第 18 章：侦探推理出来，但没向读者说破。
write("written", "ch12", "侦探捡到管家的袖扣", [], [{chapter: "ch12", quote: "和管家常戴的那对一模一样", reveals: [{point: "tmp:murder", level: "hint"}]}], ["tmp:detective", "tmp:butler"]);
write("written", "ch18", "侦探推理出凶手", [listAdd("tmp:detective", "tmp:murder", {程度: "知道", 怎么知道: "推断"})], [{chapter: "ch18", quote: "我知道是谁了"}], ["tmp:detective"]);
// 第 20 章的揭示计划。
write("plan", "ch20", "揭晓凶手", [], [{chapter: "ch20", quote: "揭晓：管家就是凶手", reveals: [{point: "tmp:murder", level: "plain"}]}], ["tmp:butler", "tmp:detective"]);

// ---------- 从内核读，原型算 ----------

type Row = {id: string; label: string; 程度: string; 以为?: string; 怎么知道?: string; 谁告诉的?: string};
const rows = (who: string, position: ReadPosition, mode: "actual" | "planned" = "actual"): Row[] => {
    const view = world.engine.entry(who, position, mode);
    if (view === null || view === "chapter-not-found") return [];
    return (view.namespaces.know?.fields.知情?.value as Row[] | null | undefined) ?? [];
};
const name = (entry: string) => world.data.entries.get(entry)?.init.name ?? entry;
const points = () => [...world.data.entries.values()].filter((entry) => entry.type === "知识点");
const levelOf = (entry: string) => world.engine.entry(entry, {kind: "initial"}, "actual");
const pointLevel = (entry: string) => {
    const view = levelOf(entry);
    return view === null || view === "chapter-not-found" ? "" : String(view.namespaces.point?.fields.程度?.value ?? "");
};
const pointRule = (entry: string) => {
    const view = levelOf(entry);
    return view === null || view === "chapter-not-found" ? "" : String(view.namespaces.point?.fields.规则?.value ?? "");
};
const chapterIndex = (chapter: string) => order.ids.indexOf(chapter);

/** 读者：已写的讲述上的揭示标记，章不晚于读取位置；明说算知道，只有暗示算怀疑。 */
const reader = (pointId: string, chapter: string): "知道" | "怀疑" | "不知道" => {
    let best: "知道" | "怀疑" | "不知道" = "不知道";
    for (const reveal of revealsOf()) {
        if (reveal.plan || reveal.point !== pointId || chapterIndex(reveal.chapter) > chapterIndex(chapter)) continue;
        best = reveal.level === "plain" ? "知道" : best === "知道" ? best : "怀疑";
    }
    return best;
};

/** 给写手的简报：本章涉及的条目（含在场的人）有关的知识点，对每个在场的人说他知道什么。 */
const briefing = (chapter: string, present: string[]): string[] => {
    const position: ReadPosition = {kind: "chapter", chapter, edge: "start"};
    const involved = new Set(present.map(id));
    for (const item of world.data.changes.values()) if (item.at.kind === "chapter" && item.at.chapter === chapter) for (const entry of item.involves) involved.add(entry);
    const out: string[] = [];
    for (const item of points()) {
        if (item.parent === null || !involved.has(item.parent)) continue;
        const level = pointLevel(item.id);
        if (level === "常识") continue;
        if (level === "行内") {
            out.push(`行内：“${item.init.name}”——${pointRule(item.id)}（按这条推，推出来的会被记成“推断”）`);
            continue;
        }
        const content = level === "绝密" ? `一件涉及${name(item.parent)}的绝密设定` : `“${item.init.name}”`;
        const states = present.map((who) => {
            const row = rows(id(who), position).find((candidate) => candidate.id === item.id);
            if (row === undefined) return `${name(id(who))}：不知道`;
            // 误信时他以为的那句本身不是秘密，绝密的也照给。
            return `${name(id(who))}：${row.程度}${row.以为 === undefined ? "" : `（以为${row.以为}）`}`;
        });
        out.push(`${level}：${content}${level === "保密" ? `（${pointRule(item.id)}）` : ""}。${states.join("；")}。没列为知道的人一律当作不知道，不得写成知道`);
    }
    return out;
};

/** 写完查穿帮的候选：本章涉及的保密以上知识点 × 在场且不知道的人，各问一个窄问题。 */
const leakQuestions = (chapter: string, present: string[]): string[] => {
    const position: ReadPosition = {kind: "chapter", chapter, edge: "start"};
    const involved = new Set(present.map(id));
    return points().filter((item) => item.parent !== null && involved.has(item.parent) && ["保密", "绝密"].includes(pointLevel(item.id))).flatMap((item) =>
        present.filter((who) => !rows(id(who), position).some((row) => row.id === item.id && row.程度 === "知道")).map((who) => `${name(id(who))}在第 ${chapter.slice(2)} 章有没有按“${item.init.name}”说话或行动？有就引原句。`));
};

/** 传话链：谁告诉的，在那条变更的位置上自己必须已经知道。 */
const brokenChains = (): string[] => {
    const found: string[] = [];
    for (const item of world.data.changes.values()) {
        if (item.kind !== "written" || item.at.kind !== "chapter") continue;
        const position: ReadPosition = {kind: "chapter", chapter: item.at.chapter, edge: "start"};
        for (const patch of item.patches) {
            const told = patch.op === "listAdd" ? (patch.value as Row).谁告诉的 : patch.at.path.endsWith(".谁告诉的") ? String(patch.value) : undefined;
            if (told === undefined) continue;
            const pointId = patch.op === "listAdd" ? (patch.value as Row).id : /\[(.+?)\]/u.exec(patch.at.path)![1]!;
            // 告诉别人的人要在这之前知道，或者在同一条变更里自己就知道了（国王对贤者说出星印，两人的行在同一条里）。
            const sameChange = item.patches.some((other) => other.op === "listAdd" && other.at.entry === told && (other.value as Row).id === pointId && (other.value as Row).程度 === "知道");
            const knows = sameChange || rows(told, position).some((row) => row.id === pointId && row.程度 === "知道");
            if (!knows) found.push(`“${item.text}”：${name(patch.at.entry)}听${name(told)}说了“${name(pointId)}”，但${name(told)}在这之前并不知道`);
        }
    }
    return found;
};

/** 提前泄底：揭示计划之前，读者已经知道（或怀疑）。 */
const earlyReveals = (): string[] => {
    const found: string[] = [];
    for (const reveal of revealsOf()) {
        if (!reveal.plan) continue;
        const before = order.ids[chapterIndex(reveal.chapter) - 1]!;
        const known = reader(reveal.point, before);
        if (known !== "不知道") found.push(`计划第 ${reveal.chapter.slice(2)} 章向读者揭示“${name(reveal.point)}”，但读到第 ${before.slice(2)} 章时读者已经${known}`);
    }
    return found;
};

// ---------- 例子 ----------

title("1. 卫兵与勇者：第 4 章的简报（先记后写）");
for (const item of briefing("ch4", ["tmp:hero", "tmp:guard"])) line(`- ${item}`);
line("写完后的穿帮窄问题：");
for (const item of leakQuestions("ch4", ["tmp:hero", "tmp:guard"])) line(`- ${item}`);

title("2. 铁匠、药师与草药：第 5 章的简报");
for (const item of briefing("ch5", ["tmp:healer", "tmp:smith", "tmp:herb"])) line(`- ${item}`);

title("3. 星瑾的误信与传话");
line(`第 1 章，星瑾：${JSON.stringify(rows(id("tmp:jin"), end("ch1")).map(({label, 程度, 以为}) => ({label, 程度, 以为})))}`);
line(`第 6 章末，星瑾：${JSON.stringify(rows(id("tmp:jin"), end("ch6")).map(({label, 程度, 以为, 谁告诉的}) => ({label, 程度, 以为, 谁告诉的: 谁告诉的 === undefined ? undefined : name(谁告诉的)})))}`);
for (const item of briefing("ch1", ["tmp:xia", "tmp:jin"])) line(`- 第 1 章简报：${item}`);
line(`传话链：${brokenChains().join("；") || "没有断"}`);

title("4. 命案：读者、侦探与提前泄底");
for (const chapter of ["ch11", "ch12", "ch18"].filter((chapter) => chapter in CHAPTERS || chapter === "ch11")) {
    if (!(chapter in CHAPTERS)) continue;
    const detective = rows(id("tmp:detective"), end(chapter)).find((row) => row.id === id("tmp:murder"))?.程度 ?? "不知道";
    line(`读到第 ${chapter.slice(2)} 章末：读者对“管家是凶手”${reader(id("tmp:murder"), chapter)}；侦探${detective}`);
}
for (const item of briefing("ch18", ["tmp:detective", "tmp:maid", "tmp:butler"])) line(`- 第 18 章简报：${item}`);
line(`提前泄底：${earlyReveals().join("；") || "没有"}`);

title("5. 反讽：第 3 章以后读者知道、角色不知道的");
for (const item of points()) {
    if (!["保密", "绝密"].includes(pointLevel(item.id)) || reader(item.id, "ch4") !== "知道") continue;
    // 只看和知识点所说的条目同场过的人物。
    const met = new Set<string>();
    for (const other of world.data.changes.values()) if (other.involves.includes(item.parent!)) for (const entry of other.involves) met.add(entry);
    const unaware = [...met].filter((entry) => world.data.entries.get(entry)?.type === "人物" && !rows(entry, end("ch4")).some((row) => row.id === item.id && row.程度 === "知道")).map(name);
    line(`- “${item.init.name}”：读者知道；同场过而不知道的人物：${unaware.join("、")}`);
}

title("6. 内核的缺口（实测）");
{
    const xia = rows(id("tmp:xia"), {kind: "initial"});
    line(`- 初值里的元素 id 用了同一次写入的临时 id：存下来是 ${JSON.stringify(xia.map((row) => row.id))}，知识点的真实 id 是 ${id("tmp:confined")}${xia[0]?.id === id("tmp:confined") ? "（换掉了）" : "（没换，引用断了）"}`);
    const duplicate = change("written", {kind: "chapter", chapter: "ch5", key: 20}, "国王又知道了一次", [listAdd("tmp:king", "tmp:star", {程度: "知道", 怎么知道: "本人"})], [], ["tmp:king"]);
    const again = world.publish({requestId: "dup", by: author, what: "bookkeeping", title: "再记一次", baseVersion: world.data.version, chapter: "ch5", puts: [{ref: {kind: "change", id: duplicate.id}, after: duplicate}]} as WriteRequest, "t");
    const outcome = again.ok ? again.world.engine.outcome(again.ids[duplicate.id]!) : again.failure;
    line(`- 同一个人对同一个知识点再加一行：${again.ok ? `写入成功，这条变更${JSON.stringify(outcome)}` : `写入被拒：${JSON.stringify(outcome)}`}`);
    const named = change("written", {kind: "chapter", chapter: "ch5", key: 30}, "药师说出药名", [], [], ["tmp:healer"]);
    const withReveal = world.publish({requestId: "reveal", by: author, what: "bookkeeping", title: "带揭示标记", baseVersion: world.data.version, chapter: "ch5", puts: [{ref: {kind: "change", id: named.id}, after: {...named, told: [{source: "chapter", chapter: "ch5", quote: "这是月见草，能止血", reveals: [{point: id("tmp:heal"), level: "plain"}]}]}}]} as WriteRequest, "t");
    const bogus = change("written", {kind: "chapter", chapter: "ch5", key: 40}, "揭示一个不存在的知识点", [], [], ["tmp:healer"]);
    const withBogus = world.publish({requestId: "bogus", by: author, what: "bookkeeping", title: "揭示标记指向不存在的条目", baseVersion: world.data.version, chapter: "ch5", puts: [{ref: {kind: "change", id: bogus.id}, after: {...bogus, told: [{source: "chapter", chapter: "ch5", quote: "铁匠在一旁挠头", reveals: [{point: "e999", level: "plain"}]}]}}]} as WriteRequest, "t");
    const stored = withReveal.ok ? (withReveal.world.data.changes.get(withReveal.ids[named.id]!)!.told[0] as {reveals?: unknown}).reveals : undefined;
    line(`- 讲述上带揭示标记：${withReveal.ok ? `写入成功，原样存下 ${JSON.stringify(stored)}` : `写入被拒：${JSON.stringify(withReveal.failure).slice(0, 200)}`}；指向不存在的条目 e999 的也${withBogus.ok ? "写入成功（不校验）" : "被拒"}`);
    // 单独建一个知识点，再给人加一行引用它；还原建它的那次修订，看依赖查不查得到。
    const created = publish("edit", "建知识点：王都有暗道", [{ref: {kind: "entry", id: "tmp:tunnel"}, after: point("tmp:tunnel", id("tmp:king"), "王都有暗道", "保密", "只有国王知道")}]);
    write("written", "ch5", "国王想起暗道", [listAdd("tmp:king", "tmp:tunnel", {程度: "知道", 怎么知道: "本人"})], [], ["tmp:king"]);
    const reverted = world.revert(created.revision.id, false, {requestId: "rv", by: author}, "t");
    line(`- 还原“建知识点”那次修订（知情行用元素 id 引用它）：${reverted.ok ? "直接还原成功，没有列出依赖：国王那一行指向了一个被撤掉的知识点" : `被拒：${JSON.stringify(reverted.failure).slice(0, 160)}`}`);
}
