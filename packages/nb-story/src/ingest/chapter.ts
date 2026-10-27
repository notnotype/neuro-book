/**
 * 抽一章（docs/specs/story/ingest.md 输出 4、5、7、10）：（开着时）挑相关说法 → 写时间点与段落块 → 写其余记录 → 按程序
 * 开出的清单核对补漏 → 只修结构问题 → 仍修不好的记录丢弃。到了整理的章，提交前再做一次整理。
 *
 * 搬自 w00005 t29 `v2/run-v2.ts` 的单章、单份草稿路径（核对与修复各至多一轮），请求文字与处理顺序不变。不同的是：
 * - 各步的回复成不成形在这里按各步自己的形状判断（段落块步骤要有本章与段落块，草稿要有本章，核对与修复要是补丁
 *   对象），不成形的这一步重发一次，仍不成形抛 `IngestBadReply`；原管线遇到这种情况直接退出；
 * - 结构检查除了本章的问题，还算上编译出的全图错误里涉及本章记录的（原管线只看本章，漏掉跨章的时间矛盾）；
 * - 兜底丢弃之后书的数据仍有错误时，这一章不能提交，抛 `IngestBadReply`。
 *
 * 这一层不碰书库：已提交的数据与编译由调用方（job.ts）给。
 */

import type {BookFeatures, Dataset, SourceChapter} from "../core/dataset";
import type {CompileResult, Issue} from "./compile";
import {consolidationContext} from "./consolidation-context";
import {recallCandidates, renderContext} from "./context";
import {ConsolidationSchema, parseWith} from "./draft-schema";
import {applyPatch, checkDraft, dropOffending, fixBeats, fixPositions, normalizeDraft, sanitizeConsolidation, stripDisabled, type ConsolidationScope, type Problem, type RawDraft} from "./draft-tools";
import {callModel, type Attempt, type CallOptions, type IngestEffort, type ModelEndpoint, type ModelError, type ModelReply} from "./model";
import {beatsTask, consolidationPrompt, draftTask, prefixFor, reviewTask, system, systemV2, wholeConsolidationPrompt} from "./prompts";
import {llmRecaller, RECALL_LIMIT} from "./recall";
import {buildChecklist} from "./reconcile";

/** 一章里的几步；进度里显示它，用量按它记账。 */
export type Step = "recall" | "beats" | "draft" | "review" | "repair" | "consolidation";

/** 模型的回复重发一次后仍不成形，或兜底之后书的数据仍有错误（F5）。 */
export class IngestBadReply extends Error {
    readonly step: Step;

    constructor(step: Step, message: string) {
        super(message);
        this.name = "IngestBadReply";
        this.step = step;
    }
}

export interface ChapterRun {
    endpoint: ModelEndpoint;
    /** 挑相关说法用的端点；不给时不挑（默认），说法按规则缩减。 */
    recallEndpoint?: ModelEndpoint;
    signal?: AbortSignal;
    sleep?: CallOptions["sleep"];
    fetch?: CallOptions["fetch"];
    /** 每一步开始时调用。 */
    onStep?: (step: Step) => void;
    /** 每次 HTTP 尝试发出之前调用（用来记“发出过”）。 */
    onAttemptStart?: (step: Step, attempt: number) => void | Promise<void>;
    /** 每次 HTTP 尝试结束时调用（成功或失败），用来记用量。 */
    onAttempt?: (step: Step, attempt: Attempt) => void;
    onRetry?: (step: Step, info: {attempt: number; waitMs: number; error: ModelError}) => void;
    /** 端点拒绝推理档、改用邻近档位重发时调用。 */
    onEffortFallback?: (step: Step, info: {from: IngestEffort; to: IngestEffort; error: ModelError}) => void;
}

export interface ChapterInput {
    source: SourceChapter;
    /** 截至上一章已提交的数据集（含已提交的整理）；第 1 章为 null。 */
    prior: Dataset | null;
    /** 已提交的各章草稿加上候选草稿一起编译（原文只到本章），给检查用。 */
    compileWith: (candidate: RawDraft) => CompileResult;
    /** 这本书记不记数值与秘密（输出 18）；不给时都记。 */
    features?: BookFeatures;
}

/** 这一章的说法怎么选的：按规则缩减（挑选关着）、模型挑的、挑选的回复不成形退回规则、没有候选。 */
export type RecallSource = "rule" | "model" | "fallback" | "none";

