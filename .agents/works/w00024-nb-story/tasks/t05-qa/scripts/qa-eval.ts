// story.qa 验收 9：内置问答的回归。用真实模型（gpt-6-luna，luna 渠道）经 `nbstory ask --json` 作答，w00005 t22 判分器 v2
// 一审，整数计数判定门槛。
//
// 用法（从仓库根运行，密钥经 --env-file 交给子进程，不打印）：
//   bun --env-file=.env .agents/works/w00024-nb-story/tasks/t05-qa/scripts/qa-eval.ts answer [并发，默认 4]
//   bun --env-file=.env .agents/works/w00024-nb-story/tasks/t05-qa/scripts/qa-eval.ts judge
//   bun .agents/works/w00024-nb-story/tasks/t05-qa/scripts/qa-eval.ts check
// 只跑一部分（试跑）：EVAL_BATCHES=graph56 EVAL_IDS=I21,B21 EVAL_RUNS=run1。
//
// 三批（qa.md 验收 9）：
//   graph56  图当目录，第 21 到 100 章 56 题 × 3，168 份，一审答错不超过 33 份（基线 33/168，约 19.6%）
//   graph16  图当目录，知情、身份 16 题 × 3，48 份，一审答错不超过 11 份
//   full16   全读，知情、身份 16 题 × 1，16 份，只记录
// 判定（check 的退出码）：任何一份没答、没判分、答案没有出处或提到阅读位置之后的内容（EXCUSED 里人工核对过的误报除外），
// 或图当目录两批超门槛，非零退出。
//
// 作答结果：
// - 交卷：送判的 answer 是 answerText（结论、表或分点、说明与覆盖），evidence 是三处 refs 的并集，conclusionType 照填；
//   用量、读过的章、退回次数、记录 id 只留在外层，不送判。
// - 文字回复（2026-10-21 起 answer 可选）：送判回复正文，evidence 取正文里的出处，conclusionType 写“文字回复”，外层记 kind。
// - no_answer（提醒两次仍不交卷；2026-10-21 起是既没交卷也没有文字）：是系统给出的结果，按“（没有交卷）”送判，计入答错一类。
// - model_failed（渠道失败）：最多重试 3 次，仍失败的这一份算没答，回归不算通过；可以之后续跑。
// 续跑：已有结果文件的跳过；每批目录里的 inputs.json 记下这次的输入（代码提交、模型与请求参数、题集与原文的摘要），
// 与现在的不同就拒绝续跑，免得把不同输入的结果混在一起。

import {createHash} from "node:crypto";
import {existsSync} from "node:fs";
import {appendFile, mkdir, readFile, writeFile} from "node:fs/promises";
import {join} from "node:path";

const REPO = "/home/<user>/CodeRepository/neuro-book";
const TASK = join(REPO, ".agents/works/w00024-nb-story/tasks/t05-qa");
// 作答用的代码：t05 的 worktree（合入前）。报告里记下它的提交。
const WT = process.env.EVAL_WORKTREE ?? join(REPO, ".worktree/w00024-t05-qa");
const NB_STORY = join(WT, "packages/nb-story");
const W5 = join(REPO, ".worktree/w00005-novel-understanding-spike/.agents/works/w00005-novel-understanding-spike/tasks");
const Q56 = join(W5, "t34-v9-100ch/questions-ch21-100-fixed.json");
const Q16 = join(W5, "t34-v9-100ch/questions-knowledge16.json");
const SOURCE = join(W5, "t23-eval-50ch/evidences/source-ch001-100.json");
const JUDGE = join(W5, "t22-eval-v2-grading/scripts/judge-v2.ts");
const SAMPLE = join(NB_STORY, "tests/fixtures/sample-100ch.json.gz");
const OUT = join(TASK, "evidences/qa-eval");
const LOCAL = join(REPO, ".local/agent/works/w00024-nb-story/tasks/t05-qa/eval");
const LIBRARY = join(LOCAL, "library");
const CONFIG = join(LOCAL, "config.json");

const MODEL = {id: "gpt-6-luna", maxTokens: 64000, thinking: "xhigh"};

interface Batch {
    name: string;
    questions: string;
    mode: "graph" | "full";
    runs: string[];
    /** 一审答错的上限；null 表示只记录。 */
    maxWrong: number | null;
}

const BATCHES: Batch[] = [
    {name: "graph56", questions: Q56, mode: "graph", runs: ["run1", "run2", "run3"], maxWrong: 33},
    {name: "graph16", questions: Q16, mode: "graph", runs: ["run1", "run2", "run3"], maxWrong: 11},
    {name: "full16", questions: Q16, mode: "full", runs: ["run1"], maxWrong: null},
];

