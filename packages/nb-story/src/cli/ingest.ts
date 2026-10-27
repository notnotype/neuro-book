/**
 * `nbstory ingest`（docs/specs/story/ingest.md 的“命令”与输出 1、2、11、13 到 15）：导入原文并在前台逐章抽取、
 * 接着抽、看进度。由 main.ts 动态导入。
 *
 * 中断信号（Ctrl-C）让任务停下：没提交的那一章作废，等抽取线程结束、锁放掉、状态写下后以 130 退出。这条命令不
 * 加载 nb-harness（它会让 OMP 接管中断信号、跑完清理就退出进程），所以直接用 `process.on("SIGINT")`。
 */

import {readFile, stat} from "node:fs/promises";
import {basename, extname} from "node:path";

import {StoryError} from "../core/errors";
import {coordinatedLibrary, runnerTable} from "../ingest/coordinator";
import type {IngestEvent, JobOutcome} from "../ingest/job";
import {modelChoice, startIngest, type Runner} from "../ingest/runner";
import {IngestUsageError, planFromText, type IngestPlan} from "../ingest/start";
import {ingestStatus, ingestStatuses, lineCost, sumCosts, type IngestStatus, type UsageTotals} from "../ingest/status";
import {STEP_NAMES} from "../ingest/chapter";
import {decodeUtf8, MAX_SOURCE_BYTES} from "../ingest/text";
import type {BookFeatures} from "../core/dataset";
import type {Library} from "../core/library";
import {ingestModel, loadQaConfig, recallModel} from "../qa/config";
import {QaError} from "../qa/errors";
import {NEXT_STEP, type CliIo} from "./main";

/** 退出码（ingest.md 输出 15）。 */
const EXIT_LIBRARY = 1;
const EXIT_USAGE = 2;
const EXIT_FAILED = 4;
const EXIT_STOPPED = 130;

/** 抽取失败停下的码；其余失败（书在抽取期间被删除、书库格式不认识等）按书库类失败退出。 */
const INGEST_FAILURES = new Set(["model_failed", "ingest_bad_reply"]);

interface IngestOptions {
    library: string | undefined;
    params: Record<string, unknown>;
    json: boolean;
}

const ACTION_TEXT: Record<IngestPlan["action"], string> = {new: "新建", resume: "接着抽", append: "追加新章后接着抽", done: "已经全部抽完"};

/** 用法检查：四种用法（抽取、预览、接着抽、看进度）各自接受的参数。不合法时返回说明。 */
function usageProblem(params: Record<string, unknown>): string | null {
    const file = params.file !== undefined;
    if (params.status === true) {
        if (file || params.title !== undefined || params.id !== undefined || params.preview === true || params.noLedger === true || params.noSecrets === true) return "--status 只能与 --book 一起用";
        return null;
    }
    if (file) return params.book !== undefined ? "给了原文文件时用 --id 指定书 id，不用 --book" : null;
    if (params.book === undefined) return "要给原文文件，或用 --book <书 id> 接着抽，或 --status 看进度";
    if (params.preview === true || params.title !== undefined || params.id !== undefined) return "--book 接着抽时不收 --preview、--title、--id";
    return null;
}

