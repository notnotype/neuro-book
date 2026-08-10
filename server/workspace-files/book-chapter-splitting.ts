import {TextDecoder} from "node:util";

/**
 * 书籍整本导入的共享切章逻辑（`workspace node import-book` 使用）。
 *
 * 分层设计：
 * 1. 模式库评分：内置常见章节标记模式，全书统计命中与章长分布，选最高分；
 *    置信度不足时由上层（agent workflow）触发 AI 规则发现。
 * 2. AI 结构化描述 → 正则组装：AI 只输出可解释的章节标记形态，
 *    不自由生成正则，避免误匹配与灾难回溯。
 * 3. 语义切分兜底：AI 直接输出每章起始行号（无显式标记的书稿）。
 *
 * workflow 沙盒禁止 import 本模块（见 workflow-catalog evaluate），
 * 切章的可执行入口统一收敛到 `workspace node import-book` CLI。
 */

export type ChapterSplitMode = "pattern" | "ai-description" | "split-points" | "regex";

export type ChapterSplitPart = {
    /** 1-based 章节序号（书名页/前言已剔除） */
    index: number;
    /** 章节标题（去掉标记前缀），如「重生」「第一章 重生」无标题时保留标记本身 */
    heading: string;
    /** 含标题行的整段正文 */
    text: string;
    /** 正文字数（不含标题行） */
    words: number;
};

export type ChapterSplitStats = {
    mode: ChapterSplitMode;
    /** 切出的章节总数 */
    total: number;
    /** 各章字数分布：[min, p25, median, p75, max] */
    distribution: [number, number, number, number, number];
    /** 字数异常的章节（过短 < 500 字 或 过长 > 12000 字），供用户确认时重点检查 */
    anomalies: {index: number; heading: string; words: number}[];
    /** 模式库命中的章节标记模式 key；非 pattern 模式为 null */
    patternKey: string | null;
    /** 置信度：high 可直接落盘；low 建议先人工确认或走 AI 规则发现 */
    confidence: "high" | "low";
};

export type ChapterSplitResult = {
    parts: ChapterSplitPart[];
    stats: ChapterSplitStats;
};

export type ChapterPatternDescription = {
    /** 章节标记是否独立成行（独占一行）。false 表示嵌在段落开头，极罕见 */
    lineStart: boolean;
    /** 编号前的固定词，如「第」；「Chapter 1」这类为 "Chapter" */
    prefix?: string;
    /** 编号写法 */
    numbering: "none" | "chinese" | "arabic" | "word";
    /** 编号后的固定词，如「章」「回」「节」；「Chapter 1」这类无 */
    suffix?: string;
    /** 编号与标题之间的分隔样式，如「、」「。」「 - 」；无标题时忽略 */
    separator?: string;
    /** 标题是否可缺省（只有编号没有标题的章节也成立） */
    titleOptional?: boolean;
    /** 正文前需要跳过的段落数（书名页/作品简介/前言），按空行分隔的块计数 */
    skipLeadingBlocks?: number;
};

export type ChapterSplitPoints = {
    /** 每个章节标题的起始行号（0-based） */
    startLines: number[];
    /** 正文前需要跳过的行数 */
    skipLeadingLines?: number;
};

type PatternDef = {
    key: string;
    label: string;
    regex: RegExp;
    /** 模式先验权重：越具体的模式权重越高，避免泛化模式抢分 */
    weight: number;
};

