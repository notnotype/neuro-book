/**
 * w00039 t32：把 nb-story 的 V9 数据（样例书 100 章）逐条转进真实的 nb-canon 内核（分支 feat/w00039-t29-canon-kernel 的
 * worktree），数一数装得下多少、装不下什么（剧情侧提案第 13 节“第一份证据”）。一次性原型，零模型费用。
 *
 * 运行：在本目录 bun convert.ts [输出报告路径]。
 *
 * 映射（按剧情侧提案的设计；内核还没实现的部分用现有机制近似，报告里标出）：
 * - 章节 → 活页夹的章；正文 → 章的正文（讲述的原句要在里面）。
 * - 对象 → 条目；马甲（persona）按 identity 类的世界事实找本体，设 sameAs；出场位置 → appears。
 * - 情节 → 已写的剧情变更：描述、安放（章加段号当排序键）、讲述（证据的第一段原文）、涉及（在场者）。
 * - 账本 → 剧情变更上的补丁：数量类记到“账本”Component 的数值实例字段（初值未知），文字类记到文字字段，道具记到列表。
 * - 秘密 → 知识点条目（保密）；关于秘密的知情 → 人物上的知情行（元素 id 是知识点）。
 * - 悬念 → 伏笔条目（种类“悬念”）；提出、部分回答、回答 → 讲述上的节点标记（埋下、部分回收、回收），挂在没有补丁的剧情变更上。
 * - 说法、时间点、整理稿、主线、段落节拍、称呼位置：数一数，不装（理由见报告）。
 */

import {createHash} from "node:crypto";
import {readFile, writeFile} from "node:fs/promises";
import {gunzipSync} from "node:zlib";

import {buildRegistry, ChapterOrder, generateFieldId, World} from "../../../../../../../.worktree/w00039-t29-canon-kernel/packages/nb-canon/src/index";
import type {ComponentDeclaration, Entry, FieldDeclaration, Patch, StoryChange, WriteRequest} from "../../../../../../../.worktree/w00039-t29-canon-kernel/packages/nb-canon/src/index";

type V9 = {
    sources: Array<{chapter: number; title: string; paragraphs: string[]}>;
    entities: Array<{id: string; kind: string; label: string; note?: string; at: {chapter: number; paragraph: number}; names: Array<{text: string}>}>;
    statements: Array<{id: string; text: string; family: string; about: string[]; kind: string; holder: string | null; source: {channel: string}}>;
    secrets: Array<{id: string; title: string; about: string[]; statements: string[]; at: {chapter: number; paragraph: number}}>;
    episodes: Array<{id: string; title: string; summary: string; evidence: Array<{chapter: number; from: number; to: number}>; who: Array<{e: string; as?: string; role?: string}>; steps: unknown[]; links: Array<{type: string}>; at: {chapter: number; paragraph: number}; time?: string; place?: string}>;
    knowledge: Array<{id: string; who: string; about: string; state: string; how?: string; evidence: Array<{chapter: number; from: number}>; at: {chapter: number; paragraph: number}; derived: boolean}>;
    ledger: Array<{id: string; owner: string; track: string; op: string; amount?: number; value?: number | string | null; item?: string | null; reason: string; evidence: Array<{chapter: number; from: number}>; basis: string; at: {chapter: number; paragraph: number}; check: string | null}>;
    questions: Array<{id: string; text: string; evidence: Array<{chapter: number; from: number}>; about: string[]; at: {chapter: number; paragraph: number}; updates: Array<{type: string; evidence: Array<{chapter: number; from: number}>; at: {chapter: number; paragraph: number}}>}>;
    times: Array<{day?: number; rel: unknown[]}>;
    beats: unknown[];
    mentions: unknown[];
    summaries: unknown[];
    arcs: unknown[];
};

const outputPath = process.argv[2];
const started = performance.now();
const data = JSON.parse(gunzipSync(await readFile(new URL("../../../../../../../packages/nb-story/tests/fixtures/sample-100ch.json.gz", import.meta.url))).toString("utf8")) as V9;

