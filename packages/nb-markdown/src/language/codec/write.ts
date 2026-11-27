/**
 * 写回（docs/specs/workspace/markdown-dialect.md 输出 1–3）：编辑器的文档 → 原文。
 *
 * 1. 分项：没被编辑的块（节点对象还挂着来源、同一块的节点都还在且相邻）写原文；其余顶层节点各自重新写出。顶层的空段落是间隔。
 *    节点有几代来源时（撤销）对全篇选一种切法，见 `itemsOf`。
 * 2. 间隔：前后两块（或文件首尾）这一对在原文对照里登记过、空段落数也没变，写登记的原文；否则按空段落数重新生成。
 * 3. 读回校验：重新写出的块与重新生成的间隔，连同前后各一块读回来，与编辑器里的节点比（`compare.ts`）。对不上时按降级阶梯换
 *    写法；没被编辑、但被这次写出影响了的相邻块（例如没闭合的代码围栏吞掉了后面的新段落）也重新写出。都不行就是写不出。
 * 4. 成功后由调用方在提交被接受时调用 `record`：重新写出的块换成新的来源、全部间隔登记进原文对照。
 *
 * 判断“没被编辑”靠节点对象：ProseMirror 的编辑只替换改动处的节点，其余顶层子节点还是读入时的同一个对象。
 */

import {Fragment, Slice} from "@tiptap/pm/model";
import type {Mark as PMMark, Node as PMNode, Schema} from "@tiptap/pm/model";
import type {Transform} from "@tiptap/pm/transform";

import type {MarkdownLanguage} from "../language";
import type {WriteOptions} from "../syntax/types";
import {normalizeLabel, Unrepresentable} from "../syntax/types";
import {equivalent} from "./compare";
import type {BodyHead, Definitions, Eol, Gap, SourceMap, SourceUnit} from "./read";
import {END, START, emptiesBetween, emptiesLeading, emptiesTrailing, frontmatterOf, originsOf, readBody, recordGap, setOrigins} from "./read";
import {renderBlock} from "./render";
import {gluedOpenings, isWholeFrontmatter, splitFrontmatter} from "./source";
import {decodeRawBreaks, SENTINEL, stripSentinels} from "./render/escape";
import {follow, openings} from "./render/inline";

export type WriteResult =
    | {
          readonly ok: true;
          readonly text: string;
          /** 这次写出被接受：登记重新写出的块的来源与全部间隔（方言 Spec 输出 2 的“写回成功之后，这次写出的字节就是新的原文”）。 */
          readonly record: () => void;
          /**
           * 编辑器里的写出被接受：`record` 之外，把重新写出的块实际用的写法回填到 `tr` 上（“新加的内容一旦写回，写法就固定下来”），
           * 来源登记到 `tr.doc` 的顶层节点上。`tr` 必须从写出的这份文档开始；回填只改属性，不改结构。
           */
          readonly accept: (tr: Transform) => void;
      }
    | {
          readonly ok: false;
          readonly code: "unrepresentable";
          readonly from: number;
          readonly to: number;
          readonly reason: string;
          /** 抢救用的正文：写不出的那几块换成它们的纯文字段落，其余照常写出（editor 输出 61 的终态页）。 */
          readonly fallback: () => string;
      };

type Failed = {readonly ok: false; readonly code: "unrepresentable"; readonly from: number; readonly to: number; readonly reason: string};

/**
 * 降级阶梯（方言 Spec 输出 3），按顺序试。分开相邻列表的“换符号”是每一项自己的标记（`Item.alternate`），升级时不丢；
 * 相邻未动块的重新写出也不在这里，见 `writeMarkdown`。
 */
const LADDER: ReadonlyArray<Omit<WriteOptions, "alternate">> = [
    {styles: "keep", escape: "minimal", htmlEmphasis: false},
    {styles: "canonical", escape: "minimal", htmlEmphasis: false},
    {styles: "canonical", escape: "full", htmlEmphasis: false},
    {styles: "canonical", escape: "full", htmlEmphasis: true},
];
const FULL_ESCAPE_LEVEL = 2;
/** 列表符号最多轮换几次（无序列表有三种符号）。 */
const MARKER_ROTATIONS = 3;
/** 完全转义之后逐个试撤的候选上限：到上限保留剩下的转义，读得回来，只是不最小。 */
const UNDO_LIMIT = 32;
/** 一个节点最多记几代来源（见 `SourceMap.origins`）。 */
const ORIGIN_HISTORY = 8;

/** 一项：一块原文，或一个要重新写出的顶层节点。 */
interface Item {
    readonly nodes: ReadonlyArray<PMNode>;
    /** 写原文时是它的来源；重新写出时为 null。 */
    unit: SourceUnit | null;
    /** 前面的空段落数。 */
    readonly empties: number;
    readonly from: number;
    readonly to: number;
    /** 重新写出时用到阶梯的第几级（写原文为 -1）。 */
    level: number;
    /** 列表的符号轮换几次（见 `WriteOptions.alternate`）：它和前一块读回合成了一个列表。 */
    alternate: number;
    text: string;
}

const isEmptyParagraph = (node: PMNode): boolean => node.type.name === "paragraph" && node.childCount === 0;

/**
 * 把文档切成项：哪些节点写原文、各用哪一块原文。一个节点可能有几代来源都完整（撤销恢复了旧节点，而其中有的节点后来随邻居
 * 重新写出过），所以对全篇选一种切法：没登记过的间隔最少（同一代的块挨在一起），其次写原文的节点最多。再分不出时
 * 用旧的来源：这时让节点重新写出的起因不在相邻的块（例如引用定义变了），旧的来源若已不适用，依赖上下文的校验会把它改写掉
 * （`dependsOnChangedDefinition`）；用新的则撤销回去时写不回原文的字节。
 */
