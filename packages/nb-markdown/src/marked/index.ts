/**
 * `@notnotype/nb-markdown/marked`：不带编辑器的 Markdown 词法（docs/specs/workspace/markdown-syntaxes.md）。只引 `marked`、
 * `marked-cjk-friendly` 与本包的纯 TS 文件，后端也能用（世界引擎内核读条目的主文字）。编辑器的语言建在同一份上，读法不分叉。
 *
 * 这里的类型直接用到 `marked` 的类型，随 `marked` 升级可能不兼容（同 `./language`）。
 */

export {ATOM_CAPACITY, atomAt, createLexing, isAtomIdentity, lexAtoms, PLACEHOLDER_SOURCE, placeholderAt} from "./lexing";
export {nextMatch} from "../language/syntax/tags";
export type {Atom, AtomPlacement, AtomSpan, LexedAtoms, Lexing, MarkdownLexing} from "./lexing";
export {cellCount, coreLexing, isBreakOnlyHtml} from "./core";