// ---------- 章与正文 ----------

const chapterId = (chapter: number) => `ch${chapter}`;
const texts = new Map(data.sources.map((source) => [chapterId(source.chapter), source.paragraphs.join("\n")]));
const paragraph = (chapter: number, index: number): string | undefined => {
    const list = data.sources.find((source) => source.chapter === chapter)?.paragraphs ?? [];
    return [list[index], list[index - 1]].find((text) => text !== undefined && text.trim() !== "");
};
const order = new ChapterOrder(data.sources.map((source) => chapterId(source.chapter)));

// ---------- Component ----------

const LEDGER: ComponentDeclaration = {id: "story.ledger", label: "账本", namespace: "ledger", version: 1, instanceFields: true, fields: []};
const POINT: ComponentDeclaration = {id: "know.point", label: "知识点", namespace: "point", version: 1, fields: [{id: "程度", label: "保密程度", kind: "enum", options: ["常识", "行内", "保密", "绝密"]}]};
const MIND: ComponentDeclaration = {
    id: "know.mind", label: "知情", namespace: "know", version: 1,
    fields: [{id: "知情", label: "知道的事", kind: "list", item: [
        {id: "程度", label: "程度", kind: "enum", options: ["知道", "误信", "怀疑", "不知道", "忘了"]},
        {id: "怎么知道", label: "怎么知道", kind: "text"},
    ]}],
};
const FORESHADOW: ComponentDeclaration = {id: "plot.foreshadow", label: "伏笔", namespace: "fs", version: 1, fields: [{id: "种类", label: "种类", kind: "enum", options: ["埋设回收", "悬念", "预言", "意象"]}]};

let world = World.empty({order, registry: buildRegistry([LEDGER, POINT, MIND, FORESHADOW]), reductions: () => undefined, chapterText: (id) => texts.get(id), digest: (text) => createHash("sha256").update(text).digest("hex")});
const author = {kind: "author"} as const;
let requests = 0;
let ids: Record<string, string> = {};
const failures = new Map<string, number>();
const failureExamples = new Map<string, string>();
const tryPublish = (what: WriteRequest["what"], title: string, puts: WriteRequest["puts"], kind: string, chapter?: string): boolean => {
    const result = world.publish({requestId: `r${++requests}`, by: author, what, title, baseVersion: world.data.version, puts, ...(chapter === undefined ? {} : {chapter})} as WriteRequest, "2026-11-04T00:00:00Z");
    if (result.ok) {
        world = result.world;
        ids = {...ids, ...result.ids};
        return true;
    }
    const failure = result.failure as {code: string; problems?: Array<{code: string}>};
    const code = `${kind}：${failure.code}${failure.problems?.[0] === undefined ? "" : `/${failure.problems[0].code}`}`;
    failures.set(code, (failures.get(code) ?? 0) + 1);
    if (!failureExamples.has(code)) failureExamples.set(code, `${title}：${JSON.stringify(result.failure).slice(0, 200)}`);
    return false;
};
const ref = (v9: string) => ids[`tmp:${v9}`] ?? `tmp:${v9}`;

// ---------- 开局：对象、知识点、伏笔 ----------

const KIND: Record<string, string> = {person: "人物", persona: "人物", group: "组织", place: "地点", item: "物品", concept: "概念", task: "任务", other: "其他"};
const entityIds = new Set(data.entities.map((entity) => entity.id));
// 马甲的本体：identity 类、世界事实、about 里一个是马甲一个是人物。
const kindOf = new Map(data.entities.map((entity) => [entity.id, entity.kind]));
const sameAs = new Map<string, string>();
for (const statement of data.statements) {
    if (statement.family !== "identity" || statement.kind !== "fact") continue;
    const persona = statement.about.find((id) => kindOf.get(id) === "persona");
    const body = statement.about.find((id) => kindOf.get(id) === "person");
    if (persona !== undefined && body !== undefined && !sameAs.has(persona)) sameAs.set(persona, body);
}