function itemsOf(doc: PMNode, map: SourceMap): {items: Item[]; trailing: number} {
    const children: Array<{node: PMNode; pos: number}> = [];
    doc.forEach((node, pos) => children.push({node, pos}));
    // 内容节点（空段落属于间隔）与它们前面的空段落数。
    const contents: number[] = [];
    const emptiesBefore: number[] = [];
    let empties = 0;
    children.forEach(({node}, index) => {
        if (isEmptyParagraph(node)) {
            empties += 1;
            return;
        }
        contents.push(index);
        emptiesBefore.push(empties);
        empties = 0;
    });
    const trailing = empties;
    /** 从第 k 个内容节点开始的、完整的来源（它的每一部分都按顺序紧挨着在这里），新的在前。 */
    const candidates = contents.map((index) =>
        (originsOf(map, (children[index] as {node: PMNode}).node) ?? [])
            .filter((origin) => {
                if (origin.part !== 0) return false;
                const run = children.slice(index, index + origin.unit.size);
                return run.length === origin.unit.size && run.every((child, part) => originsOf(map, child.node)?.some((other) => other.unit === origin.unit && other.part === part) === true);
            })
            .map((origin) => origin.unit),
    );
    const unknown = (before: object | null, after: object | null, between: number): number => (before !== null && after !== null && map.gaps.get(before)?.get(after)?.has(between) === true ? 0 : 1);

    // 每个节点至多一个完整来源（没有撤销回旧节点的常见情形）：写原文从不比重新写出差（重新写出的项两侧的间隔总是新生成的，
    // 写原文的项至多与重新写出一样多一个没登记的间隔，覆盖的节点更多），不用比较切法。
    if (candidates.every((units) => units.length <= 1)) {
        const items: Item[] = [];
        for (let k = 0; k < contents.length; ) {
            const unit = (candidates[k] as SourceUnit[])[0] ?? null;
            const index = contents[k] as number;
            const size = unit?.size ?? 1;
            const first = children[index] as {node: PMNode; pos: number};
            const last = children[index + size - 1] as {node: PMNode; pos: number};
            items.push({nodes: children.slice(index, index + size).map((child) => child.node), unit, empties: emptiesBefore[k] as number, from: first.pos, to: last.pos + last.node.nodeSize, level: unit === null ? 0 : -1, alternate: 0, text: unit?.raw ?? ""});
            k += size;
        }
        return {items, trailing};
    }

    // 从后往前：best[k] 是“前一项的来源为 key（重新写出的为 null）时，从第 k 个内容节点到结尾的最好切法”。
    interface Plan {
        readonly unknown: number;
        readonly covered: number;
        /** 第 k 个内容节点用哪块原文；null 是重新写出。 */
        readonly unit: SourceUnit | null;
    }
    const better = (left: Plan, right: Plan): boolean => left.unknown < right.unknown || (left.unknown === right.unknown && left.covered > right.covered);
    const best: Array<Map<object | null, Plan>> = Array.from({length: contents.length + 1}, () => new Map());
    const previousKeys: Array<Set<object | null>> = Array.from({length: contents.length + 1}, () => new Set());
    previousKeys[0]?.add(START);
    contents.forEach((_, k) => {
        previousKeys[k + 1]?.add(null);
        for (const unit of candidates[k] as SourceUnit[]) previousKeys[k + unit.size]?.add(unit);
    });
    for (let k = contents.length; k >= 0; k -= 1) {
        for (const previous of previousKeys[k] as Set<object | null>) {
            if (k === contents.length) {
                (best[k] as Map<object | null, Plan>).set(previous, {unknown: unknown(previous, END, trailing), covered: 0, unit: null});
                continue;
            }
            const rest = (best[k + 1] as Map<object | null, Plan>).get(null) as Plan;
            // 重新写出的项与前一项之间的间隔总是新生成的。
            let plan: Plan = {unknown: 1 + rest.unknown, covered: rest.covered, unit: null};
            // 候选新的在前：同分时后到的（旧的）替换，写原文与重新写出同分时也写原文。
            for (const unit of candidates[k] as SourceUnit[]) {
                const after = (best[k + unit.size] as Map<object | null, Plan>).get(unit) as Plan;
                const option: Plan = {unknown: unknown(previous, unit, emptiesBefore[k] as number) + after.unknown, covered: unit.size + after.covered, unit};
                if (!better(plan, option)) plan = option;
            }
            (best[k] as Map<object | null, Plan>).set(previous, plan);
        }
    }

    const items: Item[] = [];
    let previous: object | null = START;
    for (let k = 0; k < contents.length; ) {
        const unit: SourceUnit | null = ((best[k] as Map<object | null, Plan>).get(previous) as Plan).unit;
        const index = contents[k] as number;
        const first = children[index] as {node: PMNode; pos: number};
        const size = unit?.size ?? 1;
        const last = children[index + size - 1] as {node: PMNode; pos: number};
        const nodes = children.slice(index, index + size).map((child) => child.node);
        items.push({nodes, unit, empties: emptiesBefore[k] as number, from: first.pos, to: last.pos + last.node.nodeSize, level: unit === null ? 0 : -1, alternate: 0, text: unit?.raw ?? ""});
        previous = unit;
        k += size;
    }
    return {items, trailing};
}

/** 原样块节点的定义，按节点缓存（节点不可变；每次写回都要收集全篇的定义）。 */
const nodeLinks = new WeakMap<PMNode, ReadonlyArray<readonly [string, {readonly href: string; readonly title: string | null}]>>();

