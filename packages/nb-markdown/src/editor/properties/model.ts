/**
 * frontmatter 的属性模型（docs/specs/workbench/markdown-editing.md 的“属性面板”、docs/specs/workspace/markdown-dialect.md 输出 22）：
 * 把一段 frontmatter 原文读成一行行属性，按类型编辑后交回新的原文。纯 TS，不碰编辑器与界面。
 *
 * `yaml` 只用来解析与定位：每一项在原文里的范围来自它的节点。改一项只替换这一项的那段原文，别的字节不动；不用
 * `Document.toString()` 整段写出，它会改写没动的项（块序列的缩进、长行折行、流式序列里的空格、`0x1F` 写成 31）。新值单独写出
 * 一个标量或一个序列。行以它在映射里的下标定位（键可能是数字、布尔，显示名会重），每次编辑都按下标重新解析原文。
 *
 * 文字值写出后按 YAML 1.2 与 1.1 都读回同一个字符串：别的工具（Obsidian、静态站点生成器）多按 1.1 读，`yes`、`2025-12-21`
 * 在 1.1 里是布尔与日期。是否要加引号用真实的解析器判断，不手写规则。
 */

import {isMap, isScalar, isSeq, parseDocument, Scalar} from "yaml";
import type {Document, Node as YamlNode, Pair} from "yaml";

import {isWholeFrontmatter} from "../../language/codec/source";

export type PropertyKind = "text" | "number" | "checkbox" | "date" | "list" | "complex";

/** 面板里能编辑的值；`null` 是空值，写成 `名字:`。 */
export type EditableValue =
    | {readonly kind: "text"; readonly value: string | null}
    | {readonly kind: "number"; readonly value: number | null}
    | {readonly kind: "checkbox"; readonly value: boolean}
    | {readonly kind: "date"; readonly value: string | null}
    | {readonly kind: "list"; readonly value: readonly string[]};

export type EditableKind = EditableValue["kind"];

/**
 * 宿主按属性名给的显示信息（docs/specs/workbench/markdown-editing.md 输出 60）：图标（Iconify 类名）换掉类型图标，显示名换掉属性名
 * 一列、摘要与输入的可访问名称（已是当前界面语言的字符串），类型只管值为空的行按什么输入。三项都可以没有。
 */
export type PropertyDescription = {
    readonly icon?: string;
    readonly label?: string;
    readonly kind?: EditableKind;
};

export type PropertyRow = {
    /** 在映射里的下标：编辑都按它定位。 */
    readonly index: number;
    /** 显示名：键的值转成字符串（`1:` 是 “1”）；复杂的键是它的原文。 */
    readonly name: string;
    /** 键所在的行，从 1 起、按整段 frontmatter 原文数（开栏是第 1 行）：“在源码里改”跳到这里。 */
    readonly line: number;
    /** 键是一个普通的标量，能改名。 */
    readonly renamable: boolean;
} & (EditableValue | {
    readonly kind: "complex";
    /** 值的原文（面板里只读显示）；键不是普通的标量时是整项的原文。不含末尾的换行。 */
    readonly source: string;
});

/**
 * 读不成属性的原因：`syntax` 语法错、`duplicate-key` 重复的键、`not-mapping` 顶层不是映射、`multiple-documents` 多个文档、
 * `document-marker` 有文档开始或结束标记、指令（`--- x`、`...`、`%YAML`），`flow-mapping` 顶层是写在一行里的 `{…}`。
 */
export type PropertiesProblem = "syntax" | "duplicate-key" | "not-mapping" | "multiple-documents" | "document-marker" | "flow-mapping";

export type ReadPropertiesResult =
    | {readonly ok: true; readonly rows: readonly PropertyRow[]}
    | {readonly ok: false; readonly problem: PropertiesProblem; readonly line: number; readonly detail: string};

/** 解析好的一段 frontmatter：YAML 正文是开栏与闭栏之间的部分，`offset` 是它在原文里的起点。 */
interface Parsed {
    readonly raw: string;
    readonly offset: number;
    readonly content: string;
    readonly closeStart: number;
    readonly eol: string;
    readonly doc: Document.Parsed;
}

const OPEN = /^---[ \t]*(\r\n|\n)/u;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;
const BLOCK_SCALARS = new Set<string>([Scalar.BLOCK_LITERAL, Scalar.BLOCK_FOLDED]);

