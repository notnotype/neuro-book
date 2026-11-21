/**
 * `@notnotype/nb-harness/models`：模型目录、按配置建出模型端口的解析结果、凭据库与 `env:` 引用。给宿主实现模型端口用
 * （应用的模型服务），不随旧 harness 退役（docs/specs/models/service.md）。
 */

export type {CatalogModel, CatalogProvider, CatalogSuggestion, DiscoveredModel, DiscoverModelsOptions, DiscoveryResult, ModelPrice, ProviderAccess, ThinkingEffort, WireApi} from "./catalog.js";
export {catalogModel, chatModels, clampEffort, discoverModels, listCatalog, providerAccess, suggestFromCatalog, supportedEfforts, templateRoutes, THINKING_EFFORTS, wireApiOf} from "./catalog.js";
export {reasoningOf, requestEffort} from "../kernel/index.js";
export type {ModelReasoning, ReasoningOff, RequestEffort} from "../kernel/index.js";
export type {CredentialStore} from "./credentials.js";
export {openCredentials} from "./credentials.js";
export type {StartupEnv} from "./env.js";
export {ENV_PREFIX, envRefName, envValue, isEnvName} from "./env.js";
export type {AuthMode, BuildResult, BuiltModel, CustomApi, KeyAccess, ModelTarget, ProviderTarget, ResolveHooks} from "./target.js";
export {buildResolution, hasCredential, NEUTRAL_PROVIDER, requestAuth, wireGuard} from "./target.js";
