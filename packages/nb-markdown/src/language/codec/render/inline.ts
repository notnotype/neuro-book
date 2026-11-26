/**
 * 行内内容的写出（docs/specs/workspace/markdown-dialect.md 输出 2、4、5）：一个文本块里的文字、行内节点与标记。
 *
 * 标记的开闭（`layout`）：相邻两个节点的标记集合不同时，先关掉不再延续的（从里往外），再开新的。延续的标记排在前面、新开的
 * 按 schema 的优先级排，这样一个标记在它覆盖的那一段里尽量只开一次，标签自然嵌套（两条重叠的批注在边界处拆成截）。
 *
 * 强调类标记（`emphasis`）两端的空白移到标记外面写：`** a**` 读不成粗体。写出前先对整段内容做 `../compare.ts` 的 `expel`，
 * 比较前也做同样的处理，两边按同一个规则。
 */

import type {Mark, Node as PMNode, Schema} from "@tiptap/pm/model";

import {bridge, expel, flatten, withoutStyles} from "../compare";
import type {InlineItem} from "../compare";

import type {InlinePlace, InlineWriter, MarkRun, MarkWriter, WriteContext} from "../../syntax/types";
import {Unrepresentable} from "../../syntax/types";
import {escapeText} from "./escape";

export interface InlineWriters {
    readonly inline: ReadonlyMap<string, InlineWriter>;
    readonly marks: ReadonlyMap<string, MarkWriter>;
    readonly markless: ReadonlySet<string>;
    readonly textOnly: ReadonlySet<string>;
}

/**
 * 新建的标记没有写法属性：它紧挨着同类、其余属性相同的标记时跟随那个标记（方言 Spec 输出 2 的“跟随”），两段合成一段写，
 * 否则 `**说****了**` 读不回来。
 */
export function follow(items: InlineItem[]): void {
    const sameExceptStyle = (left: Mark, right: Mark): boolean => left.type === right.type && Object.keys(left.attrs).every((key) => key === "markdown" || left.attrs[key] === right.attrs[key]);
    // 不挨着时跟随同一块里第一个同类、写法已定的标记（`__a__ b` 里给 b 加粗写成 `__b__`）：先从左到右、从右到左按相邻跟随，
    // 剩下的再按同块跟随。
    const styled = new Map<string, Mark>();
    for (const item of items) for (const mark of item.marks) if (mark.attrs.markdown !== null && mark.attrs.markdown !== undefined && !styled.has(mark.type.name)) styled.set(mark.type.name, mark);
    for (const direction of [1, -1] as const) {
        const order = direction === 1 ? items.keys() : [...items.keys()].reverse();
        for (const index of order) {
            const item = items[index] as InlineItem;
            const neighbour = items[index - direction];
            if (neighbour === undefined) continue;
            item.marks = item.marks.map((mark) => {
                if (mark.attrs.markdown !== null && mark.attrs.markdown !== undefined) return mark;
                return neighbour.marks.find((other) => other !== mark && sameExceptStyle(mark, other) && other.attrs.markdown !== null) ?? mark;
            });
        }
    }
    for (const item of items) {
        item.marks = item.marks.map((mark) => {
            if (mark.attrs.markdown !== null || !("markdown" in mark.attrs)) return mark;
            const model = styled.get(mark.type.name);
            return model === undefined || Object.keys(mark.attrs).some((key) => key !== "markdown" && mark.attrs[key] !== model.attrs[key]) ? mark : mark.type.create({...mark.attrs, markdown: model.attrs.markdown});
        });
    }
}

/**
 * 整理过的行内内容（硬换行取两边共有的标记、规范写法去写法属性、跟随、强调两端的空白，规则都在 `../compare.ts`）：文字按标记
 * 重新分段，行内节点照旧。
 */
function normalized(parent: PMNode, emphasis: ReadonlySet<string>, markless: ReadonlySet<string>, textOnly: ReadonlySet<string>, canonical: boolean): PMNode[] {
    const items = flatten(parent, markless, textOnly);
    bridge(items, markless, textOnly);
    if (canonical) withoutStyles(items);
    follow(items);
    expel(items, emphasis, markless);
    const schema: Schema = parent.type.schema;
    const out: PMNode[] = [];
    let text = "";
    let marks: ReadonlyArray<Mark> | null = null;
    const push = (): void => {
        if (text !== "" && marks !== null) out.push(schema.text(text, marks as Mark[]));
        text = "";
        marks = null;
    };
    for (const item of items) {
        if (item.char === null) {
            push();
            out.push((item.node as PMNode).mark(item.marks as Mark[]));
            continue;
        }
        if (marks !== null && !(marks.length === item.marks.length && marks.every((mark) => mark.isInSet(item.marks)))) push();
        marks ??= item.marks;
        text += item.char;
    }
    push();
    return out;
}

