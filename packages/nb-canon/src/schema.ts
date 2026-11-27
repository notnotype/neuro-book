/**
 * 子路径 `@notnotype/nb-canon/schema`：对象、修订与写入请求的 schema 与类型，Component 声明的登记校验。不带引擎与
 * 渲染（marked 与条目文法），只依赖 TypeBox：浏览器里只做远程合同与贡献点校验的代码引它，不必载入整个内核。
 */

export * from "./core/schema";
export {buildRegistry, type ComponentDeclaration, type ComponentRegistry, type ComponentType, type RegistryDiagnostic} from "./components/registry";
export type {ChangedAt, ChangeOutcome, EntryView, EventKey, FieldState, Mode, NamespaceView, OriginStep, PendingItem, PlanProgress} from "./engine/types";
export {paragraphsOf, type Occurrence, type TellingPosition} from "./world/tellings";
export {valueAt, type ViewValue} from "./core/view-value";
export {displayText} from "./core/display";
/** 作品内路径的规则（components.md 输出 15）：浏览器里的图片输入先查一遍再交给服务。 */
export {assetPathProblem} from "./components/values";
export type {DecisionView} from "./world/decisions";
export type {CanonHint, GroupItem, PendingPage} from "./service/pending-groups";
export type {DiagnosticCompute, Finding, FindingAt} from "./service/diagnostics";
export type {CanonReadView, ReadStamp} from "./service/reads";
export type {PlainBlock, PlainProblem} from "./render/render";
export type {PlainOptions} from "./render/entry";
export type {NeededAuthorization} from "./world/authorization";
export type {EntryEditFailure, EntryEdits, EntryOp, NewEntry, StaleRead} from "./world/entry-edits";
export type {TextBlockInfo, TextBlocksRead} from "./world/text-blocks";
export type {TellingHint, TellingItem} from "./service/reads";
export type {ChapterItem, TreeItem, TreeItemAt, TreePage, ViewDenial, ViewedPage, ViewedReads, ViewGrant} from "./service/views";
export type {EditRoute} from "./world/edits";
export type {DiagnosticDeclaration, DiagnosticKeyPart} from "./components/diagnostics-registry";
export type {MarkDeclaration, MarkRefKind, MarkTarget} from "./components/marks";
/** 规范的 JSON 与按它比较（键排序）：插件比较存下来的值时用，不按对象键的插入顺序。 */
export {canonicalJson, sameJson} from "./core/stable-json";
