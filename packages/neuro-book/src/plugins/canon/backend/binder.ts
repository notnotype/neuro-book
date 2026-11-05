/**
 * 读活页夹清单得到章序（docs/specs/workspace/folder-kinds.md 的活页夹清单，canon/project.md 输入与输出 23）。
 *
 * - 章 id 是清单里 `<chapter id>` 的编号（字符串），先后是清单里的出现顺序，`<group>` 只是分组、可以嵌套。
 * - 章讲的线：`<chapter line>` 是整章讲的线（缺省主线），分段写成子元素 `<segment from line/>`，`from` 是段号、严格递增，第一段用章的
 *   `line`（canon.worldlines 输出 12，folder-kinds.md 的活页夹清单）。读的一方不改写，写清单的一方要原样保留这两样。
 * - 章节文件是活页夹目录下 `<五位编号>-<章名>.md`；清单里没有的文件不算章，清单里有、文件不在的章照样算章，正文为空。
 * - 清单不存在是“没有章”；读不出或不合法时返回 `invalid`，调用方保持上一次的章序。
 * 只读，不写清单：清单归剧情插件与文件服务（folder-kinds.md）。
 */

import {readdirSync, readFileSync} from "node:fs";
import {readFile} from "node:fs/promises";
import {join} from "node:path";

import {XMLParser, XMLValidator} from "fast-xml-parser";

export const BINDER_DIR = "manuscripts.binder";
export const BINDER_MANIFEST = "binder.xml";

/** 一章里一段起讲的线（canon.worldlines 输出 12）：`from` 是段号，从 1 数。 */
export interface BinderChapterLine {
    readonly from: number;
    readonly line: string;
}

/** `lines` 只列写了线的章（`<chapter line>` 或带 `<segment>` 的）；没写的章讲主线。 */
export type BinderRead = {readonly ok: true; readonly chapters: readonly string[]; readonly lines: ReadonlyMap<string, readonly BinderChapterLine[]>} | {readonly ok: false; readonly detail: string};

const parser = new XMLParser({preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: "", parseAttributeValue: false, parseTagValue: false, ignoreDeclaration: true, commentPropName: "#comment"});

type OrderedNode = Record<string, unknown>;

export async function readBinder(projectRoot: string): Promise<BinderRead> {
    let text: string;
    try {
        text = await readFile(join(projectRoot, BINDER_DIR, BINDER_MANIFEST), "utf8");
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return {ok: true, chapters: [], lines: new Map()};
        return {ok: false, detail: `读不出 ${BINDER_MANIFEST}：${error instanceof Error ? error.message : String(error)}`};
    }
    return parseBinder(text);
}

export function parseBinder(text: string): BinderRead {
    let roots: OrderedNode[];
    try {
        const valid = XMLValidator.validate(text);
        if (valid !== true) return {ok: false, detail: `第 ${String(valid.err.line)} 行：${valid.err.msg}`};
        roots = (parser.parse(text) as OrderedNode[]).filter((node) => !Object.hasOwn(node, "#comment") && !Object.hasOwn(node, "#text"));
    } catch (error) {
        return {ok: false, detail: `XML 无法解析：${error instanceof Error ? error.message : String(error)}`};
    }
    if (roots.length !== 1 || tagOf(roots[0]!) !== "binder") return {ok: false, detail: "根元素必须是唯一的 <binder>"};
    const chapters: string[] = [];
    const lines = new Map<string, readonly BinderChapterLine[]>();
    const problem = collect(roots[0]!, chapters, new Set(), lines);
    return problem === null ? {ok: true, chapters, lines} : {ok: false, detail: problem};
}

