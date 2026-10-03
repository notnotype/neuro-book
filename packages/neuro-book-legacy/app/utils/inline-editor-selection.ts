export type InlineEditTask =
    | "chat"
    | "rewrite"
    | "polish"
    | "expand"
    | "condense"
    | "continue_after"
    | "bridge";

export type InlineEditReferenceMatch = "unique" | "ambiguous" | "unknown";

export interface InlineEditReferenceRange {
    startLine: number;
    endLine: number;
}

export interface InlineEditReferenceTextRange {
    startOffset: number;
    endOffset: number;
}

export interface InlineEditReference {
    ref: string;
    path: string;
    range?: InlineEditReferenceRange;
    /**
     * 正文纯文本 offset 范围；为空表示只能用 text 或行号弱定位。
     */
    textRange?: InlineEditReferenceTextRange;
    match: InlineEditReferenceMatch;
    text: string;
}

export interface InlineEditPayload {
    version: 1;
    task: InlineEditTask;
    targetPath: string;
    instruction: string;
    references: InlineEditReference[];
}

export interface SelectionReferenceChip {
    raw: string;
    ref: string;
    path: string;
    range?: InlineEditReferenceRange;
    label: string;
}

export interface SelectionRangeLocation {
    match: InlineEditReferenceMatch;
    range?: InlineEditReferenceRange;
}