function linksOfNode(language: MarkdownLanguage, node: PMNode): ReadonlyArray<readonly [string, {readonly href: string; readonly title: string | null}]> {
    let links = nodeLinks.get(node);
    if (links === undefined) {
        links = Object.entries(linksOf(language, String(node.attrs.raw ?? "")));
        nodeLinks.set(node, links);
    }
    return links;
}

/** 原样块里的引用定义（`marked` 认的全部写法：标题另起一行、地址带转义、尖括号地址），按原文缓存。 */
const linkCache = new Map<string, Definitions>();

function linksOf(language: MarkdownLanguage, raw: string): Definitions {
    let links = linkCache.get(raw);
    if (links === undefined) {
        const lexer = language.lexer();
        lexer.lex(raw);
        links = Object.fromEntries(Object.entries(lexer.tokens.links).map(([label, {href, title}]) => [label, {href, title: title ?? null}]));
        // 只为不让缓存无限长：原样块的原文在一次编辑里不会有这么多种。
        if (linkCache.size >= 2000) linkCache.clear();
        linkCache.set(raw, links);
    }
    return links;
}

/**
 * 全篇的引用定义：原样块（顶层与容器里的）里 `marked` 认出的定义，同名的取全篇第一条（Markdown 的规则）。`skip` 里的节点
 * （读回的窗口里的原样块）：标签的第一条定义在窗口里时不预置这个标签，让窗口里的定义自己生效；预置了，窗口里的那条反倒成了
 * “重复的”。
 */
function definitionsOf(language: MarkdownLanguage, doc: PMNode, skip: ReadonlySet<PMNode> = new Set()): Definitions {
    const first = new Map<string, {node: PMNode; href: string; title: string | null}>();
    doc.descendants((node) => {
        // 定义只在原样块里；文本块里只有行内内容，不用往下走。
        if (node.type.name !== "rawBlock") return !node.isTextblock;
        for (const [label, {href, title}] of linksOfNode(language, node)) {
            if (!first.has(label)) first.set(label, {node, href, title: title ?? null});
        }
        return false;
    });
    // 窗口里的原样块可能在容器里：窗口的顶层块连同它们的全部后代都算在窗口里。
    const hidden = new Set<PMNode>();
    for (const top of skip) {
        hidden.add(top);
        top.descendants((child) => {
            hidden.add(child);
        });
    }
    const definitions: Record<string, {href: string; title: string | null}> = {};
    for (const [label, {node, href, title}] of first) if (!hidden.has(node)) definitions[label] = {href, title};
    return definitions;
}

/**
 * 重新写出的文字换成原文的主换行符，原样内容自带的换行（带标记，见 `encodeRawBreaks`）不动，最后去掉标记。
 */
const withEol = (text: string, eol: Eol): string => decodeRawBreaks(eol === "\n" ? text : text.replace(/(?<![\r\u0001\u0002])\n/gu, eol));

/** 读回校验只读正文的一个窗口，前面没有 BOM 与 frontmatter。 */
const NO_HEAD: BodyHead = {bom: "", frontmatter: null};

/**
 * 文档的 `frontmatter` 属性写不进正文之前时的原因；没有，或是 `isWholeFrontmatter` 认可的原文时为 null。属性由编辑器的事务
 * 设置（属性面板、宿主的命令），这里是写回的关卡：放进去一段不完整的原文（缺闭栏、中间有独占一行的 `---`）时，正文的开头
 * 会被读成 frontmatter 的一部分。
 */
function headProblem(doc: PMNode): string | null {
    const value: unknown = doc.attrs.frontmatter;
    if (value === null || value === undefined) return null;
    if (typeof value === "string" && isWholeFrontmatter(value)) return null;
    return "文档的 frontmatter 属性不是一段完整的 frontmatter";
}

/**
 * 正文之前写什么：读入时的 BOM 加文档这次的 frontmatter（属性没改过时就是读入时的原文，没编辑的文档仍逐字节写原文）。
 * frontmatter 的闭栏后没有换行（读入时文件在闭栏处结束，`---\na: 1\n---`）而后面有正文时，补一个换行（用 frontmatter 自己的
 * 换行符），否则闭栏不再独占一行。补在这里、不在间隔里：间隔按来源登记、会被下次写出沿用，frontmatter 却可能在两次写出之间改过。
 * 正文只有空白（`beforeBody` 为假，写 `map.emptyBody`）时不补：那段空白自己就在闭栏之后，读回时它仍是正文。
 */
function headOf(doc: PMNode, map: SourceMap, beforeBody: boolean): string {
    const frontmatter = frontmatterOf(doc) ?? "";
    const closed = !beforeBody || frontmatter === "" || /[\r\n]$/u.test(frontmatter);
    return map.bom + frontmatter + (closed ? "" : (/\r\n|\r|\n/u.exec(frontmatter)?.[0] ?? map.eol));
}

export function writeMarkdown(doc: PMNode, map: SourceMap, language: MarkdownLanguage, schema: Schema): WriteResult {
    const result = writeOnce(doc, map, language, schema);
    return result.ok ? result : {...result, fallback: () => plainFallback(doc, map, language, schema, result)};
}

/**
 * 抢救用的正文：写不出的那一段顶层块换成纯文字段落（每一行一段）再写，还有写不出的块就接着换，直到写得出。每一轮至少换掉
 * 一块，轮数以顶层块数为上限；到上限仍写不出（不应发生）时整篇按纯文字。frontmatter 属性写不出时，先把它的原文换成正文开头的
 * 纯文字段落、属性清空。
 */