function split(raw: string): Omit<Parsed, "doc"> {
    if (!isWholeFrontmatter(raw)) throw new Error("properties model: not a whole frontmatter");
    const offset = (OPEN.exec(raw) as RegExpExecArray)[0].length;
    const body = raw.replace(/(\r\n|\n)$/u, "");
    const closeStart = Math.max(offset, body.lastIndexOf("\n") + 1);
    return {raw, offset, content: raw.slice(offset, closeStart), closeStart, eol: /\r\n|\n/u.exec(raw)?.[0] ?? "\n"};
}

function parse(raw: string): Parsed {
    const parts = split(raw);
    return {...parts, doc: parseDocument(parts.content, {version: "1.2", uniqueKeys: true})};
}

/** 源码区显示的 YAML：开栏与闭栏之间的部分，换行统一成 `\n`（文字框里的换行就是 `\n`）。 */
export function yamlOf(raw: string): string {
    return split(raw).content.replace(/\r\n/gu, "\n");
}

/**
 * 源码区写回：`yaml` 换掉开栏与闭栏之间的部分，开栏、闭栏两行原样保留，换行符换回原文自己的（文字框交来的都是 `\n`）。不以换行
 * 结尾的补一个，免得最后一行与闭栏粘在一起。`yaml` 里有独占一行的 `---`（会让 frontmatter 提前结束）时为 null。
 */
export function replaceYaml(raw: string, yaml: string): string | null {
    const parts = split(raw);
    const normalized = yaml.replace(/\r\n?/gu, "\n");
    const body = normalized === "" || normalized.endsWith("\n") ? normalized : `${normalized}\n`;
    const next = raw.slice(0, parts.offset) + (parts.eol === "\n" ? body : body.replaceAll("\n", parts.eol)) + raw.slice(parts.closeStart);
    return isWholeFrontmatter(next) ? next : null;
}

/** YAML 正文里的位置所在的行，换成整段原文的行号（从 1 起，开栏是第 1 行）。 */
function lineAt(parsed: Parsed, position: number): number {
    let line = 2;
    for (let index = 0; index < position && index < parsed.content.length; index += 1) if (parsed.content.charCodeAt(index) === 10) line += 1;
    return line;
}

const sourceOf = (parsed: Parsed, node: YamlNode): string => parsed.content.slice(node.range?.[0] ?? 0, node.range?.[1] ?? 0);

/** 合格的日期 `YYYY-MM-DD`（`2025-02-30` 不算）；0001 到 9999 年都算（`Date.UTC` 会把 0 到 99 年当成 1900 年起，不用它）。 */
export function isIsoDate(value: string): boolean {
    const match = ISO_DATE.exec(value);
    if (match === null) return false;
    const date = new Date(0);
    date.setUTCFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3]);
}

/** 一个标量能不能当成可编辑的值：单行、没有锚点与标签、不是块标量。 */
function plainScalar(parsed: Parsed, node: YamlNode | null): node is Scalar {
    return isScalar(node) && node.anchor === undefined && node.tag === undefined && !BLOCK_SCALARS.has(node.type ?? "") && !/[\r\n]/u.test(sourceOf(parsed, node));
}

/** 值推断成哪一类（计划“属性模型”的推断）；推不出可编辑的类时为 null，这一行是“复杂”。 */
function valueOf(parsed: Parsed, node: YamlNode | null): EditableValue | null {
    if (node === null) return {kind: "text", value: null};
    if (node.commentBefore !== undefined) return null;
    if (isSeq(node)) {
        // 流式列表（`[…]`）的 `comment` 是行尾注释，写回只换 `[…]`，留得住；块序列的是列表后面另起的注释行，算复杂。
        if (node.anchor !== undefined || node.tag !== undefined || (node.comment !== undefined && node.flow !== true)) return null;
        const items: string[] = [];
        for (const item of node.items) {
            if (!plainScalar(parsed, item as YamlNode) || (item as Scalar).comment !== undefined || (item as Scalar).commentBefore !== undefined) return null;
            const value = (item as Scalar).value;
            if (typeof value === "string") items.push(value);
            else if ((typeof value === "number" && Number.isFinite(value)) || typeof value === "boolean") items.push(sourceOf(parsed, item as Scalar));
            else return null;
        }
        return {kind: "list", value: items};
    }
    if (!plainScalar(parsed, node)) return null;
    const value: unknown = node.value;
    if (value === null) return {kind: "text", value: null};
    if (typeof value === "boolean") return {kind: "checkbox", value};
    if (typeof value === "number") return Number.isFinite(value) ? {kind: "number", value} : null;
    if (typeof value === "string") return isIsoDate(value) ? {kind: "date", value} : {kind: "text", value};
    return null;
}