type Question = {id: string; question: string; requiredPrefix: number; mustHave: unknown[]; forbidden: {kind: string}[]};

const only = (name: string): string[] | null => (process.env[name] ? process.env[name]!.split(",").filter(Boolean) : null);
const selectedBatches = (): Batch[] => BATCHES.filter(batch => only("EVAL_BATCHES")?.includes(batch.name) ?? true);

async function questionsOf(batch: Batch): Promise<Question[]> {
    const all = (JSON.parse(await readFile(batch.questions, "utf8")) as {questions: Question[]}).questions;
    const ids = only("EVAL_IDS");
    return ids ? all.filter(question => ids.includes(question.id)) : all;
}

async function sha(path: string): Promise<string> {
    return createHash("sha256").update(await readFile(path)).digest("hex").slice(0, 16);
}

async function run(command: string[], options: {cwd?: string; env?: Record<string, string | undefined>} = {}): Promise<{code: number; stdout: string; stderr: string}> {
    const child = Bun.spawn(command, {cwd: options.cwd ?? REPO, stdout: "pipe", stderr: "pipe", env: {...process.env, ...options.env}});
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return {code, stdout, stderr};
}

async function inputsOf(batch: Batch): Promise<Record<string, string>> {
    const commit = (await run(["git", "-C", WT, "rev-parse", "HEAD"])).stdout.trim();
    return {commit, model: JSON.stringify(MODEL), mode: batch.mode, questions: await sha(batch.questions), sample: await sha(SAMPLE)};
}

/** 本地书库与配置：第一次运行时建好。配置里只写密钥的环境变量名。 */
async function prepare(): Promise<void> {
    await mkdir(LOCAL, {recursive: true});
    const base = process.env.NBOOK_LLM_BASE_URL;
    if (!base || !process.env.NBOOK_LLM_API_KEY) throw new Error("NBOOK_LLM_BASE_URL 或 NBOOK_LLM_API_KEY 没有设置：用 bun --env-file=.env 运行");
    await writeFile(CONFIG, JSON.stringify({model: {baseUrl: base, id: MODEL.id, apiKeyEnv: "NBOOK_LLM_API_KEY", maxTokens: MODEL.maxTokens, thinking: MODEL.thinking}}, null, 2));
    if (existsSync(join(LIBRARY, "fox", "book.json"))) return;
    const json = join(LOCAL, "sample-100ch.json");
    await writeFile(json, Bun.gunzipSync(await readFile(SAMPLE)));
    const imported = await run(["bun", join(NB_STORY, "src/cli.ts"), "import", json, "--title", "转生反派萝莉，找茬魔法少女", "--id", "fox", "--library", LIBRARY]);
    if (imported.code !== 0) throw new Error(`导入样例书失败：${imported.stderr}`);
}

function answerFile(batch: Batch, runName: string, id: string): string {
    return join(OUT, batch.name, "answers", runName, `batch-${id}.json`);
}

const TRANSIENT = new Set(["network", "rate_limit", "provider", "quota"]);

