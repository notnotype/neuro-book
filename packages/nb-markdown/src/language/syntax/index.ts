/**
 * 内置的语法模块：核心语法与八种内置方言（docs/specs/workspace/markdown-syntaxes.md 输出 1）。宿主可以只用它们
 * （`defaultMarkdownLanguage()`），也可以把自己的方言按 `order` 插在它们之间组成语言（neuro-book 的 `language-registry.ts`）。
 *
 * `order` 是同一种词法单元有几种方言认领时的先后，小的先试；neuro-book 的方言声明（`shared/dialects.ts`）写着同样的数字，
 * 它的测试逐项核对。核心语法不是方言，排在全部方言之后。
 */

import {flattenExtensions} from "@tiptap/core";

import {namesOf} from "../../names";
import {createMarkdownLanguage} from "../language";
import type {MarkdownLanguage} from "../language";
import {alignSyntax} from "./align";
import {bilingualSyntax} from "./bilingual";
import {calloutSyntax} from "./callout";
import {commentSyntax} from "./comment";
import {coreSyntax} from "./core";
import {htmlEmbedSyntax} from "./html-embed";
import {createRawSyntax} from "./raw";
import {rubySyntax} from "./ruby";
import {stickerSyntax} from "./sticker";
import {textMarksSyntax} from "./text-marks";
import type {MarkdownSyntax} from "./types";

export interface BuiltinSyntax {
    /** 方言名；neuro-book 的声明 id 是 `nbook.markdown.<name>`。 */
    readonly name: string;
    readonly order: number;
    readonly syntax: MarkdownSyntax;
}

const BUILTIN: ReadonlyArray<BuiltinSyntax> = [
    {name: "comment", order: 10, syntax: commentSyntax},
    {name: "callout", order: 20, syntax: calloutSyntax},
    {name: "align", order: 30, syntax: alignSyntax},
    {name: "bilingual", order: 40, syntax: bilingualSyntax},
    {name: "html-embed", order: 50, syntax: htmlEmbedSyntax},
    {name: "ruby", order: 60, syntax: rubySyntax},
    {name: "text-marks", order: 70, syntax: textMarksSyntax},
    {name: "sticker", order: 80, syntax: stickerSyntax},
];

export {coreSyntax};

/** 内置方言，按 `order` 排好。 */
export const builtinSyntaxes = (): ReadonlyArray<BuiltinSyntax> => BUILTIN;

let shared: MarkdownLanguage | null = null;

/** 只有内置方言与核心语法的语言（第一次用时建，之后共用）：宿主没有自己的方言时用它。 */
export function defaultMarkdownLanguage(): MarkdownLanguage {
    shared ??= createMarkdownLanguage([...BUILTIN.map((entry) => entry.syntax), coreSyntax]);
    return shared;
}

/**
 * 一种语法占用的全部名字：`namesOf` 的那些，加上组合扩展展开后的子扩展（`StarterKit` 里的 `bold`）。展开要用编辑内核，所以不在
 * 纯 TS 入口里。
 */
export const syntaxNames = (syntax: MarkdownSyntax): ReadonlyArray<string> => [...new Set([...namesOf(syntax), ...flattenExtensions([...syntax.extensions]).map((extension) => `type:${extension.name}`)])];

let reserved: ReadonlySet<string> | null = null;

/** 内置方言、核心语法与组装时追加的原样语法占用的全部名字；宿主的方言与它们撞名就不能生效（markdown-syntaxes 输出 4）。 */
export function reservedSyntaxNames(): ReadonlySet<string> {
    reserved ??= new Set([...BUILTIN.map((entry) => entry.syntax), coreSyntax, createRawSyntax({blockTags: [], inlineTags: []})].flatMap(syntaxNames));
    return reserved;
}