function plainFallback(doc: PMNode, map: SourceMap, language: MarkdownLanguage, schema: Schema, failed: Failed): string {
    const paragraph = schema.nodes.paragraph!;
    const plain = (lines: readonly string[]): PMNode[] => (lines.length === 0 ? [""] : lines).map((line) => paragraph.create(null, line === "" ? null : schema.text(line)));
    let start = doc;
    let failure = failed;
    if (headProblem(doc) !== null) {
        const raw = String(doc.attrs.frontmatter).replace(/(?:\r\n|\r|\n)$/u, "");
        start = doc.type.create({...doc.attrs, frontmatter: null}, Fragment.from(plain(raw.split(/\r\n|\r|\n/u))).append(doc.content), doc.marks);
        const again = writeOnce(start, map, language, schema);
        if (again.ok) return again.text;
        failure = again;
    }
    let current = start;
    for (let round = 0; round <= start.childCount; round += 1) {
        const lines: string[] = [];
        // 原样块、可渲染 HTML 与行内原样片段的原文也作为文字留下（例如没闭合的 `<!--` 吞掉了后面的新段落，写不出的就是它）。
        const source = (node: PMNode): string => String(node.attrs.raw ?? node.attrs.html ?? "");
        current.nodesBetween(failure.from, failure.to, (node) => {
            if (node.isBlock && node.isAtom) {
                lines.push(...source(node).split("\n"));
                return false;
            }
            if (!node.isTextblock) return true;
            lines.push(...node.textBetween(0, node.content.size, "", (leaf) => (leaf.type.name === "hardBreak" ? "\n" : source(leaf))).split("\n"));
            return false;
        });
        current = current.replace(failure.from, failure.to, new Slice(Fragment.from(plain(lines)), 0, 0));
        const again = writeOnce(current, map, language, schema);
        if (again.ok) return again.text;
        failure = again;
    }
    const body = start.textBetween(0, start.content.size, "\n\n", "\n");
    return headOf(start, map, body !== "") + body;
}

type Written = Exclude<WriteResult, {ok: false}> | Failed;

/**
 * `forced` 是要重新写出的节点：整篇检查（见文末）发现没被编辑的块会被宽容写法拆开时，带上它们再写一遍。
 */