async function answerOne(batch: Batch, runName: string, question: Question, log: (line: string) => void): Promise<void> {
    const file = answerFile(batch, runName, question.id);
    if (existsSync(file)) return;
    const {answerText} = (await import(join(NB_STORY, "src/qa/format.ts"))) as {answerText: (answer: unknown) => string};
    const {refsInText} = (await import(join(NB_STORY, "src/qa/read-ledger.ts"))) as {refsInText: (text: string) => string[]};
    for (let attempt = 1; attempt <= 3; attempt += 1) {
        const started = Date.now();
        const result = await run(["bun", join(NB_STORY, "src/cli.ts"), "ask", question.question, "--at", String(question.requiredPrefix), "--mode", batch.mode, "--config", CONFIG, "--library", LIBRARY, "--json"]);
        const sessionLog = join(LOCAL, "logs", batch.name, runName);
        await mkdir(sessionLog, {recursive: true});
        await writeFile(join(sessionLog, `${question.id}-try${attempt}.stderr`), result.stderr);
        let parsed: {ok: boolean; data?: any; error?: {code: string; kind?: string; message: string}};
        try {
            parsed = JSON.parse(result.stdout);
        } catch {
            log(`${batch.name} ${runName} ${question.id} 输出不是 JSON（退出码 ${result.code}，try ${attempt}）`);
            continue;
        }
        const ms = Date.now() - started;
        if (parsed.ok) {
            const record = parsed.data;
            // 2026-10-21（w00024 t08）起 answer 可选：模型没交卷、直接用文字回复时 answer 为 null，送判回复正文，
            // 依据取正文里写成出处形状的内容，并标明是文字回复（没经结构化校验）。
            const answer = record.answer;
            const reply = record.reply as {text: string; unverifiedRefs: string[]} | null | undefined;
            const graded = answer
                ? {answer: answerText(answer), evidence: [...new Set([...answer.evidence, ...(answer.knowledge ?? []).flatMap((row: any) => row.refs), ...(answer.points ?? []).flatMap((point: any) => point.refs)])], conclusionType: answer.conclusionType}
                : {answer: reply!.text, evidence: [...new Set(refsInText(reply!.text))], conclusionType: "文字回复"};
            await mkdir(join(OUT, batch.name, "answers", runName), {recursive: true});
            await writeFile(file, JSON.stringify({id: question.id, prefix: question.requiredPrefix, model: MODEL.id, ms, answers: [{id: question.id, ...graded}], run: {status: record.status, recordId: record.id, kind: answer ? "answer" : "reply", ...(reply ? {unverifiedRefs: reply.unverifiedRefs} : {}), chaptersRead: record.chaptersRead, rejections: record.rejections, usage: record.usage}}, null, 1));
            log(`${batch.name} ${runName} ${question.id} ${answer ? "交卷" : "文字回复"}（读 ${record.chaptersRead.length} 章，退回 ${record.rejections} 次，${Math.round(ms / 1000)} 秒）`);
            return;
        }
        const error = parsed.error!;
        if (error.code === "no_answer") {
            await mkdir(join(OUT, batch.name, "answers", runName), {recursive: true});
            await writeFile(file, JSON.stringify({id: question.id, prefix: question.requiredPrefix, model: MODEL.id, ms, answers: [{id: question.id, answer: "（没有交卷）", evidence: [], conclusionType: "无法确定"}], run: {status: "failed", error}}, null, 1));
            log(`${batch.name} ${runName} ${question.id} 没有交卷（no_answer）`);
            return;
        }
        log(`${batch.name} ${runName} ${question.id} 失败 ${error.code}${error.kind ? `/${error.kind}` : ""}（try ${attempt}）：${error.message.slice(0, 120)}`);
        if (error.code !== "model_failed" || !TRANSIENT.has(error.kind ?? "")) return;
        await Bun.sleep(30_000 * attempt);
    }
}

async function answerAll(concurrency: number): Promise<void> {
    await prepare();
    await mkdir(join(LOCAL, "logs"), {recursive: true});
    const logPath = join(LOCAL, "logs", "answer.log");
    const log = (line: string): void => {
        const stamped = `${new Date().toISOString()} ${line}\n`;
        process.stdout.write(stamped);
        void appendFile(logPath, stamped);
    };
    const jobs: (() => Promise<void>)[] = [];
    for (const batch of selectedBatches()) {
        const inputs = await inputsOf(batch);
        const inputsPath = join(OUT, batch.name, "inputs.json");
        if (existsSync(inputsPath)) {
            const previous = JSON.parse(await readFile(inputsPath, "utf8"));
            if (JSON.stringify(previous) !== JSON.stringify(inputs)) throw new Error(`${batch.name} 的输入变了，不能续跑：\n之前 ${JSON.stringify(previous)}\n现在 ${JSON.stringify(inputs)}`);
        } else {
            await mkdir(join(OUT, batch.name), {recursive: true});
            await writeFile(inputsPath, JSON.stringify(inputs, null, 2));
        }
        const runs = batch.runs.filter(name => only("EVAL_RUNS")?.includes(name) ?? true);
        for (const question of await questionsOf(batch)) for (const runName of runs) jobs.push(() => answerOne(batch, runName, question, log));
    }
    log(`开始：${jobs.length} 份，并发 ${concurrency}`);
    let next = 0;
    await Promise.all(Array.from({length: concurrency}, async () => {
        while (next < jobs.length) await jobs[next++]!();
    }));
    log("作答结束");
}

