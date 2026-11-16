/**
 * `@notnotype/nb-markdown/language`：Markdown 语言（一组语法模块）与编解码器（docs/specs/workspace/markdown-dialect.md）。
 *
 * `MarkdownSyntax` 与它引用的读法、写法类型、标签扫描的工具是贡献方言的宿主插件按着写的公开合同（docs/specs/workspace/
 * markdown-syntaxes.md）；它们直接用到 marked 与编辑内核的类型，随两者升级可能不兼容。
 */

export {createMarkdownLanguage} from "./language";
export type {MarkdownLanguage} from "./language";
export {builtinSyntaxes, coreSyntax, defaultMarkdownLanguage, reservedSyntaxNames, syntaxNames} from "./syntax";
export type {BuiltinSyntax} from "./syntax";
export * from "./syntax/types";
export {blockStart, blockTagExtension, closeBlock, closeInline, lastMatch, lexingInline, nextMatch, openTagAt, openTagIndex, paragraphEnd, skipInline} from "./syntax/tags";
export type {BlockTagToken, OpenTag} from "./syntax/tags";
export {codecFor} from "./codec/codec";
export type {MarkdownCodec} from "./codec/codec";
export {frontmatterOf} from "./codec/read";
export type {ReadResult, SourceMap} from "./codec/read";
export {isWholeFrontmatter} from "./codec/source";
export {equivalent} from "./codec/compare";
export type {CompareOptions} from "./codec/compare";
