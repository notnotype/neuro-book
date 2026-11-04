/**
 * `nbook.models` 服务端的核心（docs/specs/models/service.md）：快照、串行写入、模型端口与给设置页的远程实现。入口
 * （`plugin.ts`）只负责打开凭据库、取依赖与登记清理。
 *
 * 两条贯穿全文件的约束：
 * - 所有写入（两个设置项、凭据库）排进同一个串行队列 `queue`；设置项每次“读本层当前值 → 合并 → 带 `expect` 写回”，
 *   冲突就重读重来（输出 6）。快照的失效也在这条队列之外即时发生：设置的订阅与凭据库的变化通知都只把缓存作废。
 * - `resolve` 同步，读的是缓存的快照与按引用缓存的解析结果；缓存在设置或凭据变化时整体作废（输出 7）。
 */

import type {ConsumerIdentity} from "@notnotype/nb-runtime/services";
import {eventSource} from "@notnotype/nb-runtime/remote";
import type {RemoteImplementation} from "@notnotype/nb-runtime/remote";

import type {ModelPort, ModelQuery, ModelRequest, ModelResolution} from "@notnotype/nb-harness/kernel/contracts";
import {buildResolution, discoverModels, envRefName, envValue, listCatalog, requestAuth} from "@notnotype/nb-harness/models";
import type {CatalogModel, CredentialStore, KeyAccess, ModelTarget, ProviderTarget, StartupEnv} from "@notnotype/nb-harness/models";

import type {SettingDefinition, SettingsService, SettingWriteResult} from "nbook/shared/settings";

import type {CheckResult, KeyStatus, ModelsService, ModelsSnapshot, ProfileModelDefaults, RoleStatus, SnapshotModel, SnapshotProvider} from "../shared/contracts";
import type {modelsSettingsContract} from "../shared/contracts";
import {missingContextWindow, providerIdFor, referenceOf, rolesUsing, seriesOf, splitReference} from "../shared/rules";
import {BUILTIN_ROLES, DEFAULT_ROLES, modelsSettings} from "../shared/settings";
import type {ModelConfig, ProviderConfig, RoleConfig, RolesConfig} from "../shared/settings";

/** 冲突后重读重来的次数（输出 6）。 */
const WRITE_ATTEMPTS = 3;
/**
 * 冲突之后等设置的视图跟上磁盘的上限：冲突说明文件被别处改过，本实例的快照要等拥有者重读、推来才是新的；推不来（例如那次
 * 写入的快照早就到了）就到点照样重试。
 */
const CATCH_UP_MS = 1_000;
/** 检测：最大输出、超时与批量并发（输出 11）。 */
const CHECK_MAX_OUTPUT = 32;
const CHECK_TIMEOUT_MS = 30_000;
const CHECK_CONCURRENCY = 4;

export interface ModelsCoreDeps {
    readonly settings: SettingsService;
    readonly credentials: CredentialStore;
    readonly env: StartupEnv;
    readonly record: (level: "info" | "warn", event: string, message: string, data?: Readonly<Record<string, unknown>>) => void;
}

export interface ModelsCore {
    readonly service: ModelsService;
    remote(consumer: ConsumerIdentity): RemoteImplementation<typeof modelsSettingsContract>;
    /** 等队列里已接纳的写入走完，摘掉订阅；凭据库由入口关。 */
    close(): Promise<void>;
}

/** 写入一步的结果：业务失败按远程合同的码交回。 */
type Failure = {readonly ok: false; readonly code: string; readonly detail: unknown};
type Step<T> = {readonly ok: true; readonly value: T} | Failure;
const failure = (code: string, detail: string, extra: Record<string, unknown> = {}): Failure => ({ok: false, code, detail: {detail, ...extra}});
const BUILTIN = new Set(BUILTIN_ROLES.map((role) => role.id));
/**
 * 把写入步骤的业务失败原样交给远程实现：每个步骤只产生它所在方法在合同里声明过的码（`mutate` 的设置失败映射、各方法自己的
 * 码），类型系统表达不出“这一步只会产生这几种码”，在这一处断言。
 */
const relay = (step: Failure): never => step as never;