// 账本的实例字段：每个持有者每条“轨道”一个字段。
type Track = {field: FieldDeclaration; owner: string};
const tracks = new Map<string, Track>();
const taken = new Map<string, Set<string>>();
for (const entry of data.ledger) {
    const key = `${entry.owner}|${entry.track}`;
    if (tracks.has(key)) continue;
    const names = taken.get(entry.owner) ?? new Set<string>();
    taken.set(entry.owner, names);
    const id = generateFieldId(entry.track, names);
    names.add(id);
    const numeric = data.ledger.some((other) => other.owner === entry.owner && other.track === entry.track && (["gain", "spend"].includes(other.op) || typeof other.value === "number"));
    const items = data.ledger.some((other) => other.owner === entry.owner && other.track === entry.track && ["get", "use", "lose"].includes(other.op));
    const field: FieldDeclaration = items ? {id, label: entry.track, kind: "list"} : numeric ? {id, label: entry.track, kind: "number"} : {id, label: entry.track, kind: "text"};
    tracks.set(key, {field, owner: entry.owner});
}

const appearsOf = (at: {chapter: number; paragraph: number}) => ({kind: "chapter" as const, chapter: chapterId(at.chapter), key: at.paragraph});
const entries: WriteRequest["puts"] = [];
for (const entity of data.entities) {
    const declared = [...tracks.values()].filter((track) => track.owner === entity.id).map((track) => track.field);
    const isPerson = ["person", "persona", "group"].includes(entity.kind);
    const dataField: Entry["init"]["data"] = {};
    if (declared.length > 0) dataField.ledger = {type: LEDGER.id, version: 1, enabled: true, fields: Object.fromEntries(declared.map((field) => [field.id, field.kind === "list" ? [] : null])), declared};
    if (isPerson) dataField.know = {type: MIND.id, version: 1, enabled: true, fields: {知情: []}};
    const after: Entry = {
        id: `tmp:${entity.id}`, type: KIND[entity.kind] ?? "其他", parent: null, folder: KIND[entity.kind] ?? "其他", order: 0,
        ...(sameAs.has(entity.id) ? {sameAs: `tmp:${sameAs.get(entity.id)}`} : {}),
        appears: appearsOf(entity.at),
        init: {name: entity.label, aliases: [...new Set(entity.names.map((name) => name.text).filter((text) => text !== entity.label))], summary: entity.note ?? "", text: [], data: dataField},
    };
    entries.push({ref: {kind: "entry", id: after.id}, after});
}
for (const secret of data.secrets) {
    const after: Entry = {id: `tmp:${secret.id}`, type: "知识点", parent: secret.about[0] !== undefined && entityIds.has(secret.about[0]) ? `tmp:${secret.about[0]}` : null, folder: "知识点", order: 0, appears: appearsOf(secret.at), init: {name: secret.title, aliases: [], summary: secret.title, text: [], data: {point: {type: POINT.id, version: 1, enabled: true, fields: {程度: "保密"}}}}};
    entries.push({ref: {kind: "entry", id: after.id}, after});
}
for (const question of data.questions) {
    const after: Entry = {id: `tmp:${question.id}`, type: "伏笔", parent: null, folder: "伏笔", order: 0, init: {name: question.text, aliases: [], summary: question.text, text: [], data: {fs: {type: FORESHADOW.id, version: 1, enabled: true, fields: {种类: "悬念"}}}}};
    entries.push({ref: {kind: "entry", id: after.id}, after});
}
const opened = tryPublish("opening", "开局", entries, "开局");

// ---------- 按章写进剧情变更 ----------

type Item = {chapter: number; key: number; kind: string; build: () => StoryChange | null};
const items: Item[] = [];
let tmp = 0;
const telling = (chapter: number, index: number, marks?: unknown[]) => {
    const quote = paragraph(chapter, index);
    return quote === undefined ? [] : [{source: "chapter" as const, chapter: chapterId(chapter), quote, ...(marks === undefined ? {} : {marks})}];
};
const change = (at: {chapter: number; paragraph: number}, text: string, told: StoryChange["told"], involves: string[], patches: Patch[]): StoryChange => ({
    id: `tmp:c${++tmp}`, kind: "written", text, at: appearsOf(at), told, involves: involves.filter((id) => entityIds.has(id)).map(ref), lines: [], links: [], patches, status: "active", by: author,
});

