/**
 * Markdown 编解码器（docs/specs/workspace/markdown-dialect.md）：编辑器只经它读写 Markdown。
 *
 * 按 schema 建：Tiptap 每个编辑器各建一份 schema，读出的文档必须属于编辑器自己的那一份，不同 schema 的节点不能放进同一个文档。
 * 语言（`Marked` 实例与读法表）全应用共用，见 `../language.ts`。
 */

import type {Node as PMNode, Schema} from "@tiptap/pm/model";
import {Transform} from "@tiptap/pm/transform";

import type {MarkdownLanguage} from "../language";
import {frontmatterOf, readMarkdown, setOrigins} from "./read";
import type {ReadResult, SourceMap} from "./read";
import {writeMarkdown} from "./write";
import type {WriteResult} from "./write";

export interface MarkdownCodec {
    /** 读入；永不失败（输出 9）。 */
    read(source: string): ReadResult;
    /** 写回：没编辑的块写原文，编辑过的块重新写出并读回校验（输出 1–3）。成功后提交被接受时调用结果的 `record`。 */
    write(doc: PMNode, map: SourceMap): WriteResult;
    /**
     * 重载（正文被别处改了）：按 `source` 重新读入，在 `tr` 上只把不同的那一段换掉（frontmatter 不同时也换文档的属性），返回新的
     * 原文对照，没变的块以新原文为来源。
     * 旧的来源不再用：方言 Spec“状态与转换”，外部修改后重新读入，“哪些块被编辑过”按新的原文重新计。
     */
    reload(tr: Transform, source: string): SourceMap;
}

const codecs = new WeakMap<Schema, WeakMap<MarkdownLanguage, MarkdownCodec>>();

export function codecFor(schema: Schema, language: MarkdownLanguage): MarkdownCodec {
    const bySchema = codecs.get(schema) ?? new WeakMap<MarkdownLanguage, MarkdownCodec>();
    codecs.set(schema, bySchema);
    let codec = bySchema.get(language);
    if (codec === undefined) {
        codec = {
            read: (source) => readMarkdown(language, schema, source),
            write: (doc, map) => writeMarkdown(doc, map, language, schema),
            reload: (tr, source) => adoptRead(tr, readMarkdown(language, schema, source), language.identityAttrs),
        };
        bySchema.set(language, codec);
    }
    return codec;
}

/**
 * 把 `tr` 的文档换成 `read.doc` 的样子：只替换不同的那一段（没变的顶层节点还是编辑器里原来的对象，撤销历史映射过去后仍可用），
 * 换完不相等时（替换片段的边界落在节点中间，补出来的结构不同）整篇替换。之后按位置把新读入的来源登记到 `tr.doc` 的顶层节点。
 * frontmatter 不同时先换文档的属性：文档相等要连属性一起比，留到后面会让整篇替换。
 */
function adoptRead(tr: Transform, read: ReadResult, identities: ReadonlyMap<string, string>): SourceMap {
    const frontmatter = frontmatterOf(read.doc);
    if (frontmatterOf(tr.doc) !== frontmatter) tr.setDocAttribute("frontmatter", frontmatter);
    const next = alignIdentities(tr.doc, read.doc, identities);
    const start = tr.doc.content.findDiffStart(next.content);
    if (start !== null) {
        let {a: endA, b: endB} = tr.doc.content.findDiffEnd(next.content) ?? {a: tr.doc.content.size, b: next.content.size};
        // 两边重复的内容让结尾比开头还早时，往后挪到不重叠。
        const overlap = start - Math.min(endA, endB);
        if (overlap > 0) {
            endA += overlap;
            endB += overlap;
        }
        tr.replace(start, endA, next.slice(start, endB));
    }
    if (!tr.doc.eq(next)) tr.replaceWith(0, tr.doc.content.size, next.content);
    // 对齐身份后的顶层节点与读入的一一对应（只改了标记属性，块数不变）：来源按位置取读入时的。
    tr.doc.forEach((node, _offset, index) => {
        const origins = read.map.origins.get(read.doc.child(index));
        if (origins !== undefined) setOrigins(read.map, node, origins);
    });
    return read.map;
}

/**
 * 把 `next` 里只在内存里用的身份（批注的 `key`）对齐成 `current` 里的：两边各按第一次出现的顺序排出身份，从头、从尾逐个配对，
 * 其余属性（批注的 `id`、`body`）相同才配；配不上的保留新读入的。改动之前、之后的内容因此身份不变，比较出的不同只在改动处。
 */
function alignIdentities(current: PMNode, next: PMNode, identities: ReadonlyMap<string, string>): PMNode {
    let aligned = next;
    for (const [markName, attr] of identities) {
        const sequence = (doc: PMNode): Array<{readonly value: unknown; readonly rest: string}> => {
            const seen = new Map<unknown, {readonly value: unknown; readonly rest: string}>();
            doc.descendants((node) => {
                for (const mark of node.marks) {
                    if (mark.type.name !== markName || seen.has(mark.attrs[attr])) continue;
                    const {[attr]: _identity, ...rest} = mark.attrs;
                    seen.set(mark.attrs[attr], {value: mark.attrs[attr], rest: JSON.stringify(rest)});
                }
            });
            return [...seen.values()];
        };
        const before = sequence(current);
        const after = sequence(aligned);
        const renamed = new Map<unknown, unknown>();
        let head = 0;
        while (head < before.length && head < after.length && before[head]?.rest === after[head]?.rest) {
            renamed.set(after[head]?.value, before[head]?.value);
            head += 1;
        }
        for (let tail = 1; tail <= Math.min(before.length, after.length) - head && before[before.length - tail]?.rest === after[after.length - tail]?.rest; tail += 1) {
            renamed.set(after[after.length - tail]?.value, before[before.length - tail]?.value);
        }
        if ([...renamed].every(([from, to]) => from === to)) continue;
        const transform = new Transform(aligned);
        aligned.descendants((node, pos) => {
            if (!node.isInline) return true;
            for (const mark of node.marks) {
                if (mark.type.name !== markName || !renamed.has(mark.attrs[attr])) continue;
                transform.removeMark(pos, pos + node.nodeSize, mark);
                transform.addMark(pos, pos + node.nodeSize, mark.type.create({...mark.attrs, [attr]: renamed.get(mark.attrs[attr])}));
            }
            return false;
        });
        aligned = transform.doc;
    }
    return aligned;
}