export async function ingestCommand(options: IngestOptions, io: CliIo): Promise<number> {
    const {params, json} = options;
    const problem = usageProblem(params);
    if (problem !== null) {
        if (json) io.stdout(JSON.stringify({ok: false, error: {code: "invalid_params", message: problem}}));
        io.stderr(`${problem}\n用法：nbstory ingest <原文文件> [--title <书名>] [--id <书 id>] [--preview] | ingest --book <书 id> | ingest --status [--book <书 id>]`);
        return EXIT_USAGE;
    }
    const runners = new Map<string, Runner>();
    const library = coordinatedLibrary(options.library, runnerTable(runners));

    const fail = (code: string, message: string, exit: number, kind?: string): number => {
        if (json) io.stdout(JSON.stringify({ok: false, error: {code, message, ...(kind === undefined ? {} : {kind})}}));
        else {
            const next = code === "qa_unconfigured" ? "用 nbstory config init 写配置，或 nbstory config show 看现在的配置" : NEXT_STEP[code as keyof typeof NEXT_STEP];
            io.stderr(`错误（${code}${kind ? `，${kind}` : ""}）：${message}${next ? `\n下一步：${next}` : ""}`);
        }
        return exit;
    };
    const done = (data: unknown, text: string): number => {
        io.stdout(json ? JSON.stringify({ok: true, data}) : text);
        return 0;
    };

    try {
        if (params.status === true) return await showStatus(library, params.book as string | undefined, done, fail);
        const file = params.file as string | undefined;
        const text = file === undefined ? undefined : await readSource(file);
        const title = (params.title as string | undefined) ?? (file === undefined ? undefined : basename(file, extname(file)));
        const features = requestedFeatures(params);
        if (params.preview === true) {
            const plan = await planFromText(library, {text: text!, title: title!, ...(params.id === undefined ? {} : {id: params.id as string}), ...(features ? {features} : {})});
            return done(planData(plan), previewText(plan));
        }
        return await run(library, runners, {text, title, id: (params.id ?? params.book) as string | undefined, features, config: params.config as string | undefined}, io, json, done, fail);
    } catch (error) {
        // 开关与这本书新建时定的不同：是用法错误（输出 15），其余书库类失败照旧退出码 1。
        if (error instanceof IngestUsageError) return fail(error.code, error.message, EXIT_USAGE);
        if (error instanceof StoryError) return fail(error.code, error.message, EXIT_LIBRARY);
        if (error instanceof QaError) return fail(error.code, error.message, EXIT_LIBRARY);
        throw error;
    }
}

/** 命令行上写了的开关（只有关：不写就是沿用保存值，新建时为开）；都没写时为 undefined。 */
function requestedFeatures(params: Record<string, unknown>): Partial<BookFeatures> | undefined {
    if (params.noLedger !== true && params.noSecrets !== true) return undefined;
    return {...(params.noLedger === true ? {ledger: false} : {}), ...(params.noSecrets === true ? {secrets: false} : {})};
}

/** 设置的一句话；两项都开时为 null（默认，不写）。 */
export function featuresText(features: BookFeatures): string | null {
    const off = [...(features.ledger ? [] : ["数值"]), ...(features.secrets ? [] : ["秘密"])];
    return off.length ? `不记${off.join("、")}` : null;
}

/** 读原文：先看大小，超过上限不读进内存。读不了（不存在、是目录、没有权限）一律 invalid_params。 */
async function readSource(file: string): Promise<string> {
    const unreadable = (error: unknown) => new StoryError("invalid_params", `读不了原文文件 ${file}`, {cause: error});
    let info: Awaited<ReturnType<typeof stat>>;
    try {
        info = await stat(file);
    } catch (error) {
        throw unreadable(error);
    }
    if (!info.isFile()) throw new StoryError("invalid_params", `${file} 不是文件`);
    if (info.size > MAX_SOURCE_BYTES) throw new StoryError("ingest_bad_text", `原文文件有 ${(info.size / 1024 / 1024).toFixed(1)} MiB，超过 32 MiB 的上限`);
    let bytes: Buffer;
    try {
        bytes = await readFile(file);
    } catch (error) {
        throw unreadable(error);
    }
    return decodeUtf8(bytes);
}

function planData(plan: IngestPlan): Omit<IngestPlan, "source"> {
    const {source: _source, ...rest} = plan;
    return rest;
}

