/**
 * 模型服务两页在 Lab 里用的远程合同替身（合同版本 3）：服务商与模型行在内存里，写方法照服务端的语义改它们并推 `changed`
 * （docs/specs/models/service.md 输出 12 到 15 里页面看得到的部分）。每个返回值与事件都过一遍 JSON 编解码，像真实链路那样不带
 * 共享引用与函数。只服务 Lab 场景，不进测试：页面与服务端的真实来回由 `e2e/models.e2e.ts` 验。
 * 检测与拉取不发请求，给固定的结果；`failWrites` 打开时所有写方法以 `settings-unavailable` 失败（看窗口通知）。
 */

import {providerIdFor, referenceOf} from "@notnotype/nb-models/config";
import type {ModelConfig} from "@notnotype/nb-models/config";
import type {CheckResult, KeyStatus, ModelRow, ModelsSnapshot, SnapshotProvider, SnapshotRole} from "@notnotype/nb-models/contract";
import type {RemoteSubscription} from "@notnotype/nb-runtime/remote";

import type {ModelsRemote} from "nbook/plugins/models/web/models-store";

import {generatedRows, SAMPLE_CANDIDATES, SAMPLE_ROWS, SAMPLE_TEMPLATES, sampleRow} from "./sample";

export interface FakeModelsRemote {
    readonly remote: ModelsRemote;
    failWrites(on: boolean): void;
}

const json = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const ok = <T>(value: T) => ({ok: true as const, value: json(value)});

interface ProviderState {
    meta: SnapshotProvider;
    listed: ModelRow[];
    available: ModelRow[];
    version: number;
}

