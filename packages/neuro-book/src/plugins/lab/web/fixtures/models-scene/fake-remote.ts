/**
 * 模型服务两页在 Lab 里用的远程合同替身：快照在内存里，写方法照服务端的语义改快照并推 `changed`（docs/specs/models/service.md
 * 输出 12 到 15 里页面看得到的部分）。只服务 Lab 场景，不进测试：页面与服务端的真实来回由 `e2e/models.e2e.ts` 验。
 * 检测与拉取不发请求，给固定的结果；`failWrites` 打开时所有写方法以 `settings-unavailable` 失败（看窗口通知）。
 */

import type {RemoteSubscription} from "@notnotype/nb-runtime/remote";

import type {CheckResult, KeyStatus, ModelsSnapshot, SnapshotModel, SnapshotProvider} from "nbook/plugins/models/shared/contracts";
import {providerIdFor, referenceOf} from "nbook/plugins/models/shared/rules";
import type {ModelConfig} from "nbook/plugins/models/shared/settings";
import type {ModelsRemote} from "nbook/plugins/models/web/models-store";

import {SAMPLE_CANDIDATES, SAMPLE_CATALOG, sampleModel} from "./sample";

export interface FakeModelsRemote {
    readonly remote: ModelsRemote;
    failWrites(on: boolean): void;
}

const ok = <T>(value: T) => ({ok: true as const, value});