/** 键是普通的标量：不是 `? …` 写出的显式键、不是合并键 `<<`、没有锚点与标签。 */
function simpleKey(parsed: Parsed, key: YamlNode | null): key is Scalar {
    if (!plainScalar(parsed, key) || key.value === null || key.value === "<<" || typeof key.value === "object") return false;
    const lineStart = parsed.content.lastIndexOf("\n", (key.range?.[0] ?? 0) - 1) + 1;
    return !parsed.content.slice(lineStart, key.range?.[0] ?? 0).includes("?");
}

function rowOf(parsed: Parsed, pair: Pair, index: number): PropertyRow {
    const key = pair.key as YamlNode | null;
    const renamable = simpleKey(parsed, key);
    const start = key?.range?.[0] ?? 0;
    const name = renamable ? String(key.value) : key === null ? "" : sourceOf(parsed, key);
    const value = renamable ? valueOf(parsed, pair.value as YamlNode | null) : null;
    const base = {index, name, line: lineAt(parsed, start), renamable};
    if (value !== null) return {...base, ...value};
    const valueNode = pair.value as YamlNode | null;
    const end = valueNode?.range?.[1] ?? key?.range?.[1] ?? start;
    const from = renamable ? (valueNode?.range?.[0] ?? start) : start;
    return {...base, kind: "complex", source: parsed.content.slice(from, withoutEol(parsed.content, end))};
}

/** 文档开始、结束标记与指令所在的行：`--- x`（`---` 后面跟着内容，不是闭栏）、`...`、`%YAML`；没有为 null。 */
function markerLine(parsed: Parsed): number | null {
    const at = parsed.content.split("\n").findIndex((line) => /^(?:---|\.\.\.)(?:[ \t]|\r?$)|^%/u.test(line));
    return at < 0 ? null : at + 2;
}

/** 读一段 frontmatter 原文（必须是 `isWholeFrontmatter` 认可的）。空 frontmatter 与只有注释的是零行、合法。 */
export function readProperties(raw: string): ReadPropertiesResult {
    const parsed = parse(raw);
    const {doc} = parsed;
    const error = doc.errors[0];
    const errorLine = (error?.linePos?.[0].line ?? 1) + 1;
    if (error?.code === "DUPLICATE_KEY") return {ok: false, problem: "duplicate-key", line: errorLine, detail: error.message};
    if (error?.code === "MULTIPLE_DOCS") return {ok: false, problem: "multiple-documents", line: errorLine, detail: error.message};
    // 文档标记有的被 `yaml` 报成语法错（`--- a: 1`），有的不算错（`%YAML` 指令、`...`）：先按行找出来，原因说得准一些。
    const marker = markerLine(parsed);
    if (marker !== null || doc.directives.docStart === true || doc.directives.docEnd) return {ok: false, problem: "document-marker", line: marker ?? 2, detail: error?.message ?? "explicit document marker or directive"};
    if (error !== undefined) return {ok: false, problem: "syntax", line: errorLine, detail: error.message};
    const contents = doc.contents as YamlNode | null;
    if (contents === null) return {ok: true, rows: []};
    if (!isMap(contents)) return {ok: false, problem: "not-mapping", line: lineAt(parsed, contents.range?.[0] ?? 0), detail: "top level is not a mapping"};
    if (contents.flow === true) return {ok: false, problem: "flow-mapping", line: lineAt(parsed, contents.range?.[0] ?? 0), detail: "top level is a flow mapping"};
    return {ok: true, rows: contents.items.map((pair, index) => rowOf(parsed, pair, index))};
}

/** 按下标取这一项；原文读不成属性、下标不在映射里时抛出（调用方拿的是 `readProperties` 给的行，不该发生）。 */
function pairAt(raw: string, index: number): {parsed: Parsed; pair: Pair; row: PropertyRow; rows: readonly PropertyRow[]} {
    const parsed = parse(raw);
    const read = readProperties(raw);
    const contents = parsed.doc.contents as YamlNode | null;
    if (!read.ok || !isMap(contents) || contents.items[index] === undefined) throw new Error(`properties model: no property at ${String(index)}`);
    return {parsed, pair: contents.items[index], row: read.rows[index] as PropertyRow, rows: read.rows};
}

const replace = (parsed: Parsed, from: number, to: number, text: string): string =>
    parsed.raw.slice(0, parsed.offset + from) + text + parsed.raw.slice(parsed.offset + to);

