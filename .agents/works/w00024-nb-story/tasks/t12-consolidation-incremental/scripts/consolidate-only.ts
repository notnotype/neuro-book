// t12 的评测驱动（plan.md 的“验证”第 2 条）：只跑整理，不抽章节。
//
// 用 prefix-098-fixes 修过的前 95 章草稿，按第 5、10、…、95 章的顺序，每次只编译截至这一章的草稿与本组此前接受的整理稿，
// 调用 --pkg 那份代码的 `consolidate`（旧代码 4 个参数，t12 起多一个 since），逐次把整理稿、用量、问题写进
// <out>/state.json；中断后再跑同一条命令从已存的接着跑。
//
// 费用上限：每次 HTTP 尝试之前，把 <budget-dir> 下所有组已记下的费用加上这一次的最坏支出（上一次的输入 token 的 1.5 倍，
// 没有时按 10 万算，加 32,000 输出 token）与上限比，超过就中止并在 state.json 里写明不完整。用量不完整的尝试按已知下界计。
//
// --fake：不调用真实模型，起本机端点，每次回一份空的整理稿，核对只发出了整理请求、19 次都能跑完。
//
// 用法（仓库根执行，真实模型要 --env-file=.env 带上 NBOOK_LLM_*）：
//   bun --env-file=.env <本文件> --pkg <nb-story 包目录> --out <输出目录> [--budget-dir <目录> --budget 3] [--fake]
import {mkdir, readdir, readFile, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import {parseArgs} from "node:util";
import {gunzipSync} from "node:zlib";

const {values} = parseArgs({options: {pkg: {type: "string"}, out: {type: "string"}, "budget-dir": {type: "string"}, budget: {type: "string", default: "3"}, fake: {type: "boolean", default: false}}});
if (!values.pkg || !values.out) throw new Error("用法见文件头");
const pkg = resolve(values.pkg);
const out = resolve(values.out);
const budgetDir = resolve(values["budget-dir"] ?? join(out, ".."));
const budget = Number(values.budget);
const PRICE = {input: 1, output: 4, cacheRead: 0.02};
const CHAPTERS = Array.from({length: 19}, (_, index) => (index + 1) * 5);

const {compile} = await import(join(pkg, "src/ingest/compile.ts"));
const {consolidate} = await import(join(pkg, "src/ingest/chapter.ts"));
const {ModelAborted} = await import(join(pkg, "src/ingest/model.ts"));
const {sampleDataset} = await import(join(pkg, "testing/sample.ts"));
const gunzipJson = async <T>(name: string): Promise<T> => JSON.parse(gunzipSync(await readFile(join(pkg, "tests/fixtures/ingest", name))).toString("utf8")) as T;

interface Usage {input: number; output: number; cacheRead: number; complete: boolean}
interface AttemptRecord {attempt: number; ms: number; usage: Usage; error: string | null}
interface RunRecord {chapter: number; since: number; accepted: boolean; consolidation: unknown | null; problems: string[]; attempts: AttemptRecord[]; error?: string}
interface State {pkg: string; runs: RunRecord[]; incomplete?: string}

const cost = (usage: Usage) => (Math.max(0, usage.input - usage.cacheRead) * PRICE.input + usage.cacheRead * PRICE.cacheRead + usage.output * PRICE.output) / 1_000_000;

async function spentSoFar(): Promise<number> {
    let total = 0;
    for (const entry of await readdir(budgetDir, {withFileTypes: true})) {
        if (!entry.isDirectory()) continue;
        const text = await readFile(join(budgetDir, entry.name, "state.json"), "utf8").catch(() => null);
        if (text === null) continue;
        for (const run of (JSON.parse(text) as State).runs) for (const attempt of run.attempts) total += cost(attempt.usage);
    }
    return total;
}

await mkdir(out, {recursive: true});
const stateFile = join(out, "state.json");
const state: State = JSON.parse(await readFile(stateFile, "utf8").catch(() => JSON.stringify({pkg, runs: []}))) as State;
delete state.incomplete;
const save = () => writeFile(stateFile, `${JSON.stringify(state, null, 1)}\n`);

const sample = await sampleDataset();
const fixes = await gunzipJson<{chapters: Record<string, {draft: unknown}>}>("prefix-098-fixes.json.gz");
const final = await gunzipJson<{drafts: unknown[]}>("run-med-100-final.json.gz");
const drafts = final.drafts.slice(0, 95).map((draft, index) => fixes.chapters[String(index + 1)]?.draft ?? draft);

let endpoint: {baseUrl: string; model: string; apiKey: string; maxTokens: number};
const fakeSteps: string[] = [];
let stopFake = () => {};
if (values.fake) {
    const {startEndpoint} = await import(join(pkg, "testing/openai-endpoint.ts"));
    const server = startEndpoint((body: {messages: {content: string}[]}, _index: number, headers: Headers) => {
        // 请求头写成“章/步骤/第几次”（src/ingest/model.ts 的 STEP_HEADER）。
        fakeSteps.push(headers.get("x-nbstory-step")?.split("/")[1] ?? "?");
        const through = Number(/读到第 (\d+) 章/u.exec(body.messages[1]!.content)?.[1]);
        return {kind: "text", text: JSON.stringify({through, merges: [], summaries: [], arcs: []}), usage: {prompt_tokens: 1000, completion_tokens: 10}};
    });
    stopFake = () => server.stop();
    endpoint = {baseUrl: server.url, model: "fake", apiKey: "fake", maxTokens: 32_000};
} else {
    const baseUrl = process.env.NBOOK_LLM_BASE_URL;
    const apiKey = process.env.NBOOK_LLM_API_KEY;
    if (!baseUrl || !apiKey) throw new Error("没有 NBOOK_LLM_BASE_URL 或 NBOOK_LLM_API_KEY（用 bun --env-file=.env 运行）");
    endpoint = {baseUrl, model: "gpt-6-luna", apiKey, maxTokens: 32_000};
}

try {
    for (const chapter of CHAPTERS) {
        if (state.runs.some(run => run.chapter === chapter && run.error === undefined)) continue;
        state.runs = state.runs.filter(run => run.chapter !== chapter);
        const accepted = state.runs.filter(run => run.accepted).map(run => run.consolidation);
        const sources = sample.sources.filter((item: {chapter: number}) => item.chapter <= chapter);
        const book = sample.book;
        const dataset = compile(book, sources, drafts.slice(0, chapter), accepted).dataset;
        const since = (accepted.at(-1) as {through: number} | undefined)?.through ?? 0;
        const record: RunRecord = {chapter, since, accepted: false, consolidation: null, problems: [], attempts: []};
        state.runs.push(record);
        const controller = new AbortController();
        const lastInput = [...state.runs].reverse().flatMap(run => run.attempts).find(attempt => attempt.usage.complete)?.usage.input ?? 100_000;
        const run = {
            endpoint,
            signal: controller.signal,
            onAttemptStart: async () => {
                const worst = (lastInput * 1.5 * PRICE.input + endpoint.maxTokens * PRICE.output) / 1_000_000;
                const spent = await spentSoFar();
                if (spent + worst > budget) {
                    state.incomplete = `费用上限：已记 ${spent.toFixed(3)} 元，这一次最坏 ${worst.toFixed(3)} 元，超过 ${budget} 元，停在第 ${chapter} 章`;
                    controller.abort();
                }
            },
            onAttempt: (_step: string, attempt: {attempt: number; ms: number; usage: Usage; error: {message: string} | null}) => {
                record.attempts.push({attempt: attempt.attempt, ms: attempt.ms, usage: attempt.usage, error: attempt.error?.message ?? null});
                void save();
            },
        };
        const compileWith = (candidate: unknown) => compile(book, sources, drafts.slice(0, chapter), [...accepted, candidate]);
        try {
            // t12 之前的 consolidate 没有 since 参数。
            const outcome = consolidate.length >= 5 ? await consolidate(chapter, dataset, since, compileWith, run) : await consolidate(chapter, dataset, compileWith, run);
            record.accepted = outcome.consolidation !== null;
            record.consolidation = outcome.consolidation;
            record.problems = outcome.problems;
        } catch (error) {
            record.error = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
            await save();
            if (error instanceof ModelAborted || state.incomplete) break;
            throw error;
        }
        await save();
        console.log(`第 ${chapter} 章：${record.accepted ? "接受" : "跳过"}，${record.attempts.length} 次尝试，输入 ${record.attempts.reduce((sum, item) => sum + item.usage.input, 0)}，累计 ${(await spentSoFar()).toFixed(3)} 元`);
    }
} finally {
    stopFake();
    await save();
}
if (values.fake) {
    const others = fakeSteps.filter(step => step !== "consolidation");
    console.log(`本机端点：${fakeSteps.length} 次请求，非整理请求 ${others.length} 次${others.length ? `（${others.join("、")}）` : ""}`);
    if (others.length || state.runs.filter(run => run.error === undefined).length !== CHAPTERS.length) process.exit(1);
}
if (state.incomplete) {
    console.log(`不完整：${state.incomplete}`);
    process.exit(3);
}