function writeOnce(doc: PMNode, map: SourceMap, language: MarkdownLanguage, schema: Schema, forced: ReadonlySet<PMNode> = new Set()): Written {
    const problem = headProblem(doc);
    if (problem !== null) return {ok: false, code: "unrepresentable", from: 0, to: 0, reason: problem};
    const {items: listed, trailing} = itemsOf(doc, map);
    const found = listed.flatMap((item) => (item.unit !== null && item.nodes.some((node) => forced.has(node)) ? splitItem(item) : [item]));
    const eol = map.eol;
    // 整篇没有内容（只有空段落：没有块就没有间隔，几个空段落都读成一个）：读入时就没有块的，写原文的空白；否则写空正文（输出 2）。
    if (found.length === 0) {
        const text = headOf(doc, map, false) + (map.emptyBody ?? "");
        return {ok: true, text, record: () => undefined, accept: () => undefined};
    }
    const view = found.map((item) => ({nodes: item.nodes, raw: item.unit?.raw ?? null}));
    const writers = {inline: language.inlineWriters, marks: language.markWriters, markless: language.marklessInline, textOnly: language.textOnlyMarks};
    const tools = {
        openings: (parent: PMNode, canonical: boolean) => openings(parent, writers, canonical),
        lex: (source: string) => language.lexer().lex(source),
    };
    const prepared = new Map([...language.prepareWrite].map(([name, prepare]) => [name, prepare(doc, view, tools)]));
    // 没被编辑、但它依赖的上下文变了的块，按语法模块的判断改为重新写出（例如分截批注带意见的那一截没了，剩下的截要写上
    // 意见）。改为重新写出的块又可能牵连别的块，所以反复问，直到没有新的。
    let items = found;
    for (;;) {
        const blocks = items.map((item) => ({nodes: item.nodes, raw: item.unit?.raw ?? null}));
        const dependents = new Set<number>();
        for (const [name, find] of language.contextDependents) for (const index of find(blocks, prepared.get(name))) if (items[index]?.unit !== null) dependents.add(index);
        if (dependents.size === 0) break;
        items = items.flatMap((item, index): Item[] => (dependents.has(index) ? splitItem(item) : [item]));
    }
    const definitions = definitionsOf(language, doc);
    // 一次写出里定义不变，每项的判断只算一次（窗口每一轮都要重算）。
    const depending = new Map<Item, boolean>();
    const dependsOn = (item: Item): boolean => {
        let known = depending.get(item);
        if (known === undefined) {
            known = dependsOnChangedDefinition(item, definitions);
            depending.set(item, known);
        }
        return known;
    };
    const labels = new Map(Object.entries(definitions).map(([label, value]) => [label, value.href]));
    const emphasis = new Set([...language.markWriters].filter(([, writer]) => writer.emphasis === true).map(([type]) => type));

    const head = headOf(doc, map, true);
    /** 第 i 项之前的间隔（i 等于项数时是结尾）：登记过就用登记的原文，否则重新生成。 */
    const gapAt = (index: number): {gap: Gap; kept: boolean} => {
        const before = index === 0 ? START : items[index - 1]?.unit ?? null;
        const after = index === items.length ? END : items[index]?.unit ?? null;
        const empties = index === items.length ? trailing : (items[index] as Item).empties;
        if (before !== null && after !== null) {
            const known = map.gaps.get(before)?.get(after)?.get(empties);
            if (known !== undefined) return {gap: known, kept: true};
        }
        if (index === 0) return {gap: {raw: eol.repeat(empties), empties}, kept: false};
        // 结尾：`k` 个空段落是 `k` 个空行加文件末尾的换行；没有空段落时按原文末尾有没有换行。
        if (index === items.length) return {gap: {raw: empties === 0 ? (map.finalNewline ? eol : "") : eol.repeat(empties + 1), empties}, kept: false};
        return {gap: {raw: eol.repeat(empties + 2), empties}, kept: false};
    };
    let gaps = items.map((_, index) => gapAt(index)).concat([gapAt(items.length)]);

    const render = (item: Item): boolean => {
        // 正文里有哨兵字符（NUL）时完全转义那几级用不了：试撤会把正文自己的这个字符当成哨兵。
        if (LADDER[item.level]?.escape === "full" && (item.nodes[0] as PMNode).textContent.includes(SENTINEL)) return false;
        try {
            item.text = renderBlock(language, item.nodes[0] as PMNode, {...(LADDER[item.level] as Omit<WriteOptions, "alternate">), alternate: item.alternate}, labels, prepared);
            return true;
        } catch (error) {
            if (error instanceof Unrepresentable) return false;
            throw error;
        }
    };

    const readBacks = new Map<string, PMNode>();
    /**
     * 读回窗口 [first, last]：期望的节点（含间隔里的空段落）与读回的文档。开头、结尾的间隔只在窗口挨着文件首尾时带上。
     */
    const readBack = (first: number, last: number, override?: {index: number; text: string}): {expected: Array<{node: PMNode; item: number}>; read: PMNode} => {
        const parts: string[] = [];
        const expected: Array<{node: PMNode; item: number}> = [];
        const empty = schema.nodes.paragraph!.create();
        const pushEmpties = (count: number, item: number): void => {
            for (let n = 0; n < count; n += 1) expected.push({node: empty, item});
        };
        if (first === 0) {
            parts.push((gaps[0] as {gap: Gap}).gap.raw);
            pushEmpties(emptiesLeading((gaps[0] as {gap: Gap}).gap.raw), 0);
        }
        for (let index = first; index <= last; index += 1) {
            const item = items[index] as Item;
            if (index > first) {
                const gap = (gaps[index] as {gap: Gap}).gap.raw;
                parts.push(gap);
                pushEmpties(emptiesBetween(gap), index);
            }
            // 写原文的项不去哨兵：它的字节就是原文。
            const text = override?.index === index ? override.text : item.text;
            parts.push(item.unit === null ? decodeRawBreaks(stripSentinels(text)) : text);
            for (const node of item.nodes) expected.push({node, item: index});
        }
        if (last === items.length - 1) {
            const gap = (gaps[items.length] as {gap: Gap}).gap.raw;
            parts.push(gap);
            pushEmpties(emptiesTrailing(gap), last);
        }
        // 窗口外的引用定义预置进词法器；窗口里的不预置，让 `marked` 照常读它们（预置了同名的，窗口里的会被当成重复的丢掉）。
        // 同一个窗口、同样的原文读回的结果相同：校验通过时读过的，`accept` 取写法时直接用。
        const text = parts.join("");
        const key = `${String(first)}:${String(last)}\u0000${text}`;
        let read = readBacks.get(key);
        if (read === undefined) {
            const inside = new Set(items.slice(first, last + 1).flatMap((item) => item.nodes));
            read = readBody(language, schema, NO_HEAD, text, definitionsOf(language, doc, inside)).doc;
            readBacks.set(key, read);
        }
        return {expected, read};
    };
    /**
     * 校验读回窗口：返回第一个对不上的项（都对上为 -1），以及读回的块是不是比预期少（有块被前一块吞了：两个列表合成一个、
     * 缩进代码被读进列表项……）。
     */
    const check = (first: number, last: number, override?: {index: number; text: string}): {item: number; absorbed: boolean} => {
        const {expected, read} = readBack(first, last, override);
        const count = Math.max(read.childCount, expected.length);
        for (let at = 0; at < count; at += 1) {
            const want = expected[at];
            if (want === undefined) return {item: last, absorbed: false};
            if (at >= read.childCount) return {item: want.item, absorbed: true};
            // 没被编辑的块（写原文）只比结构：它的写法就是原文，编辑器里记着的写法可能是上一次规范写法写出前的。
            const level = (items[want.item] as Item).level;
            const styles = level === 0 ? "keep" : "canonical";
            if (!equivalent(want.node, read.child(at), {styles, emphasis, ignored: language.uncomparedAttrs, markless: language.marklessInline, textOnly: language.textOnlyMarks, joined: language.joinedInline, follow})) return {item: want.item, absorbed: read.childCount < expected.length};
        }
        const readNodes = Array.from({length: read.childCount}, (_, at) => read.child(at));
        for (const [name, verify] of language.verifyWindow) {
            const failed = verify(expected.map((want) => want.node), readNodes, prepared.get(name));
            if (failed >= 0) return {item: (expected[failed] as {item: number}).item, absorbed: false};
        }
        return {item: -1, absorbed: false};
    };
    const mismatch = (first: number, last: number, override?: {index: number; text: string}): number => check(first, last, override).item;

    // 要校验的项：重新写出的，以及挨着重新生成的间隔的。连在一起的几项合成一个窗口，两头各多带一块。
    const windows = (): Array<[number, number]> => {
        const marked = new Set<number>();
        items.forEach((item, index) => {
            if (item.unit === null || dependsOn(item)) marked.add(index);
        });
        gaps.forEach(({kept}, index) => {
            if (kept) return;
            if (index > 0) marked.add(index - 1);
            if (index < items.length) marked.add(index);
        });
        const sorted = [...marked].sort((left, right) => left - right);
        const out: Array<[number, number]> = [];
        for (let at = 0; at < sorted.length; at += 1) {
            let end = at;
            while (end + 1 < sorted.length && (sorted[end + 1] as number) <= (sorted[end] as number) + 2) end += 1;
            out.push([Math.max(0, (sorted[at] as number) - 1), Math.min(items.length - 1, (sorted[end] as number) + 1)]);
            at = end;
        }
        return out;
    };
    const rerenderGaps = (): void => {
        gaps = items.map((_, index) => gapAt(index)).concat([gapAt(items.length)]);
    };
    /** 把一项升到阶梯的某一级（写原文的项先改成重新写出）；升不上去（写法抛 `Unrepresentable`）就继续往上。 */
    const raise = (item: Item, level: number): void => {
        if (item.unit !== null) {
            item.unit = null;
            rerenderGaps();
        }
        item.level = Math.max(item.level, level);
        while (!render(item) && item.level < LADDER.length - 1) item.level += 1;
    };
    /**
     * 窗口里读不回来时，按方言 Spec 输出 3 的阶梯整体推进，每一步作用于窗口里的全部候选项，推进后再校验，过了就停。
     * 只会越来越保守，不会来回震荡。
     */
    interface Failure {
        readonly item: Item;
        /** 出问题的项前后的项（合并可能发生在任一边：两个列表之间的空段落被吞掉时，报出的是后一个列表）。 */
        readonly previous: Item | undefined;
        readonly next: Item | undefined;
        readonly absorbed: boolean;
    }
    const steps: ReadonlyArray<(window: ReadonlyArray<Item>, failure: Failure) => void> = [
        (window) => window.forEach((item) => item.unit === null && item.level < 1 && raise(item, 1)),
        // 两个同组的列表读回合成了一个：换其中一个的符号（方言 Spec 输出 3），换成与它前后两个都不同的。优先换重新写出的那个，
        // 两个都重新写出时换后一个。只动真的合并了的那一对。
        (_window, failure) => {
            if (!failure.absorbed) return;
            const pair = [[failure.item, failure.next], [failure.previous, failure.item]].find(([left, right]) => left !== undefined && right !== undefined && listFamily(right.nodes[0]) !== null && listFamily(left.nodes.at(-1)) === listFamily(right.nodes[0]));
            if (pair === undefined) return;
            const [left, right] = pair as [Item, Item];
            const family = listFamily(right.nodes[0]);
            const target = left.unit === null && right.unit !== null ? left : right;
            // 三种符号都试过了：合并另有原因，不再换（否则状态一直在变，循环要跑满上限）。
            if (target.alternate >= MARKER_ROTATIONS) return;
            const index = items.indexOf(target);
            const around = [items[index - 1], items[index + 1]].filter((other) => other !== undefined && listFamily(other.nodes.at(-1)) === family).map((other) => markerOf(other as Item));
            for (let times = target.alternate + 1; times <= MARKER_ROTATIONS; times += 1) {
                target.alternate = times;
                raise(target, target.unit === null ? target.level : 0);
                if (!around.includes(markerOf(target))) return;
            }
        },
        // 没被编辑的块自己读不回来（被这次写出影响了，例如没闭合的代码围栏吞掉了后面的新段落）：重新写出它；它吞掉了后一块时
        // 后一块也重新写出（例如缩进代码被读进前面的列表项）。保持原写法：规范写法会把相邻列表各自的符号都改回 `-`。
        (_window, failure) => {
            const rewritable = (item: Item | undefined): item is Item => item !== undefined && item.unit !== null && item.nodes[0]?.type.name !== "rawBlock" && item.nodes.length === 1;
            if (rewritable(failure.item)) raise(failure.item, 0);
            if (failure.absorbed && rewritable(failure.next)) raise(failure.next, 0);
        },
        (window) => window.forEach((item) => item.unit === null && raise(item, FULL_ESCAPE_LEVEL)),
        (window) => window.forEach((item) => item.unit === null && raise(item, LADDER.length - 1)),
    ];
    // 第 0 级写不出（例如没有表头的表格）就往上试；最高一级仍写不出由校验报告。
    for (const item of items) if (item.unit === null) raise(item, 0);
    // 推进过的项可能让别的间隔重新生成、窗口变大：直到所有窗口都读得回来。每一轮至少有一项升了级，所以有上限。
    let lastState = "";
    for (let round = 0; ; round += 1) {
        const failing = windows().map(([first, last]) => ({first, last, ...check(first, last)})).find((window) => window.item >= 0);
        if (failing === undefined) break;
        let failed = failing.item;
        let absorbed = failing.absorbed;
        for (let step = 0; failed >= 0 && step < steps.length; step += 1) {
            (steps[step] as (window: ReadonlyArray<Item>, failure: Failure) => void)(items.slice(failing.first, failing.last + 1), {item: items[failed] as Item, previous: items[failed - 1], next: items[failed + 1], absorbed});
            ({item: failed, absorbed} = check(failing.first, failing.last));
        }
        // 这一遍有项升了级或换了符号就再来一遍（例如几个相邻列表要依次换符号）；没有变化、或轮数用完才是写不出。
        const state = items.map((item) => `${item.unit === null ? "r" : "u"}${item.level}.${item.alternate}`).join(",");
        if (failed >= 0 && (state === lastState || round > items.length * steps.length)) {
            const item = items[failed] as Item;
            return unrepresentable(item, item.unit === null ? "各级写法都读不回来" : "前面没闭合的原样内容吞掉了后面的内容");
        }
        lastState = state;
    }

    // 完全转义的块：从后往前逐个试撤转义，撤了还读得回来就撤（输出 4 的“最小”）。
    items.forEach((item, index) => {
        if (item.level < FULL_ESCAPE_LEVEL || !item.text.includes(SENTINEL)) return;
        const positions: number[] = [];
        for (let at = item.text.indexOf(SENTINEL); at >= 0; at = item.text.indexOf(SENTINEL, at + 1)) positions.push(at);
        for (const position of positions.reverse().slice(0, UNDO_LIMIT)) {
            const candidate = item.text.slice(0, position) + item.text.slice(position + 2);
            if (mismatch(Math.max(0, index - 1), Math.min(items.length - 1, index + 1), {index, text: candidate}) < 0) item.text = candidate;
        }
        item.text = stripSentinels(item.text);
    });

    // 正文开头不能被读成 frontmatter：没有 frontmatter 时，开头的 `---`（挪到最前面的分割线）会和后面的 `---` 配成一对。不读
    // frontmatter 的语言没有这个问题。
    const first = items[0] as Item;
    const assemble = (): string => {
        const parts: string[] = [head];
        items.forEach((item, index) => parts.push((gaps[index] as {gap: Gap}).gap.raw, item.unit === null ? withEol(item.text, eol) : item.text));
        parts.push((gaps[items.length] as {gap: Gap}).gap.raw);
        return parts.join("");
    };
    const split = splitFrontmatter(assemble());
    if (language.frontmatter && split.bom + (split.frontmatter ?? "") !== head) {
        if (first.nodes[0]?.type.name !== "horizontalRule") return unrepresentable(first, "正文开头会被读成 frontmatter");
        first.unit = null;
        first.text = "***";
        rerenderGaps();
    }
    const texts = items.map((item) => (item.unit === null ? withEol(item.text, eol) : item.text));
    const out: string[] = [];
    const starts: number[] = [];
    let length = 0;
    items.forEach((_, index) => {
        const gap = (gaps[index] as {gap: Gap}).gap.raw;
        starts.push(length + gap.length);
        out.push(gap, texts[index] as string);
        length += gap.length + (texts[index] as string).length;
    });
    out.push((gaps[items.length] as {gap: Gap}).gap.raw);
    const body = out.join("");

    // 宽容写法（方言 Spec 输出 17）看的是整篇：段末黏着方言开标签、下面某处有独占一行的闭标签时，读入会拆开。读回只读窗口，
    // 看不到远处的闭标签（例如这一段被挪到了一个块级批注前面），所以对整篇输出再扫一遍：拆分点只能在块的开头。落在没被
    // 编辑的块中间时把它改为重新写出（换行写成 `<br>`，开标签不再在行尾）再写一遍；落在重新写出的块中间时写不出。
    const blockStarts = new Set(starts);
    const misplaced = gluedOpenings(body, language.glued).filter((offset) => !blockStarts.has(offset));
    if (misplaced.length > 0) {
        const nodes = new Set(forced);
        for (const offset of misplaced) {
            let index = starts.length - 1;
            while (index > 0 && (starts[index] as number) > offset) index -= 1;
            const item = items[index] as Item;
            if (item.unit === null) return unrepresentable(item, "段末的方言开标签会把这一段拆开（宽容写法）");
            for (const node of item.nodes) nodes.add(node);
        }
        return writeOnce(doc, map, language, schema, nodes);
    }
    /** 登记来源与间隔；`carried` 是写出的顶层节点 → 回填之后的同一位置的节点（来源两边都登记）。 */
    const record = (carried?: ReadonlyMap<PMNode, PMNode>): void => {
        // 重新写出的块总是新的一代，即使字节与上一代相同：间隔按一对来源登记，沿用旧的来源对象会让这一次重新生成的间隔
        // 覆盖旧一代登记的间隔，撤销回去就写不回原来的间隔了。
        const units = items.map((item, index) => item.unit ?? {raw: texts[index] as string, size: item.nodes.length});
        const register = (node: PMNode, unit: SourceUnit, part: number): void => {
            const known = map.origins.get(node) ?? [];
            if (known[0]?.unit === unit) return;
            // 同一个节点反复被重新写出时来源会一直加：只留最近的几代，但最早的一代（读入时的）总留着，撤销回打开时要用。
            const next = [{unit, part}, ...known];
            setOrigins(map, node, next.length <= ORIGIN_HISTORY ? next : [...next.slice(0, ORIGIN_HISTORY - 1), known.at(-1) as {unit: SourceUnit; part: number}]);
        };
        units.forEach((unit, index) => (items[index] as Item).nodes.forEach((node, part) => {
            register(node, unit, part);
            const after = carried?.get(node);
            if (after !== undefined && after !== node) register(after, unit, part);
        }));
        for (let index = 0; index <= items.length; index += 1) {
            recordGap(map, index === 0 ? START : (units[index - 1] as SourceUnit), index === items.length ? END : (units[index] as SourceUnit), (gaps[index] as {gap: Gap}).gap);
        }
    };
    return {
        ok: true,
        text: head + body,
        record: () => record(),
        accept: (tr) => {
            if (tr.doc !== doc) throw new Error("accept 的事务要从写出的这份文档开始");
            // 读回重新写出的块所在的窗口（与校验时同样的窗口与上下文），把读回的写法抄到编辑器的节点上。
            const positions = new Map<PMNode, number>();
            doc.forEach((node, pos) => positions.set(node, pos));
            for (const [first, last] of windows()) {
                if (!items.slice(first, last + 1).some((item) => item.unit === null)) continue;
                const {expected, read} = readBack(first, last);
                if (read.childCount !== expected.length) continue;
                expected.forEach(({node, item}, at) => {
                    const pos = positions.get(node);
                    if ((items[item] as Item).unit === null && pos !== undefined) restyle(tr, pos, node, read.child(at));
                });
            }
            const carried = new Map<PMNode, PMNode>();
            doc.forEach((node, _offset, index) => carried.set(node, tr.doc.child(index)));
            record(carried);
        },
    };
}