const PATTERN_LIBRARY: PatternDef[] = [
    {key: "markdown-heading", label: "Markdown 一级标题", regex: /^#\s+\S.*$/, weight: 1.2},
    {key: "chinese-chapter", label: "第X章/回/节", regex: /^第[0-9０-９一二三四五六七八九十百千万零〇两]+[章回节卷篇部].*$/, weight: 1.0},
    {key: "latin-chapter", label: "Chapter N", regex: /^(?:chapter|CHAPTER|Chapter|Part)\s+\d{1,4}.*$/, weight: 1.0},
    {key: "arabic-dot", label: "数字点标题", regex: /^\d{1,4}[、．.．]\s*\S.*$/, weight: 0.8},
    {key: "chinese-numeral", label: "中文数字标题", regex: /^[一二三四五六七八九十百]+[、．.．]\s*\S.*$/, weight: 0.8},
    // 多级 Markdown 标题只在无一级标题时可能胜出（章内小标题常见，权重压低避免误切）
    {key: "markdown-subheading", label: "Markdown 二三级标题", regex: /^#{2,3}\s+\S.*$/, weight: 0.4},
    {key: "separator", label: "分隔线", regex: /^(-{3,}|\*{3,}|_{3,})$/, weight: 0.6},
];

const MIN_CHAPTER_WORDS = 500;
const MAX_CHAPTER_WORDS = 12000;
const REASONABLE_WORD_RANGE: [number, number] = [800, 10000];

/**
 * 读取书籍源文件文本：优先 UTF-8，解码失败回退 GBK（老书常见编码）。
 * 返回文本与检测到的编码。
 */
export function decodeBookText(buffer: Buffer): {text: string; encoding: "utf-8" | "gbk"} {
    const utf8 = new TextDecoder("utf-8", {fatal: true});
    try {
        return {text: utf8.decode(buffer), encoding: "utf-8"};
    } catch {
        const gbk = new TextDecoder("gbk", {fatal: false});
        return {text: gbk.decode(buffer), encoding: "gbk"};
    }
}

/**
 * 按章节标记把整本正文切分成章。
 * 默认走模式库评分；也可显式传入 regex（逃生口）或 AI 产物。
 */
export function splitBookChapters(input: {
    text: string;
    regex?: RegExp;
    pattern?: ChapterPatternDescription;
    splitPoints?: ChapterSplitPoints;
}): ChapterSplitResult {
    if (input.splitPoints) {
        return splitByPoints(normalizeText(input.text), input.splitPoints);
    }
    if (input.pattern) {
        return splitByPattern(normalizeText(input.text), compileAiPatternRegex(input.pattern), {
            mode: "ai-description",
            skipLeadingBlocks: input.pattern.skipLeadingBlocks,
        });
    }
    if (input.regex) {
        return splitByPattern(normalizeText(input.text), input.regex, {mode: "regex"});
    }
    return splitByBestPattern(normalizeText(input.text));
}

/**
 * 模式库评分切章：对每个模式全书切分，按命中数、章长合理性与均匀度打分，选最高分。
 * 命中不足 2 章或章长明显不合理时置信度 low。
 */
function splitByBestPattern(text: string): ChapterSplitResult {
    let best: {score: number; result: ChapterSplitResult; key: string} | null = null;
    for (const pattern of PATTERN_LIBRARY) {
        const result = splitByPattern(text, pattern.regex, {mode: "pattern", patternKey: pattern.key});
        const score = scorePatternResult(result, pattern.weight);
        if (!best || score > best.score) {
            best = {score, result, key: pattern.key};
        }
    }
    if (!best) {
        return buildSplitResult([], {mode: "pattern", patternKey: null});
    }
    return best.result;
}

/**
 * 给一次切章结果打分：命中数为主，章长落在合理区间加分，章长均匀加分。
 */
function scorePatternResult(result: ChapterSplitResult, weight: number): number {
    const {parts, stats} = result;
    if (parts.length < 2) {
        return 0;
    }
    const average = averageWords(parts);
    const rangeScore = average >= REASONABLE_WORD_RANGE[0] && average <= REASONABLE_WORD_RANGE[1] ? 1 : 0.3;
    const variance = parts.length >= 4 ? varianceWords(parts) : 0;
    const uniformity = variance === 0 ? 1 : Math.max(0, 1 - Math.min(1, variance / Math.max(average, 1)));
    return parts.length * weight * (0.5 * rangeScore + 0.5 * (0.6 + 0.4 * uniformity));
}

/**
 * 按正则切分并构建结果。skipLeadingBlocks 指定跳过开头的短块（书名页/前言）。
 */
function splitByPattern(
    text: string,
    regex: RegExp,
    options: {mode: ChapterSplitMode; patternKey?: string | null; skipLeadingBlocks?: number},
): ChapterSplitResult {
    const normalized = text.replace(/\r\n/gu, "\n");
    const lines = normalized.split("\n");
    const startIndexes: number[] = [];
    const globalRegex = new RegExp(regex.source, regex.flags.includes("m") ? regex.flags : `${regex.flags}m`);
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        if (globalRegex.test(lines[lineIndex] ?? "")) {
            startIndexes.push(lineIndex);
        }
    }

    const blocks = splitLinesIntoParts(lines, startIndexes);
    const skip = Math.max(0, options.skipLeadingBlocks ?? 0);
    const consumed = blocks.slice(skip);
    const filtered = dropTitlePage(consumed);
    const parts = filtered.map((block, index) => buildPart(block, index));
    return buildSplitResult(parts, options);
}

/**
 * 按 AI 给出的章节起始行号切分。skipLeadingLines 先按行跳过书名页/前言。
 */
function splitByPoints(text: string, points: ChapterSplitPoints): ChapterSplitResult {
    const lines = text.replace(/\r\n/gu, "\n").split("\n");
    const skip = Math.max(0, points.skipLeadingLines ?? 0);
    const bodyLines = skip > 0 ? lines.slice(Math.min(skip, lines.length)) : lines;
    const validPoints = (points.startLines ?? [])
        .map((line) => Math.floor(Number(line)) - skip)
        .filter((line) => Number.isFinite(line) && line >= 0 && line < bodyLines.length)
        .sort((left, right) => left - right)
        .filter((line, index, list) => index === 0 || line !== list[index - 1]);
    const blocks = splitLinesIntoParts(bodyLines, validPoints);
    const filtered = dropTitlePage(blocks.filter((block) => block.trim().length > 0));
    const parts = filtered.map((block, index) => buildPart(block, index));
    return buildSplitResult(parts, {mode: "split-points"});
}

/**
 * 剔除过短的首页块（书名页/作者的话等）：正文不足 50 字且不止一块时丢弃。
 * 与 book-deconstruct 的书名页判定口径一致，避免把书名页切成一章。
 */
function dropTitlePage(blocks: string[]): string[] {
    if (blocks.length <= 1) {
        return blocks;
    }
    const first = blocks[0] ?? "";
    if (first.replace(/\s/gu, "").length < 50) {
        return blocks.slice(1);
    }
    return blocks;
}

/**
 * 把行数组按起始行号切分成块；无任何起始行时整篇作为一块。
 */
function splitLinesIntoParts(lines: string[], startIndexes: number[]): string[] {
    if (startIndexes.length === 0) {
        return [lines.join("\n")];
    }
    const blocks: string[] = [];
    for (let index = 0; index < startIndexes.length; index++) {
        const start = startIndexes[index] ?? 0;
        const end = startIndexes[index + 1] ?? lines.length;
        const block = lines.slice(start, end).join("\n");
        if (block.trim().length > 0) {
            blocks.push(block);
        }
    }
    return blocks;
}

/**
 * 从章节块构建 part：标题取块首行并去掉 Markdown 标记，字数按正文（去掉标题行）统计。
 */
function buildPart(block: string, index: number): ChapterSplitPart {
    const lines = block.split("\n");
    const headingLine = (lines[0] ?? "").trim();
    const heading = headingLine.replace(/^#+\s*/u, "").trim();
    const body = lines.slice(1).join("\n");
    return {
        index: index + 1,
        heading: heading || `第 ${index + 1} 章`,
        text: block,
        words: body.replace(/\s/gu, "").length,
    };
}

/**
 * 构建切章结果与统计。
 */
function buildSplitResult(
    parts: ChapterSplitPart[],
    options: {mode: ChapterSplitMode; patternKey?: string | null},
): ChapterSplitResult {
    const stats: ChapterSplitStats = {
        mode: options.mode,
        total: parts.length,
        distribution: distributionOf(parts),
        anomalies: parts
            .filter((part) => part.words < MIN_CHAPTER_WORDS || part.words > MAX_CHAPTER_WORDS)
            .map((part) => ({index: part.index, heading: part.heading, words: part.words})),
        patternKey: options.patternKey ?? null,
        confidence: confidenceOfParts(parts),
    };
    return {parts, stats};
}

/**
 * 置信度判定：至少 2 章且平均章长落在合理区间为 high。
 */
function confidenceOfParts(parts: ChapterSplitPart[]): "high" | "low" {
    if (parts.length < 2) {
        return "low";
    }
    const average = averageWords(parts);
    return average >= REASONABLE_WORD_RANGE[0] && average <= REASONABLE_WORD_RANGE[1] ? "high" : "low";
}

/**
 * 从 AI 结构化描述组装可执行的章节标记正则。
 * 形态为 `prefix + numbering + suffix + separator + title`：
 * 「第1章 标题」→ prefix=第, numbering=arabic, suffix=章；
 * 「Chapter 1」→ prefix=Chapter, numbering=arabic, suffix 无。
 */
export function compileAiPatternRegex(pattern: ChapterPatternDescription): RegExp {
    const prefix = pattern.prefix ? escapeRegExp(pattern.prefix) : "";
    const numbering = compileNumberingPattern(pattern.numbering);
    const suffix = pattern.suffix ? escapeRegExp(pattern.suffix) : "";
    const separator = pattern.separator ? escapeRegExp(pattern.separator) : "";
    const title = pattern.titleOptional ? ".*" : "\\s*\\S.*";
    // 元素间允许可选空白：「第1回」「Chapter 1」「第 1 章」都成立
    return new RegExp(`^${prefix}\\s*${numbering}\\s*${suffix}${separator}${title}$`, "m");
}

function compileNumberingPattern(numbering: ChapterPatternDescription["numbering"]): string {
    switch (numbering) {
        case "none":
            return "";
        case "chinese":
            return "[0-9０-９一二三四五六七八九十百千万零〇两]+";
        case "arabic":
            return "[0-9０-９]+";
        case "word":
            return "[a-zA-Z]+";
    }
}

/**
 * 归一化正文：统一换行，去 BOM。
 */
function normalizeText(text: string): string {
    return text.replace(/^\uFEFF/, "").replace(/\r\n/gu, "\n");
}

function averageWords(parts: ChapterSplitPart[]): number {
    if (parts.length === 0) {
        return 0;
    }
    return parts.reduce((sum, part) => sum + part.words, 0) / parts.length;
}

function varianceWords(parts: ChapterSplitPart[]): number {
    const average = averageWords(parts);
    return parts.reduce((sum, part) => sum + (part.words - average) ** 2, 0) / parts.length;
}

function distributionOf(parts: ChapterSplitPart[]): [number, number, number, number, number] {
    if (parts.length === 0) {
        return [0, 0, 0, 0, 0];
    }
    const sorted = parts.map((part) => part.words).sort((left, right) => left - right);
    const percentile = (ratio: number): number => {
        const position = Math.min(sorted.length - 1, Math.floor(ratio * sorted.length));
        return sorted[position] ?? 0;
    };
    return [
        sorted[0] ?? 0,
        percentile(0.25),
        percentile(0.5),
        percentile(0.75),
        sorted[sorted.length - 1] ?? 0,
    ];
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