let episodeRoles = 0;
let episodeLinks = 0;
let episodeSteps = 0;
for (const episode of data.episodes) {
    episodeRoles += episode.who.filter((who) => who.as !== undefined || who.role !== undefined).length;
    episodeLinks += episode.links.length;
    episodeSteps += episode.steps.length;
    const first = episode.evidence[0];
    items.push({chapter: episode.at.chapter, key: episode.at.paragraph, kind: "情节", build: () => change(episode.at, `${episode.title}：${episode.summary}`, first === undefined ? [] : telling(first.chapter, first.from), episode.who.map((who) => who.e), [])});
}

const ledgerPatch = (entry: V9["ledger"][number]): Patch | null => {
    const track = tracks.get(`${entry.owner}|${entry.track}`)!;
    const at = {entry: ref(entry.owner), path: `ledger.${track.field.id}`};
    switch (entry.op) {
        case "gain": return {op: "add", at, value: entry.amount ?? 0};
        case "spend": return {op: "add", at, value: -(entry.amount ?? 0)};
        case "set": return track.field.kind === "number" && typeof entry.value !== "number" ? null : {op: "set", at, value: entry.value ?? null};
        case "get": return entry.item === null || entry.item === undefined ? null : {op: "listAdd", at, value: {id: ref(entry.item), label: data.entities.find((entity) => entity.id === entry.item)?.label ?? entry.item}};
        case "use":
        case "lose": return entry.item === null || entry.item === undefined ? null : {op: "listRemove", at, value: ref(entry.item)};
        default: return null;
    }
};
for (const entry of data.ledger) {
    const first = entry.evidence[0];
    items.push({chapter: entry.at.chapter, key: entry.at.paragraph, kind: `账本（${entry.op}）`, build: () => {
        const patch = ledgerPatch(entry);
        return patch === null ? null : change(entry.at, entry.reason, first === undefined ? [] : telling(first.chapter, first.from), [entry.owner], [patch]);
    }});
}

// 关于秘密的知情：同一个人对同一个秘密只建一行，之后改程度。
const secretOf = new Map<string, string>();
for (const secret of data.secrets) for (const statement of secret.statements) secretOf.set(statement, secret.id);
const DEGREE: Record<string, string> = {knows: "知道", heard: "知道", read: "知道", believes: "知道", suspects: "怀疑", unaware: "不知道"};
const rowsMade = new Set<string>();
let knowledgeAboutSecrets = 0;
for (const row of data.knowledge) {
    const secret = secretOf.get(row.about) ?? (data.secrets.some((item) => item.id === row.about) ? row.about : undefined);
    if (secret === undefined || !entityIds.has(row.who) || !["person", "persona", "group"].includes(kindOf.get(row.who) ?? "")) continue;
    knowledgeAboutSecrets += 1;
    const first = row.evidence[0];
    items.push({chapter: row.at.chapter, key: row.at.paragraph, kind: "知情", build: () => {
        const key = `${row.who}|${secret}`;
        const at = {entry: ref(row.who), path: "know.知情"};
        const patch: Patch = rowsMade.has(key)
            ? {op: "set", at: {entry: ref(row.who), path: `know.知情[${ref(secret)}].程度`}, value: DEGREE[row.state] ?? "知道"}
            : {op: "listAdd", at, value: {id: ref(secret), label: data.secrets.find((item) => item.id === secret)!.title, 程度: DEGREE[row.state] ?? "知道", 怎么知道: row.how ?? ""}};
        rowsMade.add(key);
        return change(row.at, `${data.entities.find((entity) => entity.id === row.who)?.label}对“${data.secrets.find((item) => item.id === secret)!.title}”：${row.state}`, first === undefined ? [] : telling(first.chapter, first.from), [row.who], [patch]);
    }});
}

