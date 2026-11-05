/**
 * 子路径 `@notnotype/nb-canon/schema`：对象、修订与写入请求的 schema 与类型，Component 声明的登记校验。不带引擎与
 * 渲染（MDX 解析链），只依赖 TypeBox：浏览器里只做远程合同与贡献点校验的代码引它，不必载入整个内核。
 */

export * from "./core/schema";
export {buildRegistry, type ComponentDeclaration, type ComponentRegistry, type ComponentType, type RegistryDiagnostic} from "./components/registry";
export type {EntryView, Mode, PendingItem} from "./engine/types";
export {valueAt, type ViewValue} from "./core/view-value";
export type {DecisionView} from "./world/decisions";
export type {CanonHint, GroupItem, PendingPage} from "./service/pending-groups";
export type {DiagnosticCompute, Finding, FindingAt} from "./service/diagnostics";
export type {CanonReadView, ReadStamp} from "./service/reads";
export type {NeededAuthorization} from "./world/authorization";
export type {TellingHint, TellingItem} from "./service/reads";
export type {ViewDenial, ViewedPage, ViewedReads, ViewGrant} from "./service/views";