/** 一段文字照字面（不加引号）放在这个位置，按 YAML 1.2 与 1.1 读回来是不是同一个字符串。 */
function readsBackPlain(text: string, place: "value" | "flow" | "key"): boolean {
    if (text === "" || text !== text.trim() || /[\r\n\t]/u.test(text) || text === "<<") return false;
    return (["1.2", "1.1"] as const).every((version) => {
        const doc = parseDocument(place === "key" ? `${text}: 0` : place === "flow" ? `k: [${text}]` : `k: ${text}`, {version});
        if (doc.errors.length > 0 || !isMap(doc.contents) || doc.contents.items.length !== 1) return false;
        const pair = doc.contents.items[0] as Pair;
        const node = (place === "key" ? pair.key : place === "flow" ? (isSeq(pair.value) && pair.value.items.length === 1 ? pair.value.items[0] : null) : pair.value) as YamlNode | null;
        return isScalar(node) && node.type === Scalar.PLAIN && node.value === text;
    });
}

/** 写出一个字符串：能照字面就照字面，否则加引号；原来是单引号的仍用单引号，双引号的仍用双引号。 */
function stringText(value: string, place: "value" | "flow" | "key", style: string | undefined): string {
    // 换行与控制字符只有双引号写得出（单引号里的换行会折成空格，控制字符别的工具读不进）。
    if (/[\u0000-\u001f\u007f-\u009f]/u.test(value)) return JSON.stringify(value);
    if (style === Scalar.QUOTE_SINGLE) return `'${value.replaceAll("'", "''")}'`;
    if (style !== Scalar.QUOTE_DOUBLE && readsBackPlain(value, place)) return value;
    return JSON.stringify(value);
}

/** 原来写着引号：空串保持写成空的引号，不变成空值。 */
const quoted = (style: string | undefined): boolean => style === Scalar.QUOTE_SINGLE || style === Scalar.QUOTE_DOUBLE;

/** 新值写成什么（单行，不含前面的空格）；空值为空串。 */
function scalarText(value: Exclude<EditableValue, {kind: "list"}>, style: string | undefined): string {
    switch (value.kind) {
        case "text":
            if (value.value === null || (value.value === "" && !quoted(style))) return "";
            return stringText(value.value, "value", style);
        case "number":
            return value.value === null ? "" : String(value.value);
        case "checkbox":
            return value.value ? "true" : "false";
        case "date":
            // 日期照字面写：按 1.1 读的工具（Obsidian）认得出它是日期；原来带引号的保留引号。
            if (value.value === null) return "";
            return quoted(style) ? stringText(value.value, "value", style) : value.value;
    }
}

/** 列表的各项：没改的项用它原来的写法（`2024` 仍是数字、`'b'` 仍带引号），新加的项写成字符串。 */
function itemTexts(parsed: Parsed, node: YamlNode | null, items: readonly string[], place: "value" | "flow"): string[] {
    const old = new Map<string, string[]>();
    if (isSeq(node)) {
        for (const item of node.items) {
            if (!isScalar(item)) continue;
            const shown = typeof item.value === "string" ? item.value : sourceOf(parsed, item);
            old.set(shown, [...(old.get(shown) ?? []), sourceOf(parsed, item)]);
        }
    }
    return items.map((item) => old.get(item)?.shift() ?? stringText(item, place, undefined));
}

/** 去掉末尾的一个换行：块序列的范围算到最后一项的行尾换行之后。 */
function withoutEol(content: string, end: number): number {
    if (content[end - 1] !== "\n") return end;
    return content[end - 2] === "\r" ? end - 2 : end - 1;
}

/**
 * 把第 `index` 项的值换成 `next`，只替换这一项的值的原文。可以换类（改类型时调用方先用 `convertKind` 算出新值）。原来是块序列的
 * 列表仍写成块序列（缩进照第一项），别的列表写成一行的 `[…]`。
 */
export function writeValue(raw: string, index: number, next: EditableValue): string {
    const {parsed, pair, row} = pairAt(raw, index);
    if (row.kind === "complex") throw new Error("properties model: complex property is not editable");
    const node = pair.value as YamlNode | null;
    const key = pair.key as Scalar;
    const colonEnd = parsed.content.indexOf(":", key.range?.[1] ?? 0) + 1;
    const style = isScalar(node) ? node.type : undefined;
    const blockSeq = isSeq(node) && node.flow !== true;
    if (next.kind === "list" && blockSeq && next.value.length > 0) {
        const start = node.range?.[0] ?? colonEnd;
        const indent = parsed.content.slice(parsed.content.lastIndexOf("\n", start - 1) + 1, start);
        return replace(parsed, start, withoutEol(parsed.content, node.range?.[1] ?? start), `- ${itemTexts(parsed, node, next.value, "value").join(`${parsed.eol}${indent}- `)}`);
    }
    const text = next.kind === "list" ? `[${itemTexts(parsed, node, next.value, "flow").join(", ")}]` : scalarText(next, style);
    // 原来没有值（`名字:`，后面可以有空白与注释）：值插在冒号之后，冒号后原有的空白与注释原样留着（`a: # 注` 写成 `a: x # 注`）。
    const empty = node === null || (node.range?.[0] ?? 0) === (node.range?.[1] ?? 0);
    if (empty) return text === "" ? raw : replace(parsed, colonEnd, colonEnd, ` ${text}`);
    // 要写成空值、或从块序列换成一行的值：从冒号之后到值的末尾整段换掉，冒号与值之间留一个空格。
    if (text === "" || blockSeq) {
        const end = blockSeq ? withoutEol(parsed.content, node.range?.[1] ?? colonEnd) : (node.range?.[1] ?? colonEnd);
        return replace(parsed, colonEnd, end, text === "" ? "" : ` ${text}`);
    }
    return replace(parsed, node.range?.[0] ?? colonEnd, node.range?.[1] ?? colonEnd, text);
}

