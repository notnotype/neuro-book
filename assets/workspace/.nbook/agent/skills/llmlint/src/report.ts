/**
 * report：把 check + detect 的 JSON 合成一份面向用户的审稿报告。
 *
 * 纯函数核心（输入 JSON 对象 → 输出 markdown 字符串），不依赖终端与文件系统，
 * 供 CLI（skill/src/cli.ts 的 `report` 命令）与 workflow 复用。
 *
 * 报告结构：
 *   1. 统计摘要（静态命中分级 + 密度指纹 + 检测两层结论）
 *   2. 静态分级表（level × review 桶聚合，带行号样本）
 *   3. 四象限交叉（规则信号 × 检测热力）
 *   4. 语义规则提示
 *
 * 四象限语义与 SKILL.md 步骤 3 对齐：规则密集 × 文内高位 = 确认疑难；
 * 规则静默 × 文内高位 = 漏网新规则候选；规则密集 × 文内低位 = 规则与检测器分歧；
 * 规则静默 × 文内低位 = 不打扰。spread < 0.15 时四象限不适用，改用规则信号密度排序。
 */
import type {CheckJsonReport} from "./types";

/** detect JSON 中单个 chunk 的最小投影（与 cli.ts DetectFileReport 对齐，preview 为 v3.0.1+ 可选字段）。 */
export type ReportDetectChunk = {
    span: [number, number];
    line: number;
    pAi: number;
    rank: number;
    relative: number;
    preview?: string;
};

/** detect JSON 中单个文件的报告投影。 */
export type ReportDetectFile = {
    filePath: string;
    docPAi: number;
    maxPAi: number;
    spread: number;
    cached: boolean;
    chunks: ReportDetectChunk[];
};

/** detect --format json 顶层结构。 */
export type ReportDetectJson = {
    kind: "detect";
    files: ReportDetectFile[];
};

export type ReportOptions = {
    /** 四象限「规则密集」的 chunk 内命中数下限。默认 3。 */
    densityThreshold?: number;
    /** 只统计不低于该级别的命中。默认 low（全部）。 */
    minLevel?: "high" | "medium" | "low";
};

/** 整篇层（绝对）判据：docPAi 达到该值即「这篇整体可疑」。与 cli.ts DETECT_DOC_SUSPICIOUS 同源。 */
const DOC_SUSPICIOUS = 0.85;
/** 四象限有效性守门：文内 P(AI) 极差低于该值时不适用。与 cli.ts DETECT_SPREAD_FLOOR 同源。 */
const SPREAD_FLOOR = 0.15;
/** 门槛边界带半宽：spread 落在 FLOOR ± 该值内时位次只是弱证据。与 cli.ts DETECT_SPREAD_MARGIN 同源。 */
const SPREAD_MARGIN = 0.05;

const LEVEL_RANK: Record<string, number> = {high: 3, medium: 2, low: 1};

/** 四象限命中的语义标签。 */
type Quadrant = "confirm" | "leak" | "dispute" | "quiet";

/** 单个 chunk 的四象限分析结果。 */
type ChunkQuadrant = {
    chunk: ReportDetectChunk;
    hits: number;
    quadrant: Quadrant;
};

/** 截取命中文本作为样本：行号 + 前 maxChars 字。 */
function sampleFor(issue: {line: number; match?: string}, maxChars = 24): string {
    const match = issue.match ?? "";
    const trimmed = Array.from(match).slice(0, maxChars).join("");
    return `L${issue.line}:${trimmed}${Array.from(match).length > maxChars ? "…" : ""}`;
}

/** 取一行 markdown 表格的转义：竖线与换行替换为空格。 */
function cell(text: string): string {
    return text.replace(/\|/gu, "\\|").replace(/\n+/gu, " ");
}

/**
 * 按行号把 check 命中归到 detect chunk。
 *
 * chunk i 覆盖的行区间取 `[chunk.line, 下一 chunk.line)`，最后一个 chunk 延伸到 Infinity。
 * 行号落在区间的命中归属该 chunk；没有 detect 时全部命中不参与四象限，只进分级表。
 */
export function assignIssuesToChunks(
    issues: Array<{line: number}>,
    chunks: ReportDetectChunk[],
): Map<number, number> {
    const counts = new Map<number, number>();
    if (chunks.length === 0) {
        return counts;
    }
    for (const issue of issues) {
        let index = chunks.length - 1;
        for (let i = 0; i < chunks.length - 1; i++) {
            if (issue.line >= chunks[i].line && issue.line < chunks[i + 1].line) {
                index = i;
                break;
            }
        }
        counts.set(index, (counts.get(index) ?? 0) + 1);
    }
    return counts;
}

