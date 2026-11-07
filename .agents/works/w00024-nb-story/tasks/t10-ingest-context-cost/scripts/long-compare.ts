/**
 * 长书评估的对比（t10 plan.md“验证”第 3 条）：改前、改后两遍抽的第 61 到 70 章，对照 t34 最终草稿同几章的引用。
 * - 应延续：t34 那几章草稿里引用的前 60 章记录（前 60 章的编号三份数据相同），分类统计两遍各命中多少，列出只有一遍命中的。
 * - 重复对象：第 61 到 70 章新建的对象里，称呼或标签与前 60 章已有对象相同的。
 * - 费用：用量记录按两种口径重算：无缓存（输入全按输入价）、首请求全价其余命中（每章第一次请求全价，其余按缓存价）。
 * 用法：bun long-compare.ts <nb-story 包目录> <改前运行目录> <改后运行目录>
 */
import {readFile} from "node:fs/promises";
import {join} from "node:path";
import {gunzipSync} from "node:zlib";

const [pkg, oldDir, newDir] = process.argv.slice(2);
if (!pkg || !oldDir || !newDir) throw new Error("用法：bun long-compare.ts <包目录> <改前目录> <改后目录>");
const {Library} = await import(join(pkg, "src/core/library.ts"));
const {readCommitted} = await import(join(pkg, "src/ingest/job.ts"));
const final = JSON.parse(gunzipSync(await readFile(join(pkg, "tests/fixtures/ingest/run-med-100-final.json.gz"))).toString("utf8"));
const LETTERS: Record<string, string> = {e: "对象", s: "说法", q: "疑问", x: "秘密", t: "时间点", p: "情节", k: "知情", l: "状态"};

/** 一章草稿里引用的前 60 章编号（去掉本章自己的）。 */
const oldRefs = (draft: unknown) => new Set([...JSON.stringify(draft).matchAll(/\b([a-z])(\d+)-(\d+)\b/g)].filter(m => Number(m[2]) <= 60).map(m => m[0]));

