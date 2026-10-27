/**
 * 一次抽取任务（docs/specs/story/ingest.md 输出 4 到 11）：从书里已提交的下一章起逐章抽，第 5 的倍数章与原文末章
 * 先整理，再提交。调用方（runner.ts）已拿到这个 id 的抽取锁；这里只管“抽”和“提交”，不碰锁与状态文件。
 *
 * 停止有两个入口：`signal` 中止在途的模型请求与重试等待；`stopRequested()` 在每次模型请求之前与提交之前同步检查。
 * 后者是为了编译这类长时间的同步计算：编译期间收不到消息，但编译一结束、提交之前就能看到停止（计划审查第 6 条）。
 * 没提交的那一章作废，下次从头重做。
 *
 * 提交前整份数据必须没有错误（输出 5）：本章的检查、整理的检查之外，提交前再看一次整份数据，有错就不提交。
 * 用量与起止时间边抽边写；任务返回之前等它们都写完，不让账上少一笔（输出 13）。
 */

import {randomUUID} from "node:crypto";

import {featuresOf, type Dataset, type SourceChapter} from "../core/dataset";
import {StoryError} from "../core/errors";
import type {Library} from "../core/library";
import {consolidate, extractChapter, IngestBadReply, type ChapterRun, type RecallSource, type Step} from "./chapter";
import {compile} from "./compile";
import type {RawDraft} from "./draft-tools";
import {ModelAborted, ModelError, type Attempt, type IngestEffort, type ModelEndpoint} from "./model";
import type {ActivityLine, IngestStore, Price, UsageLine} from "./store";

/** 书目录里每次提交的抽取数据（core/library.ts 的 `extraction-<版本>.json`）。 */
export interface ExtractionData {
    through: number;
    drafts: RawDraft[];
    consolidations: unknown[];
    chapters: CommittedChapter[];
}

export interface CommittedChapter {
    chapter: number;
    /** 兜底丢弃的记录条数。 */
    dropped: number;
    /** 留下的问题：编译警告、跳过的整理、挑选退回规则。 */
    problems: string[];
    /** 说法怎么选的（w00024 t10 起）；没有这一项的章是之前的做法（全部已有记录），不用迁移。 */
    recall?: {source: RecallSource; ids: string[]};
}

export type IngestEvent =
    | {type: "chapter"; chapter: number; total: number}
    | {type: "step"; chapter: number; step: Step}
    | {type: "retry"; chapter: number; step: Step; attempt: number; waitMs: number; message: string}
    | {type: "effort"; chapter: number; step: Step; from: IngestEffort; to: IngestEffort}
    | {type: "usage"; line: UsageLine}
    | {type: "committed"; chapter: number; total: number; dropped: number; generation: string; revision: number};

export type JobOutcome = {kind: "done"} | {kind: "stopped"} | {kind: "failed"; code: string; errorKind?: string; message: string};

export interface JobOptions {
    library: Library;
    store: IngestStore;
    endpoint: ModelEndpoint;
    price: Price | null;
    /** 挑相关说法用的模型；null 时不挑（默认）。用量按它自己的单价记。 */
    recall: {endpoint: ModelEndpoint; price: Price | null} | null;
    /** 这次任务的编号（用量记账用）。 */
    run: string;
    signal: AbortSignal;
    stopRequested: () => boolean;
    onEvent: (event: IngestEvent) => void;
    sleep?: ChapterRun["sleep"];
    fetch?: ChapterRun["fetch"];
}

const CONSOLIDATE_EVERY = 5;

class Stopped extends Error {}

const EMPTY: ExtractionData = {through: 0, drafts: [], consolidations: [], chapters: []};