/** 写法属性（`markdown`）：节点与标记的类型里声明了它才有。 */
const styled = (spec: {readonly attrs?: Readonly<Record<string, unknown>> | null}): boolean => spec.attrs?.markdown !== undefined;
const sameStyle = (left: unknown, right: unknown): boolean => JSON.stringify(left ?? null) === JSON.stringify(right ?? null);

/**
 * 把读回的节点 `read` 的写法属性抄到编辑器里 `pos` 处的节点 `mine` 上，逐层往下；类型或结构对不上的子树不抄（那一块下次重写时
 * 按规范写法与跟随写出，与没有回填时一样）。只改 `markdown` 属性，其余属性（批注的 `key` 等身份）保留编辑器里的。
 */
function restyle(tr: Transform, pos: number, mine: PMNode, read: PMNode): void {
    if (mine.type !== read.type) return;
    if (styled(mine.type.spec) && !sameStyle(mine.attrs.markdown, read.attrs.markdown)) tr.setNodeMarkup(pos, undefined, {...mine.attrs, markdown: read.attrs.markdown});
    if (mine.isTextblock) {
        restyleInline(tr, pos + 1, mine, read);
        return;
    }
    if (mine.childCount !== read.childCount) return;
    mine.forEach((child, offset, index) => restyle(tr, pos + 1 + offset, child, read.child(index)));
}