export interface ChapterResult {
    draft: RawDraft;
    /** 说法怎么选的；模型挑的时 `ids` 是选中的编号，其余为空（规则缩减可以由已提交的数据重算）。 */
    recall: {source: RecallSource; ids: string[]};
    /** 留给这一章的说明（挑选退回规则）；编译出的问题另在 `remaining`。 */
    notes: string[];
    /** 每一轮核对或修复：清单与模型说不用改的条目。 */
    rounds: {step: "review" | "repair"; checklist: string[]; skipped: unknown[]}[];
    /** 兜底丢弃的记录条数。 */
    dropped: number;
    /** 提交时这一章还剩的问题（都是警告）。 */
    remaining: Issue[];
    /** 已提交的各章加上这一章编译出的数据集，与这次编译的全部问题（不只本章）。 */
    dataset: Dataset;
    issues: Issue[];
}

const MAX_REVIEWS = 1;
const MAX_REPAIRS = 1;

const chapterOfId = (id: string): number | null => {
    const match = /^[a-z](\d+)-/u.exec(id);
    return match ? Number(match[1]) : null;
};

/** 编译问题里算这一章的：本章的错误、本章“缺秘密”的提醒，以及涉及本章记录的全图错误。 */
function chapterIssues(issues: Issue[], chapter: number): Issue[] {
    return issues.filter(issue => {
        if (issue.chapter === chapter) return issue.level === "error" || issue.code === "secret-missing";
        return issue.chapter === null && issue.level === "error" && (issue.records ?? []).some(id => chapterOfId(id) === chapter);
    });
}

const asProblem = (issue: Issue): Problem => ({message: issue.message, subject: issue});

type Ask = (step: Step, systemPrompt: string, user: string, effort: IngestEffort, valid: (reply: ModelReply) => boolean, endpoint?: ModelEndpoint) => Promise<unknown>;

/** 一步的请求：渠道失败由 callModel 重发；回复不成形重发一次，仍不成形抛 `IngestBadReply`。不给端点时用抽取的。 */
function asker(run: ChapterRun, chapter: number): Ask {
    return async (step, systemPrompt, user, effort, valid, endpoint = run.endpoint) => {
        run.onStep?.(step);
        for (let round = 1; ; round++) {
            const reply = await callModel(endpoint, {
                system: systemPrompt, user, effort, signal: run.signal, sleep: run.sleep, fetch: run.fetch,
                // 请求头里的身份：章、步骤、这一步的第几次（不成形时重发算下一次；渠道重发不变）。
                tag: `${chapter}/${step}/${round}`,
                onAttemptStart: attempt => run.onAttemptStart?.(step, attempt),
                onAttempt: attempt => run.onAttempt?.(step, attempt),
                onRetry: info => run.onRetry?.(step, info),
                onEffortFallback: info => run.onEffortFallback?.(step, info),
            });
            if (reply.finishReason !== "length" && reply.json !== null && valid(reply)) return reply.json;
            if (round === 2) {
                const why = reply.finishReason === "length" ? "回复被截断" : reply.json === null ? "回复不是 JSON" : "回复缺本章的内容";
                throw new IngestBadReply(step, `第 ${chapter} 章${STEP_NAMES[step]}：${why}，重发一次后仍是这样`);
            }
        }
    };
}

export const STEP_NAMES: Record<Step, string> = {recall: "挑相关说法", beats: "写时间点与段落块", draft: "写其余记录", review: "核对补漏", repair: "修复", consolidation: "整理"};

/** 回复里本章的那一份：单章时就是回复本身，要写明本章章号（与原管线的 splitByChapter 相同）。 */
const forChapter = (json: unknown, chapter: number): Record<string, unknown> | null => {
    const list = Array.isArray((json as {chapters?: unknown})?.chapters) ? (json as {chapters: unknown[]}).chapters : [json];
    const found = list.find(item => typeof item === "object" && item !== null && (item as {chapter?: unknown}).chapter === chapter);
    return (found as Record<string, unknown> | undefined) ?? null;
};
const isObject = (json: unknown) => typeof json === "object" && json !== null && !Array.isArray(json);