/**
 * 这个节点要用的标记顺序：已经开着的、它也带的排前面（保持开着的先后），其余按 schema 的优先级。只盖文字的标记（注音、
 * 行内代码）排在最后：它的里面只能是文字，别的标记要在它里面开时，它先关上、在里面重开。
 */
function ordered(marks: ReadonlyArray<Mark>, active: ReadonlyArray<Mark>, textOnly: ReadonlySet<string>): Mark[] {
    const inner = (mark: Mark): boolean => textOnly.has(mark.type.name);
    const kept = active.filter((mark) => mark.isInSet(marks) && !inner(mark));
    const fresh = marks.filter((mark) => !mark.isInSet(kept) && !inner(mark)).sort((left, right) => (left.type as unknown as {rank: number}).rank - (right.type as unknown as {rank: number}).rank);
    return [...kept, ...fresh, ...active.filter((mark) => mark.isInSet(marks) && inner(mark)), ...marks.filter((mark) => inner(mark) && !mark.isInSet(active))];
}

/** 一次开标签到闭标签：从第几个子节点到第几个（含），写法拿到的 `MarkRun` 就是它。 */
interface Run extends MarkRun {
    readonly mark: Mark;
    readonly start: number;
    end: number;
}

/**
 * 标记的开闭安排：相邻两个节点的标记集合不同时，先关掉不再延续的（从里往外），再开新的（顺序见 `ordered`）。返回每个子节点
 * 前要关的与要开的，以及每一次开闭的范围、文字与起点。
 */
function layout(parent: PMNode, children: ReadonlyArray<PMNode>, textOnly: ReadonlySet<string>, markless: ReadonlySet<string>): {readonly closes: Run[][]; readonly opens: Run[][]; readonly active: Run[][]; readonly tail: Run[]} {
    const runs: Run[] = [];
    const closes: Run[][] = [];
    const opens: Run[][] = [];
    const activeAt: Run[][] = [];
    let active: Run[] = [];
    let offset = 0;
    children.forEach((child, index) => {
        let wanted = ordered(child.marks, active.map((run) => run.mark), textOnly);
        let common = 0;
        while (common < active.length && common < wanted.length && (active[common] as Run).mark.eq(wanted[common] as Mark)) common += 1;
        // 硬换行处只延续开着的标记，不新开：新开的标签会落在行尾（宽容写法会把行尾的块级方言开标签拆开），推到换行之后再开。
        if (markless.has(child.type.name)) wanted = wanted.slice(0, common);
        const closing = active.slice(common).reverse();
        for (const run of closing) run.end = index - 1;
        const opening = wanted.slice(common).map((mark): Run => ({mark, start: index, end: children.length - 1, offset, parent, text: ""}));
        runs.push(...opening);
        closes.push(closing);
        opens.push(opening);
        active = [...active.slice(0, common), ...opening];
        activeAt.push(active);
        offset += child.isText ? (child.text as string).length : 1;
    });
    for (const run of runs) {
        (run as {text: string}).text = children.slice(run.start, run.end + 1).map((child) => (child.isText ? (child.text as string) : "")).join("");
    }
    return {closes, opens, active: activeAt, tail: [...active].reverse()};
}

/** 按文本块节点缓存的开闭安排（节点不可变，没编辑的段落每次写回都命中）：两种写法各一份。 */
const openingCache = new WeakMap<PMNode, Map<boolean, ReadonlyArray<{readonly mark: Mark; readonly offset: number}>>>();

/**
 * 一个文本块里各个标记开标签的位置（按写出的顺序），与写出时一样整理与安排。写前准备用它数一条批注会写成几段、哪一段是
 * 第一段；`canonical` 是降级到规范写法时的安排。
 */
