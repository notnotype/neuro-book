/**
 * 方言声明（docs/specs/workspace/markdown-syntaxes.md）：贡献点 `markdown.dialects` 的声明形状与校验，以及内置方言的声明。
 *
 * 声明是顶层贡献，浏览器与项目两个位置都登记：字数要在项目进程里按它算，那里没有语法模块。
 */

import {Type} from "typebox";
import type {Static} from "typebox";
import {Value} from "typebox/value";

import type {ContributionDescriptor} from "@notnotype/nb-runtime/plugins";

export const MARKDOWN_DIALECTS_POINT = "markdown.dialects";
export const MARKDOWN_SYNTAXES_POINT = "markdown.syntaxes";

const TAG = Type.String({pattern: "^[a-z][a-z0-9-]*$"});

export const DialectDeclarationSchema = Type.Object({
    /** 同一种词法单元有几种方言认领时，小的先试；相同按 id 的码元顺序。 */
    order: Type.Integer(),
    blockTags: Type.Optional(Type.Array(TAG)),
    inlineTags: Type.Optional(Type.Array(TAG)),
    /** 标签里的字计不计；没列出的声明标签计入。属性一律不计。 */
    tagWords: Type.Optional(Type.Array(Type.Object({tag: TAG, content: Type.Union([Type.Literal("count"), Type.Literal("skip")])}, {additionalProperties: false}))),
}, {additionalProperties: false});

export type DialectDeclaration = Static<typeof DialectDeclarationSchema>;

/** 贡献 id 要以贡献方的插件 id 加 `.` 开头：声明与实现按 id 配对，配对因此只在同一插件里（输出 11）。 */
function idProblem(descriptor: ContributionDescriptor): string | null {
    return descriptor.id.startsWith(`${descriptor.plugin}.`) && descriptor.id.length > descriptor.plugin.length + 1 ? null : `方言 id 要以插件 id 加“.”开头：${descriptor.id}`;
}

export function validateDialectDeclaration(descriptor: ContributionDescriptor): string | null {
    const id = idProblem(descriptor);
    if (id !== null) return id;
    if (!Value.Check(DialectDeclarationSchema, descriptor.declaration)) {
        const first = [...Value.Errors(DialectDeclarationSchema, descriptor.declaration)][0];
        return `方言 ${descriptor.id} 的声明不合格：${first === undefined ? "" : `${first.instancePath === "" ? "/" : first.instancePath}：${first.message}`}`;
    }
    const declaration = descriptor.declaration as DialectDeclaration;
    const tags = [...(declaration.blockTags ?? []), ...(declaration.inlineTags ?? [])];
    const missing = (declaration.tagWords ?? []).find((rule) => !tags.includes(rule.tag));
    if (missing !== undefined) return `方言 ${descriptor.id} 的 tagWords 里的标签没有声明：${missing.tag}`;
    return null;
}

/** 方言实现的声明是空对象：实现的内容全在 `load()` 交出的语法模块里。 */
export function validateSyntaxContribution(descriptor: ContributionDescriptor): string | null {
    if (descriptor.location !== "browser") return `${MARKDOWN_SYNTAXES_POINT} 只接受浏览器入口的贡献`;
    const id = idProblem(descriptor);
    if (id !== null) return id;
    const declaration = descriptor.declaration;
    return typeof declaration === "object" && declaration !== null && Object.keys(declaration).length === 0 ? null : `方言实现 ${descriptor.id} 的声明要是空对象`;
}

/**
 * 内置方言（输出 1）：声明投到 `markdown.dialects`，实现是 nb-markdown 的内置语法模块，由 `nbook.markdown` 直接持有、不经
 * 贡献点（`web/builtin-syntaxes.ts`）。`order` 与标签名与各语法模块一致（`web/word-count.test.ts` 核对）。核心语法不是方言，
 * 排在全部方言之后。
 */
export const BUILTIN_DIALECTS: Readonly<Record<string, DialectDeclaration>> = {
    "nbook.markdown.comment": {order: 10, blockTags: ["comment"], inlineTags: ["comment", "inline-comment"]},
    "nbook.markdown.callout": {order: 20},
    "nbook.markdown.align": {order: 30, blockTags: ["align"]},
    "nbook.markdown.bilingual": {order: 40, blockTags: ["bilingual"]},
    "nbook.markdown.html-embed": {order: 50, blockTags: ["html"]},
    "nbook.markdown.ruby": {order: 60, inlineTags: ["ruby"]},
    "nbook.markdown.text-marks": {order: 70, inlineTags: ["span", "mark", "sup", "sub"]},
    "nbook.markdown.sticker": {order: 80},
};
