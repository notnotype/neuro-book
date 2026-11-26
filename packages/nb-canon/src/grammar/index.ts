/**
 * `@notnotype/nb-canon/grammar`：条目主文字的写法（docs/specs/canon/rendering.md）。纯 TS，只依赖 `@notnotype/nb-markdown/marked`、
 * `marked` 与 `acorn`，浏览器（编辑器、阅读视图）与后端（内核）共用同一份，读法与检查的结果逐字相同。
 */

export {lexTags, atomSpanOf, tagText, escapeDecoration, agentJson, normalizeEntrySource, positionOf} from "./tags";
export type {LexedTag, TagAttribute, TagKind} from "./tags";
export {entryLexing, parseEntryText, childLists} from "./parse";
export type {EntryIfToken, EntryTag, EntryTagToken, GrammarCode, GrammarProblem, ParsedEntryText, TagPlace} from "./parse";
export {checkEntryText, BUILTIN_TAGS} from "./check";
export type {CheckOptions, CheckProblem} from "./check";
export {evaluate, hasField, memberReference, parseAddress, parseExpression} from "./expression";
export type {Evaluated, ExpressionError, ExpressionResult, FieldReference, ParsedExpression, Resolved} from "./expression";
export {canonicalEntryText, decorateEntryText, rewriteEntryIds, stripEntryText} from "./text";
export type {Decoration} from "./text";
