/*
 * PromptEditor 的文字写法（docs/specs/ui/prompt-editor.md 的“输入与前置条件”）：文字与编辑器文档之间的读入、编号与写回。
 * 文档是一行一个段落，粘贴块独占几行；行内小块保存读入时的原文，写回只用原文，保证逐字往返。
 *
 * 引用、图片与文件的写法是 Markdown 的行内链接，按 `../../../shared/link-syntax.ts` 认，与编辑器、展示器对链接的判断一致。
 */

import {fencedLines, fenceTest, findInlineLinks, unescapeMarkdown, writeInlineLink} from "../link-syntax";
import type {MarkdownTargets} from "../targets";
import {findSelections, parseSelectionText} from "./prompt-selection";
import type {PromptEditorPastePolicy, PromptEditorToken} from "./prompt-editor.types";

export const PROMPT_TOKEN_NODE = "promptToken";
export const PROMPT_PENDING_NODE = "pendingAttachment";
export const PROMPT_PASTE_BLOCK_NODE = "pasteBlock";

/** 编辑器把行内原子节点读成这个字符，用于触发匹配。 */
export const PROMPT_ATOM_CHAR = "￼";

/** 粘贴块收起时露出的行数；不超过这么多行的粘贴块不折叠。 */
export const PASTE_COLLAPSED_LINES = 3;

/** 附件条与正文标签悬停联动用的键。 */
export function numberKey(kind: "image" | "file" | "paste", number: number): string {
    return `${kind === "image" ? "image" : "file"}:${number}`;
}

export type PromptTokenKind = PromptEditorToken["kind"];

export interface PromptTokenAttrs {
    kind: PromptTokenKind;
    /** 读入时的原文；写回只用它。 */
    raw: string;
    /** 图片、文件、粘贴标签的编号；其他为 null。读入的旧图片没有编号时由编辑器补显示号。 */
    number: number | null;
    /** 引用名称、技能名、命令名、文件名、图片名称或选区显示名。 */
    label: string;
    /** 引用目标、选区路径或附件目标；没有时为空字符串。 */
    target: string;
}

/** 还没上传完的附件：不在文字里，就绪后换成图片或文件标签。 */
export interface PromptPendingAttrs {
    localId: string;
    kind: "image" | "file";
    name: string;
    number: number;
}

export interface PromptPasteBlockAttrs {
    number: number;
    content: string;
}

/** 与 TipTap 的 JSONContent 兼容的最小形状。 */
export interface PromptNodeJSON {
    type: string;
    attrs?: Record<string, unknown>;
    content?: PromptNodeJSON[];
    text?: string;
}

/** 两套编号：图片一套，文件附件与粘贴块共用另一套。 */
export type PromptNumberSet = "image" | "file";

export type PromptNumbers = Record<PromptNumberSet, number>;

export type PromptPasteTier = "inline" | "block" | "attach";

export interface PromptTriggerMatch {
    trigger: string;
    query: string;
    /** 触发字符在传入文字里的下标。 */
    offset: number;
}

export const DEFAULT_PASTE_POLICY: PromptEditorPastePolicy = {
    inlineMaxLines: 10,
    inlineMaxChars: 1000,
    attachMinLines: 100,
    attachMinChars: 20000,
    blockPlacement: "inline",
};

