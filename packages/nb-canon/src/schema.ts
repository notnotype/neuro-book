/**
 * 子路径 `@notnotype/nb-canon/schema`：对象、修订与写入请求的 schema 与类型，Component 声明的登记校验。不带引擎与
 * 渲染（MDX 解析链），只依赖 TypeBox：浏览器里只做远程合同与贡献点校验的代码引它，不必载入整个内核。
 */

export * from "./core/schema";
export {buildRegistry, type ComponentDeclaration, type ComponentRegistry, type ComponentType, type RegistryDiagnostic} from "./components/registry";
export type {EntryView, Mode, PendingItem} from "./engine/types";
export {valueAt, type ViewValue} from "./core/view-value";
export type {DecisionView} from "./world/decisions";