const BRACKETED_SELECTION_PATTERN = /^\[\[([^\]\n]+?)\]\]/u;
const SHORT_SELECTION_PATTERN = /^((?:\.?[\w@~.-][\w@~./\\-]*\/)?[\w@~.-][\w@~./\\-]*(?:\.[\w-]+)?#(?:L)?\d+(?:-(?:L)?\d+)?)(?=$|[\s,.;，。；、)）\]])/u;
const CHIP_INNER_PATTERN = /^(.+?)(?:#(?:L)?(\d+)(?:-(?:L)?(\d+))?)?$/iu;
const SHORT_SELECTION_START_BOUNDARY_PATTERN = /[\s([{"'“‘，。；、,;]/u;
const URL_AUTHORITY_SEGMENT_PATTERN = /^[a-z0-9-]+\.[a-z0-9.-]+$/iu;

/**
 * 生成 selection chip 的 canonical 文本。
 */
export function buildSelectionRefChip(input: {path: string; range?: InlineEditReferenceRange}): string {
    const path = normalizeSelectionPath(input.path);
    if (!input.range) {
        return `[[${path}]]`;
    }
    const startLine = Math.max(1, Math.floor(input.range.startLine));
    const endLine = Math.max(startLine, Math.floor(input.range.endLine));
    if (startLine === endLine) {
        return `[[${path}#L${String(startLine)}]]`;
    }
    return `[[${path}#L${String(startLine)}-L${String(endLine)}]]`;
}

/**
 * 解析 selection chip，支持双中括号 canonical 格式和短格式 path#45-67。
 */
export function parseSelectionRefChip(value: string): SelectionReferenceChip | null {
    const trimmed = value.trim();
    const bracketed = BRACKETED_SELECTION_PATTERN.exec(trimmed);
    if (bracketed?.[1]) {
        return parseSelectionChipInner(bracketed[1], bracketed[0]);
    }

    return parseShortSelectionChip(trimmed);
}

/**
 * 从一段文本当前位置读取 selection chip。
 */
export function readSelectionRefChipAt(value: string, start: number): SelectionReferenceChip | null {
    const slice = value.slice(start);
    const bracketed = BRACKETED_SELECTION_PATTERN.exec(slice);
    if (bracketed?.[1]) {
        return parseSelectionChipInner(bracketed[1], bracketed[0]);
    }

    if (!canStartShortSelection(value, start)) {
        return null;
    }
    return parseShortSelectionChip(slice);
}

/**
 * 在 Markdown 原文里定位选区行号。只有唯一命中才返回 precise range。
 */
export function locateSelectionRange(markdown: string, selectedMarkdown: string): SelectionRangeLocation {
    const needle = selectedMarkdown.trim();
    if (!needle) {
        return {match: "unknown"};
    }

    const haystack = markdown.replace(/\r\n/g, "\n");
    const normalizedNeedle = needle.replace(/\r\n/g, "\n");
    const firstIndex = haystack.indexOf(normalizedNeedle);
    if (firstIndex < 0) {
        return {match: "unknown"};
    }
    if (haystack.indexOf(normalizedNeedle, firstIndex + normalizedNeedle.length) >= 0) {
        return {match: "ambiguous"};
    }

    const before = haystack.slice(0, firstIndex);
    const startLine = before.split("\n").length;
    const lineCount = normalizedNeedle.split("\n").length;
    return {
        match: "unique",
        range: {
            startLine,
            endLine: startLine + lineCount - 1,
        },
    };
}

/**
 * 给 profile XML 渲染带行号的选区片段。没有行号时保留原文。
 */
export function formatSelectionTextWithLines(reference: InlineEditReference): string {
    if (!reference.range) {
        return reference.text;
    }
    return reference.text
        .replace(/\r\n/g, "\n")
        .split("\n")
        .map((line, index) => `L${String(reference.range!.startLine + index)} | ${line}`)
        .join("\n");
}

function parseSelectionChipInner(inner: string, raw: string): SelectionReferenceChip | null {
    const matched = CHIP_INNER_PATTERN.exec(inner.trim());
    if (!matched?.[1]) {
        return null;
    }
    const path = normalizeSelectionPath(matched[1]);
    if (!isSafeSelectionPath(path)) {
        return null;
    }

    const startLine = matched[2] ? Number(matched[2]) : null;
    const endLine = matched[3] ? Number(matched[3]) : startLine;
    const range = startLine && endLine
        ? {
            startLine: Math.max(1, Math.floor(startLine)),
            endLine: Math.max(Math.max(1, Math.floor(startLine)), Math.floor(endLine)),
        }
        : undefined;
    const ref = buildSelectionRefChip({path, range});
    return {
        raw,
        ref,
        path,
        range,
        label: range ? `${compactPathLabel(path)}:${String(range.startLine)}-${String(range.endLine)}` : compactPathLabel(path),
    };
}

/**
 * 解析无括号短格式 selection chip，并额外校验它是否像文件路径。
 */
function parseShortSelectionChip(value: string): SelectionReferenceChip | null {
    const short = SHORT_SELECTION_PATTERN.exec(value);
    if (!short?.[1]) {
        return null;
    }
    const chip = parseSelectionChipInner(short[1], short[1]);
    if (!chip || !isSafeShortSelectionPath(chip.path)) {
        return null;
    }
    return chip;
}

/**
 * 短格式没有 [[...]] 的显式边界，必须避免从普通单词或 URL 中间截出 chip。
 */
function canStartShortSelection(value: string, start: number): boolean {
    if (start <= 0) {
        return true;
    }
    if (value.slice(Math.max(0, start - 3), start) === "://") {
        return false;
    }
    return SHORT_SELECTION_START_BOUNDARY_PATTERN.test(value[start - 1] ?? "");
}

/**
 * 规范化 selection chip 内部路径。
 */
function normalizeSelectionPath(path: string): string {
    return path.trim().replace(/\\/g, "/").replace(/^\.\//u, "");
}

/**
 * 生成 chip 内展示用的短文件名。
 */
function compactPathLabel(path: string): string {
    return path.split("/").filter(Boolean).at(-1) ?? path;
}

/**
 * 拒绝绝对路径、上级目录和协议路径，避免 chip 表示越界目标。
 */
function isSafeSelectionPath(path: string): boolean {
    return Boolean(path)
        && !path.startsWith("/")
        && !path.includes("..")
        && !/\s/u.test(path)
        && !/^[a-z][a-z0-9+.-]*:/iu.test(path);
}

/**
 * 短格式必须带目录分隔符，并排除 URL host/path 形态。
 */
function isSafeShortSelectionPath(path: string): boolean {
    if (!isSafeSelectionPath(path) || !path.includes("/")) {
        return false;
    }
    const firstSegment = path.split("/").find(Boolean) ?? "";
    return !URL_AUTHORITY_SEGMENT_PATTERN.test(firstSegment);
}