// 悬念的进展：讲述上的节点标记，挂在没有补丁的剧情变更上。
const ROLE: Record<string, string> = {raised: "埋下", partial: "部分回收", answered: "回收"};
for (const question of data.questions) {
    const first = question.evidence[0];
    items.push({chapter: question.at.chapter, key: question.at.paragraph, kind: "伏笔节点（埋下）", build: () => change(question.at, `提出疑问：${question.text}`, first === undefined ? [] : telling(first.chapter, first.from, [{kind: "beat", foreshadow: ref(question.id), role: "埋下"}]), question.about, [])});
    for (const update of question.updates) {
        const evidence = update.evidence[0];
        items.push({chapter: update.at.chapter, key: update.at.paragraph, kind: `伏笔节点（${ROLE[update.type]}）`, build: () => change(update.at, `${ROLE[update.type]}：${question.text}`, evidence === undefined ? [] : telling(evidence.chapter, evidence.from, [{kind: "beat", foreshadow: ref(question.id), role: ROLE[update.type]}]), question.about, [])});
    }
}

items.sort((a, b) => a.chapter - b.chapter || a.key - b.key);
const written = new Map<string, number>();
const skipped = new Map<string, number>();
for (const item of items) {
    const built = item.build();
    const kind = item.kind;
    if (built === null) {
        skipped.set(kind, (skipped.get(kind) ?? 0) + 1);
        continue;
    }
    if (built.told.length === 0) {
        skipped.set(`${kind}（找不到原句）`, (skipped.get(`${kind}（找不到原句）`) ?? 0) + 1);
        continue;
    }
    if (tryPublish("bookkeeping", built.text.slice(0, 40), [{ref: {kind: "change", id: built.id}, after: built}], kind, built.at.kind === "chapter" ? built.at.chapter : undefined)) written.set(kind, (written.get(kind) ?? 0) + 1);
}
const elapsed = performance.now() - started;

// ---------- 读回来核对 ----------

const end = {kind: "chapter", chapter: "ch100", edge: "end"} as const;
const hero = world.engine.entry(ref("e1-1"), end, "actual");
const heroLedger = hero === null || hero === "chapter-not-found" ? {} : Object.fromEntries(Object.entries(hero.namespaces.ledger?.fields ?? {}).map(([key, value]) => [key, (value as {value: unknown; incomplete?: unknown}).incomplete === undefined ? value.value : `不完整（${JSON.stringify((value as {incomplete: unknown}).incomplete)}）`]));
const pending = world.engine.pending(end);
const pendingKinds = pending === "chapter-not-found" ? {} : pending.reduce<Record<string, number>>((counts, item) => ({...counts, [item.kind]: (counts[item.kind] ?? 0) + 1}), {});
const v9Running = data.ledger.filter((entry) => entry.owner === "e1-1" && entry.track === "神典石").at(-1);

// ---------- 报告 ----------