async function load(dir: string) {
    const {data} = await readCommitted(new Library(join(dir, "library")), "long");
    const drafts = data.drafts.slice(60) as {chapter: number; entities?: {id: string; label: string; names?: {text: string}[]}[]}[];
    const usage = (await readFile(join(dir, "library/.ingest/long/usage.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line)).filter(line => line.kind === "end");
    return {data, drafts, usage};
}
const runs = {old: await load(oldDir), new: await load(newDir)};

// 前 60 章已有的编号（以改前那一遍的已提交数据为准，两遍起点相同）。
const prefixIds = new Set(JSON.stringify(runs.old.data.drafts.slice(0, 60)).match(/\b[a-z]\d+-\d+\b/g));
const expected = new Map<string, Set<string>>();
for (let chapter = 61; chapter <= 70; chapter++) expected.set(String(chapter), new Set([...oldRefs(final.drafts[chapter - 1])].filter(id => prefixIds.has(id))));

const report: string[] = ["## 应延续（t34 最终草稿第 61 到 70 章引用的前 60 章记录）", "", "| 类别 | 应延续 | 改前命中 | 改后命中 |", "| --- | ---: | ---: | ---: |"];
const hits = {old: new Map<string, Set<string>>(), new: new Map<string, Set<string>>()};
for (const name of ["old", "new"] as const) for (const draft of runs[name].drafts) hits[name].set(String(draft.chapter), oldRefs(draft));
const byLetter = new Map<string, {all: number; old: number; new: number}>();
const onlyOne: string[] = [];
for (const [chapter, ids] of expected) {
    for (const id of ids) {
        const row = byLetter.get(id[0]!) ?? {all: 0, old: 0, new: 0};
        row.all += 1;
        const inOld = hits.old.get(chapter)?.has(id) ?? false, inNew = hits.new.get(chapter)?.has(id) ?? false;
        if (inOld) row.old += 1;
        if (inNew) row.new += 1;
        if (inOld !== inNew) onlyOne.push(`第 ${chapter} 章 ${id}（${LETTERS[id[0]!]}）：只有${inOld ? "改前" : "改后"}命中`);
        byLetter.set(id[0]!, row);
    }
}
let total = {all: 0, old: 0, new: 0};
for (const [letter, row] of [...byLetter].sort()) {
    report.push(`| ${LETTERS[letter]} | ${row.all} | ${row.old} | ${row.new} |`);
    total = {all: total.all + row.all, old: total.old + row.old, new: total.new + row.new};
}
report.push(`| 合计 | ${total.all} | ${total.old} | ${total.new} |`, "", `改后 / 改前 = ${(total.new / total.old * 100).toFixed(1)}%`, "", "只有一遍命中的：", "", ...onlyOne.map(line => `- ${line}`), "");

// 引用前 60 章记录的总次数（不限于应延续清单），看两遍是否同样在用旧记录。
report.push("## 两遍各自引用前 60 章记录的次数", "");
for (const name of ["old", "new"] as const) {
    const counts = new Map<string, number>();
    for (const ids of hits[name].values()) for (const id of ids) if (prefixIds.has(id)) counts.set(id[0]!, (counts.get(id[0]!) ?? 0) + 1);
    report.push(`- ${name === "old" ? "改前" : "改后"}：${[...counts].sort().map(([letter, n]) => `${LETTERS[letter]} ${n}`).join("，")}`);
}

// 重复对象候选。
const prefixEntities = (runs.old.data.drafts.slice(0, 60) as {entities?: {id: string; label: string; names?: {text: string}[]}[]; names?: {entity: string; text: string}[]}[]).flatMap(draft => draft.entities ?? []);
const known = new Set(prefixEntities.flatMap(entity => [entity.label, ...(entity.names ?? []).map(name => name.text)]));
report.push("", "## 新建对象里称呼或标签与前 60 章已有对象相同的", "");
for (const name of ["old", "new"] as const) {
    const created = runs[name].drafts.flatMap(draft => draft.entities ?? []);
    const dup = created.filter(entity => known.has(entity.label) || (entity.names ?? []).some(item => known.has(item.text)));
    report.push(`- ${name === "old" ? "改前" : "改后"}：新建 ${created.length} 个，相同 ${dup.length} 个${dup.length ? `：${dup.map(entity => `${entity.id} ${entity.label}（${(entity.names ?? []).map(item => item.text).join("、")}）`).join("；")}` : ""}`);
}

// 费用。
report.push("", "## 费用（按 deepseek-flash 低谷价：输入 1、缓存 0.02、输出 4 元每百万 token）", "", "| | 请求数 | 输入 token | 其中实际命中缓存 | 输出 token | 实际记账 | 无缓存口径 | 首请求全价其余命中口径 |", "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
for (const name of ["old", "new"] as const) {
    const lines = runs[name].usage.filter((line: {chapter: number}) => line.chapter >= 61);
    const sum = (key: string) => lines.reduce((total: number, line: Record<string, number>) => total + (line[key] ?? 0), 0);
    const actual = lines.reduce((total: number, line: {input: number; cacheRead: number; output: number}) => total + ((line.input - line.cacheRead) * 1 + line.cacheRead * 0.02 + line.output * 4) / 1e6, 0);
    const uncached = (sum("input") + sum("output") * 4) / 1e6;
    const first = new Set<number>();
    let ideal = 0;
    for (const line of lines as {chapter: number; step: string; input: number; output: number}[]) {
        const full = line.step === "consolidation" || !first.has(line.chapter);
        if (line.step !== "consolidation") first.add(line.chapter);
        ideal += ((full ? line.input : line.input * 0.02) + line.output * 4) / 1e6;
    }
    report.push(`| ${name === "old" ? "改前" : "改后"} | ${lines.length} | ${sum("input")} | ${sum("cacheRead")} | ${sum("output")} | ${actual.toFixed(3)} | ${uncached.toFixed(3)} | ${ideal.toFixed(3)} |`);
}
console.log(report.join("\n"));