function previewText(plan: IngestPlan): string {
    const head = [
        `书 ${plan.id}（${plan.title}）：${ACTION_TEXT[plan.action]}，共 ${plan.chapters.length} 章`,
        ...(plan.action === "append" ? [`多出 ${plan.newChapters} 章；已提交到第 ${plan.committed} 章`] : plan.action === "resume" ? [`已提交到第 ${plan.committed} 章`] : []),
        `第一个章标题之前 ${plan.preambleChars} 字（不算正文）；卷标题 ${plan.volumeLines} 行`,
        ...withFeatures(plan.features),
        "",
    ];
    return [...head, ...plan.chapters.map(chapter => `第 ${chapter.chapter} 章  ${chapter.title}  ${chapter.chars} 字`)].join("\n");
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} 秒`;

function costText(costs: {currency: string; amount: number}[]): string {
    return costs.length === 0 ? "费用未知（没有配置价格）" : `费用 ${costs.map(cost => `${cost.amount.toFixed(4)} ${cost.currency}`).join(" + ")}`;
}

function usageText(usage: UsageTotals & {ms: number}): string {
    return `用时 ${seconds(usage.ms)}，输入 ${usage.input}、输出 ${usage.output}、缓存命中 ${usage.cacheRead} token，${costText(usage.costs)}${usage.complete ? "" : "（不完整：有请求的用量拿不到，数值是下界）"}`;
}

function stateText(status: IngestStatus): string {
    if (status.state === "done") return "已全部抽完";
    if (status.state === "running") {
        const where = status.current?.chapter ? `，正在第 ${status.current.chapter} 章${status.current.step ? STEP_NAMES[status.current.step] : ""}` : "";
        const retry = status.current?.retry ? `，等第 ${status.current.retry.attempt} 次失败后的重发（到 ${status.current.retry.until}）` : "";
        return `运行中（由${status.runner === "cli" ? "命令行" : "独立服务"}运行）${where}${retry}`;
    }
    const reason = status.stopReason;
    if (!reason) return "已停下";
    if (reason.kind === "user") return "已停下（用户停止）";
    if (reason.kind === "exited") return "已停下（运行它的进程已退出）";
    return `已停下（${reason.code}${reason.errorKind ? `，${reason.errorKind}` : ""}：${reason.message}）`;
}

const withFeatures = (features: BookFeatures): string[] => {
    const text = featuresText(features);
    return text === null ? [] : [`设置：${text}`];
};

function statusText(status: IngestStatus, detail: boolean): string {
    const lines = [
        `${status.id}（${status.title}）：${stateText(status)}；已提交 ${status.committed}/${status.total} 章`,
        ...withFeatures(status.features).map(line => `  ${line}`),
        `  这次：${usageText(status.thisRun)}`,
        `  历次：${usageText(status.allRuns)}`,
        ...(status.average ? [`  每章平均：用时 ${seconds(status.average.ms)}，${costText(status.average.costs)}`] : []),
    ];
    if (detail) for (const chapter of status.chapters) lines.push(`  第 ${chapter.chapter} 章 ${chapter.title}：用时 ${seconds(chapter.ms)}，${costText(chapter.usage.costs)}${chapter.usage.complete ? "" : "（不完整）"}，丢弃 ${chapter.dropped} 条`);
    return lines.join("\n");
}

type Done = (data: unknown, text: string) => number;
type Fail = (code: string, message: string, exit: number, kind?: string) => number;

async function showStatus(library: Library, book: string | undefined, done: Done, fail: Fail): Promise<number> {
    if (book !== undefined) {
        const status = await ingestStatus(library, book);
        if (!status) return fail("book_not_found", `书 ${book} 没有抽取记录`, EXIT_LIBRARY);
        return done(status, statusText(status, true));
    }
    const statuses = await ingestStatuses(library);
    return done({books: statuses}, statuses.length === 0 ? "书库里没有抽取记录" : statuses.map(status => statusText(status, false)).join("\n\n"));
}

/** 这一章到目前为止每次尝试的费用；提交那一行报它们的合计，下一章开始时清空。 */
type ChapterCosts = ({currency: string; amount: number} | null)[];

function progressLine(event: IngestEvent, chapterStart: number, costs: ChapterCosts): string | null {
    switch (event.type) {
        case "chapter":
            return `第 ${event.chapter}/${event.total} 章开始`;
        case "step":
            return `· 第 ${event.chapter} 章：${STEP_NAMES[event.step]}`;
        case "retry":
            return `· 第 ${event.chapter} 章${STEP_NAMES[event.step]}第 ${event.attempt} 次失败（${event.message}），等 ${seconds(event.waitMs)}后重发`;
        case "effort":
            return `· 第 ${event.chapter} 章${STEP_NAMES[event.step]}：端点不接受 ${event.from} 档，改用 ${event.to} 档`;
        case "usage":
            return null;
        case "committed":
            return `第 ${event.chapter}/${event.total} 章已提交：用时 ${seconds(Date.now() - chapterStart)}，${costText(sumCosts(costs))}，丢弃 ${event.dropped} 条`;
    }
}

async function run(
    library: Library,
    runners: Map<string, Runner>,
    input: {text: string | undefined; title: string | undefined; id: string | undefined; features: Partial<BookFeatures> | undefined; config: string | undefined},
    io: CliIo,
    json: boolean,
    done: Done,
    fail: Fail,
): Promise<number> {
    const config = await loadQaConfig(...(input.config === undefined ? [] : [input.config]));
    const model = ingestModel(config);
    const recall = recallModel(config);
    const costs: ChapterCosts = [];
    let chapterStart = Date.now();
    const {plan, runner} = await startIngest({
        library,
        ...(input.text === undefined ? {} : {text: input.text}),
        ...(input.title === undefined ? {} : {title: input.title}),
        ...(input.id === undefined ? {} : {id: input.id}),
        ...(input.features === undefined ? {} : {features: input.features}),
        ...modelChoice(model),
        recall: recall === null ? null : modelChoice(recall),
        runner: "cli",
        onEvent: event => {
            if (event.type === "chapter") {
                chapterStart = Date.now();
                costs.length = 0;
            }
            if (event.type === "usage" && event.line.kind === "end") costs.push(lineCost(event.line));
            const line = progressLine(event, chapterStart, costs);
            if (line !== null) io.stderr(line);
        },
    });
    if (!runner) {
        const status = await ingestStatus(library, plan.id);
        return done({id: plan.id, action: plan.action, outcome: "done", committed: plan.committed, total: plan.chapters.length, status}, `书 ${plan.id}（${plan.title}）已经全部抽完，共 ${plan.chapters.length} 章；没有调用模型`);
    }
    runners.set(runner.id, runner);
    const setting = featuresText(plan.features);
    io.stderr(`书 ${plan.id}（${plan.title}）：${ACTION_TEXT[plan.action]}，共 ${plan.chapters.length} 章，已提交 ${plan.committed} 章；抽取模型 ${model.id}${setting === null ? "" : `；${setting}`}`);

    const onInterrupt = () => {
        io.stderr("· 收到中断信号，正在停下（没提交的那一章作废）");
        runner.stop();
    };
    process.on("SIGINT", onInterrupt);
    let outcome: JobOutcome;
    try {
        outcome = await runner.done;
    } finally {
        process.off("SIGINT", onInterrupt);
        runners.delete(runner.id);
    }

    const status = await ingestStatus(library, plan.id);
    const summary = {id: plan.id, action: plan.action, outcome: outcome.kind, committed: status?.committed ?? 0, total: status?.total ?? plan.chapters.length, thisRun: status?.thisRun ?? null};
    const summaryText = `书 ${plan.id}（${plan.title}）：提交到第 ${summary.committed} 章，共 ${summary.total} 章；这次${status ? usageText(status.thisRun) : ""}`;
    if (outcome.kind === "done") return done(summary, summaryText);
    if (!json) io.stdout(summaryText);
    if (outcome.kind === "stopped") return fail("cancelled", "已停下；再运行同一条命令（或 nbstory ingest --book）接着抽", EXIT_STOPPED);
    return fail(outcome.code, `${outcome.message}；已提交的章都保留，处理后再运行同一条命令接着抽`, INGEST_FAILURES.has(outcome.code) ? EXIT_FAILED : EXIT_LIBRARY, outcome.errorKind);
}