export function openings(parent: PMNode, writers: InlineWriters, canonical: boolean): ReadonlyArray<{readonly mark: Mark; readonly offset: number}> {
    let cached = openingCache.get(parent);
    if (cached === undefined) {
        cached = new Map();
        openingCache.set(parent, cached);
    }
    let result = cached.get(canonical);
    if (result === undefined) {
        const emphasis = new Set([...writers.marks].filter(([, writer]) => writer.emphasis === true).map(([type]) => type));
        const children = normalized(parent, emphasis, writers.markless, writers.textOnly, canonical);
        result = layout(parent, children, writers.textOnly, writers.markless).opens.flat().map((run) => ({mark: run.mark, offset: run.offset}));
        cached.set(canonical, result);
    }
    return result;
}

export function renderInline(parent: PMNode, context: WriteContext, place: InlinePlace, writers: InlineWriters): string {
    const emphasis = new Set([...writers.marks].filter(([, writer]) => writer.emphasis === true).map(([type]) => type));
    const children = normalized(parent, emphasis, writers.markless, writers.textOnly, context.options.styles === "canonical");
    const plan = layout(parent, children, writers.textOnly, writers.markless);
    const out: string[] = [];
    const last = (): string => {
        for (let index = out.length - 1; index >= 0; index -= 1) {
            const piece = out[index] as string;
            if (piece !== "") return piece[piece.length - 1] as string;
        }
        return "";
    };
    // GFM 表格先按没转义的 `|` 切单元格（标签与行内节点的原文里的也算），再解析单元格的内容：表格里这些输出的 `|` 都写成
    // `\|`（切单元格时去掉反斜杠）。正文文字的 `|` 由 `escapeText` 转义。
    // 原子里的 `|` 不切单元格（分词时原子换成了占位），不转义：转义了就改了原子的原文（例如条目标签属性里的 `||`）。
    const cell = (output: string): string => {
        if (place.table !== true) return output;
        const atoms = context.atomSpans?.(output) ?? [];
        return output.replace(/(?<!\\)\|/gu, (pipe, at: number) => (atoms.some((atom) => at >= atom.from && at < atom.to) ? pipe : "\\|"));
    };
    const writerOf = (mark: Mark): MarkWriter => {
        const writer = writers.marks.get(mark.type.name);
        if (writer === undefined) throw new Unrepresentable(`没有 ${mark.type.name} 标记的写法`);
        return writer;
    };
    // 行内节点的写法：文字的转义要看紧随其后写出的第一个字（例如表情写法开头的冒号与文字末尾的 `:名字` 配成写法），所以写文字
    // 之前可能先写出下一个节点，结果按位置记下，轮到它时直接用。
    const written = new Map<number, string>();
    const writeNode = (index: number): string => {
        let output = written.get(index);
        if (output === undefined) {
            const child = children[index] as PMNode;
            const writer = writers.inline.get(child.type.name);
            if (writer === undefined) throw new Unrepresentable(`没有 ${child.type.name} 的写法`);
            const previous = index === 0 ? null : (children[index - 1] as PMNode);
            const next = index === children.length - 1 ? null : (children[index + 1] as PMNode);
            output = writer(child, context, {previous, next, place});
            written.set(index, output);
        }
        return output;
    };
    children.forEach((child, index) => {
        const next = index === children.length - 1 ? null : (children[index + 1] as PMNode);
        for (const run of plan.closes[index] as Run[]) out.push(cell(writerOf(run.mark).close(run.mark, context, run)));
        for (const run of plan.opens[index] as Run[]) out.push(cell(writerOf(run.mark).open(run.mark, context, run)));
        if (!child.isText) {
            out.push(cell(writeNode(index)));
            return;
        }
        const content = child.text as string;
        if ((plan.active[index] as Run[]).some((run) => writerOf(run.mark).verbatim?.(run.mark, context, run) === true)) {
            // GFM 表格先按没转义的 `|` 切单元格，再解析行内内容：行内代码里的 `|` 也要转义。
            out.push(place.table === true ? content.replace(/\|/gu, "\\|") : content);
            return;
        }
        const lineEnd = next === null || next.type.name === "hardBreak";
        const after = next === null ? "" : next.isText ? ((next.text as string)[0] as string) : next.type.name === "hardBreak" ? "\n" : (writeNode(index + 1)[0] ?? "￼");
        out.push(escapeText(content, {lineStart: last() === "" || last() === "\n", lineEnd, before: last(), after, place, full: context.options.escape === "full", definitions: context.definitions, atomEscape: context.atomEscape}));
    });
    for (const run of plan.tail) out.push(cell(writerOf(run.mark).close(run.mark, context, run)));
    return out.join("");
}