/** 计算单个 chunk 的四象限归属。 */
function quadrantOf(chunk: ReportDetectChunk, hits: number, chunkCount: number, densityThreshold: number): Quadrant {
    const tail = Math.ceil(chunkCount / 4);
    const isHigh = chunk.rank <= tail;
    const isLow = chunk.rank > chunkCount - tail;
    const dense = hits >= densityThreshold;
    const silent = hits === 0;
    if (dense && isHigh) return "confirm";
    if (silent && isHigh) return "leak";
    if (dense && isLow) return "dispute";
    return "quiet";
}

/** 组装四象限结果：按 chunk 顺序返回，只保留有信号（confirm/leak/dispute）的项。 */
function buildQuadrants(check: CheckJsonReport, detect: ReportDetectFile | null, options: ReportOptions): ChunkQuadrant[] {
    if (!detect || detect.chunks.length === 0) {
        return [];
    }
    const threshold = options.densityThreshold ?? 3;
    const counts = assignIssuesToChunks(check.issues, detect.chunks);
    const chunkCount = detect.chunks.length;
    const results: ChunkQuadrant[] = [];
    detect.chunks.forEach((chunk, index) => {
        const hits = counts.get(index) ?? 0;
        const quadrant = quadrantOf(chunk, hits, chunkCount, threshold);
        if (quadrant !== "quiet") {
            results.push({chunk, hits, quadrant});
        }
    });
    return results;
}

/** 格式化一个四象限 chunk 行：rank、行号、P(AI)、命中数、preview。 */
function formatQuadrantLine(item: ChunkQuadrant): string {
    const preview = item.chunk.preview ? `  ${cell(item.chunk.preview)}` : "";
    return `- rank ${item.chunk.rank} L${item.chunk.line} P(AI)=${item.chunk.pAi.toFixed(3)} 命中 ${item.hits} 处${preview}`;
}

/**
 * 把 check + detect JSON 合成 markdown 审稿报告。
 *
 * @param check check --format json 的解析结果（紧凑形态）。
 * @param detect detect --format json 的解析结果；传 null 时只做静态部分。
 * @param options 密度阈值与级别过滤。
 * @returns markdown 报告字符串（不以换行结尾）。
 */
