/**
 * 浏览器里的写入检查（docs/specs/canon/rendering.md 输出 1、19；canon.author-ui 输出 48）：作者改的文字在发给世界服务之前，先用与内核
 * 同一份文法查一遍。富文本里改一个小块之前、源文字切回富文本之前、源文字停顿以后都用它。
 *
 * 没登记的标签（插件没装）照内核的规则放行：条目当前的主文字里已有规范写法相同的这个标签。“当前的主文字”是开始编辑时读到的那一版
 * （`baselineOf`）：被剧情改过块的条目进不了整篇编辑（输出 39），所以不必像内核那样再算补丁里的文字。
 */

import {getSchema} from "@tiptap/core";
import type {Node as PMNode} from "@tiptap/pm/model";

import {BUILTIN_TAGS, canonicalTag, checkEntryText, parseEntryText, positionOf} from "@notnotype/nb-canon/grammar";
import type {ParsedEntryText} from "@notnotype/nb-canon/grammar";
import {codecFor, coreSyntax, createMarkdownLanguage} from "@notnotype/nb-markdown/language";
import type {MarkdownCodec, SourceMap} from "@notnotype/nb-markdown/language";

import {conditionCount, entrySyntax} from "./entry-syntax";

/** 一处问题：第几行、第几列（从 1 起）与说明（内核的英文原文）。 */
export interface EntryTextProblem {
    readonly line: number;
    readonly column: number;
    readonly message: string;
}

/** 一篇文字里没登记的、自闭合的活标签的规范写法（内核 `unregisteredTags` 的同一条规则，登记表在 w00055 t04 加）。 */
export function baselineOf(source: string): ReadonlySet<string> {
    const parsed = parseEntryText(source);
    return new Set(parsed.tags.filter((tag) => tag.place === "live" && tag.kind === "self" && !BUILTIN_TAGS.has(tag.name)).map(canonicalTag));
}

/** 第一处问题；没有时为 null。读的时候栈溢出（嵌套极深的写法）也算问题：内核同样拒收（`MAX_NESTING_DEPTH`）。 */
export function entryTextProblem(source: string, baseline: ReadonlySet<string>): EntryTextProblem | null {
    let parsed: ReturnType<typeof parseEntryText>;
    try {
        parsed = parseEntryText(source);
    } catch (error) {
        if (error instanceof RangeError) return {line: 1, column: 1, message: "nested too deeply to read"};
        throw error;
    }
    for (const problem of checkEntryText(parsed)) {
        const tag = problem.tag === undefined ? undefined : parsed.tags[problem.tag];
        if (problem.excusable === true && tag !== undefined && tag.kind === "self" && baseline.has(canonicalTag(tag))) continue;
        return {...positionOf(source, problem.offset), message: problem.message};
    }
    return null;
}

/**
 * 写入前的检查（Task 计划“编辑器一侧的条目语法”）：把文档整篇写出一遍再查。编解码器写改过的块时自带读回校验（读回的节点与文档
 * 不同就写不出），所以写得出就说明改动的那一处仍读成同样的节点；再过内核的检查才算能落。
 */
export function checkedWrite(codec: MarkdownCodec, doc: PMNode, map: SourceMap, baseline: ReadonlySet<string>): {readonly ok: true; readonly text: string} | {readonly ok: false; readonly problem: EntryTextProblem | null} {
    const written = codec.write(doc, map);
    if (!written.ok) return {ok: false, problem: null};
    const problem = entryTextProblem(written.text, baseline);
    return problem === null ? {ok: true, text: written.text} : {ok: false, problem};
}

/** 内核读出的配好对的条件个数（`entryIf` 词法单元，含列表、表格、引用与条件各支里的）。 */
export function kernelConditionCount(parsed: ParsedEntryText): number {
    let count = 0;
    const walk = (tokens: ReadonlyArray<Record<string, unknown>>): void => {
        for (const token of tokens) {
            if (token.type === "entryIf") count += 1;
            for (const key of ["tokens", "items"]) if (Array.isArray(token[key])) walk(token[key] as never);
            for (const row of [(token.header as unknown[] | undefined) ?? [], ...((token.rows as unknown[][] | undefined) ?? [])]) for (const cell of row as Array<{tokens: never}>) walk(cell.tokens);
            for (const branch of (token.branches as Array<{tokens: never}> | undefined) ?? []) walk(branch.tokens);
        }
    };
    walk(parsed.tokens as never);
    return count;
}

let gate: MarkdownCodec | null = null;
/**
 * 判断用的编解码器：条目语法加核心语法、不读 frontmatter，与富文本输入框同一套节点定义（输入框另加的只是节点视图），不建编辑器。
 * 只建一份。
 */
function gateCodec(): MarkdownCodec {
    if (gate === null) {
        const language = createMarkdownLanguage([entrySyntax, coreSyntax], {frontmatter: false});
        gate = codecFor(getSchema([...language.extensions]), language);
    }
    return gate;
}

/** 一篇稿进不了富文本的原因：写得不对（第几行），或富文本成组的条件个数与内核读出的不同（不在富文本里猜）。 */
export type RichProblem = {readonly kind: "problem"; readonly problem: EntryTextProblem} | {readonly kind: "conditions"};

/**
 * 能不能用富文本编辑这一篇（canon/author-ui.md 输出 39、48）：进编辑、刷新以后恢复、从源文字切回富文本，三处都用它。能为 null。
 */
export function richProblem(source: string, baseline: ReadonlySet<string>): RichProblem | null {
    const problem = entryTextProblem(source, baseline);
    if (problem !== null) return {kind: "problem", problem};
    if (conditionCount(gateCodec().read(source).doc) !== kernelConditionCount(parseEntryText(source))) return {kind: "conditions"};
    return null;
}
