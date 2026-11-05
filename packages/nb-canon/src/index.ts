/**
 * `@notnotype/nb-canon` 的主入口：前后端共用，不引用 `node:*`（tests/architecture.test.ts）。
 * 行为合同见 docs/specs/canon/。
 */

export * from "./core/schema";
export {valueAt, type ViewValue} from "./core/view-value";
export {addressKey, addressesOverlap, formatPath, parsePath, type ParsedPath} from "./core/address";
export {addExact, exactProblem, subtractExact, EXACT_DECIMALS, EXACT_LIMIT, type ExactProblem} from "./core/decimal";
export {compareIds, IdAllocator, ID_PREFIX, LOCAL_ID_PREFIX, splitId} from "./core/ids";
export {ENABLE_FIELD, isIdentifierName, isNamespaceName, RESERVED_ROOTS} from "./core/identifiers";
export {parseChineseNumber, readNumbers} from "./core/numerals";
export {idListsOf} from "./core/id-lists";
export {applyChanges, diffValues, parseSegments, type FieldChange, type IdListMatcher, type PathSegment} from "./core/paths";
export {
    allPositions,
    chapterEnd,
    chapterStart,
    ChapterOrder,
    compareRanks,
    compareTie,
    defaultPosition,
    placementRank,
    positionRank,
    rankBefore,
    type OrderTie,
    type Rank,
} from "./core/position";
export {canonicalJson, sameJson, stableStringify} from "./core/stable-json";
export {buildRegistry, effectiveFields, fieldsProblem, generateFieldId, type ComponentDeclaration, type ComponentRegistry, type ComponentType, type RegistryDiagnostic} from "./components/registry";
export {buildMarkRegistry, EMPTY_MARK_REGISTRY, type MarkDeclaration, type MarkRefKind, type MarkRegistry, type MarkRegistryDiagnostic, type MarkTarget, type MarkType} from "./components/marks";
export {buildDiagnosticRegistry, EMPTY_DIAGNOSTIC_REGISTRY, stableKeyProblem, type DiagnosticDeclaration, type DiagnosticKeyPart, type DiagnosticRegistry, type DiagnosticRegistryDiagnostic} from "./components/diagnostics-registry";
export type {PluginContribution} from "./components/declarations";
export {assetPathProblem, listItemProblem, semanticText, valueProblem, type ValueProblem} from "./components/values";
export {createIncrementalEngine, type ChangedRefs, type IncrementalEngine} from "./engine/incremental";
export {createReferenceEngine} from "./engine/reference";
export type {ChangeOutcome, Engine, EngineInputs, EntryView, FieldState, Mode, NamespaceView, OriginStep, PendingItem, PlanProgress, ReductionInput, ReductionLookup, UpcomingNamespace, WorldData} from "./engine/types";
export {World, type ChapterLine, type ConflictDetail, type Problem, type RevertFailure, type RevertMeta, type WorldOptions, type WriteFailure, type WriteResult} from "./world/world";
export {authorizationBinds, fieldsDigest, requestDigest, signedContent, type NeededAuthorization, type RevertRequest} from "./world/authorization";
export {NO_REASON, type DecisionView, type Transition} from "./world/decisions";
export {editInPlace, recordDelta, replaceOnce, type EditFailure, type EditResult, type InPlaceEdit} from "./world/edits";
export {blockProblem, parseBlock, type ExpressionSite, type FieldReference, type ParsedBlock, type SyntaxCode, type SyntaxProblem} from "./render/syntax";
export {annotation, displayText, evaluate, renderBlockForAgent, renderBlockForAuthor, resolverFor, type AgentBlock, type AuthorBlock, type AuthorNode, type Evaluated, type RenderContext, type Resolve, type Resolved} from "./render/render";
export {renderEntryForAgent, renderEntryForAuthor, splitBlocks, type EntryRender} from "./render/entry";
export {scanAnnotations, writeBack, type WriteBackFailure, type WriteBackInput, type WriteBackResult} from "./render/writeback";