export function createFakeModelsRemote(initial: ModelsSnapshot, options: {readonly unavailable?: boolean} = {}): FakeModelsRemote {
    let state: ModelsSnapshot = structuredClone(initial);
    let failing = false;
    const listeners = new Set<(snapshot: ModelsSnapshot) => void>();
    const publish = (next: ModelsSnapshot): void => {
        state = next;
        for (const listener of listeners) listener(structuredClone(state));
    };
    const unavailable = {ok: false as const, code: "unavailable" as const, detail: "Lab 场景：模型服务没有运行"};
    const writeFailure = {ok: false as const, code: "settings-unavailable" as const, detail: {code: "write-failed", detail: "Lab 场景：写不进去"}};

    const withProvider = (id: string, change: (provider: SnapshotProvider) => SnapshotProvider) => {
        if (failing) return writeFailure;
        if (!state.providers.some((provider) => provider.id === id)) return {ok: false as const, code: "unknown-provider" as const, detail: {detail: id}};
        publish({...state, providers: state.providers.map((provider) => (provider.id === id ? change(provider) : provider))});
        return ok(null);
    };
    const toSnapshot = (config: ModelConfig, previous?: SnapshotModel): SnapshotModel => sampleModel(config.id, {
        ...previous,
        name: config.name ?? previous?.name ?? config.id,
        enabled: config.enabled,
        ...(config.group === undefined ? {} : {group: config.group}),
        ...(config.contextWindow === undefined ? {} : {contextWindow: config.contextWindow}),
        ...(config.maxOutput === undefined ? {} : {maxOutput: config.maxOutput}),
        ...(config.vision === undefined ? {} : {vision: config.vision}),
        ...(config.reasoning === undefined ? {} : {reasoning: config.reasoning}),
        compactAt: config.compactAt ?? null,
        ...(config.price === undefined ? {} : {price: config.price}),
        headers: {...config.headers},
        status: (config.contextWindow ?? previous?.contextWindow ?? null) === null ? "incomplete" : "ok",
    });
    const unbind = (provider: string, models?: readonly string[]): ModelsSnapshot["roles"] => state.roles.map((role) => {
        const hit = role.model !== null && role.model.startsWith(`${provider}/`) && (models === undefined || models.includes(role.model.slice(provider.length + 1)));
        return hit ? {...role, model: null, status: "unbound"} : role;
    });
    const key = (provider: string, status: KeyStatus) => {
        const result = withProvider(provider, (item) => ({...item, key: status}));
        return result.ok ? ok(status) : result;
    };

    const remote: ModelsRemote = {
        catalogProviders: async () => ok(SAMPLE_CATALOG.map((item) => ({...item, added: state.providers.some((provider) => provider.id === item.id)}))),
        catalogModels: async ({provider}) => ok(state.providers.find((item) => item.id === provider)?.models.map((model) => ({id: model.id, name: model.name, contextWindow: model.contextWindow, maxOutput: model.maxOutput, vision: model.vision, reasoning: model.reasoning, efforts: model.efforts, price: model.price})) ?? []),
        snapshot: async () => (options.unavailable === true ? unavailable : ok(structuredClone(state))),
        addProvider: async ({source}) => {
            if (failing) return writeFailure;
            const id = source.kind === "catalog" ? source.id : providerIdFor(source.name, new Set(state.providers.map((provider) => provider.id)));
            const name = source.kind === "catalog" ? SAMPLE_CATALOG.find((item) => item.id === source.id)?.name ?? source.id : source.name;
            publish({...state, providers: [...state.providers, {id, kind: source.kind, name, baseUrl: source.kind === "custom" ? source.baseUrl : `https://api.${id}.example`, catalogBaseUrl: source.kind === "catalog" ? `https://api.${id}.example` : null, api: source.kind === "custom" ? source.api : "openai-completions", auth: "default", headers: {}, key: {kind: "none"}, models: []}]});
            return ok({id});
        },
        updateProvider: async ({id, patch}) => withProvider(id, (provider) => ({
            ...provider,
            ...(patch.name === undefined ? {} : {name: patch.name}),
            ...(patch.baseUrl === undefined ? {} : {baseUrl: patch.baseUrl ?? provider.catalogBaseUrl}),
            ...(patch.api === undefined ? {} : {api: patch.api}),
            ...(patch.auth === undefined ? {} : {auth: patch.auth}),
            ...(patch.headers === undefined ? {} : {headers: patch.headers}),
        })),
        removeProvider: async ({id}) => {
            if (failing) return writeFailure;
            publish({providers: state.providers.filter((provider) => provider.id !== id), roles: unbind(id)});
            return ok(null);
        },
        upsertModel: async ({provider, model}) => withProvider(provider, (item) => {
            const previous = item.models.find((existing) => existing.id === model.id);
            const next = toSnapshot(model, previous);
            return {...item, models: previous === undefined ? [...item.models, next] : item.models.map((existing) => (existing.id === model.id ? next : existing))};
        }),
        removeModel: async ({provider, id}) => {
            const result = withProvider(provider, (item) => ({...item, models: item.models.filter((model) => model.id !== id)}));
            if (result.ok) publish({...state, roles: unbind(provider, [id])});
            return result;
        },
        setModels: async ({provider, add, remove}) => {
            const result = withProvider(provider, (item) => ({...item, models: [...item.models.filter((model) => !remove.includes(model.id)), ...add.map((model) => toSnapshot(model))]}));
            if (result.ok) publish({...state, roles: unbind(provider, remove)});
            return result;
        },
        setRole: async ({id, model}) => {
            if (failing) return writeFailure;
            publish({...state, roles: state.roles.map((role) => (role.id === id ? {...role, model, status: model === null ? "unbound" : "ok"} : role))});
            return ok(null);
        },
        addRole: async ({name, description}) => {
            if (failing) return writeFailure;
            const id = `custom-${String(state.roles.length + 1)}`;
            publish({...state, roles: [...state.roles, {id, axis: "specialist", builtin: false, name, description, model: null, status: "unbound"}]});
            return ok({id});
        },
        updateRole: async ({id, name, description}) => {
            if (failing) return writeFailure;
            publish({...state, roles: state.roles.map((role) => (role.id === id ? {...role, name, description} : role))});
            return ok(null);
        },
        removeRole: async ({id}) => {
            if (failing) return writeFailure;
            publish({...state, roles: state.roles.filter((role) => role.id !== id)});
            return ok(null);
        },
        setKey: async ({provider, value}) => key(provider, value.startsWith("env:") ? {kind: "env", name: value.slice(4), found: false} : {kind: "stored"}),
        clearKey: async ({provider}) => key(provider, {kind: "none"}),
        discover: async () => ok(SAMPLE_CANDIDATES.map((item) => ({id: item.id, name: item.name, suggested: item.incomplete ? null : {contextWindow: 256_000, maxOutput: 32_768, vision: item.vision, reasoning: item.reasoning}}))),
        check: async ({provider, model}) => ok(checkResult(provider, model)),
        checkAll: async ({provider}) => ok(state.providers.find((item) => item.id === provider)?.models.filter((model) => model.enabled).map((model) => ({model: model.id, result: checkResult(provider, model.id)})) ?? []),
        events: {changed: {subscribe: async (_filter, listener) => {
            if (options.unavailable === true) return unavailable;
            listeners.add(listener);
            listener(structuredClone(state));
            const subscription: RemoteSubscription = {release: () => listeners.delete(listener)};
            return ok(subscription);
        }}},
    };
    return {remote, failWrites: (on) => {
        failing = on;
    }};
}

/** 示例里 Anthropic 的密钥变量没有值：它的模型检测失败（鉴权），其余通过。 */
function checkResult(provider: string, model: string): CheckResult {
    if (provider === "anthropic") return {ok: false, kind: "auth", code: "401", raw: `{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}} (${referenceOf(provider, model)})`};
    return {ok: true};
}
