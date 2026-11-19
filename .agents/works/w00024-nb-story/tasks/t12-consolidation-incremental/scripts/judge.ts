// t12 评测的盲评（plan.md 的“验证”第 2 条）：第 30、60、95 章各一次，让模型比较旧写法与新写法的主线列表、主要对象归纳
// （出场最多的 8 个对象，各方面最新的一份），附截至该章的全部情节概括作对照。A、B 哪份是新写法按章号交替，结果里写明。
// 只记录，不设门槛。费用计入 <budget-dir> 的同一个上限（3 元）：调用前按已记下的加这一次的最坏支出检查。
//
// 用法（仓库根执行）：bun --env-file=.env <本文件> --pkg <nb-story 包目录> --old <旧组目录> --new <新组目录> --budget-dir <目录> --out <judge.json>
import {readdir, readFile, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import {parseArgs} from "node:util";
import {gunzipSync} from "node:zlib";

const {values} = parseArgs({options: {pkg: {type: "string"}, old: {type: "string"}, new: {type: "string"}, "budget-dir": {type: "string"}, budget: {type: "string", default: "3"}, out: {type: "string"}}});
if (!values.pkg || !values.old || !values.new || !values["budget-dir"] || !values.out) throw new Error("用法见文件头");
const pkg = resolve(values.pkg);
const PRICE = {input: 1, output: 4, cacheRead: 0.02};
const baseUrl = process.env.NBOOK_LLM_BASE_URL, apiKey = process.env.NBOOK_LLM_API_KEY;
if (!baseUrl || !apiKey) throw new Error("没有 NBOOK_LLM_BASE_URL 或 NBOOK_LLM_API_KEY（用 bun --env-file=.env 运行）");

const {compile} = await import(join(pkg, "src/ingest/compile.ts"));
const {sampleDataset} = await import(join(pkg, "testing/sample.ts"));
const gunzipJson = async <T>(name: string): Promise<T> => JSON.parse(gunzipSync(await readFile(join(pkg, "tests/fixtures/ingest", name))).toString("utf8")) as T;
const sample = await sampleDataset();
const fixes = await gunzipJson<{chapters: Record<string, {draft: unknown}>}>("prefix-098-fixes.json.gz");
const final = await gunzipJson<{drafts: unknown[]}>("run-med-100-final.json.gz");
const drafts = final.drafts.slice(0, 95).map((draft, index) => fixes.chapters[String(index + 1)]?.draft ?? draft);

interface Usage {input: number; output: number; cacheRead: number}
interface State {runs: {chapter: number; accepted: boolean; consolidation: unknown; attempts: {usage: Usage}[]}[]}
const cost = (usage: Usage) => (Math.max(0, usage.input - usage.cacheRead) * PRICE.input + usage.cacheRead * PRICE.cacheRead + usage.output * PRICE.output) / 1_000_000;
const load = async (dir: string) => JSON.parse(await readFile(join(resolve(dir), "state.json"), "utf8")) as State;
const groups = {old: await load(values.old), new: await load(values.new)};

interface Verdict {chapter: number; newIs: "A" | "B"; arcs: string; summaries: string; reasons: string; usage: Usage}
const results: Verdict[] = JSON.parse(await readFile(values.out, "utf8").catch(() => "[]")) as Verdict[];

async function spent(): Promise<number> {
    let total = results.reduce((sum, item) => sum + cost(item.usage), 0);
    for (const entry of await readdir(values["budget-dir"]!, {withFileTypes: true})) {
        if (!entry.isDirectory()) continue;
        const text = await readFile(join(values["budget-dir"]!, entry.name, "state.json"), "utf8").catch(() => null);
        if (text) for (const run of (JSON.parse(text) as State).runs) for (const attempt of run.attempts) total += cost(attempt.usage);
    }
    return total;
}

function materials(state: State, chapter: number) {
    const accepted = state.runs.filter(run => run.accepted && run.chapter <= chapter).map(run => run.consolidation);
    const dataset = compile(sample.book, sample.sources.filter((item: {chapter: number}) => item.chapter <= chapter), drafts.slice(0, chapter), accepted).dataset;
    const through = Math.max(0, ...dataset.arcs.map((arc: {through: number}) => arc.through));
    const arcs = dataset.arcs.filter((arc: {through: number}) => arc.through === through).map((arc: {title: string; status: string; episodes: string[]; summary: string}) => `- ${arc.title}（${arc.status === "closed" ? "已结束" : "进行中"}，${arc.episodes.length} 段情节）：${arc.summary}`).join("\n");
    return {dataset, arcs};
}

for (const chapter of [30, 60, 95]) {
    if (results.some(item => item.chapter === chapter)) continue;
    const old = materials(groups.old, chapter), fresh = materials(groups.new, chapter);
    const mentions = new Map<string, number>();
    for (const mention of fresh.dataset.mentions) mentions.set(mention.entity, (mentions.get(mention.entity) ?? 0) + 1);
    const top: string[] = [...mentions].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id]) => id);
    const summaries = (dataset: typeof fresh.dataset) => top.map(id => {
        const latest = new Map<string, {through: number; items: {text: string}[]}>();
        for (const summary of dataset.summaries) if (summary.entity === id && (!latest.has(summary.facet) || summary.through >= latest.get(summary.facet)!.through)) latest.set(summary.facet, summary);
        const name = dataset.entities.find((entity: {id: string}) => entity.id === id)?.names.find((item: {primary: boolean}) => item.primary)?.text ?? id;
        return `### ${name}\n${[...latest].map(([facet, summary]) => `- ${facet}：${summary.items.map(item => item.text).join("")}`).join("\n") || "（没有归纳）"}`;
    }).join("\n");
    const newIs: "A" | "B" = (chapter / 5) % 2 === 0 ? "A" : "B";
    const [a, b] = newIs === "A" ? [fresh, old] : [old, fresh];
    const reference = fresh.dataset.episodes.map((item: {id: string; at: {chapter: number}; title: string; summary: string}) => `${item.id}（第 ${item.at.chapter} 章）${item.title}：${item.summary}`).join("\n");
    const prompt = `下面是一部小说读到第 ${chapter} 章为止的全部情节概括，以及两份自动整理出的“主线列表”和“主要人物与事物的归纳”（A、B）。请对照情节概括，分别判断主线列表哪份更好、归纳哪份更好，或相当。

主线列表看：是否覆盖了主要的情节脉络、划分是否合理（不过粗也不过碎）、概括是否准确、进行中或已结束是否对。
归纳看：是否准确、是否反映到第 ${chapter} 章为止的最新情况、有没有遗漏重要方面、有没有与情节矛盾。

只输出 JSON：{"arcs":"A"|"B"|"相当","summaries":"A"|"B"|"相当","reasons":"三到六句理由"}

【情节概括】
${reference}

【A 的主线列表】
${a.arcs}

【B 的主线列表】
${b.arcs}

【A 的归纳】
${summaries(a.dataset)}

【B 的归纳】
${summaries(b.dataset)}`;
    const worst = ((prompt.length / 1.2) * PRICE.input + 8000 * PRICE.output) / 1_000_000;
    const already = await spent();
    if (already + worst > Number(values.budget)) {
        console.log(`费用上限：已记 ${already.toFixed(3)} 元，这一次最坏 ${worst.toFixed(3)} 元，停在第 ${chapter} 章`);
        break;
    }
    const response = await fetch(`${baseUrl.replace(/\/$/u, "")}/chat/completions`, {method: "POST", headers: {"content-type": "application/json", authorization: `Bearer ${apiKey}`}, body: JSON.stringify({model: "gpt-6-luna", messages: [{role: "user", content: prompt}], max_tokens: 8000})});
    if (!response.ok) throw new Error(`评分请求失败：HTTP ${response.status}`);
    const body = (await response.json()) as {choices: {message: {content: string}}[]; usage: {prompt_tokens: number; completion_tokens: number; prompt_tokens_details?: {cached_tokens?: number}}};
    const text = body.choices[0]!.message.content;
    const parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as {arcs: string; summaries: string; reasons: string};
    results.push({chapter, newIs, ...parsed, usage: {input: body.usage.prompt_tokens, output: body.usage.completion_tokens, cacheRead: body.usage.prompt_tokens_details?.cached_tokens ?? 0}});
    await writeFile(values.out, `${JSON.stringify(results, null, 1)}\n`);
    const who = (pick: string) => (pick === "相当" ? "相当" : pick === newIs ? "新写法" : "旧写法");
    console.log(`第 ${chapter} 章：主线 ${who(parsed.arcs)}，归纳 ${who(parsed.summaries)}`);
}