export function createFakeModelsRemote(initial: ModelsSnapshot, options: {readonly unavailable?: boolean; readonly rows?: Readonly<Record<string, readonly ModelRow[]>>} = {}): FakeModelsRemote {
    const seeded = options.rows ?? SAMPLE_ROWS;
    const providers = new Map<string, ProviderState>(initial.providers.map((meta) => [meta.id, {meta: json(meta), listed: json([...(seeded[meta.id] ?? [])]), available: [], version: 1}]));
    let roles: SnapshotRole[] = json(initial.roles);
    let failing = false;
    const listeners = new Set<(snapshot: ModelsSnapshot) => void>();

    const snapshotOf = (): ModelsSnapshot => ({
        providers: [...providers.values()].map((state) => ({...state.meta, modelCount: state.listed.length, enabledCount: state.listed.filter((row) => row.enabled).length, excludedCount: state.available.length, modelsRevision: `r${String(state.version)}`})),
        roles,
    });
    const publish = (): void => {
        const next = snapshotOf();
        for (const listener of listeners) listener(json(next));
    };
    const unavailable = {ok: false as const, code: "unavailable" as const, detail: "Lab 场景：模型服务没有运行"};
    const writeFailure = {ok: false as const, code: "settings-unavailable" as const, detail: {code: "write-failed", detail: "Lab 场景：写不进去"}};
    const unknown = (id: string) => ({ok: false as const, code: "unknown-provider" as const, detail: {detail: id}});

    const change = (id: string, edit: (state: ProviderState) => void) => {
        if (failing) return writeFailure;
        const state = providers.get(id);
        if (state === undefined) return unknown(id);
        edit(state);
        state.version += 1;
        publish();
        return ok(null);
    };
    const rowOf = (config: ModelConfig, previous?: ModelRow): ModelRow => sampleRow(config.id, {
        ...(previous === undefined ? {origin: "manual" as const} : (({thinking: _derived, ...rest}) => rest)(previous)),
        name: config.name ?? previous?.name ?? config.id,
        enabled: config.enabled,
        ...(config.group === undefined ? {} : {group: config.group}),
        ...(config.contextWindow === undefined ? {} : {contextWindow: config.contextWindow}),
        ...(config.maxOutput === undefined ? {} : {maxOutput: config.maxOutput}),
        ...(config.vision === undefined ? {} : {vision: config.vision}),
        ...(config.reasoning === undefined ? {} : {reasoning: config.reasoning}),
        compaction: config.compaction ?? (config.compactAt === undefined ? null : {mode: "tokens", value: config.compactAt}),
        ...(config.price === undefined ? {} : {price: config.price}),
        headers: {...config.headers},
        status: (config.contextWindow ?? previous?.contextWindow ?? null) === null ? "incomplete" : "ok",
    });
    const unbind = (provider: string, models?: readonly string[]): SnapshotRole[] => roles.map((role) => {
        const hit = role.model !== null && role.model.startsWith(`${provider}/`) && (models === undefined || models.includes(role.model.slice(provider.length + 1)));
        return hit ? {...role, model: null, status: "unbound"} : role;
    });
    const setKey = (id: string, status: KeyStatus) => {
        const result = change(id, (state) => {
            state.meta = {...state.meta, key: status};
        });
        return result.ok ? ok(status) : result;
    };
    const sorted = (rows: readonly ModelRow[]): ModelRow[] => [...rows].sort((a, b) => (a.group === b.group ? (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) : a.group < b.group ? -1 : 1));
    const page = <T>(items: readonly T[], offset: number, limit: number) => ({rows: items.slice(offset, offset + limit), nextOffset: offset + limit < items.length ? offset + limit : null, total: items.length});

    const remote: ModelsRemote = {
        templates: async () => ok(SAMPLE_TEMPLATES),
        snapshot: async () => (options.unavailable === true ? unavailable : ok(snapshotOf())),
        addProvider: async ({template, region, name, baseUrl, api}) => {
            if (failing) return writeFailure;
            const found = SAMPLE_TEMPLATES.find((item) => item.id === template);
            const display = name ?? found?.name ?? template;
            const taken = new Set([...providers.keys()]);
            const id = providerIdFor(display, taken);
            const blank = found?.blank ?? true;
            const rows = blank ? [] : template === "openrouter" ? generatedRows(600) : (SAMPLE_ROWS[template] ?? generatedRows(found?.modelCount ?? 3)).map((row) => ({...row}));
            const state: ProviderState = {
                meta: {
                    id, template, region: region ?? null, name: display, icon: null, baseUrl: baseUrl ?? (blank ? null : `https://api.${id}.example`), templateBaseUrl: blank ? null : `https://api.${id}.example`,
                    api: api ?? "openai-completions", templateApi: "openai-completions", auth: "default", headers: {}, key: {kind: "none"}, followSource: !blank, source: {kind: "packaged"},
                    modelCount: 0, enabledCount: 0, excludedCount: 0, modelsRevision: "r1",
                },
                listed: rows,
                available: [],
                version: 1,
            };
            providers.set(id, state);
            publish();
            return ok({id});
        },
        duplicateProvider: async ({id}) => {
            if (failing) return writeFailure;
            const source = providers.get(id);
            if (source === undefined) return unknown(id);
            const copyId = providerIdFor(`${id}-copy`, new Set(providers.keys()));
            providers.set(copyId, {meta: {...json(source.meta), id: copyId, name: `${source.meta.name} 2`}, listed: json(source.listed), available: json(source.available), version: 1});
            publish();
            return ok({id: copyId});
        },
        updateProvider: async ({id, patch}) => change(id, (state) => {
            const meta = state.meta;
            state.meta = {
                ...meta,
                ...(patch.name === undefined ? {} : {name: patch.name}),
                ...(patch.region === undefined ? {} : {region: patch.region}),
                ...(patch.baseUrl === undefined ? {} : {baseUrl: patch.baseUrl ?? meta.templateBaseUrl}),
                ...(patch.api === undefined ? {} : {api: patch.api ?? meta.templateApi}),
                ...(patch.auth === undefined ? {} : {auth: patch.auth}),
                ...(patch.headers === undefined ? {} : {headers: patch.headers}),
                ...(patch.followSource === undefined ? {} : {followSource: patch.followSource}),
            };
        }),
        setIcon: async ({provider, icon}) => change(provider, (state) => {
            state.meta = {...state.meta, icon: icon === null ? null : icon.kind === "upload" ? {kind: "file", name: `${"a".repeat(64)}.png`} : icon.kind === "builtin" ? {kind: "builtin", key: icon.key} : {kind: "initial"}};
        }),
        removeProvider: async ({id}) => {
            if (failing) return writeFailure;
            providers.delete(id);
            roles = unbind(id);
            publish();
            return ok(null);
        },
        providerModels: async ({provider, scope, offset, limit, revision}) => {
            const state = providers.get(provider);
            if (state === undefined) return unknown(provider);
            if (revision !== undefined && revision !== `r${String(state.version)}`) return {ok: false as const, code: "revision-changed" as const, detail: {detail: provider}};
            const result = page(sorted(scope === "available" ? state.available : state.listed), offset, limit);
            return ok({...result, revision: `r${String(state.version)}`});
        },
        enabledModels: async ({providers: only, usable, offset, limit}) => {
            const items = [...providers.values()].filter((state) => only === undefined || only.includes(state.meta.id)).flatMap((state) => sorted(state.listed).filter((row) => (usable === true ? row.usable : row.enabled)).map((row) => ({provider: state.meta.id, ...row})));
            const result = page(items, offset, limit);
            return ok({...result, revision: [...providers.values()].map((state) => `${state.meta.id}:r${String(state.version)}`).join("|")});
        },
        modelsByReference: async ({references}) => ok(references.map((reference) => {
            const slash = reference.indexOf("/");
            const state = slash < 0 ? undefined : providers.get(reference.slice(0, slash));
            const row = state?.listed.find((item) => item.id === reference.slice(slash + 1)) ?? null;
            return {reference, provider: state?.meta.id ?? null, row};
        })),
        upsertModel: async ({provider, model}) => change(provider, (state) => {
            const previous = state.listed.find((existing) => existing.id === model.id);
            const next = rowOf(model, previous);
            state.listed = previous === undefined ? [...state.listed, next] : state.listed.map((existing) => (existing.id === model.id ? next : existing));
        }),
        removeModel: async ({provider, id}) => {
            const result = change(provider, (state) => {
                state.listed = state.listed.filter((row) => row.id !== id);
            });
            if (result.ok) {
                roles = unbind(provider, [id]);
                publish();
            }
            return result;
        },
        setModels: async ({provider, add, remove}) => {
            const result = change(provider, (state) => {
                const removed = state.listed.filter((row) => remove.includes(row.id));
                state.listed = [...state.listed.filter((row) => !remove.includes(row.id) && !add.some((item) => item.id === row.id)), ...add.map((model) => rowOf(model, state.available.find((row) => row.id === model.id)))];
                state.available = [...state.available.filter((row) => !add.some((item) => item.id === row.id)), ...removed.filter((row) => row.origin === "source")];
            });
            if (result.ok) {
                roles = unbind(provider, remove);
                publish();
            }
            return result;
        },
        setRole: async ({id, model, effort, icon}) => {
            if (failing) return writeFailure;
            const patch = (role: SnapshotRole): SnapshotRole => ({
                ...role,
                ...(model === undefined ? {} : {model, status: model === null ? "unbound" as const : "ok" as const}),
                ...(effort === undefined ? {} : {effort}),
                ...(icon === undefined ? {} : {icon}),
            });
            roles = roles.map((role) => (role.id === id ? patch(role) : role));
            publish();
            return ok(null);
        },
        addRole: async ({name, description}) => {
            if (failing) return writeFailure;
            const id = `custom-${String(roles.length + 1)}`;
            roles = [...roles, {id, axis: "specialist", builtin: false, name, description, model: null, effort: null, icon: null, status: "unbound"}];
            publish();
            return ok({id});
        },
        updateRole: async ({id, name, description}) => {
            if (failing) return writeFailure;
            roles = roles.map((role) => (role.id === id ? {...role, name, description} : role));
            publish();
            return ok(null);
        },
        removeRole: async ({id}) => {
            if (failing) return writeFailure;
            roles = roles.filter((role) => role.id !== id);
            publish();
            return ok(null);
        },
        setKey: async ({provider, value}) => setKey(provider, value.startsWith("env:") ? {kind: "env", name: value.slice(4), found: false} : {kind: "stored"}),
        clearKey: async ({provider}) => setKey(provider, {kind: "none"}),
        discover: async () => ok(SAMPLE_CANDIDATES.map((item) => ({id: item.id, name: item.name, suggested: item.incomplete ? null : {contextWindow: 256_000, maxOutput: 32_768, vision: item.vision, reasoning: item.reasoning}}))),
        check: async ({provider, model}) => ok(checkResult(provider, model)),
        checkAll: async ({provider}) => ok(providers.get(provider)?.listed.filter((model) => model.enabled).map((model) => ({model: model.id, result: checkResult(provider, model.id)})) ?? []),
        events: {changed: {subscribe: async (_filter, listener) => {
            if (options.unavailable === true) return unavailable;
            listeners.add(listener);
            listener(json(snapshotOf()));
            const subscription: RemoteSubscription = {release: () => listeners.delete(listener)};
            return {ok: true as const, value: subscription};
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