/** 书里已提交的抽取数据；书还不存在（第 1 章没提交）时为空。读法与 pinBook 相同，不会撞上提交回收旧文件。 */
export async function readCommitted(library: Library, id: string): Promise<{generation: string | undefined; data: ExtractionData}> {
    const read = await library.readExtraction(id);
    if (!read) return {generation: undefined, data: EMPTY};
    if (read.text === null) throw new StoryError("book_exists", `书 ${id} 是导入数据文件得来的，不能抽取`);
    return {generation: read.meta.generation, data: JSON.parse(read.text) as ExtractionData};
}

/** 这次任务里还没写完的记账；提交前与返回前都等它们写完，有一笔写不进去就失败。 */
class Ledger {
    readonly #writes: Promise<void>[] = [];

    remember(write: Promise<void>): void {
        // 先挂一个处理，免得在等它之前就报“未处理的 reject”；失败照样在 settle 里抛出。
        write.catch(() => undefined);
        this.#writes.push(write);
    }

    async settle(): Promise<void> {
        await Promise.all(this.#writes.splice(0));
    }
}

export async function runIngest(options: JobOptions): Promise<JobOutcome> {
    const ledger = new Ledger();
    let openChapter: number | null = null;
    const activity = (line: ActivityLine) => ledger.remember(options.store.appendActivity(line));
    const markChapter = (chapter: number | null, outcome?: "committed" | "stopped" | "failed") => {
        if (openChapter !== null && outcome) activity({kind: "chapter-end", run: options.run, chapter: openChapter, at: new Date().toISOString(), outcome});
        openChapter = chapter;
        if (chapter !== null) activity({kind: "chapter-start", run: options.run, chapter, at: new Date().toISOString()});
    };

    let outcome: JobOutcome;
    try {
        await extractAll(options, ledger, markChapter);
        outcome = {kind: "done"};
    } catch (error) {
        if (error instanceof Stopped || error instanceof ModelAborted) outcome = {kind: "stopped"};
        else if (error instanceof ModelError) outcome = {kind: "failed", code: "model_failed", errorKind: error.kind, message: error.message};
        else if (error instanceof IngestBadReply) outcome = {kind: "failed", code: "ingest_bad_reply", message: error.message};
        // 书在抽取期间被删除或换了一代、书库格式不认识：提交失败，任务停下，不往新的一代里写。
        else if (error instanceof StoryError) outcome = {kind: "failed", code: error.code, message: error.message};
        else throw error;
    }
    if (outcome.kind !== "done") markChapter(null, outcome.kind === "stopped" ? "stopped" : "failed");
    await ledger.settle();
    return outcome;
}

async function extractAll(options: JobOptions, ledger: Ledger, markChapter: (chapter: number | null, outcome?: "committed") => void): Promise<void> {
    const {library, store} = options;
    const source = await store.readSource();
    if (!source) throw new StoryError("book_not_found", `书 ${store.id} 没有抽取记录`);
    // 开关跟着书的数据走：已有记录、核对与编译都从 `dataset.book.features` 取（输出 4）。
    const book = {id: source.id, title: source.title, features: featuresOf(source.features)};
    const total = source.chapters.length;
    let {generation, data} = await readCommitted(library, store.id);
    const sourcesThrough = (chapter: number): SourceChapter[] => source.chapters.filter(item => item.chapter <= chapter);
    const checkStop = () => {
        if (options.stopRequested() || options.signal.aborted) throw new Stopped();
    };
    let prior: Dataset | null = data.through > 0 ? compile(book, sourcesThrough(data.through), data.drafts, data.consolidations).dataset : null;

    for (let chapter = data.through + 1; chapter <= total; chapter++) {
        checkStop();
        markChapter(chapter);
        options.onEvent({type: "chapter", chapter, total});
        const run = chapterRun(options, chapter, checkStop, ledger);
        const sources = sourcesThrough(chapter);
        const result = await extractChapter({source: source.chapters[chapter - 1]!, prior, features: book.features, compileWith: candidate => compile(book, sources, [...data.drafts, candidate], data.consolidations)}, run);
        const drafts = [...data.drafts, result.draft];
        let consolidations = data.consolidations;
        let dataset = result.dataset;
        let issues = result.issues;
        const problems = [...result.notes, ...result.remaining.map(issue => issue.message)];
        if (chapter % CONSOLIDATE_EVERY === 0 || chapter === total) {
            // 增量整理接着上一次被接受的整理（输出 7：跳过的那几章由这一次补上）。
            const since = (consolidations.at(-1) as {through: number} | undefined)?.through ?? 0;
            const outcome = await consolidate(chapter, dataset, since, candidate => compile(book, sources, drafts, [...consolidations, candidate]), run);
            problems.push(...outcome.problems);
            if (outcome.consolidation !== null) {
                consolidations = [...consolidations, outcome.consolidation];
                dataset = outcome.dataset;
                issues = outcome.issues;
            }
        }
        // 提交前的最后一道关：要提交的这份数据（本章加上整理）编译出的全部问题里没有错误，不只看本章（实现审查第 11 条）。
        const errors = issues.filter(issue => issue.level === "error");
        if (errors.length) throw new IngestBadReply("repair", `第 ${chapter} 章提交前书的数据仍有错误：${errors.map(issue => issue.message).join("；")}`);
        await ledger.settle();
        checkStop();
        const next: ExtractionData = {through: chapter, drafts, consolidations, chapters: [...data.chapters, {chapter, dropped: result.dropped, problems, recall: result.recall}]};
        const commit = await library.commitExtraction({id: store.id, title: source.title, generation, dataset, through: chapter, extraction: JSON.stringify(next)});
        markChapter(null, "committed");
        generation = commit.generation;
        data = next;
        prior = dataset;
        options.onEvent({type: "committed", chapter, total, dropped: result.dropped, generation: commit.generation, revision: commit.revision});
    }
}

/** 一章的模型调用回调：步骤与重试转成事件；每次 HTTP 尝试前后各记一行用量；每次请求之前检查停止。 */
function chapterRun(options: JobOptions, chapter: number, checkStop: () => void, ledger: Ledger): ChapterRun {
    const ids = new Map<string, string>();
    const key = (step: Step, attempt: number) => `${step}:${attempt}`;
    return {
        endpoint: options.endpoint,
        ...(options.recall ? {recallEndpoint: options.recall.endpoint} : {}),
        signal: options.signal,
        ...(options.sleep ? {sleep: options.sleep} : {}),
        ...(options.fetch ? {fetch: options.fetch} : {}),
        onStep: step => {
            checkStop();
            options.onEvent({type: "step", chapter, step});
        },
        onRetry: (step, info) => options.onEvent({type: "retry", chapter, step, attempt: info.attempt, waitMs: info.waitMs, message: info.error.message}),
        onEffortFallback: (step, info) => options.onEvent({type: "effort", chapter, step, from: info.from, to: info.to}),
        // 开始的那一行写完才发请求（callModel 等它），进程在请求中途被杀时账上一定有它。
        onAttemptStart: (step, attempt) => {
            const id = randomUUID();
            ids.set(key(step, attempt), id);
            return options.store.appendUsage({kind: "start", id, run: options.run, chapter, step, attempt, at: new Date().toISOString()});
        },
        onAttempt: (step, attempt: Attempt) => {
            const line: UsageLine = {
                kind: "end", id: ids.get(key(step, attempt.attempt)) ?? randomUUID(), run: options.run, chapter, step, attempt: attempt.attempt,
                at: new Date().toISOString(), ms: attempt.ms, input: attempt.usage.input, output: attempt.usage.output, cacheRead: attempt.usage.cacheRead,
                complete: attempt.usage.complete, error: attempt.error?.message ?? null, price: step === "recall" && options.recall ? options.recall.price : options.price,
            };
            options.onEvent({type: "usage", line});
            ledger.remember(options.store.appendUsage(line));
        },
    };
}