/** 改名；新名字为空、与别的项的显示名相同、或这一项的键不能改名时为 null。 */
export function renameProperty(raw: string, index: number, name: string): string | null {
    const {parsed, pair, row, rows} = pairAt(raw, index);
    const trimmed = name.trim();
    if (!row.renamable || trimmed === "" || rows.some((other) => other.index !== index && other.name === trimmed)) return null;
    if (trimmed === row.name) return raw;
    const key = pair.key as Scalar;
    return replace(parsed, key.range?.[0] ?? 0, key.range?.[1] ?? 0, stringText(trimmed, "key", key.type));
}

/** 删掉一项：从键所在行的行首到这一项最后一行的行尾（连同行尾注释）；上方紧贴的注释留着。 */
export function removeProperty(raw: string, index: number): string {
    const {parsed, pair} = pairAt(raw, index);
    const key = pair.key as YamlNode | null;
    const value = pair.value as YamlNode | null;
    const start = parsed.content.lastIndexOf("\n", (key?.range?.[0] ?? 0) - 1) + 1;
    let end = value?.range?.[2] ?? key?.range?.[2] ?? start;
    if (end > 0 && parsed.content[end - 1] !== "\n") {
        const lineEnd = parsed.content.indexOf("\n", end);
        end = lineEnd < 0 ? parsed.content.length : lineEnd + 1;
    }
    return replace(parsed, start, end, "");
}

/** 在末尾（闭栏之前）加一行 `名字:`；名字为空或与已有的显示名相同时为 null。读不成属性的原文不能加。 */
export function addProperty(raw: string, name: string): string | null {
    const read = readProperties(raw);
    const trimmed = name.trim();
    if (!read.ok || trimmed === "" || read.rows.some((row) => row.name === trimmed)) return null;
    const parsed = split(raw);
    return raw.slice(0, parsed.closeStart) + `${stringText(trimmed, "key", undefined)}:${parsed.eol}` + raw.slice(parsed.closeStart);
}

/**
 * 改类型只做无损的（计划“属性模型”）：返回换成 `kind` 之后的值，换不了时为 null（菜单里置灰）。空值在文字、数字、日期之间随便换，
 * 值还是空的，所以读回时仍按文字推断：面板自己记着这一行选的类型。文字里的日期按日期推断，所以有值的日期换不成文字。
 */
export function convertKind(row: PropertyRow, kind: EditableKind): EditableValue | null {
    if (row.kind === "complex") return null;
    if (row.kind === kind) return row.kind === "list" ? {kind: "list", value: row.value} : ({kind: row.kind, value: row.value} as EditableValue);
    const value = row.kind === "list" || row.kind === "checkbox" ? undefined : row.value;
    if (value === null) {
        if (kind === "list") return {kind: "list", value: []};
        if (kind === "checkbox") return {kind: "checkbox", value: false};
        return {kind, value: null};
    }
    switch (`${row.kind}>${kind}`) {
        case "text>number": {
            const text = (value as string).trim();
            const number = Number(text);
            return text !== "" && Number.isFinite(number) && String(number) === text ? {kind: "number", value: number} : null;
        }
        case "number>text":
            return {kind: "text", value: String(value)};
        case "text>list":
            return {kind: "list", value: [value as string]};
        case "list>text":
            return row.kind === "list" && row.value.length <= 1 ? {kind: "text", value: row.value[0] ?? null} : null;
        case "text>checkbox":
            return value === "true" || value === "false" ? {kind: "checkbox", value: value === "true"} : null;
        case "checkbox>text":
            return row.kind === "checkbox" ? {kind: "text", value: String(row.value)} : null;
        default:
            return null;
    }
}