export async function extractChapter(input: ChapterInput, run: ChapterRun): Promise<ChapterResult> {
    const {source, prior} = input;
    const chapter = source.chapter;
    const paragraphs = source.paragraphs;
    const ask = asker(run, chapter);
    const targets = [{chapter, paragraphs}];
    const text = paragraphs.join("\n");
    const notes: string[] = [];
    const features = input.features ?? {ledger: true, secrets: true};
    // 关掉的那几类：模型写了也在检查之前去掉（输出 18），条数累计到这一章的说明里。
    const removed = {ledger: 0, secrets: 0, secretRefs: 0, knowledge: 0};
    const strip = (candidate: RawDraft): RawDraft => {
        const result = stripDisabled(candidate, features);
        for (const key of Object.keys(removed) as (keyof typeof removed)[]) removed[key] += result.removed[key];
        return result.draft;
    };
    // 第 1 章没有已提交的记录，什么都不用选（实现审查第 6 条）。
    let recall: ChapterResult["recall"] = {source: prior && !run.recallEndpoint ? "rule" : "none", ids: []};
    let statements: string[] | undefined;
    if (prior && run.recallEndpoint) {
        const candidates = recallCandidates(prior, chapter - 1, text);
        if (!candidates.length) statements = [];
        else {
            const endpoint = run.recallEndpoint;
            const recaller = llmRecaller((systemPrompt, user, valid) => ask("recall", systemPrompt, user, "minimal", reply => valid(reply.json), endpoint));
            try {
                statements = await recaller.select({chapter, paragraphs, candidates, limit: RECALL_LIMIT});
                recall = {source: "model", ids: statements};
            } catch (error) {
                // 只有回复不成形退回规则；停止、渠道失败、记账写不进去照常往外抛，与其他步骤相同（输出 9、10）。
                if (!(error instanceof IngestBadReply)) throw error;
                recall = {source: "fallback", ids: []};
                notes.push(`${error.message}，这一章的说法按规则缩减`);
            }
        }
    }
    // 只构造一次：核对、修复与兜底丢弃都沿用同一个前缀（同一章的几次请求才可能命中缓存）。
    const prefix = prefixFor({context: prior ? renderContext(prior, chapter - 1, {text, ...(statements === undefined ? {} : {statements})}) : "", targets});
    const previousBeats = prior ? prior.beats.filter(item => item.chapter === chapter - 1).slice(-2).map(item => `${item.id}（时间点 ${item.time ?? "无"}）　${item.gist}`).join("\n") : "";

    const structureReply = await ask("beats", systemV2, prefix + beatsTask({targets, previousBeats, first: !prior}), "minimal", reply => {
        const own = forChapter(reply.json, chapter);
        return own !== null && fixBeats(Array.isArray(own.beats) ? own.beats : [], paragraphs.length).length > 0;
    });
    const structure = normalizeDraft(forChapter(structureReply, chapter), chapter);
    structure.beats = fixBeats(structure.beats ?? [], paragraphs.length);
    const structureText = JSON.stringify({times: structure.times ?? [], beats: structure.beats});

    const bodyReply = await ask("draft", systemV2, prefix + draftTask({targets, structure: structureText}, features), "medium", reply => forChapter(reply.json, chapter) !== null);
    const body = normalizeDraft(forChapter(bodyReply, chapter), chapter);
    let draft: RawDraft = strip(fixPositions({...body, chapter, times: structure.times ?? [], beats: structure.beats}, paragraphs));

    const structuralOf = (candidate: RawDraft) => {
        const checked = checkDraft(candidate);
        const issues = chapterIssues(input.compileWith(checked.clean).issues, chapter);
        return {checked, issues, problems: [...checked.problems, ...issues.map(asProblem)]};
    };
    const rounds: ChapterResult["rounds"] = [];
    const patchWith = async (step: "review" | "repair", checklist: string[]) => {
        const patch = await ask(step, systemV2, prefix + reviewTask({chapter, draft: JSON.stringify(draft), checklist}, features), "medium", reply => isObject(reply.json));
        const skip = (patch as {skip?: unknown}).skip;
        rounds.push({step, checklist, skipped: Array.isArray(skip) ? skip : []});
        // 修正里的 replace 可能把关掉的记录又加回来，每次都再去掉一遍。
        draft = strip(fixPositions(applyPatch(draft, patch, chapter), paragraphs));
    };

    // 核对补漏：清单里既有结构错误，也有对账、归属、身份问题。清单空了就不用调用。
    for (let round = 0; round < MAX_REVIEWS; round++) {
        const state = structuralOf(draft);
        const checklist = buildChecklist({draft, chapter, paragraphs, prior, structural: state.problems.map(problem => problem.message), features});
        if (!checklist.items.length) break;
        await patchWith("review", checklist.items);
    }
    // 核对之后还剩结构问题的，再给模型一次只改结构问题的机会；仍不行的记录丢弃并记账。
    let dropped = 0;
    for (let round = 0; ; round++) {
        const state = structuralOf(draft);
        if (!state.problems.length) {
            draft = state.checked.clean;
            break;
        }
        if (round >= MAX_REPAIRS) {
            const result = dropOffending(draft, candidate => {
                const next = structuralOf(candidate);
                return {clean: next.checked.clean, errors: [...next.checked.problems, ...next.issues.filter(issue => issue.level === "error").map(asProblem)]};
            });
            if (result.remaining.length) throw new IngestBadReply("repair", `第 ${chapter} 章丢弃了修不好的记录之后仍有问题：${result.remaining.map(problem => problem.message).join("；")}`);
            draft = result.clean;
            dropped = result.dropped;
            break;
        }
        await patchWith("repair", state.problems.map((problem, index) => `C${index + 1} [结构] ${problem.message}`));
    }
    const removedNote = [
        removed.ledger ? `${removed.ledger} 条数值记录` : "",
        removed.secrets ? `${removed.secrets} 个秘密` : "",
        removed.knowledge ? `${removed.knowledge} 条指向秘密的知情` : "",
        removed.secretRefs ? `${removed.secretRefs} 条说法上的秘密` : "",
    ].filter(Boolean);
    if (removedNote.length) notes.push(`按书的设置去掉了 ${removedNote.join("、")}`);
    const final = input.compileWith(draft);
    const errors = chapterIssues(final.issues, chapter).filter(issue => issue.level === "error");
    if (errors.length) throw new IngestBadReply("repair", `第 ${chapter} 章仍有错误：${errors.map(issue => issue.message).join("；")}`);
    return {draft, recall, notes, rounds, dropped, remaining: final.issues.filter(issue => issue.chapter === chapter), dataset: final.dataset, issues: final.issues};
}

