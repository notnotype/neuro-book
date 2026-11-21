/**
 * v1 到 v2 的读法（docs/specs/models/service.md“输入与前置条件”）：设置里每个服务商新旧形状都可能出现，读的时候按 v1 运行时的
 * 语义归一成 `ProviderConfig`，第一次写入才整份换成新形状。纯函数，浏览器与服务端共用。
 *
 * v1 运行时的语义（`nb-harness` 旧的 `target.ts`）：
 * - 目录服务商的 `api` 不起作用，`baseUrl` 是覆盖；条目只认 `enabled`、`name`、`price`、`headers` 与压缩触发点（`group` 只分组）。
 *   别的字段（写在目录条目上的 `contextWindow`、`vision` 等）本来就被忽略，归一时丢掉，首次写入后不再保留。
 * - 自定义服务商的字段全部起作用。
 * - 目录服务商只有显式加入的模型，没有“跟随来源”，所以 `followSource: false`。
 */

import {BLANK_API} from "./shapes";
import type {BlankTemplate, LegacyProviderConfig, ModelConfig, ProviderConfig, StoredProvider} from "./shapes";

/** v1 行没有 `uid`：用服务商 id 派生一个固定值，首次写入时原样保留（新建的服务商一律是随机值，不会与它重合）。 */
export const legacyUid = (id: string): string => `legacy:${id}`;

const isLegacy = (provider: StoredProvider): provider is LegacyProviderConfig => "kind" in provider;

function legacyModel(model: ModelConfig, catalog: boolean): ModelConfig {
    if (!catalog) return {...model, origin: model.origin ?? "manual"};
    return {
        id: model.id,
        enabled: model.enabled,
        origin: "source",
        ...(model.name === undefined ? {} : {name: model.name}),
        ...(model.group === undefined ? {} : {group: model.group}),
        ...(model.compactAt === undefined ? {} : {compactAt: model.compactAt}),
        ...(model.compaction === undefined ? {} : {compaction: model.compaction}),
        ...(model.price === undefined ? {} : {price: model.price}),
        ...(model.headers === undefined ? {} : {headers: model.headers}),
    };
}

export function normalizeProvider(stored: StoredProvider): ProviderConfig {
    if (!isLegacy(stored)) return structuredClone(stored);
    const catalog = stored.kind === "catalog";
    const template: string = catalog ? stored.id : stored.api === "anthropic-messages" ? "blank-anthropic" : "blank-openai";
    return {
        id: stored.id,
        uid: legacyUid(stored.id),
        template,
        name: stored.name,
        // 目录服务商旧的 `api` 不是覆盖；自定义服务商的协议与空白模板的缺省不同时才写出来。
        ...(!catalog && stored.api !== undefined && stored.api !== BLANK_API[template as BlankTemplate] ? {api: stored.api} : {}),
        ...(stored.baseUrl === undefined ? {} : {baseUrl: stored.baseUrl}),
        ...(stored.apiKeyEnv === undefined ? {} : {apiKeyEnv: stored.apiKeyEnv}),
        auth: stored.auth,
        ...(stored.headers === undefined ? {} : {headers: structuredClone(stored.headers)}),
        followSource: false,
        excluded: [],
        models: stored.models.map((model) => legacyModel(structuredClone(model), catalog)),
    };
}

export const normalizeProviders = (stored: readonly StoredProvider[]): ProviderConfig[] => stored.map(normalizeProvider);