function restyleInline(tr: Transform, start: number, mine: PMNode, read: PMNode): void {
    if (mine.content.size !== read.content.size || mine.textContent !== read.textContent) return;
    read.forEach((child, offset) => {
        if (!child.isText) {
            const own = mine.nodeAt(offset);
            if (own !== null && own.type === child.type && styled(own.type.spec) && !sameStyle(own.attrs.markdown, child.attrs.markdown)) tr.setNodeMarkup(start + offset, undefined, {...own.attrs, markdown: child.attrs.markdown});
        }
        for (const mark of child.marks) {
            if (!styled(mark.type.spec)) continue;
            mine.nodesBetween(offset, offset + child.nodeSize, (own, ownOffset) => {
                const existing: PMMark | undefined = mark.type.isInSet(own.marks);
                if (existing === undefined || sameStyle(existing.attrs.markdown, mark.attrs.markdown)) return;
                const from = start + Math.max(offset, ownOffset);
                const to = start + Math.min(offset + child.nodeSize, ownOffset + own.nodeSize);
                tr.removeMark(from, to, existing);
                tr.addMark(from, to, existing.type.create({...existing.attrs, markdown: mark.attrs.markdown}));
            });
        }
    });
}

/** 列表写出来的符号（无序的 `-`、`*`、`+`，有序的分隔符），从写出的文字取。 */
function markerOf(item: Item): string {
    return /^\s*(?:\d+([.)])|([-*+]))/u.exec(item.text)?.slice(1).find((part) => part !== undefined) ?? "";
}

