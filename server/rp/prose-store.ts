import fs from "node:fs/promises";
import path from "node:path";

/**
 * RP 模式正文读取与受控插图写回：聚合 `rp/ticks/<NNNNNN>-<slug>/prose.md`。
 *
 * rp.writer 每个 Tick 落一篇 prose.md，前端正文面板按 Tick 顺序拼成"小说式"连续阅读流。
 * 正文的唯一写入方是 agent 管线；本模块唯一的用户写入口是 insertIllustrationAfterAnchor
 * （生图插画按锚点插入图片行，不改动任何既有文字）。
 */

export const RP_TICKS_RELATIVE_PATH = "rp/ticks";

export type RpTickProse = {
    /** Tick 序号（目录名前 6 位数字）。 */
    tick: number;
    /** Tick 目录名（如 `000002-approach-glasses-girl`），前端用它做锚点定位。 */
    dir: string;
    /** 展示标题：优先取 prose.md 首个一级/二级标题，否则用目录 slug。 */
    title: string;
    /** prose.md 全文（Markdown）。 */
    content: string;
    /** prose.md 最后修改时间（epoch ms）。 */
    updatedAt: number;
};

const TICK_DIR_PATTERN = /^(\d{6})(?:-(.*))?$/u;

export type RpTickInfo = {
    tick: number;
    dir: string;
    hasProse: boolean;
    hasReport: boolean;
};

export type RpTickOverview = {
    ticks: RpTickInfo[];
    /** 已有最大 Tick 号；无任何 Tick 时为 null。 */
    maxTick: number | null;
    /** 下一个应使用的 Tick 号（max+1，从 0 起）。这是全管线的权威编号来源。 */
    nextTick: number;
};

/**
 * 权威 Tick 总账：扫描 rp/ticks/ 目录得出已有 Tick 与下一个编号。
 * Tick 编号只能从这里取，禁止各 agent 自行推算（实测出现过编号漂移与断号）。
 */
export async function listTicks(projectRoot: string): Promise<RpTickOverview> {
    const ticksRoot = path.join(projectRoot, RP_TICKS_RELATIVE_PATH);
    let entries;
    try {
        entries = await fs.readdir(ticksRoot, {withFileTypes: true});
    } catch (error) {
        if (isNotFound(error)) return {ticks: [], maxTick: null, nextTick: 0};
        throw error;
    }
    const ticks: RpTickInfo[] = [];
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const match = TICK_DIR_PATTERN.exec(entry.name);
        if (!match) continue;
        ticks.push({
            tick: Number(match[1]),
            dir: entry.name,
            hasProse: await fileExists(path.join(ticksRoot, entry.name, "prose.md")),
            hasReport: await fileExists(path.join(ticksRoot, entry.name, "report.md")),
        });
    }
    ticks.sort((left, right) => left.tick - right.tick || left.dir.localeCompare(right.dir));
    const maxTick = ticks.length ? ticks[ticks.length - 1]!.tick : null;
    return {ticks, maxTick, nextTick: maxTick === null ? 0 : maxTick + 1};
}

async function fileExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

/** 按 Tick 升序列出全部正文。ticks 目录缺失返回空；无 prose.md 的 Tick 跳过。 */
export async function listTickProse(projectRoot: string): Promise<RpTickProse[]> {
    const ticksRoot = path.join(projectRoot, RP_TICKS_RELATIVE_PATH);
    let entries;
    try {
        entries = await fs.readdir(ticksRoot, {withFileTypes: true});
    } catch (error) {
        if (isNotFound(error)) return [];
        throw error;
    }
    const items: RpTickProse[] = [];
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const match = TICK_DIR_PATTERN.exec(entry.name);
        if (!match) continue;
        const prosePath = path.join(ticksRoot, entry.name, "prose.md");
        let content: string;
        let stat;
        try {
            content = await fs.readFile(prosePath, "utf-8");
            stat = await fs.stat(prosePath);
        } catch (error) {
            if (isNotFound(error)) continue;
            throw error;
        }
        items.push({
            tick: Number(match[1]),
            dir: entry.name,
            title: extractTitle(content) ?? match[2] ?? entry.name,
            content,
            updatedAt: stat.mtimeMs,
        });
    }
    items.sort((left, right) => left.tick - right.tick || left.dir.localeCompare(right.dir));
    return items;
}

/** 取 Markdown 首个一级/二级标题作为展示标题；没有则返回 null。 */
function extractTitle(markdown: string): string | null {
    for (const line of markdown.split(/\r?\n/u)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const heading = /^#{1,2}\s+(.+)$/u.exec(trimmed);
        return heading?.[1]?.trim() ?? null;
    }
    return null;
}