async function judgeAll(): Promise<void> {
    for (let sweep = 1; sweep <= 2; sweep += 1) {
        await Promise.all(selectedBatches().flatMap(batch => batch.runs.map(async runName => {
            const answers = join(OUT, batch.name, "answers", runName);
            // 判分器对没有答案的题也会判（判成“无答案”）并缓存，之后补上的答案就被跳过：只把已答、还没判的题交给它。
            const ids = (await questionsOf(batch)).map(question => question.id).filter(id => existsSync(join(answers, `batch-${id}.json`)) && !existsSync(join(OUT, batch.name, "judge", runName, `${id}.json`)));
            if (ids.length === 0) return;
            const result = await run(["bun", JUDGE, batch.questions, answers, join(OUT, batch.name, "judge", runName)], {env: {JUDGE_SOURCE: SOURCE, JUDGE_CONCURRENCY: "2", LUNA_TIMEOUT_MS: "1800000", JUDGE_IDS: ids.join(",")}});
            process.stdout.write(`judge ${batch.name} ${runName} sweep ${sweep}：退出码 ${result.code}\n`);
        })));
    }
}

/** 一份作答的结果，照 t22 v2-data.ts 的 outcomeOf（与 t03 skill-eval-check.ts 相同）。 */
function outcomeOf(question: Question, grade: any): string {
    if (!grade) return "未判";
    const score = grade.points.reduce((sum: number, point: any) => sum + (point.status === "对" ? 1 : point.status === "部分" ? 0.5 : 0), 0) / question.mustHave.length;
    const forbiddenError = (grade.errors ?? []).some((error: any) => error.forbidden != null && question.forbidden[error.forbidden]?.kind === "error");
    if (grade.core === "错" || forbiddenError) return "答错";
    if (grade.core === "回避") return "没把握";
    return score >= 0.75 ? "答对" : "答对但不全";
}

const REF = /(\d{1,3})\.(\d{1,3})(?:\s*[-—–~～至]\s*(?:(\d{1,3})\.)?(\d{1,3}))?/gu;
const CHAPTER = /第\s*(\d{1,3})\s*章/gu;

/**
 * 人工核对过的误报：检测只认章号，看不出否定句。按“批次/遍/题”精确放行，只放行写明的那一段原文，同一份答案里别的
 * 越界仍然会报；放行的每一条都写进报告。
 */
const EXCUSED: Record<string, {mention: string; reason: string}> = {
    "graph56/run3/A21": {mention: "第27章", reason: "覆盖说明写“未涉及第27章及之后内容”，是声明没越界；出处全部在第 26 章"},
};