/**
 * 依赖上下文的块：没被编辑，但它依赖的引用定义没了或地址变了（引用式链接、引用式图片）。它要列入校验，读不回来时按阶梯改写
 * （改成行内链接）。
 */
function dependsOnChangedDefinition(item: Item, definitions: Definitions): boolean {
    // 地址与标题都要对得上：删掉同名的第一条定义后，第二条的标题可能不同。图片只比地址。
    return item.nodes.some((node) => referencesOf(node).some(({label, href, title}) => definitions[label]?.href !== href || (title !== undefined && (definitions[label]?.title ?? null) !== title)));
}

interface Reference {
    readonly label: string;
    readonly href: unknown;
    /** 图片不比标题，为 undefined。 */
    readonly title?: unknown;
}

/** 节点里的引用式链接与图片；节点不可变，按节点缓存（没编辑的块每次写回都要查）。 */
const references = new WeakMap<PMNode, ReadonlyArray<Reference>>();

function referencesOf(node: PMNode): ReadonlyArray<Reference> {
    const known = references.get(node);
    if (known !== undefined) return known;
    const found: Reference[] = [];
    const reference = (style: unknown, text: string): string | null => {
        const value = style as {style?: string; label?: string} | null;
        if (value?.style === "reference") return normalizeLabel(value.label ?? "");
        if (value?.style === "collapsed" || value?.style === "shortcut") return normalizeLabel(text);
        return null;
    };
    node.descendants((child) => {
        for (const mark of child.marks) {
            if (mark.type.name !== "link") continue;
            const label = reference(mark.attrs.markdown, child.textContent);
            if (label !== null) found.push({label, href: mark.attrs.href, title: mark.attrs.title ?? null});
        }
        if (child.type.name === "image") {
            const label = reference(child.attrs.markdown, "");
            if (label !== null) found.push({label, href: child.attrs.src});
        }
    });
    references.set(node, found);
    return found;
}

/** 会读成同一个列表的几类：无序列表与任务列表（符号相同就合并），有序列表。不是列表为 null。 */
function listFamily(node: PMNode | undefined): "bullet" | "ordered" | null {
    switch (node?.type.name) {
        case "bulletList":
        case "taskList":
            return "bullet";
        case "orderedList":
            return "ordered";
        default:
            return null;
    }
}

/** 一块原文的各个节点改为各自重新写出。 */
function splitItem(item: Item): Item[] {
    let from = item.from;
    return item.nodes.map((node, part) => {
        const split: Item = {nodes: [node], unit: null, empties: part === 0 ? item.empties : 0, from, to: from + node.nodeSize, level: 0, alternate: 0, text: ""};
        from += node.nodeSize;
        return split;
    });
}

function unrepresentable(item: Item, reason: string): Failed {
    return {ok: false, code: "unrepresentable", from: item.from, to: item.to, reason};
}