/**
 * 整理（输出 7）：模型读截至本章的记忆图，输出对象合并、各方面的归纳与主线。不合格时返回 null（跳过这一次，问题记进
 * `problems`），不让这一章失败。`dataset` 是加上本章草稿后编译出的数据集；`compileWith` 加上这份整理稿再编译。
 *
 * 整理稿让整份数据出现任何错误都算不合格，不只看本章：合并对象会改动所有引用，可能让早先各章的账本累加对不上
 * （实现审查第 11 条）。合格时一并交回加上整理稿的数据集与它的全部问题；跳过时 `issues` 为空，调用方用本章的。
 */
/** 全量整理的用户消息不超过这么多字时照旧全量重写，超过时改用增量（docs/specs/story/ingest.md 输出 4）。 */
export const FULL_LIMIT = 60_000;

export async function consolidate(
    chapter: number,
    dataset: Dataset,
    since: number,
    compileWith: (consolidation: unknown) => CompileResult,
    run: ChapterRun,
    options: {fullLimit?: number} = {},
): Promise<{consolidation: unknown | null; problems: string[]; dataset: Dataset; issues: Issue[]}> {
    const ask = asker(run, chapter);
    // 先按 t12 之前的写法生成全量请求，不超过上限就用它（短书的整理与以前逐字相同）；超过时只给上一次整理以来的这一段
    // （w00024 t12）。两种都沿用原管线的系统提示词（不带 v2 的“消息的安排”），也不走本章的共用开头。
    const details = dataset.episodes.map(item => `${item.id}（${item.at.chapter}.${item.at.paragraph}）${item.title}：${item.summary}`).join("\n");
    const whole = wholeConsolidationPrompt({through: chapter, context: renderContext(dataset, chapter), details, nextArc: `a${chapter}-1`});
    let prompt = whole;
    let scope: ConsolidationScope | null = null;
    if (whole.length > (options.fullLimit ?? FULL_LIMIT)) {
        const segment = consolidationContext(dataset, chapter, since);
        prompt = consolidationPrompt({through: chapter, context: segment.text, nextArc: `a${chapter}-1`});
        scope = segment.scope;
    }
    let reply: unknown;
    try {
        reply = await ask("consolidation", system, prompt, "medium", candidate => isObject(candidate.json));
    } catch (error) {
        // 整理的回复重发一次后仍不成形：跳过这一次，不让这一章失败（输出 7）。渠道失败与停止照常往外抛。
        if (error instanceof IngestBadReply) return {consolidation: null, problems: [`${error.message}，这一次整理跳过`], dataset, issues: []};
        throw error;
    }
    const cleaned = sanitizeConsolidation(reply, chapter, dataset, scope);
    const parsed = parseWith(ConsolidationSchema, cleaned.value);
    if (!parsed.ok) return {consolidation: null, problems: [...cleaned.dropped, `整理稿格式不合格，这一次跳过：${parsed.problems[0]?.path} ${parsed.problems[0]?.message}`], dataset, issues: []};
    const compiled = compileWith(cleaned.value);
    const errors = compiled.issues.filter(issue => issue.level === "error");
    if (errors.length) return {consolidation: null, problems: [...cleaned.dropped, `整理稿带来错误，这一次跳过：${errors.map(issue => issue.message).join("；")}`], dataset, issues: []};
    return {consolidation: cleaned.value, problems: cleaned.dropped, dataset: compiled.dataset, issues: compiled.issues};
}