function isNotFound(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && (error as {code?: string}).code === "ENOENT";
}

// ── 插图写回 ─────────────────────────────────────────────────────

export type RpInsertIllustrationInput = {
    /** rp/ticks 下的目录名；必须符合 TICK_DIR_PATTERN（防路径注入）。 */
    tickDir: string;
    /** 前端选中的渲染文本（已 trim / 截断）。 */
    anchorText: string;
    /** 锚点在该 tick 渲染文本中第 N 次出现（0-based）。 */
    occurrence: number;
    /** project root 相对图片路径。 */
    imagePath: string;
    alt: string;
    /** 锚点找不到时：none = 抛 RpAnchorNotFoundError；append = 追加到文末。 */
    fallback: "none" | "append";
};

export type RpInsertIllustrationResult = {mode: "anchored" | "appended"};

export class RpTickNotFoundError extends Error {
    constructor(tickDir: string) {
        super(`Tick 不存在或没有 prose.md：${tickDir}`);
        this.name = "RpTickNotFoundError";
    }
}

export class RpAnchorNotFoundError extends Error {
    constructor() {
        super("未能在正文中定位选中文字");
        this.name = "RpAnchorNotFoundError";
    }
}

/**
 * 在锚点文字所在段落之后插入图片行。
 *
 * 匹配策略依次降级（前端选区来自 marked 渲染 DOM，与 Markdown 源码不完全一致）：
 * 1. 源码精确匹配第 occurrence 次出现；
 * 2. 剥离 markdown 行内标记 + 忽略空白的归一化匹配（带源码偏移映射）；
 * 3. 用锚点前 30 个字符重试策略 2；
 * 4. 全部失败按 fallback 处理。
 */
export async function insertIllustrationAfterAnchor(projectRoot: string, input: RpInsertIllustrationInput): Promise<RpInsertIllustrationResult> {
    if (!TICK_DIR_PATTERN.test(input.tickDir)) {
        throw new RpTickNotFoundError(input.tickDir);
    }
    const prosePath = path.join(projectRoot, RP_TICKS_RELATIVE_PATH, input.tickDir, "prose.md");
    let content: string;
    try {
        content = await fs.readFile(prosePath, "utf-8");
    } catch (error) {
        if (isNotFound(error)) {
            throw new RpTickNotFoundError(input.tickDir);
        }
        throw error;
    }

    const imageLine = `![${sanitizeAltText(input.alt)}](${input.imagePath})`;
    const anchorEnd = locateAnchorEnd(content, input.anchorText, input.occurrence);
    if (anchorEnd === null) {
        if (input.fallback !== "append") {
            throw new RpAnchorNotFoundError();
        }
        await fs.writeFile(prosePath, `${content.replace(/\s*$/u, "")}\n\n${imageLine}\n`, "utf-8");
        return {mode: "appended"};
    }

    // 段落末尾 = 锚点结束后第一个空行（连续两个换行）之前；无空行则文末。
    const blankLine = /\n[ \t]*\n/gu;
    blankLine.lastIndex = anchorEnd;
    const paragraphBreak = blankLine.exec(content);
    const insertAt = paragraphBreak ? paragraphBreak.index : content.length;
    const before = content.slice(0, insertAt).replace(/[ \t]*$/u, "");
    const after = content.slice(insertAt);
    const next = after.length > 0
        ? `${before}\n\n${imageLine}${after}`
        : `${before}\n\n${imageLine}\n`;
    await fs.writeFile(prosePath, next, "utf-8");
    return {mode: "anchored"};
}

/** alt 文本不能包含 ] 与换行，避免破坏图片语法。 */
function sanitizeAltText(alt: string): string {
    return alt.replace(/[\r\n\]]/gu, " ").trim();
}

/**
 * 定位锚点文字在源码中的结束偏移；找不到返回 null。
 */
function locateAnchorEnd(source: string, anchorText: string, occurrence: number): number | null {
    const anchor = anchorText.trim();
    if (!anchor) {
        return null;
    }
    // 策略 1：源码精确匹配。
    const exact = nthIndexOf(source, anchor, occurrence);
    if (exact !== null) {
        return exact + anchor.length;
    }
    // 策略 2：归一化匹配（剥 markdown 行内标记 + 忽略空白）。
    const normalized = normalizedChars(source);
    const fullMatch = matchNormalized(normalized, anchor, occurrence);
    if (fullMatch !== null) {
        return fullMatch;
    }
    // 策略 3：前 30 字符重试（occurrence 语义放宽为第一次出现）。
    const prefix = anchor.slice(0, 30);
    if (prefix.length >= 8 && prefix !== anchor) {
        return matchNormalized(normalized, prefix, 0);
    }
    return null;
}