const PASTE_OPEN_PATTERN = /^<paste id="([1-9]\d*)">$/u;
const PASTE_CLOSE_LINE = "</paste>";
const FILE_LABEL_PATTERN = /^file #([1-9]\d*) · (.+)$/u;
const PASTE_MARKER_PATTERN = /\[paste #([1-9]\d*)\](?!\()/gu;
const IMAGE_LABEL_PATTERN = /^image #([1-9]\d*)$/u;
const SCHEME_PREFIX = /^[A-Za-z][A-Za-z0-9+.-]*:/u;
/** 旧应用认作引用的工作区路径前缀（旧版 `plain-reference-text.ts` 的 `WORKSPACE_REFERENCE_PREFIXES`）。 */
const LEGACY_WORKSPACE_PREFIXES = ["agents/", "assets/", "docs/", "lorebook/", "manuscript/", "reference/", "simulation/", "workspace/", ".agent/", ".nbook/agent/"];
const COMMAND_PATTERN = /^\/([^\s/]+)(?=\s|$)/u;
/** 中文与全角标点：中文里技能写法与触发字符前面常常不是空格，而是逗号、顿号这类标点。 */
const CJK_PUNCTUATION = "\\u3000-\\u303F\\uFF01-\\uFF0F\\uFF1A-\\uFF20\\uFF3B-\\uFF40\\uFF5B-\\uFF65\\u2018-\\u201F";
const TRIGGER_PREFIX = new RegExp(`[(${CJK_PUNCTUATION}]`, "u");
const SKILL_TOKEN_PATTERN = new RegExp(`(^|[\\s(${CJK_PUNCTUATION}])(\\$(?:([\\p{L}_-][\\p{L}\\p{N}_-]*)|\\{([\\p{L}_-][\\p{L}\\p{N}_-]*)\\}))`, "gu");

export function resolvePastePolicy(policy: Partial<PromptEditorPastePolicy> | undefined): PromptEditorPastePolicy {
    return {...DEFAULT_PASTE_POLICY, ...policy};
}

export function serializeImageToken(number: number, target: string): string {
    return writeInlineLink(`image #${number}`, target, true);
}

export function serializeFileToken(number: number, name: string, target: string): string {
    return writeInlineLink(`file #${number} · ${safeFileName(name)}`, target);
}

/**
 * 引用的写法：`@` 菜单的宿主用它拼 `insertText`。作品里的文件写以 `/` 开头的作品根地址（docs/specs/ui/prompt-editor.md 输出 3），
 * 地址含空白或括号时写成 `<地址>`；文件名里的 `%`、`#`、`?` 按宿主的 `targets.encodeFile` 百分号编码，读回仍指向同一个文件。
 * `targets` 必填，不给缺省值：缺省成不编码时，忘了传的宿主写出的文件名带 `#` 的引用读回会指向别的文件。不认文件方案的宿主传
 * `schemeTargets`。
 */
export function promptReferenceText(label: string, target: string, targets: MarkdownTargets): string {
    return writeInlineLink(label, targets.encodeFile(target));
}

export function serializePasteMarker(number: number): string {
    return `[paste #${number}]`;
}

export function serializePasteBlock(attrs: PromptPasteBlockAttrs): string {
    return `<paste id="${attrs.number}">\n${attrs.content}\n${PASTE_CLOSE_LINE}`;
}

/** 文件名写进 `[file #N · 名称](目标)` 时去掉会让写法提前结束的方括号与换行。 */
export function safeFileName(name: string): string {
    const cleaned = name.replace(/\[/gu, "(").replace(/\]/gu, ")").replace(/\s+/gu, " ").trim();
    return cleaned || "file";
}

export function imageTokenAttrs(number: number, target: string): PromptTokenAttrs {
    return {kind: "image", raw: serializeImageToken(number, target), number, label: `image #${number}`, target};
}

export function fileTokenAttrs(number: number, name: string, target: string): PromptTokenAttrs {
    return {kind: "file", raw: serializeFileToken(number, name, target), number, label: safeFileName(name), target};
}

export function pasteMarkerAttrs(number: number): PromptTokenAttrs {
    return {kind: "paste", raw: serializePasteMarker(number), number, label: "", target: ""};
}

/** 节点写回的文字；与编辑器各节点的 renderText 一致。 */
export function promptNodeText(node: PromptNodeJSON): string {
    switch (node.type) {
        case "doc":
            return (node.content ?? []).map(promptNodeText).join("\n");
        case "text":
            return node.text ?? "";
        case PROMPT_TOKEN_NODE:
            return String(node.attrs?.raw ?? "");
        case PROMPT_PENDING_NODE:
            return "";
        case PROMPT_PASTE_BLOCK_NODE:
            return serializePasteBlock(node.attrs as unknown as PromptPasteBlockAttrs);
        default:
            return (node.content ?? []).map(promptNodeText).join("");
    }
}

export interface PromptParseOptions {
    /** 正文开头显示为命令标签的命令名，不含 `/`。 */
    commands: readonly string[];
}

/** 读入整段文字：粘贴块按整行切出，其余按整段分词；没有编号的旧图片按出现顺序接着编号。 */
export function parsePromptText(text: string, options: PromptParseOptions): PromptNodeJSON {
    const segments = splitPasteBlocks(text);
    const pasteNumbers = new Set(segments.flatMap((segment) => segment.type === "paste" ? [segment.number] : []));
    const content: PromptNodeJSON[] = [];
    segments.forEach((segment, index) => {
        if (segment.type === "paste") {
            content.push(pasteBlockNode(segment.number, segment.content));
            return;
        }
        const value = segment.lines.join("\n");
        const tokens = tokenizeInline(value, {commands: options.commands, firstLine: index === 0, pasteNumbers});
        content.push(...piecesToParagraphs(sliceToPieces(value, 0, value.length, tokens)));
    });
    numberLegacyImages(content);
    return {type: "doc", content};
}

export interface PromptInsertOptions {
    commands: readonly string[];
    /** 插入点左边同一行的原文，决定技能写法前面是不是开头、空白或括号。 */
    before: string;
    /** 插入点右边同一行的原文，避免把与后文连成一体的写法切成标签。 */
    after: string;
    /** 插入点所在行是正文第一行，开头可以是命令。 */
    firstLine: boolean;
    /** 为真时识别粘贴块与位置标记，用于本编辑器复制出来的文字；外部文字只识别行内写法。 */
    structure: boolean;
}

/**
 * 读入要插入的文字，返回块列表：段落一行一个，结构模式下另有粘贴块。
 * 第一段与最后一段由调用方与插入点两侧的原文合并；跨过两侧原文的写法保持为文字。
 */
export function parsePromptInsertion(text: string, options: PromptInsertOptions): PromptNodeJSON[] {
    const segments: TextSegment[] = options.structure ? splitPasteBlocks(text) : [{type: "lines", lines: text.split("\n")}];
    const pasteNumbers = options.structure
        ? new Set(segments.flatMap((segment) => segment.type === "paste" ? [segment.number] : []))
        : null;
    const blocks: PromptNodeJSON[] = [];
    segments.forEach((segment, index) => {
        if (segment.type === "paste") {
            blocks.push(pasteBlockNode(segment.number, segment.content));
            return;
        }
        const isFirst = index === 0;
        const isLast = index === segments.length - 1;
        const before = isFirst ? options.before : "";
        const after = isLast ? options.after : "";
        const middle = segment.lines.join("\n");
        const value = before + middle + after;
        const tokens = tokenizeInline(value, {
            commands: options.commands,
            firstLine: isFirst && options.firstLine,
            pasteNumbers,
        });
        blocks.push(...piecesToParagraphs(sliceToPieces(value, before.length, before.length + middle.length, tokens)));
    });
    return blocks;
}

/** 被点击的标签交给宿主时的形状。 */
export function promptTokenFromAttrs(attrs: PromptTokenAttrs): PromptEditorToken {
    switch (attrs.kind) {
        case "reference":
            return {kind: "reference", label: attrs.label, target: attrs.target};
        case "skill":
            return {kind: "skill", name: attrs.label};
        case "selection": {
            const range = parseSelectionText(attrs.raw);
            return {kind: "selection", path: attrs.target, startLine: range?.startLine ?? null, endLine: range?.endLine ?? null};
        }
        case "command":
            return {kind: "command", name: attrs.label};
        case "image":
            return {kind: "image", number: attrs.number ?? 0, target: attrs.target || null};
        case "file":
            return {kind: "file", number: attrs.number ?? 0, name: attrs.label, target: attrs.target || null};
        case "paste":
            return {kind: "paste", number: attrs.number ?? 0};
    }
}

/** 文档里每套编号用到的最大值；未编号的旧图片不计。 */
export function maxPromptNumbers(nodes: readonly PromptNodeJSON[]): PromptNumbers {
    const result: PromptNumbers = {image: 0, file: 0};
    visitNumbered(nodes, (set, number) => {
        if (number !== null) {
            result[set] = Math.max(result[set], number);
        }
    });
    return result;
}

/** 文档里每套编号已用的号。 */
export function usedPromptNumbers(nodes: readonly PromptNodeJSON[]): Record<PromptNumberSet, Set<number>> {
    const result: Record<PromptNumberSet, Set<number>> = {image: new Set(), file: new Set()};
    visitNumbered(nodes, (set, number) => {
        if (number !== null) {
            result[set].add(number);
        }
    });
    return result;
}

/**
 * 插入内容的编号与文档里已有的撞号时换成新号，未编号的旧图片补号；粘贴块与它的位置标记一起换。
 * 新号从 `highWater`、已用号与插入内容自带的号里取最大值往上数，返回更新后的 `highWater`。
 */
export function renumberInsertion(
    nodes: readonly PromptNodeJSON[],
    used: Readonly<Record<PromptNumberSet, ReadonlySet<number>>>,
    highWater: PromptNumbers,
): {nodes: PromptNodeJSON[]; highWater: PromptNumbers} {
    const next: PromptNumbers = {...highWater};
    for (const set of ["image", "file"] as const) {
        next[set] = Math.max(next[set], ...used[set]);
    }
    visitNumbered(nodes, (set, number) => {
        if (number !== null) {
            next[set] = Math.max(next[set], number);
        }
    });
    const remap: Record<PromptNumberSet, Map<number, number>> = {image: new Map(), file: new Map()};
    const renumber = (set: PromptNumberSet, number: number | null): number => {
        if (number === null) {
            next[set] += 1;
            return next[set];
        }
        if (!used[set].has(number)) {
            return number;
        }
        const mapped = remap[set].get(number);
        if (mapped !== undefined) {
            return mapped;
        }
        next[set] += 1;
        remap[set].set(number, next[set]);
        return next[set];
    };
    const result = nodes.map((node) => mapNumbered(node, renumber));
    return {nodes: result, highWater: next};
}

/** 换掉 `\r\n` 与 `\r`；剪贴板与文件里的换行不统一。 */
export function normalizePastedText(text: string): string {
    return text.replace(/\r\n?/gu, "\n");
}

/** 粘贴块与附件里的内容：去掉末尾的一个换行，粘贴块的结束标签自己占一行。 */
export function pasteContent(text: string): string {
    return text.endsWith("\n") ? text.slice(0, -1) : text;
}

export function countPromptLines(text: string): number {
    return text === "" ? 0 : pasteContent(text).split("\n").length;
}

/** 内容里有恰好是 `</paste>` 的一行时放不进粘贴块：写回文字后粘贴块会在那里提前结束。 */
export function breaksPasteBlock(content: string): boolean {
    return content.split("\n").includes(PASTE_CLOSE_LINE);
}

/**
 * 粘贴分档。含 `</paste>` 整行的文字放不进粘贴块：能转附件就转，否则按普通文字插入。
 */
export function classifyPaste(text: string, policy: PromptEditorPastePolicy, acceptFiles: boolean): PromptPasteTier {
    const lines = countPromptLines(text);
    if (lines <= policy.inlineMaxLines && text.length <= policy.inlineMaxChars) {
        return "inline";
    }
    const breaksBlock = breaksPasteBlock(pasteContent(text));
    const large = lines >= policy.attachMinLines || text.length >= policy.attachMinChars || breaksBlock;
    if (!large) {
        return "block";
    }
    if (acceptFiles) {
        return "attach";
    }
    return breaksBlock ? "inline" : "block";
}

/**
 * 要在 `before`（光标前的文字）之后插入一个触发字符并让它生效，前面要不要先补一个空格：触发字符只在开头、空白、`(`
 * 或中文标点之后才算（见 `findPromptTrigger`），`介绍一下@` 不算。
 */
export function triggerNeedsSpace(before: string): boolean {
    const last = before.at(-1);
    return last !== undefined && !/\s/u.test(last) && !TRIGGER_PREFIX.test(last);
}

/**
 * 光标前同一行的文字里正在进行的触发：触发字符位于开头、空白之后、`(` 或中文标点之后，
 * 后面到光标为止没有空白，也没有行内标签。
 */
export function findPromptTrigger(before: string, triggers: readonly string[]): PromptTriggerMatch | null {
    if (triggers.length === 0) {
        return null;
    }
    let start = before.length;
    while (start > 0 && !/\s/u.test(before.charAt(start - 1))) {
        start -= 1;
    }
    const word = before.slice(start);
    for (let index = 0; index < word.length; index += 1) {
        const char = word.charAt(index);
        if (!triggers.includes(char) || (index > 0 && !TRIGGER_PREFIX.test(word.charAt(index - 1)))) {
            continue;
        }
        const query = word.slice(index + 1);
        return query.includes(PROMPT_ATOM_CHAR) ? null : {trigger: char, query, offset: start + index};
    }
    return null;
}

export function pasteBlockNode(number: number, content: string): PromptNodeJSON {
    return {type: PROMPT_PASTE_BLOCK_NODE, attrs: {number, content} satisfies PromptPasteBlockAttrs};
}

export function tokenNode(attrs: PromptTokenAttrs): PromptNodeJSON {
    return {type: PROMPT_TOKEN_NODE, attrs: {...attrs}};
}

type TextSegment =
    | {type: "lines"; lines: string[]}
    | {type: "paste"; number: number; content: string};

function splitPasteBlocks(text: string): TextSegment[] {
    const lines = text.split("\n");
    const segments: TextSegment[] = [];
    let pending: string[] = [];
    let index = 0;
    while (index < lines.length) {
        const open = PASTE_OPEN_PATTERN.exec(lines[index] ?? "");
        const close = open ? lines.indexOf(PASTE_CLOSE_LINE, index + 1) : -1;
        if (!open?.[1] || close < 0) {
            pending.push(lines[index] ?? "");
            index += 1;
            continue;
        }
        if (pending.length > 0) {
            segments.push({type: "lines", lines: pending});
            pending = [];
        }
        segments.push({type: "paste", number: Number(open[1]), content: lines.slice(index + 1, close).join("\n")});
        index = close + 1;
    }
    if (pending.length > 0) {
        segments.push({type: "lines", lines: pending});
    }
    return segments;
}

interface InlineContext {
    commands: readonly string[];
    /** 这段文字从正文第一行开头开始，开头可以是命令。 */
    firstLine: boolean;
    /** 能识别为位置标记的粘贴编号；null 时不识别位置标记。 */
    pasteNumbers: ReadonlySet<number> | null;
}

interface LocatedToken {
    start: number;
    end: number;
    attrs: PromptTokenAttrs;
}

/**
 * 一行文字里的写法。命令与位置标记先认，遮成占位字符，链接的词法不会把它们读成方括号；选区与链接都在遮过的文字上找。
 * 互相重叠时按旧版的规则取舍（`plain-reference-text.ts` 的 `tokenizePlainReferenceText`）：开头靠前的赢；同一个开头时命令与
 * 位置标记先于选区，选区先于链接（`[[a]](b)` 是选区）；开头落在选区里面的链接不算。跨行的写法不算。技能最后认，落在已认出的
 * 写法里面的不算。
 */
function tokenizeInline(value: string, context: InlineContext): LocatedToken[] {
    const own: LocatedToken[] = [];
    const command = context.firstLine ? COMMAND_PATTERN.exec(value) : null;
    if (command?.[1] && context.commands.includes(command[1])) {
        own.push({start: 0, end: command[0].length, attrs: {kind: "command", raw: command[0], number: null, label: command[1], target: ""}});
    }
    if (context.pasteNumbers) {
        for (const match of value.matchAll(PASTE_MARKER_PATTERN)) {
            const number = Number(match[1]);
            if (context.pasteNumbers.has(number)) {
                own.push({start: match.index, end: match.index + match[0].length, attrs: {kind: "paste", raw: match[0], number, label: "", target: ""}});
            }
        }
    }
    const masked = maskTokens(value, own);
    const selections: LocatedToken[] = findSelections(masked).map((chip) => ({start: chip.start, end: chip.end, attrs: {kind: "selection", raw: value.slice(chip.start, chip.end), number: null, label: chip.label, target: chip.path}}));
    const links: LocatedToken[] = [];
    for (const link of findInlineLinks(masked)) {
        if (selections.some((item) => link.start >= item.start && link.start < item.end)) continue;
        const attrs = linkAttrs(value.slice(link.start, link.end), link.image, link.label, link.destination);
        if (attrs !== null) links.push({start: link.start, end: link.end, attrs});
    }
    const inFence = fenceTest(value);
    const candidates = [...own, ...selections, ...links]
        .filter((token) => !token.attrs.raw.includes("\n") && !inFence(token.start))
        .map((token, rank) => ({token, rank}))
        .sort((left, right) => left.token.start - right.token.start || left.rank - right.rank);
    const located: LocatedToken[] = [];
    let cursor = 0;
    for (const {token} of candidates) {
        if (token.start < cursor) continue;
        located.push(token);
        cursor = token.end;
    }
    // 技能写法前面可以是开头、空白、括号或中文标点；链接里面的 `$` 不算。
    const skillText = maskTokens(value, located);
    for (const match of skillText.matchAll(SKILL_TOKEN_PATTERN)) {
        const start = match.index + (match[1]?.length ?? 0);
        const raw = match[2] ?? "";
        if (inFence(start)) continue;
        located.push({start, end: start + raw.length, attrs: {kind: "skill", raw, number: null, label: match[3] ?? match[4] ?? "", target: ""}});
    }
    return located.sort((left, right) => left.start - right.start);
}

function maskTokens(value: string, tokens: readonly LocatedToken[]): string {
    let masked = value;
    for (const token of tokens) {
        masked = masked.slice(0, token.start) + PROMPT_ATOM_CHAR.repeat(token.end - token.start) + masked.slice(token.end);
    }
    return masked;
}

/**
 * 一个链接是哪种小块：图片；方括号里是 `file #N · 文件名` 的是文件；其余有文字与地址的是引用。引用的地址是不带方案的相对地址时，
 * 只有旧应用的工作区路径（`LEGACY_WORKSPACE_PREFIXES`，旧草稿里的写法）算引用：Composer 没有所在文件，别的相对地址无从解析，
 * 而写代码时的 `handlers[key](event)`、`arr[0](x)` 正是这种样子。带方案的（`chapter://c1` 这类旧地址）与以 `/` 开头的作品根
 * 地址照常是引用。
 */
function linkAttrs(raw: string, image: boolean, label: string, target: string): PromptTokenAttrs | null {
    const text = unescapeMarkdown(label);
    if (image) {
        const numbered = IMAGE_LABEL_PATTERN.exec(text);
        return {kind: "image", raw, number: numbered?.[1] ? Number(numbered[1]) : null, label: text, target};
    }
    if (text === "" || target === "") return null;
    const file = FILE_LABEL_PATTERN.exec(text);
    if (file?.[1] && file[2]) return {kind: "file", raw, number: Number(file[1]), label: file[2], target};
    // 没有所在文件时，只有带方案的、以 `/` 开头的作品根地址与旧应用的工作区路径算引用；与宿主怎样归类目标无关。
    if (!SCHEME_PREFIX.test(target) && !target.startsWith("/") && !LEGACY_WORKSPACE_PREFIXES.some((prefix) => target.replace(/^\.\//u, "").startsWith(prefix))) return null;
    return {kind: "reference", raw, number: null, label: text, target};
}

/**
 * 刚输入的文字 [insertStart, insertEnd) 是否让同一行里的某个写法写完：以括号收尾的写法（引用、选区、图片、文件、`${名称}`）
 * 在输入收尾的那个字符时写完；`$名称` 与开头的命令在后面输入了不属于名称的字符时写完。
 * `line` 是整行文字，行内标签读成 PROMPT_ATOM_CHAR；含标签的写法不算。
 */
export function findCompletedWriting(
    line: string,
    insertStart: number,
    insertEnd: number,
    options: {commands: readonly string[]; firstLine: boolean},
): {start: number; end: number; attrs: PromptTokenAttrs} | null {
    if (insertEnd <= insertStart) {
        return null;
    }
    for (const token of tokenizeInline(line, {commands: options.commands, firstLine: options.firstLine, pasteNumbers: null})) {
        if (token.start >= insertStart || line.slice(token.start, token.end).includes(PROMPT_ATOM_CHAR)) {
            continue;
        }
        const openEnded = token.attrs.kind === "command" || (token.attrs.kind === "skill" && !token.attrs.raw.startsWith("${"));
        if (openEnded ? token.end === insertStart : token.end > insertStart && token.end <= insertEnd) {
            return token;
        }
    }
    return null;
}

type InlinePiece = {text: string} | {token: PromptTokenAttrs};

/** 只取完全落在 [from, to) 里的标签，其余都是文字。 */
function sliceToPieces(value: string, from: number, to: number, tokens: readonly LocatedToken[]): InlinePiece[] {
    const pieces: InlinePiece[] = [];
    let cursor = from;
    for (const token of tokens) {
        if (token.start < cursor || token.end > to) {
            continue;
        }
        if (token.start > cursor) {
            pieces.push({text: value.slice(cursor, token.start)});
        }
        pieces.push({token: token.attrs});
        cursor = token.end;
    }
    if (cursor < to) {
        pieces.push({text: value.slice(cursor, to)});
    }
    return pieces;
}

function piecesToParagraphs(pieces: readonly InlinePiece[]): PromptNodeJSON[] {
    const lines: PromptNodeJSON[][] = [[]];
    for (const piece of pieces) {
        if ("token" in piece) {
            lines.at(-1)?.push(tokenNode(piece.token));
            continue;
        }
        piece.text.split("\n").forEach((line, index) => {
            if (index > 0) {
                lines.push([]);
            }
            if (line) {
                lines.at(-1)?.push({type: "text", text: line});
            }
        });
    }
    return lines.map((content) => content.length > 0 ? {type: "paragraph", content} : {type: "paragraph"});
}

function numberLegacyImages(nodes: PromptNodeJSON[]): void {
    let next = maxPromptNumbers(nodes).image;
    const visit = (node: PromptNodeJSON): void => {
        if (node.type === PROMPT_TOKEN_NODE && node.attrs?.kind === "image" && node.attrs.number === null) {
            next += 1;
            node.attrs.number = next;
        }
        node.content?.forEach(visit);
    };
    nodes.forEach(visit);
}

function numberedOf(node: PromptNodeJSON): {set: PromptNumberSet; number: number | null} | null {
    const attrs = node.attrs;
    if (!attrs) {
        return null;
    }
    if (node.type === PROMPT_PASTE_BLOCK_NODE) {
        return {set: "file", number: attrs.number as number};
    }
    if (node.type === PROMPT_PENDING_NODE) {
        return {set: attrs.kind === "image" ? "image" : "file", number: attrs.number as number};
    }
    if (node.type === PROMPT_TOKEN_NODE && (attrs.kind === "image" || attrs.kind === "file" || attrs.kind === "paste")) {
        return {set: attrs.kind === "image" ? "image" : "file", number: attrs.number as number | null};
    }
    return null;
}

function visitNumbered(nodes: readonly PromptNodeJSON[], visit: (set: PromptNumberSet, number: number | null) => void): void {
    const walk = (node: PromptNodeJSON): void => {
        const numbered = numberedOf(node);
        if (numbered) {
            visit(numbered.set, numbered.number);
        }
        node.content?.forEach(walk);
    };
    nodes.forEach(walk);
}

function mapNumbered(node: PromptNodeJSON, renumber: (set: PromptNumberSet, number: number | null) => number): PromptNodeJSON {
    const numbered = numberedOf(node);
    const content = node.content?.map((child) => mapNumbered(child, renumber));
    if (!numbered) {
        return content ? {...node, content} : node;
    }
    const number = renumber(numbered.set, numbered.number);
    const attrs: Record<string, unknown> = {...node.attrs, number};
    if (node.type === PROMPT_TOKEN_NODE && number !== numbered.number) {
        if (attrs.kind === "file") {
            Object.assign(attrs, fileTokenAttrs(number, String(attrs.label), String(attrs.target)));
        }
        else if (attrs.kind === "paste") {
            Object.assign(attrs, pasteMarkerAttrs(number));
        }
        else if (attrs.kind === "image" && IMAGE_LABEL_PATTERN.test(String(attrs.label))) {
            Object.assign(attrs, imageTokenAttrs(number, String(attrs.target)));
        }
    }
    return {...node, attrs, ...(content ? {content} : {})};
}