async function check(): Promise<number> {
    const lines = ["# story.qa 验收 9：内置问答回归", ""];
    let pass = true;
    for (const batch of selectedBatches()) {
        const questions = await questionsOf(batch);
        const inputsPath = join(OUT, batch.name, "inputs.json");
        const inputs = existsSync(inputsPath) ? await readFile(inputsPath, "utf8") : "（没有）";
        type Row = {run: string; id: string; prefix: number; outcome: string; reply: boolean; refs: number; beyond: string[]; chapters: number | null; rejections: number | null; capped: boolean; cost: number | null; input: number; output: number};
        const rows: Row[] = [];
        const excusedNotes: string[] = [];
        for (const runName of batch.runs) {
            for (const question of questions) {
                const file = answerFile(batch, runName, question.id);
                if (!existsSync(file)) {
                    rows.push({run: runName, id: question.id, prefix: question.requiredPrefix, outcome: "未答", reply: false, refs: 0, beyond: [], chapters: null, rejections: null, capped: false, cost: null, input: 0, output: 0});
                    continue;
                }
                const data = JSON.parse(await readFile(file, "utf8"));
                const answer = data.answers[0];
                const text = `${answer.evidence.join("、")} ${answer.answer}`;
                const beyond: string[] = [];
                let refs = 0;
                for (const match of text.matchAll(REF)) {
                    refs += 1;
                    const last = match[3] ? Number(match[3]) : Number(match[1]);
                    if (Number(match[1]) > question.requiredPrefix || last > question.requiredPrefix) beyond.push(match[0]);
                }
                for (const match of answer.answer.matchAll(CHAPTER)) if (Number(match[1]) > question.requiredPrefix) beyond.push(match[0]);
                const excuse = EXCUSED[`${batch.name}/${runName}/${question.id}`];
                const excused = excuse === undefined ? [] : beyond.filter(mention => mention.replace(/\s+/gu, "") === excuse.mention);
                if (excuse !== undefined && excused.length > 0) {
                    beyond.splice(0, beyond.length, ...beyond.filter(mention => !excused.includes(mention)));
                    excusedNotes.push(`${runName} ${question.id}：“${excuse.mention}”，${excuse.reason}`);
                }
                const gradeFile = join(OUT, batch.name, "judge", runName, `${question.id}.json`);
                const grade = existsSync(gradeFile) ? JSON.parse(await readFile(gradeFile, "utf8")).grade : null;
                const chapters = data.run.chaptersRead?.length ?? null;
                rows.push({
                    run: runName,
                    id: question.id,
                    prefix: question.requiredPrefix,
                    outcome: data.run.status === "failed" && grade ? `${outcomeOf(question, grade)}（没有交卷）` : outcomeOf(question, grade),
                    // 文字回复（run.kind 为 reply）没经 answer 的结构化校验：报告里逐份标出并计数。
                    reply: data.run.kind === "reply",
                    refs: data.run.status === "failed" ? 1 : refs,
                    beyond,
                    chapters,
                    rejections: data.run.rejections ?? null,
                    capped: batch.mode === "graph" && chapters === 20,
                    cost: data.run.usage?.cost ?? null,
                    input: data.run.usage?.input ?? 0,
                    output: data.run.usage?.output ?? 0,
                });
            }
        }
        const count = (predicate: (row: Row) => boolean): number => rows.filter(predicate).length;
        const wrong = count(row => row.outcome.startsWith("答错"));
        const missing = count(row => row.outcome === "未答" || row.outcome.startsWith("未判"));
        const noRef = count(row => row.refs === 0 && row.outcome !== "未答");
        const spoil = count(row => row.beyond.length > 0);
        const complete = missing === 0 && noRef === 0 && spoil === 0;
        const within = batch.maxWrong === null || wrong <= batch.maxWrong;
        const verdict = !complete ? "不完整，不算通过" : batch.maxWrong === null ? "只记录" : within ? "通过" : "不通过";
        if (!complete || !within) pass = false;
        const answered = rows.filter(row => row.chapters !== null);
        const average = (values: number[]): string => (values.length === 0 ? "—" : (values.reduce((a, b) => a + b, 0) / values.length).toFixed(1));
        lines.push(
            `## ${batch.name}（${batch.mode === "graph" ? "图当目录" : "全读"}，${questions.length} 题 × ${batch.runs.length}）`,
            "",
            `- 份数 ${rows.length}；没答 ${count(row => row.outcome === "未答")}，没判 ${count(row => row.outcome.startsWith("未判"))}；没有出处 ${noRef}，提到阅读位置之后 ${spoil}`,
            ...excusedNotes.map(note => `- 人工核对放行（检测的误报）：${note}`),
            `- 一审答错 **${wrong}/${rows.length}**${batch.maxWrong === null ? "" : `，门槛 ${batch.maxWrong}`}：${verdict}`,
            `- 结果分布：${["答对", "答对但不全", "没把握", "答错"].map(name => `${name} ${count(row => row.outcome.replace("（没有交卷）", "") === name)}`).join("，")}；没有交卷 ${count(row => row.outcome.includes("没有交卷"))}；文字回复（没经结构化校验）${count(row => row.reply)}`,
            `- 每份平均读 ${average(answered.map(row => row.chapters!))} 章，退回 ${average(answered.map(row => row.rejections ?? 0))} 次；撞 20 章上限 ${count(row => row.capped)} 份；token 输入 ${rows.reduce((a, row) => a + row.input, 0)}、输出 ${rows.reduce((a, row) => a + row.output, 0)}`,
            "",
            "| 题 | 阅读位置 | " + batch.runs.join(" | ") + " |",
            "|---|---|" + batch.runs.map(() => "---").join("|") + "|",
            ...questions.map(question => `| ${question.id} | ${question.requiredPrefix} | ${batch.runs.map(runName => {
                const row = rows.find(item => item.run === runName && item.id === question.id)!;
                return `${row.outcome}${row.reply ? "，文字回复" : ""}${row.chapters === null ? "" : `，${row.chapters} 章`}${row.refs === 0 && row.outcome !== "未答" ? "，无出处" : ""}${row.beyond.length ? `，越界 ${row.beyond.join(" ")}` : ""}`;
            }).join(" | ")} |`),
            "",
            "输入：",
            "```json",
            inputs.trim(),
            "```",
            "",
        );
    }
    lines.push(`结论：${pass ? "通过" : "不通过或不完整"}`);
    await mkdir(OUT, {recursive: true});
    await writeFile(join(OUT, "report.md"), `${lines.join("\n")}\n`);
    console.log(lines.join("\n"));
    return pass ? 0 : 1;
}

const [command, arg] = process.argv.slice(2);
if (command === "answer") await answerAll(Number(arg ?? 4));
else if (command === "judge") await judgeAll();
else if (command === "check") process.exit(await check());
else {
    console.error("用法：qa-eval.ts answer [并发] | judge | check");
    process.exit(2);
}