export function createModelsCore(deps: ModelsCoreDeps): ModelsCore {
    const {settings, credentials, env} = deps;
    const providersSetting = modelsSettings.settings.providers;
    const rolesSetting = modelsSettings.settings.roles;
    const providers = (): readonly ProviderConfig[] => settings.get(providersSetting) as readonly ProviderConfig[];
    const roles = (): readonly RoleConfig[] => (settings.get(rolesSetting) as RolesConfig).items;
    const access: KeyAccess = {stored: (provider) => credentials.get(provider), env};
    /** 重发归内核（docs/specs/models/service.md 输出 16），所以 HTTP 只发一次。每次请求现读。 */
    const transport = () => ({
        firstEventTimeoutMs: settings.get(modelsSettings.settings.streamFirstEventTimeoutSeconds) * 1000,
        idleTimeoutMs: settings.get(modelsSettings.settings.streamIdleTimeoutSeconds) * 1000,
        maxHttpAttempts: 1,
    });

    // ---- 目录（OMP 内置，进程内不变） ----
    const catalog = new Map(listCatalog().map((provider) => [provider.id, provider]));
    const catalogModel = (provider: string, model: string): CatalogModel | undefined => catalog.get(provider)?.models.find((item) => item.id === model);

    // ---- 快照与解析结果的缓存 ----
    let snapshotCache: ModelsSnapshot | null = null;
    const resolutions = new Map<string, ModelResolution>();
    const listeners = new Set<() => void>();
    // 订阅时先推一次当前快照（先登记再推，期间的变化不会漏，见 eventSource）。
    const changed = eventSource<ModelsSnapshot>({onSubscribe: (_filter, sink) => sink.next(snapshot())});
    const invalidate = (): void => {
        snapshotCache = null;
        resolutions.clear();
        const next = snapshot();
        for (const listener of [...listeners]) listener();
        changed.emit(next);
    };
    const offSettings = settings.onDidChange((keys) => {
        if (keys.has(providersSetting.key) || keys.has(rolesSetting.key)) invalidate();
    });
    const offCredentials = credentials.onChange(invalidate);

    const targetOf = (provider: ProviderConfig): ProviderTarget => ({
        id: provider.id,
        kind: provider.kind,
        auth: provider.auth,
        ...(provider.baseUrl === undefined ? {} : {baseUrl: provider.baseUrl}),
        ...(provider.api === undefined ? {} : {api: provider.api}),
        ...(provider.apiKeyEnv === undefined ? {} : {apiKeyEnv: provider.apiKeyEnv}),
        ...(provider.headers === undefined ? {} : {headers: provider.headers}),
    });
    const modelTargetOf = (model: ModelConfig): ModelTarget => ({
        id: model.id,
        ...(model.name === undefined ? {} : {name: model.name}),
        ...(model.contextWindow === undefined ? {} : {contextWindow: model.contextWindow}),
        ...(model.maxOutput === undefined ? {} : {maxOutput: model.maxOutput}),
        ...(model.vision === undefined ? {} : {vision: model.vision}),
        ...(model.reasoning === undefined ? {} : {reasoning: model.reasoning}),
        ...(model.compactAt === undefined ? {} : {compactAt: model.compactAt}),
        ...(model.price === undefined ? {} : {price: model.price}),
        ...(model.headers === undefined ? {} : {headers: model.headers}),
    });

    const keyStatusOf = (provider: ProviderConfig): KeyStatus => {
        if (provider.auth === "none") return {kind: "keyless"};
        if (provider.apiKeyEnv !== undefined) return {kind: "env", name: provider.apiKeyEnv, found: envValue(env, provider.apiKeyEnv) !== null};
        return credentials.get(provider.id) === null ? {kind: "none"} : {kind: "stored"};
    };
    const keyReady = (status: KeyStatus): boolean => status.kind === "stored" || status.kind === "keyless" || (status.kind === "env" && status.found);

    /** 一个引用解析成什么：模型端口与角色有效性共用，结论一致（输出 8）。 */
    const resolveReference = (reference: string): ModelResolution => {
        const cached = resolutions.get(reference);
        if (cached !== undefined) return cached;
        const result = ((): ModelResolution => {
            const target = splitReference(reference);
            const provider = target === null ? undefined : providers().find((item) => item.id === target.provider);
            const model = target === null || provider === undefined ? undefined : provider.models.find((item) => item.id === target.model);
            if (provider === undefined || model === undefined || !model.enabled || missingContextWindow(provider, model)) return {ok: false, code: "unknown-model"};
            // 目录漂移：设置里还有、目录里没了（输出 9）。先于凭据判断，界面才能指出是模型的问题。
            if (provider.kind === "catalog" && catalogModel(provider.id, model.id) === undefined) return {ok: false, code: "unknown-model"};
            if (!keyReady(keyStatusOf(provider))) return {ok: false, code: "no-credentials"};
            const built = buildResolution(targetOf(provider), modelTargetOf(model), access, transport);
            return built.ok ? built.resolution : {ok: false, code: "unknown-model"};
        })();
        resolutions.set(reference, result);
        return result;
    };
    const resolveRole = (id: string): ModelResolution => {
        const role = roles().find((item) => item.id === id);
        if (role === undefined || role.model === null) return {ok: false, code: "role-unbound"};
        return resolveReference(role.model);
    };

    const roleStatus = (role: RoleConfig): RoleStatus => {
        if (role.model === null) return "unbound";
        const resolution = resolveReference(role.model);
        return resolution.ok ? "ok" : resolution.code === "no-credentials" ? "no-credentials" : "unknown-model";
    };

    const snapshotModel = (provider: ProviderConfig, model: ModelConfig): SnapshotModel => {
        const fromCatalog = provider.kind === "catalog" ? catalogModel(provider.id, model.id) : undefined;
        const catalogPrice = fromCatalog?.price;
        const price = model.price !== undefined ? model.price : catalogPrice === null || catalogPrice === undefined ? null : [catalogPrice.input, catalogPrice.output, catalogPrice.cacheRead ?? 0, catalogPrice.cacheWrite ?? 0] as [number, number, number, number];
        const status = provider.kind === "catalog" ? (fromCatalog === undefined ? "missing" : "ok") : missingContextWindow(provider, model) ? "incomplete" : "ok";
        return {
            id: model.id,
            name: model.name ?? fromCatalog?.name ?? model.id,
            group: model.group ?? seriesOf(model.id),
            enabled: model.enabled,
            contextWindow: model.contextWindow ?? fromCatalog?.contextWindow ?? null,
            maxOutput: model.maxOutput ?? fromCatalog?.maxTokens ?? null,
            vision: model.vision ?? fromCatalog?.images ?? false,
            reasoning: model.reasoning ?? fromCatalog?.reasoning ?? false,
            efforts: [...(model.efforts ?? fromCatalog?.efforts ?? [])],
            compactAt: model.compactAt ?? null,
            price,
            headers: {...model.headers},
            status,
        };
    };

    let missingReported = new Set<string>();
    function snapshot(): ModelsSnapshot {
        if (snapshotCache !== null) return snapshotCache;
        const list: SnapshotProvider[] = providers().map((provider) => {
            const catalogBaseUrl = provider.kind === "catalog" ? catalog.get(provider.id)?.models[0]?.baseUrl ?? null : null;
            return {
                id: provider.id,
                kind: provider.kind,
                name: provider.name,
                baseUrl: provider.baseUrl ?? catalogBaseUrl,
                catalogBaseUrl,
                api: provider.api ?? (provider.kind === "catalog" ? catalog.get(provider.id)?.models[0]?.api ?? null : null),
                auth: provider.auth,
                headers: {...provider.headers},
                key: keyStatusOf(provider),
                models: provider.models.map((model) => snapshotModel(provider, model)),
            };
        });
        // 目录漂移（输出 9）：设置里引用的目录模型不在了，每个只诊断一次。
        const missing = new Set(list.flatMap((provider) => provider.models.filter((model) => model.status === "missing").map((model) => referenceOf(provider.id, model.id))));
        for (const reference of missing) if (!missingReported.has(reference)) deps.record("warn", "models.catalog.missing", "A configured catalog model is no longer in the catalog", {model: reference});
        missingReported = missing;
        snapshotCache = {
            providers: list,
            roles: roles().map((role) => ({id: role.id, axis: role.axis, builtin: BUILTIN.has(role.id), name: role.name, description: role.description, model: role.model, status: roleStatus(role)})),
        };
        return snapshotCache;
    }

    /** 等这个键的下一次变化，最多 `CATCH_UP_MS`。 */
    const changeOf = (key: string): Promise<void> => new Promise((resolve) => {
        const timer = setTimeout(done, CATCH_UP_MS);
        const off = settings.onDidChange((keys) => {
            if (keys.has(key)) done();
        });
        function done(): void {
            clearTimeout(timer);
            off();
            resolve();
        }
    });

    // ---- 串行写入 ----
    let tail: Promise<unknown> = Promise.resolve();
    const queue = <T>(work: () => Promise<T>): Promise<T> => {
        const run = tail.then(work, work);
        tail = run.catch(() => undefined);
        return run;
    };

    /**
     * 读本层当前值、合并、带 `expect` 写回；`conflict`（期间别处写过文件）就重读重来（输出 6）。`transform` 拿到的是用户层
     * 的值（没有时是缺省值），交回下一份值或业务失败。
     */
    async function mutate<V, R>(setting: SettingDefinition<V>, fallback: V, transform: (current: V) => Step<{next: V; result: R}>): Promise<Step<R>> {
        for (let attempt = 1; attempt <= WRITE_ATTEMPTS; attempt += 1) {
            const user = settings.inspect(setting).user;
            if (user.status === "unavailable" || user.status === "invalid" || user.status === "absent") return failure("settings-unavailable", "the user settings layer is not writable", {code: user.status === "invalid" ? "layer-invalid" : "unavailable"});
            // 读到的值深冻结，合并要改它：取一份可改的拷贝（结构化克隆后去掉只读标记是安全的）。
            const current = user.value === undefined ? fallback : (structuredClone(user.value) as V);
            const step = transform(current);
            if (!step.ok) return step;
            const written: SettingWriteResult = await settings.update(setting, step.value.next, {expect: {value: user.value}});
            if (written.ok) return {ok: true, value: step.value.result};
            if (written.code === "conflict") {
                await changeOf(setting.key);
                continue;
            }
            if (written.code === "invalid-value") return failure("invalid-value", written.detail);
            return failure("settings-unavailable", written.detail, {code: written.code});
        }
        return failure("write-conflict", "the settings kept changing while writing");
    }
    const editProviders = <R>(transform: (list: ProviderConfig[]) => Step<{next: ProviderConfig[]; result: R}>) => mutate<ProviderConfig[], R>(providersSetting as SettingDefinition<ProviderConfig[]>, [], transform);
    const editRoles = <R>(transform: (value: RolesConfig) => Step<{next: RolesConfig; result: R}>) => mutate<RolesConfig, R>(rolesSetting as SettingDefinition<RolesConfig>, structuredClone(DEFAULT_ROLES), transform);
    const unknownProvider = (id: string): Failure => failure("unknown-provider", `no provider ${id}`);
    /** 删掉服务商或模型之后，绑着它们的角色解除绑定（变成未绑定，而不是指向不存在的模型）。 */
    const unbind = (provider: string, models?: readonly string[]): Promise<Step<null>> =>
        editRoles<null>((value) => {
            const stale = (role: RoleConfig) => role.model !== null && rolesUsing([role], provider).length > 0 && (models === undefined || models.includes(splitReference(role.model)!.model));
            if (!value.items.some(stale)) return {ok: true, value: {next: value, result: null}};
            return {ok: true, value: {next: {items: value.items.map((role) => (stale(role) ? {...role, model: null} : role))}, result: null}};
        });
    const withProvider = <R>(id: string, change: (provider: ProviderConfig, list: ProviderConfig[]) => Step<{provider: ProviderConfig | null; result: R}>) =>
        editProviders<R>((list) => {
            const index = list.findIndex((item) => item.id === id);
            if (index < 0) return unknownProvider(id);
            const step = change(list[index]!, list);
            if (!step.ok) return step;
            const next = step.value.provider === null ? list.filter((_, at) => at !== index) : list.map((item, at) => (at === index ? step.value.provider! : item));
            return {ok: true, value: {next, result: step.value.result}};
        });
    /**
     * 写进设置的样子（service.md 输入一节）：目录模型只存用户改过的。能力、上限与单价按目录（界面不让改，写来的一律不存）；
     * 名字、系列与目录或推出来的相同时不存，请求头为空时不存。这样目录更新后没改过的字段跟着目录走。
     */
    const stored = (provider: ProviderConfig, model: ModelConfig): ModelConfig => {
        const fromCatalog = provider.kind === "catalog" ? catalogModel(provider.id, model.id) : undefined;
        if (fromCatalog === undefined) return model;
        return {
            id: model.id,
            enabled: model.enabled,
            ...(model.name === undefined || model.name === fromCatalog.name ? {} : {name: model.name}),
            ...(model.group === undefined || model.group === seriesOf(model.id) ? {} : {group: model.group}),
            ...(model.compactAt === undefined ? {} : {compactAt: model.compactAt}),
            ...(model.headers === undefined || Object.keys(model.headers).length === 0 ? {} : {headers: model.headers}),
        };
    };

    const incomplete = (provider: ProviderConfig, models: readonly ModelConfig[]): Failure | null => {
        const bad = models.find((model) => model.enabled && missingContextWindow(provider, model));
        return bad === undefined ? null : failure("model-incomplete", `custom model ${bad.id} needs a context window before it can be enabled`);
    };

    // ---- 凭据 ----
    const credentialStep = async (work: () => Promise<void>): Promise<Step<null>> => {
        try {
            await work();
            return {ok: true, value: null};
        } catch (error) {
            deps.record("warn", "models.credentials.failed", "Reading or writing the credential store failed", {error: error instanceof Error ? error.message : String(error)});
            return failure("credentials-unavailable", "the credential store could not be written");
        }
    };
    const statusNow = (id: string): KeyStatus => {
        const provider = providers().find((item) => item.id === id);
        return provider === undefined ? {kind: "none"} : keyStatusOf(provider);
    };
    const partial = (id: string, step: Failure): Failure => ({ok: false, code: "partially-applied", detail: {key: statusNow(id), detail: `only the first of two writes applied (${step.code})`}});
    const setApiKeyEnv = (id: string, name: string | undefined) => withProvider<null>(id, (provider) => {
        const {apiKeyEnv: _old, ...rest} = provider;
        return {ok: true, value: {provider: name === undefined ? rest : {...rest, apiKeyEnv: name}, result: null}};
    });

    // ---- 检测 ----
    const probe: ModelRequest = {purpose: "background", model: "", params: {}, headers: {}, system: [], messages: [{role: "user", content: [{kind: "text", text: "ping", origin: {kind: "fixed", by: "kernel"}}]}], tools: []};
    async function check(provider: ProviderConfig, model: ModelConfig, signal: AbortSignal): Promise<CheckResult> {
        if (missingContextWindow(provider, model)) return {ok: false, kind: "local", code: "model-incomplete", raw: ""};
        const built = buildResolution(targetOf(provider), modelTargetOf(model), access, transport);
        if (!built.ok) return {ok: false, kind: "local", code: "unknown-model", raw: ""};
        const timeout = AbortSignal.timeout(CHECK_TIMEOUT_MS);
        const combined = AbortSignal.any([signal, timeout]);
        const maxTokens = Math.min(CHECK_MAX_OUTPUT, built.resolution.info.maxOutput ?? CHECK_MAX_OUTPUT);
        const response = await built.resolution.call({...probe, model: built.resolution.info.id, params: {maxTokens}}, combined, () => undefined);
        if (response.stopReason === "aborted") return {ok: false, kind: "network", code: timeout.aborted ? "timeout" : "cancelled", raw: ""};
        if (response.stopReason === "error") return {ok: false, kind: response.error?.kind ?? "provider", code: response.error?.code ?? null, raw: response.error?.message ?? ""};
        return {ok: true};
    }

    const service: ModelsService = {
        port: (profileDefaults?: (profile: string) => ProfileModelDefaults): ModelPort => ({
            resolve: (query: ModelQuery): ModelResolution => {
                if (query.role !== undefined) return resolveRole(query.role);
                if (query.purpose === "compaction") return resolveRole("compaction");
                if (query.purpose === "approval") return resolveRole("fast");
                if (query.settings.model !== null) return resolveReference(query.settings.model);
                const defaults = profileDefaults?.(query.profile) ?? {};
                if (defaults.model !== undefined) return resolveReference(defaults.model);
                return resolveRole(defaults.role ?? "main");
            },
        }),
        snapshot,
        onChange: (listener) => {
            listeners.add(listener);
            return () => void listeners.delete(listener);
        },
    };

    const remote = (_consumer: ConsumerIdentity): RemoteImplementation<typeof modelsSettingsContract> => ({
        methods: {
            catalogProviders: (_input, ctx) => ctx.ok([...catalog.values()].map((provider) => ({id: provider.id, name: provider.name, access: provider.access, added: providers().some((item) => item.id === provider.id)}))),
            catalogModels: (input, ctx) => {
                const provider = catalog.get(input.provider);
                if (provider === undefined) return ctx.fail("unknown-provider", {detail: `no catalog provider ${input.provider}`});
                return ctx.ok(provider.models.map((model) => ({
                    id: model.id, name: model.name, contextWindow: model.contextWindow, maxOutput: model.maxTokens, vision: model.images, reasoning: model.reasoning, efforts: [...model.efforts],
                    price: model.price === null ? null : [model.price.input, model.price.output, model.price.cacheRead ?? 0, model.price.cacheWrite ?? 0],
                })));
            },
            snapshot: (_input, ctx) => ctx.ok(snapshot()),
            addProvider: ({source: input}, ctx) => queue(async () => {
                const step = await editProviders<string>((list) => {
                    if (input.kind === "catalog") {
                        const entry = catalog.get(input.id);
                        if (entry === undefined) return unknownProvider(input.id);
                        if (list.some((item) => item.id === input.id)) return {ok: true, value: {next: list, result: input.id}};
                        return {ok: true, value: {next: [...list, {id: input.id, kind: "catalog", name: entry.name, auth: "default", models: []}], result: input.id}};
                    }
                    const id = providerIdFor(input.name, new Set([...list.map((item) => item.id), ...catalog.keys()]));
                    return {ok: true, value: {next: [...list, {id, kind: "custom", name: input.name, baseUrl: input.baseUrl, api: input.api, auth: "default", models: []}], result: id}};
                });
                return step.ok ? ctx.ok({id: step.value}) : relay(step);
            }),
            updateProvider: (input, ctx) => queue(async () => {
                const step = await withProvider<null>(input.id, (provider) => {
                    const {baseUrl, ...patch} = input.patch;
                    const next: ProviderConfig = {...provider, ...patch};
                    if (baseUrl === null) delete (next as {baseUrl?: string}).baseUrl;
                    else if (baseUrl !== undefined) next.baseUrl = baseUrl;
                    if (next.kind === "custom" && next.baseUrl === undefined) return failure("invalid-value", "a custom provider needs an endpoint");
                    return {ok: true, value: {provider: next, result: null}};
                });
                return step.ok ? ctx.ok(null) : relay(step);
            }),
            // 删服务商、删模型：先解除角色绑定再删（service.md 输出 15）。两次写入不是一次收口：先解绑的话，后一步失败只留下
            // 未绑定的角色与还在的服务商或模型，重试即可；反过来会留下指向已删模型的绑定。
            removeProvider: (input, ctx) => queue(async () => {
                if (!providers().some((provider) => provider.id === input.id)) return relay(unknownProvider(input.id));
                const unbound = await unbind(input.id);
                if (!unbound.ok) return relay(unbound);
                const step = await withProvider<null>(input.id, () => ({ok: true, value: {provider: null, result: null}}));
                if (!step.ok) return relay(step);
                const cleared = await credentialStep(() => credentials.clear(input.id));
                return cleared.ok ? ctx.ok(null) : relay(cleared);
            }),
            upsertModel: (input, ctx) => queue(async () => {
                const step = await withProvider<null>(input.provider, (provider) => {
                    const next = stored(provider, input.model);
                    const models = provider.models.some((model) => model.id === next.id) ? provider.models.map((model) => (model.id === next.id ? next : model)) : [...provider.models, next];
                    return incomplete(provider, [next]) ?? {ok: true, value: {provider: {...provider, models}, result: null}};
                });
                return step.ok ? ctx.ok(null) : relay(step);
            }),
            removeModel: (input, ctx) => queue(async () => {
                if (!providers().some((provider) => provider.id === input.provider)) return relay(unknownProvider(input.provider));
                const unbound = await unbind(input.provider, [input.id]);
                if (!unbound.ok) return relay(unbound);
                const step = await withProvider<null>(input.provider, (provider) => ({ok: true, value: {provider: {...provider, models: provider.models.filter((model) => model.id !== input.id)}, result: null}}));
                return step.ok ? ctx.ok(null) : relay(step);
            }),
            setModels: (input, ctx) => queue(async () => {
                // 先按当前配置校验（不合格就什么都不动），再解绑要移出的，最后写模型。
                const current = providers().find((provider) => provider.id === input.provider);
                if (current === undefined) return relay(unknownProvider(input.provider));
                const rejected = incomplete(current, input.add.map((model) => stored(current, model)));
                if (rejected !== null) return relay(rejected);
                const gone = input.remove.filter((id) => !input.add.some((added) => added.id === id));
                const unbound = gone.length === 0 ? {ok: true as const, value: null} : await unbind(input.provider, gone);
                if (!unbound.ok) return relay(unbound);
                const step = await withProvider<null>(input.provider, (provider) => {
                    const removed = new Set(input.remove);
                    const added = input.add.map((model) => stored(provider, model));
                    const kept = provider.models.filter((model) => !removed.has(model.id) && !added.some((item) => item.id === model.id));
                    return incomplete(provider, added) ?? {ok: true, value: {provider: {...provider, models: [...kept, ...added]}, result: null}};
                });
                return step.ok ? ctx.ok(null) : relay(step);
            }),
            setRole: (input, ctx) => queue(async () => {
                const step = await editRoles<null>((value) => {
                    const role = value.items.find((item) => item.id === input.id);
                    if (role === undefined) return failure("unknown-role", `no role ${input.id}`);
                    const compaction = value.items.find((item) => item.id === "compaction");
                    // 第一次绑快速档而压缩还没绑：压缩跟着它（输出 14）。
                    const seedCompaction = input.id === "fast" && role.model === null && compaction !== undefined && compaction.model === null && input.model !== null;
                    const items = value.items.map((item) => (item.id === input.id ? {...item, model: input.model} : seedCompaction && item.id === "compaction" ? {...item, model: input.model} : item));
                    return {ok: true, value: {next: {items}, result: null}};
                });
                return step.ok ? ctx.ok(null) : relay(step);
            }),
            addRole: (input, ctx) => queue(async () => {
                const step = await editRoles<string>((value) => {
                    const taken = new Set(value.items.map((item) => item.id));
                    let index = 1;
                    while (taken.has(`custom-${String(index)}`)) index += 1;
                    const id = `custom-${String(index)}`;
                    return {ok: true, value: {next: {items: [...value.items, {id, axis: "specialist", name: input.name, description: input.description, model: null}]}, result: id}};
                });
                return step.ok ? ctx.ok({id: step.value}) : relay(step);
            }),
            updateRole: (input, ctx) => queue(async () => {
                if (BUILTIN.has(input.id)) return ctx.fail("builtin-role", {detail: `${input.id} is a built-in role`});
                const step = await editRoles<null>((value) => {
                    if (!value.items.some((item) => item.id === input.id)) return failure("unknown-role", `no role ${input.id}`);
                    return {ok: true, value: {next: {items: value.items.map((item) => (item.id === input.id ? {...item, name: input.name, description: input.description} : item))}, result: null}};
                });
                return step.ok ? ctx.ok(null) : relay(step);
            }),
            removeRole: (input, ctx) => queue(async () => {
                if (BUILTIN.has(input.id)) return ctx.fail("builtin-role", {detail: `${input.id} is a built-in role`});
                const step = await editRoles<null>((value) => {
                    if (!value.items.some((item) => item.id === input.id)) return failure("unknown-role", `no role ${input.id}`);
                    return {ok: true, value: {next: {items: value.items.filter((item) => item.id !== input.id)}, result: null}};
                });
                return step.ok ? ctx.ok(null) : relay(step);
            }),
            setKey: (input, ctx) => queue(async () => {
                if (!providers().some((item) => item.id === input.provider)) return ctx.fail("unknown-provider", {detail: `no provider ${input.provider}`});
                if (input.value.startsWith("env:")) {
                    const name = envRefName(input.value);
                    if (name === null) return ctx.fail("invalid-value", {detail: "env: must be followed by an environment variable name"});
                    // apiKeyEnv 盖过库里的密钥：先写它，第二步失败时生效的已经是新的那个（输出 13）。
                    const first = await setApiKeyEnv(input.provider, name);
                    if (!first.ok) return relay(first);
                    const second = await credentialStep(() => credentials.clear(input.provider));
                    return second.ok ? ctx.ok(statusNow(input.provider)) : relay(partial(input.provider, second));
                }
                const first = await credentialStep(() => credentials.set(input.provider, input.value));
                if (!first.ok) return relay(first);
                if (providers().find((item) => item.id === input.provider)?.apiKeyEnv === undefined) return ctx.ok(statusNow(input.provider));
                const second = await setApiKeyEnv(input.provider, undefined);
                return second.ok ? ctx.ok(statusNow(input.provider)) : relay(partial(input.provider, second as Failure));
            }),
            clearKey: (input, ctx) => queue(async () => {
                if (!providers().some((item) => item.id === input.provider)) return ctx.fail("unknown-provider", {detail: `no provider ${input.provider}`});
                const first = await credentialStep(() => credentials.clear(input.provider));
                if (!first.ok) return relay(first);
                if (providers().find((item) => item.id === input.provider)?.apiKeyEnv === undefined) return ctx.ok(statusNow(input.provider));
                const second = await setApiKeyEnv(input.provider, undefined);
                return second.ok ? ctx.ok(statusNow(input.provider)) : relay(partial(input.provider, second as Failure));
            }),
            discover: async (input, ctx) => {
                const provider = providers().find((item) => item.id === input.provider);
                if (provider === undefined) return ctx.fail("unknown-provider", {detail: `no provider ${input.provider}`});
                if (provider.kind !== "custom" || provider.baseUrl === undefined || (provider.api !== "openai-completions" && provider.api !== "openai-responses")) return ctx.fail("not-supported", {detail: "only OpenAI compatible custom providers list their models"});
                const auth = requestAuth(targetOf(provider), null, access);
                if (auth.missing.length > 0 || (auth.key === null && provider.auth !== "none")) return ctx.fail("no-credentials", {detail: "no credential for this provider"});
                const result = await discoverModels({api: provider.api, baseUrl: provider.baseUrl, ...(provider.auth === "none" || auth.key === null ? {} : {apiKey: auth.key}), headers: auth.headers, signal: ctx.signal});
                switch (result.state) {
                    case "found":
                        return ctx.ok(result.models.map((model) => ({id: model.id, name: model.name, suggested: model.suggested === null ? null : {contextWindow: model.suggested.contextWindow, maxOutput: model.suggested.maxTokens, vision: model.suggested.images, reasoning: model.suggested.reasoning}})));
                    case "empty":
                        return ctx.ok([]);
                    case "not_supported":
                        return ctx.fail("not-supported", {detail: `the endpoint answered ${String(result.status)}`});
                    case "auth":
                        return ctx.fail("auth", {detail: `the endpoint answered ${String(result.status)}`});
                    case "unreachable":
                        return ctx.fail("unreachable", {detail: result.message});
                    case "failed":
                        return ctx.fail("failed", {detail: result.message});
                }
            },
            check: async (input, ctx) => {
                const provider = providers().find((item) => item.id === input.provider);
                if (provider === undefined) return ctx.fail("unknown-provider", {detail: `no provider ${input.provider}`});
                const model = provider.models.find((item) => item.id === input.model);
                if (model === undefined) return ctx.fail("unknown-model", {detail: `no model ${input.model}`});
                return ctx.ok(await check(provider, model, ctx.signal));
            },
            checkAll: async (input, ctx) => {
                const provider = providers().find((item) => item.id === input.provider);
                if (provider === undefined) return ctx.fail("unknown-provider", {detail: `no provider ${input.provider}`});
                const pending = provider.models.filter((model) => model.enabled);
                const results: {model: string; result: CheckResult}[] = [];
                const worker = async (): Promise<void> => {
                    for (let next = pending.shift(); next !== undefined; next = pending.shift()) results.push({model: next.id, result: await check(provider, next, ctx.signal)});
                };
                await Promise.all(Array.from({length: Math.min(CHECK_CONCURRENCY, pending.length)}, worker));
                const order = provider.models.map((model) => model.id);
                return ctx.ok(results.sort((a, b) => order.indexOf(a.model) - order.indexOf(b.model)));
            },
        },
        events: {changed},
    });

    return {
        service,
        remote,
        close: async () => {
            offSettings();
            offCredentials();
            listeners.clear();
            await tail;
        },
    };
}