/** 一章的 `line` 与 `<segment>` 子元素，整理成从 1 起的各段（第一段是章的 `line`）；没写线时返回 null。 */
function chapterSegments(id: string, attributes: Record<string, string>, children: OrderedNode[]): {readonly segments: readonly BinderChapterLine[] | null; readonly problem: string | null} {
    const first = attributes.line;
    if (first !== undefined && first === "") return {segments: null, problem: `<chapter id="${id}"> 的 line 不能是空的`};
    const segments: BinderChapterLine[] = [];
    let previous = 0;
    for (const child of children) {
        if (Object.hasOwn(child, "#comment")) continue;
        if (Object.hasOwn(child, "#text")) return {segments: null, problem: `<chapter id="${id}"> 里不能有文本`};
        const tag = tagOf(child);
        if (tag !== "segment") return {segments: null, problem: `<chapter> 里只能有 <segment>，不能有 <${tag}>`};
        const given = (child[":@"] ?? {}) as Record<string, string>;
        if (given.from === undefined || !/^[1-9]\d*$/u.test(given.from)) return {segments: null, problem: `<segment> 的 from 必须是正整数：${JSON.stringify(given.from ?? null)}`};
        const from = Number(given.from);
        if (from <= previous) return {segments: null, problem: `<chapter id="${id}"> 里 <segment> 的 from 必须严格递增`};
        if (given.line === undefined || given.line === "") return {segments: null, problem: `<segment from="${given.from}"> 缺 line`};
        previous = from;
        segments.push({from, line: given.line});
    }
    if (first === undefined && segments.length === 0) return {segments: null, problem: null};
    // 第一段用章的线（缺省主线）；`<segment from="1">` 直接盖掉它。
    return {segments: segments[0]?.from === 1 ? segments : [{from: 1, line: first ?? "main"}, ...segments], problem: null};
}

function collect(node: OrderedNode, chapters: string[], seen: Set<string>, lines: Map<string, readonly BinderChapterLine[]>): string | null {
    for (const child of node[tagOf(node)] as OrderedNode[]) {
        if (Object.hasOwn(child, "#comment")) continue;
        if (Object.hasOwn(child, "#text")) return "清单里不能有文本";
        const tag = tagOf(child);
        if (tag === "group") {
            const problem = collect(child, chapters, seen, lines);
            if (problem !== null) return problem;
            continue;
        }
        if (tag !== "chapter") return `清单里只能有 <group> 与 <chapter>，不能有 <${tag}>`;
        const id = ((child[":@"] ?? {}) as Record<string, string>).id;
        if (id === undefined || !/^[1-9]\d*$/u.test(id)) return `<chapter> 的 id 必须是正整数：${JSON.stringify(id ?? null)}`;
        if (seen.has(id)) return `章节编号 ${id} 重复`;
        seen.add(id);
        chapters.push(id);
        const given = chapterSegments(id, (child[":@"] ?? {}) as Record<string, string>, child[tag] as OrderedNode[]);
        if (given.problem !== null) return given.problem;
        if (given.segments !== null) lines.set(id, given.segments);
    }
    return null;
}

function tagOf(node: OrderedNode): string {
    return Object.keys(node).find((key) => key !== ":@") ?? "";
}

/**
 * 按章 id 读正文。找不到文件时为 undefined。世界服务只在打开时（每章一次）与收到正文变了的通知时调用它，正文的快照由
 * 服务自己持有（canon.project 输出 25），所以这里不缓存。
 */
export function chapterText(projectRoot: string, chapter: string): string | undefined {
    const prefix = `${chapter.padStart(5, "0")}-`;
    try {
        const name = readdirSync(join(projectRoot, BINDER_DIR)).find((candidate) => candidate.startsWith(prefix) && candidate.endsWith(".md"));
        return name === undefined ? undefined : readFileSync(join(projectRoot, BINDER_DIR, name), "utf8");
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
    }
}

/** 章节文件名（`00012-标题.md`）对应的章 id（`12`）；不是章节文件时为 null。 */
export function chapterOfFile(name: string): string | null {
    const match = /^(\d+)-.*\.md$/u.exec(name);
    return match === null ? null : String(Number(match[1]));
}
