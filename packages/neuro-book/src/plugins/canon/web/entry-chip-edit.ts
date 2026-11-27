/**
 * 点开小块以后能改什么（canon/author-ui.md 输出 48 的“改小块”）：从小块的原文读出浮层里的几项，改完再拼回原文。拼出来的原文由
 * 富文本输入框读成节点、整篇过写入前的检查才落（`entry-check.ts`），这里不判断写得对不对，只保证读进来的原文拼回去逐字不变。
 *
 * 标签上浮层不改的属性（以后登记的格式、写错的属性）原样留着：作者只改了式子，别的属性不该跟着丢。
 */

import {lexTags, tagText} from "@notnotype/nb-canon/grammar";
import type {LexedTag} from "@notnotype/nb-canon/grammar";

/** 条件的一支：`test` 为 null 的是“否则”（只能是最后一支）；`text` 是这一支的源文字（写成一行）。 */
export interface DraftBranch {
    readonly test: string | null;
    readonly text: string;
}

type Attributes = ReadonlyArray<readonly [string, string]>;

/** 浮层里改的东西。`attributes` 是标签上全部的属性（按原来的先后），改哪一项就换掉那一项。 */
export type ChipDraft =
    | {readonly kind: "value"; readonly attributes: Attributes}
    | {readonly kind: "calc"; readonly attributes: Attributes}
    | {readonly kind: "ref"; readonly attributes: Attributes}
    | {readonly kind: "if"; readonly attributes: Attributes; readonly branches: readonly DraftBranch[]}
    /** 图片、没登记的标签、跨行条件的零件：浮层只给看原文与删掉。 */
    | {readonly kind: "other"; readonly source: string};

const attributesOf = (tag: LexedTag): Attributes => tag.attributes.map((item) => [item.name, item.value] as const);

/** 属性的值；没有时为 undefined。 */
export function attributeOf(draft: {readonly attributes: Attributes}, name: string): string | undefined {
    return draft.attributes.find(([attribute]) => attribute === name)?.[1];
}

/** 换掉一项属性的值（没有就加在末尾）；`value` 为 null 时去掉这一项。 */
export function withAttribute(attributes: Attributes, name: string, value: string | null): Attributes {
    const kept = attributes.filter(([attribute]) => attribute !== name);
    if (value === null) return kept;
    const at = attributes.findIndex(([attribute]) => attribute === name);
    if (at < 0) return [...kept, [name, value]];
    return [...kept.slice(0, at), [name, value], ...kept.slice(at)];
}

/**
 * 读一个小块的原文。条件是整段（`<If …>甲<ElseIf … />乙<Else />丙</If>`，富文本里成组的条件都写在一行）：按最外层的 `If`、`ElseIf`、`Else`、
 * 闭标签切开各支，支里的 `V`、`Ref` 留在支的文字里。读不成这些形状的（套着的条件不会成组，到不了这里）算 `other`。
 */
export function draftOf(source: string): ChipDraft {
    const tags = lexTags(source);
    const first = tags[0];
    if (first === undefined) return {kind: "other", source};
    if (first.name === "If" && first.kind === "open") return conditionDraft(source, tags) ?? {kind: "other", source};
    if (tags.length !== 1 || first.start !== 0 || first.end !== source.length) return {kind: "other", source};
    if (first.name === "V" && first.kind === "self") {
        return {kind: first.attributes.some((item) => item.name === "expr") ? "calc" : "value", attributes: attributesOf(first)};
    }
    if (first.name === "Ref" && first.kind === "self") return {kind: "ref", attributes: attributesOf(first)};
    return {kind: "other", source};
}

function conditionDraft(source: string, tags: readonly LexedTag[]): ChipDraft | null {
    const open = tags[0]!;
    const close = tags.at(-1)!;
    if (open.start !== 0 || close.end !== source.length || close.name !== "If" || close.kind !== "close") return null;
    const heads = tags.filter((tag) => (tag.name === "ElseIf" || tag.name === "Else") && tag.kind === "self");
    if (tags.some((tag) => tag !== open && tag !== close && tag.name === "If")) return null;
    const branches: DraftBranch[] = [];
    let test: string | null = open.attributes.find((item) => item.name === "test")?.value ?? "";
    let from = open.end;
    for (const head of heads) {
        branches.push({test, text: source.slice(from, head.start)});
        test = head.name === "Else" ? null : (head.attributes.find((item) => item.name === "test")?.value ?? "");
        from = head.end;
    }
    branches.push({test, text: source.slice(from, close.start)});
    // “否则”之后还有支：不是浮层能画的形状（内核会报错），交给源文字。
    if (branches.slice(0, -1).some((branch) => branch.test === null)) return null;
    return {kind: "if", attributes: attributesOf(open), branches};
}

/** 拼回原文。条件的各支按先后写：第一支在开标签上，有判断的写 `ElseIf`，没有的写 `Else`。 */
export function sourceOf(draft: ChipDraft): string {
    switch (draft.kind) {
        case "other":
            return draft.source;
        case "value":
        case "calc":
            return tagText("V", draft.attributes, "self");
        case "ref":
            return tagText("Ref", draft.attributes, "self");
        case "if": {
            const [first, ...rest] = draft.branches;
            const open = tagText("If", withAttribute(draft.attributes, "test", first?.test ?? ""), "open");
            const middle = rest.map((branch) => `${branch.test === null ? tagText("Else", [], "self") : tagText("ElseIf", [["test", branch.test]], "self")}${branch.text}`).join("");
            return `${open}${first?.text ?? ""}${middle}${tagText("If", [], "close")}`;
        }
    }
}

/**
 * 在“否则”之前加一支“否则如果”，判断先抄第一支的（作者多半是在它上面改一个数）。没有“否则”时加在最后。
 */
export function withElseIf(branches: readonly DraftBranch[]): DraftBranch[] {
    const at = branches.findIndex((branch) => branch.test === null);
    const added: DraftBranch = {test: branches[0]?.test ?? "", text: ""};
    const list = [...branches];
    list.splice(at < 0 ? list.length : at, 0, added);
    return list;
}

/** 属性值里不能有双引号：标签的属性只认双引号括起来的值，里面再有双引号会把标签切坏（式子里的字符串用单引号）。 */
export function quoteProblem(draft: ChipDraft): boolean {
    if (draft.kind === "other") return false;
    const values = draft.attributes.map(([, value]) => value);
    if (draft.kind === "if") values.push(...draft.branches.flatMap((branch) => (branch.test === null ? [] : [branch.test])));
    return values.some((value) => value.includes('"'));
}