export function buildReport(check: CheckJsonReport, detect: ReportDetectJson | null, options: ReportOptions = {}): string {
    const lines: string[] = [];
    const minLevel = options.minLevel ?? "low";
    const minLevelRank = LEVEL_RANK[minLevel] ?? 1;

    // 过滤命中（级别过滤；density 命中不参与级别过滤，它们本来就没有 level 语义）
    const filtered = check.issues.filter((issue) => {
        const rule = check.rules[issue.ruleId];
        return rule && (LEVEL_RANK[rule.level] ?? 1) >= minLevelRank;
    });

    // 单文件 detect 取与 check 匹配的文件；不匹配或缺失时取 files[0]（多文件场景由调用方保证对应）
    const detectFile: ReportDetectFile | null = detect && detect.files.length > 0
        ? detect.files.find((f) => f.filePath === check.filePath) ?? detect.files[0]!
        : null;

    // 1. 统计摘要
    const s = check.summary;
    lines.push("# llmlint 审稿报告");
    lines.push("");
    lines.push(`文件：\`${check.filePath}\`（${s.visibleChars} 可见字）`);
    lines.push("");
    lines.push("## 统计摘要");
    lines.push("");
    lines.push(`- 静态检查：**${filtered.length} 处命中**（high ${s.high} / medium ${s.medium} / low ${s.low}）`);
    if (check.densityIssues && check.densityIssues.length > 0) {
        for (const d of check.densityIssues) {
            lines.push(`- 密度指纹：\`${d.ruleId}\` **${d.hits} 处 / ${d.perKilo} 每千字**（样本：${d.samples.slice(0, 3).join("、")}）`);
        }
    }
    if (detectFile) {
        const docVerdict = detectFile.docPAi >= DOC_SUSPICIOUS ? "整体可疑" : "整体不判可疑";
        const spreadVerdict = detectFile.spread < SPREAD_FLOOR - SPREAD_MARGIN
            ? "四象限不适用（文内无高低差，改用规则信号密度）"
            : detectFile.spread < SPREAD_FLOOR + SPREAD_MARGIN
                ? "四象限弱适用（spread 贴近门槛，位次仅作弱证据，以规则信号为主）"
                : "四象限适用";
        lines.push(`- 神经检测：docPAi **${detectFile.docPAi.toFixed(3)}**（${docVerdict}）；spread **${detectFile.spread.toFixed(3)}**（${spreadVerdict}）`);
    } else {
        lines.push("- 神经检测：未提供 detect JSON，只有静态部分");
    }
    lines.push("");

    // 2. 静态分级表（level × review 桶聚合）
    lines.push("## 静态分级表");
    lines.push("");
    const buckets = new Map<string, Map<string, {rule: {level: string}; count: number; samples: string[]}>>();
    for (const issue of filtered) {
        const rule = check.rules[issue.ruleId];
        if (!rule) continue;
        const bucketKey = rule.review ?? "agent";
        const ruleKey = `${rule.title}（${issue.ruleId}）`;
        if (!buckets.has(bucketKey)) buckets.set(bucketKey, new Map());
        const rulesMap = buckets.get(bucketKey)!;
        if (!rulesMap.has(ruleKey)) rulesMap.set(ruleKey, {rule: {level: rule.level}, count: 0, samples: []});
        const entry = rulesMap.get(ruleKey)!;
        entry.count += 1;
        if (entry.samples.length < 3) entry.samples.push(sampleFor(issue));
    }
    if (buckets.size === 0) {
        lines.push("（无命中）");
    }
    for (const [bucket, rulesMap] of buckets) {
        lines.push(`### ${bucket} 桶`);
        lines.push("");
        lines.push("| 规则 | 级别 | 命中 | 样本 |");
        lines.push("| --- | --- | --- | --- |");
        const sorted = [...rulesMap.entries()].sort((a, b) => b[1].count - a[1].count);
        for (const [ruleKey, entry] of sorted) {
            lines.push(`| ${cell(ruleKey)} | ${entry.rule.level} | ${entry.count} | ${cell(entry.samples.join("；"))} |`);
        }
        lines.push("");
    }

    // 3. 四象限交叉
    lines.push("## 四象限交叉");
    lines.push("");
    if (!detectFile || detectFile.chunks.length === 0) {
        lines.push("（无 detect 数据，跳过）");
    } else if (detectFile.spread < SPREAD_FLOOR - SPREAD_MARGIN) {
        lines.push(`spread ${detectFile.spread.toFixed(3)} < ${SPREAD_FLOOR}：文内 P(AI) 没有可分辨的高低差，四象限不适用。整篇${detectFile.docPAi >= DOC_SUSPICIOUS ? "均匀可疑" : "均匀不疑"}，按规则信号密度排候选优先级（见下方密度排序）。`);
    } else {
        const quadrants = buildQuadrants(check, detectFile, options);
        const groups: Record<Quadrant, ChunkQuadrant[]> = {confirm: [], leak: [], dispute: [], quiet: []};
        for (const item of quadrants) groups[item.quadrant].push(item);
        if (groups.confirm.length > 0) {
            lines.push("### 规则密集 × 文内高位（确认疑难，优先读上下文）");
            lines.push("");
            for (const item of groups.confirm) lines.push(formatQuadrantLine(item));
            lines.push("");
        }
        if (groups.leak.length > 0) {
            lines.push("### 规则静默 × 文内高位（漏网新规则候选，记录观察，不直接大改）");
            lines.push("");
            for (const item of groups.leak) lines.push(formatQuadrantLine(item));
            lines.push("");
        }
        if (groups.dispute.length > 0) {
            lines.push("### 规则密集 × 文内低位（规则与检测器分歧，需人工裁决——低位不等于像人写）");
            lines.push("");
            for (const item of groups.dispute) lines.push(formatQuadrantLine(item));
            lines.push("");
        }
        if (groups.confirm.length + groups.leak.length + groups.dispute.length === 0) {
            lines.push("（无显著象限信号）");
            lines.push("");
        }
    }

    // 4. 密度排序（spread 不适用时的候选优先级；也作为四象限的补充视图）
    if (detectFile && detectFile.chunks.length > 0) {
        const counts = assignIssuesToChunks(check.issues, detectFile.chunks);
        const byDensity = detectFile.chunks
            .map((chunk, index) => ({chunk, hits: counts.get(index) ?? 0}))
            .filter((item) => item.hits > 0)
            .sort((a, b) => b.hits - a.hits || a.chunk.rank - b.chunk.rank)
            .slice(0, 8);
        if (byDensity.length > 0) {
            lines.push("### 规则信号密度排序（候选处理优先级）");
            lines.push("");
            for (const item of byDensity) {
                lines.push(formatQuadrantLine({chunk: item.chunk, hits: item.hits, quadrant: "confirm"}));
            }
            lines.push("");
        }
    }

    // 5. 语义规则提示
    lines.push("## 语义规则提示");
    lines.push("");
    lines.push("静态检查定位不到语义规则（模板化设问、过度解释、机械升华等）。执行 `llmlint rules --detector semantic` 获取判定说明与对照例，主动读全文审查。");
    lines.push("");
    lines.push("> 报告只做候选定位与交叉提示，不是修改命令。每条候选按「修 / 留 / 问」分流，先读命中前后文再动手。");

    return lines.join("\n");
}