const count = <T,>(list: T[], key: (item: T) => string) => list.reduce<Record<string, number>>((counts, item) => ({...counts, [key(item)]: (counts[key(item)] ?? 0) + 1}), {});
const sum = (map: Map<string, number>, prefix: string) => [...map.entries()].filter(([key]) => key.startsWith(prefix)).reduce((total, [, value]) => total + value, 0);
const statementKinds = count(data.statements, (statement) => statement.kind);
const statementFamilies = count(data.statements.filter((statement) => statement.kind === "fact"), (statement) => statement.family);
const lines = [
    "nb-story 样例书（100 章）转进 nb-canon 的覆盖率 —— 2026-11-04",
    "",
    "脚本：t32 prototype/nbstory/convert.ts，直接用分支 feat/w00039-t29-canon-kernel 的 nb-canon（World.publish 逐条写入，每条一次修订）。零模型费用。",
    `用时 ${(elapsed / 1000).toFixed(1)} 秒；世界版本 ${world.data.version}；条目 ${world.data.entries.size} 个，剧情变更 ${world.data.changes.size} 条。开局${opened ? "写入成功" : "写入失败"}。`,
    "",
    "== 逐类 ==",
    `对象 ${data.entities.length} 个 → 条目 ${data.entities.length} 个（种类：${JSON.stringify(count(data.entities, (entity) => entity.kind))}）；马甲 ${data.entities.filter((entity) => entity.kind === "persona").length} 个，其中 ${sameAs.size} 个从 identity 类世界事实找到本体、设了 sameAs。`,
    `秘密 ${data.secrets.length} 个 → 知识点条目 ${data.secrets.length} 个（保密）。`,
    `悬念 ${data.questions.length} 个 → 伏笔条目（悬念）${data.questions.length} 个。`,
    `情节 ${data.episodes.length} 个 → 已写的剧情变更 ${written.get("情节") ?? 0} 条；丢掉的信息：在场者的化名与角色 ${episodeRoles} 处、步骤 ${episodeSteps} 条、情节之间的连接 ${episodeLinks} 条、时间点与地点（剧情变更上没有对应字段）。`,
    `账本 ${data.ledger.length} 条（${JSON.stringify(count(data.ledger, (entry) => entry.op))}）→ 写进 ${sum(written, "账本")} 条，转不成补丁 ${sum(skipped, "账本")} 条，被内核拒收 ${sum(failures, "账本")} 条。`,
    `知情 ${data.knowledge.length} 条（程序推出的 ${data.knowledge.filter((row) => row.derived).length} 条）：关于秘密的 ${knowledgeAboutSecrets} 条 → 人物上的知情行写进 ${written.get("知情") ?? 0} 条、被拒收 ${sum(failures, "知情")} 条；其余 ${data.knowledge.length - knowledgeAboutSecrets} 条关于普通说法，按提案不建知识点，装不下。`,
    `悬念的进展：埋下 ${written.get("伏笔节点（埋下）") ?? 0}、部分回收 ${written.get("伏笔节点（部分回收）") ?? 0}、回收 ${written.get("伏笔节点（回收）") ?? 0} 条写进（讲述上的节点标记，内核原样存下、不校验）。`,
    `说法 ${data.statements.length} 条（${JSON.stringify(statementKinds)}；渠道 ${JSON.stringify(count(data.statements, (statement) => statement.source.channel))}）：没有对应的对象，装不下。其中世界事实 ${statementKinds.fact ?? 0} 条按类分 ${JSON.stringify(statementFamilies)}：按设计应分别进条目的文字（特征、规则）、状态（所属、持有、位置）、sameAs（身份）或情节（事件），这次没有自动分。`,
    `时间点 ${data.times.length} 个（写了第几天的 ${data.times.filter((time) => time.day !== undefined).length} 个，相对关系 ${data.times.reduce((total, time) => total + time.rel.length, 0)} 条）：要剧情侧的时间说法与 nb-time，内核还没有，装不下。`,
    `段落节拍 ${data.beats.length}、称呼位置 ${data.mentions.length}、整理稿 ${data.summaries.length}、主线 ${data.arcs.length}：按提案不搬（读者端的派生物）。`,
    "",
    "== 被内核拒收或跳过的 ==",
    ...[...failures.entries()].map(([code, value]) => `- 拒收 ${code}：${value} 条；例：${failureExamples.get(code)}`),
    ...[...skipped.entries()].map(([kind, value]) => `- 跳过 ${kind}：${value} 条`),
    "",
    "== 读回来 ==",
    `苏天晴（e1-1）第 100 章末的账本：${JSON.stringify(heroLedger)}`,
    `V9 里神典石最后的累计：${v9Running?.running}（V9 从 0 起累加；nb-canon 的初值是未知，未知不能加减）。`,
    `第 100 章末的待处理：${JSON.stringify(pendingKinds)}`,
];
const report = lines.join("\n");
console.log(report);
if (outputPath !== undefined) await writeFile(outputPath, `${report}\n`);
