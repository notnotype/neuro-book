/**
 * `@notnotype/nb-harness/models`：模型目录、按配置建出模型端口的解析结果、凭据库与 `env:` 引用。给宿主实现模型端口用
 * （NeuroBook 的 `nbook.models`），不随旧 harness 退役（docs/specs/models/service.md）。
 */

export type {CatalogModel, CatalogProvider, CatalogSuggestion, DiscoveredModel, DiscoverModelsOptions, DiscoveryResult, ModelPrice, ProviderAccess, ThinkingEffort} from "./catalog.js";
export {catalogModel, clampEffort, discoverModels, listCatalog, providerAccess, suggestFromCatalog, supportedEfforts, THINKING_EFFORTS} from "./catalog.js";
export type {CredentialStore} from "./credentials.js";
export {openCredentials} from "./credentials.js";
export type {StartupEnv} from "./env.js";
export {ENV_PREFIX, envRefName, envValue, isEnvName} from "./env.js";
export type {AuthMode, BuildResult, CustomApi, KeyAccess, ModelTarget, ProviderTarget} from "./target.js";
export {buildResolution, hasCredential} from "./target.js";
