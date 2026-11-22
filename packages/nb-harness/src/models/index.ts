/**
 * `@notnotype/nb-harness/models`：模型目录与在线目录、模型列表请求、按配置建出模型端口的解析结果、凭据库与 `env:` 引用。给宿主实现
 * 模型端口用（应用的模型服务），不随旧 harness 退役（docs/specs/models/service.md）。
 */

export type {CatalogModel, CatalogProvider, CatalogRow, CatalogSuggestion, CatalogView, ModelPrice, ProviderAccess, ThinkingEffort, WireApi} from "./catalog.js";
export {catalogModel, chatModels, clampEffort, createCatalogView, listCatalog, providerAccess, suggestFromCatalog, supportedEfforts, templateRoutes, THINKING_EFFORTS, unsendableReason, wireApiOf} from "./catalog.js";
export type {ListedModel, ListingFailure, ListingFlavor, ListingResult, ListModelsOptions} from "./listing.js";
export {LISTING_LIMITS, listingFlavor, listingHeaders, listingUrl, listModels} from "./listing.js";
export type {FetchOnlineCatalogOptions, OnlineCatalog, OnlineCatalogFetch, OnlineCatalogRow} from "./online-catalog.js";
export {fetchOnlineCatalog, ONLINE_CATALOG_LIMITS, ONLINE_CATALOG_URL, OnlineCatalogError, parseOnlineCatalog} from "./online-catalog.js";
export {reasoningOf, requestEffort} from "../kernel/index.js";
export type {ModelReasoning, ReasoningOff, RequestEffort} from "../kernel/index.js";
export type {CredentialStore} from "./credentials.js";
export {openCredentials} from "./credentials.js";
export type {StartupEnv} from "./env.js";
export {ENV_PREFIX, envRefName, envValue, isEnvName} from "./env.js";
export type {AuthMode, BuildResult, BuiltModel, CustomApi, KeyAccess, ModelTarget, ProviderTarget, ResolveHooks} from "./target.js";
export {buildResolution, hasCredential, NEUTRAL_PROVIDER, requestAuth, wireGuard} from "./target.js";