/** 查找第 n 次（0-based）出现的位置；不足 n 次返回 null。 */
function nthIndexOf(source: string, search: string, n: number): number | null {
    let index = -1;
    for (let count = 0; count <= n; count += 1) {
        index = source.indexOf(search, index + 1);
        if (index < 0) {
            return null;
        }
    }
    return index;
}

/** 归一化字符流：剥离 markdown 行内标记与全部空白，保留每个字符的源码偏移。 */
function normalizedChars(source: string): Array<{ch: string; srcIndex: number}> {
    const result: Array<{ch: string; srcIndex: number}> = [];
    let index = 0;
    let atLineStart = true;
    while (index < source.length) {
        const ch = source[index]!;
        // 行首块级标记：标题 #、引用 >、列表 - * +、有序列表数字.，连同其后空格一起跳过。
        if (atLineStart) {
            const lineMarker = /^(?:#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+|\d+\.[ \t]+)/u.exec(source.slice(index));
            if (lineMarker) {
                index += lineMarker[0].length;
                continue;
            }
        }
        atLineStart = ch === "\n";
        // 整个图片语法跳过（![alt](url)）。
        if (ch === "!" && source[index + 1] === "[") {
            const imageEnd = skipLinkLike(source, index + 1);
            if (imageEnd !== null) {
                index = imageEnd;
                continue;
            }
        }
        // 链接 [label](url)：保留 label，跳过括号部分。
        if (ch === "[") {
            index += 1;
            continue;
        }
        if (ch === "]" && source[index + 1] === "(") {
            const close = source.indexOf(")", index + 2);
            if (close >= 0) {
                index = close + 1;
                continue;
            }
        }
        // HTML 标签（如 <comment ...> / </comment>）整段跳过。
        if (ch === "<") {
            const close = source.indexOf(">", index + 1);
            if (close >= 0 && close - index <= 120) {
                index = close + 1;
                continue;
            }
        }
        // 行内标记与空白剥离。
        if (ch === "*" || ch === "_" || ch === "~" || ch === "`" || /\s/u.test(ch)) {
            index += 1;
            continue;
        }
        result.push({ch, srcIndex: index});
        index += 1;
    }
    return result;
}

/** 从 `[` 开始跳过 [..](..) 结构，返回结束后的偏移；结构不完整返回 null。 */
function skipLinkLike(source: string, bracketIndex: number): number | null {
    const closeBracket = source.indexOf("]", bracketIndex + 1);
    if (closeBracket < 0 || source[closeBracket + 1] !== "(") {
        return null;
    }
    const closeParen = source.indexOf(")", closeBracket + 2);
    return closeParen < 0 ? null : closeParen + 1;
}

/**
 * 在归一化字符流中查找第 occurrence 次出现的锚点（锚点同样剥空白），
 * 命中返回锚点最后一个字符的源码偏移 + 1。
 */
function matchNormalized(normalized: Array<{ch: string; srcIndex: number}>, anchorText: string, occurrence: number): number | null {
    const anchor = [...anchorText].filter((ch) => !/\s/u.test(ch));
    if (anchor.length === 0 || normalized.length < anchor.length) {
        return null;
    }
    let found = 0;
    for (let start = 0; start <= normalized.length - anchor.length; start += 1) {
        let matched = true;
        for (let offset = 0; offset < anchor.length; offset += 1) {
            if (normalized[start + offset]!.ch !== anchor[offset]) {
                matched = false;
                break;
            }
        }
        if (!matched) {
            continue;
        }
        if (found === occurrence) {
            return normalized[start + anchor.length - 1]!.srcIndex + 1;
        }
        found += 1;
    }
    // occurrence 越界时容错取最后一次出现（渲染文本与源码的出现次数可能不一致）。
    if (found > 0) {
        for (let start = normalized.length - anchor.length; start >= 0; start -= 1) {
            let matched = true;
            for (let offset = 0; offset < anchor.length; offset += 1) {
                if (normalized[start + offset]!.ch !== anchor[offset]) {
                    matched = false;
                    break;
                }
            }
            if (matched) {
                return normalized[start + anchor.length - 1]!.srcIndex + 1;
            }
        }
    }
    return null;
}
