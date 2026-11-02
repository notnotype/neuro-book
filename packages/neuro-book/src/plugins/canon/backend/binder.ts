/**
 * 读活页夹清单得到章序（docs/specs/workspace/folder-kinds.md 的活页夹清单，canon/project.md 输入与输出 23）。
 *
 * - 章 id 是清单里 `<chapter id>` 的编号（字符串），先后是清单里的出现顺序，`<group>` 只是分组、可以嵌套。
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

export type BinderRead = {readonly ok: true; readonly chapters: readonly string[]} | {readonly ok: false; readonly detail: string};

const parser = new XMLParser({preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: "", parseAttributeValue: false, parseTagValue: false, ignoreDeclaration: true, commentPropName: "#comment"});

type OrderedNode = Record<string, unknown>;

export async function readBinder(projectRoot: string): Promise<BinderRead> {
    let text: string;
    try {
        text = await readFile(join(projectRoot, BINDER_DIR, BINDER_MANIFEST), "utf8");
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return {ok: true, chapters: []};
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
    const problem = collect(roots[0]!, chapters, new Set());
    return problem === null ? {ok: true, chapters} : {ok: false, detail: problem};
}

function collect(node: OrderedNode, chapters: string[], seen: Set<string>): string | null {
    for (const child of node[tagOf(node)] as OrderedNode[]) {
        if (Object.hasOwn(child, "#comment")) continue;
        if (Object.hasOwn(child, "#text")) return "清单里不能有文本";
        const tag = tagOf(child);
        if (tag === "group") {
            const problem = collect(child, chapters, seen);
            if (problem !== null) return problem;
            continue;
        }
        if (tag !== "chapter") return `清单里只能有 <group> 与 <chapter>，不能有 <${tag}>`;
        const id = ((child[":@"] ?? {}) as Record<string, string>).id;
        if (id === undefined || !/^[1-9]\d*$/u.test(id)) return `<chapter> 的 id 必须是正整数：${JSON.stringify(id ?? null)}`;
        if (seen.has(id)) return `章节编号 ${id} 重复`;
        seen.add(id);
        chapters.push(id);
    }
    return null;
}

function tagOf(node: OrderedNode): string {
    return Object.keys(node).find((key) => key !== ":@") ?? "";
}

/**
 * 按章 id 读正文（同步：校验讲述的原句时在写入计算里调用）。找不到文件时为 undefined。每次都列目录、读文件：
 * 只在写入带讲述原句时用到，不值得为它维护一份随文件变化的缓存。
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
